// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApiHandler } from './app'
import type { ApiHandler, InjectResponse } from './app'
import type { BusinessState } from '../src/domain/model'
import type { Command } from '../src/domain/commands'
import type { ChangeEntry } from '../src/domain/changeRecord'
import type { PractitionerView } from '../src/domain/practitioner'
import type { AreaView } from '../src/domain/area'
import { report } from '../src/domain/selectors'
import { cashForDay } from '../src/domain/tillCount'
import { staffLocationOn } from '../src/domain/locations'
import { giftStanding } from '../src/domain/giftCards'

// Stage 4: moving a gift card or a team member to another location, through the server.
const origin = 'http://127.0.0.1:5173'
const password = 'Fictional local account 2026!'
type Login = { cookie: string; csrf: string; orgId: string }
let api: ApiHandler

beforeEach(() => {
  api = createApiHandler({
    origin,
    databasePath: ':memory:',
    now: () => Date.parse('2026-10-06T08:00:00.000Z'),
    turnstile: null,
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
              name: 'Reference Studio',
              locationName: 'London',
              region: 'UK',
              sample: true,
            },
          }),
    },
  })
  expect(response.statusCode, response.body).toBe(201)
  return { ...response.json<{ csrf: string; orgId: string }>(), cookie: cookie(response) }
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
async function member(owner: Login, email: string, name: string, role: string, extra = {}) {
  const invitation = await post(owner, '/invitations', { email, role, ...extra })
  expect(invitation.statusCode, invitation.body).toBe(201)
  const login = await register(email, name, invitation.json<{ invitation: string }>().invitation)
  return { ...login, orgId: owner.orgId }
}
const run = (login: Login, revision: number, command: Command, key: string = crypto.randomUUID()) =>
  post(login, '/commands', { revision, command }, { 'idempotency-key': key })
async function studio(login: Login) {
  const response = await get(login)
  expect(response.statusCode, response.body).toBe(200)
  return response.json<{ slug: string; state: BusinessState }>()
}
const ok = async (login: Login, command: Command) => {
  const { state } = await studio(login)
  const response = await run(login, state.revision, command)
  expect(response.statusCode, response.body).toBe(200)
  return (await studio(login)).state
}
const audits = (action: string) =>
  api.database.all<{ actor_name: string; detail: string }>(
    'SELECT * FROM audit_events WHERE action=?',
    action,
  )
/** The sample studio (its main location is London) with Shoreditch open and a room there. */
async function twoSites() {
  const owner = await register('owner@example.invalid', 'Ada Owner')
  let state = await ok(owner, {
    type: 'location',
    input: { name: 'Shoreditch', address: '1 Curtain Road' },
  } as Command)
  const shoreditch = state.operations!.locations![0].id
  state = await ok(owner, {
    type: 'resource',
    input: { name: 'Shoreditch room', type: 'treatment', locationId: shoreditch },
  } as Command)
  return { owner, main: state.organisation.locationId, shoreditch }
}
const moveCard = (giftCardId: string, locationId: string, reason = 'Hannah lives nearer') =>
  ({ type: 'gift-card-move', giftCardId, locationId, reason }) as Command
// The sample day is Tuesday 6 October 2026; the move starts on Monday 12 October.
const moveMaya = (to: string, keepBooked?: true) =>
  ({
    type: 'staff-move',
    input: { staffId: 'staff-maya', date: '2026-10-12', to, note: 'Leading the new team' },
    ...(keepBooked ? { keepBooked } : {}),
  }) as Command

