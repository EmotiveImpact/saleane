// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createApiHandler } from './app'
import type { ApiHandler, InjectResponse } from './app'
import type { BusinessState } from '../src/domain/model'
import type { Command } from '../src/domain/commands'
import type { ChangeEntry } from '../src/domain/changeRecord'
import { sampleWithRegulars } from '../src/domain/seed'
import { dueRecords, retentionRecord } from '../src/domain/retentionDue'

// Stage 6: deciding about records at the end of their keeping period, through the server. The
// sample with its regulars holds two clients long past their period, with feedback, a waitlist
// request and an unsent draft.
const origin = 'http://127.0.0.1:5173'
const password = 'Fictional local account 2026!'
type Login = { cookie: string; csrf: string; orgId: string }
let api: ApiHandler

beforeAll(() => sampleWithRegulars(true))
afterAll(() => sampleWithRegulars(false))
beforeEach(() => {
  api = createApiHandler({
    origin,
    databasePath: ':memory:',
    now: () => Date.parse('2026-10-06T08:00:00.000Z'),
    turnstile: null,
  })
})
afterEach(() => api.close())

const headers = (login: Login) => ({ cookie: login.cookie, 'x-csrf-token': login.csrf })
const cookie = (response: InjectResponse) => String(response.headers['set-cookie']).split(';')[0]
async function register(email: string, name: string, invitation?: string, studio = 'Reference') {
  const response = await api.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: {
      name,
      email,
      password,
      ...(invitation
        ? { invitation }
        : { workspace: { name: studio, locationName: 'London', region: 'UK', sample: true } }),
    },
  })
  expect(response.statusCode, response.body).toBe(201)
  return { ...response.json<{ csrf: string; orgId: string }>(), cookie: cookie(response) }
}
const get = (login: Login, path = '', orgId = login.orgId) =>
  api.inject({ url: `/api/workspaces/${orgId}${path}`, headers: headers(login) })
const post = (login: Login, path: string, payload: unknown, extra: Record<string, string> = {}) =>
  api.inject({
    method: 'POST',
    url: `/api/workspaces/${login.orgId}${path}`,
    headers: { ...headers(login), ...extra },
    payload,
  })
const studio = async (login: Login) => (await get(login)).json<{ state: BusinessState }>().state
const send = (
  login: Login,
  revision: number,
  command: Command,
  key: string = crypto.randomUUID(),
  orgId = login.orgId,
) =>
  api.inject({
    method: 'POST',
    url: `/api/workspaces/${orgId}/commands`,
    headers: { ...headers(login), 'idempotency-key': key },
    payload: { revision, command },
  })
async function member(owner: Login, email: string, name: string, role: string, extra = {}) {
  const invitation = await post(owner, '/invitations', { email, role, ...extra })
  expect(invitation.statusCode, invitation.body).toBe(201)
  const login = await register(email, name, invitation.json<{ invitation: string }>().invitation)
  return { ...login, orgId: owner.orgId }
}
const audits = (action: string) =>
  api.database.all<{ record_id: string; detail: string | null }>(
    'SELECT record_id,detail FROM audit_events WHERE action=?',
    action,
  )
const deleteClients = (ids = ['client-former-1', 'client-former-2']): Command => ({
  type: 'retention-delete',
  kind: 'client',
  ids,
})
const keep: Command = {
  type: 'retention-keep',
  kind: 'message',
  ids: ['message-former-2'],
  amount: 2,
  unit: 'years',
  reason: 'Checking the wording with the owner.',
}

