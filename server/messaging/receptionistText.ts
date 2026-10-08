import { randomUUID } from 'node:crypto'
import { digest } from '../auth'
import type { Context } from '../context'
import type { InboundReply } from './providers'
import { countReception, storedUsage } from '../receptionistUsage'
import { answersTexts, askReceptionist } from '../../src/assistant/receptionist'
import type { ReceptionEffect, ReceptionTurn } from '../../src/assistant/receptionist'
import { BOOKING_LINK } from '../../src/assistant/receptionistBrain'
import { businessDate, operations } from '../../src/domain/operations'
import { repliesList, senderClient } from '../../src/domain/inbox'
import { textNumber } from '../../src/domain/reminders'

/** A text conversation stays one chat while its messages are less than an hour apart. */
const CHAT_WINDOW_MS = 60 * 60000
const HISTORY_TURNS = 8

/** The booking page with an offered time already chosen. The guest still holds and confirms it. */
export function bookingLink(origin: string, slug: string, time: ReceptionEffect) {
  if (time.kind !== 'time') return `${origin}/book/${slug}`
  const params = new URLSearchParams({
    service: time.serviceId,
    staff: time.staffId,
    date: time.date,
    start: String(time.startMinutes),
  })
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
  const { db, now } = ctx
  const row = db.get<{ id: string }>('SELECT id FROM organisations WHERE slug=?', slug)
  const org = row && ctx.systemOrg(row.id)
  if (!org || operations(org.state).mode !== 'local' || !answersTexts(org.state)) return false
  const number = textNumber(reply.from)
  const words = reply.body.trim()
  if (!number || !words) return false
  // Answered already: a provider sending the same text again gets no second answer. A text kept
  // before a crash, and not yet answered, is answered when the provider tries again.
  const dedupe = `reception:${reply.providerRef}`
  if (db.get('SELECT 1 FROM outbox WHERE organisation_id=? AND dedupe_key=?', org.id, dedupe))
    return false
  const kept = repliesList(org.state).find(
    (r) => r.channel === 'sms' && r.providerRef === reply.providerRef.slice(0, 200),
  )
  if (!kept) return false
  const time = now()
  const at = new Date(time).toISOString()
  const since = time - CHAT_WINDOW_MS
  const sent = db.all<{ kind: string; body: string; created_at: number }>(
    "SELECT kind,body,created_at FROM outbox WHERE organisation_id=? AND recipient=? AND channel='sms' AND kind IN ('receptionist','message') AND created_at>? ORDER BY created_at",
    org.id,
    number,
    since,
  )
  // A person at the studio is already talking with this guest.
  if (sent.some((m) => m.kind === 'message')) return false
  const signed = `${org.state.organisation.name} AI receptionist: `
  const answers = sent.map((m) => ({
    from: 'receptionist' as const,
    text: m.body.startsWith(signed) ? m.body.slice(signed.length) : m.body,
    at: m.created_at,
  }))
  const asked = repliesList(org.state)
    .filter(
      (r) =>
        r.channel === 'sms' &&
        r.from === number &&
        r.providerRef !== reply.providerRef &&
        Date.parse(r.receivedAt) > since,
    )
    .map((r) => ({ from: 'guest' as const, text: r.body, at: Date.parse(r.receivedAt) }))
  const history: ReceptionTurn[] = [...asked, ...answers]
    .sort((a, b) => a.at - b.at)
    .slice(-HISTORY_TURNS)
    .map(({ from, text }) => ({ from, text }))
  const continuing = answers.length > 0
  const visitor = digest(`text:${org.id}:${number}`)
  const result = await askReceptionist({
    state: ctx.withHolds(org),
    today: businessDate(org.state, at),
    now: at,
    visitorId: visitor,
    text: words.slice(0, 500),
    history,
    channel: 'text',
    continuing,
    usage: storedUsage(ctx, org.id),
  })
  if (result.status !== 'answered') return false
  const offered = result.proposals.find((p) => p.effect.kind === 'time')
  // Every text says who it is from, since a text has no page around it to say so.
  const body = `${signed}${result.text}`.replaceAll(
    BOOKING_LINK,
    offered
      ? bookingLink(ctx.allowedOrigin, org.slug, offered.effect)
      : `${ctx.allowedOrigin}/book/${org.slug}`,
  )
  // The guest's own conversation, including a number the team matched to a client by hand.
  const clientId = kept.clientId ?? senderClient(org.state, 'sms', number)?.id ?? ''
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
       VALUES(?,?,?,'',?,'receptionist','sms',?,?,'',?,'pending',?,?,?)`,
      randomUUID(),
      org.id,
      dedupe,
      clientId,
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