describe('moving a gift card through the server', () => {
  it('lets an owner and a manager move a card, and says who did it', async () => {
    const { owner, main, shoreditch } = await twoSites()
    const manager = await member(owner, 'bea@example.invalid', 'Bea Manager', 'manager')
    let state = await ok(owner, moveCard('gift-1', shoreditch))
    let card = state.giftCards!.find((c) => c.id === 'gift-1')!
    expect(card.moves).toEqual([
      {
        id: expect.any(String),
        from: main,
        to: shoreditch,
        reason: 'Hannah lives nearer',
        at: '2026-10-06T08:00:00.000Z',
        actor: 'Ada Owner',
      },
    ])
    state = await ok(manager, moveCard('gift-1', main, 'Hannah moved back'))
    card = state.giftCards!.find((c) => c.id === 'gift-1')!
    expect(card.moves!.map((m) => [m.to, m.actor])).toEqual([
      [shoreditch, 'Ada Owner'],
      [main, 'Bea Manager'],
    ])
    expect(audits('gift-card-move')).toHaveLength(2)
    const changes = await get(owner, '/changes?group=money')
    expect(changes.statusCode, changes.body).toBe(200)
    const entries = changes.json<{ entries: ChangeEntry[] }>().entries
    expect(entries.slice(0, 2).map((e) => [e.who, e.what, e.about])).toEqual([
      ['Bea Manager', 'Moved a gift card to another location', '£75 gift card'],
      ['Ada Owner', 'Moved a gift card to another location', '£75 gift card'],
    ])
    expect(entries[1].lines).toEqual([{ what: 'location', from: 'London', to: 'Shoreditch' }])
    // The reason stays on the card; who changed what keeps no typed words.
    expect(changes.body).not.toContain('Hannah lives nearer')
  })

  it('refuses reception, practitioners and regional managers, and saves nothing', async () => {
    const { owner, main, shoreditch } = await twoSites()
    const desk = await member(owner, 'rae@example.invalid', 'Rae Desk', 'reception')
    const maya = await member(owner, 'maya@example.invalid', 'Maya Lewis', 'practitioner', {
      staffId: 'staff-maya',
    })
    const state = await ok(owner, {
      type: 'region',
      input: { name: 'London', locationIds: [main, shoreditch] },
    } as Command)
    const area = await member(owner, 'ari@example.invalid', 'Ari Area', 'regional', {
      areaId: state.operations!.regions![0].id,
    })
    for (const login of [desk, maya, area]) {
      const refused = await run(login, state.revision, moveCard('gift-1', shoreditch))
      expect(refused.statusCode, refused.body).toBe(403)
      expect(refused.json<{ error: string }>().error).toBe('Your role cannot make this change.')
    }
    const after = (await studio(owner)).state
    expect(after.revision).toBe(state.revision)
    expect(after.giftCards).toEqual(state.giftCards)
    expect(audits('gift-card-move')).toHaveLength(0)
  })

  it('lets a general manager pass on a card that belongs to their location, and no other', async () => {
    const { owner, main, shoreditch } = await twoSites()
    const gia = await member(owner, 'gia@example.invalid', 'Gia General', 'general', {
      locationId: main,
    })
    const sam = await member(owner, 'sam@example.invalid', 'Sam General', 'general', {
      locationId: shoreditch,
    })
    // Shoreditch's general manager cannot take London's card.
    let { state } = await studio(owner)
    const taken = await run(sam, state.revision, moveCard('gift-1', shoreditch))
    expect(taken.statusCode).toBe(403)
    expect(taken.json<{ error: string }>().error).toBe(
      'That gift card belongs to another location. Ask its general manager, the owner or a manager.',
    )
    // London's can pass it on, and then it is no longer theirs to move back.
    state = await ok(gia, moveCard('gift-1', shoreditch))
    expect(state.giftCards!.find((c) => c.id === 'gift-1')!.moves![0].actor).toBe('Gia General')
    const back = await run(gia, state.revision, moveCard('gift-1', main))
    expect(back.statusCode).toBe(403)
    state = await ok(sam, moveCard('gift-1', main, 'Hannah moved back'))
    expect(state.giftCards!.find((c) => c.id === 'gift-1')!.moves).toHaveLength(2)
  })

  it('checks the card on the server, whatever the screen sent', async () => {
    const { owner, main, shoreditch } = await twoSites()
    const { state } = await studio(owner)
    const refusal = async (command: unknown) => {
      const response = await run(owner, state.revision, command as Command)
      expect(response.statusCode, response.body).toBeGreaterThanOrEqual(400)
      return response.json<{ error: string }>().error
    }
    expect(await refusal(moveCard('gift-1', main))).toBe(
      'Gift card LAKE-7K4M-2QHN already belongs to London.',
    )
    expect(await refusal(moveCard('gift-1', 'nowhere'))).toBe('Choose an open location.')
    expect(await refusal(moveCard('gift-none', shoreditch))).toBe(
      'This gift card was not sold here.',
    )
    expect((await run(owner, state.revision, moveCard('gift-1', shoreditch, 'x'))).statusCode).toBe(
      400,
    )
    expect(
      (
        await run(owner, state.revision, {
          ...moveCard('gift-1', shoreditch),
          extra: 1,
        } as unknown as Command)
      ).statusCode,
    ).toBe(400)
    expect(audits('gift-card-move')).toHaveLength(0)
  })

  it('leaves every money total as it was', async () => {
    const { owner, main, shoreditch } = await twoSites()
    const { state: before } = await studio(owner)
    const after = await ok(owner, moveCard('gift-2', shoreditch, 'Marta works near Shoreditch'))
    for (const place of [main, shoreditch, undefined])
      expect(report(after, 30, place), place).toEqual(report(before, 30, place))
    for (const day of ['2026-09-01', '2026-10-06'])
      expect(cashForDay(after, day)).toEqual(cashForDay(before, day))
    expect(after.payments).toEqual(before.payments)
    expect(after.sales).toEqual(before.sales)
    const card = (s: BusinessState) => s.giftCards!.find((c) => c.id === 'gift-2')!
    expect(giftStanding(card(after), '2026-10-06')).toEqual(
      giftStanding(card(before), '2026-10-06'),
    )
    const { moves, ...rest } = card(after)
    expect(moves).toHaveLength(1)
    expect(rest).toEqual(card(before))
  })

  it('applies a repeated request once', async () => {
    const { owner, shoreditch } = await twoSites()
    const { state } = await studio(owner)
    const key = 'gift-move-repeat-0001'
    const first = await run(owner, state.revision, moveCard('gift-1', shoreditch), key)
    const again = await run(owner, state.revision, moveCard('gift-1', shoreditch), key)
    expect(first.statusCode, first.body).toBe(200)
    expect(again.statusCode, again.body).toBe(200)
    const after = (await studio(owner)).state
    expect(after.revision).toBe(state.revision + 1)
    expect(after.giftCards!.find((c) => c.id === 'gift-1')!.moves).toHaveLength(1)
    expect(audits('gift-card-move')).toHaveLength(1)
  })
})

