import { randomUUID } from 'node:crypto'
import { digest } from '../auth'
import type { Context } from '../context'
import type { InboundReply } from './providers'
import { holding, settleUse } from '../aiUsage'
import { answersSocial, answersTexts } from '../../src/assistant/receptionist'
import { askReceptionist, receptionUse } from '../../src/assistant/receptionistAsk'
import type { ReceptionEffect, ReceptionTurn } from '../../src/assistant/receptionist'
import { BOOKING_LINK, MANAGE_LINK_SPOT } from '../../src/assistant/receptionistBrain'
import { businessDate, operations } from '../../src/domain/operations'
import { repliesList, senderClient } from '../../src/domain/inbox'
import { MANAGE_LINK, textNumber } from '../../src/domain/reminders'
import { isSocialChannel } from '../../src/domain/inboxSchema'
import type { SocialChannel } from '../../src/domain/inboxSchema'
import type { SocialMessage } from './meta'
import type { BusinessState } from '../../src/domain/model'
import { hasLocations, staffLocationOn } from '../../src/domain/locations'

/** A text conversation stays one chat while its messages are less than an hour apart. */
const CHAT_WINDOW_MS = 60 * 60000
const HISTORY_TURNS = 8
/** Messages being answered now, so a provider sending one again meanwhile is not answered twice. */
const answering = new Set<string>()
/** The last answer under way for each guest's conversation, so the next waits its turn. */
const conversations = new Map<string, Promise<unknown>>()
/** The outbox's own fill-ins, such as a visit's link, which an AI's words must never carry. */
const FILL_INS = /\{\{[^{}]*\}\}/g

/** The booking page with an offered time already chosen. The guest still holds and confirms it. */
export function bookingLink(
  origin: string,
  slug: string,
  time: ReceptionEffect,
  state?: BusinessState,
) {
  if (time.kind !== 'time') return `${origin}/book/${slug}`
  const params = new URLSearchParams({
    service: time.serviceId,
    staff: time.staffId,
    date: time.date,
    start: String(time.startMinutes),
  })
  // V2: with several locations, the page opens where the time was found: where the professional
  // who would take it works that day. A time with anyone carries its location.
  const where =
    time.locationId ??
    (state && hasLocations(state) && time.staffId !== 'any'
      ? staffLocationOn(state, time.staffId, time.date)
      : undefined)
  if (where) params.set('location', where)
  return `${origin}/book/${slug}?${params}`
}

/**
 * V4: the AI receptionist answers a guest's text to the studio's line, when the studio chose
 * that. The answer goes through the outbox like any other text, so it is sent once and the inbox
 * shows what became of it. It steps back when someone from the studio has texted this guest in
 * the last hour, and when the month's allowance is used up: the guest's message waits in the inbox.
 * Returns whether an answer was queued.
 */
export async function answerText(ctx: Context, slug: string, reply: InboundReply) {
  const row = ctx.db.get<{ id: string }>('SELECT id FROM organisations WHERE slug=?', slug)
  const number = textNumber(reply.from)
  if (!row || !number) return false
  return answer(ctx, row.id, 'sms', { ...reply, from: number })
}

/**
 * V4: the same for a guest's message to the studio's Instagram, Facebook or WhatsApp, when the
 * studio chose that. The answer goes from the account the guest wrote to.
 */
export async function answerSocial(ctx: Context, message: SocialMessage) {
  const row = ctx.db.get<{ organisation_id: string }>(
    'SELECT organisation_id FROM social_accounts WHERE channel=? AND account_id=?',
    message.channel,
    message.account,
  )
  if (!row) return false
  return answer(ctx, row.organisation_id, message.channel, {
    from: message.from,
    body: message.text,
    providerRef: message.ref,
  })
}

/** How far back SALEANE looks, on starting, for a guest's message it never answered. */
const MISSED_MS = 10 * 60000

/** A guest's message kept in the inbox, as SALEANE answers it. */
export type Missed = { orgId: string; channel: 'sms' | SocialChannel; reply: InboundReply }

/**
 * NEXT-12: with a real AI, the provider is thanked before the answer is written, so it will not
 * send the message again. Should SALEANE stop in between, the guest's message is kept in the
 * inbox but never answered; on starting, each one kept in the last ten minutes with no answer is
 * answered now, oldest first. Older ones are left for the team, as an answer would come too late.
 * Returns whether any answer was queued, and the messages the allowance refused: the stopped
 * request may still hold the month's last guest chat, so the app tries those again (`again`)
 * once that hold has run out. One Claude could not answer is left for the team, as always.
 */
export async function answerMissed(ctx: Context, again?: Missed[]) {
  const refused: Missed[] = []
  const work = (again ?? keptUnanswered(ctx)).map((missed) =>
    answer(ctx, missed.orgId, missed.channel, missed.reply, () => refused.push(missed)),
  )
  return { queued: (await Promise.all(work)).some(Boolean), refused }
}

