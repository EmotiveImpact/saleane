// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApiHandler } from './app'
import type { ApiHandler, InjectResponse } from './app'

// V5: one owner, several brands, side by side from totals only.
const origin = 'http://127.0.0.1:5173'
const password = 'Fictional local account 2026!'
type Login = { cookie: string; csrf: string; orgId: string; userId: string }
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
async function register(email: string, invitation?: string, name = 'Studio Owner') {
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
  const login = {
    ...response.json<{ csrf: string; orgId: string }>(),
    cookie: cookie(response),
    userId: '',
  }
  login.userId = (await api.inject({ url: '/api/session', headers: headers(login) })).json<{
    user: { id: string }
  }>().user.id
  return login
}
const post = (login: Login, path: string, payload: unknown, extra: Record<string, string> = {}) =>
  api.inject({
    method: 'POST',
    url: `/api/workspaces/${login.orgId}${path}`,
    headers: { ...headers(login), ...extra },
    payload,
  })
async function invite(owner: Login, email: string, role: string) {
  const invitation = await post(owner, '/invitations', { email, role })
  expect(invitation.statusCode, invitation.body).toBe(201)
  const login = await register(email, invitation.json<{ invitation: string }>().invitation)
  return { ...login, orgId: owner.orgId }
}

async function addBrand(owner: Login, name: string, region: 'UK' | 'US', sample = true) {
  const response = await api.inject({
    method: 'POST',
    url: '/api/workspaces',
    headers: headers(owner),
    payload: { workspace: { name, locationName: 'Main', region, sample } },
  })
  expect(response.statusCode, response.body).toBe(201)
  return response.json<{ orgId: string }>().orgId
}
type Group = {
  brands: { id: string; name: string; currency: string; sample: boolean; takingsMinor: number }[]
  totals: { currency: string; sample: boolean; brands: string[]; takingsMinor: number }[]
  summary: string[]
}
const group = async (login: Login) =>
  (await api.inject({ url: '/api/group', headers: headers(login) })).json<Group>()

describe('brands together', () => {
  it('puts every brand the owner owns side by side and adds up only like with like', async () => {
    const owner = await register('owner@example.invalid')
    const second = await addBrand(owner, 'Second Brand', 'UK')
    const american = await addBrand(owner, 'New York Brand', 'US')
    const real = await addBrand(owner, 'Real Studio', 'UK', false)
    const g = await group(owner)
    expect(g.brands.map((b) => b.name).sort()).toEqual([
      'New York Brand',
      'Real Studio',
      'Reference Studio',
      'Second Brand',
    ])
    const pounds = g.totals.find((t) => t.currency === 'GBP' && t.sample)!
    expect(pounds.brands.sort()).toEqual([owner.orgId, second].sort())
    expect(pounds.takingsMinor).toBe(
      g.brands.filter((b) => pounds.brands.includes(b.id)).reduce((n, b) => n + b.takingsMinor, 0),
    )
    expect(g.totals.find((t) => t.currency === 'USD')!.brands).toEqual([american])
    // A real studio is never added to sample money.
    expect(g.totals.find((t) => !t.sample)!.brands).toEqual([real])
    expect(g.summary[0]).toMatch(/^Across 1 brand, completed visits took £0 /)
    expect(g.summary[1]).toMatch(/^Across 2 sample brands, completed visits took £/)
    expect(g.summary[2]).toMatch(/^Across 1 sample brand, completed visits took \$/)
    // Totals only: no client, receipt or appointment ever leaves a brand.
    const text = JSON.stringify(g)
    expect(text).not.toContain('"clientId"')
    expect(text).not.toContain('"appointments"')
    expect(text).not.toContain('"sales"')
  })

  it('leaves out studios where the person is not the owner', async () => {
    const owner = await register('owner@example.invalid')
    const manager = await invite(owner, 'manager@example.invalid', 'manager')
    await addBrand(manager, 'Manager Brand', 'UK')
    expect((await group(manager)).brands.map((b) => b.name)).toEqual(['Manager Brand'])
    const desk = await invite(owner, 'desk@example.invalid', 'reception')
    expect((await group(desk)).brands).toEqual([])
    expect((await api.inject({ url: '/api/group' })).statusCode).toBe(401)
  })
})
