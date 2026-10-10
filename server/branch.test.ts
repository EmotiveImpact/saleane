// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApiHandler } from './app'
import type { ApiHandler, InjectResponse } from './app'
import type { BusinessState } from '../src/domain/model'
import type { Command } from '../src/domain/commands'

// V5: a general manager runs one location and changes nothing elsewhere.
const origin = 'http://127.0.0.1:5173'
const password = 'Fictional local account 2026!'
type Login = { cookie: string; csrf: string; orgId: string; userId: string }
let api: ApiHandler

beforeEach(() => {
  api = createApiHandler({
    origin,
    databasePath: ':memory:',
    now: () => Date.parse('2026-10-06T08:00:00.000Z'),
  })
})
afterEach(() => api.close())

const headers = (login: Login) => ({ cookie: login.cookie, 'x-csrf-token': login.csrf })
const cookie = (response: InjectResponse) => String(response.headers['set-cookie']).split(';')[0]
async function register(email: string, invitation?: string, name = 'Studio Owner') {
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
              name: 'Reference Studio',
              locationName: 'London',
              region: 'UK',
              sample: true,
            },
          }),
    },
  })
  expect(response.statusCode, response.body).toBe(201)
  const login = {
    ...response.json<{ csrf: string; orgId: string }>(),
    cookie: cookie(response),
    userId: '',
  }
  login.userId = (await api.inject({ url: '/api/session', headers: headers(login) })).json<{
    user: { id: string }
  }>().user.id
  return login
}
const get = (login: Login, path = '') =>
  api.inject({ url: `/api/workspaces/${login.orgId}${path}`, headers: headers(login) })
const post = (login: Login, path: string, payload: unknown, extra: Record<string, string> = {}) =>
  api.inject({
    method: 'POST',
    url: `/api/workspaces/${login.orgId}${path}`,
    headers: { ...headers(login), ...extra },
    payload,
  })
const run = (login: Login, revision: number, command: Command, key: string = crypto.randomUUID()) =>
  post(login, '/commands', { revision, command }, { 'idempotency-key': key })
async function studio(owner: Login) {
  return (await get(owner)).json<{ state: BusinessState }>().state
}
const ok = async (login: Login, revision: number, command: Command) => {
  const response = await run(login, revision, command)
  expect(response.statusCode, response.body).toBe(200)
  return response
}
/** A sample studio with Islington open, a room there and Nia working there every day. */
async function twoSites() {
  const owner = await register('owner@example.invalid')
  let state = await studio(owner)
  await ok(owner, state.revision, {
    type: 'location',
    input: { name: 'Islington', address: '1 Upper Street' },
  })
  state = await studio(owner)
  const islington = state.operations!.locations![0].id
  await ok(owner, state.revision, {
    type: 'resource',
    input: { name: 'Islington room', type: 'treatment', locationId: islington },
  } as Command)
  state = await studio(owner)
  await ok(owner, state.revision, {
    type: 'staff',
    input: {
      name: 'Nia Fictional',
      role: 'Facialist',
      serviceIds: ['service-facial'],
      tone: 'sage',
      hours: state.operations!.hours.map((h) => ({ ...h, locationId: islington })),
    },
  } as Command)
  state = await studio(owner)
  const nia = state.staff.find((p) => p.name === 'Nia Fictional')!.id
  return { owner, islington, main: state.organisation.locationId, nia }
}
async function general(owner: Login, email: string, locationId: string) {
  const invitation = await post(owner, '/invitations', { email, role: 'general', locationId })
  expect(invitation.statusCode, invitation.body).toBe(201)
  const login = await register(
    email,
    invitation.json<{ invitation: string }>().invitation,
    'Gia General',
  )
  return { ...login, orgId: owner.orgId }
}
const visit = (staffId: string, extra: Record<string, unknown> = {}): Command =>
  ({
    type: 'book',
    input: {
      serviceId: 'service-facial',
      staffId,
      date: '2026-10-08',
      startMinutes: 600,
      clientId: 'client-1',
      source: 'desk',
      ...extra,
    },
  }) as Command

