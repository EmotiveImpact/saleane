// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApiHandler } from './app'
import type { ApiHandler, InjectResponse } from './app'
import type { BusinessState } from '../src/domain/model'
import type { Command } from '../src/domain/commands'

// PILOT-03: moving from another system. Owners and managers bring records across; the desk can
// close a carried-over balance; practitioners see none of it; the old system is never a till.
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
              name: 'Switching Studio',
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
const visit = {
  serviceId: 'service-facial',
  staffId: 'staff-maya',
  date: '2026-10-08',
  startMinutes: 605,
  priceMinor: 8500,
  depositPaidMinor: 2000,
  clientId: 'client-1',
  reference: 'BK-1',
}

describe('moving from another system on the server', () => {
  it('brings visits and balances across for the owner, and lets the desk close a balance', async () => {
    const owner = await register('owner@example.invalid')
    const imported = await run(owner, owner, {
      type: 'import-appointments',
      source: 'Fresha',
      reviewed: true,
      appointments: [visit],
    })
    expect(imported.statusCode, imported.body).toBe(200)
    const balances = await run(owner, owner, {
      type: 'import-balances',
      source: 'Fresha',
      reviewed: true,
      balances: [{ clientId: 'client-2', kind: 'credit', amountMinor: 2500, note: 'Gift card' }],
    })
    expect(balances.statusCode, balances.body).toBe(200)
    const state = await studio(owner)
    expect(state.operations!.imports!.map((batch) => batch.actor)).toEqual([
      'Studio Person',
      'Studio Person',
    ])
    expect(state.payments.find((p) => p.method === 'previous_system')).toMatchObject({
      amountMinor: 2000,
      reference: 'Paid to Fresha before switching · BK-1',
    })
    const reception = await member(owner, 'desk@example.invalid', 'reception')
    const refused = await run(reception, owner, {
      type: 'import-balances',
      source: 'Fresha',
      reviewed: true,
      balances: [{ clientId: 'client-3', kind: 'owed', amountMinor: 500, note: '' }],
    })
    expect(refused.statusCode).toBe(403)
    const balanceId = state.operations!.balances![0].id
    const closed = await run(reception, owner, {
      type: 'balance-settle',
      balanceId,
      note: 'Taken off a facial',
    })
    expect(closed.statusCode, closed.body).toBe(200)
    expect((await studio(owner)).operations!.balances![0].settled).toMatchObject({
      note: 'Taken off a facial',
    })
  })

  it('keeps balances and the import log from practitioners', async () => {
    const owner = await register('owner@example.invalid')
    await run(owner, owner, {
      type: 'import-balances',
      source: 'Fresha',
      reviewed: true,
      balances: [{ clientId: 'client-1', kind: 'credit', amountMinor: 2500, note: 'Gift card' }],
    })
    const maya = await member(owner, 'maya@example.invalid', 'practitioner', 'staff-maya')
    expect(
      (await run(maya, owner, { type: 'balance-settle', balanceId: 'x', note: 'No' })).statusCode,
    ).toBe(403)
    const view = await get(maya)
    expect(view.statusCode).toBe(200)
    expect(view.body).not.toContain('Gift card')
    expect(view.body).not.toContain('imports')
  })

  it('refuses the old system as a way to record money by hand', async () => {
    const owner = await register('owner@example.invalid')
    await run(owner, owner, {
      type: 'import-appointments',
      source: 'Fresha',
      reviewed: true,
      appointments: [{ ...visit, depositPaidMinor: 0 }],
    })
    const a = (await studio(owner)).appointments.find((x) => x.source === 'import')!
    const response = await run(owner, owner, {
      type: 'deposit',
      appointmentId: a.id,
      amountMinor: 1000,
      method: 'previous_system',
      reference: 'Made up',
    })
    expect(response.statusCode).toBe(422)
    expect((await studio(owner)).payments.some((p) => p.appointmentId === a.id)).toBe(false)
  })
})
