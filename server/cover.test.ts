// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApiHandler } from './app'
import type { ApiHandler, InjectResponse } from './app'
import type { BusinessState } from '../src/domain/model'
import type { Command } from '../src/domain/commands'
import { coverPlan } from '../src/domain/cover'

// Ask Saleane's one-approval plans: every change inside a batch is checked against the person's
// role, so a plan cannot carry a change their role could not make on its own.
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
              name: 'Cover Studio',
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
describe('one-approval plans on the server', () => {
  it('lets a manager cover for someone who is off, but not reception', async () => {
    const owner = await register('owner@example.invalid')
    const state = await studio(owner)
    const plan = coverPlan(state, 'staff-theo', '2026-10-07', '2026-10-06T17:40:00.000Z')
    const command: Command = { type: 'batch', label: 'Theo is off', commands: plan.commands }
    expect(plan.commands.some((c) => c.type === 'closure')).toBe(true)
    const reception = await member(owner, 'desk@example.invalid', 'reception')
    expect((await run(reception, owner, command)).statusCode).toBe(403)
    const manager = await member(owner, 'manager@example.invalid', 'manager')
    const before = (await studio(owner)).revision
    const done = await run(manager, owner, command)
    expect(done.statusCode, done.body).toBe(200)
    expect((await studio(owner)).revision).toBe(before + 1)
  })

  it('refuses a batch that tries to take a payment', async () => {
    const owner = await register('owner@example.invalid')
    const sneaky = {
      type: 'batch',
      label: 'Sneaky',
      commands: [{ type: 'checkout', appointmentId: 'x', tipMinor: 0, method: 'cash' }],
    } as unknown as Command
    const refused = await run(owner, owner, sneaky)
    expect(refused.statusCode).toBeGreaterThanOrEqual(400)
    expect(refused.statusCode).toBeLessThan(500)
  })
})
