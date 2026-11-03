// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApiHandler } from './app'
import type { ApiHandler, InjectResponse } from './app'
import type { BusinessState } from '../src/domain/model'
import type { Command } from '../src/domain/commands'
import type { AreaView } from '../src/domain/area'
import type { ApprovalRequest } from '../src/domain/approvalsSchema'
import { plannedHoursFor } from '../src/domain/operations'
import { serviceAt } from '../src/domain/locations'
import { testProvider } from './messaging/providers'
import { testPaymentProvider } from './payments/providers'

// Stage 4: sign-offs for refunds, prices and the rota, through the server's own checks.
const origin = 'http://127.0.0.1:5173'
const password = 'Fictional local account 2026!'
const guest = {
  name: 'Rosa Guest',
  email: 'rosa.guest@example.invalid',
  phone: '+44 7700 900333',
  marketingConsent: false,
}
type Login = { cookie: string; csrf: string; orgId: string; userId: string; email: string }
let api: ApiHandler
let clock: number

beforeEach(() => {
  // 07:00Z on Tuesday 6 October is 08:00 in London.
  clock = Date.parse('2026-10-06T07:00:00.000Z')
  api = createApiHandler({
    origin,
    databasePath: ':memory:',
    now: () => clock,
    turnstile: null,
    providers: { email: testProvider('email'), sms: testProvider('sms'), receipt: () => null },
    paymentProvider: testPaymentProvider(origin),
  })
})
afterEach(() => api.close())

const headers = (login: Login) => ({ cookie: login.cookie, 'x-csrf-token': login.csrf })
const cookie = (response: InjectResponse) => String(response.headers['set-cookie']).split(';')[0]
async function register(email: string, name: string, invitation?: string) {
  const response = await api.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: {
      name,
      email,
      password,
      ...(invitation
        ? { invitation }
        : {
            workspace: {
              name: 'Linden Studio',
              locationName: 'London',
              region: 'UK',
              sample: false,
            },
          }),
    },
  })
  expect(response.statusCode, response.body).toBe(201)
  const login = {
    ...response.json<{ csrf: string; orgId: string }>(),
    cookie: cookie(response),
    userId: '',
    email,
  }
  login.userId = (await api.inject({ url: '/api/session', headers: headers(login) })).json<{
    user: { id: string }
  }>().user.id
  return login
}
/** Moves the clock on; sessions last twelve hours, so everyone named signs in again. */
async function moveClock(iso: string, ...people: Login[]) {
  clock = Date.parse(iso)
  for (const login of people) {
    const response = await api.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: login.email, password },
    })
    expect(response.statusCode, response.body).toBe(200)
    login.csrf = response.json<{ csrf: string }>().csrf
    login.cookie = cookie(response)
  }
}
const get = (login: Login, path = '') =>
  api.inject({ url: `/api/workspaces/${login.orgId}${path}`, headers: headers(login) })
const post = (login: Login, path: string, payload: unknown, key: string = crypto.randomUUID()) =>
  api.inject({
    method: 'POST',
    url: `/api/workspaces/${login.orgId}${path}`,
    headers: { ...headers(login), 'idempotency-key': key },
    payload,
  })
let owner: Login
/** The whole studio, as the owner reads it. */
const studio = async () => (await get(owner)).json<{ state: BusinessState }>().state
const area = async (login: Login) => (await get(login)).json<{ area: AreaView }>().area
/** Sends a change as this person, at the studio's current revision. */
async function send(login: Login, command: Command, key?: string) {
  return post(login, '/commands', { revision: (await studio()).revision, command }, key)
}
async function ok(login: Login, command: Command, key?: string) {
  const response = await send(login, command, key)
  expect(response.statusCode, response.body).toBe(200)
  return response.json<{ recordId: string }>().recordId
}
async function refused(login: Login, command: Command, status = 403) {
  const response = await send(login, command)
  expect(response.statusCode, response.body).toBe(status)
  return response.json<{ error: string }>().error
}
async function member(email: string, name: string, invite: Record<string, unknown>) {
  const invited = await post(owner, '/invitations', { email, ...invite })
  expect(invited.statusCode, invited.body).toBe(201)
  const login = await register(email, name, invited.json<{ invitation: string }>().invitation)
  return { ...login, orgId: owner.orgId }
}
const request = async (id: string) =>
  (await studio()).operations!.requests!.find((r) => r.id === id)!

