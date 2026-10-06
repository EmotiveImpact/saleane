// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApiHandler } from './app'
import type { ApiHandler, InjectResponse } from './app'
import type { BusinessState } from '../src/domain/model'
import type { Command } from '../src/domain/commands'

const origin = 'http://127.0.0.1:5173'
const password = 'Fictional local account 2026!'
const contact = {
  name: 'New Guest',
  email: 'new.guest@example.invalid',
  phone: '+44 7700 900111',
  marketingConsent: false,
}
type Login = { cookie: string; csrf: string; orgId: string; userId: string }
type Workspace = { id: string; slug: string; state: BusinessState; role: string; today: string }
let api: ApiHandler
let clock: number
let temporaryDirectory: string | undefined

beforeEach(() => {
  clock = Date.parse('2026-10-06T08:00:00.000Z')
  api = createApiHandler({ origin, databasePath: ':memory:', now: () => clock })
})
afterEach(() => {
  api.close()
  if (temporaryDirectory) rmSync(temporaryDirectory, { recursive: true, force: true })
  temporaryDirectory = undefined
})
const headers = (login: Login) => ({ cookie: login.cookie, 'x-csrf-token': login.csrf })
function cookie(response: InjectResponse) {
  return String(response.headers['set-cookie']).split(';')[0]
}
async function register(
  email = 'owner@example.invalid',
  sample = true,
  invitation?: string,
): Promise<Login> {
  const response = await api.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: {
      name: 'Ada Owner',
      email,
      password,
      ...(invitation
        ? { invitation }
        : {
            workspace: { name: 'Reference Studio', locationName: 'London', region: 'UK', sample },
          }),
    },
  })
  expect(response.statusCode, response.body).toBe(201)
  const result = response.json<{ csrf: string; orgId: string }>()
  const login = { ...result, cookie: cookie(response), userId: '' }
  const session = await api.inject({ url: '/api/session', headers: headers(login) })
  login.userId = session.json<{ user: { id: string } }>().user.id
  return login
}
async function workspace(login: Login): Promise<Workspace> {
  const response = await api.inject({
    url: `/api/workspaces/${login.orgId}`,
    headers: headers(login),
  })
  expect(response.statusCode, response.body).toBe(200)
  return response.json<Workspace>()
}
async function command(
  login: Login,
  revision: number,
  change: Command,
  key: string = crypto.randomUUID(),
) {
  return api.inject({
    method: 'POST',
    url: `/api/workspaces/${login.orgId}/commands`,
    headers: { ...headers(login), 'idempotency-key': key },
    payload: { revision, command: change },
  })
}
async function invite(owner: Login, email: string, role = 'reception') {
  const response = await api.inject({
    method: 'POST',
    url: `/api/workspaces/${owner.orgId}/invitations`,
    headers: headers(owner),
    payload: { email, role },
  })
  expect(response.statusCode, response.body).toBe(201)
  return response.json<{ invitation: string; delivery: string; url: string }>()
}
async function hold(slug: string, staffId = 'staff-maya', startMinutes = 540) {
  return api.inject({
    method: 'POST',
    url: `/api/public/${slug}/holds`,
    payload: { serviceId: 'service-facial', staffId, date: '2026-10-07', startMinutes },
  })
}

