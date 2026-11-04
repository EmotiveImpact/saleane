// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHostedApp, memoryStore } from './hosted'
import type { HostedApp, HostedRequest, SnapshotStore } from './hosted'
import type { MessageProvider, OutgoingMessage, Providers } from './messaging/providers'
import type { Command } from '../src/domain/commands'
import type { BusinessState } from '../src/domain/model'

/**
 * Keep-then-call online: whatever reaches an outside service is marked and kept in Neon first, so
 * two instances racing over one database copy can never send the same message twice.
 */
const origin = 'https://saleane-app.example.invalid'
const password = 'Fictional hosted account 2026!'
const folders: string[] = []
const apps: HostedApp[] = []
let clock: number
let sent: { by: string; message: OutgoingMessage }[]

beforeEach(() => {
  clock = Date.parse('2026-10-06T07:00:00.000Z')
  sent = []
})
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close()
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
})

/** A live email and text sender that only writes down what it was handed. */
function providers(by: string): Providers {
  let n = 0
  const recording = (channel: 'email' | 'sms'): MessageProvider => ({
    name: channel === 'email' ? 'postmark' : 'twilio',
    live: true,
    channel,
    send: async (message) => {
      if (message.fromName === 'SALEANE') return { outcome: 'test' }
      sent.push({ by, message })
      return { outcome: 'accepted', providerRef: `${by}-${++n}` }
    },
  })
  return { email: recording('email'), sms: recording('sms'), receipt: () => null }
}

function instance(store: SnapshotStore, by: string) {
  const directory = mkdtempSync(join(tmpdir(), 'saleane-outside-'))
  folders.push(directory)
  const app = createHostedApp({
    store,
    origin,
    directory,
    now: () => clock,
    dueEveryMs: 0,
    api: { turnstile: null, providers: providers(by) },
  })
  apps.push(app)
  return app
}

