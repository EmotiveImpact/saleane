// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApiHandler } from './app'
import type { ApiHandler } from './app'
import type { BusinessState } from '../src/domain/model'

// The guest booking page's own server routes: what a guest types, what the page shows before
// they confirm, and how a time is found.
const origin = 'http://127.0.0.1:5173'
const contact = {
  name: 'Page Guest',
  email: 'page.guest@example.invalid',
  phone: '+44 7700 900456',
  marketingConsent: false,
}
type Login = { cookie: string; csrf: string; orgId: string }
let api: ApiHandler
let clock: number

beforeEach(() => {
  // 07:00Z on 6 October is 08:00 in London and 03:00 in New York.
  clock = Date.parse('2026-10-06T07:00:00.000Z')
  api = createApiHandler({ origin, databasePath: ':memory:', now: () => clock, turnstile: null })
})
afterEach(() => api.close())

const headers = (login: Login) => ({ cookie: login.cookie, 'x-csrf-token': login.csrf })
async function register(region: 'UK' | 'US' = 'UK', sample = true) {
  const response = await api.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: {
      name: 'Ada Owner',
      email: `owner-${region.toLowerCase()}@example.invalid`,
      password: 'Fictional local account 2026!',
      workspace: {
        name: 'Reference Studio',
        locationName: region === 'UK' ? 'London' : 'New York',
        region,
        sample,
      },
    },
  })
  expect(response.statusCode, response.body).toBe(201)
  return {
    ...response.json<{ csrf: string; orgId: string }>(),
    cookie: String(response.headers['set-cookie']).split(';')[0],
  }
}
async function studio(login: Login) {
  return (
    await api.inject({ url: `/api/workspaces/${login.orgId}`, headers: headers(login) })
  ).json<{ slug: string; state: BusinessState }>()
}
async function hold(slug: string, startMinutes = 600, date = '2026-10-07') {
  const held = await api.inject({
    method: 'POST',
    url: `/api/public/${slug}/holds`,
    payload: { serviceId: 'service-facial', staffId: 'staff-maya', date, startMinutes },
  })
  expect(held.statusCode, held.body).toBe(201)
  return held.json<{ hold: string; expiresAt: string; staffId: string }>()
}
const book = (slug: string, held: string, phone: string) =>
  api.inject({
    method: 'POST',
    url: `/api/public/${slug}/book`,
    payload: { hold: held, contact: { ...contact, phone }, policy: true },
  })
async function guestPhoneOf(login: Login, appointmentId: string) {
  const { state } = await studio(login)
  const visit = state.appointments.find((a) => a.id === appointmentId)!
  return state.clients.find((c) => c.id === visit.clientId)!.phone
}

describe('phone numbers on the booking page', () => {
  it('takes a UK mobile written the local way and keeps it as an international number', async () => {
    const owner = await register('UK')
    const { slug } = await studio(owner)
    const local = await book(slug, (await hold(slug, 600)).hold, '07700 900456')
    expect(local.statusCode, local.body).toBe(200)
    expect(await guestPhoneOf(owner, local.json<{ appointmentId: string }>().appointmentId)).toBe(
      '+44 7700 900456',
    )
    const international = await book(slug, (await hold(slug, 720)).hold, '+44 7700 900456')
    expect(international.statusCode, international.body).toBe(200)
    expect(
      await guestPhoneOf(owner, international.json<{ appointmentId: string }>().appointmentId),
    ).toBe('+44 7700 900456')
  })

  it('takes a US number written the local way for a US studio', async () => {
    const owner = await register('US')
    const { slug } = await studio(owner)
    const booked = await book(slug, (await hold(slug, 600)).hold, '(212) 555-0142')
    expect(booked.statusCode, booked.body).toBe(200)
    expect(await guestPhoneOf(owner, booked.json<{ appointmentId: string }>().appointmentId)).toBe(
      '+1 212 555 0142',
    )
  })

  it('refuses rubbish with a friendly message and keeps the held time for a second try', async () => {
    const owner = await register('UK')
    const { slug } = await studio(owner)
    const { hold: held } = await hold(slug, 600)
    const before = (await studio(owner)).state
    for (const rubbish of ['not a number', '12345', '07700', '(212) 555-0142', '']) {
      const refused = await book(slug, held, rubbish)
      expect(refused.statusCode, rubbish).toBe(422)
      expect(refused.json().error).toBe(
        'Enter a phone number we can reach you on, such as 07700 900456 or +44 7700 900456.',
      )
    }
    const after = (await studio(owner)).state
    expect(after.revision).toBe(before.revision)
    expect(after.appointments).toHaveLength(before.appointments.length)
    const fixed = await book(slug, held, '07700 900456')
    expect(fixed.statusCode, fixed.body).toBe(200)
  })
})