/**
 * A studio of its own on its own clock: London (main) and Islington in the London region, with a
 * general manager and a manager at London, a regional manager for London, and the owner's rules:
 * general managers give back up to £50 a receipt, managers up to £30, extra rota days need a
 * sign-off.
 */
async function setup() {
  owner = await register('owner@example.invalid', 'Ada Owner')
  await ok(owner, { type: 'resource', input: { name: 'Room One', type: 'treatment' } })
  const serviceId = await ok(owner, {
    type: 'service',
    input: {
      name: 'Restorative facial',
      description: 'A fictional treatment',
      category: 'Skin',
      durationMinutes: 60,
      bufferMinutes: 15,
      priceMinor: 9500,
      depositMinor: 2000,
      resourceType: 'treatment',
    },
  })
  const staffId = await ok(owner, {
    type: 'staff',
    input: { name: 'Maya Lind', role: 'Facialist', serviceIds: [serviceId], tone: 'sage' },
  })
  await ok(owner, { type: 'protection', settings: { saveCard: true, feePercent: 50 } })
  const { name, locationName, address, timeZone } = (await studio()).organisation
  await ok(owner, {
    type: 'organisation',
    name,
    locationName,
    address,
    timeZone,
    bookingEnabled: true,
  })
  await ok(owner, { type: 'location', input: { name: 'Islington', address: '1 Upper Street' } })
  let state = await studio()
  const main = state.organisation.locationId
  const islington = state.operations!.locations![0].id
  await ok(owner, { type: 'region', input: { name: 'London', locationIds: [main, islington] } })
  state = await studio()
  const london = state.operations!.regions![0].id
  const gia = await member('gia@example.invalid', 'Gia General', {
    role: 'general',
    locationId: main,
  })
  const rae = await member('rae@example.invalid', 'Rae Area', { role: 'regional', areaId: london })
  const mo = await member('mo@example.invalid', 'Mo Manager', { role: 'manager' })
  await ok(owner, {
    type: 'signoff-rules',
    generalRefundLimitMinor: 50_00,
    managerRefundLimitMinor: 30_00,
    rotaSignOff: 'extra',
  })
  const slug = (await get(owner)).json<{ slug: string }>().slug
  return { serviceId, staffId, main, islington, london, gia, rae, mo, slug }
}
type Setup = Awaited<ReturnType<typeof setup>>

/** A guest books online; returns the visit and the guest's private link. */
async function book(s: Setup, date = '2026-10-06', startMinutes = 600) {
  const held = await api.inject({
    method: 'POST',
    url: `/api/public/${s.slug}/holds`,
    payload: { serviceId: s.serviceId, staffId: s.staffId, date, startMinutes },
  })
  expect(held.statusCode, held.body).toBe(201)
  const booked = await api.inject({
    method: 'POST',
    url: `/api/public/${s.slug}/book`,
    payload: { hold: held.json<{ hold: string }>().hold, contact: guest, policy: true },
  })
  expect(booked.statusCode, booked.body).toBe(200)
  const result = booked.json<{ appointmentId: string; manage: { url: string } }>()
  return { appointmentId: result.appointmentId, token: result.manage.url.split('#')[1] }
}
/** A visit today, paid in cash at the desk: a £95 receipt. */
async function paidVisit(s: Setup, startMinutes = 600) {
  const { appointmentId } = await book(s, '2026-10-06', startMinutes)
  await ok(owner, { type: 'arrive', appointmentId })
  await ok(owner, { type: 'checkout', appointmentId, tipMinor: 0, method: 'cash' })
  return (await studio()).sales.find((sale) => sale.appointmentId === appointmentId)!
}
const refund = (saleId: string, amountMinor: number): Command => ({
  type: 'refund',
  saleId,
  amountMinor,
  reason: 'Goodwill refund',
  reference: `till-${amountMinor}`,
  method: 'cash',
})
const askRefund = (s: Setup, saleId: string, amountMinor: number, note = 'Treatment ran short.') =>
  ({
    type: 'request-raise',
    input: { locationId: s.main, kind: 'refund', refund: { saleId }, amountMinor, note },
  }) as Command
const decide = (requestId: string, outcome: 'approved' | 'declined' = 'approved'): Command => ({
  type: 'request-decide',
  requestId,
  outcome,
})