describe('records at the end of their keeping period, through the server', () => {
  it('lets the owner and a manager decide, and records it in Who changed what', async () => {
    const owner = await register('owner@example.invalid', 'Ada Owner')
    const manager = await member(owner, 'bea@example.invalid', 'Bea Manager', 'manager')
    let state = await studio(owner)
    expect(dueRecords(state, '2026-10-06').map((g) => g.kind)).toEqual([
      'client',
      'feedback',
      'message',
      'waitlist',
    ])
    const kept = await send(manager, state.revision, keep)
    expect(kept.statusCode, kept.body).toBe(200)
    state = await studio(owner)
    expect(retentionRecord(state).kept[0]).toMatchObject({
      recordId: 'message-former-2',
      until: '2028-10-06',
      actor: 'Bea Manager',
    })
    const deleted = await send(owner, state.revision, deleteClients())
    expect(deleted.statusCode, deleted.body).toBe(200)
    state = await studio(owner)
    expect(state.clients.filter((c) => c.name === 'Former client').map((c) => c.id)).toEqual([
      'client-former-1',
      'client-former-2',
    ])
    // Their receipts are still there, and their kept message went with them.
    expect(
      state.sales.filter((s) => s.appointmentId.startsWith('history-client-former')),
    ).toHaveLength(2)
    expect(retentionRecord(state).kept).toEqual([])
    expect(dueRecords(state, '2026-10-06')).toEqual([])

    const changes = await get(owner, '/changes')
    expect(changes.statusCode, changes.body).toBe(200)
    const entries = changes.json<{ entries: ChangeEntry[] }>().entries
    const decision = entries.find((e) => e.what.startsWith('Approved deleting'))!
    expect(decision).toMatchObject({ who: 'Ada Owner', group: 'clients' })
    expect(decision.lines).toEqual([
      { what: 'records', to: 'client details' },
      { what: 'how many', to: '2' },
    ])
    const keeping = entries.find((e) => e.what.startsWith('Kept records'))!
    expect(keeping.who).toBe('Bea Manager')
    expect(keeping.lines).toContainEqual({ what: 'kept until', to: '6 October 2028' })
    // The record of the change keeps no names, no deleted ids and no typed reason.
    const stored = JSON.stringify(api.database.all('SELECT * FROM audit_events'))
    for (const word of ['Winifred', 'Gideon', 'client-former', 'Checking the wording'])
      expect(stored).not.toContain(word)
  })

  it('refuses reception, practitioners, general and regional managers, and changes nothing', async () => {
    const owner = await register('owner@example.invalid', 'Ada Owner')
    let state = await studio(owner)
    const main = state.organisation.locationId
    const desk = await member(owner, 'rae@example.invalid', 'Rae Desk', 'reception')
    const maya = await member(owner, 'maya@example.invalid', 'Maya Lewis', 'practitioner', {
      staffId: 'staff-maya',
    })
    const gia = await member(owner, 'gia@example.invalid', 'Gia General', 'general', {
      locationId: main,
    })
    const regionMade = await send(owner, state.revision, {
      type: 'region',
      input: { name: 'London', locationIds: [main] },
    } as Command)
    expect(regionMade.statusCode, regionMade.body).toBe(200)
    state = await studio(owner)
    const ari = await member(owner, 'ari@example.invalid', 'Ari Area', 'regional', {
      areaId: state.operations!.regions![0].id,
    })
    for (const login of [desk, maya, gia, ari])
      for (const command of [deleteClients(), keep]) {
        const refused = await send(login, state.revision, command)
        expect(refused.statusCode, refused.body).toBe(403)
        expect(refused.json<{ error: string }>().error).toBe('Your role cannot make this change.')
      }
    const after = await studio(owner)
    expect(after.revision).toBe(state.revision)
    expect(after.clients).toEqual(state.clients)
    expect(audits('retention-delete')).toHaveLength(0)
    expect(audits('retention-keep')).toHaveLength(0)
  })

  it('keeps each studio to itself', async () => {
    const owner = await register('owner@example.invalid', 'Ada Owner')
    const other = await register('other@example.invalid', 'Ola Other', undefined, 'Other')
    const state = await studio(owner)
    // Another studio's owner cannot reach this studio's records at all.
    const across = await send(other, state.revision, deleteClients(), undefined, owner.orgId)
    expect(across.statusCode).toBe(404)
    // In their own studio the same ids are their own sample's, decided only there.
    const own = await studio(other)
    const theirs = await send(other, own.revision, deleteClients())
    expect(theirs.statusCode, theirs.body).toBe(200)
    expect((await studio(owner)).clients.find((c) => c.id === 'client-former-1')!.name).toBe(
      'Winifred Ashby',
    )
  })

  it('never deletes twice: a repeat gives the same answer, a new request is refused', async () => {
    const owner = await register('owner@example.invalid', 'Ada Owner')
    const state = await studio(owner)
    const key = crypto.randomUUID()
    const first = await send(owner, state.revision, deleteClients(), key)
    expect(first.statusCode, first.body).toBe(200)
    const again = await send(owner, state.revision, deleteClients(), key)
    expect(again.statusCode, again.body).toBe(200)
    expect(again.json<{ recordId: string }>().recordId).toBe(
      first.json<{ recordId: string }>().recordId,
    )
    const fresh = await studio(owner)
    const twice = await send(owner, fresh.revision, deleteClients())
    expect(twice.statusCode).toBe(422)
    expect(twice.json<{ error: string }>().error).toMatch(/already been deleted/)
    expect(audits('retention-delete')).toHaveLength(1)
    // A record that is not due is refused, and so is the whole decision it is part of.
    const early = await send(owner, fresh.revision, {
      type: 'retention-delete',
      kind: 'client',
      ids: ['client-1'],
    })
    expect(early.statusCode).toBe(422)
    expect(early.json<{ error: string }>().error).toMatch(/not due/)
  })

  it('waits for a saved card to be removed, and stops a former client’s visit links', async () => {
    const owner = await register('owner@example.invalid', 'Ada Owner')
    const state = await studio(owner)
    api.database.run(
      `INSERT INTO saved_cards(id,organisation_id,client_id,provider,customer_ref,method_ref,brand,last4,exp_month,exp_year,agreed,created_at)
       VALUES('card-former',?,'client-former-1','test','test_customer','test_card','Visa','4242',12,2029,'Agreed',0)`,
      owner.orgId,
    )
    api.database.run(
      `INSERT INTO guest_links(token_hash,organisation_id,appointment_id,origin,created_at,expires_at)
       VALUES('hash-former',?,'history-client-former-2','desk',0,?)`,
      owner.orgId,
      Date.parse('2027-01-01T00:00:00Z'),
    )
    const held = await send(owner, state.revision, deleteClients())
    expect(held.statusCode).toBe(409)
    expect(held.json<{ error: string }>().error).toMatch(/card is still saved/)
    expect((await studio(owner)).revision).toBe(state.revision)
    // The other client goes ahead, and their visit link stops working.
    const one = await send(owner, state.revision, deleteClients(['client-former-2']))
    expect(one.statusCode, one.body).toBe(200)
    const link = api.database.get<{ revoked_at: number | null }>(
      "SELECT revoked_at FROM guest_links WHERE token_hash='hash-former'",
    )
    expect(link!.revoked_at).not.toBeNull()
  })
})
