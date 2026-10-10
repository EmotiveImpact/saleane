// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApiHandler } from './app'
import type { ApiHandler } from './app'
import { aiBookingFromEnv } from './aiBooking'
import type { AiBookingOptions } from './aiBooking'
import type { BusinessState } from '../src/domain/model'
import type { Command } from '../src/domain/commands'

// Stage 5: booking through ChatGPT or Claude. A studio's remote MCP server, in test mode.
const origin = 'http://127.0.0.1:5173'
type Login = { cookie: string; csrf: string; orgId: string }
type Rpc = {
  jsonrpc: '2.0'
  id: string | number | null
  result?: Record<string, unknown>
  error?: { code: number; message: string }
}
type ToolResult = {
  content: { type: 'text'; text: string }[]
  structuredContent?: Record<string, unknown>
  isError?: boolean
}
type Day = { date: string; weekday: string; closed: boolean; times: string[] }

let api: ApiHandler
let clock: number
const make = (aiBooking: AiBookingOptions = { mode: 'test' }, at = origin) => {
  clock = Date.parse('2026-10-06T07:00:00.000Z')
  api = createApiHandler({
    origin: at,
    databasePath: ':memory:',
    now: () => clock,
    turnstile: null,
    aiBooking,
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
async function run(login: Login, command: Command) {
  const { state } = await workspace(login)
  return api.inject({
    method: 'POST',
    url: `/api/workspaces/${login.orgId}/commands`,
    headers: { ...headers(login), 'idempotency-key': crypto.randomUUID() },
    payload: { revision: state.revision, command },
  })
}
async function ok(login: Login, command: Command) {
  const response = await run(login, command)
  expect(response.statusCode, response.body).toBe(200)
  return response.json<{ recordId: string }>().recordId
}
async function register(sample = false, email = 'owner@example.invalid'): Promise<Login> {
  const response = await api.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: {
      name: 'Ada Owner',
      email,
      password: 'Fictional local account 2026!',
      workspace: { name: 'Linden Studio', locationName: 'London', region: 'UK', sample },
    },
  })
  expect(response.statusCode, response.body).toBe(201)
  return {
    ...response.json<{ csrf: string; orgId: string }>(),
    cookie: String(response.headers['set-cookie']).split(';')[0],
  }
}
const treatment = {
  name: 'Restorative facial',
  description: 'A fictional facial',
  category: 'Skin' as const,
  durationMinutes: 60,
  bufferMinutes: 15,
  priceMinor: 9500,
  depositMinor: 0,
  resourceType: 'treatment' as const,
}
let facial: string, deposit: string, tint: string, maya: string, slug: string
const bookingOn = async (login: Login, bookingEnabled: boolean) => {
  const { name, locationName, address, timeZone } = (await workspace(login)).state.organisation
  await ok(login, { type: 'organisation', name, locationName, address, timeZone, bookingEnabled })
}
async function studio(turnedOn = true) {
  const login = await register()
  await ok(login, { type: 'resource', input: { name: 'Room One', type: 'treatment' } })
  facial = await ok(login, { type: 'service', input: treatment })
  deposit = await ok(login, {
    type: 'service',
    input: { ...treatment, name: 'Deposit facial', depositMinor: 2000 },
  })
  tint = await ok(login, {
    type: 'service',
    input: { ...treatment, name: 'Brow tint', durationMinutes: 30, patchTest: true },
  })
  await ok(login, {
    type: 'patch-test-settings',
    settings: { hoursBefore: 48, validMonths: 6, remind: true, stopOnline: true },
  })
  maya = await ok(login, {
    type: 'staff',
    input: {
      name: 'Maya Lind',
      role: 'Facialist',
      serviceIds: [facial, deposit, tint],
      tone: 'sage',
    },
  })
  await bookingOn(login, true)
  if (turnedOn) await ok(login, { type: 'ai-booking', settings: { enabled: true } })
  slug = (await workspace(login)).slug
  return login
}

const post = (body: unknown, extra: Record<string, string> = {}, to = slug) =>
  api.inject({
    method: 'POST',
    url: `/api/mcp/${to}`,
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...extra,
    },
    rawPayload: typeof body === 'string' ? body : JSON.stringify(body),
  })
