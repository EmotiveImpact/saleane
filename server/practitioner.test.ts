// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApiHandler } from './app'
import type { ApiHandler, InjectResponse } from './app'
import type { BusinessState } from '../src/domain/model'
import type { Command } from '../src/domain/commands'
import type { PractitionerView } from '../src/domain/practitioner'

// LOCAL-01 acceptance: an assigned practitioner reads and changes only their own visits.
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
async function practitioner(owner: Login, email: string, staffId: string, name = 'Maya Lewis') {
  const invitation = await post(owner, '/invitations', { email, role: 'practitioner', staffId })
  expect(invitation.statusCode, invitation.body).toBe(201)
  const login = await register(email, invitation.json<{ invitation: string }>().invitation, name)
  return { ...login, orgId: owner.orgId }
}
const view = async (login: Login) => {
  const response = await get(login)
  expect(response.statusCode, response.body).toBe(200)
  return response.json<{ view: string; practitioner: PractitionerView; state?: unknown }>()
}

describe('assigned practitioner access (LOCAL-01)', () => {
  it('links a practitioner invitation to exactly one active professional', async () => {
    const owner = await register('owner@example.invalid')
    const invite = (payload: Record<string, unknown>) => post(owner, '/invitations', payload)
    expect((await invite({ email: 'p@example.invalid', role: 'practitioner' })).statusCode).toBe(
      422,
    )
    expect(
      (await invite({ email: 'p@example.invalid', role: 'practitioner', staffId: 'staff-nobody' }))
        .statusCode,
    ).toBe(422)
    await practitioner(owner, 'maya@example.invalid', 'staff-maya')
    const second = await invite({
      email: 'other@example.invalid',
      role: 'practitioner',
      staffId: 'staff-maya',
    })
    expect(second.statusCode).toBe(409)
    const team = (await get(owner, '/team')).json<{
      members: { role: string; staffId: string | null }[]
      practitionerAccessEnabled: boolean
    }>()
    expect(team.practitionerAccessEnabled).toBe(true)
    expect(team.members).toContainEqual(
      expect.objectContaining({ role: 'practitioner', staffId: 'staff-maya' }),
    )
  })

  it('returns only their visits and minimal client details, never the studio record', async () => {
    const owner = await register('owner@example.invalid')
    const maya = await practitioner(owner, 'maya@example.invalid', 'staff-maya')
    const full = await studio(owner)
    const record = await view(maya)
    expect(record.view).toBe('practitioner')
    expect(record.state).toBeUndefined()
    const mine = new Set(
      full.appointments.filter((a) => a.staffId === 'staff-maya').map((a) => a.id),
    )
    const others = full.appointments.filter((a) => a.staffId !== 'staff-maya').map((a) => a.id)
    expect(record.practitioner.appointments.length).toBeGreaterThan(0)
    expect(record.practitioner.appointments.every((a) => mine.has(a.id))).toBe(true)
    const body = JSON.stringify(record)
    for (const id of others) expect(body).not.toContain(`"${id}"`)
    const served = new Set(record.practitioner.appointments.map((a) => a.clientId))
    for (const client of full.clients) {
      expect(body).not.toContain(client.email)
      if (!served.has(client.id)) expect(body).not.toContain(`"${client.id}"`)
    }
    for (const field of [
      'sales',
      'payments',
      'priceMinor',
      'depositMinor',
      'marketingConsent',
      'phone',
    ])
      expect(body).not.toContain(`"${field}"`)
    expect(record.practitioner.staff).toEqual({
      id: 'staff-maya',
      name: 'Maya Lewis',
      role: expect.any(String),
    })
  })

  it('lets them welcome their own client and note their own client, and nothing else', async () => {
    const owner = await register('owner@example.invalid')
    const maya = await practitioner(owner, 'maya@example.invalid', 'staff-maya')
    const full = await studio(owner)
    const today = '2026-10-06'
    const ownVisit = full.appointments.find(
      (a) => a.staffId === 'staff-maya' && a.date === today && a.status === 'confirmed',
    )!
    const otherVisit = full.appointments.find(
      (a) => a.staffId !== 'staff-maya' && a.date === today && a.status === 'confirmed',
    )!
    const ownArrived = full.appointments.find(
      (a) => a.staffId === 'staff-maya' && a.status === 'arrived',
    )
    const servedClients = new Set(
      full.appointments.filter((a) => a.staffId === 'staff-maya').map((a) => a.clientId),
    )
    const stranger = full.clients.find((client) => !servedClients.has(client.id))!
    expect(ownVisit && otherVisit && stranger).toBeTruthy()
    let revision = full.revision

    const foreign = await run(maya, revision, { type: 'arrive', appointmentId: otherVisit.id })
    expect(foreign.statusCode).toBe(403)
    expect(foreign.json().error).toBe('This visit is not assigned to you.')
    const unknownNote = await run(maya, revision, {
      type: 'note',
      clientId: stranger.id,
      text: 'Not mine',
    })
    expect(unknownNote.statusCode).toBe(403)

    const arrived = await run(maya, revision, { type: 'arrive', appointmentId: ownVisit.id })
    expect(arrived.statusCode, arrived.body).toBe(200)
    const saved = arrived.json<{ view: string; practitioner: PractitionerView; state?: unknown }>()
    expect(saved.view).toBe('practitioner')
    expect(saved.state).toBeUndefined()
    expect(saved.practitioner.appointments.find((a) => a.id === ownVisit.id)?.status).toBe(
      'arrived',
    )
    revision = saved.practitioner.revision

    const note = await run(maya, revision, {
      type: 'note',
      clientId: ownVisit.clientId,
      text: 'Prefers a warm towel on arrival',
    })
    expect(note.statusCode, note.body).toBe(200)
    const noted = note.json<{ practitioner: PractitionerView }>().practitioner
    expect(noted.clients.find((c) => c.id === ownVisit.clientId)?.notes[0].detail).toBe(
      'Prefers a warm towel on arrival',
    )
    revision = noted.revision

    const forbidden: Command[] = [
      {
        type: 'checkout',
        appointmentId: ownArrived?.id ?? ownVisit.id,
        tipMinor: 0,
        method: 'demo_card',
      },
      { type: 'consent', clientId: ownVisit.clientId, consent: false },
      { type: 'cancel', appointmentId: ownVisit.id, reason: 'Not allowed' },
    ]
    for (const command of forbidden) {
      const response = await run(maya, revision, command)
      expect(response.statusCode, response.body).toBe(403)
    }
    expect((await studio(owner)).revision).toBe(revision)
    expect(
      (await run(maya, revision - 1, { type: 'note', clientId: ownVisit.clientId, text: 'Stale' }))
        .statusCode,
    ).toBe(409)
  })

  it('denies team, audit, messages and other studios', async () => {
    const owner = await register('owner@example.invalid')
    const maya = await practitioner(owner, 'maya@example.invalid', 'staff-maya')
    expect((await get(maya, '/team')).statusCode).toBe(403)
    expect((await get(maya, '/audit')).statusCode).toBe(403)
    expect((await post(maya, '/messages/send', {})).statusCode).toBe(403)
    expect(
      (await post(maya, '/invitations', { email: 'x@example.invalid', role: 'reception' }))
        .statusCode,
    ).toBe(403)
    const elsewhere = await register('second-owner@example.invalid')
    expect((await get({ ...maya, orgId: elsewhere.orgId })).statusCode).toBe(404)
    expect(
      (
        await run({ ...maya, orgId: elsewhere.orgId }, 0, {
          type: 'note',
          clientId: 'client-1',
          text: 'Foreign',
        })
      ).statusCode,
    ).toBe(404)
  })

  it('applies role changes and removal on the next request, including saved receipts', async () => {
    const owner = await register('owner@example.invalid')
    const maya = await practitioner(owner, 'maya@example.invalid', 'staff-maya')
    const full = await studio(owner)
    const client = full.appointments.find((a) => a.staffId === 'staff-maya')!.clientId
    const key = 'practitioner-note-replay'
    const change: Command = { type: 'note', clientId: client, text: 'A familiar rhythm' }
    expect((await run(maya, full.revision, change, key)).statusCode).toBe(200)
    expect(
      (await run(maya, full.revision, change, key)).json<{ replayed: boolean }>().replayed,
    ).toBe(true)
    const role = (payload: Record<string, unknown>) =>
      post(owner, '/membership', { accountId: maya.userId, ...payload })
    expect((await role({ role: 'practitioner' })).statusCode).toBe(422)
    expect((await role({ role: 'reception' })).statusCode).toBe(200)
    expect((await view(maya)).view).toBe('studio')
    expect((await role({ role: 'practitioner', staffId: 'staff-sophia' })).statusCode).toBe(200)
    const sophia = await view(maya)
    expect(sophia.practitioner.staff.id).toBe('staff-sophia')
    expect((await role({ role: 'remove' })).statusCode).toBe(200)
    expect((await get(maya)).statusCode).toBe(404)
    expect((await run(maya, full.revision, change, key)).statusCode).toBe(404)
  })
})

