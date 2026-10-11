import { z } from 'zod'
import type { IncomingMessage } from 'node:http'
import { digest, equalToken } from './auth'
import { HttpError, fail, header } from './http'
import type { Context, Org, Route } from './context'
import { moveOnline } from './routes/guest'
import type { MoveRefusal } from './routes/guest'
import { dispatch, slots } from '../src/domain/commands'
import { businessDate, businessMinutes, instantFor, operations } from '../src/domain/operations'
import {
  GUEST_CANCEL_CUTOFF_HOURS,
  guestCancellation,
  guestMoveBlock,
  visitStart,
} from '../src/domain/guest'
import { onlinePatchTestStop } from '../src/domain/patchTests'
import {
  availabilityFeed,
  bookableOnGoogle,
  merchantFeed,
  offeredOnGoogle,
  serviceFeed,
} from '../src/domain/googleFeeds'
import type { FeedStudio } from '../src/domain/googleFeeds'
import type { Appointment, BusinessState } from '../src/domain/model'

/**
 * V4: Book with Google. SALEANE's side of Google's Actions Center booking server (API v3), so a
 * guest can book a studio's treatments inside Google Search and Maps. Off unless the server is
 * started with SALEANE_GOOGLE_BOOKING=test and partner credentials. Nothing here contacts Google:
 * Google calls in, and only after SALEANE is accepted as a partner. Bookings take the same path as
 * the studio's own booking page, so they appear in the diary and get the usual confirmation.
 * Stage 5: the guest can also move a Google booking to another free time, under the same rules
 * and through the same change as a move from their own visit link.
 */

export type GoogleBookingOptions = { mode: 'off' | 'test'; username: string; password: string }

export function googleBookingFromEnv(env: NodeJS.ProcessEnv): GoogleBookingOptions {
  const mode = env.SALEANE_GOOGLE_BOOKING ?? 'off'
  if (mode === 'off') return { mode: 'off', username: '', password: '' }
  if (mode !== 'test')
    throw new Error(`Unknown Book with Google mode "${mode}". Use "off" or "test".`)
  const username = env.GOOGLE_BOOKING_USERNAME ?? ''
  const password = env.GOOGLE_BOOKING_PASSWORD ?? ''
  if (username.length < 8 || password.length < 16)
    throw new Error(
      'Book with Google needs GOOGLE_BOOKING_USERNAME and a long GOOGLE_BOOKING_PASSWORD.',
    )
  return { mode, username, password }
}

const resources = z
  .object({ staff_id: z.string().max(150).optional() })
  .passthrough()
  .optional()
const slotSchema = z
  .object({
    merchant_id: z.string().min(1).max(150),
    service_id: z.string().min(1).max(150),
    start_sec: z.coerce.number().int(),
    duration_sec: z.coerce.number().int(),
    resources,
  })
  .passthrough()
type Slot = z.infer<typeof slotSchema>
/**
 * A new time for a booking. Google sends only what changes, the start and the length (as in its
 * UpdateBooking sample); the studio and treatment are the booking's own unless it says otherwise.
 */
const newSlotSchema = slotSchema.partial({ merchant_id: true, service_id: true })
const userSchema = z
  .object({
    user_id: z.string().min(1).max(200),
    given_name: z.string().max(100).optional(),
    family_name: z.string().max(100).optional(),
    telephone: z.string().max(40).optional(),
    email: z.string().max(200).optional(),
  })
  .passthrough()

type Failure =
  | 'SLOT_UNAVAILABLE'
  | 'BOOKING_ALREADY_CANCELLED'
  | 'OUTSIDE_CANCELLATION_WINDOW'
  | 'BOOKING_NOT_CANCELLABLE'
  | 'UNSUPPORTED_NAME'
  | 'UNSUPPORTED_PHONE_NUMBER'
  | 'CAUSE_UNSPECIFIED'
class BookingFailure extends Error {
  constructor(
    readonly cause: Failure,
    message: string,
  ) {
    super(message)
  }
}

const statusOf = (status: Appointment['status']) =>
  status === 'cancelled' ? 'CANCELED' : status === 'no_show' ? 'NO_SHOW' : 'CONFIRMED'

/**
 * Stage 5: a repeated UpdateBooking for the time Google last moved a visit to finds that move and
 * changes nothing, even if the studio has moved the visit since. After this long the same request
 * is a new move, so a guest can go back to a time once the desk has moved them off it.
 */
