// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApiHandler } from './app'
import type { ApiHandler } from './app'
import type { BusinessState } from '../src/domain/model'
import type { Command } from '../src/domain/commands'

// V4: Book with Google. SALEANE's side of Google's Actions Center booking server, in test mode.
const origin = 'http://127.0.0.1:5173'
const partner = {
  mode: 'test' as const,
  username: 'google-partner',
  password: 'a-long-test-password-2026',
}
type Login = { cookie: string; csrf: string; orgId: string }
type Entry = {
  merchant_id: string
  service_id: string
  start_sec: number
  duration_sec: number
  resources: { staff_id: string; staff_name: string }
}
let api: ApiHandler
let clock: number
const make = (google = true) => {
  clock = Date.parse('2026-10-06T07:00:00.000Z')
  api = createApiHandler({
    origin,
    databasePath: ':memory:',
    now: () => clock,
    turnstile: null,
    ...(google ? { googleBooking: partner } : {}),
  })
}
beforeEach(() => make())
afterEach(() => api.close())

const headers = (login: Login) => ({ cookie: login.cookie, 'x-csrf-token': login.csrf })
const workspace = async (login: Login) =>
  (await api.inject({ url: `/api/workspaces/${login.orgId}`, headers: headers(login) })).json<{
    slug: string
    state: BusinessState
  }>()
async function run(login: Login, command: Command) {
  const { state } = await workspace(login)
  return api.inject({
    method: 'POST',
    url: `/api/workspaces/${login.orgId}/commands`,
    headers: { ...headers(login), 'idempotency-key': crypto.randomUUID() },
    payload: { revision: state.revision, command },
  })
}
async function ok(login: Login, command: Command) {
  const response = await run(login, command)
  expect(response.statusCode, response.body).toBe(200)
  return response.json<{ recordId: string }>().recordId
}
async function register(sample = false): Promise<Login> {
  const response = await api.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: {
      name: 'Ada Owner',
      email: 'owner@example.invalid',
      password: 'Fictional local account 2026!',
      workspace: { name: 'Linden Studio', locationName: 'London', region: 'UK', sample },
    },
  })
  expect(response.statusCode, response.body).toBe(201)
  return {
    ...response.json<{ csrf: string; orgId: string }>(),
    cookie: String(response.headers['set-cookie']).split(';')[0],
  }
}
let serviceId: string
async function studio(offered = true) {
  const login = await register()
  await ok(login, { type: 'resource', input: { name: 'Room One', type: 'treatment' } })
  serviceId = await ok(login, {
    type: 'service',
    input: {
      name: 'Restorative facial',
      description: 'A fictional service',
      category: 'Skin',
      durationMinutes: 60,
      bufferMinutes: 15,
      priceMinor: 9500,
      depositMinor: 0,
      resourceType: 'treatment',
    },
  })
  await ok(login, {
    type: 'staff',
    input: { name: 'Maya Lind', role: 'Facialist', serviceIds: [serviceId], tone: 'sage' },
  })
  // A new studio takes online bookings once the owner switches them on.
  const { name, locationName, address, timeZone } = (await workspace(login)).state.organisation
  await ok(login, {
    type: 'organisation',
    name,
    locationName,
    address,
    timeZone,
    bookingEnabled: true,
  })
  if (offered) await ok(login, { type: 'google-booking', settings: { enabled: true } })
  return login
}
const basic = (user = partner.username, pass = partner.password) =>
  `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`
const call = (method: string, payload?: unknown, authorization = basic()) =>
  api.inject({
    method: payload === undefined ? 'GET' : 'POST',
    url: `/api/partners/google/v3/${method}`,
    headers: { authorization, 'content-type': 'application/json' },
    ...(payload === undefined ? {} : { rawPayload: JSON.stringify(payload) }),
  })
const feed = (login: Login, name: string) =>
  api.inject({ url: `/api/workspaces/${login.orgId}/google/${name}`, headers: headers(login) })
async function freeTimes(login: Login) {
  const response = await feed(login, 'availability')
  return response.json<{ service_availability: { availability: Entry[] }[] }>()
    .service_availability[0].availability
}
const slotOf = (e: Entry) => ({
  merchant_id: e.merchant_id,
  service_id: e.service_id,
  start_sec: e.start_sec,
  duration_sec: e.duration_sec,
  resources: { staff_id: e.resources.staff_id },
})
const guest = {
  user_id: 'google-user-1',
  given_name: 'Rosa',
  family_name: 'Field',
  telephone: '+44 7700 900456',
  email: 'rosa@example.invalid',
}
const book = (e: Entry, token = 'token-1', user: Record<string, string> = guest) =>
  call('CreateBooking', { slot: slotOf(e), user_information: user, idempotency_token: token })