// Pocket view: the one extra field, a client's last completed visit with this practitioner.
describe('the previous visit in the practitioner view', () => {
  const today = '2026-10-06'
  function expected(full: BusinessState, staffId: string, clientId: string) {
    const last = full.appointments
      .filter(
        (a) =>
          a.staffId === staffId &&
          a.clientId === clientId &&
          a.status === 'completed' &&
          a.date < today,
      )
      .sort((a, b) => b.date.localeCompare(a.date) || b.startMinutes - a.startMinutes)[0]
    if (!last) return null
    const name = last.bookedServiceName ?? full.services.find((s) => s.id === last.serviceId)!.name
    return { date: last.date, serviceName: name }
  }

  it('is their own last completed visit with each served client, even beyond the window', async () => {
    const owner = await register('owner@example.invalid')
    const maya = await practitioner(owner, 'maya@example.invalid', 'staff-maya')
    const full = await studio(owner)
    const record = (await view(maya)).practitioner
    expect(record.clients.length).toBeGreaterThan(0)
    let beyondWindow = 0
    let otherMoreRecent = 0
    for (const client of record.clients) {
      expect(client.previousVisit).toEqual(expected(full, 'staff-maya', client.id))
      if (!client.previousVisit) continue
      expect(Object.keys(client.previousVisit).sort()).toEqual(['date', 'serviceName'])
      if (client.previousVisit.date < record.window.from) beyondWindow++
      // Another professional's more recent visit with the same client is never substituted.
      if (
        full.appointments.some(
          (a) =>
            a.clientId === client.id &&
            a.staffId !== 'staff-maya' &&
            a.status === 'completed' &&
            a.date < today &&
            a.date > client.previousVisit!.date,
        )
      )
        otherMoreRecent++
    }
    // The sample studio exercises both the reason the field exists and its boundary.
    expect(beyondWindow).toBeGreaterThan(0)
    expect(otherMoreRecent).toBeGreaterThan(0)
    // Clients Maya served only outside her window, or never served, still do not appear.
    const served = new Set(record.appointments.map((a) => a.clientId))
    expect(record.clients.every((c) => served.has(c.id))).toBe(true)
    const body = JSON.stringify(record)
    for (const client of full.clients)
      if (!served.has(client.id)) expect(body).not.toContain(`"${client.id}"`)
    for (const field of ['priceMinor', 'resourceId', 'saleId', 'staffId'])
      expect(body).not.toContain(`"${field}"`)
  })

  it('follows the linked professional and stays denied across studios and after removal', async () => {
    const owner = await register('owner@example.invalid')
    const maya = await practitioner(owner, 'maya@example.invalid', 'staff-maya')
    const full = await studio(owner)
    const elsewhere = await register('second-owner@example.invalid')
    const foreign = await get({ ...maya, orgId: elsewhere.orgId })
    expect(foreign.statusCode).toBe(404)
    expect(foreign.body).not.toContain('previousVisit')

    const role = (payload: Record<string, unknown>) =>
      post(owner, '/membership', { accountId: maya.userId, ...payload })
    expect((await role({ role: 'practitioner', staffId: 'staff-sophia' })).statusCode).toBe(200)
    const sophia = (await view(maya)).practitioner
    expect(sophia.clients.length).toBeGreaterThan(0)
    for (const client of sophia.clients)
      expect(client.previousVisit).toEqual(expected(full, 'staff-sophia', client.id))

    expect((await role({ role: 'remove' })).statusCode).toBe(200)
    const removed = await get(maya)
    expect(removed.statusCode).toBe(404)
    expect(removed.body).not.toContain('previousVisit')
  })
})