const rpc = (method: string, params?: unknown, id: number | string = 1) => ({
  jsonrpc: '2.0',
  id,
  method,
  ...(params === undefined ? {} : { params }),
})
/** A notification: a message with no id, which takes no reply. */
const note = (method: string) => ({ jsonrpc: '2.0', method })
const session = (id: string) => ({ 'mcp-session-id': id, 'mcp-protocol-version': '2025-06-18' })
/** Connects as an assistant would: initialize, then the initialized notification. */
async function connect(
  clientInfo: Record<string, string> = { name: 'openai-mcp', version: '1.0.0' },
) {
  const response = await post(
    rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo }),
  )
  expect(response.statusCode, response.body).toBe(200)
  const id = String(response.headers['mcp-session-id'])
  expect((await post(note('notifications/initialized'), session(id))).statusCode).toBe(202)
  return id
}
async function tool(id: string, name: string, args: Record<string, unknown> = {}) {
  const response = await post(rpc('tools/call', { name, arguments: args }, 7), session(id))
  expect(response.statusCode, response.body).toBe(200)
  const body = response.json<Rpc>()
  expect(body.error, response.body).toBeUndefined()
  return body.result as unknown as ToolResult
}
const words = (result: ToolResult) => result.content.map((c) => c.text).join('\n')
const guest = {
  guest_name: 'Rosa Field',
  guest_email: 'rosa@example.invalid',
  guest_phone: '07700 900456',
}
async function firstFree(id: string, professional?: string) {
  const days = (
    await tool(id, 'find_free_times', {
      treatment_id: facial,
      ...(professional ? { professional_id: professional } : {}),
    })
  ).structuredContent!.days as Day[]
  const open = days.filter((d) => d.times.length > 0)
  // Another free time on a later day, which never overlaps the first.
  return { date: open[0].date, start: open[0].times[0], next: open[1] }
}
const audits = (action: string) =>
  api.database.all<{ record_id: string; actor_id: string | null }>(
    'SELECT record_id,actor_id FROM audit_events WHERE action=?',
    action,
  )
const changes = async (login: Login) =>
  (
    await api.inject({ url: `/api/workspaces/${login.orgId}/changes`, headers: headers(login) })
  ).json<{ entries: { what: string; who: string }[] }>().entries