const onDay = (entries: Entry[], date: string) =>
  entries.find((e) => new Date(e.start_sec * 1000).toISOString().startsWith(date))!

describe('Book with Google', () => {
  it('is off unless the server is started for it, and needs the partner credentials', async () => {
    api.close()
    make(false)
    expect((await call('HealthCheck')).statusCode).toBe(404)
    api.close()
    make()
    expect(
      (await call('HealthCheck', undefined, basic('google-partner', 'wrong'))).statusCode,
    ).toBe(401)
    expect((await call('HealthCheck', undefined, '')).statusCode).toBe(401)
    expect((await call('HealthCheck')).statusCode).toBe(200)
    // Test mode never answers from a public address, so it cannot book into a real diary.
    api.close()
    api = createApiHandler({
      origin: 'https://studio.example',
      databasePath: ':memory:',
      now: () => clock,
      turnstile: null,
      googleBooking: partner,
    })
    expect((await call('HealthCheck')).statusCode).toBe(503)
  })

  it('offers only studios whose owner chose it, and never a sample studio', async () => {
    const login = await studio(false)
    expect(await freeTimes(login)).toEqual([])
    const { state } = await workspace(login)
    const slot = {
      merchant_id: state.organisation.id,
      service_id: serviceId,
      start_sec: Date.parse('2026-10-08T09:00:00Z') / 1000,
      duration_sec: 3600,
    }
    expect((await call('CheckAvailability', { slot })).json()).toMatchObject({ count_available: 0 })
    expect(
      (
        await call('CreateBooking', { slot, user_information: guest, idempotency_token: 'x' })
      ).json(),
    ).toMatchObject({ booking_failure: { cause: 'SLOT_UNAVAILABLE' } })
    const sample = await api.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        name: 'Sam Sample',
        email: 'sample@example.invalid',
        password: 'Fictional local account 2026!',
        workspace: { name: 'Sample Studio', locationName: 'London', region: 'UK', sample: true },
      },
    })
    const sampleLogin = {
      ...sample.json<{ csrf: string; orgId: string }>(),
      cookie: String(sample.headers['set-cookie']).split(';')[0],
    }
    const refused = await run(sampleLogin, { type: 'google-booking', settings: { enabled: true } })
    expect(refused.statusCode).not.toBe(200)
  })

  it('builds the feeds from the studio record, for the owner only', async () => {
    const login = await studio()
    const services = (await feed(login, 'services')).json<{ service: Record<string, unknown>[] }>()
    expect(services.service).toEqual([
      expect.objectContaining({
        service_id: serviceId,
        localized_service_name: {
          value: 'Restorative facial',
          localized_value: [{ locale: 'en-GB', value: 'Restorative facial' }],
        },
        price: { price_micros: 95_000_000, currency_code: 'GBP' },
      }),
    ])
    const merchants = (await feed(login, 'merchants')).json<{ merchant: { url: string }[] }>()
    expect(merchants.merchant[0].url).toMatch(/\/book\/.+\?from=google$/)
    const times = await freeTimes(login)
    expect(times.length).toBeGreaterThan(20)
    expect(times[0]).toMatchObject({ service_id: serviceId, duration_sec: 3600, spots_open: 1 })
    const status = await api.inject({
      url: `/api/workspaces/${login.orgId}/google`,
      headers: headers(login),
    })
    expect(status.json()).toMatchObject({ mode: 'test', offered: true, bookings: 0 })
  })

  it('leaves treatments that need a deposit on the studio booking page', async () => {
    const login = await studio()
    const time = (await freeTimes(login))[0]
    await ok(login, {
      type: 'service',
      input: {
        name: 'Deposit facial',
        description: 'A fictional service with a deposit',
        category: 'Skin',
        durationMinutes: 60,
        bufferMinutes: 15,
        priceMinor: 12000,
        depositMinor: 3000,
        resourceType: 'treatment',
      },
    })
    const { state } = await workspace(login)
    const deposit = state.services.find((x) => x.name === 'Deposit facial')!
    const ines = await ok(login, {
      type: 'staff',
      input: {
        name: 'Ines Hart',
        role: 'Facialist',
        serviceIds: [serviceId, deposit.id],
        tone: 'blue',
      },
    })
    const names = (await feed(login, 'services')).json<{
      service: { localized_service_name: { value: string } }[]
    }>()
    expect(names.service.map((x) => x.localized_service_name.value)).toEqual(['Restorative facial'])
    expect((await freeTimes(login)).some((e) => e.service_id === deposit.id)).toBe(false)
    expect(
      (
        await book(
          {
            ...time,
            service_id: deposit.id,
            resources: { staff_id: ines, staff_name: 'Ines Hart' },
          },
          'token-deposit',
        )
      ).json(),
    ).toMatchObject({ booking_failure: { cause: 'SLOT_UNAVAILABLE' } })
    expect((await workspace(login)).state.appointments).toHaveLength(0)
  })

  it('books a free time once per request, into the diary, and refuses it to anyone else', async () => {
    const login = await studio()
    const time = onDay(await freeTimes(login), '2026-10-08')
    expect((await call('CheckAvailability', { slot: slotOf(time) })).json()).toMatchObject({
      count_available: 1,
    })
    const first = (await book(time)).json<{ booking: { booking_id: string; status: string } }>()
    expect(first.booking.status).toBe('CONFIRMED')
    const again = (await book(time)).json<{ booking: { booking_id: string } }>()
    expect(again.booking.booking_id).toBe(first.booking.booking_id)
    const { state } = await workspace(login)
    const visits = state.appointments.filter((a) => a.id === first.booking.booking_id)
    expect(visits).toHaveLength(1)
    expect(visits[0]).toMatchObject({ channel: 'google', status: 'confirmed', date: '2026-10-08' })
    expect(state.appointments).toHaveLength(1)
    expect((await book(time, 'token-2')).json()).toMatchObject({
      booking_failure: { cause: 'SLOT_UNAVAILABLE' },
    })
    expect((await call('CheckAvailability', { slot: slotOf(time) })).json()).toMatchObject({
      count_available: 0,
    })
    const lookup = (
      await call('BatchAvailabilityLookup', {
        merchant_id: time.merchant_id,
        slot_time: [time, onDay(await freeTimes(login), '2026-10-09')].map((e) => ({
          service_id: e.service_id,
          start_sec: e.start_sec,
          duration_sec: e.duration_sec,
          resource_ids: { staff_id: e.resources.staff_id },
        })),
      })
    ).json<{ slot_time_availability: { available: boolean }[] }>()
    expect(lookup.slot_time_availability.map((x) => x.available)).toEqual([false, true])
    expect(
      (
        await book(onDay(await freeTimes(login), '2026-10-09'), 'token-3', {
          ...guest,
          telephone: '07700',
        })
      ).json(),
    ).toMatchObject({ booking_failure: { cause: 'UNSUPPORTED_PHONE_NUMBER' } })
  })

  it('reports, lists and cancels a Google booking only before it starts', async () => {
    const login = await studio()
    const later = onDay(await freeTimes(login), '2026-10-09')
    const soon = onDay(await freeTimes(login), '2026-10-06')
    const { booking } = (await book(later)).json<{ booking: { booking_id: string } }>()
    const near = (await book(soon, 'token-near')).json<{ booking: { booking_id: string } }>()
      .booking
    expect(
      (await call('GetBookingStatus', { booking_id: booking.booking_id })).json(),
    ).toMatchObject({
      booking_status: 'CONFIRMED',
    })
    expect(
      (await call('ListBookings', { user_id: guest.user_id })).json<{ bookings: unknown[] }>()
        .bookings,
    ).toHaveLength(2)
    const cancel = (id: string) =>
      call('UpdateBooking', { booking: { booking_id: id, status: 'CANCELED' } })
    expect((await cancel(booking.booking_id)).json()).toMatchObject({
      booking: { status: 'CANCELED' },
    })
    expect((await cancel(booking.booking_id)).json()).toMatchObject({
      booking_failure: { cause: 'BOOKING_ALREADY_CANCELLED' },
    })
    const listed = async () =>
      (await call('ListBookings', { user_id: guest.user_id })).json<{
        bookings: { booking_id: string }[]
      }>().bookings
    // Google lists only the guest's visits still to come.
    expect((await listed()).map((b) => b.booking_id)).toEqual([near.booking_id])
    // Like the guest's own link, a visit can be cancelled until it starts, and not after.
    clock = soon.start_sec * 1000 + 60000
    expect((await cancel(near.booking_id)).json()).toMatchObject({
      booking_failure: { cause: 'OUTSIDE_CANCELLATION_WINDOW' },
    })
    expect(await listed()).toEqual([])
    const { state } = await workspace(login)
    expect(state.appointments.find((a) => a.id === booking.booking_id)?.status).toBe('cancelled')
    expect(state.appointments.find((a) => a.id === near.booking_id)?.status).toBe('confirmed')
  })
})

