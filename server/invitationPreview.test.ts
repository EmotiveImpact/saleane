// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApiHandler } from './app'
import type { ApiHandler, InjectResponse } from './app'
import type { BusinessState } from '../src/domain/model'
import type { Command } from '../src/domain/commands'

// The join page reads an invitation before anyone signs in: the studio, the role, the location or
// region and the invited email, and nothing more.
const origin = 'http://127.0.0.1:5173'
const password = 'Fictional local account 2026!'
type Login = { cookie: string; csrf: string; orgId: string }
let api: ApiHandler
let clock: number

beforeEach(() => {
  clock = Date.parse('2026-10-06T08:00:00.000Z')
  api = createApiHandler({ origin, databasePath: ':memory:', now: () => clock })
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
              name: 'Fernleaf Rooms',
              locationName: 'Bath',
              region: 'UK',
              sample: true,
            },
          }),
    },
  })
  expect(response.statusCode, response.body).toBe(201)
  return { ...response.json<{ csrf: string; orgId: string }>(), cookie: cookie(response) }
}
const studio = async (owner: Login) =>
  (await api.inject({ url: `/api/workspaces/${owner.orgId}`, headers: headers(owner) })).json<{
    state: BusinessState
  }>().state
async function run(owner: Login, command: Command) {
  const response = await api.inject({
    method: 'POST',
    url: `/api/workspaces/${owner.orgId}/commands`,
    headers: { ...headers(owner), 'idempotency-key': crypto.randomUUID() },
    payload: { revision: (await studio(owner)).revision, command },
  })
  expect(response.statusCode, response.body).toBe(200)
}
async function invite(owner: Login, payload: Record<string, unknown>) {
  const response = await api.inject({
    method: 'POST',
    url: `/api/workspaces/${owner.orgId}/invitations`,
    headers: headers(owner),
    payload,
  })
  expect(response.statusCode, response.body).toBe(201)
  return response.json<{ invitation: string }>().invitation
}
/** Read without a session, as someone opening the link for the first time would. */
const preview = (invitation: unknown) =>
  api.inject({ method: 'POST', url: '/api/invitations/preview', payload: { invitation } })

describe('reading an invitation on the join page', () => {
  it('names the studio, the role and the invited email, and nothing else', async () => {
    const owner = await register('owner@example.invalid')
    const raw = await invite(owner, {
      email: 'maya@example.invalid',
      role: 'practitioner',
      staffId: 'staff-maya',
    })
    const response = await preview(raw)
    expect(response.statusCode, response.body).toBe(200)
    expect(response.json()).toEqual({
      studio: 'Fernleaf Rooms',
      role: 'practitioner',
      email: 'maya@example.invalid',
    })
    // Reading it leaves the link open: the invited person can still join with it.
    const member = await register('maya@example.invalid', raw)
    expect(member.orgId).toBe(owner.orgId)
  })

  it('adds the location for a general manager and the region for a regional manager', async () => {
    const owner = await register('owner@example.invalid')
    await run(owner, { type: 'location', input: { name: 'Frome', address: '3 Cheap Street' } })
    const frome = (await studio(owner)).operations!.locations![0].id
    await run(owner, {
      type: 'region',
      input: { name: 'Somerset', locationIds: [(await studio(owner)).organisation.locationId] },
    })
    const somerset = (await studio(owner)).operations!.regions![0].id
    const general = await invite(owner, {
      email: 'gm@example.invalid',
      role: 'general',
      locationId: frome,
    })
    const regional = await invite(owner, {
      email: 'rm@example.invalid',
      role: 'regional',
      areaId: somerset,
    })
    expect((await preview(general)).json()).toEqual({
      studio: 'Fernleaf Rooms',
      role: 'general',
      location: 'Frome',
      email: 'gm@example.invalid',
    })
    expect((await preview(regional)).json()).toEqual({
      studio: 'Fernleaf Rooms',
      role: 'regional',
      region: 'Somerset',
      email: 'rm@example.invalid',
    })
  })

  it('refuses a link that is unknown, used, replaced or expired, without saying which', async () => {
    const owner = await register('owner@example.invalid')
    const expired = 'This invitation has expired or has already been used.'
    const unknown = await preview('x'.repeat(43))
    expect(unknown.statusCode).toBe(404)
    expect(unknown.json<{ error: string }>().error).toContain(expired)
    expect((await preview('too-short')).statusCode).toBe(400)

    const used = await invite(owner, { email: 'desk@example.invalid', role: 'reception' })
    await register('desk@example.invalid', used)
    expect((await preview(used)).statusCode).toBe(404)

    // A second invitation to the same email replaces the first.
    const first = await invite(owner, { email: 'manager@example.invalid', role: 'manager' })
    const second = await invite(owner, { email: 'manager@example.invalid', role: 'manager' })
    expect((await preview(first)).statusCode).toBe(404)
    expect((await preview(second)).statusCode).toBe(200)

    clock += 48 * 60 * 60000 + 1
    const late = await preview(second)
    expect(late.statusCode).toBe(404)
    expect(late.body).not.toContain('manager@example.invalid')
  })
})
