// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApiHandler } from './app'
import type { ApiHandler, InjectResponse } from './app'
import type { BusinessState } from '../src/domain/model'
import type { Command } from '../src/domain/commands'
import type { ChangeEntry } from '../src/domain/changeRecord'

// Stage 4: a general manager changes their own team's days on the rota, their time off and the
// rooms and chairs at their location, through the server, and nothing at another location.
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
const run = (login: Login, revision: number, command: Command) =>
  post(login, '/commands', { revision, command }, { 'idempotency-key': crypto.randomUUID() })
async function studio(login: Login) {
  const response = await get(login)
  expect(response.statusCode, response.body).toBe(200)
  return response.json<{ state: BusinessState }>().state
}
const ok = async (login: Login, command: Command) => {
  const response = await run(login, (await studio(login)).revision, command)
  expect(response.statusCode, response.body).toBe(200)
  return response.json<{ state: BusinessState }>().state
}
const refused = async (login: Login, command: Command) => {
  const response = await run(login, (await studio(login)).revision, command)
  expect(response.statusCode, `${command.type}: ${response.body}`).toBe(403)
  return response.json<{ error: string }>().error
}

/**
 * The sample studio with Islington open and a room there. Nia works at Islington Monday to
 * Wednesday and at the main location Thursday to Saturday; Gia runs Islington.
 */
async function twoSites() {
  const owner = await register('owner@example.invalid', 'Ada Owner')
  await ok(owner, { type: 'location', input: { name: 'Islington', address: '1 Upper Street' } })
  let state = await studio(owner)
  const islington = state.operations!.locations![0].id
  const main = state.organisation.locationId
  await ok(owner, {
    type: 'resource',
    input: { name: 'Islington room', type: 'treatment', locationId: islington },
  } as Command)
  state = await ok(owner, {
    type: 'staff',
    input: {
      name: 'Nia Fictional',
      role: 'Facialist',
      serviceIds: ['service-facial'],
      tone: 'sage',
      hours: state.operations!.hours.map((h) =>
        h.day >= 1 && h.day <= 3 ? { ...h, locationId: islington } : { ...h },
      ),
    },
  } as Command)
  const nia = state.staff.find((p) => p.name === 'Nia Fictional')!.id
  const room = state.resources.find((r) => r.name === 'Islington room')!.id
  const invitation = await post(owner, '/invitations', {
    email: 'gia@example.invalid',
    role: 'general',
    locationId: islington,
  })
  expect(invitation.statusCode, invitation.body).toBe(201)
  const gia = {
    ...(await register(
      'gia@example.invalid',
      'Gia General',
      invitation.json<{ invitation: string }>().invitation,
    )),
    orgId: owner.orgId,
  }
  return { owner, gia, islington, main, nia, room }
}
const day = (staffId: string, date: string, extra: Record<string, unknown>) =>
  ({ type: 'rota-day', input: { staffId, date, ...extra } }) as Command
const away = (staffId: string, from: string, to: string) =>
  ({ type: 'time-off', input: { staffId, from, to, kind: 'holiday' } }) as Command