// Stage 5: a guest moves their Google booking to another free time, under the rules of their own
// visit link, through the desk's own change, and a repeated request never moves it twice.
describe('Moving a Google booking to a new time', () => {
  type Booking = {
    booking_id: string
    status: string
    slot: {
      merchant_id: string
      service_id: string
      start_sec: number
      duration_sec: number
      resources?: Record<string, string>
    }
  }
  type Answer = { booking?: Booking; booking_failure?: { cause: string; description: string } }
  /** A new time as Google's UpdateBooking sample sends it: only the start and the length. */
  const moveTo = (bookingId: string, slot: Record<string, unknown>, status?: string) =>
    call('UpdateBooking', {
      booking: {
        booking_id: bookingId,
        ...(status ? { status } : {}),
        slot: Object.fromEntries(
          Object.entries(slot).map(([k, v]) => [k, typeof v === 'number' ? String(v) : v]),
        ),
      },
    })
  const answer = async (response: Awaited<ReturnType<typeof call>>) => {
    expect(response.statusCode, response.body).toBe(200)
    return response.json<Answer>()
  }
  const failure = async (
    response: Awaited<ReturnType<typeof call>>,
    cause: string,
    words?: RegExp,
  ) => {
    const body = await answer(response)
    expect(body.booking_failure?.cause, response.body).toBe(cause)
    if (words) expect(body.booking_failure?.description).toMatch(words)
  }
  const moves = () =>
    api.database.all<{ record_id: string; actor_id: string | null }>(
      "SELECT record_id,actor_id FROM audit_events WHERE action='google.move'",
    )
  /** The start on Google's clock of a time on the studio's clock in October (London, BST). */
  const at = (date: string, time: string) => Date.parse(`${date}T${time}:00+01:00`) / 1000

  it('moves the visit, keeps what was booked, records it as Book with Google and says so on Google', async () => {
    const login = await studio()
    const first = onDay(await freeTimes(login), '2026-10-09')
    const { booking } = (await book(first)).json<{ booking: Booking }>()
    const before = (await workspace(login)).state
    const booked = before.appointments.find((a) => a.id === booking.booking_id)!
    const target = at('2026-10-13', '11:00')

    const moved = await answer(
      await moveTo(booking.booking_id, { start_sec: target, duration_sec: 3600 }),
    )
    expect(moved.booking).toMatchObject({
      booking_id: booking.booking_id,
      status: 'CONFIRMED',
      slot: {
        merchant_id: before.organisation.id,
        service_id: serviceId,
        start_sec: target,
        duration_sec: 3600,
        resources: { staff_id: first.resources.staff_id },
      },
    })
    const after = (await workspace(login)).state
    const visit = after.appointments.find((a) => a.id === booking.booking_id)!
    // The same visit with the same booked terms; only the day, time and room changed.
    expect(visit).toEqual({
      ...booked,
      date: '2026-10-13',
      startMinutes: 660,
      resourceId: visit.resourceId,
    })
    expect(after.revision).toBe(before.revision + 1)
    const event = after.events.at(-1)!
    expect(event).toMatchObject({
      appointmentId: booking.booking_id,
      type: 'rescheduled',
      title: 'Visit moved',
      actor: 'Book with Google',
      allocationChange: { to: { date: '2026-10-13', startMinutes: 660 } },
    })
    expect(event.id).toMatch(/^google-move-[0-9a-f]{32}$/)
    expect(event.detail).toMatch(/Booked treatment, price and deposit kept/)
    expect(moves()).toEqual([{ record_id: booking.booking_id, actor_id: null }])
    // Who changed what says it came through Google.
    const changes = await api.inject({
      url: `/api/workspaces/${login.orgId}/changes`,
      headers: headers(login),
    })
    expect(changes.json<{ entries: { what: string; who: string }[] }>().entries[0]).toMatchObject({
      what: 'Moved through Book with Google',
      who: 'A guest, through Google',
    })
    // The stored slot follows, and Google reads the new time everywhere.
    const stored = api.database.get<{ slot: string }>(
      'SELECT slot FROM google_bookings WHERE booking_id=?',
      booking.booking_id,
    )!
    expect(JSON.parse(stored.slot)).toMatchObject({ start_sec: target, duration_sec: 3600 })
    const listed = (await call('ListBookings', { user_id: guest.user_id })).json<{
      bookings: Booking[]
    }>()
    expect(listed.bookings.map((b) => b.slot.start_sec)).toEqual([target])
    expect(
      (await call('GetBookingStatus', { booking_id: booking.booking_id })).json(),
    ).toMatchObject({
      booking_status: 'CONFIRMED',
    })
    // The original time is free again for someone else.
    expect((await call('CheckAvailability', { slot: slotOf(first) })).json()).toMatchObject({
      count_available: 1,
    })

    // The same request again (an answer that never reached Google) changes nothing.
    const again = await answer(
      await moveTo(booking.booking_id, { start_sec: target, duration_sec: 3600 }),
    )
    expect(again.booking?.slot.start_sec).toBe(target)
    expect((await workspace(login)).state.revision).toBe(after.revision)
    expect(moves()).toHaveLength(1)

    // A move at the desk shows on Google, and a late retry never moves the visit back.
    const desk = await run(login, {
      type: 'reschedule',
      appointmentId: booking.booking_id,
      staffId: visit.staffId,
      date: '2026-10-14',
      startMinutes: 600,
    })
    expect(desk.statusCode, desk.body).toBe(200)
    const late = await answer(
      await moveTo(booking.booking_id, { start_sec: target, duration_sec: 3600 }),
    )
    expect(late.booking?.slot.start_sec).toBe(at('2026-10-14', '10:00'))
    expect(moves()).toHaveLength(1)
    expect(
      (await call('ListBookings', { user_id: guest.user_id })).json<{ bookings: Booking[] }>()
        .bookings[0].slot.start_sec,
    ).toBe(at('2026-10-14', '10:00'))
    // Once the retry window has passed, asking for that time again is a new move.
    clock += 16 * 60000
    const back = await answer(
      await moveTo(booking.booking_id, { start_sec: target, duration_sec: 3600 }),
    )
    expect(back.booking?.slot.start_sec).toBe(target)
    expect(moves()).toHaveLength(2)
    expect(
      (await workspace(login)).state.events.filter((e) => e.id.startsWith('google-move-')),
    ).toHaveLength(2)
  })

  it('refuses a time Google cannot have, with the failure Google expects, and changes nothing', async () => {
    const login = await studio()
    const times = await freeTimes(login)
    const mine = onDay(times, '2026-10-09')
    const { booking } = (await book(mine)).json<{ booking: Booking }>()
    const theirs = onDay(times, '2026-10-12')
    await book(theirs, 'token-other', {
      ...guest,
      user_id: 'google-user-2',
      email: 'ines@example.invalid',
    })
    const id = booking.booking_id
    const length = { duration_sec: 3600 }
    const unavailable = 'SLOT_UNAVAILABLE'
    // Another length or treatment, or a start Google never offered.
    await failure(
      await moveTo(id, { start_sec: at('2026-10-13', '11:00'), duration_sec: 1800 }),
      unavailable,
      /same treatment|keeps the treatment/,
    )
    await failure(
      await moveTo(id, {
        start_sec: at('2026-10-13', '11:00'),
        ...length,
        service_id: 'service-other',
      }),
      unavailable,
      /keeps the treatment/,
    )
    await failure(
      await moveTo(id, { start_sec: at('2026-10-13', '11:00') + 30, ...length }),
      unavailable,
      /not offered/,
    )
    // Taken by another guest, before opening, or with someone who does not do it.
    await failure(
      await moveTo(id, { start_sec: theirs.start_sec, ...length }),
      unavailable,
      /no longer free/,
    )
    await failure(
      await moveTo(id, { start_sec: at('2026-10-13', '06:00'), ...length }),
      unavailable,
      /no longer free/,
    )
    await failure(
      await moveTo(id, {
        start_sec: at('2026-10-13', '11:00'),
        ...length,
        resources: { staff_id: 'staff-unknown' },
      }),
      unavailable,
      /does not offer/,
    )
    // Another studio's booking cannot be moved into this one.
    await failure(
      await moveTo(id, {
        start_sec: at('2026-10-13', '11:00'),
        ...length,
        merchant_id: 'another-studio',
      }),
      unavailable,
    )
    // A day the studio is closed, more than 60 days ahead, or a time already gone today.
    const closed = await run(login, {
      type: 'closure',
      input: { date: '2026-10-15', startMinutes: 0, endMinutes: 1440, reason: 'Staff training' },
    })
    expect(closed.statusCode, closed.body).toBe(200)
    await failure(
      await moveTo(id, { start_sec: at('2026-10-15', '11:00'), ...length }),
      unavailable,
      /closed that day/,
    )
    await failure(
      await moveTo(id, { start_sec: Date.parse('2026-12-08T11:00:00Z') / 1000, ...length }),
      unavailable,
      /too far ahead/,
    )
    clock = Date.parse('2026-10-06T10:00:00.000Z')
    await failure(
      await moveTo(id, { start_sec: at('2026-10-06', '10:00'), ...length }),
      unavailable,
      /has passed/,
    )
    // Anything but cancelling or a new time.
    await failure(
      await call('UpdateBooking', { booking: { booking_id: id, status: 'CONFIRMED' } }),
      'BOOKING_NOT_CANCELLABLE',
      /cancelling or moving/,
    )
    await failure(
      await moveTo(id, { start_sec: at('2026-10-13', '11:00'), ...length }, 'NO_SHOW'),
      'BOOKING_NOT_CANCELLABLE',
    )
    // A booking Google never made is not found.
    expect(
      (await moveTo('not-a-booking', { start_sec: at('2026-10-13', '11:00'), ...length }))
        .statusCode,
    ).toBe(404)
    // Nothing moved.
    const { state } = await workspace(login)
    expect(state.appointments.find((a) => a.id === id)).toMatchObject({
      date: '2026-10-09',
      startMinutes: 540,
    })
    expect(moves()).toEqual([])
  })

  it('keeps to the guest’s own move rules: the cutoff, the visit starting, online changes off, cancelled', async () => {
    const login = await studio()
    const times = await freeTimes(login)
    const soon = onDay(times, '2026-10-07')
    const later = onDay(times, '2026-10-12')
    const near = (await book(soon, 'token-soon')).json<{ booking: Booking }>().booking
    const far = (await book(later, 'token-later')).json<{ booking: Booking }>().booking
    const target = { start_sec: at('2026-10-13', '11:00'), duration_sec: 3600 }
    // 09:00 on the 7th is less than 24 hours away from 10:00 on the 6th.
    clock = Date.parse('2026-10-06T09:00:00.000Z')
    await failure(
      await moveTo(near.booking_id, target),
      'OUTSIDE_CANCELLATION_WINDOW',
      /less than 24 hours/,
    )
    // Once it has started.
    clock = soon.start_sec * 1000 + 60000
    await failure(await moveTo(near.booking_id, target), 'OUTSIDE_CANCELLATION_WINDOW', /started/)
    clock = Date.parse('2026-10-06T07:00:00.000Z')
    // A cancelled visit, from Google or from anywhere else.
    expect(
      (
        await call('UpdateBooking', {
          booking: { booking_id: near.booking_id, status: 'CANCELED' },
        })
      ).json(),
    ).toMatchObject({ booking: { status: 'CANCELED' } })
    await failure(await moveTo(near.booking_id, target), 'BOOKING_ALREADY_CANCELLED')
    // A studio that switched online booking off takes no changes online either.
    const { state } = await workspace(login)
    const off = await run(login, {
      type: 'organisation',
      name: state.organisation.name,
      locationName: state.organisation.locationName,
      address: state.organisation.address,
      timeZone: state.organisation.timeZone,
      bookingEnabled: false,
    })
    expect(off.statusCode, off.body).toBe(200)
    await failure(
      await moveTo(far.booking_id, target),
      'BOOKING_NOT_CANCELLABLE',
      /not taking changes online/,
    )
    expect(moves()).toEqual([])
  })

  it('stops a time the guest’s patch test does not cover, as their own link does', async () => {
    const login = await studio()
    const { booking } = (await book(onDay(await freeTimes(login), '2026-10-12'))).json<{
      booking: Booking
    }>()
    // The studio marks the treatment as needing a patch test and stops it online without one.
    const { state } = await workspace(login)
    const facial = state.services.find((x) => x.id === serviceId)!
    await ok(login, { type: 'service', id: serviceId, input: { ...facial, patchTest: true } })
    await ok(login, {
      type: 'patch-test-settings',
      settings: { hoursBefore: 48, validMonths: 6, remind: true, stopOnline: true },
    })
    await failure(
      await moveTo(booking.booking_id, {
        start_sec: at('2026-10-13', '11:00'),
        duration_sec: 3600,
      }),
      'SLOT_UNAVAILABLE',
      /patch test/,
    )
    expect(moves()).toEqual([])
  })

  it('moves a guest who booked with anyone to whoever is free, and one who chose a professional only with them', async () => {
    const login = await studio()
    await ok(login, { type: 'resource', input: { name: 'Room Two', type: 'treatment' } })
    const ines = await ok(login, {
      type: 'staff',
      input: { name: 'Ines Hart', role: 'Facialist', serviceIds: [serviceId], tone: 'blue' },
    })
    const times = await freeTimes(login)
    const maya = times[0].resources.staff_id
    const day = (date: string) =>
      times.find(
        (e) =>
          e.resources.staff_id === maya &&
          new Date(e.start_sec * 1000).toISOString().startsWith(date),
      )!
    const named9 = slotOf(day('2026-10-09'))
    const anyone = {
      merchant_id: named9.merchant_id,
      service_id: named9.service_id,
      start_sec: named9.start_sec,
      duration_sec: named9.duration_sec,
    }
    const open = (
      await call('CreateBooking', {
        slot: anyone,
        user_information: guest,
        idempotency_token: 'token-any',
      })
    ).json<{ booking: Booking }>().booking
    expect(open.slot.resources).toBeUndefined()
    const named = (
      await book(day('2026-10-12'), 'token-named', { ...guest, user_id: 'google-user-2' })
    ).json<{
      booking: Booking
    }>().booking
    // Maya is busy at 11:00 on the 13th with another guest.
    await book({ ...day('2026-10-13'), start_sec: at('2026-10-13', '11:00') }, 'token-busy', {
      ...guest,
      user_id: 'google-user-3',
      email: 'busy@example.invalid',
    })
    const busy = { start_sec: at('2026-10-13', '11:00'), duration_sec: 3600 }
    // Chose a professional: only with them, so the busy time is refused.
    await failure(await moveTo(named.booking_id, busy), 'SLOT_UNAVAILABLE', /no longer free/)
    // Booked with anyone: Ines is free, so the visit moves to her and Google still shows no name.
    const moved = await answer(await moveTo(open.booking_id, busy))
    expect(moved.booking?.slot.resources).toBeUndefined()
    let { state } = await workspace(login)
    expect(state.appointments.find((a) => a.id === open.booking_id)).toMatchObject({
      staffId: ines,
      date: '2026-10-13',
    })
    // Google can name a professional for the new time.
    const withInes = await answer(
      await moveTo(named.booking_id, {
        start_sec: at('2026-10-14', '12:00'),
        duration_sec: 3600,
        resources: { staff_id: ines },
      }),
    )
    expect(withInes.booking?.slot.resources).toEqual({ staff_id: ines })
    ;({ state } = await workspace(login))
    expect(state.appointments.find((a) => a.id === named.booking_id)).toMatchObject({
      staffId: ines,
      date: '2026-10-14',
      startMinutes: 720,
    })
  })

  it('takes no new Google bookings for a locked studio, while its guests can still cancel', async () => {
    const login = await studio()
    const times = await freeTimes(login)
    const { booking } = (await book(onDay(times, '2026-10-12'))).json<{ booking: Booking }>()
    api.database.run(
      'UPDATE studio_plans SET locked_at=? WHERE organisation_id=?',
      clock,
      login.orgId,
    )
    const time = onDay(times, '2026-10-13')
    expect((await call('CheckAvailability', { slot: slotOf(time) })).json()).toMatchObject({
      count_available: 0,
    })
    await failure(await book(time, 'token-locked'), 'SLOT_UNAVAILABLE')
    expect(
      (
        await call('UpdateBooking', {
          booking: { booking_id: booking.booking_id, status: 'CANCELED' },
        })
      ).json(),
    ).toMatchObject({ booking: { status: 'CANCELED' } })
  })
})