describe('general manager access (V5)', () => {
  it('needs an open location before inviting', async () => {
    const { owner, islington } = await twoSites()
    const invite = (payload: Record<string, unknown>) => post(owner, '/invitations', payload)
    expect((await invite({ email: 'g@example.invalid', role: 'general' })).statusCode).toBe(422)
    expect(
      (await invite({ email: 'g@example.invalid', role: 'general', locationId: 'nowhere' }))
        .statusCode,
    ).toBe(422)
    expect(
      (await invite({ email: 'g@example.invalid', role: 'general', locationId: islington }))
        .statusCode,
    ).toBe(201)
    const team = (await get(owner, '/team')).json<{ invitations: { locationId: string }[] }>()
    expect(team.invitations.map((i) => i.locationId)).toEqual([islington])
  })

  it('reads the studio without pay rates and other locations’ private records', async () => {
    const { owner, islington } = await twoSites()
    const gia = await general(owner, 'gia@example.invalid', islington)
    const response = await get(gia)
    expect(response.statusCode, response.body).toBe(200)
    const body = response.json<{
      view: string
      role: string
      locationId: string
      state: BusinessState
    }>()
    expect(body.view).toBe('studio')
    expect(body.role).toBe('general')
    expect(body.locationId).toBe(islington)
    expect(body.state.operations!.payRates).toBeUndefined()
    // The sample branch visit is at the main location, so it is not theirs to read.
    expect(body.state.operations!.branchVisits ?? []).toEqual([])
    expect((await studio(owner)).operations!.branchVisits!.length).toBeGreaterThan(0)
    // Owner-only and team pages stay shut.
    expect((await get(gia, '/team')).statusCode).toBe(403)
    expect((await get(gia, '/day-sheet')).statusCode).toBe(200)
  })

  it('books, moves and takes payment only at their own location', async () => {
    const { owner, islington, main, nia } = await twoSites()
    const gia = await general(owner, 'gia@example.invalid', islington)
    let state = await studio(gia)
    // Booking without saying where puts the visit at their location.
    const booked = await run(gia, state.revision, visit(nia))
    expect(booked.statusCode, booked.body).toBe(200)
    state = booked.json<{ state: BusinessState }>().state
    const mine = state.appointments.find(
      (a) => a.id === booked.json<{ recordId: string }>().recordId,
    )!
    expect(mine.locationId).toBe(islington)
    // Not at the main location.
    const elsewhere = await run(gia, state.revision, visit('staff-maya', { locationId: main }))
    expect(elsewhere.statusCode).toBe(403)
    expect(elsewhere.json<{ error: string }>().error).toBe('That visit is at another location.')
    // Not on a visit at the main location.
    const theirs = state.appointments.find(
      (a) => a.locationId === main && a.status === 'confirmed',
    )!
    const cancel = await run(gia, state.revision, {
      type: 'cancel',
      appointmentId: theirs.id,
      reason: 'Guest asked',
    } as Command)
    expect(cancel.statusCode).toBe(403)
    // Moving their own visit to someone working at the main location is refused once made.
    const move = await run(gia, state.revision, {
      type: 'reschedule',
      appointmentId: mine.id,
      staffId: 'staff-maya',
      date: '2026-10-08',
      startMinutes: 720,
    } as Command)
    expect([403, 409]).toContain(move.statusCode)
    const after = (await studio(owner)).appointments.find((a) => a.id === mine.id)!
    expect(after.locationId).toBe(islington)
    expect(after.staffId).toBe(nia)
    // Their own visit they can cancel.
    const own = await run(gia, (await studio(gia)).revision, {
      type: 'cancel',
      appointmentId: mine.id,
      reason: 'Guest asked',
    } as Command)
    expect(own.statusCode, own.body).toBe(200)
  })

  it('changes clients and their location’s stock, never the whole business', async () => {
    const { owner, islington, main } = await twoSites()
    const gia = await general(owner, 'gia@example.invalid', islington)
    const state = await studio(gia)
    const note = await run(gia, state.revision, {
      type: 'note',
      clientId: state.clients[0].id,
      text: 'Prefers mornings',
    })
    expect(note.statusCode, note.body).toBe(200)
    let revision = note.json<{ state: BusinessState }>().state.revision
    const product = state.operations!.products?.[0]
    expect(product).toBeDefined()
    if (product) {
      const count = (locationId: string) =>
        run(gia, revision, {
          type: 'stock',
          productId: product.id,
          locationId,
          quantity: 5,
          reason: 'adjustment',
          note: 'Counted',
        })
      expect((await count(main)).statusCode).toBe(403)
      const here = await count(islington)
      expect(here.statusCode, here.body).toBe(200)
      revision = here.json<{ state: BusinessState }>().state.revision
    }
    for (const command of [
      { type: 'approval-limit', regionalLimitMinor: 1 },
      { type: 'region-remove', regionId: 'x' },
      { type: 'location', input: { name: 'Camden', address: '3 High Street' } },
      { type: 'request-decide', requestId: 'x', outcome: 'approved' },
    ] as Command[])
      expect((await run(gia, revision, command)).statusCode).toBe(403)
    // A request at their location goes up as anyone's would.
    const raise = await run(gia, revision, {
      type: 'request-raise',
      input: { locationId: islington, kind: 'other', title: 'Paint the front' },
    })
    expect(raise.statusCode, raise.body).toBe(200)
    const elsewhere = await run(gia, raise.json<{ state: BusinessState }>().state.revision, {
      type: 'request-raise',
      input: { locationId: main, kind: 'other', title: 'Paint the front' },
    })
    expect(elsewhere.statusCode).toBe(403)
  })

  it('sells gift cards and packages at their own location', async () => {
    const { owner, islington, main } = await twoSites()
    const gia = await general(owner, 'gia@example.invalid', islington)
    let state = await studio(owner)
    const offer = await ok(owner, state.revision, {
      type: 'offer',
      input: {
        kind: 'package',
        name: 'Five facials',
        serviceIds: ['service-facial'],
        visits: 5,
        priceMinor: 40000,
        discountPercent: 0,
        validMonths: 6,
        archived: false,
      },
    } as Command)
    const offerId = offer.json<{ recordId: string }>().recordId
    const card = (locationId?: string) =>
      ({
        type: 'gift-card-sell',
        input: {
          kind: 'money',
          valueMinor: 5000,
          purchaserName: 'Ada Lovelace',
          recipientName: 'Grace',
          message: '',
        },
        method: 'demo_cash',
        ...(locationId ? { locationId } : {}),
      }) as Command
    state = await studio(gia)
    const sold = await run(gia, state.revision, card())
    expect(sold.statusCode, sold.body).toBe(200)
    const plan = await run(gia, sold.json<{ state: BusinessState }>().state.revision, {
      type: 'plan-sell',
      offerId,
      clientId: 'client-1',
      method: 'demo_cash',
    } as Command)
    expect(plan.statusCode, plan.body).toBe(200)
    state = await studio(owner)
    expect(state.giftCards!.at(-1)!.locationId).toBe(islington)
    expect(state.holdings!.at(-1)!.locationId).toBe(islington)
    // Not at the main location.
    const elsewhere = await run(gia, state.revision, card(main))
    expect(elsewhere.statusCode).toBe(403)
    // The owner's sale without a location counts at the main location.
    const own = await run(owner, state.revision, card())
    expect(own.statusCode, own.body).toBe(200)
    expect((await studio(owner)).giftCards!.at(-1)!.locationId).toBeUndefined()
  })

  it('is shut out when their location closes, and follows a change of location', async () => {
    const { owner, islington, main } = await twoSites()
    const gia = await general(owner, 'gia@example.invalid', islington)
    const team = (await get(owner, '/team')).json<{ members: { id: string; role: string }[] }>()
    const id = team.members.find((m) => m.role === 'general')!.id
    expect(
      (await post(owner, '/membership', { accountId: id, role: 'general', locationId: main }))
        .statusCode,
    ).toBe(200)
    expect((await get(gia)).json<{ locationId: string }>().locationId).toBe(main)
    expect(
      (await post(owner, '/membership', { accountId: id, role: 'general', locationId: islington }))
        .statusCode,
    ).toBe(200)
    const state = await studio(owner)
    const close = await run(owner, state.revision, {
      type: 'location',
      id: islington,
      input: { name: 'Islington', address: '1 Upper Street', archived: true },
    } as Command)
    expect(close.statusCode, close.body).toBe(200)
    const gone = await get(gia)
    expect(gone.statusCode).toBe(403)
    expect(gone.body).toMatch(/location has closed/)
  })

  it('is refused on every route once their location closes, before anything is saved', async () => {
    const { owner, islington } = await twoSites()
    const gia = await general(owner, 'gia@example.invalid', islington)
    const later = await post(owner, '/invitations', {
      email: 'gus@example.invalid',
      role: 'general',
      locationId: islington,
    })
    // Open, they read the day sheet and their own pages.
    expect((await get(gia, '/day-sheet')).statusCode).toBe(200)
    expect((await get(gia, '/audit')).statusCode).toBe(200)
    let state = await studio(owner)
    const close = await run(owner, state.revision, {
      type: 'location',
      id: islington,
      input: { name: 'Islington', address: '1 Upper Street', archived: true },
    } as Command)
    expect(close.statusCode, close.body).toBe(200)
    state = await studio(owner)
    const before = state.revision
    // A change to a client passes the location rules, but is refused before it is saved.
    const note = await run(gia, before, {
      type: 'note',
      clientId: state.clients[0].id,
      text: 'Prefers mornings',
    })
    expect(note.statusCode).toBe(403)
    expect(note.json<{ error: string }>().error).toMatch(/^Your location has closed\./)
    expect((await studio(owner)).revision).toBe(before)
    expect((await studio(owner)).events.some((e) => e.detail === 'Prefers mornings')).toBe(false)
    // Nothing else reads or changes anything for them either.
    for (const path of ['', '/day-sheet', '/audit', '/payments', '/outbox', '/assistant']) {
      const response = await get(gia, path)
      expect(response.statusCode, path).toBe(403)
      expect(response.json<{ error: string }>().error, path).toMatch(/^Your location has closed\./)
    }
    const ask = await post(gia, '/assistant', { text: 'Who is in today?' })
    expect(ask.statusCode).toBe(403)
    expect(ask.json<{ error: string }>().error).toMatch(/^Your location has closed\./)
    const link = await post(gia, '/guest-links', { appointmentId: state.appointments[0].id })
    expect(link.statusCode).toBe(403)
    // An invitation to the closed location can no longer be accepted.
    const join = await api.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        name: 'Gus General',
        email: 'gus@example.invalid',
        password,
        invitation: later.json<{ invitation: string }>().invitation,
      },
    })
    expect(join.statusCode).toBe(403)
    expect((await get(owner, '/team')).json<{ members: unknown[] }>().members).toHaveLength(2)
  })
})

