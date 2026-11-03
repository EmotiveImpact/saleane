// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApiHandler } from './app'
import type { ApiHandler, InjectResponse } from './app'
import type { BusinessState } from '../src/domain/model'
import type { Command } from '../src/domain/commands'
import type { AreaView } from '../src/domain/area'

// V5: a regional manager reads and changes only their own region's branches.
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
/** A sample studio with three locations: London (main) and Islington in "London", Leeds in "North". */
async function group() {
  const owner = await register('owner@example.invalid')
  let state = await studio(owner)
  await ok(owner, state.revision, {
    type: 'location',
    input: { name: 'Islington', address: '1 Upper Street' },
  })
  state = await studio(owner)
  await ok(owner, state.revision, {
    type: 'location',
    input: { name: 'Leeds', address: '2 Briggate' },
  })
  state = await studio(owner)
  const [main, islington, leeds] = [
    state.organisation.locationId,
    state.operations!.locations![0].id,
    state.operations!.locations![1].id,
  ]
  await ok(owner, state.revision, {
    type: 'region',
    input: { name: 'London', locationIds: [main, islington] },
  })
  state = await studio(owner)
  await ok(owner, state.revision, {
    type: 'region',
    input: { name: 'North', locationIds: [leeds] },
  })
  state = await studio(owner)
  const regionId = (name: string) => state.operations!.regions!.find((r) => r.name === name)!.id
  return {
    owner,
    state,
    main,
    islington,
    leeds,
    london: regionId('London'),
    north: regionId('North'),
  }
}
async function regional(owner: Login, email: string, areaId: string) {
  const invitation = await post(owner, '/invitations', { email, role: 'regional', areaId })
  expect(invitation.statusCode, invitation.body).toBe(201)
  const login = await register(
    email,
    invitation.json<{ invitation: string }>().invitation,
    'Rae Area',
  )
  return { ...login, orgId: owner.orgId }
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

describe('regional manager access (V5)', () => {
  it('needs a region with an open location before inviting', async () => {
    const { owner, london } = await group()
    const invite = (payload: Record<string, unknown>) => post(owner, '/invitations', payload)
    expect((await invite({ email: 'r@example.invalid', role: 'regional' })).statusCode).toBe(422)
    expect(
      (await invite({ email: 'r@example.invalid', role: 'regional', areaId: 'nowhere' }))
        .statusCode,
    ).toBe(422)
    expect(
      (await invite({ email: 'r@example.invalid', role: 'regional', areaId: london })).statusCode,
    ).toBe(201)
    const team = (await get(owner, '/team')).json<{ invitations: { areaId: string | null }[] }>()
    expect(team.invitations.map((i) => i.areaId)).toEqual([london])
  })

  it('reads only their region, never the studio record', async () => {
    const { owner, main, islington, leeds, london } = await group()
    const rae = await regional(owner, 'rae@example.invalid', london)
    const response = await get(rae)
    expect(response.statusCode, response.body).toBe(200)
    const body = response.json<{ view: string; role: string; area: AreaView; state?: unknown }>()
    expect(body.view).toBe('area')
    expect(body.role).toBe('regional')
    expect(body.state).toBeUndefined()
    expect(body.area.area.name).toBe('London')
    expect(body.area.places.map((p) => p.id)).toEqual([main, islington])
    // A real studio has no map until a map service is connected.
    expect(body.area.map).toBeNull()
    const json = JSON.stringify(body)
    expect(json).not.toContain(leeds)
    const full = await studio(owner)
    for (const client of full.clients) {
      expect(json).not.toContain(client.email)
      expect(json).not.toContain(client.id)
    }
    for (const field of [
      'appointments',
      'payments',
      'sales',
      'payRates',
      'clients',
      // Stage 3: commission by treatment, steps by takings, targets and rent.
      'commissionRates',
      'commissionSteps',
      'staffTargets',
      'rentals',
    ])
      expect(json).not.toContain(`"${field}"`)
    // The sample visit is at the main location, in their region.
    expect(body.area.visits.map((v) => v.locationId)).toEqual([main])
    expect(body.area.summary.at(-2)).toMatch(/still to put right/)
  })

  it('is refused by every other studio route', async () => {
    const { owner, london } = await group()
    const rae = await regional(owner, 'rae@example.invalid', london)
    let open = 0
    for (const path of [
      '/team',
      '/day-sheet',
      '/outbox',
      '/audit',
      '/connections',
      '/api-keys',
      '/social',
      '/assistant',
      '/google',
      '/privacy/studio/export',
      '/payments',
      '/messages',
    ]) {
      const mine = await get(owner, path)
      if (mine.statusCode !== 200) continue
      open += 1
      const response = await get(rae, path)
      expect(response.statusCode, `${path}: ${response.body}`).toBe(403)
      expect(response.body).not.toContain('"state"')
    }
    // Enough of these are real routes for the owner that the refusals mean something.
    expect(open).toBeGreaterThanOrEqual(6)
    const ask = await post(rae, '/assistant', { question: 'Who is in today?' })
    expect(ask.statusCode).toBe(403)
    const link = await post(rae, '/guest-links', { appointmentId: 'anything' })
    expect(link.statusCode).toBe(403)
  })

  it('records branch visits at their own locations only', async () => {
    const { owner, main, leeds, london } = await group()
    const rae = await regional(owner, 'rae@example.invalid', london)
    const area = async () => (await get(rae)).json<{ area: AreaView }>().area
    let view = await area()
    const list = view.checklists[0]
    const visit = (locationId: string): Command => ({
      type: 'branch-visit',
      input: {
        locationId,
        checklistId: list.id,
        date: '2026-10-06',
        answers: list.items.map((item, i) => ({ itemId: item.id, answer: i ? 'yes' : 'no' })),
      },
    })
    const elsewhere = await run(rae, view.revision, visit(leeds))
    expect(elsewhere.statusCode).toBe(403)
    expect(elsewhere.json<{ error: string }>().error).toBe('That location is not in your area.')
    const saved = await run(rae, view.revision, visit(main))
    expect(saved.statusCode, saved.body).toBe(200)
    view = saved.json<{ area: AreaView }>().area
    const mine = view.visits.find((v) => v.actor === 'Rae Area')!
    expect(mine.locationId).toBe(main)
    const fix = await run(rae, view.revision, {
      type: 'branch-visit-fix',
      visitId: mine.id,
      itemId: mine.answers[0].itemId,
    })
    expect(fix.statusCode, fix.body).toBe(200)
    // Nothing else: not even a client note.
    const full = await studio(owner)
    const note = await run(rae, full.revision, {
      type: 'note',
      clientId: full.clients[0].id,
      text: 'Hello',
    } as Command)
    expect(note.statusCode).toBe(403)
    // A visit at Leeds recorded by the owner cannot be fixed by them.
    await ok(owner, full.revision, visit(leeds))
    const leedsVisit = (await studio(owner)).operations!.branchVisits!.find(
      (v) => v.locationId === leeds,
    )!
    const refused = await run(rae, (await studio(owner)).revision, {
      type: 'branch-visit-fix',
      visitId: leedsVisit.id,
      itemId: leedsVisit.answers[0].itemId,
    })
    expect(refused.statusCode).toBe(403)
  })

  it('loses the view when their region goes, and follows a change of region', async () => {
    const { owner, leeds, london, north } = await group()
    const rae = await regional(owner, 'rae@example.invalid', london)
    const team = (await get(owner, '/team')).json<{ members: { id: string; role: string }[] }>()
    const id = team.members.find((m) => m.role === 'regional')!.id
    expect(
      (await post(owner, '/membership', { accountId: id, role: 'regional', areaId: north }))
        .statusCode,
    ).toBe(200)
    expect((await get(rae)).json<{ area: AreaView }>().area.places.map((p) => p.id)).toEqual([
      leeds,
    ])
    const state = await studio(owner)
    await ok(owner, state.revision, { type: 'region-remove', regionId: north })
    const gone = await get(rae)
    expect(gone.statusCode).toBe(403)
    expect(gone.body).toMatch(/no open locations/)
    // Changing them to reception gives them the desk record again.
    expect(
      (await post(owner, '/membership', { accountId: id, role: 'reception' })).statusCode,
    ).toBe(200)
    expect((await get(rae)).json<{ view: string }>().view).toBe('studio')
  })

  it('routes requests to the regional manager, or up to the owner', async () => {
    const { owner, main, leeds, london } = await group()
    const rae = await regional(owner, 'rae@example.invalid', london)
    const area = async () => (await get(rae)).json<{ area: AreaView }>().area
    const raise = (login: Login, revision: number, locationId: string, amountMinor: number) =>
      run(login, revision, {
        type: 'request-raise',
        input: { locationId, kind: 'spend', title: 'New basin', amountMinor },
        // A browser cannot claim which regions have a manager.
        managedRegions: [],
      })
    // Within their limit at their own location, raised by someone at the branch: theirs to decide.
    let view = await area()
    expect(view.regionalLimitMinor).toBe(500_00)
    const gia = await general(owner, 'gia@example.invalid', main)
    let saved = await raise(gia, (await studio(owner)).revision, main, 200_00)
    expect(saved.statusCode, saved.body).toBe(200)
    view = await area()
    const small = view.requests.at(-1)!
    expect(small.routedTo).toEqual({ level: 'regional', regionId: london })
    expect(small.raisedBy).toBe('Gia General')
    expect(small.raisedById).toBe(gia.userId)
    expect(view.summary).toContain('1 request is waiting for your sign-off.')
    // Their own request, however small, goes to the owner: nobody signs off their own spending.
    saved = await raise(rae, view.revision, main, 200_00)
    expect(saved.statusCode, saved.body).toBe(200)
    view = saved.json<{ area: AreaView }>().area
    const own = view.requests.at(-1)!
    expect(own.routedTo).toEqual({ level: 'owner' })
    expect(own.raisedBy).toBe('Rae Area')
    expect(own.raisedById).toBe(rae.userId)
    const self = await run(rae, view.revision, {
      type: 'request-decide',
      requestId: own.id,
      outcome: 'approved',
    })
    expect(self.statusCode).toBe(403)
    // Over the limit: passes up to the owner, which they can see but not decide.
    saved = await raise(rae, view.revision, main, 900_00)
    view = saved.json<{ area: AreaView }>().area
    const big = view.requests.at(-1)!
    expect(big.routedTo).toEqual({ level: 'owner' })
    expect(big.passedUp).toBe('over-limit')
    const passed = await run(rae, view.revision, {
      type: 'request-decide',
      requestId: big.id,
      outcome: 'approved',
    })
    expect(passed.statusCode).toBe(403)
    expect(passed.json<{ error: string }>().error).toBe('This request has passed up to the owner.')
    // Not at another region's location.
    expect((await raise(rae, view.revision, leeds, 100_00)).statusCode).toBe(403)
    // They decide the one sent to them, once.
    const decided = await run(rae, view.revision, {
      type: 'request-decide',
      requestId: small.id,
      outcome: 'approved',
      note: 'Go ahead',
    })
    expect(decided.statusCode, decided.body).toBe(200)
    view = decided.json<{ area: AreaView }>().area
    expect(view.requests.find((r) => r.id === small.id)!.decision).toMatchObject({
      outcome: 'approved',
      by: 'Rae Area',
    })
    const again = await run(rae, view.revision, {
      type: 'request-decide',
      requestId: small.id,
      outcome: 'declined',
    })
    expect(again.statusCode).toBe(422)
    // The owner can decide the one that passed up.
    const state = await studio(owner)
    await ok(owner, state.revision, {
      type: 'request-decide',
      requestId: big.id,
      outcome: 'declined',
    })
    // Leeds has no regional manager, so its requests go straight to the owner.
    const after = await studio(owner)
    await ok(owner, after.revision, {
      type: 'request-raise',
      input: { locationId: leeds, kind: 'other', title: 'Close early on Friday' },
    })
    const leedsRequest = (await studio(owner)).operations!.requests!.at(-1)!
    expect(leedsRequest.routedTo).toEqual({ level: 'owner' })
    expect(leedsRequest.passedUp).toBe('no-manager')
  })

  it('lets managers raise but not decide, and keeps requests from the desk', async () => {
    const { owner, main, london } = await group()
    await regional(owner, 'rae@example.invalid', london)
    const invite = async (email: string, role: string) => {
      const invitation = await post(owner, '/invitations', { email, role })
      expect(invitation.statusCode, invitation.body).toBe(201)
      const login = await register(email, invitation.json<{ invitation: string }>().invitation)
      return { ...login, orgId: owner.orgId }
    }
    const manager = await invite('manager@example.invalid', 'manager')
    let state = await studio(manager)
    await ok(manager, state.revision, {
      type: 'request-raise',
      input: { locationId: main, kind: 'spend', title: 'Window cleaner', amountMinor: 80_00 },
      // A browser cannot say who raised it, or that they look after the region.
      raisedById: 'someone-else',
      raiserRegion: london,
    } as Command)
    state = await studio(manager)
    const request = state.operations!.requests!.at(-1)!
    expect(request.routedTo).toEqual({ level: 'regional', regionId: london })
    expect(request.raisedById).toBe(manager.userId)
    const decide = await run(manager, state.revision, {
      type: 'request-decide',
      requestId: request.id,
      outcome: 'approved',
    })
    expect(decide.statusCode).toBe(403)
    expect(
      (await run(manager, state.revision, { type: 'approval-limit', regionalLimitMinor: 1 }))
        .statusCode,
    ).toBe(403)
    const desk = await invite('desk@example.invalid', 'reception')
    const body = (await get(desk)).body
    expect(body).not.toContain('Window cleaner')
    expect(body).not.toContain('"requests"')
    const refused = await run(desk, (await studio(owner)).revision, {
      type: 'request-raise',
      input: { locationId: main, kind: 'other', title: 'Anything' },
    })
    expect(refused.statusCode).toBe(403)
  })
})