describe('Booking through ChatGPT or Claude: the connection', () => {
  it('speaks MCP over HTTP: initialize with a session, initialized, ping and the four tools', async () => {
    await studio()
    const response = await post(
      rpc('initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'openai-mcp', version: '1.0.0' },
      }),
    )
    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toMatch(/^application\/json/)
    const id = String(response.headers['mcp-session-id'])
    expect(id).toMatch(/^[A-Za-z0-9_-]{43}$/)
    const init = response.json<Rpc>()
    expect(init).toMatchObject({
      jsonrpc: '2.0',
      id: 1,
      result: {
        protocolVersion: '2025-06-18',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'saleane-booking', title: 'Linden Studio booking' },
      },
    })
    expect(init.result!.instructions).toMatch(/guest_confirmed/)
    expect(init.result!.instructions).toMatch(/Never sign the guest up for news or offers/)
    // A version this server does not speak is answered with its newest.
    const older = await post(rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {} }))
    expect(older.json<Rpc>().result!.protocolVersion).toBe('2025-11-25')
    // A notification, and an answer to something never asked, take no reply.
    const notified = await post(note('notifications/initialized'), session(id))
    expect(notified.statusCode).toBe(202)
    expect(notified.body).toBe('')
    expect((await post({ jsonrpc: '2.0', id: 3, result: {} }, session(id))).statusCode).toBe(202)
    expect((await post(rpc('ping', undefined, 2), session(id))).json()).toEqual({
      jsonrpc: '2.0',
      id: 2,
      result: {},
    })
    const listed = (await post(rpc('tools/list', {}, 'list'), session(id))).json<Rpc>()
    expect(listed.id).toBe('list')
    const tools = listed.result!.tools as {
      name: string
      inputSchema: { required?: string[]; additionalProperties: boolean }
      annotations: { readOnlyHint: boolean }
    }[]
    expect(tools.map((t) => t.name)).toEqual([
      'studio_details',
      'list_treatments',
      'find_free_times',
      'book_time',
    ])
    expect(tools.map((t) => t.annotations.readOnlyHint)).toEqual([true, true, true, false])
    expect(tools.every((t) => t.inputSchema.additionalProperties === false)).toBe(true)
    expect(tools[3].inputSchema.required).toEqual(
      expect.arrayContaining(['guest_name', 'guest_email', 'guest_phone', 'guest_confirmed']),
    )
    // The assistant can end its connection.
    const end = await api.inject({
      method: 'DELETE',
      url: `/api/mcp/${slug}`,
      headers: session(id),
    })
    expect(end.statusCode).toBe(204)
    const after = await post(rpc('ping'), session(id))
    expect(after.statusCode).toBe(404)
    expect(after.json<Rpc>().error).toMatchObject({ code: -32000, message: /Connect again/ })
    expect(
      (await api.inject({ method: 'DELETE', url: `/api/mcp/${slug}`, headers: session(id) }))
        .statusCode,
    ).toBe(404)
  })

  it('refuses what is not a single JSON-RPC message, with the right error', async () => {
    await studio()
    const id = await connect()
    const error = async (
      body: unknown,
      status: number,
      code: number,
      extra: Record<string, string> = session(id),
    ) => {
      const response = await post(body, extra)
      expect(response.statusCode, response.body).toBe(status)
      const answer = response.json<Rpc>()
      expect(answer.error?.code, response.body).toBe(code)
      return answer
    }
    expect((await error('{not json', 400, -32700)).id).toBeNull()
    await error([rpc('ping')], 400, -32600)
    await error({ jsonrpc: '1.0', id: 1, method: 'ping' }, 400, -32600)
    await error({ jsonrpc: '2.0', id: 4 }, 400, -32600)
    expect((await error(rpc('resources/list', {}, 5), 200, -32601)).id).toBe(5)
    expect(
      (await error(rpc('tools/call', { name: 'cancel_visit' }), 200, -32602)).error!.message,
    ).toMatch(/Unknown tool: cancel_visit/)
    expect(
      (await error(rpc('tools/call', { name: 'find_free_times', arguments: {} }), 200, -32602))
        .error!.message,
    ).toMatch(/treatment_id/)
    await error(
      rpc('tools/call', { name: 'studio_details', arguments: { client: 'everyone' } }),
      200,
      -32602,
    )
    await error(rpc('tools/call', { arguments: {} }), 200, -32602)
    // Every message after initialize belongs to a connection this server knows.
    expect((await error(rpc('ping'), 400, -32000, {})).error!.message).toMatch(/Connect first/)
    await error(rpc('ping'), 404, -32000, session('not-a-connection'))
    // A protocol version it does not speak, something other than JSON, a web page elsewhere.
    await error(rpc('ping'), 400, -32000, { ...session(id), 'mcp-protocol-version': '2023-01-01' })
    await error(rpc('ping'), 415, -32000, { ...session(id), 'content-type': 'text/plain' })
    await error(rpc('ping'), 403, -32000, { ...session(id), origin: 'https://elsewhere.example' })
    const got = await api.inject({ url: `/api/mcp/${slug}`, headers: session(id) })
    expect(got.statusCode).toBe(405)
    expect(got.headers.allow).toBe('POST, DELETE')
  })

  it('is off until the owner turns it on, and closes with online booking or the server mode', async () => {
    const login = await studio(false)
    const refused = async (status: number, words: RegExp, to = slug) => {
      const response = await post(rpc('initialize', { protocolVersion: '2025-06-18' }), {}, to)
      expect(response.statusCode, response.body).toBe(status)
      expect(response.json<Rpc>().error).toMatchObject({ code: -32000, message: words })
      expect(response.headers['mcp-session-id']).toBeUndefined()
    }
    await refused(404, /not turned on/)
    await refused(404, /not available/, 'no-such-studio')
    await ok(login, { type: 'ai-booking', settings: { enabled: true } })
    const id = await connect()
    expect((await changes(login))[0]).toMatchObject({
      what: 'Changed booking through ChatGPT or Claude',
      who: 'Ada Owner',
    })
    // Online booking switched off closes it too, even for an open connection.
    await bookingOn(login, false)
    await refused(404, /not available/)
    expect((await post(rpc('ping'), session(id))).statusCode).toBe(404)
    await bookingOn(login, true)
    expect((await post(rpc('ping'), session(id))).statusCode).toBe(200)
    // The owner turns it off again.
    await ok(login, { type: 'ai-booking', settings: { enabled: false } })
    await refused(404, /not turned on/)
    // A server started with it off never answers.
    api.close()
    make({ mode: 'off' })
    await studio()
    await refused(404, /not found/)
    expect(aiBookingFromEnv({})).toEqual({ mode: 'test' })
    expect(aiBookingFromEnv({ SALEANE_AI_BOOKING: 'off' })).toEqual({ mode: 'off' })
    expect(() => aiBookingFromEnv({ SALEANE_AI_BOOKING: 'live' })).toThrow(/Unknown AI booking/)
  })

  it('answers only on the computer SALEANE runs on while it is in test mode', async () => {
    api.close()
    make({ mode: 'test' }, 'https://studio.example')
    const login = await studio()
    const response = await post(rpc('initialize', { protocolVersion: '2025-06-18' }), {
      origin: 'https://studio.example',
    })
    expect(response.statusCode).toBe(503)
    expect(response.json<Rpc>().error!.message).toMatch(/test mode/)
    const view = await api.inject({
      url: `/api/workspaces/${login.orgId}/ai-booking`,
      headers: headers(login),
    })
    expect(view.json()).toEqual({
      mode: 'test',
      reachable: false,
      address: `https://studio.example/api/mcp/${slug}`,
      sample: false,
    })
  })

  it('shows the owner the address, and only the owner', async () => {
    const login = await studio(false)
    const view = await api.inject({
      url: `/api/workspaces/${login.orgId}/ai-booking`,
      headers: headers(login),
    })
    expect(view.statusCode).toBe(200)
    expect(view.json()).toEqual({
      mode: 'test',
      reachable: true,
      address: `${origin}/api/mcp/${slug}`,
      sample: false,
    })
    expect(
      (await api.inject({ url: `/api/workspaces/${login.orgId}/ai-booking` })).statusCode,
    ).toBe(401)
    expect(
      (
        await api.inject({
          method: 'POST',
          url: `/api/workspaces/${login.orgId}/ai-booking`,
          headers: headers(login),
          payload: {},
        })
      ).statusCode,
    ).toBe(405)
    // A manager cannot turn it on: it is the owner's choice, as Book with Google is.
    const { can } = await import('../src/domain/operations')
    expect(can('owner', 'ai-booking')).toBe(true)
    expect(can('manager', 'ai-booking')).toBe(false)
    expect(can('practitioner', 'ai-booking')).toBe(false)
  })

  it('answers nothing for a studio locked for an unpaid bill', async () => {
    const login = await studio()
    const id = await connect()
    api.database.run(
      'UPDATE studio_plans SET locked_at=? WHERE organisation_id=?',
      clock,
      login.orgId,
    )
    expect((await post(rpc('initialize', { protocolVersion: '2025-06-18' }))).statusCode).toBe(404)
    const call = await post(
      rpc('tools/call', { name: 'book_time', arguments: { treatment_id: facial } }),
      session(id),
    )
    expect(call.statusCode).toBe(404)
    expect((await workspace(login)).state.appointments).toHaveLength(0)
  })

  it('limits how often one address can call the tools, as the receptionist does', async () => {
    await studio()
    const id = await connect()
    for (let i = 0; i < 40; i++) await tool(id, 'studio_details')
    const limited = await post(rpc('tools/call', { name: 'studio_details' }), session(id))
    expect(limited.statusCode).toBe(429)
    expect(limited.json<Rpc>().error).toMatchObject({ code: -32000, message: /Too many requests/ })
    // After the window, it answers again.
    clock += 10 * 60000 + 1
    expect(words(await tool(id, 'studio_details'))).toMatch(/Linden Studio/)
  })
})

