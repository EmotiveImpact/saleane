import { z } from 'zod'
import { digest, token } from '../auth'
import { fail } from '../http'
import { dispatch, rescheduleResource } from '../../src/domain/commands'
import { parseState } from '../../src/domain/model'
import type { BusinessState } from '../../src/domain/model'
import {
  GUEST_CANCEL_CUTOFF_HOURS,
  GUEST_LINK_AFTER_VISIT_MS,
  GUEST_LINK_MAX_MS,
  depositOutcomes,
  guestCancellation,
  guestMoveBlock,
  guestView,
  visitStart,
} from '../../src/domain/guest'
import { guestMoveDays, guestMoveTimes, timeAhead } from '../../src/domain/guestMove'
import { onlinePatchTestStop, patchTestFirst } from '../../src/domain/patchTests'
import { instantFor } from '../../src/domain/operations'
import type { Context, Org, Route } from '../context'
import { feedbackForVisit, feedbackInputSchema, feedbackOpen } from '../../src/domain/feedback'
import { waitlistTimesSchema } from '../../src/domain/waitlistSchema'
import { formAnswersSchema } from '../../src/domain/formsSchema'
import { guestPaymentFor } from '../payments/service'

const INVALID = 'This link has expired or been replaced. Ask the studio for a new one.'
export const tokenSchema = z.string().min(32).max(100)
/** An email and a text each for the latest two messages. */
const MESSAGE_LINKS = 4
/** The paths this module answers under /api/guest. */
const GUEST_PATHS = new Set([
  'visit',
  'feedback',
  'form',
  'email-news',
  'here',
  'waitlist',
  'cancel',
  'move-times',
  'move',
])
/** Who a guest's own change is recorded as, on the visit's history. */
const GUEST_ACTOR = 'Guest (private link)'
/** Why a visit cannot move online, as the guest reads it. */
const MOVE_REFUSALS = {
  closed: 'This visit can no longer be moved online. Contact the studio.',
  offer:
    'This visit was booked at a quiet-time price for that time only, so it cannot be moved online. Contact the studio to change it.',
  off: 'The studio is not taking changes online at the moment. Contact the studio to move your visit.',
  cutoff: `It is less than ${GUEST_CANCEL_CUTOFF_HOURS} hours until your visit, so it can no longer be moved online. Contact the studio to change it.`,
} as const

/**
 * The private link's token from a request body. A missing or malformed one is refused exactly
 * like an expired or replaced link, so a mistyped or truncated link reads the same as any other.
 */
function linkToken(body: unknown) {
  const parsed = z.object({ token: tokenSchema }).safeParse(body)
  if (!parsed.success) fail(404, INVALID)
  return parsed.data!.token
}

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
  const link = db.get<{
    organisation_id: string
    appointment_id: string
    created_at: number
    expires_at: number
  }>(
    'SELECT organisation_id,appointment_id,created_at,expires_at FROM guest_links WHERE token_hash=? AND revoked_at IS NULL',
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
  const org: Org = {
    id: row!.id,
    slug: row!.slug,
    state,
    role: 'owner',
    staffId: null,
    areaId: null,
    locationId: null,
  }
  return {
    org,
    appointmentId: link!.appointment_id,
    /** The latest this link can open, whatever happens to the visit. */
    linkEnds: link!.created_at + GUEST_LINK_MAX_MS,
  }
}

/**
 * After a visit moves, its open links follow it under issueGuestLink's rule: each stops opening
 * GUEST_LINK_AFTER_VISIT_MS after the new start, and never later than GUEST_LINK_MAX_MS after it
 * was issued. The link the guest used keeps working, and so do the ones in their messages. Must
 * run inside the caller's transaction.
 */
export function followGuestLinks(ctx: Context, org: Org, appointmentId: string) {
  const { db, now } = ctx
  db.run(
    'UPDATE guest_links SET expires_at=MIN(created_at+?,?) WHERE organisation_id=? AND appointment_id=? AND revoked_at IS NULL AND expires_at>?',
    GUEST_LINK_MAX_MS,
    visitStart(org.state, appointmentId) + GUEST_LINK_AFTER_VISIT_MS,
    org.id,
    appointmentId,
    now(),
  )
}

/**
 * The event a guest's move is recorded as. Derived from the visit and the page's request key, so a
 * repeated request finds the move it already made instead of moving the visit again.
 */
const moveEventId = (appointmentId: string, requestKey: string) =>
  `guest-move-${digest(`${appointmentId}:${requestKey}`).slice(0, 32)}`