describe('refund sign-offs on the server (Stage 4)', () => {
  it('refuse a general manager over the limit, route the request, and allow that refund once', async () => {
    const s = await setup()
    const sale = await paidVisit(s)
    const other = await paidVisit(s, 720)
    expect(await refused(s.gia, refund(sale.id, 60_00))).toBe(
      'This is over the £50.00 you can give back without a sign-off. Ask for a sign-off from the receipt first.',
    )
    // Within the limit is fine, and counts toward it on that receipt.
    await ok(s.gia, refund(other.id, 30_00))
    expect(await refused(s.gia, refund(other.id, 30_00))).toMatch(/to £60.00, over the £50.00/)

    const id = await ok(s.gia, askRefund(s, sale.id, 60_00))
    let asked = await request(id)
    expect(asked).toMatchObject({
      kind: 'refund',
      title: `Refund on ${sale.receiptNumber}`,
      amountMinor: 60_00,
      routedTo: { level: 'regional', regionId: s.london },
      raisedBy: 'Gia General',
      refund: {
        saleId: sale.id,
        receipt: sale.receiptNumber,
        what: 'Restorative facial',
        paidMinor: 95_00,
        refundedMinor: 0,
      },
    })
    // Waiting, it still cannot be given back.
    expect(await refused(s.gia, refund(sale.id, 60_00))).toMatch(/waiting for a sign-off/)
    // The general manager cannot decide it; the regional manager can.
    expect(await refused(s.gia, decide(id))).toBe('Your role cannot make this change.')
    const before = await studio()
    await ok(s.rae, decide(id))
    asked = await request(id)
    expect(asked.decision).toMatchObject({ outcome: 'approved', by: 'Rae Area' })
    // Approving moved no money.
    const approved = await studio()
    expect(approved.operations!.refunds).toEqual(before.operations!.refunds)
    expect(approved.payments).toEqual(before.payments)

    // Only exactly that amount, and only on that receipt.
    expect(await refused(s.gia, refund(sale.id, 55_00))).toBe(
      'The sign-off for this receipt is for exactly £60.00. Give back that amount, or ask again.',
    )
    expect(await refused(s.gia, refund(other.id, 60_00))).toMatch(/over the £50.00/)
    const key = crypto.randomUUID()
    const recordId = await ok(s.gia, refund(sale.id, 60_00), key)
    asked = await request(id)
    expect(asked.carriedOut).toMatchObject({ by: 'Gia General', recordId })
    // A replay answers the same and gives back nothing more.
    expect(await ok(s.gia, refund(sale.id, 60_00), key)).toBe(recordId)
    expect(
      (await studio())
        .operations!.refunds.filter((r) => r.saleId === sale.id)
        .map((r) => r.amountMinor),
    ).toEqual([60_00])
    // Used: the same again is refused.
    expect(await refused(s.gia, refund(sale.id, 35_00))).toMatch(/to £95.00, over the £50.00/)
  })

  it('lapse after seven of the studio’s days, and when the receipt changes', async () => {
    const s = await setup()
    const sale = await paidVisit(s)
    const id = await ok(s.gia, askRefund(s, sale.id, 60_00))
    await ok(s.rae, decide(id))
    // Tuesday 13 October is the last day; 23:00Z is midnight in London.
    await moveClock('2026-10-13T23:00:00.000Z', owner, s.gia)
    expect(await refused(s.gia, refund(sale.id, 60_00))).toBe(
      'The sign-off for this refund has lapsed. Ask for a sign-off again from the receipt.',
    )
    // Asked again, and something else given back on the receipt meanwhile ends that one too.
    const again = await ok(s.gia, askRefund(s, sale.id, 60_00))
    await ok(owner, decide(again))
    await ok(s.gia, refund(sale.id, 10_00))
    expect(await refused(s.gia, refund(sale.id, 60_00))).toMatch(/has lapsed/)
  })

  it('go up to the owner over the regional limit, never name the client, and work by card', async () => {
    const s = await setup()
    await ok(owner, { type: 'approval-limit', regionalLimitMinor: 50_00 })
    const sale = await paidVisit(s)
    const id = await ok(s.gia, askRefund(s, sale.id, 60_00))
    expect(await request(id)).toMatchObject({
      routedTo: { level: 'owner' },
      passedUp: 'over-limit',
    })
    expect(await refused(s.rae, decide(id))).toBe('This request has passed up to the owner.')
    // The client's name or contact in the reason is refused, so it never reaches the region.
    const named = await send(s.gia, askRefund(s, sale.id, 20_00, 'Rosa was unhappy with it.'))
    expect(named.statusCode).not.toBe(200)
    expect(named.json<{ error: string }>().error).toMatch(/Leave the client’s name and details out/)
    // The regional manager reads the receipt, amount and treatment only.
    const view = JSON.stringify(await area(s.rae))
    expect(view).toContain(sale.receiptNumber!)
    expect(view).toContain('Restorative facial')
    const client = (await studio()).clients.find((c) => c.email === guest.email)!
    for (const detail of [guest.name, 'Rosa', guest.email, '7700 900333', client.id])
      expect(view).not.toContain(detail)

    // A deposit paid by card goes back by card, with a manager's sign-off, in test mode.
    const { appointmentId, token } = await book(s, '2026-10-07', 600)
    const opened = await api.inject({
      method: 'POST',
      url: '/api/guest/pay',
      payload: { token, purpose: 'deposit', saveCard: false },
    })
    expect(opened.statusCode, opened.body).toBe(200)
    const attemptId = opened.json<{ url: string }>().url.split('#')[1]
    const paid = await api.inject({
      method: 'POST',
      url: `/api/test-payments/${attemptId}`,
      payload: { outcome: 'pay', card: '4242' },
    })
    expect(paid.statusCode, paid.body).toBe(200)
    await ok(owner, {
      type: 'cancel',
      appointmentId,
      reason: 'Guest is unwell',
      deposit: 'refund_due',
    } as Command)
    await ok(owner, { ...signoffRules, managerRefundLimitMinor: 10_00 })
    const deposit = (await studio()).payments.find(
      (p) => p.appointmentId === appointmentId && p.kind === 'deposit',
    )!
    const cardRefund = (key = crypto.randomUUID()) =>
      post(
        s.mo,
        '/card-refunds',
        { paymentId: deposit.id, amountMinor: 20_00, reason: 'Visit cancelled, deposit back' },
        key,
      )
    const over = await cardRefund()
    expect(over.statusCode, over.body).toBe(403)
    expect(over.json<{ error: string }>().error).toMatch(/over the £10.00/)
    const depositAsk = await ok(s.mo, {
      type: 'request-raise',
      input: {
        locationId: s.main,
        kind: 'refund',
        refund: { paymentId: deposit.id },
        amountMinor: 20_00,
        note: 'Visit cancelled in good time.',
      },
    })
    expect(await request(depositAsk)).toMatchObject({
      routedTo: { level: 'regional', regionId: s.london },
      refund: { receipt: 'Deposit', what: 'Restorative facial', paidMinor: 20_00 },
    })
    await ok(s.rae, decide(depositAsk))
    const back = await cardRefund()
    expect(back.statusCode, back.body).toBe(200)
    expect(back.json<{ status: string; testMode: boolean }>()).toMatchObject({
      status: 'succeeded',
    })
    const after = await studio()
    const given = after.operations!.refunds.at(-1)!
    expect(given).toMatchObject({ paymentId: deposit.id, method: 'card', amountMinor: 20_00 })
    expect(after.operations!.requests!.find((r) => r.id === depositAsk)!.carriedOut).toMatchObject({
      recordId: given.id,
    })
  })
})

