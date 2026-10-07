// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApiHandler } from './app'
import type { ApiHandler, ApiOptions } from './app'
import { HOLD_LIMITS } from './context'
import { TURNSTILE_TEST_KEYS, siteverify, turnstileFromEnv } from './turnstile'
import type { BusinessState } from '../src/domain/model'
import type { Command } from '../src/domain/commands'

const origin = 'http://127.0.0.1:5173'
const contact = {
  name: 'New Guest',
  email: 'new.guest@example.invalid',
  phone: '+44 7700 900111',
  marketingConsent: false,
}
type Login = { cookie: string; csrf: string; orgId: string }
let api: ApiHandler
let clock: number

function start(options: Partial<ApiOptions> = {}) {
  api?.close()
  api = createApiHandler({
    origin,
    databasePath: ':memory:',
    now: () => clock,
    turnstile: null,
    ...options,
  })
}
beforeEach(() => {
  clock = Date.parse('2026-10-06T08:00:00.000Z')
  start()
})
afterEach(() => api.close())

async function register(): Promise<Login & { slug: string; state: BusinessState }> {
  const response = await api.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: {
      name: 'Ada Owner',
      email: 'owner@example.invalid',
      password: 'Fictional local account 2026!',
      workspace: { name: 'Reference Studio', locationName: 'London', region: 'UK', sample: true },
    },
  })
  expect(response.statusCode, response.body).toBe(201)
  const result = response.json<{ csrf: string; orgId: string }>()
  const login = {
    ...result,
    cookie: String(response.headers['set-cookie']).split(';')[0],
  }
  const workspace = await api.inject({
    url: `/api/workspaces/${login.orgId}`,
    headers: { cookie: login.cookie, 'x-csrf-token': login.csrf },
  })
  return { ...login, ...workspace.json<{ slug: string; state: BusinessState }>() }
}
function command(login: Login, revision: number, change: Command) {
  return api.inject({
    method: 'POST',
    url: `/api/workspaces/${login.orgId}/commands`,
    headers: {
      cookie: login.cookie,
      'x-csrf-token': login.csrf,
      'idempotency-key': crypto.randomUUID(),
    },
    payload: { revision, command: change },
  })
}
function botCheckSetting(owner: Login & { state: BusinessState }, on: boolean) {
  const { name, locationName, address, timeZone } = owner.state.organisation
  return command(owner, owner.state.revision, {
    type: 'organisation',
    name,
    locationName,
    address,
    timeZone,
    bookingEnabled: true,
    botCheck: on,
  })
}
// Facial plus buffer runs 75 minutes, so these starts never overlap for one professional.
const SPACED = [540, 630, 720, 810, 900, 990]
// Two facial professionals share two rooms: spread holds over times and days.
const spread = (index: number) => ({
  staffId: 'any',
  date: `2026-10-${String(7 + Math.floor(index / 12)).padStart(2, '0')}`,
  startMinutes: SPACED[Math.floor(index / 2) % SPACED.length],
})
type HoldOptions = {
  staffId?: string
  startMinutes?: number
  date?: string
  from?: string
  extra?: Record<string, unknown>
}
function hold(slug: string, options: HoldOptions = {}) {
  return api.inject({
    method: 'POST',
    url: `/api/public/${slug}/holds`,
    remoteAddress: options.from ?? '198.51.100.1',
    payload: {
      serviceId: 'service-facial',
      staffId: options.staffId ?? 'staff-maya',
      date: options.date ?? '2026-10-07',
      startMinutes: options.startMinutes ?? 540,
      ...options.extra,
    },
  })
}
function book(slug: string, held: string) {
  return api.inject({
    method: 'POST',
    url: `/api/public/${slug}/book`,
    payload: { hold: held, contact, policy: true },
  })
}
async function times(slug: string, staffId = 'staff-maya', date = '2026-10-07') {
  const response = await api.inject({
    url: `/api/public/${slug}/availability?${new URLSearchParams({ serviceId: 'service-facial', staffId, date })}`,
  })
  return response.json<{ times: number[] }>().times
}
const activeHolds = () =>
  api.database.get<{ count: number }>(
    'SELECT count(*) AS count FROM booking_holds WHERE appointment_id IS NULL AND expires_at>?',
    clock,
  )!.count

