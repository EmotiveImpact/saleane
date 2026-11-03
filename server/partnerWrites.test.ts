// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApiHandler } from './app'
import type { ApiHandler } from './app'
import type { ConnectionTransport } from './connections'
import type { BusinessState } from '../src/domain/model'
import type { Command } from '../src/domain/commands'
import { stock } from '../src/domain/operations'
import { payPeriod } from '../src/domain/pay'
import { moneyInAndOut, salesByReceipt, taxSummary } from '../src/domain/accounts'

// Stage 5: other software sending visits, clients and a chain's till sales into SALEANE through
// an access key, with the desk's checks, an Idempotency-Key on every write, and every change in
// Who changed what under the key's name.
const origin = 'http://127.0.0.1:5173'
type Login = { cookie: string; csrf: string; orgId: string }
type Post = { headers: Record<string, string>; body: string }
let api: ApiHandler
let clock: number
let posts: Post[]
const transport: ConnectionTransport = {
  mode: 'live',
  check: (url) => (url.startsWith('https://') ? null : 'The address must start https://.'),
  post: async (_url, headers, body) => {
    posts.push({ headers, body })
    return { status: 200 }
  },
}
beforeEach(() => {
  clock = Date.parse('2026-10-06T07:00:00.000Z')
  posts = []
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
async function register(email: string): Promise<Login> {
  const response = await api.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: {
      name: 'Ada Owner',
      email,
      password: 'Fictional local account 2026!',
      workspace: { name: 'Linden Studio', locationName: 'London', region: 'UK', sample: false },
    },
  })
  expect(response.statusCode, response.body).toBe(201)
  return { ...response.json<{ csrf: string; orgId: string }>(), cookie: cookie(response) }
}
let ids: { serviceId: string; staffId: string; clientId: string; productId: string }
const facial = {
  name: 'Restorative facial',
  description: 'A fictional service',
  category: 'Skin' as const,
  durationMinutes: 60,
  bufferMinutes: 15,
  priceMinor: 9500,
  depositMinor: 0,
  resourceType: 'treatment' as const,
}
async function owner() {
  const login = await register('owner@example.invalid')
  await run(login, { type: 'resource', input: { name: 'Room One', type: 'treatment' } })
  const serviceId = await run(login, { type: 'service', input: facial })
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
  const productId = await run(login, {
    type: 'product',
    input: { name: 'Rose oil', sku: 'RO-1', priceMinor: 2400, reorderAt: 1, archived: false },
  })
  await run(login, {
    type: 'stock',
    productId,
    quantity: 3,
    reason: 'received',
    note: 'First delivery',
  })
  ids = { serviceId, staffId, clientId, productId }
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
const keys = (login: Login, path = '', payload?: unknown) =>
  api.inject({
    method: payload === undefined ? 'GET' : 'POST',
    url: `/api/workspaces/${login.orgId}/api-keys${path}`,
    headers: headers(login),
    ...(payload === undefined ? {} : { payload }),
  })
type Made = { key: string; created: string; keys: { id: string; prefix: string }[] }
async function makeKey(login: Login, scopes: string[], extra: Record<string, unknown> = {}) {
  const response = await keys(login, '', { name: 'Booking tool', scopes, ...extra })
  expect(response.statusCode, response.body).toBe(201)
  return response.json<Made>()
}
const send = (key: string, method: string, path: string, payload: unknown, idem?: string) =>
  api.inject({
    method,
    url: `/api/v1/${path}`,
    headers: {
      authorization: `Bearer ${key}`,
      ...(idem === '' ? {} : { 'idempotency-key': idem ?? crypto.randomUUID() }),
    },
    payload,
  })
const read = (key: string, path: string) =>
  api.inject({ url: `/api/v1/${path}`, headers: { authorization: `Bearer ${key}` } })
const visit = (extra: Record<string, unknown> = {}) => ({
  serviceId: ids.serviceId,
  date: '2026-10-07',
  start: '10:00',
  clientId: ids.clientId,
  ...extra,
})
type Refusal = { error: string; code: string; fields?: { field: string }[] }

describe('access keys that may change things', () => {
  it('offers the new scopes, keeps old keys as they were, and keeps location keys narrow', async () => {
    const login = await owner()
    const old = await makeKey(login, ['appointments:read'])
    const writer = await makeKey(login, ['appointments:write', 'clients:write', 'sales:write'])
    const listed = (await keys(login)).json<{ keys: { id: string; scopes: string[] }[] }>().keys
    expect(listed.find((k) => k.id === old.created)!.scopes).toEqual(['appointments:read'])
    expect(listed.find((k) => k.id === writer.created)!.scopes).toEqual([
      'appointments:write',
      'clients:write',
      'sales:write',
    ])
    // A reading key reads; it cannot write.
    expect((await send(old.key, 'POST', 'appointments', visit())).json()).toMatchObject({
      code: 'forbidden_scope',
    })
    // A writing key that cannot read is refused a read.
    expect((await read(writer.key, 'appointments?from=2026-10-01&to=2026-10-02')).statusCode).toBe(
      403,
    )
    await run(login, {
      type: 'location',
      input: { name: 'Islington', address: '1 Upper Street, London N1 0PN' },
    })
    const islington = (await state(login)).operations!.locations![0].id
    const narrow = await keys(login, '', {
      name: 'Branch till',
      scopes: ['appointments:write', 'clients:write'],
      locationId: islington,
    })
    expect(narrow.statusCode).toBe(422)
    expect(narrow.body).toContain('Clients and takings belong to the whole studio')
    const fine = await keys(login, '', {
      name: 'Branch till',
      scopes: ['appointments:read', 'appointments:write', 'sales:write'],
      locationId: islington,
    })
    expect(fine.statusCode, fine.body).toBe(201)
    // The studio tells the software which key it is and the email news wording to name.
    const studio = (await read(old.key, 'studio')).json<{
      key: { id: string; prefix: string; name: string }
      emailNewsWording: { version: number; text: string }
    }>()
    expect(studio.key).toEqual({
      id: old.created,
      prefix: old.key.slice(4, 12),
      name: 'Booking tool',
    })
    expect(studio.emailNewsWording.version).toBe(1)
  })

  it('books a visit through the desk’s checks, with the usual messages and the booked price', async () => {
    const login = await owner()
    const { key } = await makeKey(login, ['appointments:write'])
    const booked = await send(key, 'POST', 'appointments', visit())
    expect(booked.statusCode, booked.body).toBe(201)
    const body = booked.json<{ id: string; professionalId: string; source: string }>()
    expect(body).toMatchObject({
      clientId: ids.clientId,
      status: 'confirmed',
      date: '2026-10-07',
      start: '10:00',
      professionalId: ids.staffId,
      source: 'software',
      priceMinor: 9500,
    })
    const s = await state(login)
    const a = s.appointments.find((x) => x.id === body.id)!
    expect(a.software).toMatchObject({ name: 'Booking tool' })
    expect(a.bookedPriceMinor).toBe(9500)
    const event = s.events.find((e) => e.appointmentId === a.id && e.type === 'booked')!
    expect(event.detail).toContain('Booked by Booking tool through its access key.')
    expect(event.actor).toBe('Booking tool (access key)')
    // The studio's usual confirmation is planned, exactly as for a desk booking.
    await api.outbox.tick()
    expect(
      api.database
        .all<{ kind: string }>('SELECT kind FROM outbox WHERE appointment_id=?', a.id)
        .map((r) => r.kind),
    ).toContain('confirmation')
    // The same time again is taken, and a time outside the hours is not free.
    const again = await send(key, 'POST', 'appointments', visit())
    expect(again.statusCode).toBe(409)
    expect(again.json()).toMatchObject({ code: 'time_taken' })
    expect((await send(key, 'POST', 'appointments', visit({ start: '03:00' }))).statusCode).toBe(
      409,
    )
    // Refusals say what is wrong.
    const unknown = await send(key, 'POST', 'appointments', visit({ serviceId: 'nope' }))
    expect(unknown.statusCode).toBe(422)
    expect(unknown.json<Refusal>().error).toBe('That treatment is not on the menu.')
    expect((await send(key, 'POST', 'appointments', visit({ clientId: 'nope' }))).statusCode).toBe(
      404,
    )
    const shape = await send(key, 'POST', 'appointments', visit({ start: '10am' }))
    expect(shape.statusCode).toBe(400)
    expect(shape.json<Refusal>()).toMatchObject({ code: 'invalid_request' })
    expect(shape.json<Refusal>().fields!.map((f) => f.field)).toEqual(['start'])
    const both = await send(
      key,
      'POST',
      'appointments',
      visit({ client: { name: 'Ava', email: 'ava@example.invalid', phone: '+447700900124' } }),
    )
    expect(both.statusCode).toBe(400)
    // Every write needs an Idempotency-Key and JSON.
    const bare = await send(key, 'POST', 'appointments', visit({ start: '12:00' }), '')
    expect(bare.statusCode).toBe(400)
    expect(bare.json()).toMatchObject({ code: 'idempotency_key_missing' })
    const text = await api.inject({
      method: 'POST',
      url: '/api/v1/appointments',
      headers: {
        authorization: `Bearer ${key}`,
        'idempotency-key': 'k1',
        'content-type': 'text/plain',
      },
      rawPayload: 'hello',
    })
    expect(text.statusCode).toBe(415)
    expect((await send(key, 'DELETE', 'appointments', {})).statusCode).toBe(405)
    expect((await send(key, 'POST', 'appointments/x/move', {})).statusCode).toBe(404)
    // Nothing else was booked by any of these.
    expect((await state(login)).appointments).toHaveLength(1)
  })

  it('books at the usual price, even for a time the client was offered at a lower price', async () => {
    const login = await owner()
    await run(login, { type: 'consent', clientId: ids.clientId, consent: true })
    // Quiet-time prices are offered only by a studio that takes bookings online.
    await run(login, {
      type: 'organisation',
      name: 'Linden Studio',
      locationName: 'London',
      address: '1 Linden Street',
      timeZone: 'Europe/London',
      bookingEnabled: true,
    })
    await run(login, {
      type: 'quiet-offers',
      settings: {
        discount: 'percent',
        offPercent: 20,
        offMinor: 1000,
        floorMinor: 0,
        openHours: 24,
        leftOutIds: [],
      },
    })
    const messageId = await run(login, {
      type: 'offer-invite',
      clientId: ids.clientId,
      serviceId: ids.serviceId,
      staffId: ids.staffId,
      date: '2026-10-07',
      startMinutes: 600,
    })
    expect(
      (await state(login)).operations!.messages.find((m) => m.id === messageId)!.offer,
    ).toMatchObject({ priceMinor: 7600, usualPriceMinor: 9500 })
    const { key } = await makeKey(login, ['appointments:write'])
    // A key cannot ask for a lower price: the body takes no offer or price.
    for (const extra of [{ offer: messageId }, { priceMinor: 7600 }]) {
      const asked = await send(key, 'POST', 'appointments', visit(extra))
      expect(asked.statusCode).toBe(400)
      expect(asked.json()).toMatchObject({ code: 'invalid_request' })
    }
    const booked = await send(key, 'POST', 'appointments', visit())
    expect(booked.statusCode, booked.body).toBe(201)
    expect(booked.json()).toMatchObject({ priceMinor: 9500 })
    const a = (await state(login)).appointments.find(
      (x) => x.id === booked.json<{ id: string }>().id,
    )!
    expect(a.bookedPriceMinor).toBe(9500)
    expect(a.bookedOffer).toBeUndefined()
  })

  it('replays the same request, refuses a reused key with another request, keeps no refusal', async () => {
    const login = await owner()
    const { key } = await makeKey(login, ['appointments:write'])
    const first = await send(key, 'POST', 'appointments', visit(), 'booking-1')
    expect(first.statusCode, first.body).toBe(201)
    expect(first.headers['idempotent-replayed']).toBeUndefined()
    const second = await send(key, 'POST', 'appointments', visit(), 'booking-1')
    expect(second.statusCode).toBe(201)
    expect(second.headers['idempotent-replayed']).toBe('true')
    expect(second.json()).toEqual(first.json())
    expect((await state(login)).appointments).toHaveLength(1)
    const reused = await send(key, 'POST', 'appointments', visit({ start: '14:00' }), 'booking-1')
    expect(reused.statusCode).toBe(422)
    expect(reused.json()).toMatchObject({ code: 'idempotency_key_reused' })
    // A refused request keeps nothing, so it can be put right and sent with the same key.
    const taken = await send(key, 'POST', 'appointments', visit(), 'booking-2')
    expect(taken.statusCode).toBe(409)
    const fixed = await send(key, 'POST', 'appointments', visit({ start: '14:00' }), 'booking-2')
    expect(fixed.statusCode, fixed.body).toBe(201)
    // Keys are kept per access key: another key may use the same value.
    const other = await makeKey(login, ['appointments:write'])
    expect(
      (await send(other.key, 'POST', 'appointments', visit({ start: '16:00' }), 'booking-1'))
        .statusCode,
    ).toBe(201)
    expect(api.database.all('SELECT * FROM api_key_writes')).toHaveLength(3)
    // Kept answers go after thirty days.
    clock += 31 * 86400000
    await send(other.key, 'POST', 'appointments', { serviceId: 'x' }, 'later')
    await send(other.key, 'POST', 'appointments', visit({ date: '2026-11-11' }), 'later-2')
    expect(api.database.all('SELECT * FROM api_key_writes')).toHaveLength(1)
  })

  it('moves and cancels a visit under the desk’s rules', async () => {
    const login = await owner()
    const { key } = await makeKey(login, ['appointments:write'])
    const { id } = (await send(key, 'POST', 'appointments', visit())).json<{ id: string }>()
    const deskVisit = await run(login, {
      type: 'book',
      input: {
        serviceId: ids.serviceId,
        staffId: ids.staffId,
        date: '2026-10-07',
        startMinutes: 14 * 60,
        clientId: ids.clientId,
        source: 'desk',
      },
    })
    const moved = await send(key, 'PATCH', `appointments/${id}`, { start: '11:30' })
    expect(moved.statusCode, moved.body).toBe(200)
    expect(moved.json()).toMatchObject({ id, start: '11:30', status: 'confirmed' })
    const s = await state(login)
    expect(s.events.some((e) => e.appointmentId === id && e.title === 'Visit moved')).toBe(true)
    // Onto the desk's visit: taken.
    const clash = await send(key, 'PATCH', `appointments/${id}`, { start: '14:00' })
    expect(clash.json()).toMatchObject({ code: 'time_taken' })
    expect((await send(key, 'PATCH', `appointments/${id}`, {})).statusCode).toBe(400)
    expect((await send(key, 'PATCH', 'appointments/nope', { start: '12:00' })).statusCode).toBe(404)
    const cancelled = await send(key, 'POST', `appointments/${id}/cancel`, {})
    expect(cancelled.statusCode, cancelled.body).toBe(200)
    expect(cancelled.json()).toMatchObject({ status: 'cancelled' })
    expect(
      (await state(login)).events.find((e) => e.appointmentId === id && e.type === 'cancelled')
        ?.detail,
    ).toContain('Cancelled through Booking tool')
    expect((await send(key, 'POST', `appointments/${id}/cancel`, {})).json()).toMatchObject({
      code: 'already_cancelled',
    })
    expect(
      (await send(key, 'PATCH', `appointments/${id}`, { start: '12:00' })).json(),
    ).toMatchObject({ code: 'not_upcoming' })
    // A visit the desk booked can be cancelled too, with the software's own reason.
    const reason = await send(key, 'POST', `appointments/${deskVisit}/cancel`, {
      reason: 'Guest cancelled in the app',
    })
    expect(reason.statusCode).toBe(200)
    const short = await send(key, 'POST', `appointments/${deskVisit}/cancel`, { reason: 'x' })
    expect(short.statusCode).toBe(400)
  })

  it('keeps to the studio’s patch test rule, and never books a client who reacted', async () => {
    const login = await owner()
    const tinted = await run(login, {
      type: 'service',
      input: { ...facial, name: 'Brow tint', patchTest: true },
    })
    await run(login, {
      type: 'staff',
      id: ids.staffId,
      input: {
        name: 'Maya Lind',
        role: 'Facialist',
        serviceIds: [ids.serviceId, tinted],
        tone: 'sage',
      },
    } as Command)
    const { key } = await makeKey(login, ['appointments:write'])
    const newcomer = {
      name: 'Ava Stone',
      email: 'ava@example.invalid',
      phone: '+44 7700 900124',
    }
    // With the rule off, a new client may be booked; the desk sees the patch test due.
    const off = await send(
      key,
      'POST',
      'appointments',
      visit({ serviceId: tinted, clientId: undefined, client: newcomer }),
    )
    expect(off.statusCode, off.body).toBe(201)
    await run(login, {
      type: 'patch-test-settings',
      settings: { hoursBefore: 48, validMonths: 6, remind: false, stopOnline: true },
    })
    const stopped = await send(
      key,
      'POST',
      'appointments',
      visit({ serviceId: tinted, start: '14:00' }),
    )
    expect(stopped.statusCode).toBe(422)
    expect(stopped.json()).toMatchObject({ code: 'patch_test_needed' })
    const test = await run(login, {
      type: 'patch-test',
      input: {
        clientId: ids.clientId,
        testedAt: '2026-10-03T10:00:00.000Z',
        product: 'Brow tint, dark brown',
        notes: '',
      },
      result: { outcome: 'clear', notes: '' },
    })
    expect(test).toBeTruthy()
    const clear = await send(
      key,
      'POST',
      'appointments',
      visit({ serviceId: tinted, start: '14:00' }),
    )
    expect(clear.statusCode, clear.body).toBe(201)
    // A recorded reaction stops it even with the rule off.
    await run(login, {
      type: 'patch-test-settings',
      settings: { hoursBefore: 48, validMonths: 6, remind: false, stopOnline: false },
    })
    await run(login, {
      type: 'patch-test',
      input: {
        clientId: ids.clientId,
        testedAt: '2026-10-04T10:00:00.000Z',
        product: 'Brow tint, black',
        notes: '',
      },
      result: { outcome: 'reaction', notes: 'Redness' },
    })
    const reacted = await send(
      key,
      'POST',
      'appointments',
      visit({ serviceId: tinted, start: '16:00' }),
    )
    expect(reacted.json()).toMatchObject({ code: 'patch_test_needed' })
  })

  it('adds and changes clients, records email news only with who, when and how', async () => {
    const login = await owner()
    const { key } = await makeKey(login, ['clients:write', 'appointments:write'])
    const plain = await send(key, 'POST', 'clients', {
      name: 'Ava Stone',
      email: 'Ava@Example.invalid',
      phone: '+44 7700 900124',
    })
    expect(plain.statusCode, plain.body).toBe(201)
    const ava = plain.json<{ id: string; emailNews: boolean; email: string }>()
    expect(ava).toMatchObject({ emailNews: false, email: 'ava@example.invalid' })
    // The same name and email again is the same client.
    const twice = await send(key, 'POST', 'clients', {
      name: 'ava stone',
      email: 'ava@example.invalid',
      phone: '+44 7700 900125',
    })
    expect(twice.statusCode).toBe(409)
    expect(twice.json()).toMatchObject({ code: 'duplicate_client', clientId: ava.id })
    // So is a booking with their details: the software is told which client to use.
    const inline = await send(
      key,
      'POST',
      'appointments',
      visit({
        clientId: undefined,
        client: { name: 'Ava Stone', email: 'ava@example.invalid', phone: '+447700900124' },
      }),
    )
    expect(inline.json()).toMatchObject({ code: 'duplicate_client', clientId: ava.id })
    // Agreeing to news needs the wording they agreed to, and when and how.
    const news = { agreed: true, at: '2026-10-06T06:30:00Z', how: 'Ticked the box on our form' }
    const noVersion = await send(key, 'POST', 'clients', {
      name: 'Lena Park',
      email: 'lena@example.invalid',
      phone: '+44 7700 900126',
      emailNews: news,
    })
    expect(noVersion.statusCode).toBe(422)
    expect(noVersion.json<Refusal>().error).toContain('version')
    const noHow = await send(key, 'POST', 'clients', {
      name: 'Lena Park',
      email: 'lena@example.invalid',
      phone: '+44 7700 900126',
      emailNews: { agreed: true, at: '2026-10-06T06:30:00Z', wordingVersion: 1 },
    })
    expect(noHow.statusCode).toBe(400)
    const later = await send(key, 'POST', 'clients', {
      name: 'Lena Park',
      email: 'lena@example.invalid',
      phone: '+44 7700 900126',
      emailNews: { ...news, at: '2026-10-06T09:00:00Z', wordingVersion: 1 },
    })
    expect(later.statusCode).toBe(422)
    const lena = await send(key, 'POST', 'clients', {
      name: 'Lena Park',
      email: 'lena@example.invalid',
      phone: '+44 7700 900126',
      emailNews: { ...news, wordingVersion: 1 },
    })
    expect(lena.statusCode, lena.body).toBe(201)
    const lenaId = lena.json<{ id: string; emailNews: boolean }>().id
    expect(lena.json()).toMatchObject({ emailNews: true })
    let s = await state(login)
    expect(s.consentRecords!.filter((r) => r.clientId === lenaId)).toEqual([
      expect.objectContaining({
        given: true,
        source: 'other software',
        wordingVersion: 1,
        saidAt: '2026-10-06T06:30:00.000Z',
        how: 'Ticked the box on our form',
        actor: 'Booking tool (access key)',
      }),
    ])
    expect(s.consentRecords!.some((r) => r.clientId === ava.id)).toBe(false)
    // Changing details keeps their email news as it was; withdrawing it needs when and how too.
    const phone = await send(key, 'PATCH', `clients/${lenaId}`, { phone: '+44 7700 900199' })
    expect(phone.json()).toMatchObject({ phone: '+44 7700 900199', emailNews: true })
    const stop = await send(key, 'PATCH', `clients/${lenaId}`, {
      emailNews: { agreed: false, at: '2026-10-06T06:45:00Z', how: 'Unticked it in the app' },
    })
    expect(stop.json()).toMatchObject({ emailNews: false })
    s = await state(login)
    expect(s.consentRecords!.filter((r) => r.clientId === lenaId).map((r) => r.given)).toEqual([
      true,
      false,
    ])
    // Renaming onto another client is the same duplicate rule.
    const clash = await send(key, 'PATCH', `clients/${lenaId}`, {
      name: 'Ava Stone',
      email: 'ava@example.invalid',
    })
    expect(clash.json()).toMatchObject({ code: 'duplicate_client', clientId: ava.id })
    expect(
      (await send(key, 'PATCH', 'clients/nope', { phone: '+44 7700 900111' })).statusCode,
    ).toBe(404)
    // A key without clients:write cannot add them.
    const visitsOnly = await makeKey(login, ['appointments:write'])
    expect(
      (
        await send(visitsOnly.key, 'POST', 'clients', {
          name: 'Kit Moss',
          email: 'kit@example.invalid',
          phone: '+44 7700 900127',
        })
      ).json(),
    ).toMatchObject({ code: 'forbidden_scope' })
    // A client who asked to be erased gets nothing more.
    const erasure = await api.inject({
      method: 'POST',
      url: `/api/workspaces/${login.orgId}/privacy/clients/${ava.id}/erasure`,
      headers: headers(login),
      payload: {},
    })
    expect(erasure.statusCode, erasure.body).toBe(201)
    const erased = await send(key, 'PATCH', `clients/${ava.id}`, { phone: '+44 7700 900128' })
    expect(erased.json()).toMatchObject({ code: 'erasure_requested' })
    expect(
      (await send(key, 'POST', 'appointments', visit({ clientId: ava.id }))).json(),
    ).toMatchObject({ code: 'erasure_requested' })
  })

  it('keeps a key for one location to that location', async () => {
    const login = await owner()
    await run(login, {
      type: 'location',
      input: { name: 'Islington', address: '1 Upper Street, London N1 0PN' },
    })
    const s = await state(login)
    const [main, islington] = [s.organisation.locationId, s.operations!.locations![0].id]
    const desk = await run(login, {
      type: 'book',
      input: {
        serviceId: ids.serviceId,
        staffId: ids.staffId,
        date: '2026-10-07',
        startMinutes: 600,
        clientId: ids.clientId,
        source: 'desk',
      },
    })
    const branch = await keys(login, '', {
      name: 'Islington till',
      scopes: ['appointments:write', 'sales:write'],
      locationId: islington,
    })
    const { key } = branch.json<{ key: string }>()
    const elsewhere = await send(
      key,
      'POST',
      'appointments',
      visit({ locationId: main, start: '12:00' }),
    )
    expect(elsewhere.statusCode).toBe(403)
    expect(elsewhere.json()).toMatchObject({ code: 'wrong_location' })
    // A visit at another location is not found at all.
    expect((await send(key, 'PATCH', `appointments/${desk}`, { start: '12:00' })).statusCode).toBe(
      404,
    )
    expect((await send(key, 'POST', `appointments/${desk}/cancel`, {})).statusCode).toBe(404)
    const sale = {
      receipt: 'I-1',
      occurredAt: '2026-10-06T06:00:00Z',
      lines: [
        {
          kind: 'product',
          name: 'Hand cream',
          quantity: 1,
          totalMinor: 1200,
          taxMinor: 200,
          taxRateBps: 2000,
        },
      ],
      payments: [{ method: 'cash', amountMinor: 1200 }],
    }
    const wrong = await send(key, 'POST', 'till-sales', { ...sale, locationId: main })
    expect(wrong.json()).toMatchObject({ code: 'wrong_location' })
    const own = await send(key, 'POST', 'till-sales', sale)
    expect(own.statusCode, own.body).toBe(201)
    expect(own.json()).toMatchObject({ locationId: islington, receipt: 'I-1', tookPayment: false })
    // The same receipt number from another location is a different receipt.
    const whole = await makeKey(login, ['sales:write'])
    const there = await send(whole.key, 'POST', 'till-sales', { ...sale, locationId: main })
    expect(there.statusCode, there.body).toBe(201)
    expect((await send(whole.key, 'POST', 'till-sales', sale)).json()).toMatchObject({
      code: 'invalid_request',
    })
  })

  it('refuses writes to a studio that is read only, locked or a sample, and to old keys', async () => {
    const login = await owner()
    const { key, created } = await makeKey(login, ['appointments:write', 'appointments:read'])
    api.database.run("UPDATE studio_plans SET status='stopped',stop_reason='unpaid'")
    const readOnly = await send(key, 'POST', 'appointments', visit())
    expect(readOnly.statusCode).toBe(402)
    expect(readOnly.json()).toMatchObject({ code: 'read_only' })
    // Reading still works while the studio is only read only.
    expect((await read(key, 'appointments?from=2026-10-01&to=2026-10-02')).statusCode).toBe(200)
    api.database.run('UPDATE studio_plans SET locked_at=1')
    expect((await send(key, 'POST', 'appointments', visit())).json()).toMatchObject({
      code: 'locked',
    })
    api.database.run("UPDATE studio_plans SET status='trial',stop_reason=NULL,locked_at=NULL")
    expect((await send(key, 'POST', 'appointments', visit())).statusCode).toBe(201)
    // A sample studio never takes anything from outside.
    const row = api.database.get<{ state: string }>(
      'SELECT state FROM organisations WHERE id=?',
      login.orgId,
    )!
    const sample = JSON.parse(row.state) as BusinessState
    sample.operations!.mode = 'sandbox'
    api.database.run(
      'UPDATE organisations SET state=? WHERE id=?',
      JSON.stringify(sample),
      login.orgId,
    )
    expect((await send(key, 'POST', 'appointments', visit({ start: '14:00' }))).statusCode).toBe(
      401,
    )
    api.database.run('UPDATE organisations SET state=? WHERE id=?', row.state, login.orgId)
    const forged = key.slice(0, -4) + (key.endsWith('AAAA') ? 'BBBB' : 'AAAA')
    expect((await send(forged, 'POST', 'appointments', visit())).json()).toMatchObject({
      code: 'unauthorised',
    })
    expect((await keys(login, `/${created}/revoke`, {})).statusCode).toBe(200)
    expect((await send(key, 'POST', 'appointments', visit({ start: '14:00' }))).statusCode).toBe(
      401,
    )
    // Writes share the key's 120 requests a minute with its reads.
    const busy = await makeKey(login, ['appointments:write'])
    for (let n = 0; n < 120; n++) await read(busy.key, 'studio')
    expect((await send(busy.key, 'POST', 'appointments', visit())).json()).toMatchObject({
      code: 'rate_limited',
    })
  })

  it('records a chain’s till sales and refunds: takings, Money, stock, commission and no payment', async () => {
    const login = await owner()
    await run(login, {
      type: 'pay-rate',
      staffId: ids.staffId,
      serviceBps: 4000,
      productBps: 1000,
      from: '2026-10-01',
    })
    const s0 = await state(login)
    const main = s0.organisation.locationId
    const { key } = await makeKey(login, ['sales:write'])
    const sale = {
      locationId: main,
      receipt: 'T-1001',
      occurredAt: '2026-10-06T07:30:00+01:00',
      staffId: ids.staffId,
      lines: [
        {
          kind: 'treatment',
          serviceId: ids.serviceId,
          quantity: 1,
          totalMinor: 9600,
          taxMinor: 1600,
          taxRateBps: 2000,
        },
        {
          kind: 'product',
          sku: 'ro-1',
          quantity: 2,
          totalMinor: 4800,
          taxMinor: 800,
          taxRateBps: 2000,
        },
        {
          kind: 'product',
          name: 'Gift wrap',
          quantity: 1,
          totalMinor: 120,
          taxMinor: 20,
          taxRateBps: 2000,
        },
      ],
      payments: [{ method: 'card', amountMinor: 14520 }],
    }
    const sent = await send(key, 'POST', 'till-sales', sale)
    expect(sent.statusCode, sent.body).toBe(201)
    const body = sent.json<{ id: string; lines: { productId: string | null; shelf?: number }[] }>()
    expect(body).toMatchObject({
      kind: 'sale',
      receipt: 'T-1001',
      totalMinor: 14520,
      taxMinor: 2420,
      shelfShort: [],
      tookPayment: false,
    })
    expect(body.lines[1]).toMatchObject({ productId: ids.productId, shelf: 2 })
    expect(body.lines[2]).toMatchObject({ productId: null, name: 'Gift wrap' })
    let s = await state(login)
    expect(stock(s, ids.productId, main)).toBe(1)
    // Never claims SALEANE took a payment.
    expect(s.payments).toEqual(s0.payments)
    expect(s.sales).toEqual(s0.sales)
    // Nor opens SALEANE's cash drawer: the money is in the other till.
    expect(api.database.all('SELECT * FROM till_events')).toEqual([])
    // The same receipt cannot be sent twice.
    const twice = await send(key, 'POST', 'till-sales', sale)
    expect(twice.statusCode).toBe(409)
    expect(twice.json()).toMatchObject({ code: 'duplicate_receipt', saleId: body.id })
    // What does not add up is refused, with a reason.
    const refused = async (change: Record<string, unknown>, words: string) => {
      const response = await send(key, 'POST', 'till-sales', { ...sale, receipt: 'T-X', ...change })
      expect(response.statusCode, response.body).toBe(422)
      expect(response.json<Refusal>().error).toContain(words)
    }
    await refused({ payments: [{ method: 'card', amountMinor: 100 }] }, 'payments add up to 100')
    await refused({ lines: [{ ...sale.lines[0], taxMinor: 10 }] }, 'tax inside')
    await refused({ occurredAt: '2026-10-06T09:00:00Z' }, 'later than now')
    await refused({ staffId: 'nobody' }, 'team member')
    await refused({ lines: [{ ...sale.lines[0], serviceId: 'nope' }] }, 'not in SALEANE')
    await refused(
      {
        lines: [{ kind: 'product', quantity: 1, totalMinor: 120, taxMinor: 20, taxRateBps: 2000 }],
      },
      'send its name',
    )
    // The shelf was short: what was there came off, and the answer says so.
    const short = await send(key, 'POST', 'till-sales', {
      ...sale,
      receipt: 'T-1002',
      lines: [
        {
          kind: 'product',
          productId: ids.productId,
          quantity: 3,
          totalMinor: 7200,
          taxMinor: 1200,
          taxRateBps: 2000,
        },
      ],
      payments: [
        { method: 'cash', amountMinor: 2000 },
        { method: 'card', amountMinor: 5200 },
      ],
    })
    expect(short.statusCode, short.body).toBe(201)
    expect(short.json()).toMatchObject({
      shelfShort: [{ productId: ids.productId, name: 'Rose oil', short: 2 }],
    })
    s = await state(login)
    expect(stock(s, ids.productId, main)).toBe(0)
    // A refund gives money back on its sale and puts the product back on the shelf.
    const refund = {
      kind: 'refund',
      locationId: main,
      receipt: 'R-1',
      refundOf: 'T-1001',
      reason: 'Changed their mind',
      occurredAt: '2026-10-06T07:45:00+01:00',
      lines: [
        {
          kind: 'product',
          sku: 'RO-1',
          quantity: 1,
          totalMinor: 2400,
          taxMinor: 400,
          taxRateBps: 2000,
        },
      ],
      payments: [{ method: 'card', amountMinor: 2400 }],
    }
    const back = await send(key, 'POST', 'till-sales', refund)
    expect(back.statusCode, back.body).toBe(201)
    expect(back.json()).toMatchObject({ kind: 'refund', refundOf: 'T-1001', totalMinor: 2400 })
    s = await state(login)
    expect(stock(s, ids.productId, main)).toBe(1)
    const tooMuch = await send(key, 'POST', 'till-sales', {
      ...refund,
      receipt: 'R-2',
      lines: [
        {
          kind: 'treatment',
          name: 'Facial',
          quantity: 1,
          totalMinor: 13000,
          taxMinor: 2167,
          taxRateBps: 2000,
        },
      ],
      payments: [{ method: 'card', amountMinor: 13000 }],
    })
    expect(tooMuch.statusCode).toBe(422)
    expect(tooMuch.json<Refusal>().error).toContain('Only 12120 is left')
    const nothing = await send(key, 'POST', 'till-sales', {
      ...refund,
      receipt: 'R-3',
      refundOf: 'T-9',
    })
    expect(nothing.json<Refusal>().error).toContain('no sale with receipt T-9')
    // Takings for the day count both sales; the refund is money given back.
    const takings = await makeKey(login, ['takings:read'])
    const day = (await read(takings.key, 'takings?from=2026-10-06&to=2026-10-06')).json<{
      data: Record<string, number>[]
    }>().data
    expect(day).toEqual([
      expect.objectContaining({
        date: '2026-10-06',
        servicesMinor: 8000,
        productsMinor: 4100 + 6000,
        taxMinor: 2420 + 1200,
        refundsMinor: 2400,
      }),
    ])
    // Money in and out names the other till and how it was paid, never a SALEANE payment.
    const money = moneyInAndOut(s, '2026-10-06', '2026-10-06')
    expect(money.map((r) => [r.kind, r.method, r.amountMinor])).toEqual([
      ['Sale on another till', 'other_till_card', 14520],
      ['Sale on another till', 'other_till_cash', 2000],
      ['Sale on another till', 'other_till_card', 5200],
      ['Given back on another till', 'other_till_card', -2400],
    ])
    expect(money[0].reference).toBe('T-1001 (Booking tool)')
    expect(
      salesByReceipt(s, '2026-10-06', '2026-10-06').map((r) => [r.receipt, r.method, r.source]),
    ).toEqual([
      ['T-1001', 'other_till_card', 'Booking tool'],
      ['T-1002', 'other_till_split', 'Booking tool'],
    ])
    expect(taxSummary(s, '2026-10-06', '2026-10-06')).toEqual([
      {
        label: `${s.operations?.tax?.label || 'Tax'}, from another till`,
        rateBps: 2000,
        inclusive: true,
        netMinor: 18100,
        taxMinor: 3620,
      },
    ])
    // Commission at the person's rates, less what was given back.
    const maya = payPeriod(s, '2026-10-01', '2026-10-31').find((p) => p.staff.id === ids.staffId)!
    expect(maya.lines.map((l) => [l.label, l.receipt, l.commissionMinor])).toEqual([
      ['Given back on Booking tool', 'R-1', -200],
      ['Sold on Booking tool', 'T-1001', 3200 + 410],
      ['Sold on Booking tool', 'T-1002', 600],
    ])
    expect(maya.commissionMinor).toBe(4010)
  })

  it('shows each change under the key’s name and marks its own events for the software', async () => {
    const login = await owner()
    const connected = await api.inject({
      method: 'POST',
      url: `/api/workspaces/${login.orgId}/connections`,
      headers: headers(login),
      payload: {
        name: 'Zapier',
        url: 'https://hooks.example.invalid/catch/1',
        events: ['appointment.booked', 'client.created'],
        shareContact: false,
      },
    })
    expect(connected.statusCode, connected.body).toBe(201)
    const made = await makeKey(login, ['appointments:write', 'clients:write'])
    const prefix = made.key.slice(4, 12)
    const { id } = (await send(made.key, 'POST', 'appointments', visit())).json<{ id: string }>()
    await run(login, {
      type: 'book',
      input: {
        serviceId: ids.serviceId,
        staffId: ids.staffId,
        date: '2026-10-07',
        startMinutes: 14 * 60,
        clientId: ids.clientId,
        source: 'desk',
      },
    })
    await api.connections.tick()
    expect(posts).toHaveLength(2)
    const [fromKey, fromDesk] = posts.map((p) => ({ ...p, json: JSON.parse(p.body) }))
    expect(fromKey.json).toMatchObject({
      type: 'appointment.booked',
      appointment: { id, source: 'software' },
      changedBy: {
        type: 'access_key',
        accessKey: { id: made.created, prefix, name: 'Booking tool' },
      },
    })
    expect(fromKey.headers['Saleane-Access-Key']).toBe(prefix)
    expect(fromDesk.json.changedBy).toBeUndefined()
    expect(fromDesk.headers['Saleane-Access-Key']).toBeUndefined()
    // Who changed what: the key's change under its name, and a filter for it.
    const changes = await api.inject({
      url: `/api/workspaces/${login.orgId}/changes`,
      headers: headers(login),
    })
    const page = changes.json<{
      entries: { who: string; person: boolean; what: string }[]
      people: { id: string; name: string }[]
    }>()
    expect(page.entries[1]).toMatchObject({
      who: 'Booking tool, through its access key',
      person: false,
      what: 'Booked a visit',
    })
    expect(page.people).toContainEqual({
      id: `key:${made.created}`,
      name: 'Booking tool (access key)',
    })
    const only = await api.inject({
      url: `/api/workspaces/${login.orgId}/changes?who=${encodeURIComponent(`key:${made.created}`)}`,
      headers: headers(login),
    })
    expect(only.json<{ entries: unknown[] }>().entries).toHaveLength(1)
    // It stays under the key's name after the key is revoked.
    await keys(login, `/${made.created}/revoke`, {})
    const after = await api.inject({
      url: `/api/workspaces/${login.orgId}/changes?who=${encodeURIComponent(`key:${made.created}`)}`,
      headers: headers(login),
    })
    expect(after.json<{ entries: { who: string }[] }>().entries[0].who).toBe(
      'Booking tool, through its access key',
    )
  })
})
