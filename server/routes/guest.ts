import { z } from 'zod'
import { digest, token } from '../auth'
import { fail } from '../http'
import { dispatch } from '../../src/domain/commands'
import { parseState } from '../../src/domain/model'
import type { BusinessState } from '../../src/domain/model'
import {
  GUEST_LINK_AFTER_VISIT_MS,
  GUEST_LINK_MAX_MS,
  depositOutcomes,
  guestCancellation,
  guestView,
  visitStart,
} from '../../src/domain/guest'
import type { Context, Org, Route } from '../context'
import { feedbackForVisit, feedbackInputSchema, feedbackOpen } from '../../src/domain/feedback'
import { waitlistTimesSchema } from '../../src/domain/waitlistSchema'
import { guestPaymentFor } from '../payments/service'

const INVALID = 'This link is no longer valid. Contact the studio to manage your visit.'
export const tokenSchema = z.string().min(32).max(100)
/** An email and a text each for the latest two messages. */
const MESSAGE_LINKS = 4

/**
 * Issues a private manage link for one visit and revokes every earlier one for it, so only the
 * newest link works. Must run inside the caller's transaction. The raw token is returned once.
 *
 * Links sent in confirmations and reminders (origin 'message') leave other links alone, so the
 * booking page's link keeps working when the email arrives; only the newest MESSAGE_LINKS of them
 * stay open. A desk or booking link still replaces every link, which is how the studio shuts a
 * leaked one.
 */
export function issueGuestLink(
  ctx: Context,
  org: Org,
  appointmentId: string,
  origin: 'booking' | 'desk' | 'message',
) {
  const { db, now, allowedOrigin } = ctx
  const time = now()
  const expiresAt = Math.min(
    time + GUEST_LINK_MAX_MS,
    visitStart(org.state, appointmentId) + GUEST_LINK_AFTER_VISIT_MS,
  )
  if (expiresAt <= time) fail(409, 'This visit is too far in the past for a manage link.')
  if (origin !== 'message')
    db.run(
      'UPDATE guest_links SET revoked_at=? WHERE organisation_id=? AND appointment_id=? AND revoked_at IS NULL',
      time,
      org.id,
      appointmentId,
    )
  else
    db.run(
      `UPDATE guest_links SET revoked_at=? WHERE organisation_id=? AND appointment_id=? AND revoked_at IS NULL AND origin='message'
       AND token_hash NOT IN (SELECT token_hash FROM guest_links WHERE organisation_id=? AND appointment_id=? AND revoked_at IS NULL AND origin='message' ORDER BY created_at DESC LIMIT ?)`,
      time,
      org.id,
      appointmentId,
      org.id,
      appointmentId,
      MESSAGE_LINKS - 1,
    )
  const raw = token()
  db.run(
    'INSERT INTO guest_links(token_hash,organisation_id,appointment_id,origin,created_at,expires_at) VALUES(?,?,?,?,?,?)',
    digest(raw),
    org.id,
    appointmentId,
    origin,
    time,
    expiresAt,
  )
  // The token sits in the fragment so it never reaches server logs or a Referer header.
  return {
    url: `${allowedOrigin}/manage#${raw}`,
    expiresAt: new Date(expiresAt).toISOString(),
    delivery: 'not_sent' as const,
  }
}

export function revokeGuestLinks(ctx: Context, org: Org, appointmentId: string) {
  return Number(
    ctx.db.run(
      'UPDATE guest_links SET revoked_at=? WHERE organisation_id=? AND appointment_id=? AND revoked_at IS NULL',
      ctx.now(),
      org.id,
      appointmentId,
    ).changes,
  )
}

/** Opens a private link. Every failure reads the same, so a link cannot reveal whether a visit exists. */
export function openGuestLink(ctx: Context, raw: string) {
  const { db, now } = ctx
  const link = db.get<{ organisation_id: string; appointment_id: string; expires_at: number }>(
    'SELECT organisation_id,appointment_id,expires_at FROM guest_links WHERE token_hash=? AND revoked_at IS NULL',
    digest(raw),
  )
  if (!link || link.expires_at <= now()) fail(404, INVALID)
  const row = db.get<{ id: string; slug: string; state: string }>(
    'SELECT id,slug,state FROM organisations WHERE id=?',
    link!.organisation_id,
  )
  if (!row) fail(404, INVALID)
  const stored = JSON.parse(row!.state) as BusinessState
  const state = parseState(stored, stored.organisation.region)
  if (!state.appointments.some((a) => a.id === link!.appointment_id)) fail(404, INVALID)
  if (visitStart(state, link!.appointment_id) + GUEST_LINK_AFTER_VISIT_MS <= now())
    fail(404, INVALID)
  const org: Org = { id: row!.id, slug: row!.slug, state, role: 'owner', staffId: null }
  return { org, appointmentId: link!.appointment_id }
}

