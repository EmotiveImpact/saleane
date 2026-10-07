// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApiHandler } from './app'
import type { ApiHandler, InjectResponse } from './app'
import type { BusinessState } from '../src/domain/model'
import type { Command } from '../src/domain/commands'

// V3 specials: owners and managers plan them; reception and practitioners cannot. Planning only
// records the special, so the services and prices are untouched.
const origin = 'http://127.0.0.1:5173'
const password = 'Fictional local account 2026!'
type Login = { cookie: string; csrf: string; orgId: string }
let api: ApiHandler

beforeEach(() => {
  api = createApiHandler({
    origin,
    databasePath: ':memory:',
    now: () => Date.parse('2026-10-06T17:40:00.000Z'),
  })
})
afterEach(() => api.close())

const headers = (login: Login) => ({ cookie: login.cookie, 'x-csrf-token': login.csrf })
const cookie = (response: InjectResponse) => String(response.headers['set-cookie']).split(';')[0]
async function register(email: string, invitation?: string) {
  const response = await api.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: {
      name: 'Studio Person',
      email,
      password,
      ...(invitation
        ? { invitation }
        : {
            workspace: {
              name: 'Specials Studio',
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
const get = (login: Login) =>
  api.inject({ url: `/api/workspaces/${login.orgId}`, headers: headers(login) })
const post = (login: Login, path: string, payload: unknown, extra: Record<string, string> = {}) =>
  api.inject({
    method: 'POST',
    url: `/api/workspaces/${login.orgId}${path}`,
    headers: { ...headers(login), ...extra },
    payload,
  })
async function studio(owner: Login) {
  return (await get(owner)).json<{ state: BusinessState }>().state
}
async function run(
  login: Login,
  owner: Login,
  command: Command,
  key: string = crypto.randomUUID(),
) {
  const { revision } = await studio(owner)
  return post(login, '/commands', { revision, command }, { 'idempotency-key': key })
}
async function member(owner: Login, email: string, role: string, staffId?: string) {
  const invitation = await post(owner, '/invitations', { email, role, staffId })
  expect(invitation.statusCode, invitation.body).toBe(201)
  const login = await register(email, invitation.json<{ invitation: string }>().invitation)
  return { ...login, orgId: owner.orgId }
}
const input = {
  signalId: 'party-season-2026',
  title: 'Christmas party season',
  reason: 'Christmas parties run from late November.',
  offer: 'Party-ready: a blow-dry or glow facial.',
  categories: ['Hair' as const, 'Skin' as const],
  startDate: '2026-11-27',
  endDate: '2026-12-24',
}

describe('specials on the server', () => {
  it('lets owners and managers plan and stop a special, but not the desk', async () => {
    const owner = await register('owner@example.invalid')
    const reception = await member(owner, 'desk@example.invalid', 'reception')
    expect((await run(reception, owner, { type: 'special-plan', input })).statusCode).toBe(403)
    const before = await studio(owner)
    const manager = await member(owner, 'manager@example.invalid', 'manager')
    const planned = await run(manager, owner, { type: 'special-plan', input })
    expect(planned.statusCode, planned.body).toBe(200)
    const after = await studio(owner)
    expect(after.specials).toMatchObject([{ signalId: 'party-season-2026' }])
    expect(after.services).toEqual(before.services)
    expect((await run(manager, owner, { type: 'special-plan', input })).statusCode).toBe(422)
    const stop = { type: 'special-stop' as const, specialId: after.specials![0].id }
    expect((await run(reception, owner, stop)).statusCode).toBe(403)
    expect((await run(owner, owner, stop)).statusCode).toBe(200)
    expect((await studio(owner)).specials![0].stoppedOn).toBe('2026-11-27')
  })
})
