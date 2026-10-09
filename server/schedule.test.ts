// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApiHandler } from './app'
import type { ApiHandler, InjectResponse } from './app'
import type { BusinessState } from '../src/domain/model'
import type { Command } from '../src/domain/commands'
import { defaultOperations } from '../src/domain/operations'

// LOCAL-04 acceptance: schedule edits through the server command route keep visits and history.
const origin = 'http://127.0.0.1:5173'
const password = 'Fictional local account 2026!'
type Login = { cookie: string; csrf: string; orgId: string }
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
async function member(owner: Login, email: string, name: string, role: string, staffId?: string) {
  const invitation = await api.inject({
    method: 'POST',
    url: `/api/workspaces/${owner.orgId}/invitations`,
    headers: headers(owner),
    payload: { email, role, ...(staffId ? { staffId } : {}) },
  })
  expect(invitation.statusCode, invitation.body).toBe(201)
  const login = await register(email, name, invitation.json<{ invitation: string }>().invitation)
  return { ...login, orgId: owner.orgId }
}
const run = (login: Login, revision: number, command: Command) =>
  api.inject({
    method: 'POST',
    url: `/api/workspaces/${login.orgId}/commands`,
    headers: { ...headers(login), 'idempotency-key': crypto.randomUUID() },
    payload: { revision, command },
  })
async function studio(login: Login) {
  const response = await api.inject({
    url: `/api/workspaces/${login.orgId}`,
    headers: headers(login),
  })
  expect(response.statusCode, response.body).toBe(200)
  return response.json<{ state: BusinessState }>().state
}
// The sample studio opens Monday to Saturday, 09:00 to 18:00.
const hours = (patch: (day: number) => object) =>
  defaultOperations().hours.map((h) => ({ ...h, closed: h.day === 0, ...patch(h.day) }))
// The sample day is Tuesday 6 October 2026, which already has booked visits.
const closeTuesday: Command = {
  type: 'hours',
  hours: hours((d) => (d === 2 ? { closed: true } : {})),
}
const shortenFriday: Command = {
  type: 'hours',
  hours: hours((d) => (d === 5 ? { close: 1020 } : {})),
}
const audits = (action: string) =>
  api.database.all('SELECT * FROM audit_events WHERE action=?', action)

describe('schedule administration continuity (LOCAL-04)', () => {
  it('refuses a change that strands visits, names them and records nothing', async () => {
    const owner = await register('owner@example.invalid', 'Ada Owner')
    const before = await studio(owner)
    const refused = await run(owner, 0, closeTuesday)
    expect(refused.statusCode).toBe(422)
    const { error } = refused.json<{ error: string }>()
    // Amelia has arrived; the rest of that day and later Tuesdays are confirmed.
    expect(error).toMatch(/^This change would affect \d+ upcoming visits: /)
    expect(error).toContain(
      'Tue 6 Oct 09:30, Amelia with Maya Lewis (The venue would be closed that day)',
    )
    expect(error).toMatch(/; and \d+ more\. Move or cancel them first, then save again\.$/)
    const after = await studio(owner)
    expect(after).toEqual(before)
    expect(after.operations?.scheduleHistory).toBeUndefined()
    expect(audits('hours')).toHaveLength(0)
    expect(api.database.all('SELECT * FROM command_receipts')).toHaveLength(0)
  })

  it('records the signed-in actor for an accepted change and audits it once', async () => {
    const owner = await register('owner@example.invalid', 'Ada Owner')
    const accepted = await run(owner, 0, shortenFriday)
    expect(accepted.statusCode, accepted.body).toBe(200)
    const state = await studio(owner)
    expect(state.operations?.scheduleHistory).toEqual([
      expect.objectContaining({
        kind: 'hours',
        actor: 'Ada Owner',
        occurredAt: '2026-10-06T08:00:00.000Z',
        summary: 'Opening hours changed: Friday 09:00 to 18:00 became 09:00 to 17:00.',
      }),
    ])
    expect(audits('hours')).toHaveLength(1)
  })

  it('returns 409 to the second of two edits made from the same revision', async () => {
    const owner = await register('owner@example.invalid', 'Ada Owner')
    const manager = await member(owner, 'bea@example.invalid', 'Bea Manager', 'manager')
    const first = await run(owner, 0, shortenFriday)
    expect(first.statusCode, first.body).toBe(200)
    const stale = await run(manager, 0, {
      type: 'closure',
      input: { date: '2026-10-09', startMinutes: 540, endMinutes: 600, reason: 'Late start' },
    })
    expect(stale.statusCode).toBe(409)
    expect(stale.json<{ error: string }>().error).toBe(
      'This workspace changed. Reload before saving.',
    )
    // Racing edits on one revision: exactly one lands and leaves one history entry.
    const racing = await Promise.all([
      run(owner, 1, { type: 'hours', hours: hours((d) => (d === 4 ? { close: 1020 } : {})) }),
      run(manager, 1, { type: 'hours', hours: hours((d) => (d === 1 ? { open: 600 } : {})) }),
    ])
    expect(racing.map((r) => r.statusCode).sort()).toEqual([200, 409])
    const state = await studio(owner)
    expect(state.revision).toBe(2)
    expect(state.operations?.scheduleHistory).toHaveLength(2)
    expect(state.operations?.scheduleHistory?.[0].actor).toBe('Ada Owner')
  })

  it('keeps schedule edits with owners and managers, inside their own studio', async () => {
    const owner = await register('owner@example.invalid', 'Ada Owner')
    const reception = await member(owner, 'rae@example.invalid', 'Rae Desk', 'reception')
    const maya = await member(
      owner,
      'maya@example.invalid',
      'Maya Lewis',
      'practitioner',
      'staff-maya',
    )
    const stranger = await register('other@example.invalid', 'Other Owner')
    expect((await run(reception, 0, shortenFriday)).statusCode).toBe(403)
    expect((await run(maya, 0, shortenFriday)).statusCode).toBe(403)
    expect((await run({ ...stranger, orgId: owner.orgId }, 0, shortenFriday)).statusCode).toBe(404)
    expect((await studio(owner)).operations?.scheduleHistory).toBeUndefined()
    expect((await run(owner, 0, shortenFriday)).statusCode).toBe(200)
    // The practitioner's own record never carries the studio's schedule history.
    const view = await api.inject({
      url: `/api/workspaces/${owner.orgId}`,
      headers: headers(maya),
    })
    expect(view.statusCode).toBe(200)
    expect(view.body).not.toContain('scheduleHistory')
    expect(view.body).not.toContain('Opening hours changed')
  })
})