describe('Booking through ChatGPT or Claude: the tools', () => {
  it('tells the assistant about the studio and what can be booked, never about guests', async () => {
    const login = await studio()
    // A client already in the diary, booked at the desk.
    const desk = (await workspace(login)).state
    await ok(login, {
      type: 'book',
      input: {
        serviceId: facial,
        staffId: maya,
        resourceId: desk.resources[0].id,
        date: '2026-10-08',
        startMinutes: 600,
        contact: {
          name: 'Private Person',
          email: 'private@example.invalid',
          phone: '+44 7700 900111',
          marketingConsent: false,
        },
        source: 'desk',
      },
    })
    const id = await connect()
    const details = await tool(id, 'studio_details')
    expect(details.isError).toBeUndefined()
    const data = details.structuredContent as {
      studio: string
      today: string
      locations: { id: string; hours: { day: string }[]; closedDays: string[] }[]
      bookingPage: string
      cancelling: string
    }
    expect(data).toMatchObject({
      studio: 'Linden Studio',
      today: '2026-10-06',
      bookingPage: `${origin}/book/${slug}`,
    })
    expect(data.locations[0].hours.map((h) => h.day)).toEqual([
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
      'Sunday',
    ])
    expect(data.cancelling).toMatch(/^Free to cancel online/)
    expect(words(details)).toMatch(new RegExp(`location_id ${data.locations[0].id}`))

    const list = await tool(id, 'list_treatments')
    const treatments = list.structuredContent as {
      treatments: { id: string; name: string; professionals: { id: string; name: string }[] }[]
      bookingPageOnly: { name: string; reason: string }[]
    }
    expect(treatments.treatments).toHaveLength(1)
    expect(treatments.treatments[0]).toMatchObject({
      id: facial,
      name: 'Restorative facial',
      durationMinutes: 60,
      professionals: [{ id: maya, name: 'Maya Lind', role: 'Facialist' }],
    })
    // Treatments with a deposit or a patch test stay on the booking page, by name only.
    expect(treatments.bookingPageOnly).toEqual([
      { name: 'Deposit facial', reason: 'deposit' },
      { name: 'Brow tint', reason: 'patch test' },
    ])
    expect(words(list)).toMatch(/Booked only on the studio's booking page/)
    expect(words(list)).toMatch(new RegExp(`treatment_id ${facial}`))
    expect(words(list)).toMatch(new RegExp(`professional_id ${maya}`))
    // Nothing about anyone else, even with the desk visit in the diary.
    const times = await tool(id, 'find_free_times', { treatment_id: facial })
    for (const answer of [details, list, times]) {
      const all = JSON.stringify(answer)
      expect(all).not.toMatch(/Private Person|private@example|900111|Ada Owner|owner@example/)
    }
  })

  it('finds free times as the booking page offers them, and refuses what it cannot book', async () => {
    const login = await studio()
    const id = await connect()
    const found = await tool(id, 'find_free_times', { treatment_id: facial })
    const week = found.structuredContent as { from: string; to: string; days: Day[]; more?: string }
    expect(week).toMatchObject({ from: '2026-10-06', to: '2026-10-12' })
    expect(week.days).toHaveLength(7)
    expect(week.more).toBeUndefined()
    // The same times as the booking page, on the studio's clock.
    for (const day of week.days.slice(0, 3)) {
      const page = await api.inject({
        url: `/api/public/${slug}/availability?serviceId=${facial}&staffId=any&date=${day.date}`,
      })
      const minutes = page.json<{ times: number[] }>().times
      expect(day.times).toEqual(
        minutes.map(
          (m) =>
            `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`,
        ),
      )
    }
    // A time a guest is holding on the booking page is not offered.
    const day = week.days.find((d) => d.times.length > 0)!
    const [hh, mm] = day.times[0].split(':').map(Number)
    const hold = await api.inject({
      method: 'POST',
      url: `/api/public/${slug}/holds`,
      payload: { serviceId: facial, staffId: maya, date: day.date, startMinutes: hh * 60 + mm },
    })
    expect(hold.statusCode, hold.body).toBe(201)
    const again = (
      await tool(id, 'find_free_times', { treatment_id: facial, professional_id: maya })
    ).structuredContent as { days: Day[] }
    expect(again.days.find((d) => d.date === day.date)!.times).not.toContain(day.times[0])
    // At most 14 days in one answer, never before today.
    const long = (
      await tool(id, 'find_free_times', {
        treatment_id: facial,
        from_date: '2026-10-01',
        to_date: '2026-12-31',
      })
    ).structuredContent as { from: string; to: string; days: Day[]; more: string }
    expect(long).toMatchObject({ from: '2026-10-06', to: '2026-10-19' })
    expect(long.days).toHaveLength(14)
    expect(long.more).toMatch(/2026-10-20/)
    // What it cannot book, in words the guest can act on.
    const refusal = async (args: Record<string, unknown>, words: RegExp) => {
      const answer = await tool(id, 'find_free_times', args)
      expect(answer.isError).toBe(true)
      expect(answer.content[0].text).toMatch(words)
    }
    await refusal({ treatment_id: deposit }, new RegExp(`needs a deposit.*${origin}/book/${slug}`))
    await refusal({ treatment_id: tint }, /needs a patch test first/)
    await refusal({ treatment_id: 'not-a-treatment' }, /no treatment with that id/)
    await refusal({ treatment_id: facial, professional_id: 'someone' }, /does not do/)
    await refusal({ treatment_id: facial, location_id: 'elsewhere' }, /not booked at that location/)
    await refusal(
      { treatment_id: facial, from_date: '2026-10-10', to_date: '2026-10-08' },
      /end date on or after/,
    )
    await refusal({ treatment_id: facial, from_date: '2027-12-01' }, /further ahead/)
    expect((await workspace(login)).state.appointments).toHaveLength(0)
  })

  it('books only once the guest says yes, through the booking page, and gives the private link', async () => {
    const login = await studio()
    const id = await connect()
    const time = await firstFree(id, maya)
    const ask = { treatment_id: facial, professional_id: maya, date: time.date, start: time.start }
    // Not until the guest has said yes.
    const unconfirmed = await tool(id, 'book_time', { ...ask, ...guest, guest_confirmed: false })
    expect(unconfirmed.isError).toBe(true)
    expect(words(unconfirmed)).toMatch(/Nothing was booked.*guest_confirmed/)
    expect((await workspace(login)).state.appointments).toHaveLength(0)

    const booked = await tool(id, 'book_time', { ...ask, ...guest, guest_confirmed: true })
    expect(booked.isError).toBeUndefined()
    const answer = booked.structuredContent as {
      visit: Record<string, unknown>
      privateLink: string
      confirmation: string
      cancelling: string
    }
    expect(answer).toMatchObject({
      booked: true,
      visit: {
        treatment: 'Restorative facial',
        date: time.date,
        start: time.start,
        durationMinutes: 60,
        professional: 'Maya',
        location: { name: 'London' },
      },
    })
    expect(answer.privateLink).toMatch(new RegExp(`^${origin}/manage#[A-Za-z0-9_-]{43}$`))
    // Emails are in test mode here: it never says a confirmation was sent.
    expect(answer.confirmation).toMatch(/test mode, so no confirmation email is sent/)
    expect(answer.cancelling).toMatch(/cancel/)
    expect(words(booked)).toMatch(/private link/)
    expect(words(booked)).not.toMatch(/sent to|has been sent|was sent/)

    const state = (await workspace(login)).state
    expect(state.appointments).toHaveLength(1)
    const visit = state.appointments[0]
    expect(visit).toMatchObject({
      serviceId: facial,
      staffId: maya,
      date: time.date,
      source: 'online',
      channel: 'chatgpt',
      status: 'confirmed',
      bookedPriceMinor: 9500,
    })
    // The guest's number kept in international form, and never signed up for news or offers.
    const client = state.clients.find((c) => c.id === visit.clientId)!
    expect(client).toMatchObject({
      name: 'Rosa Field',
      email: 'rosa@example.invalid',
      phone: '+44 7700 900456',
      marketingConsent: false,
    })
    // The client's timeline and Who changed what say it came through ChatGPT.
    const event = state.events.find((e) => e.type === 'booked')!
    expect(event).toMatchObject({ actor: 'Guest, through ChatGPT', appointmentId: visit.id })
    expect(event.detail).toMatch(/Booked by the guest through ChatGPT\./)
    expect(audits('ai-booking.chatgpt')).toEqual([{ record_id: visit.id, actor_id: null }])
    expect((await changes(login))[0]).toMatchObject({
      what: 'Booked through ChatGPT',
      who: 'A guest, through ChatGPT',
    })
    // The private link opens the guest's own visit and nothing else.
    const token = answer.privateLink.split('#')[1]
    const view = await api.inject({ method: 'POST', url: '/api/guest/visit', payload: { token } })
    expect(view.statusCode, view.body).toBe(200)
    expect(view.body).toMatch(/Restorative facial/)
    // The time is no longer offered.
    const after = (
      await tool(id, 'find_free_times', { treatment_id: facial, professional_id: maya })
    ).structuredContent as { days: Day[] }
    expect(after.days.find((d) => d.date === time.date)!.times).not.toContain(time.start)
  })

  it('books once when the assistant asks again, with a fresh private link', async () => {
    const login = await studio()
    const id = await connect()
    const time = await firstFree(id)
    const ask = {
      treatment_id: facial,
      date: time.date,
      start: time.start,
      ...guest,
      guest_confirmed: true,
    }
    const first = (await tool(id, 'book_time', ask)).structuredContent as { privateLink: string }
    // The answer never reached the assistant, so it asks again on the same connection.
    clock += 60000
    const second = await tool(id, 'book_time', ask)
    expect(second.isError).toBeUndefined()
    const again = second.structuredContent as { privateLink: string; visit: { start: string } }
    expect(again.visit.start).toBe(time.start)
    expect(again.privateLink).not.toBe(first.privateLink)
    const state = (await workspace(login)).state
    expect(state.appointments).toHaveLength(1)
    expect(state.events.filter((e) => e.type === 'booked')).toHaveLength(1)
    expect(audits('ai-booking.chatgpt')).toHaveLength(1)
    // The earlier link stops working; the new one opens the visit.
    const open = (link: string) =>
      api.inject({
        method: 'POST',
        url: '/api/guest/visit',
        payload: { token: link.split('#')[1] },
      })
    expect((await open(first.privateLink)).statusCode).not.toBe(200)
    expect((await open(again.privateLink)).statusCode).toBe(200)
    // Another connection asking for the same time finds it taken: only this connection can ask
    // again, so nobody who knows the guest's details can fetch their link.
    const other = await connect({ name: 'openai-mcp' })
    const taken = await tool(other, 'book_time', { ...ask, professional_id: maya })
    expect(taken.isError).toBe(true)
    expect(words(taken)).toMatch(/not free/)
    // Long after, the same request is a new booking, and the time is taken.
    clock += 20 * 60000
    const late = await tool(id, 'book_time', ask)
    expect(late.isError).toBe(true)
    expect(words(late)).toMatch(/no longer free/)
    expect((await workspace(login)).state.appointments).toHaveLength(1)
  })

  it('refuses what the booking page would refuse, and books nothing', async () => {
    const login = await studio()
    const id = await connect()
    const time = await firstFree(id, maya)
    const ask = {
      treatment_id: facial,
      professional_id: maya,
      date: time.date,
      start: time.start,
      ...guest,
      guest_confirmed: true,
    }
    const refused = async (change: Record<string, unknown>, words: RegExp) => {
      const answer = await tool(id, 'book_time', { ...ask, ...change })
      expect(answer.isError, JSON.stringify(answer)).toBe(true)
      expect(answer.content[0].text).toMatch(words)
    }
    await refused({ start: '03:00' }, /not free/)
    await refused({ start: '9.30' }, /HH:MM/)
    await refused({ date: '2026-10-05' }, /from today/)
    await refused({ date: '2027-12-01' }, /within the year ahead/)
    await refused({ guest_phone: 'call me' }, /phone|number/i)
    await refused({ guest_email: 'not-an-email' }, /working email/)
    await refused({ guest_name: 'R' }, /full name/)
    await refused({ treatment_id: deposit }, /needs a deposit/)
    await refused({ treatment_id: tint }, /needs a patch test first/)
    await refused({ professional_id: 'someone' }, /does not do/)
    // A desk booking takes the time while the assistant is talking to the guest.
    const state = (await workspace(login)).state
    const [hh, mm] = time.start.split(':').map(Number)
    await ok(login, {
      type: 'book',
      input: {
        serviceId: facial,
        staffId: maya,
        resourceId: state.resources[0].id,
        date: time.date,
        startMinutes: hh * 60 + mm,
        contact: {
          name: 'Desk Guest',
          email: 'desk@example.invalid',
          phone: '+44 7700 900222',
          marketingConsent: false,
        },
        source: 'desk',
      },
    })
    await refused({}, /not free/)
    expect((await workspace(login)).state.appointments).toHaveLength(1)
    expect(audits('ai-booking.chatgpt')).toEqual([])
  })

  it('names Claude, or an AI assistant when it does not say which', async () => {
    const login = await studio()
    const claude = await connect({ name: 'claude-ai', version: '0.1.0' })
    const time = await firstFree(claude, maya)
    const ask = { treatment_id: facial, professional_id: maya, guest_confirmed: true }
    await tool(claude, 'book_time', { ...ask, date: time.date, start: time.start, ...guest })
    const unknown = await connect({ name: 'mcp-inspector', version: '0.9.0' })
    await tool(unknown, 'book_time', {
      ...ask,
      date: time.next.date,
      start: time.next.times[0],
      guest_name: 'Sam Moss',
      guest_email: 'sam@example.invalid',
      guest_phone: '+44 7700 900789',
    })
    const state = (await workspace(login)).state
    expect(state.appointments.map((a) => a.channel).sort()).toEqual(['assistant', 'claude'])
    const booked = state.events.filter((e) => e.type === 'booked')
    expect(booked.map((e) => e.actor).sort()).toEqual([
      'Guest, through Claude',
      'Guest, through an AI assistant',
    ])
    expect(booked.map((e) => e.detail).join(' ')).toMatch(
      /Booked by the guest through Claude\..*Booked by the guest through an AI assistant\.|Booked by the guest through an AI assistant\..*Booked by the guest through Claude\./,
    )
    expect(audits('ai-booking.claude')).toHaveLength(1)
    expect(audits('ai-booking.assistant')).toHaveLength(1)
    const entries = await changes(login)
    expect(entries.slice(0, 2)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ what: 'Booked through Claude', who: 'A guest, through Claude' }),
        expect.objectContaining({
          what: 'Booked through an AI assistant',
          who: 'A guest, through an AI assistant',
        }),
      ]),
    )
  })

  it('lets a sample studio practise, and says so', async () => {
    const login = await register(true, 'sample@example.invalid')
    await ok(login, { type: 'ai-booking', settings: { enabled: true } })
    const { slug: sampleSlug, state } = await workspace(login)
    slug = sampleSlug
    const view = await api.inject({
      url: `/api/workspaces/${login.orgId}/ai-booking`,
      headers: headers(login),
    })
    expect(view.json()).toMatchObject({ sample: true, reachable: true })
    const id = await connect()
    expect((await tool(id, 'studio_details')).structuredContent).toMatchObject({ sample: true })
    const treatments = (await tool(id, 'list_treatments')).structuredContent as {
      treatments: { id: string }[]
    }
    expect(treatments.treatments.length).toBeGreaterThan(0)
    const pick = treatments.treatments[0].id
    const days = (await tool(id, 'find_free_times', { treatment_id: pick, to_date: '2026-10-19' }))
      .structuredContent as { days: Day[] }
    const day = days.days.find((d) => d.times.length > 0)!
    const booked = await tool(id, 'book_time', {
      treatment_id: pick,
      date: day.date,
      start: day.times[0],
      ...guest,
      guest_confirmed: true,
    })
    expect(booked.isError, words(booked)).toBeUndefined()
    expect(booked.structuredContent).toMatchObject({ booked: true, sample: true })
    expect(words(booked)).toMatch(/fictional sample studio/)
    expect((await workspace(login)).state.appointments.length).toBe(state.appointments.length + 1)
  })
})
