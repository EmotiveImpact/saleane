// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApiHandler } from './app'
import type { ApiHandler, InjectResponse } from './app'
import type { BusinessState } from '../src/domain/model'
import type { Command } from '../src/domain/commands'
import type { ChangeEntry } from '../src/domain/changeRecord'
import type { PractitionerView } from '../src/domain/practitioner'
import type { AreaView } from '../src/domain/area'

// Stage 3: one day on the rota changed through the server command route, by the right people only.
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
async function studio(owner: Login) {
  const response = await get(owner)
  expect(response.statusCode, response.body).toBe(200)
  return response.json<{ slug: string; state: BusinessState }>()
}
const audits = (action: string) =>
  api.database.all<{ actor_name: string; detail: string }>(
    'SELECT * FROM audit_events WHERE action=?',
    action,
  )
// The sample day is Tuesday 6 October 2026. Maya has visits booked that day.
const thursday = '2026-10-08'
const shorterThursday: Command = {
  type: 'rota-day',
  input: { staffId: 'staff-maya', date: thursday, working: true, open: 540, close: 900 },
}
const mayaToday = (close: number, keepBooked?: true): Command => ({
  type: 'rota-day',
  input: { staffId: 'staff-maya', date: '2026-10-06', working: true, open: 540, close },
  ...(keepBooked ? { keepBooked } : {}),
})

