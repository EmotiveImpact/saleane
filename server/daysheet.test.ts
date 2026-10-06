// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApiHandler } from './app'
import type { ApiHandler, InjectResponse } from './app'
import type { BusinessState } from '../src/domain/model'
import { daySheetSchema } from '../src/domain/daySheet'
import type { DaySheet } from '../src/domain/daySheet'

// OFF-01 acceptance: the day sheet is read-only and scoped by the server membership.
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
const post = (login: Login, path: string, payload: unknown) =>
  api.inject({
    method: 'POST',
    url: `/api/workspaces/${login.orgId}${path}`,
    headers: headers(login),
    payload,
  })
async function member(owner: Login, email: string, role: string, staffId?: string) {
  const invitation = await post(owner, '/invitations', { email, role, staffId })
  expect(invitation.statusCode, invitation.body).toBe(201)
  const login = await register(email, invitation.json<{ invitation: string }>().invitation, email)
  return { ...login, orgId: owner.orgId }
}
async function sheet(login: Login) {
  const response = await get(login, '/day-sheet')
  expect(response.statusCode, response.body).toBe(200)
  return { body: response.body, sheet: daySheetSchema.parse(response.json<DaySheet>()) }
}

describe('the read-only day sheet (OFF-01)', () => {
  it('gives owner, manager and reception today’s studio visits without email, money or notes', async () => {
    const owner = await register('owner@example.invalid')
    const state = (await get(owner)).json<{ state: BusinessState }>().state
    const today = state.appointments.filter(
      (a) => a.date === '2026-10-06' && a.status !== 'cancelled',
    )
    for (const login of [
      owner,
      await member(owner, 'manager@example.invalid', 'manager'),
      await member(owner, 'desk@example.invalid', 'reception'),
    ]) {
      const { body, sheet: day } = await sheet(login)
      expect(day.audience).toBe('studio')
      expect(day.visits.map((v) => v.id).sort()).toEqual(today.map((a) => a.id).sort())
      expect(day.visits.every((v) => typeof v.clientPhone === 'string')).toBe(true)
      expect(day.generatedAt).toBe('2026-10-06T08:00:00.000Z')
      expect(Date.parse(day.expiresAt)).toBeGreaterThan(Date.parse(day.generatedAt))
      for (const client of state.clients) expect(body).not.toContain(client.email)
      for (const field of ['priceMinor', 'depositMinor', 'sales', 'payments', 'notes', 'email'])
        expect(body).not.toContain(`"${field}"`)
    }
  })

  it('gives a practitioner only their own visits and no phone numbers', async () => {
    const owner = await register('owner@example.invalid')
    const state = (await get(owner)).json<{ state: BusinessState }>().state
    const maya = await member(owner, 'maya@example.invalid', 'practitioner', 'staff-maya')
    const { body, sheet: day } = await sheet(maya)
    expect(day.audience).toBe('practitioner')
    expect(day.professional?.id).toBe('staff-maya')
    const mine = state.appointments.filter(
      (a) => a.date === '2026-10-06' && a.staffId === 'staff-maya' && a.status !== 'cancelled',
    )
    expect(mine.length).toBeGreaterThan(0)
    expect(day.visits.map((v) => v.id).sort()).toEqual(mine.map((a) => a.id).sort())
    expect(body).not.toContain('"clientPhone"')
    for (const other of state.appointments.filter((a) => a.staffId !== 'staff-maya'))
      expect(body).not.toContain(`"${other.id}"`)
    for (const client of state.clients) {
      expect(body).not.toContain(client.email)
      if (client.phone) expect(body).not.toContain(client.phone)
    }
  })

  it('denies signed-out readers, other studios and writes', async () => {
    const owner = await register('owner@example.invalid')
    const elsewhere = await register('second-owner@example.invalid')
    const maya = await member(owner, 'maya@example.invalid', 'practitioner', 'staff-maya')
    expect((await api.inject({ url: `/api/workspaces/${owner.orgId}/day-sheet` })).statusCode).toBe(
      401,
    )
    expect((await get({ ...owner, orgId: elsewhere.orgId }, '/day-sheet')).statusCode).toBe(404)
    expect((await get({ ...maya, orgId: elsewhere.orgId }, '/day-sheet')).statusCode).toBe(404)
    expect((await post(owner, '/day-sheet', {})).statusCode).toBe(405)
    expect((await get(owner, '/day-sheet/extra')).statusCode).toBe(404)
  })

  it('follows role changes and revocation on the next request', async () => {
    const owner = await register('owner@example.invalid')
    const maya = await member(owner, 'maya@example.invalid', 'practitioner', 'staff-maya')
    const role = (payload: Record<string, unknown>) =>
      post(owner, '/membership', { accountId: maya.userId, ...payload })
    expect((await role({ role: 'practitioner', staffId: 'staff-sophia' })).statusCode).toBe(200)
    expect((await sheet(maya)).sheet.professional?.id).toBe('staff-sophia')
    expect((await role({ role: 'reception' })).statusCode).toBe(200)
    expect((await sheet(maya)).sheet.audience).toBe('studio')
    expect((await role({ role: 'remove' })).statusCode).toBe(200)
    expect((await get(maya, '/day-sheet')).statusCode).toBe(404)
  })
})
