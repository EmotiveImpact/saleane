// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApiHandler } from './app'
import type { ApiHandler, InjectResponse } from './app'
import type { BusinessState } from '../src/domain/model'
import type { Command } from '../src/domain/commands'

// V5: the studio's colours and the house rules every location follows.
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
const get = (login: Login, path = '') =>
  api.inject({ url: `/api/workspaces/${login.orgId}${path}`, headers: headers(login) })
const post = (login: Login, path: string, payload: unknown, extra: Record<string, string> = {}) =>
  api.inject({
    method: 'POST',
    url: `/api/workspaces/${login.orgId}${path}`,
    headers: { ...headers(login), ...extra },
    payload,
  })
const run = (login: Login, revision: number, command: Command, key: string = crypto.randomUUID()) =>
  post(login, '/commands', { revision, command }, { 'idempotency-key': key })
async function studio(owner: Login) {
  return (await get(owner)).json<{ state: BusinessState }>().state
}
const ok = async (login: Login, revision: number, command: Command) => {
  const response = await run(login, revision, command)
  expect(response.statusCode, response.body).toBe(200)
  return response
}
async function invite(owner: Login, email: string, role: string) {
  const invitation = await post(owner, '/invitations', { email, role })
  expect(invitation.statusCode, invitation.body).toBe(201)
  const login = await register(email, invitation.json<{ invitation: string }>().invitation)
  return { ...login, orgId: owner.orgId }
}

describe('studio colours', () => {
  it('are kept with the studio and shown on its booking page', async () => {
    const owner = await register('owner@example.invalid')
    const slug = (await get(owner)).json<{ slug: string }>().slug
    expect((await api.inject({ url: `/api/public/${slug}` })).json().look).toBeUndefined()
    let state = await studio(owner)
    const look = { first: '#557089', second: '#6f9cbc' }
    await ok(owner, state.revision, { type: 'studio-look', look })
    state = await studio(owner)
    expect(state.operations!.look).toEqual(look)
    expect((await api.inject({ url: `/api/public/${slug}` })).json().look).toEqual(look)
    // Only the listed colours can be chosen.
    const odd = await run(owner, state.revision, {
      type: 'studio-look',
      look: { first: '#000000', second: '#6f9cbc' },
    } as unknown as Command)
    expect(odd.statusCode).toBe(400)
  })

  it('may be changed by a manager but not by the desk', async () => {
    const owner = await register('owner@example.invalid')
    const manager = await invite(owner, 'manager@example.invalid', 'manager')
    const desk = await invite(owner, 'desk@example.invalid', 'reception')
    const look = { first: '#3f7f80', second: '#c98a5e' } as const
    let state = await studio(owner)
    await ok(manager, state.revision, { type: 'studio-look', look })
    state = await studio(owner)
    expect((await run(desk, state.revision, { type: 'studio-look', look })).statusCode).toBe(403)
  })
})

describe('house rules', () => {
  it('are set by the owner only and checked whenever a treatment is saved', async () => {
    const owner = await register('owner@example.invalid')
    const manager = await invite(owner, 'manager@example.invalid', 'manager')
    let state = await studio(owner)
    await ok(owner, state.revision, {
      type: 'location',
      input: { name: 'Islington', address: '1 Upper Street, London' },
    })
    state = await studio(owner)
    const islington = state.operations!.locations![0].id
    const service = state.services.find((x) => !x.archived)!
    const rules: Command = {
      type: 'house-rules',
      priceBandPercent: 10,
      coreServiceIds: [service.id],
    }
    expect((await run(manager, state.revision, rules)).statusCode).toBe(403)
    await ok(owner, state.revision, rules)
    state = await studio(manager)
    expect(state.operations!.houseRules).toEqual({
      priceBandPercent: 10,
      coreServiceIds: [service.id],
    })
    const { id, ...input } = service
    const save = (patch: Partial<typeof input>) =>
      run(manager, state.revision, {
        type: 'service',
        id,
        input: { ...input, ...patch },
      } as Command)
    const far = await save({
      locationPrices: [{ locationId: islington, priceMinor: Math.round(service.priceMinor * 1.2) }],
    })
    expect(far.statusCode).toBe(422)
    expect(far.json().error).toContain('within 10%')
    const dropped = await save({ notOfferedAt: [islington] })
    expect(dropped.statusCode).toBe(422)
    expect(dropped.json().error).toContain('core treatment')
    const near = await save({
      locationPrices: [{ locationId: islington, priceMinor: Math.round(service.priceMinor * 1.1) }],
    })
    expect(near.statusCode, near.body).toBe(200)
  })
})