describe('changing a day on the rota through the server', () => {
  it('lets an owner and a manager change a day, and says who did it in plain words', async () => {
    const owner = await register('owner@example.invalid', 'Ada Owner')
    const manager = await member(owner, 'bea@example.invalid', 'Bea Manager', 'manager')
    const before = (await studio(owner)).state
    const saved = await run(owner, before.revision, shorterThursday)
    expect(saved.statusCode, saved.body).toBe(200)
    let state = (await studio(owner)).state
    const change = state.operations!.rotaChanges!.find((c) => c.date === thursday)!
    expect(change).toMatchObject({ actor: 'Ada Owner', open: 540, close: 900 })
    // Maya's usual hours are exactly as they were.
    expect(state.staff.find((p) => p.id === 'staff-maya')).toEqual(
      before.staff.find((p) => p.id === 'staff-maya'),
    )
    const back = await run(manager, state.revision, {
      type: 'rota-day-usual',
      staffId: 'staff-maya',
      date: thursday,
    })
    expect(back.statusCode, back.body).toBe(200)
    state = (await studio(owner)).state
    expect(state.operations!.rotaChanges!.find((c) => c.id === change.id)!.ended).toMatchObject({
      actor: 'Bea Manager',
      how: 'usual',
    })
    expect(audits('rota-day')).toHaveLength(1)
    expect(audits('rota-day-usual')).toHaveLength(1)
    const changes = await get(owner, '/changes?group=team')
    expect(changes.statusCode, changes.body).toBe(200)
    const entries = changes.json<{ entries: ChangeEntry[] }>().entries
    expect(entries.slice(0, 2).map((e) => [e.who, e.what, e.about])).toEqual([
      ['Bea Manager', 'Put a day on the rota back to usual hours', 'Maya Lewis'],
      ['Ada Owner', 'Changed a day on the rota', 'Maya Lewis'],
    ])
    expect(entries[1].lines).toEqual([
      { what: 'date', to: '8 October 2026' },
      { what: 'hours that day', from: 'their usual hours', to: '09:00 to 15:00' },
    ])
    expect(entries[0].lines).toEqual([
      { what: 'date', to: '8 October 2026' },
      { what: 'hours that day', from: '09:00 to 15:00', to: 'their usual hours' },
    ])
  })

  it('refuses everyone else, and saves nothing', async () => {
    const owner = await register('owner@example.invalid', 'Ada Owner')
    const desk = await member(owner, 'rae@example.invalid', 'Rae Desk', 'reception')
    const maya = await member(owner, 'maya@example.invalid', 'Maya Lewis', 'practitioner', {
      staffId: 'staff-maya',
    })
    const { state } = await studio(owner)
    const gia = await member(owner, 'gia@example.invalid', 'Gia General', 'general', {
      locationId: state.organisation.locationId,
    })
    const stranger = await register('other@example.invalid', 'Other Owner')
    const commands: Command[] = [
      shorterThursday,
      { type: 'rota-day-usual', staffId: 'staff-maya', date: '2026-10-09' },
      { type: 'rota-week-copy', monday: '2026-10-12' },
      { type: 'rota-week-clear', monday: '2026-10-05' },
    ]
    for (const command of commands)
      for (const login of [desk, maya, gia]) {
        const refused = await run(login, state.revision, command)
        expect(refused.statusCode, `${command.type}: ${refused.body}`).toBe(403)
        expect(refused.json<{ error: string }>().error).toBe('Your role cannot make this change.')
      }
    expect((await run({ ...stranger, orgId: owner.orgId }, 0, shorterThursday)).statusCode).toBe(
      404,
    )
    const after = (await studio(owner)).state
    expect(after.revision).toBe(state.revision)
    expect(after.operations!.rotaChanges).toEqual(state.operations!.rotaChanges)
    expect(audits('rota-day')).toHaveLength(0)
  })

  it('checks the rules on the server, whatever the screen sent', async () => {
    const owner = await register('owner@example.invalid', 'Ada Owner')
    const { state } = await studio(owner)
    const refusal = async (command: unknown) => {
      const response = await run(owner, state.revision, command as Command)
      expect(response.statusCode, response.body).toBeGreaterThanOrEqual(400)
      return response.json<{ error: string }>().error
    }
    expect(
      await refusal({ ...shorterThursday, input: { ...shorterThursday.input, close: 480 } }),
    ).toBe('Choose a finish time after the start.')
    expect(
      await refusal({
        ...shorterThursday,
        input: { ...shorterThursday.input, date: '2026-10-05' },
      }),
    ).toBe('That day has passed. The rota keeps what was planned for it.')
    expect(
      await refusal({ ...shorterThursday, input: { ...shorterThursday.input, locationId: 'x' } }),
    ).toBe('Choose an open location.')
    expect(
      (await run(owner, state.revision, { ...shorterThursday, extra: true } as Command)).statusCode,
    ).toBe(400)
    expect(audits('rota-day')).toHaveLength(0)
  })

  it('asks before leaving booked visits outside the hours, and never moves or messages them', async () => {
    const owner = await register('owner@example.invalid', 'Ada Owner')
    const { state } = await studio(owner)
    const refused = await run(owner, state.revision, mayaToday(720))
    expect(refused.statusCode).toBe(422)
    const { error } = refused.json<{ error: string }>()
    expect(error).toMatch(/^\d+ booked visits would be outside the new hours: Tue 6 Oct /)
    expect(error).toMatch(/Move them first, or choose to keep them booked as they are\.$/)
    expect((await studio(owner)).state.revision).toBe(state.revision)
    const outbox = () => api.database.all('SELECT * FROM outbox')
    const queued = outbox().length
    const kept = await run(owner, state.revision, mayaToday(720, true))
    expect(kept.statusCode, kept.body).toBe(200)
    const after = (await studio(owner)).state
    expect(after.appointments).toEqual(state.appointments)
    expect(after.operations!.messages).toEqual(state.operations!.messages)
    expect(outbox()).toHaveLength(queued)
    const change = after.operations!.rotaChanges!.find((c) => c.date === '2026-10-06')!
    expect(change.kept!.length).toBeGreaterThan(0)
    expect(JSON.parse(audits('rota-day')[0].detail).fields).toEqual(
      expect.arrayContaining([{ f: 'visitsKept', to: change.kept!.length }]),
    )
  })

  it('applies a repeated request once', async () => {
    const owner = await register('owner@example.invalid', 'Ada Owner')
    const { state } = await studio(owner)
    const key = 'rota-repeat-0001'
    const first = await run(owner, state.revision, shorterThursday, key)
    const again = await run(owner, state.revision, shorterThursday, key)
    expect(first.statusCode, first.body).toBe(200)
    expect(again.statusCode, again.body).toBe(200)
    const after = (await studio(owner)).state
    expect(after.revision).toBe(state.revision + 1)
    expect(after.operations!.rotaChanges!.filter((c) => c.date === thursday)).toHaveLength(1)
    expect(audits('rota-day')).toHaveLength(1)
  })
})