async function run(login: Login, command: Record<string, unknown>) {
  const { state } = await studio(login)
  const response = await api.inject({
    method: 'POST',
    url: `/api/workspaces/${login.orgId}/commands`,
    headers: { ...headers(login), 'idempotency-key': crypto.randomUUID() },
    payload: { revision: state.revision, command },
  })
  expect(response.statusCode, response.body).toBe(200)
  return response.json<{ recordId: string }>().recordId
}
/** A real studio in test mode: one room, one facial with a £20 deposit, one professional. */
async function realStudio(feePercent = 0) {
  const owner = await register('UK', false)
  await run(owner, { type: 'resource', input: { name: 'Room One', type: 'treatment' } })
  const serviceId = await run(owner, {
    type: 'service',
    input: {
      name: 'Restorative facial',
      description: 'A fictional treatment',
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
  if (feePercent)
    await run(owner, { type: 'protection', settings: { saveCard: false, feePercent } })
  return { owner, serviceId, staffId, slug: (await studio(owner)).slug }
}

describe('deposits shown truthfully before the guest confirms', () => {
  it('shows a real studio’s deposit and rule up front, then offers to pay it by card', async () => {
    const { serviceId, staffId, slug } = await realStudio(50)
    const page = (await api.inject({ url: `/api/public/${slug}` })).json<{
      services: { id: string; depositMinor: number }[]
    }>()
    expect(page.services.find((s) => s.id === serviceId)!.depositMinor).toBe(2000)
    expect(page).toMatchObject({
      sample: false,
      depositPolicy: 'card',
      cardPayments: { testMode: true },
      emailsLive: false,
      cancellation: { cutoffHours: 24, feePercent: 50 },
    })
    expect(page).not.toHaveProperty('paymentCollectionConfigured')
    const held = await api.inject({
      method: 'POST',
      url: `/api/public/${slug}/holds`,
      payload: { serviceId, staffId, date: '2026-10-08', startMinutes: 600 },
    })
    expect(held.statusCode, held.body).toBe(201)
    const booked = await book(slug, held.json<{ hold: string }>().hold, '07700 900456')
    expect(booked.statusCode, booked.body).toBe(200)
    const result = booked.json<{ manage: { url: string }; payment: Record<string, unknown> }>()
    // The same deposit the guest's own visit page asks for, in test mode.
    expect(result.payment).toMatchObject({ testMode: true, depositDueMinor: 2000, pending: false })
    const token = result.manage.url.split('#')[1]
    const visit = await api.inject({ method: 'POST', url: '/api/guest/visit', payload: { token } })
    expect(visit.json().payment).toMatchObject({ depositDueMinor: 2000 })
    // Paying straight away uses the visit page's own payment start: the labelled test page.
    const opened = await api.inject({
      method: 'POST',
      url: '/api/guest/pay',
      payload: { token, purpose: 'deposit', saveCard: false },
    })
    expect(opened.statusCode, opened.body).toBe(200)
    expect(opened.json<{ url: string }>().url).toMatch(`${origin}/pay/test#`)
  })

  it('keeps a sample studio’s deposit simulated, with nothing to pay after booking', async () => {
    const owner = await register('UK', true)
    const { slug, state } = await studio(owner)
    const page = (await api.inject({ url: `/api/public/${slug}` })).json<{
      services: { id: string; depositMinor: number }[]
    }>()
    expect(page).toMatchObject({ sample: true, depositPolicy: 'simulated', cardPayments: null })
    expect(page.services.find((s) => s.id === 'service-facial')!.depositMinor).toBe(
      state.services.find((s) => s.id === 'service-facial')!.depositMinor,
    )
    const booked = await book(slug, (await hold(slug, 600)).hold, '07700 900456')
    expect(booked.statusCode, booked.body).toBe(200)
    expect(booked.json()).toMatchObject({ sample: true, depositPolicy: 'simulated' })
    expect(booked.json()).not.toHaveProperty('payment')
  })
})
