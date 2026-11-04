import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import type { IncomingMessage } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { LocalDatabase, migrations } from './database'
import { createHostedApp, memoryStore } from './hosted'
import type { HostedApp, HostedRequest, SnapshotStore } from './hosted'
import { allTestMode, visitorAddress } from './vercel'

const origin = 'https://saleane-app.example.invalid'
const password = 'correct horse battery staple'
const folders: string[] = []
const apps: HostedApp[] = []

afterEach(async () => {
  for (const app of apps.splice(0)) await app.close()
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
})

function instance(store: SnapshotStore, retries = 0) {
  const directory = mkdtempSync(join(tmpdir(), 'saleane-hosted-'))
  folders.push(directory)
  const app = createHostedApp({ store, origin, directory, retries, api: { turnstile: null } })
  apps.push(app)
  return app
}

function request(
  method: string,
  url: string,
  body?: unknown,
  headers: Record<string, string> = {},
): HostedRequest {
  return {
    method,
    url,
    headers: {
      host: new URL(origin).host,
      ...(method === 'GET' ? {} : { origin, 'content-type': 'application/json' }),
      ...headers,
    },
    body: body === undefined ? Buffer.alloc(0) : Buffer.from(JSON.stringify(body)),
    remoteAddress: '203.0.113.7',
  }
}

const register = (app: HostedApp, email: string) =>
  app.handle(
    request('POST', '/api/auth/register', {
      name: 'Ada Owner',
      email,
      password,
      workspace: { name: 'Hosted Studio', locationName: 'London', region: 'UK', sample: false },
    }),
  )
const cookieOf = (answer: { headers: Record<string, string | string[]> }) =>
  String(answer.headers['set-cookie']).split(';')[0]
const session = (app: HostedApp, cookie: string) =>
  app.handle(request('GET', '/api/session', undefined, { cookie }))

describe('hosting without a lasting disk', () => {
  it('keeps the first copy, and copies only when something changed', async () => {
    const store = memoryStore()
    const app = instance(store)
    const health = await app.handle(request('GET', '/api/health'))
    expect(health.statusCode).toBe(200)
    // The new database, with every schema step, is the first copy.
    expect(store.writes).toBe(1)
    await app.handle(request('GET', '/api/health'))
    expect(store.writes).toBe(1)
    const created = await register(app, 'first@example.invalid')
    expect(created.statusCode, created.body.toString()).toBe(201)
    expect(store.writes).toBe(2)
    expect(app.generation).toBe(2)
  })

  it('lets a fresh instance carry on from the kept copy', async () => {
    const store = memoryStore()
    const first = instance(store)
    const created = await register(first, 'carry@example.invalid')
    expect(created.statusCode).toBe(201)
    const later = instance(store)
    const answer = await session(later, cookieOf(created))
    expect(answer.statusCode).toBe(200)
    expect(JSON.parse(answer.body.toString()).user.email).toBe('carry@example.invalid')
  })

  /** A store where another instance saves its own change just before this one's next save. */
  function racing(store: ReturnType<typeof memoryStore>, other: HostedApp, email: string) {
    let armed = false
    const raced: SnapshotStore = {
      ...store,
      write: async (previous, data) => {
        if (armed) {
          armed = false
          expect((await register(other, email)).statusCode).toBe(201)
        }
        return store.write(previous, data)
      },
    }
    return { store: raced, arm: () => (armed = true) }
  }

  it('never answers a change it could not keep, and keeps nothing of it', async () => {
    const store = memoryStore()
    const other = instance(store)
    const race = racing(store, other, 'other@example.invalid')
    const app = instance(race.store)
    await app.handle(request('GET', '/api/health'))
    race.arm()
    const refused = await register(app, 'refused@example.invalid')
    expect(refused.statusCode).toBe(503)
    expect(JSON.parse(refused.body.toString()).error).toMatch(/not saved/)
    // The other change was kept, and nothing of the refused one: its address is still free.
    const fresh = instance(store)
    expect((await register(fresh, 'other@example.invalid')).statusCode).toBe(409)
    expect((await register(fresh, 'refused@example.invalid')).statusCode).toBe(201)
  })

  it('runs a refused request again on the newer copy when that is safe', async () => {
    const store = memoryStore()
    const other = instance(store)
    const race = racing(store, other, 'other2@example.invalid')
    const app = instance(race.store, 2)
    await app.handle(request('GET', '/api/health'))
    race.arm()
    const created = await register(app, 'raced@example.invalid')
    expect(created.statusCode, created.body.toString()).toBe(201)
    // Both changes are in the kept copy.
    const fresh = instance(store)
    expect((await session(fresh, cookieOf(created))).statusCode).toBe(200)
    expect((await register(fresh, 'other2@example.invalid')).statusCode).toBe(409)
  })

  it('refuses a copy made by a newer SALEANE instead of changing it', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'saleane-newer-'))
    folders.push(folder)
    const file = join(folder, 'newer.sqlite')
    const newer = new LocalDatabase(file, [
      ...migrations,
      { version: migrations.length + 1, up: () => {} },
    ])
    newer.connection.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    newer.close()
    const store = memoryStore()
    await store.write(0, gzipSync(readFileSync(file)))
    const app = instance(store)
    const answer = await app.handle(request('GET', '/api/health'))
    expect(answer.statusCode).toBe(503)
    expect(store.writes).toBe(1)
  })

  it('serves one request at a time so each copy holds whole requests', async () => {
    const store = memoryStore()
    const app = instance(store)
    const answers = await Promise.all(
      Array.from({ length: 4 }, (_, i) => register(app, `queue${i}@example.invalid`)),
    )
    expect(answers.map((answer) => answer.statusCode)).toEqual([201, 201, 201, 201])
    expect(app.generation).toBe(5)
  })
})

describe('the Vercel function', () => {
  const asRequest = (headers: Record<string, string>) =>
    ({ headers, socket: { remoteAddress: '10.0.0.1' } }) as unknown as IncomingMessage

  it("takes the visitor's address from Vercel's own headers", () => {
    expect(visitorAddress(asRequest({ 'x-real-ip': '198.51.100.4' }))).toBe('198.51.100.4')
    expect(visitorAddress(asRequest({ 'x-forwarded-for': '198.51.100.5, 10.0.0.2' }))).toBe(
      '198.51.100.5',
    )
    expect(visitorAddress(asRequest({}))).toBe('10.0.0.1')
  })

  it('runs refused requests again only while nothing reaches a real service', () => {
    expect(allTestMode({})).toBe(true)
    expect(allTestMode({ SALEANE_EMAIL_PROVIDER: 'test', SALEANE_SOCIAL: 'off' })).toBe(true)
    expect(allTestMode({ SALEANE_PAYMENTS_PROVIDER: 'stripe' })).toBe(false)
    expect(allTestMode({ SALEANE_CONNECTIONS: 'live' })).toBe(false)
    expect(allTestMode({ OPENAI_PROJECT_ID: 'proj_1' })).toBe(false)
  })
})