describe('clocking in at the location a general manager runs (NEXT-07)', () => {
  it('clocks in only the people working there today, and shows only their hours', async () => {
    const { owner, islington, nia } = await twoSites()
    const gia = await general(owner, 'gia@example.invalid', islington)
    let state = await studio(owner)
    // The sample studio's own fortnight of hours is all at the main location.
    expect(state.operations!.shifts!.length).toBeGreaterThan(0)
    const elsewhere = await run(gia, state.revision, { type: 'clock-in', staffId: 'staff-maya' })
    expect(elsewhere.statusCode).toBe(403)
    expect(elsewhere.json().error).toBe('That person works at another location today.')
    await ok(gia, state.revision, { type: 'clock-in', staffId: nia })
    state = await studio(owner)
    expect(state.operations!.shifts!.at(-1)).toMatchObject({
      staffId: nia,
      locationId: islington,
      actor: 'Gia General',
    })
    const theirs = (await get(gia)).json<{ state: BusinessState }>().state
    expect(theirs.operations!.shifts!.map((x) => x.staffId)).toEqual([nia])
    // Putting hours right is for owners and managers.
    const fix = await run(gia, state.revision, {
      type: 'shift-remove',
      shiftId: state.operations!.shifts!.at(-1)!.id,
      reason: 'Not needed',
    })
    expect(fix.statusCode).toBe(403)
  })
})
