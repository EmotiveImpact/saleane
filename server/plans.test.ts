// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApiHandler } from './app'
import type { ApiHandler, InjectResponse } from './app'
import type { BusinessState } from '../src/domain/model'
import type { Command } from '../src/domain/commands'

// V1.5: packages and memberships. Owners set them up, the desk sells and renews them, only
// managers and owners end one, and practitioners never see what a client paid.
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
              name: 'Plans Studio',
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
const offer = {
  kind: 'package' as const,
  name: 'Five facials',
  serviceIds: ['service-facial'],
  visits: 5,
  priceMinor: 40000,
  discountPercent: 0,
  validMonths: 6,
  archived: false,
}

describe('packages and memberships on the server', () => {
  it('lets the owner set up a plan, the desk sell it, and only a manager end it', async () => {
    const owner = await register('owner@example.invalid')
    const reception = await member(owner, 'desk@example.invalid', 'reception')
    expect((await run(reception, owner, { type: 'offer', input: offer })).statusCode).toBe(403)
    const added = await run(owner, owner, { type: 'offer', input: offer })
    expect(added.statusCode, added.body).toBe(200)
    const offerId = (await studio(owner)).offers![0].id
    const method = (await studio(owner)).operations?.mode === 'local' ? 'cash' : 'demo_cash'
    const sold = await run(reception, owner, {
      type: 'plan-sell',
      offerId,
      clientId: 'client-1',
      method,
    })
    expect(sold.statusCode, sold.body).toBe(200)
    const holding = (await studio(owner)).holdings![0]
    expect(holding).toMatchObject({ actor: 'Studio Person', status: 'active' })
    const end = { type: 'plan-cancel' as const, holdingId: holding.id, reason: 'Moving away' }
    expect((await run(reception, owner, end)).statusCode).toBe(403)
    const manager = await member(owner, 'manager@example.invalid', 'manager')
    expect((await run(manager, owner, end)).statusCode).toBe(200)
    expect((await studio(owner)).holdings![0].status).toBe('cancelled')
  })

  it('keeps plans and what clients paid from practitioners', async () => {
    const owner = await register('owner@example.invalid')
    await run(owner, owner, { type: 'offer', input: offer })
    const offerId = (await studio(owner)).offers![0].id
    const method = (await studio(owner)).operations?.mode === 'local' ? 'cash' : 'demo_cash'
    await run(owner, owner, { type: 'plan-sell', offerId, clientId: 'client-1', method })
    const maya = await member(owner, 'maya@example.invalid', 'practitioner', 'staff-maya')
    const view = await get(maya)
    expect(view.statusCode).toBe(200)
    expect(view.body).not.toContain('Five facials')
    expect(view.body).not.toContain('holdings')
    expect(
      (await run(maya, owner, { type: 'plan-sell', offerId, clientId: 'client-1', method }))
        .statusCode,
    ).toBe(403)
  })
})
