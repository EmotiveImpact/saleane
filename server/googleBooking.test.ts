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