function keptUnanswered(ctx: Context) {
  const since = ctx.now() - MISSED_MS
  const kept: Missed[] = []
  for (const { id } of ctx.db.all<{ id: string }>('SELECT id FROM organisations')) {
    const org = ctx.systemOrg(id)
    if (!org) continue
    const missed = repliesList(org.state)
      .filter((r) => Date.parse(r.receivedAt) > since)
      .sort((a, b) => Date.parse(a.receivedAt) - Date.parse(b.receivedAt))
    for (const r of missed) {
      const channel = r.channel
      if (channel !== 'sms' && !isSocialChannel(channel)) continue
      const from = channel === 'sms' ? textNumber(r.from) : r.from
      if (!r.providerRef || !from || !answers(org, channel)) continue
      kept.push({ orgId: id, channel, reply: { from, body: r.body, providerRef: r.providerRef } })
    }
  }
  return kept
}

type Org = NonNullable<ReturnType<Context['systemOrg']>>

/**
 * NEXT-12: each guest's messages are answered one at a time, in the order they came. A second text
 * sent while a real AI is still answering the first then sees that answer, so it continues the
 * same chat rather than counting as a new one, and the answers go out in order.
 */
function inTurn<T>(key: string, work: () => Promise<T>) {
  const run = (conversations.get(key) ?? Promise.resolve()).then(work)
  const settled = run.catch(() => undefined)
  conversations.set(key, settled)
  void settled.then(() => {
    if (conversations.get(key) === settled) conversations.delete(key)
  })
  return run
}

/** Whether the studio has the receptionist answering on this channel. */
const answers = (org: Org, channel: 'sms' | SocialChannel) =>
  operations(org.state).mode === 'local' &&
  (channel === 'sms' ? answersTexts : answersSocial)(org.state)

async function answer(
  ctx: Context,
  orgId: string,
  channel: 'sms' | SocialChannel,
  reply: InboundReply,
  /** Told when the allowance refused the message. */
  refused?: () => void,
) {
  const { db } = ctx
  const org = ctx.systemOrg(orgId)
  if (!org || !answers(org, channel)) return false
  if (!reply.from || !reply.body.trim()) return false
  // Answered already: a provider sending the same text again gets no second answer. A text kept
  // before a crash, and not yet answered, is answered when the provider tries again.
  const dedupe = `reception:${reply.providerRef}`
  const done = () =>
    !!db.get('SELECT 1 FROM outbox WHERE organisation_id=? AND dedupe_key=?', org.id, dedupe)
  if (done()) return false
  const key = `${org.id}:${dedupe}`
  if (answering.has(key)) return false
  answering.add(key)
  try {
    return await inTurn(`${org.id}:${channel}:${reply.from}`, async () => {
      // The studio as it is now, after any answer before this one in the conversation.
      const latest = ctx.systemOrg(orgId)
      if (done() || !latest || !answers(latest, channel)) return false
      return answerKept(ctx, latest, channel, reply, dedupe, refused)
    })
  } finally {
    answering.delete(key)
  }
}