describe('public hold expiry', () => {
  it('frees a held time after five minutes and refuses to book the lapsed hold', async () => {
    const { slug } = await register()
    const held = await hold(slug)
    expect(held.statusCode, held.body).toBe(201)
    expect(Date.parse(held.json<{ expiresAt: string }>().expiresAt) - clock).toBe(
      HOLD_LIMITS.HOLD_MS,
    )
    expect(await times(slug)).not.toContain(540)
    clock += HOLD_LIMITS.HOLD_MS
    expect(await times(slug)).toContain(540)
    expect((await book(slug, held.json<{ hold: string }>().hold)).statusCode).toBe(409)
  })
})

describe('one visitor cannot stack holds', () => {
  it('keeps only the newest holds from one address while it tries to hold a whole morning', async () => {
    const { slug } = await register()
    const tokens: string[] = []
    for (const startMinutes of SPACED) {
      const response = await hold(slug, { startMinutes })
      expect(response.statusCode, response.body).toBe(201)
      tokens.push(response.json<{ hold: string }>().hold)
    }
    expect(activeHolds()).toBe(HOLD_LIMITS.HOLDS_PER_VISITOR)
    const free = await times(slug)
    for (const released of SPACED.slice(0, -2)) expect(free).toContain(released)
    for (const kept of SPACED.slice(-2)) expect(free).not.toContain(kept)
    // A replaced hold cannot be redeemed; the newest one still books.
    expect((await book(slug, tokens[0])).statusCode).toBe(409)
    expect((await book(slug, tokens.at(-1)!)).statusCode).toBe(200)
  })
  it('releases the hold a visitor names as replaced before taking the new time', async () => {
    const { slug } = await register()
    const first = (await hold(slug)).json<{ hold: string }>().hold
    const second = await hold(slug, { startMinutes: 720, extra: { replaces: first } })
    expect(second.statusCode, second.body).toBe(201)
    expect(activeHolds()).toBe(1)
    expect(await times(slug)).toContain(540)
  })
  it('leaves other guests’ holds alone when the replaced token matches nothing', async () => {
    const { slug } = await register()
    const theirs = (await hold(slug, { from: '198.51.100.2' })).json<{ hold: string }>().hold
    const mine = await hold(slug, {
      startMinutes: 720,
      extra: { replaces: 'x'.repeat(43) },
    })
    expect(mine.statusCode).toBe(201)
    expect(activeHolds()).toBe(2)
    expect((await book(slug, theirs)).statusCode).toBe(200)
  })
  it('keeps the visitor’s existing holds when a new hold is refused', async () => {
    const { slug } = await register()
    expect((await hold(slug, { startMinutes: 540 })).statusCode).toBe(201)
    expect((await hold(slug, { startMinutes: 720 })).statusCode).toBe(201)
    expect((await hold(slug, { startMinutes: 900, from: '198.51.100.9' })).statusCode).toBe(201)
    expect((await hold(slug, { startMinutes: 900 })).statusCode).toBe(409)
    expect(await times(slug)).not.toContain(540)
    expect(await times(slug)).not.toContain(720)
  })
})

describe('public hold rate limits', () => {
  it('refuses a burst of holds from one address within a minute, then recovers', async () => {
    const { slug } = await register()
    const statuses: number[] = []
    for (let attempt = 0; attempt <= HOLD_LIMITS.HOLDS_PER_MINUTE; attempt += 1)
      statuses.push((await hold(slug, { startMinutes: SPACED[attempt % 2] })).statusCode)
    expect(statuses.slice(0, -1).every((status) => status === 201)).toBe(true)
    expect(statuses.at(-1)).toBe(429)
    // Another guest is not affected by one address hitting its limit.
    expect((await hold(slug, { startMinutes: 900, from: '198.51.100.7' })).statusCode).toBe(201)
    clock += 61000
    expect((await hold(slug, { startMinutes: 720 })).statusCode).toBe(201)
  })
  it('caps a slow, steady stream of holds from one address each hour', async () => {
    const { slug } = await register()
    for (let attempt = 0; attempt < HOLD_LIMITS.HOLDS_PER_HOUR; attempt += 1) {
      const response = await hold(slug, { startMinutes: SPACED[attempt % 2] })
      expect(response.statusCode, `attempt ${attempt}: ${response.body}`).toBe(201)
      clock += 20000
    }
    expect((await hold(slug, { startMinutes: 720 })).statusCode).toBe(429)
    clock += 60 * 60000
    expect((await hold(slug, { startMinutes: 720 })).statusCode).toBe(201)
  })
})

