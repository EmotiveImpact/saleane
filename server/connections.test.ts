// @vitest-environment node
import { createHmac } from 'node:crypto'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApiHandler } from './app'
import type { ApiHandler } from './app'
import type { BusinessState } from '../src/domain/model'
import type { Command } from '../src/domain/commands'
import {
  connectionTransportFromEnv,
  fetchTransport,
  nodeSender,
  privateAddress,
  signature,
} from './connections'
import type { ConnectionTransport, SendOutcome } from './connections'

// V5: connections through the server. Events are recorded with the change that caused them,
// signed, delivered at least once, logged, and never sent once the owner turns them off.
const origin = 'http://127.0.0.1:5173'
type Login = { cookie: string; csrf: string; orgId: string }
type Post = { url: string; headers: Record<string, string>; body: string }
let api: ApiHandler
let clock: number
let posts: Post[]
let answer: () => SendOutcome

const transport: ConnectionTransport = {
  mode: 'live',
  check: (url) => (url.startsWith('https://') ? null : 'The address must start https://.'),
  post: async (url, headers, body) => {
    posts.push({ url, headers, body })
    return answer()
  },
}
beforeEach(() => {
  clock = Date.parse('2026-10-06T07:00:00.000Z')
  posts = []
  answer = () => ({ status: 200 })
  api = createApiHandler({
    origin,
    databasePath: ':memory:',
    now: () => clock,
    turnstile: null,
    connectionTransport: transport,
  })
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
const call = (login: Login, path = '', payload?: unknown) =>
  api.inject({
    method: payload === undefined ? 'GET' : 'POST',
    url: `/api/workspaces/${login.orgId}/connections${path}`,
    headers: headers(login),
    ...(payload === undefined ? {} : { payload }),
  })
type Listing = {
  connections: { id: string; active: boolean; events: string[]; shareContact: boolean }[]
  deliveries: { type: string; status: string; attempts: number; detail: string | null }[]
  secret?: string
  created?: string
  mode: string
}
async function connect(login: Login, input: Partial<Record<string, unknown>> = {}) {
  const response = await call(login, '', {
    name: 'Zapier',
    url: 'https://hooks.example.invalid/catch/1',
    events: ['appointment.booked', 'appointment.cancelled'],
    shareContact: false,
    ...input,
  })
  expect(response.statusCode, response.body).toBe(201)
  return response.json<Listing>()
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

describe('connections through the server', () => {
  it('sends a signed booking and a cancellation, once each, without guest details unless chosen', async () => {
    const login = await owner()
    const { secret, connections } = await connect(login)
    expect(secret).toMatch(/^whsec_/)
    expect(JSON.stringify(await (await call(login)).json())).not.toContain(secret!)
    const appointmentId = await book(login)
    await api.connections.tick()
    expect(posts).toHaveLength(1)
    const [post] = posts
    const body = JSON.parse(post.body)
    expect(post.headers['Saleane-Event']).toBe('appointment.booked')
    expect(post.headers['Saleane-Delivery']).toBe(body.id)
    const [t, v1] = post.headers['Saleane-Signature'].split(',')
    const timestamp = Number(t.slice(2))
    expect(v1.slice(3)).toBe(
      createHmac('sha256', secret!).update(`${timestamp}.${post.body}`).digest('hex'),
    )
    expect(body).toMatchObject({
      type: 'appointment.booked',
      apiVersion: '2026-10-08',
      studio: { name: 'Linden Studio', timeZone: 'Europe/London' },
      client: { id: ids.clientId },
      appointment: { id: appointmentId, status: 'confirmed', date: '2026-10-07', start: '10:00' },
    })
    expect(body.client.name).toBeUndefined()
    expect(body.client.email).toBeUndefined()
    // Delivered once: a second run sends nothing more.
    await api.connections.tick()
    expect(posts).toHaveLength(1)
    await run(login, { type: 'cancel', appointmentId, reason: 'Guest rang to cancel' })
    await api.connections.tick()
    expect(posts.map((p) => p.headers['Saleane-Event'])).toEqual([
      'appointment.booked',
      'appointment.cancelled',
    ])
    const listing = (await call(login)).json<Listing>()
    expect(listing.deliveries.map((d) => d.status)).toEqual(['delivered', 'delivered'])
    expect(listing.connections[0].id).toBe(connections[0].id)
  })

  it('includes guest details only for a connection the owner chose to share them with', async () => {
    const login = await owner()
    await connect(login, { shareContact: true, events: ['appointment.booked'] })
    await book(login)
    await api.connections.tick()
    expect(JSON.parse(posts[0].body).client).toEqual({
      id: ids.clientId,
      name: 'Grace Chen',
      email: 'grace@example.invalid',
      phone: '+44 7700 900123',
    })
  })

  it('sends nothing for events the connection did not choose, or once it is off', async () => {
    const login = await owner()
    const { connections } = await connect(login, { events: ['client.created'] })
    await book(login)
    await api.connections.tick()
    expect(posts).toEqual([])
    await run(login, {
      type: 'client',
      contact: {
        name: 'Rosa Field',
        email: 'rosa@example.invalid',
        phone: '+44 7700 900456',
        marketingConsent: false,
      },
    })
    // Turned off after the event was recorded but before it went out: skipped, not sent.
    const off = await call(login, `/${connections[0].id}`, { active: false })
    expect(off.statusCode, off.body).toBe(200)
    await api.connections.tick()
    expect(posts).toEqual([])
    const listing = (await call(login)).json<Listing>()
    expect(listing.deliveries).toMatchObject([{ type: 'client.created', status: 'skipped' }])
    await run(login, {
      type: 'client',
      contact: {
        name: 'Theo Hart',
        email: 'theo@example.invalid',
        phone: '+44 7700 900789',
        marketingConsent: false,
      },
    })
    await api.connections.tick()
    expect(posts).toEqual([])
  })

  it('does not send what was waiting when a connection was turned off, even once it is back on', async () => {
    const login = await owner()
    const { created } = await connect(login)
    await book(login)
    await call(login, `/${created}`, { active: false })
    await call(login, `/${created}`, { active: true })
    await api.connections.tick()
    expect(posts).toEqual([])
    expect((await call(login)).json<Listing>().deliveries).toMatchObject([
      { type: 'appointment.booked', status: 'skipped' },
    ])
  })

  it('tries again a send cut short by the server stopping, once its lease is over', async () => {
    const login = await owner()
    await connect(login)
    await book(login)
    // As if the server stopped after claiming the delivery and before hearing back.
    api.database.run(
      "UPDATE connection_deliveries SET status='unknown',attempts=1,updated_at=?",
      clock,
    )
    await api.connections.tick()
    expect(posts).toEqual([])
    clock += 5 * 60000
    await api.connections.tick()
    expect(posts).toHaveLength(1)
    expect((await call(login)).json<Listing>().deliveries).toMatchObject([
      { status: 'delivered', attempts: 2 },
    ])
  })

  it('turns every connection off at once, and keeps the log of one removed', async () => {
    const login = await owner()
    await connect(login)
    const second = await connect(login, { name: 'Accounts' })
    const paused = (await call(login, '/pause-all', {})).json<Listing>()
    expect(paused.connections.map((c) => c.active)).toEqual([false, false])
    await book(login)
    await api.connections.tick()
    expect(posts).toEqual([])
    await call(login, `/${second.created}`, { active: true })
    await call(login, `/${second.created}/test`, {})
    await api.connections.tick()
    expect(posts.map((p) => p.headers['Saleane-Event'])).toEqual(['connection.test'])
    const removed = (await call(login, `/${second.created}/remove`, {})).json<Listing>()
    expect(removed.connections).toHaveLength(1)
    expect(removed.deliveries).toMatchObject([{ type: 'connection.test', status: 'delivered' }])
    expect((await call(login, `/${second.created}`, { active: true })).statusCode).toBe(404)
  })

  it('tries again after a busy answer or no answer, and stops on a refusal or after five tries', async () => {
    const login = await owner()
    await connect(login, { events: ['appointment.booked'] })
    answer = () => ({ status: 503 })
    await book(login)
    await api.connections.tick()
    let [delivery] = (await call(login)).json<Listing>().deliveries
    expect(delivery).toMatchObject({ status: 'pending', attempts: 1 })
    // Not again until the wait is over.
    await api.connections.tick()
    expect(posts).toHaveLength(1)
    answer = () => ({ error: 'unknown', detail: 'No answer in time. It may have arrived.' })
    for (const wait of [1, 5, 30, 120]) {
      clock += wait * 60000
      await api.connections.tick()
    }
    expect(posts).toHaveLength(5)
    ;[delivery] = (await call(login)).json<Listing>().deliveries
    expect(delivery).toMatchObject({ status: 'failed', attempts: 5 })
    clock += 2 * 60 * 60000
    await api.connections.tick()
    expect(posts).toHaveLength(5)
    // A 4xx other than 408 or 429 is a refusal: not tried again.
    answer = () => ({ status: 410 })
    await book(login, '2026-10-08')
    await api.connections.tick()
    ;[delivery] = (await call(login)).json<Listing>().deliveries
    expect(delivery).toMatchObject({ status: 'failed', attempts: 1 })
  })

  it('renews the secret, so later deliveries are signed with the new one', async () => {
    const login = await owner()
    const { created, secret } = await connect(login)
    const renewed = (await call(login, `/${created}/secret`, {})).json<Listing>()
    expect(renewed.secret).toMatch(/^whsec_/)
    expect(renewed.secret).not.toBe(secret)
    await book(login)
    await api.connections.tick()
    const [t] = posts[0].headers['Saleane-Signature'].split(',')
    expect(posts[0].headers['Saleane-Signature']).toBe(
      signature(renewed.secret!, Number(t.slice(2)), posts[0].body),
    )
  })

  it('lets only the owner of a studio of its own connect software, and refuses unsafe addresses', async () => {
    const login = await owner()
    const invitation = await api.inject({
      method: 'POST',
      url: `/api/workspaces/${login.orgId}/invitations`,
      headers: headers(login),
      payload: { email: 'manager@example.invalid', role: 'manager' },
    })
    expect(invitation.statusCode, invitation.body).toBe(201)
    const manager = {
      ...(await register(
        'manager@example.invalid',
        invitation.json<{ invitation: string }>().invitation,
      )),
      orgId: login.orgId,
    }
    expect((await call(manager)).statusCode).toBe(403)
    expect(
      (
        await call(manager, '', {
          name: 'Mine',
          url: 'https://hooks.example.invalid/x',
          events: ['client.created'],
          shareContact: true,
        })
      ).statusCode,
    ).toBe(403)
    const insecure = await call(login, '', {
      name: 'Plain',
      url: 'http://hooks.example.invalid/x',
      events: ['client.created'],
      shareContact: false,
    })
    expect(insecure.statusCode).toBe(400)
    // A sample studio never sends anything outside SALEANE.
    const sample = await register('sample@example.invalid')
    const refused = await call(sample, '', {
      name: 'Zapier',
      url: 'https://hooks.example.invalid/x',
      events: ['client.created'],
      shareContact: false,
    })
    expect(refused.statusCode).toBe(409)
    expect((await call(sample)).json<{ sample: boolean }>().sample).toBe(true)
  })
})

describe('the connection transport', () => {
  it('runs in test mode unless live is named, and test mode sends nothing', async () => {
    const test = connectionTransportFromEnv({})
    expect(test.mode).toBe('test')
    expect(await test.post('https://hooks.example.invalid/x', {}, '{}')).toEqual({ test: true })
    expect(connectionTransportFromEnv({ SALEANE_CONNECTIONS: 'live' }).mode).toBe('live')
    expect(() => connectionTransportFromEnv({ SALEANE_CONNECTIONS: 'maybe' })).toThrow()
  })

  it('connects to the address that was checked, keeping the name the owner gave', async () => {
    const seen: { host?: string; body: string }[] = []
    const server = createServer((request, response) => {
      let body = ''
      request.on('data', (chunk) => (body += chunk))
      request.on('end', () => {
        seen.push({ host: request.headers.host, body })
        response.statusCode = 204
        response.end()
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    try {
      const status = await nodeSender(new URL(`http://partner.invalid:${port}/hook`), {
        headers: { 'Content-Type': 'application/json' },
        body: '{"ok":true}',
        address: '127.0.0.1',
      })
      expect(status).toBe(204)
      expect(seen).toEqual([{ host: `partner.invalid:${port}`, body: '{"ok":true}' }])
    } finally {
      server.close()
    }
  })

  it('refuses addresses on this computer or a private network, and does not follow redirects', async () => {
    for (const address of ['127.0.0.1', '10.1.2.3', '192.168.0.4', '169.254.169.254', '::1'])
      expect(privateAddress(address), address).toBe(true)
    expect(privateAddress('::ffff:127.0.0.1')).toBe(true)
    expect(privateAddress('93.184.216.34')).toBe(false)
    const seen: { url: string; address?: string }[] = []
    const live = fetchTransport({
      sender: async (url, request) => {
        seen.push({ url: url.toString(), address: request.address })
        return 302
      },
    })
    expect(live.check('http://example.invalid/x')).toMatch(/https/)
    expect(live.check('https://localhost/x')).toMatch(/this computer/)
    expect(live.check('https://user:pass@example.com/x')).toMatch(/password/)
    expect(live.check('https://10.0.0.1/x')).toMatch(/private/)
    expect(await live.post('https://[::1]/x', {}, '{}')).toMatchObject({ error: 'refused' })
    // A redirect is an answer, not followed; the address checked is the one connected to.
    expect(await live.post('https://93.184.216.34/x', {}, '{}')).toEqual({ status: 302 })
    expect(seen).toEqual([{ url: 'https://93.184.216.34/x', address: '93.184.216.34' }])
  })
})
