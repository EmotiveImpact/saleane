// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApiHandler } from './app'
import type { ApiHandler } from './app'
import type { BusinessState } from '../src/domain/model'
import type { Command } from '../src/domain/commands'

// V2: commission rates are set by the owner, read by managers and never sent to reception.
const origin = 'http://127.0.0.1:5173'
const password = 'Fictional local account 2026!'
type Login = { cookie: string; csrf: string; orgId: string }
let api: ApiHandler
let clock: number

beforeEach(() => {
  // 9:00 on 7 October in London is 08:00Z, so the 24-hour cutoff is 08:00Z on 6 October.
  // The sample studio's day, early in the morning, so its visits are still ahead.
  clock = Date.parse('2026-10-06T06:00:00.000Z')
  api = createApiHandler({ origin, databasePath: ':memory:', now: () => clock })
})
afterEach(() => api.close())

const headers = (login: Login) => ({ cookie: login.cookie, 'x-csrf-token': login.csrf })
async function register(email = 'owner@example.invalid') {
  const response = await api.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: {
      name: 'Ada Owner',
      email,
      password,
      workspace: { name: 'Reference Studio', locationName: 'London', region: 'UK', sample: true },
    },
  })
  expect(response.statusCode, response.body).toBe(201)
  return {
    ...response.json<{ csrf: string; orgId: string }>(),
    cookie: String(response.headers['set-cookie']).split(';')[0],
  }
}
async function studio(login: Login) {
  return (
    await api.inject({ url: `/api/workspaces/${login.orgId}`, headers: headers(login) })
  ).json<{ slug: string; state: BusinessState }>()
}
const run = (login: Login, revision: number, command: Command) =>
  api.inject({
    method: 'POST',
    url: `/api/workspaces/${login.orgId}/commands`,
    headers: { ...headers(login), 'idempotency-key': crypto.randomUUID() },
    payload: { revision, command },
  })

async function member(owner: Login, email: string, role: string, staffId?: string) {
  const invitation = await api.inject({
    method: 'POST',
    url: `/api/workspaces/${owner.orgId}/invitations`,
    headers: headers(owner),
    payload: { email, role, staffId },
  })
  expect(invitation.statusCode, invitation.body).toBe(201)
  const response = await api.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: {
      name: 'Team Person',
      email,
      password,
      invitation: invitation.json<{ invitation: string }>().invitation,
    },
  })
  expect(response.statusCode, response.body).toBe(201)
  return {
    ...response.json<{ csrf: string; orgId: string }>(),
    orgId: owner.orgId,
    cookie: String(response.headers['set-cookie']).split(';')[0],
  }
}

describe('commission rates over the API', () => {
  it('lets the owner set them, managers read them and keeps them from reception', async () => {
    const owner = await register()
    const before = await studio(owner)
    const command = {
      type: 'pay-rate',
      staffId: 'staff-sophia',
      serviceBps: 4250,
      productBps: 1000,
      from: '2026-10-01',
    } as Command
    const manager = await member(owner, 'manager@example.invalid', 'manager')
    expect((await run(manager, before.state.revision, command)).statusCode).toBe(403)
    const saved = await run(owner, before.state.revision, command)
    expect(saved.statusCode, saved.body).toBe(200)
    const managerView = await studio(manager)
    expect(managerView.state.operations!.payRates!.some((r) => r.serviceBps === 4250)).toBe(true)
    const desk = await member(owner, 'desk@example.invalid', 'reception')
    const deskView = await api.inject({
      url: `/api/workspaces/${owner.orgId}`,
      headers: headers(desk),
    })
    expect(deskView.statusCode).toBe(200)
    expect(deskView.json<{ state: BusinessState }>().state.operations!.payRates).toBeUndefined()
    expect(deskView.body).not.toContain('4250')
  })
})
