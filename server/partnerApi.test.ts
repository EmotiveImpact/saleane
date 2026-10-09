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

describe('partner access', () => {
  it('keeps a key to one location, with only its visits and the menu', async () => {
    const login = await owner()
    await run(login, {
      type: 'location',
      input: { name: 'Islington', address: '1 Upper Street, London N1 0PN' },
    })
    const s = await state(login)
    const [main, islington] = [s.organisation.locationId, s.operations!.locations![0].id]
    await book(login)
    const treatment = {
      description: 'A fictional service',
      category: 'Skin' as const,
      durationMinutes: 45,
      bufferMinutes: 0,
      depositMinor: 0,
      resourceType: 'treatment' as const,
    }
    await run(login, {
      type: 'service',
      input: { ...treatment, name: 'Brow shape', priceMinor: 3000, notOfferedAt: [islington] },
    })
    await run(login, {
      type: 'service',
      input: {
        ...treatment,
        name: 'Lash lift',
        priceMinor: 5000,
        locationPrices: [{ locationId: islington, priceMinor: 5500 }],
      },
    })
    // Clients and takings belong to the whole studio, so a one-location key cannot have them.
    for (const scope of ['clients:read', 'takings:read']) {
      const refused = await keys(login, '', {
        name: 'Branch',
        scopes: ['appointments:read', scope],
        locationId: islington,
      })
      expect(refused.statusCode).toBe(422)
    }
    expect(
      (
        await keys(login, '', {
          name: 'Branch',
          scopes: ['appointments:read'],
          locationId: 'nowhere',
        })
      ).statusCode,
    ).toBe(422)
    const make = async (locationId: string) => {
      const response = await keys(login, '', {
        name: 'Branch till',
        scopes: ['appointments:read', 'services:read'],
        locationId,
      })
      expect(response.statusCode, response.body).toBe(201)
      return response.json<{ key: string; keys: { locationId: string | null }[] }>()
    }
    const there = await make(islington)
    const here = await make(main)
    expect(there.keys.map((k) => k.locationId)).toContain(islington)
    const visits = async (key: string) =>
      (await read(key, 'appointments?from=2026-10-01&to=2026-10-31')).json<{ total: number }>()
        .total
    expect(await visits(there.key)).toBe(0)
    expect(await visits(here.key)).toBe(1)
    expect((await read(there.key, 'studio')).json<{ locationId: string }>().locationId).toBe(
      islington,
    )
    // Each key sees the menu at its own location: what is offered there, at its price there.
    const menu = async (key: string) =>
      (await read(key, 'services')).json<{ data: { name: string; priceMinor: number }[] }>().data
    const islingtonMenu = await menu(there.key)
    expect(islingtonMenu.map((x) => x.name)).not.toContain('Brow shape')
    expect(islingtonMenu.find((x) => x.name === 'Lash lift')!.priceMinor).toBe(5500)
    const mainMenu = await menu(here.key)
    expect(mainMenu.map((x) => x.name)).toContain('Brow shape')
    expect(mainMenu.find((x) => x.name === 'Lash lift')!.priceMinor).toBe(5000)
    expect((await read(there.key, 'clients')).statusCode).toBe(403)
    // Closing the location stops its key.
    await run(login, {
      type: 'location',
      id: islington,
      input: { name: 'Islington', address: '1 Upper Street, London N1 0PN', archived: true },
    })
    expect((await read(there.key, 'studio')).statusCode).toBe(401)
    expect((await read(here.key, 'studio')).statusCode).toBe(200)
  })

  it('stops a key after its last day', async () => {
    const login = await owner()
    // At most one year: the day before the same date next year is the last allowed.
    for (const endsOn of ['2026-10-05', '2027-10-06']) {
      const refused = await keys(login, '', { name: 'Audit', scopes: ['takings:read'], endsOn })
      expect(refused.statusCode).toBe(422)
    }
    expect(
      (await keys(login, '', { name: 'Year', scopes: ['takings:read'], endsOn: '2027-10-05' }))
        .statusCode,
    ).toBe(201)
    const made = await keys(login, '', {
      name: 'Audit',
      scopes: ['takings:read'],
      endsOn: '2026-10-07',
    })
    expect(made.statusCode, made.body).toBe(201)
    const { key } = made.json<{ key: string }>()
    expect((await read(key, 'studio')).json<{ endsOn: string }>().endsOn).toBe('2026-10-07')
    // Still works through the whole of its last day in the studio's own time.
    clock = Date.parse('2026-10-07T22:30:00.000Z')
    expect((await read(key, 'studio')).statusCode).toBe(200)
    clock = Date.parse('2026-10-07T23:30:00.000Z')
    const ended = await read(key, 'studio')
    expect(ended.statusCode).toBe(401)
    expect(ended.body).toContain('end date')
  })

  it('reads takings by day, with no receipts or names', async () => {
    const login = await owner()
    await book(login)
    const { key } = await makeKey(login, ['takings:read'])
    const takings = await read(key, 'takings?from=2026-10-01&to=2026-10-31')
    expect(takings.statusCode, takings.body).toBe(200)
    const body = takings.json<{ currency: string; data: unknown[] }>()
    expect(body.currency).toBe('GBP')
    expect(Array.isArray(body.data)).toBe(true)
    expect(takings.body).not.toContain('Grace')
    expect((await read(key, 'takings?from=2026-10-01&to=2026-12-31')).statusCode).toBe(400)
    const visitsOnly = await makeKey(login, ['appointments:read'])
    expect((await read(visitsOnly.key, 'takings?from=2026-10-01&to=2026-10-31')).statusCode).toBe(
      403,
    )
  })
})