const signoffRules = {
  type: 'signoff-rules',
  generalRefundLimitMinor: 50_00,
  managerRefundLimitMinor: 30_00,
  rotaSignOff: 'extra',
} as const

describe('price and rota sign-offs on the server (Stage 4)', () => {
  it('start an approved price on its day by itself, keeping booked visits at their price', async () => {
    const s = await setup()
    const ask: Command = {
      type: 'request-raise',
      input: {
        locationId: s.main,
        kind: 'price',
        price: { serviceId: s.serviceId, priceMinor: 105_00, startsOn: '2026-10-08' },
        note: 'The new serum costs more.',
      },
    }
    const id = await ok(s.gia, ask)
    expect(await request(id)).toMatchObject({
      title: 'New price for Restorative facial',
      routedTo: { level: 'regional', regionId: s.london },
      price: { fromMinor: 95_00, toMinor: 105_00, startsOn: '2026-10-08' },
    })
    await ok(s.rae, decide(id))
    // Booked before the day, at today's price.
    const { appointmentId } = await book(s, '2026-10-09', 600)
    expect(api.signOffs.run()).toBe(0)
    let state = await studio()
    expect(
      serviceAt(
        state.services.find((x) => x.id === s.serviceId)!,
        s.main,
      ).priceMinor,
    ).toBe(95_00)
    // Half past midnight on Thursday 8 October in London.
    await moveClock('2026-10-07T23:30:00.000Z', owner)
    expect(api.signOffs.run()).toBe(1)
    expect(api.signOffs.run()).toBe(0)
    state = await studio()
    const facial = state.services.find((x) => x.id === s.serviceId)!
    expect(serviceAt(facial, s.main).priceMinor).toBe(105_00)
    // Islington keeps the price it had.
    expect(serviceAt(facial, s.islington).priceMinor).toBe(95_00)
    expect(state.appointments.find((a) => a.id === appointmentId)!.bookedPriceMinor).toBe(95_00)
    expect(state.operations!.requests!.find((r) => r.id === id)!.carriedOut).toMatchObject({
      by: 'SALEANE',
    })
    // Who changed what keeps it, made by SALEANE, with the price before and after.
    const changes = (await get(owner, '/changes')).json<{
      entries: { who: string; what: string; lines: string[] }[]
    }>()
    expect(changes.entries[0]).toMatchObject({
      who: 'SALEANE',
      what: 'Started a new price that was signed off',
    })
    expect(JSON.stringify(changes.entries[0].lines)).toMatch(/£95.*£105/)
  })

  it('apply exactly the rota change asked for, once it is approved', async () => {
    const s = await setup()
    const day = '2026-10-07'
    const rota: Command = {
      type: 'rota-day',
      input: { staffId: s.staffId, date: day, working: true, open: 600, close: 900 },
    }
    const id = await ok(s.gia, {
      type: 'request-raise',
      input: { locationId: s.main, kind: 'rota', rota, note: 'Cover for the launch' },
    } as Command)
    let asked: ApprovalRequest = await request(id)
    expect(asked).toMatchObject({
      routedTo: { level: 'regional', regionId: s.london },
      rota: { command: rota, staffId: s.staffId, date: day, after: '600-900' },
    })
    // Nothing changes while it waits.
    let state = await studio()
    expect(plannedHoursFor(state, s.staffId, day)).not.toMatchObject({ open: 600, close: 900 })
    // A request raised by the region's own manager passes up; the raiser never decides it.
    const spend = await ok(s.rae, {
      type: 'request-raise',
      input: { locationId: s.main, kind: 'spend', title: 'New basin', amountMinor: 120_00 },
    })
    expect(await request(spend)).toMatchObject({ passedUp: 'own-request' })
    expect(await refused(s.rae, decide(spend))).toBe('This request has passed up to the owner.')
    expect(await refused(s.mo, decide(id))).toBe('Your role cannot make this change.')
    // A regional manager does not ask for rota days themselves.
    expect(
      await refused(s.rae, {
        type: 'request-raise',
        input: { locationId: s.main, kind: 'rota', rota },
      } as Command),
    ).toBe('Refunds, prices and rota changes are asked for by the location’s team.')

    await ok(s.rae, decide(id))
    state = await studio()
    expect(plannedHoursFor(state, s.staffId, day)).toMatchObject({ open: 600, close: 900 })
    asked = state.operations!.requests!.find((r) => r.id === id)!
    expect(asked.decision).toMatchObject({ outcome: 'approved', by: 'Rae Area' })
    expect(asked.carriedOut).toMatchObject({ by: 'Rae Area' })
    const changes = (await get(owner, '/changes')).json<{
      entries: { who: string; what: string; lines: string[] }[]
    }>()
    expect(changes.entries[0]).toMatchObject({ who: 'Rae Area' })
    expect(JSON.stringify(changes.entries[0].lines)).toMatch(/10:00/)
  })
})

describe('the sample studio on the server (Stage 4)', () => {
  it('has a request of each kind at its own location, and approving the refund moves nothing', async () => {
    const response = await api.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        name: 'Ada Owner',
        email: 'sample@example.invalid',
        password,
        workspace: { name: 'Sample Studio', locationName: 'London', region: 'UK', sample: true },
      },
    })
    expect(response.statusCode, response.body).toBe(201)
    owner = {
      ...response.json<{ csrf: string; orgId: string }>(),
      cookie: cookie(response),
      userId: '',
      email: 'sample@example.invalid',
    }
    const state = await studio()
    const asked = state.operations!.requests!
    expect(asked.map((r) => [r.kind, r.locationId, !!r.decision])).toEqual([
      ['refund', state.organisation.locationId, false],
      ['price', state.organisation.locationId, false],
      ['rota', state.organisation.locationId, false],
    ])
    await ok(owner, decide(asked[0].id))
    const after = await studio()
    expect(after.operations!.refunds).toEqual(state.operations!.refunds)
    expect(after.payments).toEqual(state.payments)
  })
})