describe('moving someone to another location through the server', () => {
  it('is for owners and managers only, and saves nothing for anyone else', async () => {
    const { owner, main, shoreditch } = await twoSites()
    const desk = await member(owner, 'rae@example.invalid', 'Rae Desk', 'reception')
    const maya = await member(owner, 'maya@example.invalid', 'Maya Lewis', 'practitioner', {
      staffId: 'staff-maya',
    })
    const gia = await member(owner, 'gia@example.invalid', 'Gia General', 'general', {
      locationId: main,
    })
    const state = await ok(owner, {
      type: 'region',
      input: { name: 'London', locationIds: [main, shoreditch] },
    } as Command)
    const area = await member(owner, 'ari@example.invalid', 'Ari Area', 'regional', {
      areaId: state.operations!.regions![0].id,
    })
    const commands: Command[] = [
      moveMaya(shoreditch, true),
      { type: 'staff-move-cancel', moveId: 'any' },
    ]
    for (const command of commands)
      for (const login of [desk, maya, gia, area]) {
        const refused = await run(login, state.revision, command)
        expect(refused.statusCode, `${command.type}: ${refused.body}`).toBe(403)
        expect(refused.json<{ error: string }>().error).toBe('Your role cannot make this change.')
      }
    const after = (await studio(owner)).state
    expect(after.revision).toBe(state.revision)
    expect(after.staff).toEqual(state.staff)
    expect(audits('staff-move')).toHaveLength(0)
  })

  it('asks before leaving booked visits behind, and never moves or messages them', async () => {
    const { owner, main, shoreditch } = await twoSites()
    // A visit with Maya in London on Tuesday 13 October, after the move.
    let state = await ok(owner, {
      type: 'book',
      input: {
        serviceId: 'service-facial',
        staffId: 'staff-maya',
        date: '2026-10-13',
        startMinutes: 600,
        clientId: 'client-1',
        source: 'desk',
      },
    } as Command)
    const booked = state.appointments.find(
      (a) => a.date === '2026-10-13' && a.staffId === 'staff-maya' && a.startMinutes === 600,
    )!
    expect(booked.locationId).toBe(main)
    const outbox = () => api.database.all('SELECT * FROM outbox')
    const queued = outbox().length
    const refused = await run(owner, state.revision, moveMaya(shoreditch))
    expect(refused.statusCode).toBe(422)
    const { error } = refused.json<{ error: string }>()
    expect(error).toMatch(
      /booked visits? with Maya would be at a location where they no longer work: /,
    )
    expect(error).toContain('Tue 13 Oct 10:00')
    expect(error).toMatch(
      /Move (it|them) first, or choose to keep (it|them) booked as (it is|they are)\.$/,
    )
    expect((await studio(owner)).state.revision).toBe(state.revision)
    const kept = await run(owner, state.revision, moveMaya(shoreditch, true))
    expect(kept.statusCode, kept.body).toBe(200)
    const after = (await studio(owner)).state
    expect(after.appointments).toEqual(state.appointments)
    expect(after.operations!.messages).toEqual(state.operations!.messages)
    expect(outbox()).toHaveLength(queued)
    const move = after.operations!.staffMoves![0]
    expect(move.kept).toContain(booked.id)
    expect(move.actor).toBe('Ada Owner')
    expect(JSON.parse(audits('staff-move')[0].detail).fields).toEqual(
      expect.arrayContaining([{ f: 'visitsKeptAway', to: move.kept!.length }]),
    )
    state = after
    // Cancelling it, likewise, never touches a visit.
    const cancel = await run(owner, state.revision, { type: 'staff-move-cancel', moveId: move.id })
    expect(cancel.statusCode, cancel.body).toBe(200)
    const back = (await studio(owner)).state
    expect(back.appointments).toEqual(state.appointments)
    expect(back.operations!.staffMoves![0].cancelled).toMatchObject({ actor: 'Ada Owner' })
    expect(staffLocationOn(back, 'staff-maya', '2026-10-13')).toBe(main)
  })

  it('gives the right answer before and after the date, everywhere it is asked', async () => {
    const { owner, main, shoreditch } = await twoSites()
    const maya = await member(owner, 'maya@example.invalid', 'Maya Lewis', 'practitioner', {
      staffId: 'staff-maya',
    })
    const { slug } = await studio(owner)
    let { state } = await studio(owner)
    // Any visits already booked with Maya from the move stay where they are.
    const response = await run(owner, state.revision, moveMaya(shoreditch, true))
    expect(response.statusCode, response.body).toBe(200)
    state = (await studio(owner)).state
    expect(
      ['2026-10-09', '2026-10-12', '2026-10-15'].map((d) =>
        staffLocationOn(state, 'staff-maya', d),
      ),
    ).toEqual([main, shoreditch, shoreditch])
    // The guest booking page: Thursday this week in London, Thursday next week in Shoreditch.
    const times = async (date: string, locationId: string) => {
      const answer = await api.inject({
        url: `/api/public/${slug}/availability?serviceId=service-facial&staffId=staff-maya&date=${date}&locationId=${locationId}`,
      })
      expect(answer.statusCode, answer.body).toBe(200)
      return answer.json<{ times: number[] }>().times
    }
    expect((await times('2026-10-08', main)).length).toBeGreaterThan(0)
    expect(await times('2026-10-08', shoreditch)).toEqual([])
    expect(await times('2026-10-15', main)).toEqual([])
    expect((await times('2026-10-15', shoreditch)).length).toBeGreaterThan(0)
    const page = await api.inject({ url: `/api/public/${slug}` })
    expect(page.statusCode, page.body).toBe(200)
    const person = page
      .json<{ staff: { id: string; locationIds: string[] }[] }>()
      .staff.find((p) => p.id === 'staff-maya')!
    expect(person.locationIds).toEqual([main, shoreditch])
    // Maya's own view shows each day where it is, and nothing else of the move.
    const own = await get(maya)
    expect(own.statusCode, own.body).toBe(200)
    const plan = own.json<{ practitioner: PractitionerView }>().practitioner.plan!
    const place = new Map(plan.map((d) => [d.date, d.place]))
    expect([place.get('2026-10-08'), place.get('2026-10-13')]).toEqual(['London', 'Shoreditch'])
    expect(own.body).not.toContain('staffMoves')
    expect(own.body).not.toContain('Leading the new team')
  })

  it('gives a regional manager nothing of the move itself', async () => {
    const { owner, main, shoreditch } = await twoSites()
    const state = await ok(owner, {
      type: 'region',
      input: { name: 'London', locationIds: [main, shoreditch] },
    } as Command)
    const area = await member(owner, 'ari@example.invalid', 'Ari Area', 'regional', {
      areaId: state.operations!.regions![0].id,
    })
    await ok(owner, moveMaya(shoreditch, true))
    const response = await get(area)
    expect(response.statusCode, response.body).toBe(200)
    expect(response.json<{ area: AreaView }>().area).toBeDefined()
    expect(response.body).not.toContain('staffMoves')
    expect(response.body).not.toContain('Leading the new team')
  })

  it('records who moved whom in who changed what', async () => {
    const { owner, shoreditch } = await twoSites()
    await ok(owner, moveMaya(shoreditch, true))
    const changes = await get(owner, '/changes?group=team')
    expect(changes.statusCode, changes.body).toBe(200)
    const [entry] = changes.json<{ entries: ChangeEntry[] }>().entries
    expect([entry.who, entry.what, entry.about]).toEqual([
      'Ada Owner',
      'Moved someone to another location',
      'Maya Lewis',
    ])
    expect(entry.lines).toEqual(
      expect.arrayContaining([
        { what: 'date', to: '12 October 2026' },
        { what: 'location', from: 'London', to: 'Shoreditch' },
      ]),
    )
    expect(changes.body).not.toContain('Leading the new team')
  })

  it('applies a repeated request once', async () => {
    const { owner, shoreditch } = await twoSites()
    const { state } = await studio(owner)
    const key = 'staff-move-repeat-0001'
    const first = await run(owner, state.revision, moveMaya(shoreditch, true), key)
    const again = await run(owner, state.revision, moveMaya(shoreditch, true), key)
    expect(first.statusCode, first.body).toBe(200)
    expect(again.statusCode, again.body).toBe(200)
    const after = (await studio(owner)).state
    expect(after.revision).toBe(state.revision + 1)
    expect(after.operations!.staffMoves).toHaveLength(1)
    expect(audits('staff-move')).toHaveLength(1)
    // A new request for the same move is refused, so a double tap never moves anyone twice.
    const twice = await run(owner, after.revision, moveMaya(shoreditch, true))
    expect(twice.statusCode).toBe(422)
    expect(twice.json<{ error: string }>().error).toMatch(/^Maya already moves to Shoreditch/)
  })
})