describe('local sessions and request boundary', () => {
  it('persists salted passwords and hashed session tokens without exposing credentials', async () => {
    const response = await api.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        name: 'Ada Owner',
        email: 'ada@example.invalid',
        password,
        workspace: { name: 'Fresh Studio', region: 'UK', locationName: 'London' },
      },
    })
    expect(response.statusCode).toBe(201)
    expect(response.headers['set-cookie']).toContain('HttpOnly; SameSite=Strict')
    expect(response.headers['cache-control']).toBe('no-store')
    const token = cookie(response).split('=')[1]
    const account = api.database.get<{ password_hash: string }>(
      'SELECT password_hash FROM accounts',
    )!
    const storedSession = api.database.get<{ token_hash: string }>(
      'SELECT token_hash FROM sessions',
    )!
    expect(account.password_hash).toMatch(/^scrypt:32768:8:1:/)
    expect(account.password_hash).not.toContain(password)
    expect(storedSession.token_hash).not.toBe(token)
    const signedIn = await api.inject({
      url: '/api/session',
      headers: { cookie: cookie(response) },
    })
    expect(signedIn.statusCode).toBe(200)
    expect(signedIn.body).not.toContain('password_hash')
    expect(signedIn.body).not.toContain(storedSession.token_hash)
    expect(signedIn.json()).toMatchObject({
      localOnly: true,
      services: { email: false, payments: false },
    })
  })
  it('rejects anonymous reads, bad credentials and expired sessions, and revokes logout', async () => {
    expect((await api.inject({ url: '/api/session' })).statusCode).toBe(401)
    const owner = await register()
    expect(
      (
        await api.inject({
          method: 'POST',
          url: '/api/auth/login',
          payload: { email: 'owner@example.invalid', password: 'wrong password' },
        })
      ).statusCode,
    ).toBe(401)
    const second = await api.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'OWNER@example.invalid', password },
    })
    expect(second.statusCode).toBe(200)
    expect(cookie(second)).not.toBe(owner.cookie)
    const signedIn = {
      ...owner,
      cookie: cookie(second),
      csrf: second.json<{ csrf: string }>().csrf,
    }
    expect(
      (
        await api.inject({
          method: 'POST',
          url: '/api/auth/logout',
          headers: headers(signedIn),
          payload: {},
        })
      ).statusCode,
    ).toBe(200)
    expect((await api.inject({ url: '/api/session', headers: headers(signedIn) })).statusCode).toBe(
      401,
    )
    clock += 12 * 60 * 60000 + 1
    expect((await api.inject({ url: '/api/session', headers: headers(owner) })).statusCode).toBe(
      401,
    )
  })
  it('requires the configured Host, Origin, JSON and session CSRF for writes', async () => {
    const owner = await register()
    const request = {
      method: 'POST',
      url: `/api/workspaces/${owner.orgId}/commands`,
      payload: {
        revision: 0,
        command: { type: 'note', clientId: 'client-1', text: 'Quiet Tuesday' },
      },
    }
    expect(
      (
        await api.inject({
          ...request,
          headers: { ...headers(owner), origin: 'https://unrelated.invalid' },
        })
      ).statusCode,
    ).toBe(403)
    expect(
      (
        await api.inject({
          ...request,
          headers: { ...headers(owner), host: 'rebound.invalid:5173' },
        })
      ).statusCode,
    ).toBe(403)
    expect((await api.inject({ ...request, headers: { cookie: owner.cookie } })).statusCode).toBe(
      403,
    )
    expect(
      (
        await api.inject({
          ...request,
          headers: { ...headers(owner), 'x-csrf-token': 'é'.repeat(owner.csrf.length) },
        })
      ).statusCode,
    ).toBe(403)
    expect(
      (
        await api.inject({
          ...request,
          headers: { ...headers(owner), 'content-type': 'text/plain' },
        })
      ).statusCode,
    ).toBe(415)
    expect(
      (
        await api.inject({
          ...request,
          headers: { ...headers(owner), 'sec-fetch-site': 'cross-site' },
        })
      ).statusCode,
    ).toBe(403)
    expect((await workspace(owner)).state.revision).toBe(0)
  })
  it('bounds malformed/large bodies and repeated authentication attempts', async () => {
    const badAddress = await api.inject({ url: '/api/public/%E0' })
    expect(badAddress.statusCode).toBe(400)
    expect(badAddress.json().error).toBe('This address is not valid.')
    expect(
      (await api.inject({ method: 'POST', url: '/api/auth/login', rawPayload: '{broken' }))
        .statusCode,
    ).toBe(400)
    expect(
      (
        await api.inject({
          method: 'POST',
          url: '/api/auth/login',
          rawPayload: 'x'.repeat(64 * 1024 + 1),
        })
      ).statusCode,
    ).toBe(413)
    let last: InjectResponse | undefined
    for (let count = 0; count < 11; count++)
      last = await api.inject({ method: 'POST', url: '/api/auth/login', payload: {} })
    expect(last?.statusCode).toBe(429)
    expect(api.database.all('SELECT * FROM accounts')).toHaveLength(0)
  })
  it('rotates all sessions after a password change and requires the current password', async () => {
    const owner = await register()
    const request = {
      method: 'POST',
      url: '/api/auth/password',
      headers: headers(owner),
      payload: { current: 'incorrect', password: 'New fictional password 2026!' },
    }
    expect((await api.inject(request)).statusCode).toBe(403)
    const changed = await api.inject({
      ...request,
      payload: { ...request.payload, current: password },
    })
    expect(changed.statusCode).toBe(200)
    expect((await api.inject({ url: '/api/session', headers: headers(owner) })).statusCode).toBe(
      401,
    )
    expect(
      (await api.inject({ url: '/api/session', headers: { cookie: cookie(changed) } })).statusCode,
    ).toBe(200)
  })
})