const GOOGLE_RETRY_MS = 15 * 60000
/**
 * The event a move through Google is recorded as. Google sends no key with UpdateBooking, so it
 * is derived from the booking, the move before it and the time asked for: the same request again
 * finds it, and a later move to the same time does not.
 */
const googleMoveId = (bookingId: string, previous: string, slot: Slot) =>
  `google-move-${digest(
    `${bookingId}:${previous}:${slot.start_sec}:${slot.duration_sec}:${slot.resources?.staff_id ?? ''}`,
  ).slice(0, 32)}`
/** How a move that was not made reads to Google. */
const moveFailure = (refusal: MoveRefusal) => {
  switch (refusal.reason) {
    case 'closed':
      return new BookingFailure(
        'OUTSIDE_CANCELLATION_WINDOW',
        'This visit has started, so it can no longer be moved online.',
      )
    case 'cutoff':
      return new BookingFailure(
        'OUTSIDE_CANCELLATION_WINDOW',
        `It is less than ${GUEST_CANCEL_CUTOFF_HOURS} hours until this visit, so it can no longer be moved online.`,
      )
    // Stage 5: a visit booked at a quiet-time price was for that time only.
    case 'offer':
      return new BookingFailure(
        'BOOKING_NOT_CANCELLABLE',
        'This visit was booked at a lower price for that time only, so it can no longer be moved online.',
      )
    case 'off':
      return new BookingFailure(
        'BOOKING_NOT_CANCELLABLE',
        'The studio is not taking changes online at the moment.',
      )
    case 'day':
      return new BookingFailure(
        'SLOT_UNAVAILABLE',
        'The studio is closed that day, or it is too far ahead.',
      )
    case 'passed':
      return new BookingFailure('SLOT_UNAVAILABLE', 'That time has passed.')
    case 'taken':
      return new BookingFailure('SLOT_UNAVAILABLE', 'That time is no longer free.')
    default:
      return new BookingFailure('SLOT_UNAVAILABLE', refusal.message)
  }
}

type Row = {
  booking_id: string
  organisation_id: string
  user_id: string
  idempotency_token: string
  slot: string
  user_information: string
}

