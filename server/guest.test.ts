// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApiHandler } from './app'
import type { ApiHandler, InjectResponse } from './app'
import type { BusinessState } from '../src/domain/model'
import type { Command } from '../src/domain/commands'
import type { GuestView } from '../src/domain/guest'

// LOCAL-02 acceptance: a private link manages exactly one visit and nothing else.
const origin = 'http://127.0.0.1:5173'
const password = 'Fictional local account 2026!'
const contact = {
  name: 'Link Guest',
  email: 'link.guest@example.invalid',
  phone: '+44 7700 900222',
  marketingConsent: false,
}
const INVALID = 'This link has expired or been replaced. Ask the studio for a new one.'
type Login = { cookie: string; csrf: string; orgId: string }
type Manage = { url: string; expiresAt: string; delivery: string }
let api: ApiHandler
let clock: number

beforeEach(() => {
  // 9:00 on 7 October in London is 08:00Z, so the 24-hour cutoff is 08:00Z on 6 October.
  clock = Date.parse('2026-10-06T07:00:00.000Z')
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
async function book(slug: string, startMinutes = 540) {
  const held = await api.inject({
    method: 'POST',
    url: `/api/public/${slug}/holds`,
    payload: {
      serviceId: 'service-facial',
      staffId: 'staff-maya',
      date: '2026-10-07',
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
const cancel = (token: string, expected: string) =>
  api.inject({ method: 'POST', url: '/api/guest/cancel', payload: { token, expected } })
const desk = (login: Login, path: string, appointmentId: string) =>
  api.inject({
    method: 'POST',
    url: `/api/workspaces/${login.orgId}/guest-links${path}`,
    headers: headers(login),
    payload: { appointmentId },
  })
const run = (login: Login, revision: number, command: Command) =>
  api.inject({
    method: 'POST',
    url: `/api/workspaces/${login.orgId}/commands`,
    headers: { ...headers(login), 'idempotency-key': crypto.randomUUID() },
    payload: { revision, command },
  })
const invalid = (response: InjectResponse) => {
  expect(response.statusCode).toBe(404)
  expect(response.json().error).toBe(INVALID)
}

describe('guest manage links (LOCAL-02)', () => {
  it('issues a link at booking that shows one visit without any client record', async () => {
    const owner = await register()
    const { slug } = await studio(owner)
    const { appointmentId, manage } = await book(slug)
    expect(manage.url).toMatch(new RegExp(`^${origin}/manage#[A-Za-z0-9_-]{32,}$`))
    expect(manage.delivery).toBe('not_sent')
    const stored = api.database.all<{ token_hash: string }>('SELECT token_hash FROM guest_links')
    expect(stored).toHaveLength(1)
    expect(stored[0].token_hash).not.toBe(tokenOf(manage))
    const response = await visit(tokenOf(manage))
    expect(response.statusCode, response.body).toBe(200)
    const view = response.json<GuestView>()
    expect(view.visit).toMatchObject({ date: '2026-10-07', startMinutes: 540, status: 'confirmed' })
    expect(view.cancellation).toMatchObject({ available: true, outcome: 'refund_due' })
    expect(view.deposit.paidMinor).toBeGreaterThan(0)
    for (const secret of [contact.email, contact.phone, contact.name, appointmentId, 'clientId'])
      expect(response.body).not.toContain(secret)
    invalid(await visit('x'.repeat(43)))
  })

  it('refuses a broken, truncated or missing link exactly like an expired one', async () => {
    const owner = await register()
    const { slug } = await studio(owner)
    const { manage } = await book(slug)
    invalid(await visit('badtoken'))
    invalid(await visit(tokenOf(manage).slice(0, 20)))
    invalid(await visit(''))
    invalid(await api.inject({ method: 'POST', url: '/api/guest/visit', payload: {} }))
    invalid(await cancel('badtoken', 'refund_due'))
    // A whole link with something else wrong is still a form error, not a broken link.
    const extra = await api.inject({
      method: 'POST',
      url: '/api/guest/visit',
      payload: { token: tokenOf(manage), extra: true },
    })
    expect(extra.statusCode).toBe(400)
    expect((await visit(tokenOf(manage))).statusCode).toBe(200)
  })

  it('flags the deposit for refund before the cutoff, without making a refund, and replays', async () => {
    const owner = await register()
    const { slug } = await studio(owner)
    const { appointmentId, manage } = await book(slug)
    const before = await studio(owner)
    expect((await cancel(tokenOf(manage), 'retained')).statusCode).toBe(409)
    const done = await cancel(tokenOf(manage), 'refund_due')
    expect(done.statusCode, done.body).toBe(200)
    expect(done.json<GuestView>().visit.status).toBe('cancelled')
    const after = await studio(owner)
    expect(after.state.appointments.find((a) => a.id === appointmentId)?.status).toBe('cancelled')
    expect(after.state.payments).toEqual(before.state.payments)
    const event = after.state.events.at(-1)!
    expect(event.actor).toBe('Guest (private link)')
    expect(event.detail).toMatch(/flagged for refund under the 24-hour cancellation policy/)
    expect(event.detail).toMatch(/No refund has been made/)
    const replay = await cancel(tokenOf(manage), 'refund_due')
    expect(replay.statusCode).toBe(200)
    expect((await studio(owner)).state.revision).toBe(after.state.revision)
    expect(api.database.all("SELECT * FROM audit_events WHERE action='guest.cancel'")).toHaveLength(
      1,
    )
  })

  it('retains the deposit inside 24 hours and refuses once the visit has started', async () => {
    const owner = await register()
    const { slug } = await studio(owner)
    const { manage } = await book(slug)
    clock = Date.parse('2026-10-06T09:00:00.000Z')
    const view = (await visit(tokenOf(manage))).json<GuestView>()
    expect(view.cancellation.outcome).toBe('retained')
    const late = await cancel(tokenOf(manage), 'retained')
    expect(late.statusCode, late.body).toBe(200)
    expect((await studio(owner)).state.events.at(-1)?.detail).toMatch(/retained under the 24-hour/)

    const second = await book(slug, 660)
    clock = Date.parse('2026-10-07T10:30:00.000Z')
    const started = await cancel(tokenOf(second.manage), 'retained')
    expect(started.statusCode).toBe(409)
    expect((await visit(tokenOf(second.manage))).json<GuestView>().cancellation.available).toBe(
      false,
    )
    clock = Date.parse('2026-10-15T00:00:00.000Z')
    invalid(await visit(tokenOf(second.manage)))
  })

  it('lets the desk reissue or revoke links, and only the newest link works', async () => {
    const owner = await register()
    const { slug } = await studio(owner)
    const { appointmentId, manage } = await book(slug)
    const reissued = await desk(owner, '', appointmentId)
    expect(reissued.statusCode, reissued.body).toBe(201)
    expect(reissued.json<Manage>().delivery).toBe('not_sent')
    invalid(await visit(tokenOf(manage)))
    const fresh = tokenOf(reissued.json<Manage>())
    expect((await visit(fresh)).statusCode).toBe(200)
    expect((await desk(owner, '/revoke', appointmentId)).json()).toEqual({ revoked: 1 })
    invalid(await visit(fresh))
    invalid(await cancel(fresh, 'refund_due'))
    expect((await desk(owner, '', 'appointment-unknown')).statusCode).toBe(404)
    const other = await register('other@example.invalid')
    expect((await desk(other, '', appointmentId)).statusCode).toBe(404)
    const invitation = await api.inject({
      method: 'POST',
      url: `/api/workspaces/${owner.orgId}/invitations`,
      headers: headers(owner),
      payload: { email: 'maya@example.invalid', role: 'practitioner', staffId: 'staff-maya' },
    })
    const joined = await api.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        name: 'Maya Lewis',
        email: 'maya@example.invalid',
        password,
        invitation: invitation.json().invitation,
      },
    })
    const maya = {
      ...joined.json<{ csrf: string }>(),
      orgId: owner.orgId,
      cookie: String(joined.headers['set-cookie']).split(';')[0],
    }
    expect((await desk(maya, '', appointmentId)).statusCode).toBe(403)
  })

  it('gives a replayed booking a fresh link and follows desk changes to the visit', async () => {
    const owner = await register()
    const { slug } = await studio(owner)
    const first = await book(slug)
    const replay = await api.inject({
      method: 'POST',
      url: `/api/public/${slug}/book`,
      payload: first.payload,
    })
    expect(replay.json().appointmentId).toBe(first.appointmentId)
    invalid(await visit(tokenOf(first.manage)))
    const token = tokenOf(replay.json<{ manage: Manage }>().manage)
    const record = await studio(owner)
    const moved = await run(owner, record.state.revision, {
      type: 'reschedule',
      appointmentId: first.appointmentId,
      date: '2026-10-07',
      staffId: 'staff-maya',
      startMinutes: 720,
    })
    expect(moved.statusCode, moved.body).toBe(200)
    expect((await visit(token)).json<GuestView>().visit.startMinutes).toBe(720)
    const cancelled = await run(owner, record.state.revision + 1, {
      type: 'cancel',
      appointmentId: first.appointmentId,
      reason: 'Studio closed',
    })
    expect(cancelled.statusCode, cancelled.body).toBe(200)
    const view = (await visit(token)).json<GuestView>()
    expect(view.visit.status).toBe('cancelled')
    expect(view.cancellation.available).toBe(false)
  })
})
