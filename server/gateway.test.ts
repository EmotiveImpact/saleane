// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { createApiHandler } from './app'
import type { ApiHandler } from './app'
import { gateway, gatewayFromEnv } from './gateway'
import type { GatewayOptions } from './gateway'
import type { BusinessState } from '../src/domain/model'
import type { Command } from '../src/domain/commands'

// The messaging gateway: one connection for every studio, with the studio and location fixed by
// the line and the guest, never by the AI. Fictional studios and guests only.
const origin = 'http://127.0.0.1:5173'
const KEY = 'fictional-gateway-key-for-tests-only-0123456789'
const SHARED = 'keiki:imessage:shared-test-line'
type Login = { cookie: string; csrf: string; orgId: string }
type ToolResult = {
  content: { type: 'text'; text: string }[]
  structuredContent?: Record<string, unknown>
  isError?: boolean
}
type Day = { date: string; times: string[] }

let api: ApiHandler
let clock: number
const make = (options: GatewayOptions = { mode: 'on', key: KEY }, databasePath = ':memory:') => {
  clock = Date.parse('2026-10-06T07:00:00.000Z')
  api = createApiHandler({
    origin,
    databasePath,
    now: () => clock,
    turnstile: null,
    gateway: options,
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
async function ok(login: Login, command: Command) {
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
async function studio(
  name: string,
  email: string,
  options: { on?: boolean; sample?: boolean } = {},
) {
  const response = await api.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: {
      name: 'Ada Owner',
      email,
      password: 'Fictional local account 2026!',
      workspace: { name, locationName: 'London', region: 'UK', sample: options.sample ?? false },
    },
  })
  expect(response.statusCode, response.body).toBe(201)
  const login = {
    ...response.json<{ csrf: string; orgId: string }>(),
    cookie: String(response.headers['set-cookie']).split(';')[0],
  }
  if (options.sample) return { login, slug: (await workspace(login)).slug, facial: '' }
  await ok(login, { type: 'resource', input: { name: 'Room One', type: 'treatment' } })
  const facial = await ok(login, {
    type: 'service',
    input: {
      name: `${name} facial`,
      description: 'A fictional facial',
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
    input: { name: `${name} Maya`, role: 'Facialist', serviceIds: [facial], tone: 'sage' },
  })
  const s = (await workspace(login)).state.organisation
  await ok(login, {
    type: 'organisation',
    name: s.name,
    locationName: s.locationName,
    address: s.address,
    timeZone: s.timeZone,
    bookingEnabled: true,
  })
  if (options.on ?? true) await ok(login, { type: 'ai-booking', settings: { enabled: true } })
  return { login, slug: (await workspace(login)).slug, facial }
}

const call = (
  body: unknown,
  extra: Record<string, string> = {},
  who: { line?: string; customer?: string } = {},
) =>
  api.inject({
    method: 'POST',
    url: '/api/gateway/mcp',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${KEY}`,
      'saleane-line': who.line ?? SHARED,
      'saleane-customer': who.customer ?? '+44 7700 900111',
      ...extra,
    },
    rawPayload: JSON.stringify(body),
  })
let rpcId = 0
async function tool(
  name: string,
  args: Record<string, unknown> = {},
  who: { line?: string; customer?: string } = {},
) {
  const response = await call(
    { jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name, arguments: args } },
    {},
    who,
  )
  expect(response.statusCode, response.body).toBe(200)
  const body = response.json<{ result?: ToolResult; error?: { message: string } }>()
  expect(body.error, response.body).toBeUndefined()
  return body.result!
}
const words = (r: ToolResult) => r.content.map((c) => c.text).join('\n')
async function firstFree(treatment: string, who: { line?: string; customer?: string } = {}) {
  const days = (await tool('find_free_times', { treatment_id: treatment }, who)).structuredContent!
    .days as Day[]
  const open = days.find((d) => d.times.length > 0)!
  return { date: open.date, start: open.times[0] }
}
const guest = { guest_name: 'Rosa Field', guest_email: 'rosa@example.invalid' }
const visitsIn = async (login: Login) => (await workspace(login)).state.appointments
/** The carrier, holding the gateway key, sets up a line it gave one studio. */
const provision = (line: string, bookingPage: string, key = KEY) =>
  api.inject({
    method: 'POST',
    url: '/api/gateway/lines',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    payload: { line, bookingPage },
  })
const claim = (login: Login, line: string, locationId?: string) =>
  api.inject({
    method: 'POST',
    url: `/api/workspaces/${login.orgId}/gateway/lines`,
    headers: headers(login),
    payload: { line, ...(locationId ? { locationId } : {}) },
  })

describe('the messaging gateway', () => {
  it('is off unless turned on with a long key, and answers only the carrier', async () => {
    expect(gatewayFromEnv({})).toEqual({ mode: 'off', key: '' })
    expect(() => gatewayFromEnv({ SALEANE_GATEWAY: 'on', SALEANE_GATEWAY_KEY: 'short' })).toThrow(
      /32/,
    )
    api.close()
    make({ mode: 'off', key: '' })
    expect((await call({ jsonrpc: '2.0', id: 1, method: 'ping' })).statusCode).toBe(404)
    api.close()
    make()
    const ping = { jsonrpc: '2.0', id: 1, method: 'ping' }
    expect((await call(ping)).statusCode).toBe(200)
    expect((await call(ping, { authorization: 'Bearer wrong-key' })).statusCode).toBe(401)
    expect((await call(ping, { origin: 'https://evil.example.invalid' })).statusCode).toBe(403)
    expect((await call(ping, {}, { line: '' })).statusCode).toBe(400)
    expect((await call(ping, {}, { customer: '' })).statusCode).toBe(400)
    // The same key on every instance gives the same salt, so a retry lands on the same visit.
    expect(gateway({ mode: 'on', key: KEY }).salt).toBe(gateway({ mode: 'on', key: KEY }).salt)
    const list = await call({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
    const names = list
      .json<{ result: { tools: { name: string }[] } }>()
      .result.tools.map((t) => t.name)
    expect(names).toEqual([
      'choose_studio',
      'studio_details',
      'list_treatments',
      'find_free_times',
      'book_time',
    ])
  })

  it('books on a shared line only after the guest chose the studio and said yes, once', async () => {
    const linden = await studio('Linden Studio', 'linden@example.invalid')
    const other = await studio('Harbour Spa', 'harbour@example.invalid')
    // Nothing is guessed before the guest chooses.
    const unchosen = await tool('list_treatments')
    expect(unchosen.isError).toBe(true)
    expect(words(unchosen)).toMatch(/not chosen a studio/)
    expect((await tool('choose_studio', { booking_page: 'no-such-studio' })).isError).toBe(true)
    const chosen = await tool('choose_studio', {
      booking_page: `https://saleane-app.example.invalid/book/${linden.slug}`,
    })
    expect(chosen.isError, words(chosen)).toBeFalsy()
    expect(words(await tool('list_treatments'))).toContain('Linden Studio facial')
    expect(words(await tool('list_treatments'))).not.toContain('Harbour Spa facial')
    const time = await firstFree(linden.facial)
    const asked = { treatment_id: linden.facial, ...time, ...guest }
    const refused = await tool('book_time', { ...asked, guest_confirmed: false })
    expect(refused.isError).toBe(true)
    expect(await visitsIn(linden.login)).toHaveLength(0)
    const booked = await tool('book_time', { ...asked, guest_confirmed: true })
    expect(booked.isError, words(booked)).toBeFalsy()
    // The message was retried: the same visit, not a second one.
    const again = await tool('book_time', { ...asked, guest_confirmed: true })
    expect(again.isError, words(again)).toBeFalsy()
    const reference = (r: typeof booked) =>
      (r.structuredContent as { visit?: { reference?: string } } | undefined)?.visit?.reference
    expect(reference(booked)).toBeTruthy()
    expect(reference(again)).toBe(reference(booked))
    // A fresh read of the saved diary holds exactly that one visit, at the studio's location.
    const visits = await visitsIn(linden.login)
    expect(visits).toHaveLength(1)
    expect(visits[0].id).toBe(reference(booked))
    expect(visits[0].locationId).toBe((await workspace(linden.login)).state.organisation.locationId)
    expect(visits[0].channel).toBe('imessage')
    // The phone the guest wrote from is used when the AI gave none.
    const client = (await workspace(linden.login)).state.clients.find(
      (c) => c.id === visits[0].clientId,
    )
    expect(client?.phone.replace(/\s/g, '')).toContain('7700900111')
    // The other studio's diary is untouched.
    expect(await visitsIn(other.login)).toHaveLength(0)
  })

  it('keeps each guest on the studio they chose, so two studios never see each other', async () => {
    const linden = await studio('Linden Studio', 'linden@example.invalid')
    const harbour = await studio('Harbour Spa', 'harbour@example.invalid')
    const rosa = { customer: '+44 7700 900111' }
    const sam = { customer: '+44 7700 900222' }
    await tool('choose_studio', { booking_page: linden.slug }, rosa)
    await tool('choose_studio', { booking_page: harbour.slug }, sam)
    // Rosa cannot reach Harbour's treatments by naming them: the tools run for Linden only.
    const wrong = await tool('find_free_times', { treatment_id: harbour.facial }, rosa)
    expect(wrong.isError).toBe(true)
    const time = await firstFree(harbour.facial, sam)
    const booked = await tool(
      'book_time',
      {
        treatment_id: harbour.facial,
        ...time,
        guest_name: 'Sam Reed',
        guest_email: 'sam@example.invalid',
        guest_confirmed: true,
      },
      sam,
    )
    expect(booked.isError, words(booked)).toBeFalsy()
    expect(await visitsIn(harbour.login)).toHaveLength(1)
    expect(await visitsIn(linden.login)).toHaveLength(0)
    // A location the AI makes up is refused.
    const elsewhere = await tool(
      'find_free_times',
      { treatment_id: linden.facial, location_id: 'loc-made-up' },
      rosa,
    )
    expect(elsewhere.isError).toBe(true)
  })

  it("runs a studio's own line for that studio, and refuses the line to anyone else", async () => {
    const linden = await studio('Linden Studio', 'linden@example.invalid')
    const harbour = await studio('Harbour Spa', 'harbour@example.invalid')
    const own = 'keiki:whatsapp:+447700900999'
    expect((await provision(own, linden.slug)).statusCode).toBe(201)
    const added = await api.inject({
      method: 'POST',
      url: `/api/workspaces/${linden.login.orgId}/gateway/lines`,
      headers: headers(linden.login),
      payload: { line: own },
    })
    expect(added.statusCode, added.body).toBe(201)
    const taken = await api.inject({
      method: 'POST',
      url: `/api/workspaces/${harbour.login.orgId}/gateway/lines`,
      headers: headers(harbour.login),
      payload: { line: own.toUpperCase() },
    })
    expect(taken.statusCode).toBe(409)
    expect(taken.body).not.toContain('Linden')
    const who = { line: own, customer: '+44 7700 900333' }
    // No choosing on a studio's own line, and a guest cannot move it to another studio.
    expect((await tool('choose_studio', { booking_page: harbour.slug }, who)).isError).toBe(true)
    const time = await firstFree(linden.facial, who)
    const booked = await tool(
      'book_time',
      { treatment_id: linden.facial, ...time, ...guest, guest_confirmed: true },
      who,
    )
    expect(booked.isError, words(booked)).toBeFalsy()
    const visits = await visitsIn(linden.login)
    expect(visits).toHaveLength(1)
    expect(visits[0].channel).toBe('whatsapp')
    // Only the owner manages lines.
    const view = await api.inject({
      url: `/api/workspaces/${linden.login.orgId}/gateway`,
      headers: headers(linden.login),
    })
    expect(view.json<{ lines: { label: string }[] }>().lines.map((l) => l.label)).toEqual([own])
  })

  it("never lets an owner take a shared line or another studio's guests", async () => {
    const linden = await studio('Linden Studio', 'linden@example.invalid')
    const harbour = await studio('Harbour Spa', 'harbour@example.invalid')
    const rosa = { customer: '+44 7700 900111' }
    await tool('choose_studio', { booking_page: harbour.slug }, rosa)
    const before = words(await tool('list_treatments', {}, rosa))
    expect(before).toContain('Harbour Spa facial')
    // Being an owner is not proof of a line: the shared line was never set up for Linden.
    const grab = await claim(linden.login, SHARED)
    expect(grab.statusCode).toBe(409)
    // Nor can the carrier set the shared line up for one studio while others' guests use it.
    expect((await provision(SHARED, linden.slug)).statusCode).toBe(409)
    // Setting up needs the gateway key.
    expect(
      (await provision('keiki:imessage:+447700900888', linden.slug, 'x'.repeat(40))).statusCode,
    ).toBe(401)
    // Rosa's choice and routing are untouched.
    expect(words(await tool('list_treatments', {}, rosa))).toBe(before)
    // A line set up for Linden cannot be claimed by Harbour, or set up again for Harbour.
    const dedicated = 'keiki:imessage:+447700900888'
    expect((await provision(dedicated, linden.slug)).statusCode).toBe(201)
    expect((await claim(harbour.login, dedicated)).statusCode).toBe(409)
    expect((await provision(dedicated, harbour.slug)).statusCode).toBe(409)
    const view = await api.inject({
      url: `/api/workspaces/${harbour.login.orgId}/gateway`,
      headers: headers(harbour.login),
    })
    expect(view.json<{ lines: unknown[] }>().lines).toEqual([])
    expect((await claim(linden.login, dedicated)).statusCode).toBe(201)
    // Still nothing changed for Rosa on the shared line.
    expect(words(await tool('list_treatments', {}, rosa))).toBe(before)
  })

  it('needs the guest to choose a location at a studio with several, and keeps it fixed', async () => {
    const linden = await studio('Linden Studio', 'linden@example.invalid')
    const harbour = await studio('Harbour Spa', 'harbour@example.invalid')
    const { state } = await workspace(linden.login)
    const london = state.organisation.locationId
    const islington = await ok(linden.login, {
      type: 'location-open',
      location: { name: 'Islington', address: '1 Upper Street, London' },
      rooms: [{ name: 'Islington room 1', type: 'treatment' }],
      team: [{ staffId: state.staff[0].id, days: [1, 2, 3, 4, 5, 6] }],
      newTeam: [],
      notOffered: [],
      prices: [],
    } as Command)
    const rosa = { customer: '+44 7700 900111' }
    const chosen = await tool('choose_studio', { booking_page: linden.slug }, rosa)
    expect(words(chosen)).toMatch(/several locations/)
    // No location chosen: availability and booking ask for one, even when the AI names one.
    const unplaced = await tool('find_free_times', { treatment_id: linden.facial }, rosa)
    expect(unplaced.isError).toBe(true)
    expect(words(unplaced)).toMatch(/has not chosen one/)
    const named = await tool(
      'find_free_times',
      { treatment_id: linden.facial, location_id: islington },
      rosa,
    )
    expect(named.isError).toBe(true)
    // Another studio's location, or a made-up one, is refused as a choice.
    const harbourPlace = (await workspace(harbour.login)).state.organisation.locationId
    for (const location_id of [harbourPlace, 'loc-made-up'])
      expect(
        (await tool('choose_studio', { booking_page: linden.slug, location_id }, rosa)).isError,
      ).toBe(true)
    // Bound to London, the AI cannot move the guest to Islington by naming it.
    await tool('choose_studio', { booking_page: linden.slug, location_id: london }, rosa)
    const moved = await tool(
      'find_free_times',
      { treatment_id: linden.facial, location_id: islington },
      rosa,
    )
    expect(moved.isError).toBe(true)
    expect(words(moved)).toMatch(/another location/)
    // The guest chooses Islington: the visit and the saved diary are there.
    await tool('choose_studio', { booking_page: linden.slug, location_id: islington }, rosa)
    const time = await firstFree(linden.facial, rosa)
    const booked = await tool(
      'book_time',
      { treatment_id: linden.facial, ...time, ...guest, guest_confirmed: true },
      rosa,
    )
    expect(booked.isError, words(booked)).toBeFalsy()
    const visits = await visitsIn(linden.login)
    expect(visits).toHaveLength(1)
    expect(visits[0].locationId).toBe(islington)
    expect(visits[0].id).toBe(
      (booked.structuredContent as { visit: { reference: string } }).visit.reference,
    )
  })

  it('upgrades a database made by an earlier build of this gateway, keeping every choice', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'saleane-gateway-upgrade-'))
    try {
      const path = join(folder, 'saleane.sqlite')
      api.close()
      make(undefined, path)
      const linden = await studio('Linden Studio', 'linden@example.invalid')
      const rosa = { customer: '+44 7700 900111' }
      await tool('choose_studio', { booking_page: linden.slug }, rosa)
      const before = words(await tool('list_treatments', {}, rosa))
      expect(before).toContain('Linden Studio facial')
      api.close()
      // The earlier build recorded step 39 with no gateway_provisions table and no step 40.
      const raw = new DatabaseSync(path)
      raw.exec('DROP TABLE gateway_provisions; DELETE FROM schema_migrations WHERE version >= 40;')
      raw.close()
      make(undefined, path)
      const tables = api.database.all<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'gateway_%' ORDER BY name",
      )
      expect(tables.map((t) => t.name)).toEqual([
        'gateway_bindings',
        'gateway_lines',
        'gateway_provisions',
      ])
      // Rosa's choice survived the upgrade, and lines can now be set up and claimed.
      expect(words(await tool('list_treatments', {}, rosa))).toBe(before)
      const own = 'keiki:imessage:+447700900444'
      expect((await provision(own, linden.slug)).statusCode).toBe(201)
      expect((await claim(linden.login, own)).statusCode).toBe(201)
      expect(
        words(await tool('list_treatments', {}, { line: own, customer: '+44 7700 900555' })),
      ).toContain('Linden Studio facial')
    } finally {
      api.close()
      rmSync(folder, { recursive: true, force: true })
      make()
    }
  })

  it('answers nothing for a studio that has not turned it on, or a sample studio', async () => {
    const quiet = await studio('Quiet Rooms', 'quiet@example.invalid', { on: false })
    const sample = await studio('Sample House', 'sample@example.invalid', { sample: true })
    expect((await tool('choose_studio', { booking_page: quiet.slug })).isError).toBe(true)
    expect((await tool('choose_studio', { booking_page: sample.slug })).isError).toBe(true)
  })
})