export function googleBooking(options: GoogleBookingOptions) {
  /**
   * The studio a slot names, when it is offered on Google; otherwise the time is not available.
   * A studio locked for an unpaid bill takes no new bookings, as its booking page takes none.
   */
  const studio = (ctx: Context, merchantId: string) => {
    const org = ctx.systemOrg(merchantId)
    if (!org || !offeredOnGoogle(org.state) || ctx.plans.locked(org.id))
      throw new BookingFailure('SLOT_UNAVAILABLE', 'This studio does not take bookings on Google.')
    return org
  }
  /**
   * The studio's treatment, professional, date and start for a slot Google sends. For a new time
   * on a visit already booked, `booked` is the visit's own treatment and length, which stay.
   */
  const visitFor = (
    state: BusinessState,
    slot: Slot,
    booked?: { serviceId: string; durationMinutes: number },
  ) => {
    const service = booked
      ? state.services.find((x) => x.id === booked.serviceId && x.id === slot.service_id)
      : bookableOnGoogle(state).find((x) => x.id === slot.service_id)
    const minutes = booked ? booked.durationMinutes : service?.durationMinutes
    if (!service || minutes! * 60 !== slot.duration_sec)
      throw new BookingFailure(
        'SLOT_UNAVAILABLE',
        booked
          ? 'A new time keeps the treatment and its length.'
          : 'This treatment or its length has changed.',
      )
    const iso = new Date(slot.start_sec * 1000).toISOString()
    const date = businessDate(state, iso)
    const startMinutes = businessMinutes(state, iso)
    const exact = (() => {
      try {
        return instantFor(state, date, startMinutes) === iso
      } catch {
        return false
      }
    })()
    if (!exact) throw new BookingFailure('SLOT_UNAVAILABLE', 'This start time is not offered.')
    const staffId = slot.resources?.staff_id || 'any'
    if (
      staffId !== 'any' &&
      !state.staff.some((p) => p.id === staffId && !p.archived && p.serviceIds.includes(service.id))
    )
      throw new BookingFailure('SLOT_UNAVAILABLE', 'This professional does not offer it.')
    return { serviceId: service.id, staffId, date, startMinutes }
  }
  /**
   * The booking as Google reads it: always the visit's time now, with whoever it is with now, so
   * a move at the desk or from the guest's own link shows on Google too. Anything else Google
   * sent with the slot is handed back as it came.
   */
  const slotNow = (row: Row, state: BusinessState, visit: Appointment) => {
    const stored = JSON.parse(row.slot) as Record<string, unknown>
    const resources =
      stored.resources && typeof stored.resources === 'object'
        ? (stored.resources as Record<string, unknown>)
        : undefined
    // A guest who chose a professional sees who the visit is with now; one who chose anyone
    // still sees no name.
    const named = resources?.staff_id
      ? {
          ...resources,
          staff_id: visit.staffId,
          ...('staff_name' in resources
            ? { staff_name: state.staff.find((p) => p.id === visit.staffId)?.name ?? '' }
            : {}),
        }
      : resources
    return {
      ...stored,
      merchant_id: row.organisation_id,
      service_id: visit.serviceId,
      start_sec: Math.floor(visitStart(state, visit.id) / 1000),
      duration_sec: visit.bookedDurationMinutes * 60,
      ...(named ? { resources: named } : {}),
    }
  }
  const bookingView = (row: Row, state: BusinessState, visit: Appointment) => ({
    booking_id: row.booking_id,
    slot: slotNow(row, state, visit),
    user_information: JSON.parse(row.user_information) as unknown,
    status: statusOf(visit.status),
  })
  /** A Google booking's row, studio and visit, or a refusal Google understands. */
  const bookingFor = (ctx: Context, bookingId: string) => {
    const row = ctx.db.get<Row>('SELECT * FROM google_bookings WHERE booking_id=?', bookingId)
    if (!row) fail(404, 'This booking was not made through Google.')
    const org = ctx.systemOrg(row!.organisation_id)
    const visit = org?.state.appointments.find((a) => a.id === row!.booking_id)
    if (!org || !visit) throw new BookingFailure('BOOKING_NOT_CANCELLABLE', 'Not found.')
    return { row: row!, org, visit }
  }

  /** Whether a start time Google asks about is free for this studio now, holds included. */
  const isFree = (ctx: Context, slot: Slot) => {
    try {
      const org = studio(ctx, slot.merchant_id)
      const visit = visitFor(org.state, slot)
      const at = new Date(ctx.now()).toISOString()
      return slots(ctx.withHolds(org), visit.serviceId, visit.staffId, visit.date, at).includes(
        visit.startMinutes,
      )
    } catch (error) {
      if (error instanceof BookingFailure) return false
      throw error
    }
  }

  /**
   * Stage 5: the guest moves their Google booking to a new time. The same treatment and length,
   * the guest's own move rules, the studio's patch test rule and a time free for desk bookings and
   * online holds, then the desk's own `reschedule`, recorded as "Book with Google". Must run inside
   * the caller's transaction.
   */
  const move = (ctx: Context, row: Row, org: Org, visit: Appointment, asked: Slot) => {
    if (visit.status === 'cancelled')
      throw new BookingFailure('BOOKING_ALREADY_CANCELLED', 'This visit was cancelled.')
    if (visit.status !== 'confirmed')
      throw new BookingFailure(
        'BOOKING_NOT_CANCELLABLE',
        'This visit can no longer be changed online.',
      )
    // A repeated request finds the move it already made and changes nothing.
    const moves = org.state.events.filter(
      (e) => e.appointmentId === visit.id && e.id.startsWith('google-move-'),
    )
    const last = moves.at(-1)
    if (
      last &&
      last.id === googleMoveId(row.booking_id, moves.at(-2)?.id ?? 'first', asked) &&
      ctx.now() - Date.parse(last.occurredAt) < GOOGLE_RETRY_MS
    )
      return { booking: bookingView(row, org.state, visit) }
    const blocked = guestMoveBlock(org.state, visit.id, ctx.now())
    if (blocked) throw moveFailure({ reason: blocked })
    if (asked.merchant_id !== row.organisation_id)
      throw new BookingFailure('SLOT_UNAVAILABLE', 'A new time keeps the same studio.')
    const target = visitFor(org.state, asked, {
      serviceId: visit.serviceId,
      durationMinutes: visit.bookedDurationMinutes,
    })
    // A professional Google names; otherwise the visit's own, or anyone who does the treatment
    // when the guest booked with anyone.
    const stored = JSON.parse(row.slot) as Slot
    const staffIds =
      target.staffId !== 'any'
        ? [target.staffId]
        : stored.resources?.staff_id
          ? [visit.staffId]
          : [
              visit.staffId,
              ...org.state.staff
                .filter(
                  (p) =>
                    p.id !== visit.staffId && !p.archived && p.serviceIds.includes(visit.serviceId),
                )
                .map((p) => p.id),
            ]
    const result = moveOnline(ctx, org, visit.id, {
      date: target.date,
      startMinutes: target.startMinutes,
      staffIds,
      actor: 'Book with Google',
      action: 'google.move',
      eventId: googleMoveId(row.booking_id, last?.id ?? 'first', asked),
    })
    if (!result.ok) throw moveFailure(result.refusal)
    const moved = result.state.appointments.find((a) => a.id === visit.id)!
    // The stored slot follows the visit, with the professional Google named, if any.
    const kept = {
      ...stored,
      ...(asked.resources ? { resources: { ...stored.resources, ...asked.resources } } : {}),
    }
    const slot = slotNow({ ...row, slot: JSON.stringify(kept) }, result.state, moved)
    ctx.db.run(
      'UPDATE google_bookings SET slot=? WHERE booking_id=?',
      JSON.stringify(slot),
      row.booking_id,
    )
    return { booking: bookingView({ ...row, slot: JSON.stringify(slot) }, result.state, moved) }
  }

  const methods: Record<string, (ctx: Context, body: unknown) => unknown> = {
    CheckAvailability(ctx, body) {
      const { slot } = z.object({ slot: slotSchema }).passthrough().parse(body)
      return { slot, count_available: isFree(ctx, slot) ? 1 : 0 }
    },
    // The availability call Google uses for new integrations: several start times at once, as
    // the guest opens the booking sheet and again when they pick a time.
    BatchAvailabilityLookup(ctx, body) {
      const input = z
        .object({
          merchant_id: z.string().min(1).max(150),
          slot_time: z
            .array(
              z
                .object({
                  service_id: z.string().min(1).max(150),
                  start_sec: z.coerce.number().int(),
                  duration_sec: z.coerce.number().int(),
                  resource_ids: resources,
                })
                .passthrough(),
            )
            .max(500),
        })
        .passthrough()
        .parse(body)
      return {
        slot_time_availability: input.slot_time.map((slot_time) => ({
          slot_time,
          available: isFree(ctx, {
            merchant_id: input.merchant_id,
            service_id: slot_time.service_id,
            start_sec: slot_time.start_sec,
            duration_sec: slot_time.duration_sec,
            resources: slot_time.resource_ids,
          }),
        })),
      }
    },
    CreateBooking(ctx, body) {
      const input = z
        .object({
          slot: slotSchema,
          user_information: userSchema,
          idempotency_token: z.string().min(1).max(200),
        })
        .passthrough()
        .parse(body)
      return ctx.db.transaction(() => {
        const org = studio(ctx, input.slot.merchant_id)
        const earlier = ctx.db.get<Row>(
          'SELECT * FROM google_bookings WHERE organisation_id=? AND idempotency_token=?',
          org.id,
          input.idempotency_token,
        )
        if (earlier) {
          const visit = org.state.appointments.find((a) => a.id === earlier.booking_id)
          if (!visit) throw new BookingFailure('CAUSE_UNSPECIFIED', 'This booking was not found.')
          return { booking: bookingView(earlier, org.state, visit) }
        }
        // Stage 3: the same rule as the studio's booking page, with its own words in the answer.
        const patchStop = onlinePatchTestStop(org.state, input.slot.service_id)
        if (patchStop) throw new BookingFailure('SLOT_UNAVAILABLE', patchStop)
        const visit = visitFor(org.state, input.slot)
        const user = input.user_information
        const name = [user.given_name, user.family_name].filter(Boolean).join(' ').trim()
        if (name.length < 2) throw new BookingFailure('UNSUPPORTED_NAME', 'A name is needed.')
        const phone = (user.telephone ?? '').replace(/[\s().-]/g, '')
        if (!/^\+[1-9]\d{6,14}$/.test(phone))
          throw new BookingFailure(
            'UNSUPPORTED_PHONE_NUMBER',
            'A phone number with its country code is needed.',
          )
        if (!z.email().safeParse(user.email ?? '').success)
          throw new BookingFailure('CAUSE_UNSPECIFIED', 'An email address is needed.')
        let allocation: { staffId: string; resourceId: string }
        try {
          allocation = ctx.chooseStaff(ctx.withHolds(org), visit)!
        } catch (error) {
          if (error instanceof HttpError)
            throw new BookingFailure('SLOT_UNAVAILABLE', 'That time was just taken.')
          throw error
        }
        const result = dispatch(
          org.state,
          {
            type: 'book',
            input: {
              serviceId: visit.serviceId,
              staffId: allocation.staffId,
              resourceId: allocation.resourceId,
              date: visit.date,
              startMinutes: visit.startMinutes,
              contact: { name, email: user.email!, phone, marketingConsent: false },
              source: 'online',
              channel: 'google',
            },
          },
          'Book with Google',
          new Date(ctx.now()).toISOString(),
        )
        if (!result.ok) throw new BookingFailure('SLOT_UNAVAILABLE', result.error)
        ctx.persist(org, result.state, null, 'google.book', result.recordId)
        const row: Row = {
          booking_id: result.recordId,
          organisation_id: org.id,
          user_id: user.user_id,
          idempotency_token: input.idempotency_token,
          slot: JSON.stringify(input.slot),
          user_information: JSON.stringify(user),
        }
        ctx.db.run(
          'INSERT INTO google_bookings(booking_id,organisation_id,user_id,idempotency_token,slot,user_information,created_at) VALUES(?,?,?,?,?,?,?)',
          row.booking_id,
          row.organisation_id,
          row.user_id,
          row.idempotency_token,
          row.slot,
          row.user_information,
          ctx.now(),
        )
        const booked = result.state.appointments.find((a) => a.id === result.recordId)!
        return { booking: bookingView(row, result.state, booked) }
      })
    },
    UpdateBooking(ctx, body) {
      const { booking } = z
        .object({
          booking: z
            .object({
              booking_id: z.string().min(1).max(150),
              status: z.string().max(40).optional(),
              slot: newSlotSchema.optional(),
            })
            .passthrough(),
        })
        .passthrough()
        .parse(body)
      return ctx.db.transaction(() => {
        const { row, org, visit } = bookingFor(ctx, booking.booking_id)
        // Stage 5: a new time moves the visit; Google sends it without a status, or as confirmed.
        if (booking.status !== 'CANCELED') {
          if (!booking.slot || (booking.status && booking.status !== 'CONFIRMED'))
            throw new BookingFailure(
              'BOOKING_NOT_CANCELLABLE',
              'Only cancelling or moving to a new time is supported.',
            )
          const stored = JSON.parse(row.slot) as Slot
          return move(ctx, row, org, visit, {
            ...booking.slot,
            merchant_id: booking.slot.merchant_id ?? row.organisation_id,
            service_id: booking.slot.service_id ?? stored.service_id,
          })
        }
        if (visit.status === 'cancelled')
          throw new BookingFailure('BOOKING_ALREADY_CANCELLED', 'Already cancelled.')
        const terms = guestCancellation(org.state, visit.id, ctx.now())
        if (!terms.available)
          throw new BookingFailure(
            'OUTSIDE_CANCELLATION_WINDOW',
            'This visit can no longer be cancelled online.',
          )
        const result = dispatch(
          org.state,
          {
            type: 'cancel',
            appointmentId: visit.id,
            reason: 'Cancelled by the guest on Google',
            ...(terms.outcome === 'none' ? {} : { deposit: terms.outcome }),
          },
          'Book with Google',
          new Date(ctx.now()).toISOString(),
        )
        if (!result.ok) throw new BookingFailure('BOOKING_NOT_CANCELLABLE', result.error)
        ctx.persist(org, result.state, null, 'google.cancel', visit.id)
        const cancelled = result.state.appointments.find((a) => a.id === visit.id)!
        return { booking: bookingView(row, result.state, cancelled) }
      })
    },
    GetBookingStatus(ctx, body) {
      const { booking_id } = z
        .object({ booking_id: z.string().min(1).max(150) })
        .passthrough()
        .parse(body)
      const row = ctx.db.get<Row>('SELECT * FROM google_bookings WHERE booking_id=?', booking_id)
      const visit =
        row &&
        ctx.systemOrg(row.organisation_id)?.state.appointments.find((a) => a.id === booking_id)
      if (!row || !visit) fail(404, 'This booking was not made through Google.')
      return {
        booking_id,
        booking_status: statusOf(visit!.status),
        prepayment_status: 'PREPAYMENT_NOT_PROVIDED',
      }
    },
    ListBookings(ctx, body) {
      const { user_id } = z
        .object({ user_id: z.string().min(1).max(200) })
        .passthrough()
        .parse(body)
      const rows = ctx.db.all<Row>(
        'SELECT * FROM google_bookings WHERE user_id=? ORDER BY created_at',
        user_id,
      )
      return {
        bookings: rows.flatMap((row) => {
          const org = ctx.systemOrg(row.organisation_id)
          const visit = org?.state.appointments.find((a) => a.id === row.booking_id)
          // Only visits still to come, at the time they have now: Google shows the guest their
          // upcoming bookings.
          return visit &&
            visit.status === 'confirmed' &&
            visitStart(org!.state, visit.id) > ctx.now()
            ? [bookingView(row, org!.state, visit)]
            : []
        }),
      }
    },
  }

  /** Google's calls, proved by the partner credentials rather than a session or origin. */
  async function partner(
    ctx: Context,
    request: IncomingMessage,
    method: string,
    pathname: string,
    readJson: () => Promise<unknown>,
    reply: (status: number, body: unknown) => void,
  ) {
    const match = /^\/api\/partners\/google\/v3\/([A-Za-z]+)$/.exec(pathname)
    if (!match) return false
    if (options.mode === 'off') fail(404, 'This endpoint was not found.')
    // Test mode answers only on this computer, so Google's sandbox can never book into a real
    // studio's diary. Google's sandbox needs its own mode with practice studios, built at onboarding.
    if (
      options.mode === 'test' &&
      !['127.0.0.1', 'localhost', '[::1]'].includes(ctx.origin.hostname)
    )
      fail(503, 'Book with Google test mode only answers on this computer.')
    const auth = header(request, 'authorization') ?? ''
    const [user, ...rest] = auth.startsWith('Basic ')
      ? Buffer.from(auth.slice(6), 'base64').toString('utf8').split(':')
      : ['']
    if (!equalToken(user, options.username) || !equalToken(rest.join(':'), options.password))
      fail(401, 'These partner credentials are not valid.')
    if (match[1] === 'HealthCheck') {
      if (method !== 'GET') fail(405, 'Use GET.')
      reply(200, {})
      return true
    }
    const handle = methods[match[1]]
    if (!handle) fail(404, 'This method is not supported.')
    if (method !== 'POST') fail(405, 'Use POST.')
    const body = await readJson()
    try {
      reply(200, handle(ctx, body))
    } catch (error) {
      if (!(error instanceof BookingFailure)) throw error
      reply(200, { booking_failure: { cause: error.cause, description: error.message } })
    }
    return true
  }

  /** The owner's view: whether the server can take Google's calls, and the feeds Google would read. */
  async function manage(ctx: Context, route: Route): Promise<boolean> {
    const { request, method, path, reply } = route
    if (path[1] !== 'workspaces' || path[3] !== 'google') return false
    const actor = ctx.actorFor(request, method !== 'GET')
    const org = ctx.orgFor(path[2], actor)
    if (org.role !== 'owner') fail(403, 'Only the owner can see what Google would receive.')
    if (method !== 'GET') fail(405, 'Use GET.')
    const time = ctx.now()
    const studio: FeedStudio = { id: org.id, slug: org.slug, state: ctx.withHolds(org) }
    const offered = offeredOnGoogle(org.state)
    if (path.length === 4) {
      const bookings = ctx.db.get<{ n: number }>(
        'SELECT COUNT(*) AS n FROM google_bookings WHERE organisation_id=?',
        org.id,
      )!.n
      reply(200, {
        mode: options.mode,
        offered,
        sample: operations(org.state).mode === 'sandbox',
        bookings,
      })
      return true
    }
    const feed = path[4]
    const studios = offered ? [studio] : []
    if (feed === 'merchants' && path.length === 5)
      reply(200, merchantFeed(studios, ctx.allowedOrigin, time))
    else if (feed === 'services' && path.length === 5) reply(200, serviceFeed(studios, time))
    else if (feed === 'availability' && path.length === 5)
      reply(200, availabilityFeed(studios, new Date(time).toISOString(), time))
    else fail(404, 'This endpoint was not found.')
    return true
  }

  return { partner, manage }
}
