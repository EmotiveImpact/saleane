// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApiHandler } from './app'
import type { ApiHandler } from './app'
import type { BusinessState } from '../src/domain/model'
import type { Command } from '../src/domain/commands'
import type { GuestView } from '../src/domain/guest'
import { openings } from '../src/domain/waitlist'

// V1.5: a guest asks to come in sooner from their own link. Only that link can join or leave;
// the desk adds, books and removes, and never sees more than the studio's own waitlist.
const origin = 'http://127.0.0.1:5173'
const password = 'Fictional local account 2026!'
const contact = {
  name: 'Link Guest',
  email: 'link.guest@example.invalid',
  phone: '+44 7700 900222',
  marketingConsent: false,
}
type Login = { cookie: string; csrf: string; orgId: string }
type Manage = { url: string; expiresAt: string; delivery: string }
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
async function book(slug: string, startMinutes = 540, date = '2026-10-06') {
  const held = await api.inject({
    method: 'POST',
    url: `/api/public/${slug}/holds`,
    payload: {
      serviceId: 'service-facial',
      staffId: 'staff-maya',
      date,
      startMinutes,
    },
  })
  expect(held.statusCode, held.body).toBe(201)
  const payload = { hold: held.json<{ hold: string }>().hold, contact, policy: true }
  const booked = await api.inject({ method: 'POST', url: `/api/public/${slug}/book`, payload })
  expect(booked.statusCode, booked.body).toBe(200)
  return { ...booked.json<{ appointmentId: string; manage: Manage }>(), payload }
}
const tokenOf = (manage: Manage) => manage.url.split('#')[1]
const visit = (token: string) =>
  api.inject({ method: 'POST', url: '/api/guest/visit', payload: { token } })
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
const waitlist = (token: string, extra: Record<string, unknown> = {}) =>
  api.inject({
    method: 'POST',
    url: '/api/guest/waitlist',
    payload: { token, join: true, anyone: false, times: ['morning'], ...extra },
  })

describe('guest waitlist', () => {
  it('lets a guest join, change and leave from their own link', async () => {
    const owner = await register()
    const { slug } = await studio(owner)
    const booked = await book(slug, 600, '2026-10-13')
    const token = tokenOf(booked.manage)
    expect((await visit(token)).json<GuestView>().waitlist).toEqual({ joined: null })

    const joined = await waitlist(token)
    expect(joined.statusCode, joined.body).toBe(200)
    expect(joined.json<GuestView>().waitlist).toEqual({
      joined: { anyone: false, times: ['morning'] },
    })
    const { state } = await studio(owner)
    const entry = state.waitlist!.find((e) => e.appointmentId === booked.appointmentId)!
    expect(entry).toMatchObject({
      source: 'guest',
      status: 'waiting',
      staffId: 'staff-maya',
      toDate: '2026-10-12',
    })
    // The same answer again saves nothing new.
    expect((await waitlist(token)).statusCode).toBe(200)
    expect((await studio(owner)).state.revision).toBe(state.revision)

    const changed = await waitlist(token, { anyone: true, times: [] })
    expect(changed.json<GuestView>().waitlist).toEqual({ joined: { anyone: true, times: [] } })
    const left = await waitlist(token, { join: false })
    expect(left.statusCode, left.body).toBe(200)
    expect(left.json<GuestView>().waitlist).toEqual({ joined: null })
    const after = (await studio(owner)).state.waitlist!.filter(
      (e) => e.appointmentId === booked.appointmentId,
    )
    expect(after.map((e) => e.status)).toEqual(['removed', 'removed'])
    // Leaving again (a retry) is accepted and records nothing new.
    const revision = (await studio(owner)).state.revision
    expect((await waitlist(token, { join: false })).statusCode).toBe(200)
    expect((await studio(owner)).state.revision).toBe(revision)
  })

  it('refuses a visit too soon, a bad request and staff acting for the guest', async () => {
    const owner = await register()
    const { slug } = await studio(owner)
    const today = await book(slug, 990)
    expect((await waitlist(tokenOf(today.manage))).statusCode).toBe(409)
    const later = await book(slug, 600, '2026-10-13')
    const token = tokenOf(later.manage)
    expect((await waitlist(token, { times: ['midnight'] })).statusCode).toBe(400)
    expect((await waitlist(token, { extra: true })).statusCode).toBe(400)
    expect((await waitlist('x'.repeat(40))).statusCode).toBe(404)
    const { state } = await studio(owner)
    const staff = await run(owner, state.revision, {
      type: 'waitlist-join',
      appointmentId: later.appointmentId,
      anyone: true,
      times: [],
    })
    expect(staff.statusCode).toBe(403)
  })

  it('lets reception add and book, but not a practitioner', async () => {
    const owner = await register()
    const reception = await member(owner, 'desk@example.invalid', 'reception')
    const practitioner = await member(owner, 'maya@example.invalid', 'practitioner', 'staff-maya')
    let { state } = await studio(owner)
    const input = {
      clientId: 'client-1',
      serviceId: 'service-cut',
      fromDate: '2026-10-07',
      toDate: '2026-10-10',
      times: [],
      note: '',
    }
    const denied = await run(practitioner, state.revision, { type: 'waitlist-add', input })
    expect(denied.statusCode).toBe(403)
    const added = await run(reception, state.revision, { type: 'waitlist-add', input })
    expect(added.statusCode, added.body).toBe(200)
    state = (await studio(owner)).state
    const entry = state.waitlist!.at(-1)!
    const booked = await run(reception, state.revision, {
      type: 'book',
      input: {
        clientId: 'client-1',
        serviceId: 'service-cut',
        staffId: 'staff-theo',
        date: '2026-10-07',
        startMinutes: 600,
        source: 'desk',
        waitlistId: entry.id,
      },
    })
    expect(booked.statusCode, booked.body).toBe(200)
    state = (await studio(owner)).state
    expect(state.waitlist!.find((e) => e.id === entry.id)!.status).toBe('booked')
  })

  it('will not offer a time another guest is holding while they book', async () => {
    const owner = await register()
    const { slug, state } = await studio(owner)
    const entry = state.waitlist!.find((e) => e.staffId === 'staff-maya')!
    const [first, second] = openings(state, entry, new Date(clock).toISOString())
    const held = await api.inject({
      method: 'POST',
      url: `/api/public/${slug}/holds`,
      payload: { serviceId: entry.serviceId, ...first },
    })
    expect(held.statusCode, held.body).toBe(201)
    const offer = (opening: typeof first) =>
      run(owner, state.revision, { type: 'waitlist-offer', entryId: entry.id, ...opening })
    expect((await offer(first)).statusCode).toBe(409)
    const ok = await offer(second)
    expect(ok.statusCode, ok.body).toBe(200)
    // A guest starts booking the offered time before the team approves the offer.
    const after = (await studio(owner)).state
    const messageId = after.waitlist!.find((e) => e.id === entry.id)!.offers!.at(-1)!.messageId
    const heldAgain = await api.inject({
      method: 'POST',
      url: `/api/public/${slug}/holds`,
      payload: { serviceId: entry.serviceId, ...second },
    })
    expect(heldAgain.statusCode, heldAgain.body).toBe(201)
    const approve = await run(owner, after.revision, { type: 'message-queue', messageId })
    expect(approve.statusCode).toBe(409)
  })
})