type Answer = { status: number; json: <T>() => T; cookie: string }
async function call(
  app: HostedApp,
  method: string,
  url: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<Answer> {
  const input: HostedRequest = {
    method,
    url,
    headers: {
      host: new URL(origin).host,
      ...(method === 'GET' ? {} : { origin, 'content-type': 'application/json' }),
      ...headers,
    },
    body: body === undefined ? Buffer.alloc(0) : Buffer.from(JSON.stringify(body)),
    remoteAddress: '203.0.113.9',
  }
  const answer = await app.handle(input)
  return {
    status: answer.statusCode,
    json: <T>() => JSON.parse(answer.body.toString()) as T,
    cookie: String(answer.headers['set-cookie'] ?? '').split(';')[0],
  }
}

type Login = { cookie: string; csrf: string; orgId: string }
async function register(app: HostedApp, email: string, name = 'Linden Studio'): Promise<Login> {
  const answer = await call(app, 'POST', '/api/auth/register', {
    name: 'Ada Owner',
    email,
    password,
    workspace: { name, locationName: 'London', region: 'UK', sample: false },
  })
  expect(answer.status).toBe(201)
  return { ...answer.json<{ csrf: string; orgId: string }>(), cookie: answer.cookie }
}
const auth = (login: Login) => ({ cookie: login.cookie, 'x-csrf-token': login.csrf })
async function workspace(app: HostedApp, login: Login) {
  const answer = await call(app, 'GET', `/api/workspaces/${login.orgId}`, undefined, auth(login))
  expect(answer.status).toBe(200)
  return answer.json<{ slug: string; state: BusinessState }>()
}
async function run(app: HostedApp, login: Login, command: Command) {
  const { state } = await workspace(app, login)
  const answer = await call(
    app,
    'POST',
    `/api/workspaces/${login.orgId}/commands`,
    { revision: state.revision, command },
    { ...auth(login), 'idempotency-key': crypto.randomUUID() },
  )
  expect(answer.status).toBe(200)
  return answer.json<{ recordId: string }>().recordId
}

/** A real (not sample) studio taking online bookings, and one guest booking that needs a confirmation. */
async function bookedStudio(app: HostedApp) {
  const owner = await register(app, 'owner@example.invalid')
  await run(app, owner, { type: 'resource', input: { name: 'Room One', type: 'treatment' } })
  const serviceId = await run(app, owner, {
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
  const staffId = await run(app, owner, {
    type: 'staff',
    input: { name: 'Maya Lind', role: 'Facialist', serviceIds: [serviceId], tone: 'sage' },
  })
  const { state, slug } = await workspace(app, owner)
  const { name, locationName, address, timeZone } = state.organisation
  await run(app, owner, {
    type: 'organisation',
    name,
    locationName,
    address,
    timeZone,
    bookingEnabled: true,
  })
  const held = await call(app, 'POST', `/api/public/${slug}/holds`, {
    serviceId,
    staffId,
    date: '2026-10-08',
    startMinutes: 600,
  })
  expect(held.status).toBe(201)
  const booked = await call(app, 'POST', `/api/public/${slug}/book`, {
    hold: held.json<{ hold: string }>().hold,
    contact: {
      name: 'Rosa Guest',
      email: 'rosa.guest@example.invalid',
      phone: '+44 7700 900333',
      marketingConsent: false,
    },
    policy: true,
  })
  expect(booked.status).toBe(200)
  return owner
}

/** Lets another instance save first, once, just as this one tries to keep its copy. */
function racing(store: SnapshotStore, other: () => Promise<unknown>) {
  let armed = false
  const raced: SnapshotStore = {
    generation: () => store.generation(),
    read: () => store.read(),
    write: async (previous, data) => {
      if (armed) {
        armed = false
        await other()
      }
      return store.write(previous, data)
    },
  }
  return { store: raced, arm: () => (armed = true) }
}

const confirmations = () => sent.filter((s) => s.message.to === 'rosa.guest@example.invalid')

describe('keep-then-call online', () => {
  it('sends a message once, even when the instance that claimed it loses its save', async () => {
    // A store with no lease, so both instances work the outbox: the worst case.
    const shared = memoryStore()
    const base: SnapshotStore = {
      generation: shared.generation,
      read: shared.read,
      write: shared.write,
    }
    // The booking is kept; its confirmation is planned on the next turn of the timed work.
    await bookedStudio(instance(base, 'setup'))
    expect(sent).toEqual([])
    const b = instance(base, 'B')
    const race = racing(base, () => register(b, 'second@example.invalid', 'Other Studio'))
    const a = instance(race.store, 'A')
    // A plans and claims the confirmation, and B saves first just as A keeps its mark.
    race.arm()
    const answer = await call(a, 'GET', '/api/health')
    expect(answer.status).toBe(200)
    // A's mark was not kept, so A sent nothing; B, which kept its own, sent it.
    expect(sent.filter((s) => s.by === 'A')).toEqual([])
    const first = confirmations()
    expect(first.length).toBeGreaterThan(0)
    expect(first.every((s) => s.by === 'B')).toBe(true)
    // Further turns on both instances never send it again.
    for (let turn = 0; turn < 3; turn += 1) {
      clock += 60000
      expect((await call(a, 'GET', '/api/health')).status).toBe(200)
      expect((await call(b, 'GET', '/api/health')).status).toBe(200)
    }
    expect(confirmations()).toHaveLength(first.length)
    const channels = first.map((s) => s.message.channel)
    expect(new Set(channels).size).toBe(channels.length)
  })

  it('lets only the instance holding the lease run the timed work', async () => {
    const store = memoryStore(() => clock)
    const a = instance(store, 'A')
    const b = instance(store, 'B')
    await bookedStudio(a)
    expect(sent).toEqual([])
    for (let turn = 0; turn < 4; turn += 1) {
      clock += 10000
      expect((await call(b, 'GET', '/api/health')).status).toBe(200)
    }
    // A took the lease while setting up and still holds it, so B never sends.
    expect(sent).toEqual([])
    // Once A has stopped renewing it, B takes over and the confirmation goes, once.
    clock += 120000
    await call(b, 'GET', '/api/health')
    await call(b, 'GET', '/api/health')
    expect(confirmations().length).toBeGreaterThan(0)
    expect(sent.every((s) => s.by === 'B')).toBe(true)
  })
})