describe('tenant authority, durable commands and access', () => {
  it('starts a local business with an empty operating graph while sample tenants remain isolated', async () => {
    const fresh = await register('fresh@example.invalid', false)
    const sample = await register('sample@example.invalid')
    const empty = await workspace(fresh),
      fictional = await workspace(sample)
    expect(empty.state.operations?.mode).toBe('local')
    for (const key of [
      'clients',
      'appointments',
      'payments',
      'sales',
      'events',
      'relationships',
      'services',
      'staff',
      'resources',
    ] as const)
      expect(empty.state[key]).toEqual([])
    expect(fictional.state.clients).toHaveLength(15)
    expect(fictional.id).not.toBe(empty.id)
    expect(fictional.id).not.toBe('org-atelier-uk')
    expect(fictional.state.clients.every((client) => client.organisationId === fictional.id)).toBe(
      true,
    )
    expect(
      (await api.inject({ url: `/api/workspaces/${sample.orgId}`, headers: headers(fresh) }))
        .statusCode,
    ).toBe(404)
    expect(
      (
        await api.inject({
          method: 'POST',
          url: `/api/workspaces/${sample.orgId}/commands`,
          headers: { ...headers(fresh), 'idempotency-key': crypto.randomUUID() },
          payload: {
            revision: 0,
            command: { type: 'note', clientId: 'client-1', text: 'Foreign tenant attempt' },
          },
        })
      ).statusCode,
    ).toBe(404)
    expect(
      (await api.inject({ url: `/api/workspaces/${sample.orgId}/audit`, headers: headers(fresh) }))
        .statusCode,
    ).toBe(404)
  })
  it('creates one intent and one audit receipt on retries, rejects changed intent and stale revisions', async () => {
    const owner = await register(),
      key = crypto.randomUUID()
    const change: Command = { type: 'note', clientId: 'client-1', text: 'Quiet Tuesday preference' }
    const first = await command(owner, 0, change, key)
    expect(first.statusCode, first.body).toBe(200)
    const repeated = await command(owner, 0, change, key)
    expect(repeated.statusCode).toBe(200)
    expect(repeated.json()).toMatchObject({ replayed: true, recordId: first.json().recordId })
    expect(
      (await command(owner, 1, { ...change, text: 'Different request' }, key)).statusCode,
    ).toBe(409)
    expect((await command(owner, 0, change)).statusCode).toBe(409)
    const state = (await workspace(owner)).state
    expect(state.events.filter((event) => event.detail === change.text)).toHaveLength(1)
    expect(state.events.at(-1)?.actor).toBe('Ada Owner')
    expect(state.revision).toBe(1)
    expect(api.database.all('SELECT * FROM command_receipts')).toHaveLength(1)
    expect(api.database.all("SELECT * FROM audit_events WHERE action='note'")).toHaveLength(1)
    const failed = await command(owner, 1, {
      type: 'note',
      clientId: 'foreign-client',
      text: 'Invalid client',
    })
    expect(failed.statusCode).toBe(422)
    expect(api.database.all('SELECT * FROM command_receipts')).toHaveLength(1)
    expect((await workspace(owner)).state).toEqual(state)
  })
  it('serialises two competing writes with the same revision', async () => {
    const owner = await register()
    const results = await Promise.all([
      command(owner, 0, { type: 'client', contact }),
      command(owner, 0, {
        type: 'client',
        contact: { ...contact, email: 'second@example.invalid' },
      }),
    ])
    expect(results.map((result) => result.statusCode).sort()).toEqual([200, 409])
    const state = (await workspace(owner)).state
    expect(state.clients).toHaveLength(16)
    expect(state.revision).toBe(1)
    expect(api.database.all('SELECT * FROM command_receipts')).toHaveLength(1)
  })
  it('rejects unknown commands and missing idempotency without falling through to client creation', async () => {
    const owner = await register()
    const response = await api.inject({
      method: 'POST',
      url: `/api/workspaces/${owner.orgId}/commands`,
      headers: { ...headers(owner), 'idempotency-key': crypto.randomUUID() },
      payload: { revision: 0, command: { type: 'arbitrary-command', contact } },
    })
    expect(response.statusCode).toBe(400)
    const noKey = await api.inject({
      method: 'POST',
      url: `/api/workspaces/${owner.orgId}/commands`,
      headers: headers(owner),
      payload: {
        revision: 0,
        command: { type: 'note', clientId: 'client-1', text: 'Quiet Tuesday' },
      },
    })
    expect(noKey.statusCode).toBe(400)
    expect((await workspace(owner)).state.revision).toBe(0)
  })
  it('binds invitation acceptance to email, does not send it, enforces roles and removes access immediately', async () => {
    const owner = await register()
    const invitation = await invite(owner, 'reception@example.invalid')
    expect(invitation.delivery).toBe('not_sent')
    const wrong = await api.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        name: 'Wrong Guest',
        email: 'wrong@example.invalid',
        password,
        invitation: invitation.invitation,
      },
    })
    expect(wrong.statusCode).toBe(400)
    const member = await register('reception@example.invalid', false, invitation.invitation)
    expect((await workspace(member)).role).toBe('reception')
    expect(
      (await api.inject({ url: `/api/workspaces/${owner.orgId}/team`, headers: headers(member) }))
        .statusCode,
    ).toBe(403)
    expect(
      (await api.inject({ url: `/api/workspaces/${owner.orgId}/audit`, headers: headers(member) }))
        .statusCode,
    ).toBe(403)
    expect(
      (
        await command(member, 0, {
          type: 'tax',
          label: 'Unapproved',
          rateBps: 1000,
          inclusive: false,
        })
      ).statusCode,
    ).toBe(403)
    expect(
      (
        await command(member, 0, {
          type: 'note',
          clientId: 'client-1',
          text: 'Front desk preference',
        })
      ).statusCode,
    ).toBe(200)
    const attemptOwner = await api.inject({
      method: 'POST',
      url: `/api/workspaces/${owner.orgId}/membership`,
      headers: headers(owner),
      payload: { accountId: owner.userId, role: 'remove' },
    })
    expect(attemptOwner.statusCode).toBe(422)
    const removed = await api.inject({
      method: 'POST',
      url: `/api/workspaces/${owner.orgId}/membership`,
      headers: headers(owner),
      payload: { accountId: member.userId, role: 'remove' },
    })
    expect(removed.statusCode).toBe(200)
    expect(
      (await api.inject({ url: `/api/workspaces/${owner.orgId}`, headers: headers(member) }))
        .statusCode,
    ).toBe(404)
    const audit = await api.inject({
      url: `/api/workspaces/${owner.orgId}/audit`,
      headers: headers(owner),
    })
    expect(audit.statusCode).toBe(200)
    expect(audit.body).not.toContain(invitation.invitation)
    expect(audit.body).not.toContain(password)
    expect(
      audit.json<{ events: { action: string }[] }>().events.map((event) => event.action),
    ).toContain('membership.changed')
  })
  it('requires a professional for practitioner invitations and rejects a reused invitation', async () => {
    const owner = await register()
    const gated = await api.inject({
      method: 'POST',
      url: `/api/workspaces/${owner.orgId}/invitations`,
      headers: headers(owner),
      payload: { email: 'practitioner@example.invalid', role: 'practitioner' },
    })
    expect(gated.statusCode).toBe(422)
    const invitation = await invite(owner, 'team@example.invalid', 'manager')
    const member = await register('team@example.invalid', false, invitation.invitation)
    const reused = await api.inject({
      method: 'POST',
      url: '/api/invitations/accept',
      headers: headers(member),
      payload: { invitation: invitation.invitation },
    })
    expect(reused.statusCode).toBe(400)
    expect(api.database.all('SELECT * FROM memberships')).toHaveLength(2)
  })
  it('checks current membership and command permission before replaying a saved receipt', async () => {
    const owner = await register()
    const invitation = await invite(owner, 'manager@example.invalid', 'manager')
    const member = await register('manager@example.invalid', false, invitation.invitation)
    const change: Command = { type: 'resource', input: { name: 'Manager room', type: 'treatment' } }
    const key = 'manager-resource-replay'
    expect((await command(member, 0, change, key)).statusCode).toBe(200)
    const updateRole = (role: string) =>
      api.inject({
        method: 'POST',
        url: `/api/workspaces/${owner.orgId}/membership`,
        headers: headers(owner),
        payload: { accountId: member.userId, role },
      })
    expect((await updateRole('reception')).statusCode).toBe(200)
    expect((await command(member, 0, change, key)).statusCode).toBe(403)
    expect((await updateRole('remove')).statusCode).toBe(200)
    expect((await command(member, 0, change, key)).statusCode).toBe(404)
    expect((await workspace(owner)).state.revision).toBe(1)
    expect(api.database.all('SELECT * FROM command_receipts')).toHaveLength(1)
  })
  it('reopens a file database with state, membership, session and idempotent receipt intact', async () => {
    api.close()
    temporaryDirectory = mkdtempSync(join(tmpdir(), 'saleane-authority-test-'))
    const path = join(temporaryDirectory, 'authority.sqlite')
    api = createApiHandler({ origin, databasePath: path, now: () => clock })
    const owner = await register(),
      key = crypto.randomUUID()
    const change: Command = { type: 'note', clientId: 'client-1', text: 'Survives a local restart' }
    expect((await command(owner, 0, change, key)).statusCode).toBe(200)
    api.close()
    api = createApiHandler({ origin, databasePath: path, now: () => clock })
    expect((await api.inject({ url: '/api/session', headers: headers(owner) })).statusCode).toBe(
      200,
    )
    expect((await workspace(owner)).state.events.at(-1)?.detail).toBe(change.text)
    expect((await command(owner, 0, change, key)).json().replayed).toBe(true)
    expect(api.database.all('SELECT * FROM schema_migrations')).toHaveLength(1)
    expect(api.database.all('SELECT * FROM command_receipts')).toHaveLength(1)
  })
})

