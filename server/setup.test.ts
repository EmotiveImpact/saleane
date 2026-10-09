// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApiHandler } from './app'
import type { ApiHandler, InjectResponse } from './app'
import type { BusinessState } from '../src/domain/model'
import type { Command } from '../src/domain/commands'

// The setup wizards: a new studio set up screen by screen, and a location added in one go.
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
async function register(email: string, invitation?: string, sample = false) {
  const response = await api.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: {
      name: 'Studio Owner',
      email,
      password,
      ...(invitation
        ? { invitation }
        : { workspace: { name: 'Linden Studio', locationName: 'Bath', region: 'UK', sample } }),
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
const studio = async (login: Login) => (await get(login)).json<{ state: BusinessState }>().state
async function run(login: Login, command: Command) {
  const { revision } = await studio(login)
  return post(login, '/commands', { revision, command }, { 'idempotency-key': crypto.randomUUID() })
}
async function invite(owner: Login, email: string, role: string) {
  const invitation = await post(owner, '/invitations', { email, role })
  expect(invitation.statusCode, invitation.body).toBe(201)
  const login = await register(email, invitation.json<{ invitation: string }>().invitation)
  return { ...login, orgId: owner.orgId }
}
const facial = {
  type: 'service',
  input: {
    name: 'Signature facial',
    description: '',
    category: 'Skin',
    durationMinutes: 60,
    bufferMinutes: 15,
    priceMinor: 8500,
    depositMinor: 0,
    resourceType: 'treatment',
    archived: false,
  },
}

describe('set up your studio', () => {
  it('saves each screen for the owner and remembers where they reached', async () => {
    const owner = await register('owner@example.invalid')
    const response = await run(owner, {
      type: 'setup-step',
      next: 'team',
      changes: [facial],
    } as Command)
    expect(response.statusCode, response.body).toBe(200)
    const state = await studio(owner)
    expect(state.services.map((x) => x.name)).toEqual(['Signature facial'])
    expect(state.operations!.setup).toEqual({ next: 'team' })
  })

  it('is refused to anyone but the owner, even for changes they could make in Settings', async () => {
    const owner = await register('owner@example.invalid')
    const manager = await invite(owner, 'manager@example.invalid', 'manager')
    expect((await run(manager, facial as Command)).statusCode).toBe(200)
    const response = await run(manager, {
      type: 'setup-step',
      next: 'team',
      changes: [facial],
    } as Command)
    expect(response.statusCode).toBe(403)
    expect((await studio(owner)).operations!.setup).toBeUndefined()
  })

  it('refuses a screen with a change outside setup', async () => {
    const owner = await register('owner@example.invalid')
    const response = await run(owner, {
      type: 'setup-step',
      next: 'team',
      changes: [{ type: 'client', contact: { name: 'Ann' } }],
    } as unknown as Command)
    expect(response.statusCode).toBe(400)
  })
})

describe('add a location', () => {
  it('opens the location with its rooms, team and menu for the owner only', async () => {
    const owner = await register('owner@example.invalid', undefined, true)
    const manager = await invite(owner, 'manager@example.invalid', 'manager')
    const opening = {
      type: 'location-open',
      location: { name: 'Islington', address: '1 Upper Street, London' },
      rooms: [{ name: 'Islington room 1', type: 'treatment' }],
      team: [{ staffId: 'staff-maya', days: [1] }],
      newTeam: [],
      notOffered: ['service-lymphatic'],
      prices: [{ serviceId: 'service-facial', priceMinor: 10500 }],
    } as Command
    expect((await run(manager, opening)).statusCode).toBe(403)
    const response = await run(owner, opening)
    expect(response.statusCode, response.body).toBe(200)
    const state = await studio(owner)
    const islington = state.operations!.locations!.find((l) => l.name === 'Islington')!
    expect(response.json<{ recordId: string }>().recordId).toBe(islington.id)
    expect(state.resources.filter((r) => r.locationId === islington.id)).toHaveLength(1)
    const maya = state.staff.find((p) => p.id === 'staff-maya')!
    expect(maya.hours!.find((h) => h.day === 1)!.locationId).toBe(islington.id)
    expect(state.services.find((x) => x.id === 'service-lymphatic')!.notOfferedAt).toEqual([
      islington.id,
    ])
  })
})
