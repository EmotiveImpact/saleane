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
