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
    // The rate must not appear as a value anywhere. Matching it as a JSON number rather than any
    // substring stops a random id that happens to contain "4250" failing the test.
    expect(deskView.body).not.toMatch(/[:[,]4250[,}\]]/)
    expect(deskView.body).not.toContain('serviceBps')
  })
})

describe('commission by treatment, steps and targets over the API (Stage 3)', () => {
  const rate = {
    type: 'commission-rate',
    input: {
      item: { kind: 'treatment', serviceId: 'service-facial' },
      bps: 4650,
      from: '2026-10-01',
    },
  } as Command
  const steps = {
    type: 'commission-steps',
    input: {
      staffId: 'staff-maya',
      on: 'treatments',
      kind: 'whole',
      steps: [
        { fromMinor: 0, bps: 3000 },
        { fromMinor: 450000, bps: 3650 },
      ],
      from: '2026-10-01',
    },
  } as Command
  const target = {
    type: 'staff-target',
    input: { staffId: 'staff-maya', from: '2026-10', takingsMinor: 765400 },
  } as Command

  it('lets only the owner set rates and steps, and the owner or a manager set targets', async () => {
    const owner = await register()
    const manager = await member(owner, 'manager@example.invalid', 'manager')
    const desk = await member(owner, 'desk@example.invalid', 'reception')
    const maya = await member(owner, 'maya@example.invalid', 'practitioner', 'staff-maya')
    let revision = (await studio(owner)).state.revision
    for (const command of [rate, steps])
      for (const login of [manager, desk, maya])
        expect((await run(login, revision, command)).statusCode).toBe(403)
    for (const login of [desk, maya])
      expect((await run(login, revision, target)).statusCode).toBe(403)
    for (const command of [rate, steps]) {
      const saved = await run(owner, revision, command)
      expect(saved.statusCode, saved.body).toBe(200)
      revision += 1
    }
    const set = await run(manager, revision, target)
    expect(set.statusCode, set.body).toBe(200)
    const o = (await studio(owner)).state.operations!
    expect(o.commissionRates!.at(-1)).toMatchObject({ bps: 4650 })
    expect(o.commissionSteps!.at(-1)).toMatchObject({ kind: 'whole', staffId: 'staff-maya' })
    expect(o.staffTargets!.at(-1)).toMatchObject({ takingsMinor: 765400 })
    // Who changed what keeps each change.
    const changes = await api.inject({
      url: `/api/workspaces/${owner.orgId}/changes`,
      headers: headers(owner),
    })
    expect(changes.statusCode, changes.body).toBe(200)
    for (const words of [
      'Changed a commission rate for a treatment or product',
      'Changed commission steps by takings',
      'Changed a monthly target',
    ])
      expect(changes.body).toContain(words)
  })

  it('keeps rates, steps, targets and rent terms from reception, and a practitioner sees only their own target', async () => {
    const owner = await register()
    const revision = (await studio(owner)).state.revision
    expect((await run(owner, revision, rate)).statusCode).toBe(200)
    const desk = await member(owner, 'desk@example.invalid', 'reception')
    const deskView = await api.inject({
      url: `/api/workspaces/${owner.orgId}`,
      headers: headers(desk),
    })
    expect(deskView.statusCode).toBe(200)
    const o = deskView.json<{ state: BusinessState }>().state.operations!
    for (const field of ['commissionRates', 'commissionSteps', 'staffTargets', 'rentPayments'])
      expect(o).not.toHaveProperty(field)
    expect(o.rentals!.every((rental) => rental.amountMinor === 0 && !rental.percentBps)).toBe(true)
    expect(deskView.body).not.toMatch(/[:[,]4650[,}\]]/)
    for (const field of ['"bps"', 'percentBps', 'takingsMinor'])
      expect(deskView.body).not.toContain(field)
    // Maya reads her own target for the month and nothing of anyone else's.
    const maya = await member(owner, 'maya@example.invalid', 'practitioner', 'staff-maya')
    const own = await api.inject({ url: `/api/workspaces/${owner.orgId}`, headers: headers(maya) })
    expect(own.statusCode).toBe(200)
    const view = own.json<{
      practitioner: { target?: { month: string; targetMinor: number; currency: string } }
    }>().practitioner
    expect(view.target).toMatchObject({ month: '2026-10', targetMinor: 600000, currency: 'GBP' })
    // Sophia's target is £12,000 with £600 of products.
    expect(own.body).not.toMatch(/[:[,](1200000|60000)[,}\]]/)
    for (const field of ['staffTargets', 'commissionRates', 'commissionSteps', 'payRates', '"bps"'])
      expect(own.body).not.toContain(field)
  })
})