/** Guest manage routes. A link opens one visit and nothing else. Returns false for other paths. */
export async function guestRoutes(ctx: Context, route: Route): Promise<boolean> {
  const { db, now, rateLimit, persist } = ctx
  const { request, method, path, body, reply } = route
  if (path[1] !== 'guest' || path.length !== 3 || method !== 'POST') return false

  const open = (raw: string) => openGuestLink(ctx, raw)

  if (path[2] === 'visit') {
    rateLimit(request, 'guest-read', 30, 5 * 60000)
    const data = z.object({ token: tokenSchema }).strict().parse(body)
    const { org, appointmentId } = open(data.token)
    reply(200, guestView(org.state, appointmentId, now(), guestPaymentFor(ctx, org, appointmentId)))
    return true
  }
  if (path[2] === 'feedback') {
    rateLimit(request, 'guest-write', 10, 5 * 60000)
    const data = z
      .object({ token: tokenSchema })
      .extend(feedbackInputSchema.shape)
      .strict()
      .parse(body)
    const view = db.transaction(() => {
      const { org, appointmentId } = open(data.token)
      const already = feedbackForVisit(org.state, appointmentId)
      if (
        !already &&
        !feedbackOpen(org.state, appointmentId, visitStart(org.state, appointmentId), now())
      )
        fail(409, 'Feedback for this visit is not open.')
      const result = dispatch(
        org.state,
        {
          type: 'feedback',
          appointmentId,
          visitRating: data.visitRating,
          practitionerRating: data.practitionerRating,
          comment: data.comment,
        },
        'Guest (private link)',
        new Date(now()).toISOString(),
      )
      if (!result.ok) fail(409, result.error)
      if (result.state !== org.state)
        persist(org, result.state, null, 'guest.feedback', appointmentId)
      return guestView(result.state, appointmentId, now())
    })
    reply(200, view)
    return true
  }
  if (path[2] === 'waitlist') {
    rateLimit(request, 'guest-write', 10, 5 * 60000)
    const data = z
      .object({
        token: tokenSchema,
        join: z.boolean(),
        anyone: z.boolean(),
        times: waitlistTimesSchema,
      })
      .strict()
      .parse(body)
    const view = db.transaction(() => {
      const { org, appointmentId } = open(data.token)
      const result = dispatch(
        org.state,
        data.join
          ? { type: 'waitlist-join', appointmentId, anyone: data.anyone, times: data.times }
          : { type: 'waitlist-leave', appointmentId },
        'Guest (private link)',
        new Date(now()).toISOString(),
      )
      if (!result.ok) fail(409, result.error)
      if (result.state !== org.state)
        persist(org, result.state, null, 'guest.waitlist', appointmentId)
      return guestView(result.state, appointmentId, now(), guestPaymentFor(ctx, org, appointmentId))
    })
    reply(200, view)
    return true
  }
  if (path[2] === 'cancel') {
    rateLimit(request, 'guest-write', 10, 5 * 60000)
    const data = z
      .object({ token: tokenSchema, expected: z.enum(depositOutcomes) })
      .strict()
      .parse(body)
    const view = db.transaction(() => {
      const { org, appointmentId } = open(data.token)
      const appointment = org.state.appointments.find((a) => a.id === appointmentId)!
      // A repeated request after a cancellation that already landed returns the same result.
      if (appointment.status === 'cancelled')
        return guestView(org.state, appointmentId, now(), guestPaymentFor(ctx, org, appointmentId))
      const terms = guestCancellation(org.state, appointmentId, now())
      if (!terms.available)
        fail(409, 'This visit can no longer be cancelled online. Contact the studio.')
      if (terms.outcome !== data.expected)
        fail(409, 'The cancellation terms changed while you were deciding. Review them again.')
      const result = dispatch(
        org.state,
        {
          type: 'cancel',
          appointmentId,
          reason: 'Cancelled online by the guest',
          ...(terms.outcome === 'none' ? {} : { deposit: terms.outcome }),
        },
        'Guest (private link)',
        new Date(now()).toISOString(),
      )
      if (!result.ok) fail(422, result.error)
      persist(org, result.state, null, 'guest.cancel', appointmentId)
      return guestView(
        result.state,
        appointmentId,
        now(),
        guestPaymentFor(ctx, { ...org, state: result.state }, appointmentId),
      )
    })
    reply(200, view)
    return true
  }
  return false
}