describe('who sees the changed days', () => {
  it('shows a practitioner their own changed days and nobody else’s', async () => {
    const owner = await register('owner@example.invalid', 'Ada Owner')
    const maya = await member(owner, 'maya@example.invalid', 'Maya Lewis', 'practitioner', {
      staffId: 'staff-maya',
    })
    const sophia = await member(owner, 'sophia@example.invalid', 'Sophia Reed', 'practitioner', {
      staffId: 'staff-sophia',
    })
    const view = async (login: Login) => {
      const response = await get(login)
      expect(response.statusCode, response.body).toBe(200)
      return response
    }
    const mine = (await view(maya)).json<{ practitioner: PractitionerView }>().practitioner
    expect(mine.plan!.filter((d) => d.change)).toEqual([
      { date: '2026-10-09', working: true, open: 540, close: 900, change: 'hours' },
      { date: '2026-10-10', working: true, open: 600, close: 960, change: 'extra' },
    ])
    const theirs = await view(sophia)
    const plan = theirs.json<{ practitioner: PractitionerView }>().practitioner.plan!
    expect(plan.some((d) => d.change)).toBe(false)
    // No studio record, nobody else's changes and no notes in either.
    for (const response of [await view(maya), theirs]) {
      expect(response.body).not.toContain('rotaChanges')
      expect(response.body).not.toContain('Training from three')
      expect(response.body).not.toContain('Covering Saturday')
    }
  })

  it('gives a regional manager nothing of the rota', async () => {
    const owner = await register('owner@example.invalid', 'Ada Owner')
    let { state } = await studio(owner)
    const saved = await run(owner, state.revision, {
      type: 'region',
      input: { name: 'London', locationIds: [state.organisation.locationId] },
    })
    expect(saved.statusCode, saved.body).toBe(200)
    state = (await studio(owner)).state
    const rae = await member(owner, 'rae@example.invalid', 'Rae Area', 'regional', {
      areaId: state.operations!.regions![0].id,
    })
    const response = await get(rae)
    expect(response.statusCode, response.body).toBe(200)
    expect(response.json<{ area: AreaView }>().area).toBeDefined()
    expect(response.body).not.toContain('rotaChanges')
    expect(response.body).not.toContain('Covering Saturday')
    const refused = await run(rae, state.revision, shorterThursday)
    expect(refused.statusCode).toBe(403)
  })

  it('offers guests times on the extra day and within the changed hours only', async () => {
    const owner = await register('owner@example.invalid', 'Ada Owner')
    const { slug } = await studio(owner)
    const times = async (date: string) => {
      const response = await api.inject({
        url: `/api/public/${slug}/availability?serviceId=service-facial&staffId=staff-maya&date=${date}`,
      })
      expect(response.statusCode, response.body).toBe(200)
      return response.json<{ times: number[] }>().times
    }
    // Saturday is Maya's extra day in the sample week, from 10:00 to 16:00.
    const saturday = await times('2026-10-10')
    expect(saturday[0]).toBe(600)
    expect(Math.max(...saturday) + 75).toBeLessThanOrEqual(960)
    // Friday finishes at 15:00 instead of 18:00.
    const friday = await times('2026-10-09')
    expect(Math.max(...friday) + 75).toBeLessThanOrEqual(900)
    // The Saturday after is not changed, so Maya is not offered.
    expect(await times('2026-10-17')).toEqual([])
  })
})