describe('studio-wide hold cap', () => {
  it('stops many addresses from holding the whole calendar, and frees room as holds resolve', async () => {
    const { slug, state } = await register()
    const professionals = state.staff.filter((person) => !person.archived)
    const cap = Math.max(
      HOLD_LIMITS.STUDIO_HOLDS_MIN,
      HOLD_LIMITS.STUDIO_HOLDS_PER_PROFESSIONAL * professionals.length,
    )
    const tokens: string[] = []
    for (let index = 0; index < cap; index += 1) {
      const response = await hold(slug, {
        ...spread(index),
        from: `203.0.113.${index + 1}`,
      })
      expect(response.statusCode, response.body).toBe(201)
      tokens.push(response.json<{ hold: string }>().hold)
    }
    const refused = await hold(slug, { ...spread(cap), from: '203.0.113.200' })
    expect(refused.statusCode).toBe(429)
    expect(refused.json().error).toMatch(/Many guests/)
    expect(activeHolds()).toBe(cap)
    // The calendar is never emptied: later times stay open to view.
    expect((await times(slug, 'any')).length).toBeGreaterThan(0)
    // A booked hold no longer counts against the cap.
    expect((await book(slug, tokens[0])).statusCode).toBe(200)
    expect((await hold(slug, { ...spread(cap), from: '203.0.113.200' })).statusCode).toBe(201)
  })
  it('lets the cap recover once unbooked holds expire', async () => {
    const { slug } = await register()
    for (let index = 0; index < 9; index += 1)
      await hold(slug, {
        ...spread(index),
        from: `203.0.113.${index + 1}`,
      })
    expect((await hold(slug, { ...spread(9), from: '203.0.113.50' })).statusCode).toBe(429)
    clock += HOLD_LIMITS.HOLD_MS
    expect((await hold(slug, { ...spread(9), from: '203.0.113.50' })).statusCode).toBe(201)
  })
})

