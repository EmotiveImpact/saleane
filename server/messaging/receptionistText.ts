import { randomUUID } from 'node:crypto'
import { digest } from '../auth'
import type { Context } from '../context'
import type { InboundReply } from './providers'
import { countReception, storedUsage } from '../receptionistUsage'
import { answersSocial, answersTexts, askReceptionist } from '../../src/assistant/receptionist'
import type { ReceptionEffect, ReceptionTurn } from '../../src/assistant/receptionist'
import { BOOKING_LINK, MANAGE_LINK_SPOT } from '../../src/assistant/receptionistBrain'
import { businessDate, operations } from '../../src/domain/operations'
import { repliesList, senderClient } from '../../src/domain/inbox'
import { MANAGE_LINK, textNumber } from '../../src/domain/reminders'
import type { SocialChannel } from '../../src/domain/inboxSchema'
import type { SocialMessage } from './meta'
import type { BusinessState } from '../../src/domain/model'
import { hasLocations, staffLocationOn } from '../../src/domain/locations'

/** A text conversation stays one chat while its messages are less than an hour apart. */
const CHAT_WINDOW_MS = 60 * 60000
const HISTORY_TURNS = 8

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

async function answer(
  ctx: Context,
  orgId: string,
  channel: 'sms' | SocialChannel,
  reply: InboundReply,
) {
  const { db, now } = ctx
  const org = ctx.systemOrg(orgId)
  const chosen = channel === 'sms' ? answersTexts : answersSocial
  if (!org || operations(org.state).mode !== 'local' || !chosen(org.state)) return false
  const number = reply.from
  const words = reply.body.trim()
  if (!number || !words) return false
  // Answered already: a provider sending the same text again gets no second answer. A text kept
  // before a crash, and not yet answered, is answered when the provider tries again.
  const dedupe = `reception:${reply.providerRef}`
  if (db.get('SELECT 1 FROM outbox WHERE organisation_id=? AND dedupe_key=?', org.id, dedupe))
    return false
  const kept = repliesList(org.state).find(
    (r) => r.channel === channel && r.providerRef === reply.providerRef.slice(0, 200),
  )
  if (!kept) return false
  // On the social apps, a team member's answer is the 'social' kind rather than a message.
  const person = channel === 'sms' ? 'message' : 'social'
  const time = now()
  const at = new Date(time).toISOString()
  const since = time - CHAT_WINDOW_MS
  // On the social apps a sender's id belongs to one account, so only this account's answers count.
  const ownAccount = (row: { kind: string; slot: string }) => {
    if (channel === 'sms') return true
    if (row.kind === 'receptionist')
      return repliesList(org.state).some(
        (r) =>
          r.channel === channel &&
          r.account === kept.account &&
          `reception:${r.providerRef}` === row.slot,
      )
    return (org.state.socialAnswers ?? []).some(
      (a) => `social:${a.id}` === row.slot && a.account === kept.account,
    )
  }
  const sent = db
    .all<{ kind: string; slot: string; body: string; created_at: number }>(
      'SELECT kind,slot,body,created_at FROM outbox WHERE organisation_id=? AND recipient=? AND channel=? AND kind IN (?,?) AND created_at>? ORDER BY created_at',
      org.id,
      number,
      channel,
      'receptionist',
      person,
      since,
    )
    .filter(ownAccount)
  // A person at the studio is already talking with this guest.
  if (sent.some((m) => m.kind === person)) return false
  // Also an answer written in the last hour and not yet in the outbox.
  if (
    channel !== 'sms' &&
    (org.state.socialAnswers ?? []).some(
      (a) =>
        a.channel === channel &&
        a.to === number &&
        a.account === kept.account &&
        Date.parse(a.answeredAt) > since,
    )
  )
    return false
  const signed = `${org.state.organisation.name} AI receptionist: `
  const answers = sent.map((m) => ({
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
  const history: ReceptionTurn[] = [...asked, ...answers]
    .sort((a, b) => a.at - b.at)
    .slice(-HISTORY_TURNS)
    .map(({ from, text }) => ({ from, text }))
  const continuing = answers.length > 0
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
  const result = await askReceptionist({
    state: ctx.withHolds(org),
    today: businessDate(org.state, at),
    now: at,
    visitorId: visitor,
    text: words.slice(0, 500),
    history,
    channel: 'text',
    continuing,
    ...(guest ? { guestId: guest.id } : {}),
    usage: storedUsage(ctx, org.id),
  })
  if (result.status !== 'answered') return false
  const offered = result.proposals.find((p) => p.effect.kind === 'time')
  const manage = result.proposals
    .map((p) => p.effect)
    .find((e): e is Extract<ReceptionEffect, { kind: 'manage' }> => e.kind === 'manage')
  // Every answer says who it is from, since a message has no page around it to say so. A visit's
  // private link is never stored: the outbox makes a fresh one as it sends.
  const body = `${signed}${result.text}`
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
    countReception(ctx, org.id, {
      at,
      visitor,
      continuing,
      costMinor: result.costMinor,
      usage: result.usage,
    })
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
    return Number(inserted.changes) === 1
  })
}
