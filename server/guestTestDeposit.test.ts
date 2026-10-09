// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApiHandler } from './app'
import type { ApiHandler } from './app'
import type { BusinessState } from '../src/domain/model'
import type { Command } from '../src/domain/commands'
import type { GuestView } from '../src/domain/guest'
import { testProvider } from './messaging/providers'
import { testPaymentProvider } from './payments/providers'

// A deposit paid on the test payment page took no money, and the guest's page is told so; one
// recorded at the desk, or paid in part another way, reads as paid.
const origin = 'http://127.0.0.1:5173'
const contact = {
  name: 'Rosa Guest',
  email: 'rosa.guest@example.invalid',
  phone: '+44 7700 900333',
  marketingConsent: false,
}
type Login = { cookie: string; csrf: string; orgId: string }
let api: ApiHandler
let clock: number

beforeEach(() => {
  // 07:00Z on 6 October is 08:00 in London.
  clock = Date.parse('2026-10-06T07:00:00.000Z')
  api = createApiHandler({
    origin,
    databasePath: ':memory:',
    now: () => clock,
    turnstile: null,
    providers: { email: testProvider('email'), sms: testProvider('sms'), receipt: () => null },
    paymentProvider: testPaymentProvider(origin),
  })
})
afterEach(() => api.close())

const headers = (login: Login) => ({ cookie: login.cookie, 'x-csrf-token': login.csrf })
async function register(): Promise<Login> {
  const response = await api.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: {
      name: 'Ada Owner',
      email: 'owner@example.invalid',
      password: 'Fictional local account 2026!',
      workspace: { name: 'Linden Studio', locationName: 'London', region: 'UK', sample: false },
    },
  })
  expect(response.statusCode, response.body).toBe(201)
  return {
    ...response.json<{ csrf: string; orgId: string }>(),
    cookie: String(response.headers['set-cookie']).split(';')[0],
  }
}
const workspace = async (login: Login) =>
  (await api.inject({ url: `/api/workspaces/${login.orgId}`, headers: headers(login) })).json<{
    slug: string
    state: BusinessState
  }>()
async function run(login: Login, command: Command) {
  const { state } = await workspace(login)
  const response = await api.inject({
    method: 'POST',
    url: `/api/workspaces/${login.orgId}/commands`,
    headers: { ...headers(login), 'idempotency-key': crypto.randomUUID() },
    payload: { revision: state.revision, command },
  })
  expect(response.statusCode, response.body).toBe(200)
  return response.json<{ recordId: string }>().recordId
}
/** A studio taking a £20 deposit, and a guest's visit there on Friday 9 October. */
async function booked() {
  const owner = await register()
  await run(owner, { type: 'resource', input: { name: 'Room One', type: 'treatment' } })
  const serviceId = await run(owner, {
    type: 'service',
    input: {
      name: 'Restorative facial',
      description: 'A fictional service',
      category: 'Skin',
      durationMinutes: 60,
      bufferMinutes: 15,
      priceMinor: 9500,
      depositMinor: 2000,
      resourceType: 'treatment',
    },
  })
  const staffId = await run(owner, {
    type: 'staff',
    input: { name: 'Maya Lind', role: 'Facialist', serviceIds: [serviceId], tone: 'sage' },
  })
  // A new studio takes online bookings only once the owner switches them on.
  const { name, locationName, address, timeZone } = (await workspace(owner)).state.organisation
  await run(owner, {
    type: 'organisation',
    name,
    locationName,
    address,
    timeZone,
    bookingEnabled: true,
  })
  const { slug } = await workspace(owner)
  const held = await api.inject({
    method: 'POST',
    url: `/api/public/${slug}/holds`,
    payload: { serviceId, staffId, date: '2026-10-09', startMinutes: 600 },
  })
  expect(held.statusCode, held.body).toBe(201)
  const made = await api.inject({
    method: 'POST',
    url: `/api/public/${slug}/book`,
    payload: { hold: held.json<{ hold: string }>().hold, contact, policy: true },
  })
  expect(made.statusCode, made.body).toBe(200)
  const result = made.json<{ appointmentId: string; manage: { url: string } }>()
  return { owner, appointmentId: result.appointmentId, token: result.manage.url.split('#')[1] }
}
const visit = async (token: string) => {
  const response = await api.inject({ method: 'POST', url: '/api/guest/visit', payload: { token } })
  expect(response.statusCode, response.body).toBe(200)
  return response.json<GuestView>()
}
/** The guest pays what is due on the test payment page with the test card that goes through. */
async function paysOnTestPage(token: string) {
  const opened = await api.inject({
    method: 'POST',
    url: '/api/guest/pay',
    payload: { token, purpose: 'deposit', saveCard: false },
  })
  expect(opened.statusCode, opened.body).toBe(200)
  const attemptId = opened.json<{ url: string }>().url.split('#')[1]
  const paid = await api.inject({
    method: 'POST',
    url: `/api/test-payments/${attemptId}`,
    payload: { outcome: 'pay', card: '4242' },
  })
  expect(paid.json<{ next: string }>().next).toBe('/manage?payment=done')
}

describe('a deposit paid in test mode', () => {
  it('tells the guest no money was taken, also once they cancel', async () => {
    const { token } = await booked()
    expect((await visit(token)).deposit).toEqual({ paidMinor: 0, simulated: false })
    await paysOnTestPage(token)
    const paid = await visit(token)
    expect(paid.deposit).toEqual({ paidMinor: 2000, simulated: false, test: true })
    expect(paid.cancellation.outcome).toBe('refund_due')
    const cancelled = await api.inject({
      method: 'POST',
      url: '/api/guest/cancel',
      payload: { token, expected: 'refund_due' },
    })
    expect(cancelled.statusCode, cancelled.body).toBe(200)
    expect(cancelled.json<GuestView>().deposit).toEqual({
      paidMinor: 2000,
      simulated: false,
      test: true,
    })
  })

  it('reads as paid when the studio recorded it at the desk', async () => {
    const { owner, appointmentId, token } = await booked()
    await run(owner, { type: 'deposit', appointmentId, amountMinor: 2000, method: 'cash' })
    expect((await visit(token)).deposit).toEqual({ paidMinor: 2000, simulated: false })
  })

  it('reads as paid when part of it was taken another way', async () => {
    const { owner, appointmentId, token } = await booked()
    await run(owner, { type: 'deposit', appointmentId, amountMinor: 500, method: 'cash' })
    await paysOnTestPage(token)
    expect((await visit(token)).deposit).toEqual({ paidMinor: 2000, simulated: false })
  })
})