describe('optional Turnstile bot check', () => {
  // Emulates Cloudflare siteverify for its published test secrets, with no network.
  const calls: URLSearchParams[] = []
  const cloudflare = (async (_url: string, init: { body: URLSearchParams }) => {
    calls.push(init.body)
    const success =
      init.body.get('secret') === TURNSTILE_TEST_KEYS.secretKey &&
      init.body.get('response') === TURNSTILE_TEST_KEYS.dummyToken
    return new Response(JSON.stringify({ success }), { status: 200 })
  }) as unknown as typeof fetch
  const withKeys = (secret = TURNSTILE_TEST_KEYS.secretKey, request = cloudflare) =>
    start({
      turnstile: { siteKey: TURNSTILE_TEST_KEYS.siteKey, verify: siteverify(secret, request) },
    })
  const catalogue = async (slug: string) =>
    (await api.inject({ url: `/api/public/${slug}` })).json<{
      botCheck: { siteKey: string } | null
    }>().botCheck
  beforeEach(() => {
    calls.length = 0
  })

  it('is off by default and cannot be switched on without server keys', async () => {
    const owner = await register()
    expect(await catalogue(owner.slug)).toBeNull()
    const refused = await botCheckSetting(owner, true)
    expect(refused.statusCode).toBe(422)
    expect(refused.json().error).toMatch(/Turnstile keys/)
    expect((await hold(owner.slug)).statusCode).toBe(201)
  })
  it('stays off with keys present until the studio switches it on', async () => {
    withKeys()
    const owner = await register()
    expect(await catalogue(owner.slug)).toBeNull()
    expect((await hold(owner.slug)).statusCode).toBe(201)
    expect(calls).toHaveLength(0)
  })
  it('requires a passing token for every hold once on, and can be switched off again', async () => {
    withKeys()
    const owner = await register()
    const on = await botCheckSetting(owner, true)
    expect(on.statusCode, on.body).toBe(200)
    expect(await catalogue(owner.slug)).toEqual({ siteKey: TURNSTILE_TEST_KEYS.siteKey })
    const missing = await hold(owner.slug)
    expect(missing.statusCode).toBe(403)
    expect(calls).toHaveLength(0)
    expect((await hold(owner.slug, { extra: { botCheck: 'forged' } })).statusCode).toBe(403)
    expect(activeHolds()).toBe(0)
    const passed = await hold(owner.slug, {
      extra: { botCheck: TURNSTILE_TEST_KEYS.dummyToken },
    })
    expect(passed.statusCode, passed.body).toBe(201)
    expect(calls.at(-1)?.get('remoteip')).toBe('198.51.100.1')
    const off = await botCheckSetting({ ...owner, state: { ...owner.state, revision: 1 } }, false)
    expect(off.statusCode, off.body).toBe(200)
    expect(await catalogue(owner.slug)).toBeNull()
    expect((await hold(owner.slug, { startMinutes: 720 })).statusCode).toBe(201)
  })
  it('refuses holds with Cloudflare’s always-failing test secret', async () => {
    withKeys(TURNSTILE_TEST_KEYS.failingSecretKey)
    const owner = await register()
    expect((await botCheckSetting(owner, true)).statusCode).toBe(200)
    const refused = await hold(owner.slug, {
      extra: { botCheck: TURNSTILE_TEST_KEYS.dummyToken },
    })
    expect(refused.statusCode).toBe(403)
  })
  it('fails closed when Cloudflare cannot be reached', async () => {
    withKeys(TURNSTILE_TEST_KEYS.secretKey, (async () => {
      throw new Error('offline')
    }) as unknown as typeof fetch)
    const owner = await register()
    expect((await botCheckSetting(owner, true)).statusCode).toBe(200)
    expect(
      (await hold(owner.slug, { extra: { botCheck: TURNSTILE_TEST_KEYS.dummyToken } })).statusCode,
    ).toBe(403)
    expect(activeHolds()).toBe(0)
  })
  it('reads both keys from the environment or stays unavailable', () => {
    expect(turnstileFromEnv({})).toBeNull()
    expect(turnstileFromEnv({ TURNSTILE_SITE_KEY: TURNSTILE_TEST_KEYS.siteKey })).toBeNull()
    expect(
      turnstileFromEnv({
        TURNSTILE_SITE_KEY: TURNSTILE_TEST_KEYS.siteKey,
        TURNSTILE_SECRET_KEY: TURNSTILE_TEST_KEYS.secretKey,
      })?.siteKey,
    ).toBe(TURNSTILE_TEST_KEYS.siteKey)
  })
})

describe('tax during a hold', () => {
  it('refuses to confirm a held time once the studio tax changes, so the shown price stands', async () => {
    const owner = await register()
    const held = (await hold(owner.slug)).json<{ hold: string }>().hold
    const changed = await command(owner, owner.state.revision, {
      type: 'tax',
      label: 'VAT',
      rateBps: 2000,
      inclusive: false,
    })
    expect(changed.statusCode, changed.body).toBe(200)
    const refused = await book(owner.slug, held)
    expect(refused.statusCode).toBe(409)
    expect(refused.json().error).toMatch(/changed during the reservation/)
    // A fresh hold under the new setting books normally.
    const again = (await hold(owner.slug, { startMinutes: 720 })).json<{ hold: string }>().hold
    expect((await book(owner.slug, again)).statusCode).toBe(200)
  })
  it('still confirms holds made before the tax setting was kept with them', async () => {
    const { slug } = await register()
    const held = (await hold(slug)).json<{ hold: string }>().hold
    const row = api.database.get<{ input: string }>('SELECT input FROM booking_holds')!
    const legacy = JSON.parse(row.input) as Record<string, unknown>
    delete legacy.tax
    api.database.run('UPDATE booking_holds SET input=?', JSON.stringify(legacy))
    expect((await book(slug, held)).statusCode).toBe(200)
  })
})
