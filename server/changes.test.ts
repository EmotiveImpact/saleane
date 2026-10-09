// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApiHandler } from './app'
import type { ApiHandler, InjectResponse } from './app'
import type { BusinessState } from '../src/domain/model'
import type { Command } from '../src/domain/commands'
import type { ChangeEntry } from '../src/domain/changeRecord'

// NEXT-05: who changed what, for the owner only.
const origin = 'http://127.0.0.1:5173'
const password = 'Fictional local account 2026!'
type Login = { cookie: string; csrf: string; orgId: string; userId: string }
type Page = { entries: ChangeEntry[]; next: string | null; people?: { id: string; name: string }[] }
let api: ApiHandler
// Late on 5 October in London, so a change the next morning falls on another of the studio's days.
let clock = Date.parse('2026-10-05T22:00:00.000Z')
beforeEach(() => {
  clock = Date.parse('2026-10-05T22:00:00.000Z')
  api = createApiHandler({ origin, databasePath: ':memory:', now: () => clock })
})
afterEach(() => api.close())

const headers = (login: Login) => ({ cookie: login.cookie, 'x-csrf-token': login.csrf })
const cookie = (response: InjectResponse) => String(response.headers['set-cookie']).split(';')[0]
async function register(email: string, name: string, invitation?: string) {
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
const studio = async (login: Login) => (await get(login)).json<{ state: BusinessState }>().state
async function ok(login: Login, command: Command) {
  const revision = (await studio(login)).revision
  const response = await post(
    login,
    '/commands',
    { revision, command },
    { 'idempotency-key': crypto.randomUUID() },
  )
  expect(response.statusCode, response.body).toBe(200)
}
async function member(owner: Login, email: string, name: string, role: string) {
  const invitation = await post(owner, '/invitations', { email, role })
  expect(invitation.statusCode, invitation.body).toBe(201)
  const login = await register(email, name, invitation.json<{ invitation: string }>().invitation)
  return { ...login, orgId: owner.orgId }
}
async function changes(login: Login, query = '') {
  const response = await get(login, `/changes${query}`)
  expect(response.statusCode, response.body).toBe(200)
  return response.json<Page>()
}
const minutes = (n: number) => (clock += n * 60000)

describe('who changed what (NEXT-05)', () => {
  it('shows the owner each change in words, newest first, and nobody else', async () => {
    const owner = await register('owner@example.invalid', 'Ada Owner')
    clock = Date.parse('2026-10-06T08:00:00.000Z')
    const facial = (await studio(owner)).services.find((s) => s.id === 'service-facial')!
    const input = facial
    await ok(owner, { type: 'service', id: facial.id, input: { ...input, priceMinor: 10500 } })
    minutes(5)
    const manager = await member(owner, 'manager@example.invalid', 'Max Manager', 'manager')
    minutes(5)
    await ok(manager, {
      type: 'reschedule',
      appointmentId: 'visit-noor',
      date: '2026-10-08',
      startMinutes: 900,
      staffId: 'staff-sophia',
    })
    const page = await changes(owner)
    expect(page.entries.map((e) => [e.who, e.what])).toEqual([
      ['Max Manager', 'Moved a visit'],
      ['Max Manager', 'Accepted an invitation and joined'],
      ['Ada Owner', 'Invited someone to sign in'],
      ['Ada Owner', 'Changed a treatment'],
      ['Ada Owner', 'Created the studio'],
    ])
    const [moved, , , priced] = page.entries
    expect(moved.about).toMatch(/Skin Renewal Facial, Thu 8 Oct at 15:00$/)
    expect(moved.lines).toEqual(
      expect.arrayContaining([
        { what: 'time', from: '11:00', to: '15:00' },
        { what: 'professional', from: 'Maya Lewis', to: 'Sophia Reed' },
      ]),
    )
    expect(priced).toMatchObject({
      about: 'Skin Renewal Facial',
      lines: [{ what: 'price', from: '£95.00', to: '£105.00' }],
      person: true,
    })
    expect(page.entries[2].lines).toEqual([{ what: 'access', to: 'Manager' }])
    expect(page.next).toBeNull()
    expect(page.people!.map((p) => p.name)).toEqual(['Ada Owner', 'Max Manager'])
    // Managers, the desk and practitioners never see it.
    const desk = await member(owner, 'desk@example.invalid', 'Rae Desk', 'reception')
    for (const login of [manager, desk]) {
      const refused = await get(login, '/changes')
      expect(refused.statusCode).toBe(403)
      expect(refused.json<{ error: string }>().error).toBe(
        'Only the owner can see who changed what.',
      )
    }
    expect((await post(owner, '/changes', {})).statusCode).toBe(405)
  })

  it('records an access change with the old and new access', async () => {
    const owner = await register('owner@example.invalid', 'Ada Owner')
    const manager = await member(owner, 'manager@example.invalid', 'Max Manager', 'manager')
    minutes(1)
    const changed = await post(owner, '/membership', {
      accountId: manager.userId,
      role: 'reception',
    })
    expect(changed.statusCode, changed.body).toBe(200)
    const [latest] = (await changes(owner)).entries
    expect(latest).toMatchObject({
      what: 'Changed someone’s access',
      about: 'Max Manager',
      lines: [{ what: 'access', from: 'Manager', to: 'Reception' }],
    })
  })

  it('never keeps what a client’s details say', async () => {
    const owner = await register('owner@example.invalid', 'Ada Owner')
    const client = (await studio(owner)).clients.find((c) => c.id === 'client-1')!
    await ok(owner, {
      type: 'client-edit',
      clientId: client.id,
      contact: {
        name: client.name,
        email: 'amelia.private@example.invalid',
        phone: '+44 7700 900456',
        marketingConsent: client.marketingConsent,
      },
      preferences: 'Allergic to lavender',
    })
    const row = api.database.get<{ detail: string }>(
      "SELECT detail FROM audit_events WHERE action='client-edit'",
    )!
    expect(row.detail).toContain('"email"')
    expect(row.detail).not.toMatch(/amelia\.private|900456|lavender/)
    const [latest] = (await changes(owner)).entries
    expect(latest).toMatchObject({
      about: 'Amelia Carter',
      lines: [],
      others: ['email', 'phone', 'preferences'],
    })
  })

  it('filters by person, kind and day, and pages back without repeats', async () => {
    const owner = await register('owner@example.invalid', 'Ada Owner')
    const manager = await member(owner, 'manager@example.invalid', 'Max Manager', 'manager')
    clock = Date.parse('2026-10-06T08:00:00.000Z')
    for (let n = 0; n < 55; n++) {
      minutes(1)
      await ok(n % 5 ? owner : manager, { type: 'note', clientId: 'client-1', text: `Note ${n}` })
    }
    // A guest's online booking has nobody signed in behind it.
    api.database.run(
      "INSERT INTO audit_events(id,organisation_id,actor_id,action,record_id,revision,occurred_at) VALUES('guest-1',?,NULL,'public.book','visit-noor',1,?)",
      owner.orgId,
      minutes(1),
    )
    const first = await changes(owner)
    expect(first.entries).toHaveLength(50)
    expect(first.entries[0]).toMatchObject({
      who: 'A guest booking online',
      person: false,
      what: 'Booked online',
    })
    const second = await changes(owner, `?before=${first.next}`)
    expect(second.people).toBeUndefined()
    const ids = [...first.entries, ...second.entries].map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
    // 55 notes, the booking, the studio, the invitation and the acceptance.
    expect(ids).toHaveLength(59)
    expect(second.next).toBeNull()

    const theirs = await changes(owner, `?who=${manager.userId}&limit=500`)
    expect(theirs.entries.map((e) => e.who)).toEqual(Array(12).fill('Max Manager'))
    const automatic = await changes(owner, '?who=automatic')
    expect(automatic.entries.map((e) => e.id)).toEqual(['guest-1'])
    const clients = await changes(owner, '?group=clients&limit=500')
    expect(clients.entries).toHaveLength(55)
    expect(clients.entries.every((e) => e.what === 'Added a note to a client')).toBe(true)
    const access = await changes(owner, '?group=access')
    expect(access.entries.map((e) => e.what)).toEqual([
      'Accepted an invitation and joined',
      'Invited someone to sign in',
    ])
    // The studio's own day: everything on 5 October, London time, and nothing after.
    const earlier = await changes(owner, '?on=2026-10-05')
    expect(earlier.entries.map((e) => e.what)).toEqual([
      'Accepted an invitation and joined',
      'Invited someone to sign in',
      'Created the studio',
    ])
    expect((await get(owner, '/changes?limit=501')).statusCode).toBe(400)
    expect((await get(owner, '/changes?group=everything')).statusCode).toBe(400)
    expect((await get(owner, '/changes?before=nonsense')).statusCode).toBe(400)
  })

  it('lets the privacy record ask for its own kinds, so busy days never push them out', async () => {
    const owner = await register('owner@example.invalid', 'Ada Owner')
    expect((await post(owner, '/privacy/clients/client-1/export', {})).statusCode).toBe(200)
    for (let n = 0; n < 3; n++) {
      minutes(1)
      await ok(owner, { type: 'note', clientId: 'client-1', text: `Note ${n}` })
    }
    const response = await get(owner, '/audit?actions=client.exported,studio.exported')
    expect(response.statusCode, response.body).toBe(200)
    expect(response.json<{ events: { action: string }[] }>().events.map((e) => e.action)).toEqual([
      'client.exported',
    ])
    expect(
      (await get(owner, '/audit')).json<{ events: unknown[] }>().events.length,
    ).toBeGreaterThan(4)
  })
})