async function answerKept(
  ctx: Context,
  org: Org,
  channel: 'sms' | SocialChannel,
  reply: InboundReply,
  dedupe: string,
  refused?: () => void,
) {
  const { db, now } = ctx
  const number = reply.from
  const words = reply.body.trim()
  const kept = repliesList(org.state).find(
    (r) => r.channel === channel && r.providerRef === reply.providerRef.slice(0, 200),
  )
  if (!kept) return false
  // On the social apps, a team member's answer is the 'social' kind rather than a message.
  const person = channel === 'sms' ? 'message' : 'social'
  const time = now()
  const at = new Date(time).toISOString()
  const since = time - CHAT_WINDOW_MS
  /** The last hour's answers to this guest, and whether someone at the studio is among them. */
  const conversation = (current: Org) => {
    // On the social apps a sender's id belongs to one account, so only this account's answers count.
    const ownAccount = (row: { kind: string; slot: string }) => {
      if (channel === 'sms') return true
      if (row.kind === 'receptionist')
        return repliesList(current.state).some(
          (r) =>
            r.channel === channel &&
            r.account === kept.account &&
            `reception:${r.providerRef}` === row.slot,
        )
      return (current.state.socialAnswers ?? []).some(
        (a) => `social:${a.id}` === row.slot && a.account === kept.account,
      )
    }
    const sent = db
      .all<{ kind: string; slot: string; body: string; created_at: number }>(
        'SELECT kind,slot,body,created_at FROM outbox WHERE organisation_id=? AND recipient=? AND channel=? AND kind IN (?,?) AND created_at>? ORDER BY created_at',
        current.id,
        number,
        channel,
        'receptionist',
        person,
        since,
      )
      .filter(ownAccount)
    const team =
      sent.some((m) => m.kind === person) ||
      // Also an answer written in the last hour and not yet in the outbox.
      (channel !== 'sms' &&
        (current.state.socialAnswers ?? []).some(
          (a) =>
            a.channel === channel &&
            a.to === number &&
            a.account === kept.account &&
            Date.parse(a.answeredAt) > since,
        ))
    return { sent, team }
  }
  const { sent, team } = conversation(org)
  // A person at the studio is already talking with this guest.
  if (team) return false
  const signed = `${org.state.organisation.name} AI receptionist: `
  const answered = sent.map((m) => ({
    from: 'receptionist' as const,
    text: m.body.startsWith(signed) ? m.body.slice(signed.length) : m.body,
    at: m.created_at,
  }))
  const asked = repliesList(org.state)
    .filter(
      (r) =>
        r.channel === channel &&
        r.from === number &&
        r.account === kept.account &&
        r.providerRef !== reply.providerRef &&
        Date.parse(r.receivedAt) > since,
    )
    .map((r) => ({ from: 'guest' as const, text: r.body, at: Date.parse(r.receivedAt) }))
  const history: ReceptionTurn[] = [...asked, ...answered]
    .sort((a, b) => a.at - b.at)
    .slice(-HISTORY_TURNS)
    .map(({ from, text }) => ({ from, text }))
  const continuing = answered.length > 0
  const visitor = digest(
    channel === 'sms'
      ? `text:${org.id}:${number}`
      : `${channel}:${org.id}:${kept.account}:${number}`,
  )
  // Known for sure only by a text or WhatsApp message from the one number on a client's record. A
  // sender the team matched by hand is not proof enough to be sent a visit's private link.
  const guest =
    channel === 'sms' || channel === 'whatsapp'
      ? senderClient(org.state, channel, number)
      : undefined
  const brain = ctx.ai.brainFor(org.state, 'reception')
  const allowance = ctx.plans.allowance(org)
  // NEXT-12: the message's share is held before the AI is asked, then settled with its real cost.
  const use = receptionUse(visitor, at, continuing)
  const { held, result } = await holding(ctx, org.id, allowance, use, (before) =>
    askReceptionist({
      state: ctx.withHolds(org),
      today: businessDate(org.state, at),
      now: at,
      visitorId: visitor,
      text: words.slice(0, 500),
      history,
      channel: 'text',
      continuing,
      ...(guest ? { guestId: guest.id } : {}),
      usage: before,
      allowance,
      ...(brain ? { brain } : {}),
    }),
  )
  if (result.status === 'refused') {
    if (held) db.transaction(() => settleUse(ctx, org.id, use, { counted: false, costMinor: 0 }))
    refused?.()
    return false
  }
  if (result.status === 'unavailable') {
    // The guest's message waits in the inbox for the team; what the attempt cost still counts.
    console.error(
      `[SALEANE] The receptionist's AI could not answer (${result.reason}): ${result.detail}`,
    )
    db.transaction(() =>
      settleUse(ctx, org.id, use, { counted: false, costMinor: result.costMinor }),
    )
    return false
  }
  const offered = result.proposals.find((p) => p.effect.kind === 'time')
  const manage = result.proposals
    .map((p) => p.effect)
    .find((e): e is Extract<ReceptionEffect, { kind: 'manage' }> => e.kind === 'manage')
  // Every answer says who it is from, since a message has no page around it to say so. A visit's
  // private link is never stored: the outbox makes a fresh one as it sends.
  const body = `${signed}${result.text.replace(FILL_INS, '')}`
    .replaceAll(
      BOOKING_LINK,
      offered
        ? bookingLink(ctx.allowedOrigin, org.slug, offered.effect, org.state)
        : `${ctx.allowedOrigin}/book/${org.slug}`,
    )
    .replaceAll(MANAGE_LINK_SPOT, manage && guest ? MANAGE_LINK : '')
  // The guest's own conversation, including a number the team matched to a client by hand.
  const clientId = manage && guest ? guest.id : (kept.clientId ?? guest?.id ?? '')
  return db.transaction(() => {
    // A real AI can take several seconds. Meanwhile the studio may have turned the receptionist
    // off, or someone from the team may have answered the guest: then the AI's answer is not
    // sent and does not count, though what it cost does.
    const latest = ctx.systemOrg(org.id)
    if (!latest || !answers(latest, channel) || conversation(latest).team) {
      settleUse(ctx, org.id, use, { counted: false, costMinor: result.costMinor })
      return false
    }
    const inserted = db.run(
      `INSERT OR IGNORE INTO outbox(id,organisation_id,dedupe_key,appointment_id,client_id,kind,channel,slot,recipient,subject,body,status,next_attempt_at,created_at,updated_at)
       VALUES(?,?,?,?,?,'receptionist',?,?,?,'',?,'pending',?,?,?)`,
      randomUUID(),
      org.id,
      dedupe,
      manage && guest ? manage.appointmentId : '',
      clientId,
      channel,
      `reception:${reply.providerRef}`,
      number,
      body,
      time,
      time,
      time,
    )
    const queued = Number(inserted.changes) === 1
    settleUse(ctx, org.id, use, { counted: queued, costMinor: result.costMinor })
    return queued
  })
}
