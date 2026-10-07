// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApiHandler } from './app'
import type { ApiHandler, InjectResponse } from './app'
import type { BusinessState } from '../src/domain/model'
import type { Command } from '../src/domain/commands'

// End-of-day till count: the desk, managers and owners record it; practitioners neither record
// nor read it; a retried request never records a second count.
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
              name: 'Till Studio',
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
const count: Command = {
  type: 'till-count',
  date: '2026-10-06',
  openingFloatMinor: 10000,
  countedMinor: 12550,
  bankingMinor: 2500,
  note: 'Drawer counted twice',
}

describe('end-of-day till count on the server', () => {
  it('lets the owner, a manager and reception record a count, each under their own name', async () => {
    const owner = await register('owner@example.invalid')
    const manager = await member(owner, 'manager@example.invalid', 'manager')
    const reception = await member(owner, 'desk@example.invalid', 'reception')
    for (const login of [owner, manager, reception]) {
      const response = await run(login, owner, count)
      expect(response.statusCode, response.body).toBe(200)
    }
    const counts = (await studio(owner)).tillCounts!
    expect(counts).toHaveLength(3)
    expect(counts.every((c) => c.actor === 'Studio Person')).toBe(true)
    expect(counts[0]).toMatchObject({ countedMinor: 12550, bankingMinor: 2500 })
  })

  it('refuses practitioners and never sends them till counts', async () => {
    const owner = await register('owner@example.invalid')
    expect((await run(owner, owner, count)).statusCode).toBe(200)
    const maya = await member(owner, 'maya@example.invalid', 'practitioner', 'staff-maya')
    const refused = await run(maya, owner, count)
    expect(refused.statusCode).toBe(403)
    expect((await studio(owner)).tillCounts).toHaveLength(1)
    const view = await get(maya)
    expect(view.statusCode).toBe(200)
    expect(view.body).not.toContain('tillCount')
    expect(view.body).not.toContain('Drawer counted twice')
  })

  it('records a retried request once, and refuses the same key for a different count', async () => {
    const owner = await register('owner@example.invalid')
    const key = 'till-count-retry-1'
    const first = await run(owner, owner, count, key)
    expect(first.statusCode, first.body).toBe(200)
    const retry = await run(owner, owner, count, key)
    expect(retry.statusCode, retry.body).toBe(200)
    expect(retry.json()).toMatchObject({ replayed: true, recordId: first.json().recordId })
    expect((await studio(owner)).tillCounts).toHaveLength(1)
    const changed = await run(owner, owner, { ...count, countedMinor: 1 }, key)
    expect(changed.statusCode).toBe(409)
    expect((await studio(owner)).tillCounts).toHaveLength(1)
  })

  it('rejects impossible amounts before they reach the record', async () => {
    const owner = await register('owner@example.invalid')
    const over = await run(owner, owner, { ...count, bankingMinor: 99999 })
    expect(over.statusCode).toBe(422)
    const negative = await run(owner, owner, { ...count, countedMinor: -5 })
    expect(negative.statusCode).toBe(400)
    expect((await studio(owner)).tillCounts ?? []).toHaveLength(0)
  })
})
