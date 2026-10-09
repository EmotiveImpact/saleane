import { z } from 'zod'
import type { IncomingMessage } from 'node:http'
import { equalToken } from './auth'
import { HttpError, fail, header } from './http'
import type { Context, Route } from './context'
import { dispatch, slots } from '../src/domain/commands'
import { businessDate, businessMinutes, instantFor, operations } from '../src/domain/operations'
import { guestCancellation, visitStart } from '../src/domain/guest'
import {
  availabilityFeed,
  bookableOnGoogle,
  merchantFeed,
  offeredOnGoogle,
  serviceFeed,
} from '../src/domain/googleFeeds'
import type { FeedStudio } from '../src/domain/googleFeeds'
import type { BusinessState } from '../src/domain/model'

/**
 * V4: Book with Google. SALEANE's side of Google's Actions Center booking server (API v3), so a
 * guest can book a studio's treatments inside Google Search and Maps. Off unless the server is
 * started with SALEANE_GOOGLE_BOOKING=test and partner credentials. Nothing here contacts Google:
 * Google calls in, and only after SALEANE is accepted as a partner. Bookings take the same path as
 * the studio's own booking page, so they appear in the diary and get the usual confirmation.
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

const statusOf = (status: BusinessState['appointments'][number]['status']) =>
  status === 'cancelled' ? 'CANCELED' : status === 'no_show' ? 'NO_SHOW' : 'CONFIRMED'

type Row = {
  booking_id: string
  organisation_id: string
  user_id: string
  idempotency_token: string
  slot: string
  user_information: string
}

export function googleBooking(options: GoogleBookingOptions) {
  /** The studio a slot names, when it is offered on Google; otherwise the time is not available. */
  const studio = (ctx: Context, merchantId: string) => {
    const org = ctx.systemOrg(merchantId)
    if (!org || !offeredOnGoogle(org.state))
      throw new BookingFailure('SLOT_UNAVAILABLE', 'This studio does not take bookings on Google.')
    return org
  }
  /** The studio's treatment, professional, date and start for a slot Google sends. */
  const visitFor = (state: BusinessState, slot: Slot) => {
    const service = bookableOnGoogle(state).find((x) => x.id === slot.service_id)
    if (!service || service.durationMinutes * 60 !== slot.duration_sec)
      throw new BookingFailure('SLOT_UNAVAILABLE', 'This treatment or its length has changed.')
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
  const bookingView = (row: Row, status: string) => ({
    booking_id: row.booking_id,
    slot: JSON.parse(row.slot) as unknown,
    user_information: JSON.parse(row.user_information) as unknown,
    status,
  })

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
          return { booking: bookingView(earlier, visit ? statusOf(visit.status) : 'CONFIRMED') }
        }
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
        return { booking: bookingView(row, 'CONFIRMED') }
      })
    },
    UpdateBooking(ctx, body) {
      const { booking } = z
        .object({
          booking: z
            .object({ booking_id: z.string().min(1).max(150), status: z.string().max(40) })
            .passthrough(),
        })
        .passthrough()
        .parse(body)
      return ctx.db.transaction(() => {
        const row = ctx.db.get<Row>(
          'SELECT * FROM google_bookings WHERE booking_id=?',
          booking.booking_id,
        )
        if (!row) fail(404, 'This booking was not made through Google.')
        // Google can only cancel here; a new time is a new booking.
        if (booking.status !== 'CANCELED')
          throw new BookingFailure(
            'BOOKING_NOT_CANCELLABLE',
            'Only cancelling is supported. Book a new time instead.',
          )
        const org = ctx.systemOrg(row!.organisation_id)
        const visit = org?.state.appointments.find((a) => a.id === row!.booking_id)
        if (!org || !visit) throw new BookingFailure('BOOKING_NOT_CANCELLABLE', 'Not found.')
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
        return { booking: bookingView(row!, 'CANCELED') }
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
          // Only visits still to come: Google shows the guest their upcoming bookings.
          return visit &&
            visit.status === 'confirmed' &&
            visitStart(org!.state, visit.id) > ctx.now()
            ? [bookingView(row, statusOf(visit.status))]
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
