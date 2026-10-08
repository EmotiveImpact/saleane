// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApiHandler } from './app'
import type { ApiHandler } from './app'
import type { BusinessState } from '../src/domain/model'
import type { Command } from '../src/domain/commands'

// V5: read-only access keys for other software, made and revoked by the owner.
const origin = 'http://127.0.0.1:5173'
type Login = { cookie: string; csrf: string; orgId: string }
let api: ApiHandler
let clock: number
beforeEach(() => {
  clock = Date.parse('2026-10-06T07:00:00.000Z')
  api = createApiHandler({ origin, databasePath: ':memory:', now: () => clock, turnstile: null })
})
afterEach(() => api.close())

const cookie = (response: { headers: Record<string, unknown> }) =>
  String(response.headers['set-cookie']).split(';')[0]
const headers = (login: Login) => ({ cookie: login.cookie, 'x-csrf-token': login.csrf })
async function register(email: string, invitation?: string, sample = true): Promise<Login> {
  const response = await api.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: {
      name: invitation ? 'Mina Manager' : 'Ada Owner',
      email,
      password: 'Fictional local account 2026!',
      ...(invitation
        ? { invitation }
        : {
            workspace: { name: 'Linden Studio', locationName: 'London', region: 'UK', sample },
          }),
    },
  })
  expect(response.statusCode, response.body).toBe(201)
  return { ...response.json<{ csrf: string; orgId: string }>(), cookie: cookie(response) }
}
let ids: { serviceId: string; staffId: string; clientId: string }
async function owner() {
  const login = await register('owner@example.invalid', undefined, false)
  await run(login, { type: 'resource', input: { name: 'Room One', type: 'treatment' } })
  const serviceId = await run(login, {
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
  const staffId = await run(login, {
    type: 'staff',
    input: { name: 'Maya Lind', role: 'Facialist', serviceIds: [serviceId], tone: 'sage' },
  })
  const clientId = await run(login, {
    type: 'client',
    contact: {
      name: 'Grace Chen',
      email: 'grace@example.invalid',
      phone: '+44 7700 900123',
      marketingConsent: false,
    },
  })
  ids = { serviceId, staffId, clientId }
  return login
}
const state = async (login: Login) =>
  (await api.inject({ url: `/api/workspaces/${login.orgId}`, headers: headers(login) })).json<{
    state: BusinessState
  }>().state
async function run(login: Login, command: Command) {
  const { revision } = await state(login)
  const response = await api.inject({
    method: 'POST',
    url: `/api/workspaces/${login.orgId}/commands`,
    headers: { ...headers(login), 'idempotency-key': crypto.randomUUID() },
    payload: { revision, command },
  })
  expect(response.statusCode, response.body).toBe(200)
  return response.json<{ recordId: string }>().recordId
}
const book = (login: Login, date = '2026-10-07') =>
  run(login, {
    type: 'book',
    input: {
      serviceId: ids.serviceId,
      staffId: ids.staffId,
      date,
      startMinutes: 600,
      clientId: ids.clientId,
      source: 'desk',
    },
  })

const keys = (login: Login, path = '', payload?: unknown) =>
  api.inject({
    method: payload === undefined ? 'GET' : 'POST',
    url: `/api/workspaces/${login.orgId}/api-keys${path}`,
    headers: headers(login),
    ...(payload === undefined ? {} : { payload }),
  })
async function makeKey(login: Login, scopes: string[]) {
  const response = await keys(login, '', { name: 'Accounts', scopes })
  expect(response.statusCode, response.body).toBe(201)
  return response.json<{ key: string; created: string }>()
}
const read = (key: string, path: string, method = 'GET') =>
  api.inject({
    method,
    url: `/api/v1/${path}`,
    headers: { authorization: `Bearer ${key}` },
  })

describe('read-only access for other software', () => {
  it('reads visits, clients and services with a key, within its scopes', async () => {
    const login = await owner()
    const appointmentId = await book(login)
    const { key } = await makeKey(login, ['appointments:read', 'services:read'])
    expect(key).toMatch(/^sal_[a-f0-9]{8}_/)
    const listed = await keys(login)
    expect(listed.body).not.toContain(key)
    const studio = await read(key, 'studio')
    expect(studio.statusCode, studio.body).toBe(200)
    expect(studio.json()).toMatchObject({
      studio: { name: 'Linden Studio', timeZone: 'Europe/London' },
      scopes: ['appointments:read', 'services:read'],
    })
    const visits = await read(key, 'appointments?from=2026-10-01&to=2026-10-31')
    expect(visits.statusCode, visits.body).toBe(200)
    expect(visits.json()).toMatchObject({
      total: 1,
      data: [{ id: appointmentId, clientId: ids.clientId, date: '2026-10-07', start: '10:00' }],
    })
    expect(visits.body).not.toContain('grace@example.invalid')
    const services = await read(key, 'services')
    expect((await read(key, 'services?limit=1&offset=1')).json()).toMatchObject({
      total: 1,
      data: [],
    })
    expect(services.json()).toMatchObject({
      total: 1,
      data: [{ id: ids.serviceId, name: 'Restorative facial', priceMinor: 9500 }],
      team: [{ id: ids.staffId, name: 'Maya Lind' }],
    })
    // Clients were not chosen for this key.
    expect((await read(key, 'clients')).statusCode).toBe(403)
    const withClients = await makeKey(login, ['clients:read'])
    const clients = await read(withClients.key, 'clients?limit=10')
    expect(clients.json()).toMatchObject({
      total: 1,
      data: [{ id: ids.clientId, name: 'Grace Chen', email: 'grace@example.invalid' }],
    })
    expect(
      (await keys(login)).json<{ keys: { lastUsedAt: string | null }[] }>().keys[0].lastUsedAt,
    ).toBe(new Date(clock).toISOString())
  })

  it('changes nothing, and refuses wide ranges, wrong keys and revoked keys', async () => {
    const login = await owner()
    const { key, created } = await makeKey(login, ['appointments:read'])
    expect((await read(key, 'appointments', 'POST')).statusCode).toBe(405)
    expect((await read(key, 'appointments?from=2026-10-01&to=2026-12-01')).statusCode).toBe(400)
    // Both dates count: 1 October to 1 November is 32 days.
    expect((await read(key, 'appointments?from=2026-10-01&to=2026-11-01')).statusCode).toBe(400)
    expect((await read(key, 'appointments?from=2026-10-01&to=2026-10-31')).statusCode).toBe(200)
    expect((await read(key, 'appointments?from=2026-10-09&to=2026-10-01')).statusCode).toBe(400)
    const forged = key.slice(0, -4) + (key.endsWith('AAAA') ? 'BBBB' : 'AAAA')
    expect((await read(forged, 'studio')).statusCode).toBe(401)
    expect((await api.inject({ url: '/api/v1/studio' })).statusCode).toBe(401)
    expect((await keys(login, `/${created}/revoke`, {})).statusCode).toBe(200)
    expect((await read(key, 'studio')).statusCode).toBe(401)
    expect((await keys(login, `/${created}/revoke`, {})).statusCode).toBe(404)
  })

  it('limits each key to 120 requests a minute, wherever they come from', async () => {
    const login = await owner()
    const { key } = await makeKey(login, ['services:read'])
    const from = (address: string) =>
      api.inject({
        url: '/api/v1/studio',
        headers: { authorization: `Bearer ${key}` },
        remoteAddress: address,
      })
    for (let n = 0; n < 60; n++) expect((await from('203.0.113.1')).statusCode).toBe(200)
    for (let n = 0; n < 60; n++) expect((await from('203.0.113.2')).statusCode).toBe(200)
    expect((await from('203.0.113.3')).statusCode).toBe(429)
    clock += 60001
    expect((await from('203.0.113.3')).statusCode).toBe(200)
  })

  it('lets only the owner of a studio of its own make keys', async () => {
    const login = await owner()
    const invitation = await api.inject({
      method: 'POST',
      url: `/api/workspaces/${login.orgId}/invitations`,
      headers: headers(login),
      payload: { email: 'manager@example.invalid', role: 'manager' },
    })
    const manager = {
      ...(await register(
        'manager@example.invalid',
        invitation.json<{ invitation: string }>().invitation,
      )),
      orgId: login.orgId,
    }
    expect((await keys(manager)).statusCode).toBe(403)
    expect((await keys(manager, '', { name: 'Mine', scopes: ['clients:read'] })).statusCode).toBe(
      403,
    )
    const sample = await register('sample@example.invalid')
    expect((await keys(sample, '', { name: 'Demo', scopes: ['clients:read'] })).statusCode).toBe(
      409,
    )
    // Another studio's key cannot read this one.
    const other = await makeKey(login, ['clients:read'])
    const body = (await read(other.key, 'clients')).json<{ data: { id: string }[] }>()
    expect(body.data.map((c) => c.id)).toEqual([ids.clientId])
  })
})
