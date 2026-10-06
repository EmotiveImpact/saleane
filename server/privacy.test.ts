// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApiHandler } from './app'
import type { ApiHandler, InjectResponse } from './app'
import type { BusinessState } from '../src/domain/model'
import type { ClientExport, StudioExport } from '../src/domain/privacy'

// LOCAL-03 acceptance: scoped exports and erasure review, by role, tenant and membership.
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
async function register(email: string, invitation?: string, studio = 'Reference Studio') {
  const response = await api.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: {
      name: email.split('@')[0],
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
const get = (login: Login, path: string, orgId = login.orgId) =>
  api.inject({ url: `/api/workspaces/${orgId}${path}`, headers: headers(login) })
const post = (login: Login, path: string, payload: unknown = {}, orgId = login.orgId) =>
  api.inject({
    method: 'POST',
    url: `/api/workspaces/${orgId}${path}`,
    headers: headers(login),
    payload,
  })
async function member(owner: Login, email: string, role: string, staffId?: string) {
  const invitation = await post(owner, '/invitations', { email, role, staffId })
  expect(invitation.statusCode, invitation.body).toBe(201)
  const login = await register(email, invitation.json<{ invitation: string }>().invitation)
  return { ...login, orgId: owner.orgId }
}
const auditActions = async (owner: Login) =>
  (await get(owner, '/audit')).json<{ events: { action: string; recordId: string }[] }>().events
const clientPath = (id = 'client-1') => `/privacy/clients/${id}`

describe('client data export (LOCAL-03)', () => {
  it('previews then exports for the owner and manager, and audits each export', async () => {
    const owner = await register('owner@example.invalid')
    const manager = await member(owner, 'manager@example.invalid', 'manager')
    const preview = await get(owner, `${clientPath()}/export`)
    expect(preview.statusCode, preview.body).toBe(200)
    expect(preview.json<{ preview: { excluded: string[] } }>().preview.excluded.length).toBe(5)
    // A preview reads only; nothing is audited until a file is produced.
    expect((await auditActions(owner)).some((e) => e.action === 'client.exported')).toBe(false)
    for (const login of [owner, manager]) {
      const response = await post(login, `${clientPath()}/export`)
      expect(response.statusCode, response.body).toBe(200)
      const file = response.json<{ export: ClientExport }>().export
      expect(file.subject.name).toBe('Amelia Carter')
      expect(file.generatedBy).toBe(login === owner ? 'owner' : 'manager')
    }
    const exported = (await auditActions(owner)).filter((e) => e.action === 'client.exported')
    expect(exported).toHaveLength(2)
    expect(exported.every((e) => e.recordId === 'client-1')).toBe(true)
  })

  it('never logs exported field contents in the audit table', async () => {
    const owner = await register('owner@example.invalid')
    await post(owner, `${clientPath()}/export`)
    const rows = api.database.all<Record<string, unknown>>('SELECT * FROM audit_events')
    const text = JSON.stringify(rows)
    expect(text).not.toContain('amelia')
    expect(text).not.toContain('Amelia')
    expect(text).not.toContain('+44')
  })

  it('refuses reception and practitioners, before revealing whether a client exists', async () => {
    const owner = await register('owner@example.invalid')
    const reception = await member(owner, 'desk@example.invalid', 'reception')
    const maya = await member(owner, 'maya@example.invalid', 'practitioner', 'staff-maya')
    for (const login of [reception, maya])
      for (const client of ['client-1', 'client-missing']) {
        expect((await get(login, `${clientPath(client)}/export`)).statusCode).toBe(403)
        expect((await post(login, `${clientPath(client)}/export`)).statusCode).toBe(403)
        expect((await get(login, `${clientPath(client)}/erasure`)).statusCode).toBe(403)
        expect((await post(login, `${clientPath(client)}/erasure`)).statusCode).toBe(403)
      }
    expect((await auditActions(owner)).some((e) => e.action === 'client.exported')).toBe(false)
  })

  it('keeps each studio’s clients to itself', async () => {
    const owner = await register('owner@example.invalid')
    const other = await register('other@example.invalid', undefined, 'Other Studio')
    expect((await get(other, `${clientPath()}/export`, owner.orgId)).statusCode).toBe(404)
    expect((await post(other, `${clientPath()}/export`, {}, owner.orgId)).statusCode).toBe(404)
    expect((await post(other, '/privacy/studio/export', {}, owner.orgId)).statusCode).toBe(404)
    // The other studio's own export holds only its own records.
    const own = (await post(other, '/privacy/studio/export')).json<{ export: StudioExport }>()
    expect(own.export.records.organisation.id).toBe(other.orgId)
    expect(JSON.stringify(own.export)).not.toContain(owner.orgId)
    expect((await get(owner, `${clientPath('client-unknown')}/export`)).statusCode).toBe(404)
  })

  it('denies a revoked member and a signed-out request', async () => {
    const owner = await register('owner@example.invalid')
    const manager = await member(owner, 'manager@example.invalid', 'manager')
    expect((await get(manager, `${clientPath()}/export`)).statusCode).toBe(200)
    const team = (await get(owner, '/team')).json<{ members: { id: string; role: string }[] }>()
    const accountId = team.members.find((m) => m.role === 'manager')!.id
    expect((await post(owner, '/membership', { accountId, role: 'remove' })).statusCode).toBe(200)
    expect((await get(manager, `${clientPath()}/export`)).statusCode).toBe(404)
    expect((await post(manager, `${clientPath()}/export`)).statusCode).toBe(404)
    const anonymous = await api.inject({
      method: 'POST',
      url: `/api/workspaces/${owner.orgId}${clientPath()}/export`,
      payload: {},
    })
    expect(anonymous.statusCode).toBe(401)
  })

  it('requires the session’s request token to produce a file', async () => {
    const owner = await register('owner@example.invalid')
    const response = await api.inject({
      method: 'POST',
      url: `/api/workspaces/${owner.orgId}${clientPath()}/export`,
      headers: { cookie: owner.cookie },
      payload: {},
    })
    expect(response.statusCode).toBe(403)
  })
})

describe('studio data export (LOCAL-03)', () => {
  it('is for the owner only and carries no credentials, tokens or holds', async () => {
    const owner = await register('owner@example.invalid')
    const manager = await member(owner, 'manager@example.invalid', 'manager')
    const reception = await member(owner, 'desk@example.invalid', 'reception')
    const maya = await member(owner, 'maya@example.invalid', 'practitioner', 'staff-maya')
    // A pending invitation and a public hold exist while the export is taken.
    const invited = await post(owner, '/invitations', {
      email: 'later@example.invalid',
      role: 'reception',
    })
    const slug = (await get(owner, '')).json<{ slug: string }>().slug
    const held = await api.inject({
      method: 'POST',
      url: `/api/public/${slug}/holds`,
      payload: {
        serviceId: 'service-facial',
        staffId: 'staff-maya',
        date: '2026-10-07',
        startMinutes: 540,
      },
    })
    expect(held.statusCode, held.body).toBe(201)
    for (const login of [manager, reception, maya]) {
      expect((await get(login, '/privacy/studio/export')).statusCode).toBe(403)
      expect((await post(login, '/privacy/studio/export')).statusCode).toBe(403)
    }
    const preview = await get(owner, '/privacy/studio/export')
    expect(preview.statusCode).toBe(200)
    const response = await post(owner, '/privacy/studio/export')
    expect(response.statusCode, response.body).toBe(200)
    const file = response.json<{ export: StudioExport }>().export
    const state = (await get(owner, '')).json<{ state: BusinessState }>().state
    expect(file.records.clients).toHaveLength(state.clients.length)
    expect(file.team.map((m) => m.role).sort()).toEqual([
      'manager',
      'owner',
      'practitioner',
      'reception',
    ])
    expect(file.team.find((m) => m.role === 'practitioner')!.professional).toBe('Maya Lewis')
    const text = JSON.stringify(file).toLowerCase()
    for (const secret of ['password', 'hash', 'token', 'csrf', 'scrypt', 'later@example.invalid'])
      expect(text).not.toContain(secret)
    expect(text).not.toContain(invited.json<{ invitation: string }>().invitation.toLowerCase())
    expect(text).not.toContain(held.json<{ hold: string }>().hold.toLowerCase())
    const hashes = api.database.all<{ password_hash: string }>('SELECT password_hash FROM accounts')
    for (const { password_hash } of hashes) expect(text).not.toContain(password_hash.toLowerCase())
    expect(file.records.appointments.some((a) => a.clientId === 'ephemeral-hold')).toBe(false)
    const audited = (await auditActions(owner)).filter((e) => e.action === 'studio.exported')
    expect(audited).toEqual([expect.objectContaining({ recordId: owner.orgId })])
  })
})

describe('erasure review (LOCAL-03)', () => {
  it('describes what could go and what must stay, and records a request without deleting', async () => {
    const owner = await register('owner@example.invalid')
    const before = (await get(owner, '')).json<{ state: BusinessState }>().state
    const review = await get(owner, `${clientPath()}/erasure`)
    expect(review.statusCode, review.body).toBe(200)
    const body = review.json<{
      review: { removable: unknown[]; kept: { label: string }[] }
      requests: unknown[]
    }>()
    expect(body.review.kept.map((k) => k.label)).toContain('Receipts')
    expect(body.requests).toEqual([])
    const recorded = await post(owner, `${clientPath()}/erasure`)
    expect(recorded.statusCode, recorded.body).toBe(201)
    expect(recorded.json<{ requests: { actor: string }[]; deleted: number }>()).toMatchObject({
      deleted: 0,
      requests: [{ actor: 'owner' }],
    })
    expect((await post(owner, `${clientPath()}/erasure`)).statusCode).toBe(409)
    const after = (await get(owner, '')).json<{ state: BusinessState }>().state
    expect(after).toEqual(before)
    expect(await auditActions(owner)).toContainEqual(
      expect.objectContaining({ action: 'client.erasure_requested', recordId: 'client-1' }),
    )
  })

  it('lets a manager record a request but not another studio', async () => {
    const owner = await register('owner@example.invalid')
    const manager = await member(owner, 'manager@example.invalid', 'manager')
    const other = await register('other@example.invalid', undefined, 'Other Studio')
    expect((await post(other, `${clientPath()}/erasure`, {}, owner.orgId)).statusCode).toBe(404)
    expect((await post(manager, `${clientPath()}/erasure`)).statusCode).toBe(201)
    expect((await post(manager, `${clientPath()}/erasure`, { note: 'x' })).statusCode).toBe(400)
  })
})