describe('public booking privacy and reservation races', () => {
  it('returns a booking DTO with no client, ledger, audit or relationship data', async () => {
    const owner = await register(),
      org = await workspace(owner)
    const result = await api.inject({ url: `/api/public/${org.slug}` })
    expect(result.statusCode).toBe(200)
    const data = result.json()
    expect(data).toMatchObject({
      sample: true,
      depositPolicy: 'simulated',
      paymentCollectionConfigured: false,
    })
    for (const key of [
      'clients',
      'appointments',
      'payments',
      'sales',
      'events',
      'relationships',
      'state',
    ])
      expect(data).not.toHaveProperty(key)
    expect(result.body).not.toContain('amelia.carter')
    expect(result.body).not.toContain(password)
    expect(
      (
        await api.inject({
          url: `/api/public/${org.slug}/availability?serviceId=service-facial&staffId=any&date=2026-10-07`,
        })
      ).json<{ times: number[] }>().times,
    ).toContain(540)
  })
  it('admits one named-staff hold, blocks conflicting desk booking, and allows capacity after expiry', async () => {
    const owner = await register(),
      org = await workspace(owner)
    const results = await Promise.all([hold(org.slug), hold(org.slug)])
    expect(results.map((result) => result.statusCode).sort()).toEqual([201, 409])
    const rejected = await command(owner, 0, {
      type: 'book',
      input: {
        serviceId: 'service-facial',
        staffId: 'staff-maya',
        date: '2026-10-07',
        startMinutes: 540,
        clientId: 'client-1',
        source: 'desk',
      },
    })
    expect(rejected.statusCode).toBe(409)
    expect((await workspace(owner)).state.revision).toBe(0)
    clock += 5 * 60000 + 1
    const replacement = await hold(org.slug)
    expect(replacement.statusCode).toBe(201)
    const old = results.find((result) => result.statusCode === 201)!.json<{ hold: string }>().hold
    expect(
      (
        await api.inject({
          method: 'POST',
          url: `/api/public/${org.slug}/book`,
          payload: { hold: old, contact, policy: true },
        })
      ).statusCode,
    ).toBe(409)
  })
  it('consumes a hold once, replays the same contact, and rejects foreign holds or altered contacts', async () => {
    const owner = await register(),
      org = await workspace(owner)
    const other = await register('other@example.invalid'),
      otherOrg = await workspace(other)
    const reservation = await hold(org.slug),
      held = reservation.json<{ hold: string }>().hold
    expect(
      (
        await api.inject({
          method: 'POST',
          url: `/api/public/${otherOrg.slug}/book`,
          payload: { hold: held, contact, policy: true },
        })
      ).statusCode,
    ).toBe(409)
    const requests = await Promise.all([
      api.inject({
        method: 'POST',
        url: `/api/public/${org.slug}/book`,
        payload: { hold: held, contact, policy: true },
      }),
      api.inject({
        method: 'POST',
        url: `/api/public/${org.slug}/book`,
        payload: { hold: held, contact, policy: true },
      }),
    ])
    expect(requests.every((result) => result.statusCode === 200)).toBe(true)
    expect(requests[0].json().appointmentId).toBe(requests[1].json().appointmentId)
    const state = (await workspace(owner)).state
    expect(state.clients.filter((client) => client.email === contact.email)).toHaveLength(1)
    expect(
      state.appointments.filter((appointment) => appointment.date === '2026-10-07'),
    ).toHaveLength(1)
    expect(state.clients.find((client) => client.email === contact.email)?.marketingConsent).toBe(
      false,
    )
    expect(state.events.at(-1)?.actor).toBe('Guest booking')
    expect(api.database.all("SELECT * FROM audit_events WHERE action='public.book'")).toHaveLength(
      1,
    )
    expect(
      (
        await api.inject({
          method: 'POST',
          url: `/api/public/${org.slug}/book`,
          payload: {
            hold: held,
            contact: { ...contact, email: 'altered@example.invalid' },
            policy: true,
          },
        })
      ).statusCode,
    ).toBe(409)
  })
  it('resolves no-preference across professionals without double reserving a shared resource', async () => {
    const owner = await register(),
      org = await workspace(owner)
    const first = await hold(org.slug, 'any'),
      second = await hold(org.slug, 'any'),
      third = await hold(org.slug, 'any')
    expect([first.statusCode, second.statusCode, third.statusCode]).toEqual([201, 201, 409])
    const stored = api.database
      .all<{ input: string }>('SELECT input FROM booking_holds')
      .map((row) => JSON.parse(row.input) as { resourceId: string; staffId: string })
    expect(new Set(stored.map((row) => row.resourceId)).size).toBe(2)
    expect(new Set(stored.map((row) => row.staffId)).size).toBe(2)
  })
  it('keeps the exact unreserved room when a desk booking and guest confirmation share a time', async () => {
    const owner = await register(),
      org = await workspace(owner)
    const reserved = await hold(org.slug)
    expect(reserved.statusCode).toBe(201)
    const desk = await command(owner, 0, {
      type: 'book',
      input: {
        serviceId: 'service-facial',
        staffId: 'staff-sophia',
        date: '2026-10-07',
        startMinutes: 540,
        clientId: 'client-1',
        source: 'desk',
      },
    })
    expect(desk.statusCode, desk.body).toBe(200)
    const deskAppointment = (await workspace(owner)).state.appointments.find(
      (row) => row.id === desk.json().recordId,
    )!
    expect(deskAppointment.resourceId).toBe('room-two')
    const guest = await api.inject({
      method: 'POST',
      url: `/api/public/${org.slug}/book`,
      payload: { hold: reserved.json().hold, contact, policy: true },
    })
    expect(guest.statusCode, guest.body).toBe(200)
    const simultaneous = (await workspace(owner)).state.appointments.filter(
      (row) => row.date === '2026-10-07' && row.startMinutes === 540,
    )
    expect(simultaneous).toHaveLength(2)
    expect(new Set(simultaneous.map((row) => row.resourceId)).size).toBe(2)
  })
  it('reschedules into the unreserved room while preserving the guest hold', async () => {
    const owner = await register(),
      org = await workspace(owner)
    const reserved = await hold(org.slug)
    const moved = await command(owner, 0, {
      type: 'reschedule',
      appointmentId: 'visit-noor',
      staffId: 'staff-sophia',
      date: '2026-10-07',
      startMinutes: 540,
    })
    expect(moved.statusCode, moved.body).toBe(200)
    expect(
      (await workspace(owner)).state.appointments.find((row) => row.id === 'visit-noor')
        ?.resourceId,
    ).toBe('room-two')
    expect(
      (
        await api.inject({
          method: 'POST',
          url: `/api/public/${org.slug}/book`,
          payload: { hold: reserved.json().hold, contact, policy: true },
        })
      ).statusCode,
    ).toBe(200)
  })
  it('rejects a changed service snapshot without creating guest or money records', async () => {
    const owner = await register(),
      org = await workspace(owner)
    const reserved = await hold(org.slug)
    const service = org.state.services.find((row) => row.id === 'service-facial')!
    // A catalogue edit cannot silently alter what a guest held.
    const changed = await command(owner, 0, {
      type: 'service',
      id: service.id,
      input: { ...service, resourceType: 'chair' },
    })
    expect(changed.statusCode, changed.body).toBe(200)
    const before = (await workspace(owner)).state
    const failed = await api.inject({
      method: 'POST',
      url: `/api/public/${org.slug}/book`,
      payload: { hold: reserved.json().hold, contact, policy: true },
    })
    expect(failed.statusCode).toBe(409)
    expect((await workspace(owner)).state).toEqual(before)
    expect(api.database.all("SELECT * FROM audit_events WHERE action='public.book'")).toEqual([])
  })
  it('releases only its own unconsumed hold and preserves a consumed confirmation receipt', async () => {
    const owner = await register(),
      org = await workspace(owner)
    const other = await register('other@example.invalid'),
      otherOrg = await workspace(other)
    const reserved = await hold(org.slug),
      raw = reserved.json<{ hold: string }>().hold
    const release = (slug: string) =>
      api.inject({
        method: 'POST',
        url: `/api/public/${slug}/holds/release`,
        payload: { hold: raw },
      })
    expect((await release(otherOrg.slug)).json()).toEqual({ released: false })
    expect((await release(org.slug)).json()).toEqual({ released: true })
    expect((await release(org.slug)).json()).toEqual({ released: false })
    expect(
      (
        await api.inject({
          method: 'POST',
          url: `/api/public/${org.slug}/book`,
          payload: { hold: raw, contact, policy: true },
        })
      ).statusCode,
    ).toBe(409)
    const replacement = await hold(org.slug),
      fresh = replacement.json().hold
    const book = () =>
      api.inject({
        method: 'POST',
        url: `/api/public/${org.slug}/book`,
        payload: { hold: fresh, contact, policy: true },
      })
    const booked = await book()
    expect(booked.statusCode).toBe(200)
    expect(
      (
        await api.inject({
          method: 'POST',
          url: `/api/public/${org.slug}/holds/release`,
          payload: { hold: fresh },
        })
      ).json(),
    ).toEqual({ released: false })
    clock += 6 * 60000
    expect((await book()).json()).toEqual({
      appointmentId: booked.json().appointmentId,
      replayed: true,
    })
    expect(
      (await workspace(owner)).state.appointments.filter((row) => row.date === '2026-10-07'),
    ).toHaveLength(1)
  })
  it('records local public booking without invented deposits or settlement and keeps live services unconfigured', async () => {
    const owner = await register('local@example.invalid', false)
    let revision = 0
    const resource = await command(owner, revision++, {
      type: 'resource',
      input: { name: 'Room One', type: 'treatment' },
    })
    expect(resource.statusCode, resource.body).toBe(200)
    const service = await command(owner, revision++, {
      type: 'service',
      input: {
        name: 'Restorative facial',
        description: 'A fictional service',
        category: 'Skin',
        durationMinutes: 60,
        bufferMinutes: 15,
        priceMinor: 9500,
        depositMinor: 2500,
        resourceType: 'treatment',
      },
    })
    expect(service.statusCode, service.body).toBe(200)
    const serviceId = service.json<{ recordId: string }>().recordId
    const person = await command(owner, revision, {
      type: 'staff',
      input: {
        name: 'Local professional',
        role: 'Facialist',
        serviceIds: [serviceId],
        tone: 'sage',
      },
    })
    expect(person.statusCode, person.body).toBe(200)
    const staffId = person.json<{ recordId: string }>().recordId
    const org = await workspace(owner)
    const catalogue = await api.inject({ url: `/api/public/${org.slug}` })
    expect(catalogue.json()).toMatchObject({ sample: false, depositPolicy: 'pay_at_studio' })
    expect(
      catalogue.json<{ services: { depositMinor: number }[] }>().services[0].depositMinor,
    ).toBe(0)
    const reservation = await api.inject({
      method: 'POST',
      url: `/api/public/${org.slug}/holds`,
      payload: { serviceId, staffId, date: '2026-10-07', startMinutes: 540 },
    })
    expect(reservation.statusCode, reservation.body).toBe(201)
    const booked = await api.inject({
      method: 'POST',
      url: `/api/public/${org.slug}/book`,
      payload: { hold: reservation.json().hold, contact, policy: true },
    })
    expect(booked.statusCode, booked.body).toBe(200)
    expect(booked.json()).toMatchObject({
      sample: false,
      depositPolicy: 'pay_at_studio',
      confirmation: 'local_only',
    })
    const state = (await workspace(owner)).state
    expect(state.appointments).toHaveLength(1)
    expect(state.payments).toEqual([])
    expect(state.sales).toEqual([])
    expect(
      (
        await api.inject({
          method: 'POST',
          url: `/api/workspaces/${org.id}/messages/send`,
          headers: headers(owner),
          payload: { id: 'not-sent' },
        })
      ).statusCode,
    ).toBe(503)
  })
})