/** Guest manage routes. A link opens one visit and nothing else. Returns false for other paths. */
export async function guestRoutes(ctx: Context, route: Route): Promise<boolean> {
  const { db, now, rateLimit, persist, withHolds } = ctx
  const { request, method, path, body, reply } = route
  if (path[1] !== 'guest' || path.length !== 3 || method !== 'POST') return false
  if (!GUEST_PATHS.has(path[2])) return false
  // Checked before the rest of the request, so a broken link never reads as a form error.
  linkToken(body)

  const open = (raw: string) => openGuestLink(ctx, raw)
  /** The guest's view of their visit, with the studio's booking page for booking again. */
  const viewOf = (org: Org, state: BusinessState, appointmentId: string, payment = true) =>
    guestView(
      state,
      appointmentId,
      now(),
      payment ? guestPaymentFor(ctx, { ...org, state }, appointmentId) : undefined,
      { slug: org.slug },
    )

  if (path[2] === 'visit') {
    rateLimit(request, 'guest-read', 30, 5 * 60000)
    const data = z.object({ token: tokenSchema }).strict().parse(body)
    const { org, appointmentId } = open(data.token)
    reply(200, viewOf(org, org.state, appointmentId))
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
      return viewOf(org, result.state, appointmentId, false)
    })
    reply(200, view)
    return true
  }
  if (path[2] === 'form') {
    rateLimit(request, 'guest-write', 10, 5 * 60000)
    const data = z
      .object({ token: tokenSchema })
      .extend(formAnswersSchema.shape)
      .strict()
      .parse(body)
    const view = db.transaction(() => {
      const { org, appointmentId } = open(data.token)
      const result = dispatch(
        org.state,
        {
          type: 'form-submit',
          appointmentId,
          formId: data.formId,
          version: data.version,
          answers: data.answers,
          agreedName: data.agreedName,
        },
        'Guest (private link)',
        new Date(now()).toISOString(),
      )
      if (!result.ok) fail(409, result.error)
      if (result.state !== org.state) persist(org, result.state, null, 'guest.form', appointmentId)
      return viewOf(org, result.state, appointmentId)
    })
    reply(200, view)
    return true
  }
  if (path[2] === 'email-news') {
    rateLimit(request, 'guest-write', 10, 5 * 60000)
    const data = z.object({ token: tokenSchema }).strict().parse(body)
    const view = db.transaction(() => {
      const { org, appointmentId } = open(data.token)
      const result = dispatch(
        org.state,
        { type: 'guest-consent-stop', appointmentId },
        'Guest (private link)',
        new Date(now()).toISOString(),
      )
      if (!result.ok) fail(409, result.error)
      if (result.state !== org.state)
        persist(org, result.state, null, 'guest.email-news', appointmentId)
      return viewOf(org, result.state, appointmentId)
    })
    reply(200, view)
    return true
  }
  if (path[2] === 'here') {
    rateLimit(request, 'guest-write', 10, 5 * 60000)
    const data = z.object({ token: tokenSchema }).strict().parse(body)
    const view = db.transaction(() => {
      const { org, appointmentId } = open(data.token)
      const result = dispatch(
        org.state,
        { type: 'guest-here', appointmentId },
        'Guest (private link)',
        new Date(now()).toISOString(),
      )
      if (!result.ok) fail(409, result.error)
      if (result.state !== org.state) persist(org, result.state, null, 'guest.here', appointmentId)
      return viewOf(org, result.state, appointmentId)
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
      return viewOf(org, result.state, appointmentId)
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
      if (appointment.status === 'cancelled') return viewOf(org, org.state, appointmentId)
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
      return viewOf(org, result.state, appointmentId)
    })
    reply(200, view)
    return true
  }
  if (path[2] === 'move-times') {
    // Looking costs little; a guest may tap through many days.
    rateLimit(request, 'guest-move-read', 60, 5 * 60000)
    const data = z
      .object({
        token: tokenSchema,
        /** The day to show times for. Absent shows the visit's own day, or the first open one. */
        date: z.iso.date().optional(),
        /** True for anyone qualified, not only the visit's own professional. */
        anyone: z.boolean().optional(),
      })
      .strict()
      .parse(body)
    const { org, appointmentId, linkEnds } = open(data.token)
    const blocked = guestMoveBlock(org.state, appointmentId, now())
    if (blocked) fail(409, MOVE_REFUSALS[blocked])
    const visit = org.state.appointments.find((a) => a.id === appointmentId)!
    const days = guestMoveDays(org.state, appointmentId, now(), linkEnds)
    const day = data.date
      ? days.find((d) => d.date === data.date)
      : (days.find((d) => d.open && d.date === visit.date) ?? days.find((d) => d.open) ?? days[0])
    if (!day) fail(409, data.date ? 'Choose one of the days shown.' : MOVE_REFUSALS.closed)
    const anyone = data.anyone ?? false
    // Stage 3: with the studio's patch test rule on, only times the guest's clear test covers.
    const patchFirst = patchTestFirst(org.state, visit.serviceId)
    const covered = (startMinutes: number) => {
      try {
        const start = instantFor(org.state, day!.date, startMinutes)
        return !onlinePatchTestStop(org.state, visit.serviceId, { clientId: visit.clientId, start })
      } catch {
        return false
      }
    }
    reply(200, {
      days,
      date: day!.date,
      anyone,
      // Free for desk bookings and for guests holding a time on the booking page.
      times: day!.open
        ? guestMoveTimes(withHolds(org), appointmentId, day!.date, now(), anyone).filter((time) =>
            covered(time.startMinutes),
          )
        : [],
      ...(patchFirst ? { patchTest: true } : {}),
    })
    return true
  }
  if (path[2] === 'move') {
    rateLimit(request, 'guest-write', 10, 5 * 60000)
    const data = z
      .object({
        token: tokenSchema,
        date: z.iso.date(),
        startMinutes: z.number().int().min(0).max(1439),
        /** The professional for the new time. Absent keeps the visit's own. */
        staffId: z.string().min(1).max(150).optional(),
        /** Chosen by the page for this move and sent again unchanged when it retries. */
        requestKey: z.string().regex(/^[A-Za-z0-9-]{16,100}$/),
      })
      .strict()
      .parse(body)
    const view = db.transaction(() => {
      const { org, appointmentId, linkEnds } = open(data.token)
      const visit = org.state.appointments.find((a) => a.id === appointmentId)!
      // A repeated request finds the move it already made and changes nothing, even when the
      // studio has moved the visit again since.
      const eventId = moveEventId(appointmentId, data.requestKey)
      const made = org.state.events.find((e) => e.id === eventId)
      if (made) {
        const to = made.allocationChange?.to
        if (
          !to ||
          to.date !== data.date ||
          to.startMinutes !== data.startMinutes ||
          (data.staffId !== undefined && to.staffId !== data.staffId)
        )
          fail(409, 'This change was already made for another time. Reload to see your visit.')
        return viewOf(org, org.state, appointmentId)
      }
      const blocked = guestMoveBlock(org.state, appointmentId, now())
      if (blocked) fail(409, MOVE_REFUSALS[blocked])
      const staffId = data.staffId ?? visit.staffId
      // Asking for the time the visit already has changes nothing.
      if (
        visit.date === data.date &&
        visit.startMinutes === data.startMinutes &&
        visit.staffId === staffId
      )
        return viewOf(org, org.state, appointmentId)
      if (
        !guestMoveDays(org.state, appointmentId, now(), linkEnds).some(
          (d) => d.open && d.date === data.date,
        )
      )
        fail(409, 'Choose one of the open days shown.')
      if (!timeAhead(org.state, data.date, data.startMinutes, now()))
        fail(409, 'That time has passed. Choose another time.')
      // Stage 3: the studio's patch test rule, for the guest this private link belongs to.
      const patchStop = onlinePatchTestStop(org.state, visit.serviceId, {
        clientId: visit.clientId,
        start: instantFor(org.state, data.date, data.startMinutes),
      })
      if (patchStop) fail(422, patchStop)
      // Free for desk bookings and for guests holding a time on the booking page, in the exact
      // room the check found, with its resting time.
      const resourceId = rescheduleResource(
        withHolds(org),
        appointmentId,
        staffId,
        data.date,
        data.startMinutes,
        new Date(now()).toISOString(),
      )
      if (!resourceId) fail(409, 'That time is no longer free. Choose another time.')
      // The same change the desk makes, so the visit's history and the "new time" message to
      // the guest follow exactly as they do for a move at the desk.
      const result = dispatch(
        org.state,
        {
          type: 'reschedule',
          appointmentId,
          staffId,
          date: data.date,
          startMinutes: data.startMinutes,
          resourceId: resourceId!,
        },
        GUEST_ACTOR,
        new Date(now()).toISOString(),
      )
      if (!result.ok) fail(409, result.error)
      if (result.state === org.state) return viewOf(org, org.state, appointmentId)
      const known = new Set(org.state.events.map((e) => e.id))
      const event = result.state.events.find(
        (e) => !known.has(e.id) && e.type === 'rescheduled' && e.appointmentId === appointmentId,
      )
      if (event) event.id = eventId
      persist(org, result.state, null, 'guest.move', appointmentId)
      followGuestLinks(ctx, { ...org, state: result.state }, appointmentId)
      return viewOf(org, result.state, appointmentId)
    })
    reply(200, view)
    return true
  }
  return false
}