describe('a general manager and their own team (Stage 4)', () => {
  it('reads their own team, hours, time off and rooms, and nothing of another location', async () => {
    const { owner, gia, islington, nia, room } = await twoSites()
    const whole = await studio(owner)
    const view = await studio(gia)
    for (const id of ['staff-maya', 'staff-sophia', 'staff-theo']) {
      const person = view.staff.find((p) => p.id === id)!
      expect(person.archived).toBe(true)
      expect(person.hours!.every((h) => h.closed)).toBe(true)
      expect(person.serviceIds).toEqual([])
    }
    expect(view.staff.find((p) => p.id === nia)!.archived).toBeUndefined()
    expect(view.resources.filter((r) => !r.archived).map((r) => r.id)).toEqual([room])
    expect(view.operations!.timeOff).toEqual([])
    expect(view.operations!.leaveAllowances).toEqual([])
    expect(view.operations!.rotaChanges).toEqual([])
    expect(
      (view.operations!.scheduleHistory ?? []).every(
        (e) => e.kind === 'hours' || e.subjectId === room,
      ),
    ).toBe(true)
    // The whole studio still has them all.
    expect(whole.operations!.timeOff!.length).toBeGreaterThan(0)
    expect(whole.operations!.rotaChanges!.length).toBeGreaterThan(0)
    // Nia's main location days carry the place only.
    const hours = view.staff.find((p) => p.id === nia)!.hours!
    for (const h of hours.filter((x) => x.locationId !== islington))
      expect([h.open, h.close]).toEqual([0, 1440])
    expect(JSON.stringify(view)).not.toContain('Training from three')
    expect(JSON.stringify(view)).not.toContain('Family wedding')
  })

  it('changes a day for their team at their location, and nothing elsewhere', async () => {
    const { owner, gia, islington, main, nia } = await twoSites()
    // Tuesday 13 October is an Islington day for Nia.
    const after = await ok(
      gia,
      day(nia, '2026-10-13', { working: true, open: 600, close: 900, locationId: islington }),
    )
    const change = after.operations!.rotaChanges!.find((c) => c.staffId === nia)!
    expect(change.actor).toBe('Gia General')
    const before = await studio(owner)
    expect(
      await refused(
        gia,
        day(nia, '2026-10-13', { working: true, open: 600, close: 900, locationId: main }),
      ),
    ).toBe(
      'You plan days at Islington only. Ask the owner or a manager to send Nia to another location.',
    )
    // Thursday is Nia's day at the main location, and Maya is not on Islington's team.
    expect(await refused(gia, day(nia, '2026-10-15', { working: false }))).toBe(
      'Nia works at another location that day, so only the owner or a manager can change it.',
    )
    expect(
      await refused(
        gia,
        day('staff-maya', '2026-10-13', {
          working: true,
          open: 600,
          close: 900,
          locationId: islington,
        }),
      ),
    ).toBe('Maya is not on the team at Islington. Ask the owner or a manager to change their day.')
    expect(
      await refused(gia, { type: 'rota-day-usual', staffId: 'staff-maya', date: '2026-10-09' }),
    ).toMatch(/^Maya is not on the team at Islington/)
    // Nothing was saved by any refusal.
    expect((await studio(owner)).revision).toBe(before.revision)
    // Back to usual on their own day.
    await ok(gia, { type: 'rota-day-usual', staffId: nia, date: '2026-10-13' })
    const entries = (await get(owner, '/changes?group=team')).json<{ entries: ChangeEntry[] }>()
      .entries
    expect(entries.slice(0, 2).map((e) => [e.who, e.about])).toEqual([
      ['Gia General', 'Nia Fictional'],
      ['Gia General', 'Nia Fictional'],
    ])
  })

  it('copies and clears a week at their location only', async () => {
    const { owner, gia, islington, main, nia } = await twoSites()
    await ok(
      gia,
      day(nia, '2026-10-07', { working: true, open: 600, close: 900, locationId: islington }),
    )
    await ok(owner, day('staff-sophia', '2026-10-07', { working: true, open: 600, close: 900 }))
    const copy = { type: 'rota-week-copy', monday: '2026-10-12' } as Command
    const ownOnly = 'Copy and clear weeks at your own location only.'
    expect(await refused(gia, copy)).toBe(ownOnly)
    expect(await refused(gia, { ...copy, locationId: main } as Command)).toBe(ownOnly)
    const copied = await ok(gia, { ...copy, locationId: islington } as Command)
    const next = (s: BusinessState) =>
      s.operations!.rotaChanges!.filter((c) => !c.ended && c.date >= '2026-10-12')
    expect(next(copied).map((c) => [c.staffId, c.date])).toEqual([[nia, '2026-10-14']])
    // The owner copies the rest; the general manager then clears only their own.
    await ok(owner, copy)
    const cleared = await ok(gia, {
      type: 'rota-week-clear',
      monday: '2026-10-12',
      locationId: islington,
    } as Command)
    expect(next(cleared)).toEqual([])
    expect(
      next(await studio(owner))
        .map((c) => c.staffId)
        .sort(),
    ).toEqual(['staff-maya', 'staff-maya', 'staff-sophia'].sort())
  })

  it('adds, changes and cancels their team’s time off, and only on their location’s days', async () => {
    const { owner, gia, nia } = await twoSites()
    let state = await ok(gia, away(nia, '2026-10-12', '2026-10-14'))
    const first = state.operations!.timeOff!.find((t) => t.staffId === nia)!
    expect(first.actor).toBe('Gia General')
    expect(await refused(gia, away(nia, '2026-10-12', '2026-10-15'))).toBe(
      'Nia works at another location on Thursday 15 October. Time off that covers a day at another location is for the owner or a manager.',
    )
    expect(await refused(gia, away('staff-maya', '2026-10-12', '2026-10-12'))).toMatch(
      /^Maya is not on the team at Islington/,
    )
    state = await ok(gia, {
      type: 'time-off-change',
      timeOffId: first.id,
      input: { from: '2026-10-12', to: '2026-10-13', kind: 'holiday' },
    })
    const old = state.operations!.timeOff!.find((t) => t.id === first.id)!
    const now = state.operations!.timeOff!.find((t) => t.changedFrom === first.id)!
    expect(old).toMatchObject({ cancelledBy: 'Gia General', changedTo: now.id })
    expect(now).toMatchObject({ actor: 'Gia General', from: '2026-10-12', to: '2026-10-13' })
    // Time off for someone at the main location is not theirs to change or cancel.
    const whole = await studio(owner)
    const sophia = whole.operations!.timeOff!.find(
      (t) => t.staffId === 'staff-sophia' && !t.cancelledAt,
    )!
    expect(await refused(gia, { type: 'cancel-time-off', timeOffId: sophia.id })).toMatch(
      /^Sophia is not on the team at Islington/,
    )
    expect(
      await refused(gia, {
        type: 'time-off-change',
        timeOffId: sophia.id,
        input: { from: sophia.from, to: sophia.to, kind: 'other' },
      }),
    ).toMatch(/^Sophia is not on the team at Islington/)
    await ok(gia, { type: 'cancel-time-off', timeOffId: now.id })
    const entries = (await get(owner, '/changes?group=team')).json<{ entries: ChangeEntry[] }>()
      .entries
    expect(entries.slice(0, 3).map((e) => [e.who, e.what])).toEqual([
      ['Gia General', 'Cancelled time off'],
      ['Gia General', 'Changed time off'],
      ['Gia General', 'Booked time off'],
    ])
    expect(entries[1].lines).toEqual([
      { what: 'last day', from: '14 October 2026', to: '13 October 2026' },
    ])
  })

  it('looks after rooms and chairs at their location only', async () => {
    const { gia, islington, main, room } = await twoSites()
    const added = await ok(gia, {
      type: 'resource',
      input: { name: 'Islington chair', type: 'chair', locationId: islington },
    } as Command)
    expect(added.resources.find((r) => r.name === 'Islington chair')!.locationId).toBe(islington)
    await ok(gia, {
      type: 'resource',
      id: room,
      input: { name: 'The quiet room', type: 'treatment', locationId: islington, archived: true },
    } as Command)
    expect(
      await refused(gia, {
        type: 'resource',
        input: { name: 'Main room', type: 'treatment', locationId: main },
      } as Command),
    ).toBe('Add rooms and chairs at Islington only.')
    expect(
      await refused(gia, {
        type: 'resource',
        id: room,
        input: { name: 'The quiet room', type: 'treatment' },
      } as Command),
    ).toBe('Rooms and chairs stay at their location. Ask the owner or a manager to move one.')
    expect(
      await refused(gia, {
        type: 'resource',
        id: 'room-one',
        input: { name: 'Renamed', type: 'treatment', locationId: islington },
      } as Command),
    ).toBe('That room or chair is at another location.')
  })

  it('still leaves usual weekly hours, opening hours, closures and allowances to the owner', async () => {
    const { gia, nia } = await twoSites()
    const view = await studio(gia)
    const commands: Command[] = [
      { type: 'hours', hours: view.operations!.hours },
      {
        type: 'closure',
        input: { date: '2026-10-20', startMinutes: 540, endMinutes: 1080, reason: 'Training' },
      },
      { type: 'leave-allowance', staffId: nia, days: 20 },
      {
        type: 'staff',
        id: nia,
        input: { name: 'Nia Fictional', role: 'Facialist', serviceIds: [], tone: 'sage' },
      } as Command,
    ]
    for (const command of commands)
      expect(await refused(gia, command)).toBe('Your role cannot make this change.')
  })
})
