// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApiHandler } from './app'
import type { ApiHandler, InjectResponse } from './app'
import type { BusinessState } from '../src/domain/model'
import type { Command } from '../src/domain/commands'
import type { GuestView } from '../src/domain/guest'
import { GUEST_LINK_AFTER_VISIT_MS, GUEST_LINK_MAX_MS } from '../src/domain/guest'
import type { MessageProvider, OutgoingMessage } from './messaging/providers'

// A guest moves their own visit from their private link: free times only, booked terms kept,
// recorded and announced exactly like a move at the desk, and a retry never moves it twice.
const origin = 'http://127.0.0.1:5173'
const password = 'Fictional local account 2026!'
const contact = {
  name: 'Move Guest',
  email: 'move.guest@example.invalid',
  phone: '+44 7700 900555',
  marketingConsent: false,
}
const INVALID = 'This link has expired or been replaced. Ask the studio for a new one.'
type Login = { cookie: string; csrf: string; orgId: string }
type Manage = { url: string; expiresAt: string; delivery: string }
type MoveTimes = {
  days: { date: string; open: boolean }[]
  date: string
  anyone: boolean
  times: { startMinutes: number; staffId: string; professional: string }[]
}
const DAY = 24 * 60 * 60000
let api: ApiHandler
let clock: number
let sent: OutgoingMessage[]
let accepted = 0

function recording(channel: 'email' | 'sms'): MessageProvider {
  return {
    name: channel === 'email' ? 'postmark' : 'twilio',
    live: true,
    channel,
    send: async (message) => {
      sent.push(message)
      return { outcome: 'accepted', providerRef: `ref-${++accepted}` }
    },
  }
}
beforeEach(() => {
  // 07:00Z on 6 October is 08:00 in London, the sample studio's day. A 09:00 visit on the 7th
  // can be moved online until 08:00Z on the 6th, 24 hours before it.
  clock = Date.parse('2026-10-06T07:00:00.000Z')
  sent = []
  api = createApiHandler({
    origin,
    databasePath: ':memory:',
    now: () => clock,
    turnstile: null,
    providers: {
      email: recording('email'),
      sms: recording('sms'),
      receipt: () => null,
    },
  })
})
afterEach(() => api.close())

const headers = (login: Login) => ({ cookie: login.cookie, 'x-csrf-token': login.csrf })
async function register(email = 'owner@example.invalid', sample = true) {
  const response = await api.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: {
      name: 'Ada Owner',
      email,
      password,
      workspace: { name: 'Linden Studio', locationName: 'London', region: 'UK', sample },
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
async function hold(
  slug: string,
  startMinutes: number,
  date = '2026-10-07',
  staffId = 'staff-maya',
  serviceId = 'service-facial',
) {
  const held = await api.inject({
    method: 'POST',
    url: `/api/public/${slug}/holds`,
    payload: { serviceId, staffId, date, startMinutes },
  })
  expect(held.statusCode, held.body).toBe(201)
  return held.json<{ hold: string }>().hold
}
async function book(
  slug: string,
  startMinutes = 540,
  date = '2026-10-07',
  staffId = 'staff-maya',
  serviceId = 'service-facial',
) {
  const booked = await api.inject({
    method: 'POST',
    url: `/api/public/${slug}/book`,
    payload: {
      hold: await hold(slug, startMinutes, date, staffId, serviceId),
      contact,
      policy: true,
    },
  })
  expect(booked.statusCode, booked.body).toBe(200)
  const result = booked.json<{ appointmentId: string; manage: Manage }>()
  return { appointmentId: result.appointmentId, token: result.manage.url.split('#')[1] }
}
const visit = (token: string) =>
  api.inject({ method: 'POST', url: '/api/guest/visit', payload: { token } })
const times = (token: string, extra: Record<string, unknown> = {}) =>
  api.inject({ method: 'POST', url: '/api/guest/move-times', payload: { token, ...extra } })
const move = (
  token: string,
  target: { date: string; startMinutes: number; staffId?: string },
  requestKey: string = crypto.randomUUID(),
) =>
  api.inject({
    method: 'POST',
    url: '/api/guest/move',
    payload: { token, ...target, requestKey },
  })
const run = async (login: Login, command: Command) =>
  api.inject({
    method: 'POST',
    url: `/api/workspaces/${login.orgId}/commands`,
    headers: { ...headers(login), 'idempotency-key': crypto.randomUUID() },
    payload: { revision: (await studio(login)).state.revision, command },
  })
const refused = (response: InjectResponse, status: number, message: RegExp) => {
  expect(response.statusCode, response.body).toBe(status)
  expect(response.json<{ error: string }>().error).toMatch(message)
}
const starts = (response: InjectResponse) =>
  response.json<MoveTimes>().times.map((t) => t.startMinutes)

describe('guests moving their own visit', () => {
  it('offers the days ahead and the free times, with the same professional or anyone', async () => {
    const owner = await register()
    const { slug } = await studio(owner)
    const { token } = await book(slug)
    // Maya is booked from 10:30 to 11:45 (with resting time) by another guest.
    await book(slug, 630)
    expect((await visit(token)).json<GuestView>().move).toEqual({ available: true })

    const same = await times(token)
    expect(same.statusCode, same.body).toBe(200)
    const offer = same.json<MoveTimes>()
    // From the studio's today, for sixty days, opening on the visit's own day.
    expect(offer.days).toHaveLength(60)
    expect(offer.days[0]).toEqual({ date: '2026-10-06', open: true })
    expect(offer).toMatchObject({ date: '2026-10-07', anyone: false })
    // Never the visit's own time, never across the other guest's visit, never past closing.
    expect(starts(same)).not.toContain(540)
    expect(starts(same).slice(0, 3)).toEqual([555, 705, 720])
    expect(starts(same).at(-1)).toBe(1005)
    expect(offer.times.every((t) => t.staffId === 'staff-maya' && t.professional === 'Maya')).toBe(
      true,
    )

    // Anyone qualified fills the gap with Sophia; Maya keeps every time she is free.
    const anyone = (await times(token, { anyone: true })).json<MoveTimes>()
    expect(anyone.times.find((t) => t.startMinutes === 600)).toEqual({
      startMinutes: 600,
      staffId: 'staff-sophia',
      professional: 'Sophia',
    })
    expect(anyone.times.find((t) => t.startMinutes === 690)?.staffId).toBe('staff-sophia')
    expect(anyone.times.find((t) => t.startMinutes === 705)?.staffId).toBe('staff-maya')
    // Theo does not do facials, so he is never offered.
    expect(anyone.times.some((t) => t.staffId === 'staff-theo')).toBe(false)

    // A day the studio is closed reads as closed and offers nothing.
    const closed = await run(owner, {
      type: 'closure',
      input: { date: '2026-10-15', startMinutes: 0, endMinutes: 1440, reason: 'Staff training' },
    })
    expect(closed.statusCode, closed.body).toBe(200)
    const thursday = (await times(token, { date: '2026-10-15' })).json<MoveTimes>()
    expect(thursday.days.find((d) => d.date === '2026-10-15')).toEqual({
      date: '2026-10-15',
      open: false,
    })
    expect(thursday.times).toEqual([])
    refused(await times(token, { date: '2026-10-05' }), 409, /days shown/)
    refused(await times(token, { date: '2027-01-01' }), 409, /days shown/)
    expect((await times(token, { date: '7 October' })).statusCode).toBe(400)
    expect((await times(token, { extra: true })).statusCode).toBe(400)
  })

  it('never offers or takes a time another guest is holding on the booking page', async () => {
    const owner = await register()
    const { slug } = await studio(owner)
    const { token } = await book(slug)
    // Both rooms held at 14:00 on the 8th, one with Sophia, one with Maya.
    await hold(slug, 840, '2026-10-08', 'staff-sophia')
    await hold(slug, 840, '2026-10-08', 'staff-maya', 'service-restore')
    const offer = await times(token, { date: '2026-10-08', anyone: true })
    expect(starts(offer)).not.toContain(840)
    expect(starts(offer)).toContain(660)
    refused(await move(token, { date: '2026-10-08', startMinutes: 840 }), 409, /no longer free/)
  })

  it('moves the visit, keeps what was booked and records it like a move at the desk', async () => {
    const owner = await register()
    const { slug } = await studio(owner)
    const { appointmentId, token } = await book(slug)
    const before = await studio(owner)
    const booked = before.state.appointments.find((a) => a.id === appointmentId)!
    const key = crypto.randomUUID()
    const target = { date: '2026-10-27', startMinutes: 660, staffId: 'staff-sophia' }

    const moved = await move(token, target, key)
    expect(moved.statusCode, moved.body).toBe(200)
    const view = moved.json<GuestView>()
    expect(view.visit).toMatchObject({
      date: '2026-10-27',
      startMinutes: 660,
      professional: 'Sophia',
      status: 'confirmed',
      serviceName: 'Skin Renewal Facial',
    })
    // The new time sets the new cutoff: 24 hours before 11:00 GMT on the 27th.
    expect(view.cancellation.cutoffAt).toBe('2026-10-26T11:00:00.000Z')
    expect(view.deposit).toEqual({ paidMinor: 2500, simulated: true })

    const after = await studio(owner)
    const now = after.state.appointments.find((a) => a.id === appointmentId)!
    // Same visit, same booked terms; only the time, professional and room changed.
    expect(now).toEqual({
      ...booked,
      date: '2026-10-27',
      startMinutes: 660,
      staffId: 'staff-sophia',
      resourceId: now.resourceId,
    })
    expect(after.state.payments).toEqual(before.state.payments)
    expect(after.state.revision).toBe(before.state.revision + 1)
    const event = after.state.events.at(-1)!
    expect(event).toMatchObject({
      appointmentId,
      type: 'rescheduled',
      title: 'Appointment moved',
      actor: 'Guest (private link)',
      allocationChange: {
        from: { date: '2026-10-07', startMinutes: 540, staffId: 'staff-maya' },
        to: { date: '2026-10-27', startMinutes: 660, staffId: 'staff-sophia' },
      },
    })
    expect(event.detail).toMatch(/Booked service, price and deposit retained/)
    const audit = () =>
      api.database.all<{ record_id: string; actor_id: string | null }>(
        "SELECT record_id,actor_id FROM audit_events WHERE action='guest.move'",
      )
    expect(audit()).toEqual([{ record_id: appointmentId, actor_id: null }])

    // The link the guest used keeps working, and now lasts until a week after the new time.
    expect((await visit(token)).statusCode).toBe(200)
    const link = api.database.get<{ created_at: number; expires_at: number }>(
      'SELECT created_at,expires_at FROM guest_links WHERE appointment_id=? AND revoked_at IS NULL',
      appointmentId,
    )!
    expect(link.expires_at).toBe(
      Math.min(
        link.created_at + GUEST_LINK_MAX_MS,
        Date.parse('2026-10-27T11:00:00.000Z') + GUEST_LINK_AFTER_VISIT_MS,
      ),
    )
    clock = Date.parse('2026-10-26T10:00:00.000Z')
    expect((await visit(token)).statusCode).toBe(200)
    clock = Date.parse('2026-10-06T07:00:00.000Z')

    // The same request again (an answer that never arrived) changes nothing.
    const replay = await move(token, target, key)
    expect(replay.statusCode, replay.body).toBe(200)
    expect(replay.json<GuestView>().visit.startMinutes).toBe(660)
    expect((await studio(owner)).state.revision).toBe(after.state.revision)
    expect(audit()).toHaveLength(1)
    // The same key for another time is refused rather than guessed at.
    refused(
      await move(token, { date: '2026-10-28', startMinutes: 660 }, key),
      409,
      /already made for another time/,
    )
    // Once the desk has moved the visit again, a late retry never moves it back.
    const desk = await run(owner, {
      type: 'reschedule',
      appointmentId,
      staffId: 'staff-maya',
      date: '2026-10-29',
      startMinutes: 600,
    })
    expect(desk.statusCode, desk.body).toBe(200)
    const late = await move(token, target, key)
    expect(late.statusCode, late.body).toBe(200)
    expect(late.json<GuestView>().visit).toMatchObject({ date: '2026-10-29', startMinutes: 600 })
    expect(audit()).toHaveLength(1)
    // Asking for the time the visit already has records nothing.
    const same = await move(token, { date: '2026-10-29', startMinutes: 600 })
    expect(same.statusCode, same.body).toBe(200)
    expect(audit()).toHaveLength(1)
  })

  it('refuses times that are taken, outside opening hours or with someone unqualified', async () => {
    const owner = await register()
    const { slug } = await studio(owner)
    const { appointmentId, token } = await book(slug, 1005)
    await book(slug, 600, '2026-10-08')
    const taken = /no longer free/
    refused(await move(token, { date: '2026-10-08', startMinutes: 600 }), 409, taken)
    refused(await move(token, { date: '2026-10-08', startMinutes: 555 }), 409, taken)
    // Before opening, after closing, and with someone who does not do this treatment.
    refused(await move(token, { date: '2026-10-08', startMinutes: 480 }), 409, taken)
    refused(await move(token, { date: '2026-10-08', startMinutes: 1020 }), 409, taken)
    refused(
      await move(token, { date: '2026-10-08', startMinutes: 900, staffId: 'staff-theo' }),
      409,
      taken,
    )
    refused(
      await move(token, { date: '2026-10-08', startMinutes: 900, staffId: 'staff-unknown' }),
      409,
      taken,
    )
    // Nothing moved.
    const { state } = await studio(owner)
    expect(state.appointments.find((a) => a.id === appointmentId)).toMatchObject({
      date: '2026-10-07',
      startMinutes: 1005,
    })
    expect(api.database.all("SELECT * FROM audit_events WHERE action='guest.move'")).toEqual([])
  })

  it('refuses days before today, too far ahead or closed, and times already passed', async () => {
    const owner = await register()
    const { slug } = await studio(owner)
    const { appointmentId, token } = await book(slug, 1005)
    const days = /open days shown/
    refused(await move(token, { date: '2026-10-05', startMinutes: 600 }), 409, days)
    refused(await move(token, { date: '2026-12-05', startMinutes: 600 }), 409, days)
    const closed = await run(owner, {
      type: 'closure',
      input: { date: '2026-10-15', startMinutes: 0, endMinutes: 1440, reason: 'Staff training' },
    })
    expect(closed.statusCode, closed.body).toBe(200)
    refused(await move(token, { date: '2026-10-15', startMinutes: 600 }), 409, days)
    // Earlier today, once that time has passed.
    clock = Date.parse('2026-10-06T09:00:00.000Z')
    refused(await move(token, { date: '2026-10-06', startMinutes: 540 }), 409, /has passed/)
    const today = starts(await times(token, { date: '2026-10-06', anyone: true }))
    expect(today.length).toBeGreaterThan(0)
    expect(today.every((start) => start > 600)).toBe(true)
    // A malformed request is a form error, not a broken link.
    expect((await move(token, { date: '2026-10-08', startMinutes: 601.5 })).statusCode).toBe(400)
    expect(
      (
        await api.inject({
          method: 'POST',
          url: '/api/guest/move',
          payload: { token, date: '2026-10-08', startMinutes: 660, requestKey: 'short' },
        })
      ).statusCode,
    ).toBe(400)
    // Nothing moved.
    const { state } = await studio(owner)
    expect(state.appointments.find((a) => a.id === appointmentId)).toMatchObject({
      date: '2026-10-07',
      startMinutes: 1005,
    })
    expect(api.database.all("SELECT * FROM audit_events WHERE action='guest.move'")).toEqual([])
  })

  it('stops at the cutoff, when the studio is not booking online, and once a visit is over', async () => {
    const owner = await register()
    const { slug } = await studio(owner)
    const first = await book(slug)
    const later = await book(slug, 600, '2026-10-12')
    const target = { date: '2026-10-13', startMinutes: 660 }

    // Inside 24 hours of the visit it can no longer move online; the guest is told to call.
    clock = Date.parse('2026-10-06T08:00:00.000Z')
    expect((await visit(first.token)).json<GuestView>().move).toEqual({
      available: false,
      reason: 'cutoff',
    })
    refused(await times(first.token), 409, /less than 24 hours.*Contact the studio/)
    refused(await move(first.token, target), 409, /less than 24 hours/)
    clock = Date.parse('2026-10-06T07:00:00.000Z')

    // A studio that switched online booking off takes no moves online either.
    const { state } = await studio(owner)
    const off = await run(owner, {
      type: 'organisation',
      name: state.organisation.name,
      locationName: state.organisation.locationName,
      address: state.organisation.address,
      timeZone: state.organisation.timeZone,
      bookingEnabled: false,
    })
    expect(off.statusCode, off.body).toBe(200)
    expect((await visit(later.token)).json<GuestView>().move).toEqual({
      available: false,
      reason: 'off',
    })
    refused(await move(later.token, target), 409, /not taking changes online/)
    const on = await run(owner, {
      type: 'organisation',
      name: state.organisation.name,
      locationName: state.organisation.locationName,
      address: state.organisation.address,
      timeZone: state.organisation.timeZone,
      bookingEnabled: true,
    })
    expect(on.statusCode, on.body).toBe(200)

    // Cancelled: nothing to move, and the page offers booking again instead.
    const cancelled = await api.inject({
      method: 'POST',
      url: '/api/guest/cancel',
      payload: { token: later.token, expected: 'refund_due' },
    })
    expect(cancelled.statusCode, cancelled.body).toBe(200)
    const view = cancelled.json<GuestView>()
    expect(view.move).toBeUndefined()
    expect(view.bookAgain).toEqual({ path: `/book/${slug}?service=service-facial` })
    refused(await move(later.token, target), 409, /can no longer be moved online/)
    refused(await times(later.token), 409, /can no longer be moved online/)

    // Under way or over: the desk has welcomed the guest.
    const today = await book(slug, 990, '2026-10-06')
    clock = Date.parse('2026-10-06T15:40:00.000Z')
    const arrived = await run(owner, { type: 'arrive', appointmentId: today.appointmentId })
    expect(arrived.statusCode, arrived.body).toBe(200)
    refused(await move(today.token, target), 409, /can no longer be moved online/)
    const completed = await run(owner, {
      type: 'checkout',
      appointmentId: today.appointmentId,
      tipMinor: 0,
      method: 'demo_card',
    })
    expect(completed.statusCode, completed.body).toBe(200)
    expect((await visit(today.token)).json<GuestView>().move).toBeUndefined()
    refused(await move(today.token, target), 409, /can no longer be moved online/)
  })

  it('moves only the visit its own link belongs to', async () => {
    const owner = await register()
    const other = await register('other@example.invalid')
    const mine = await book((await studio(owner)).slug)
    const theirs = await book((await studio(other)).slug)
    const moved = await move(theirs.token, { date: '2026-10-08', startMinutes: 660 })
    expect(moved.statusCode, moved.body).toBe(200)
    // The other studio's link moved its own visit; this studio's record is untouched.
    const { state } = await studio(owner)
    expect(state.appointments.find((a) => a.id === mine.appointmentId)).toMatchObject({
      date: '2026-10-07',
      startMinutes: 540,
    })
    expect(state.appointments.some((a) => a.id === theirs.appointmentId)).toBe(false)
    expect(
      (await studio(other)).state.appointments.find((a) => a.id === theirs.appointmentId),
    ).toMatchObject({ date: '2026-10-08', startMinutes: 660 })
    // A replaced, broken or missing link moves nothing.
    const replaced = await api.inject({
      method: 'POST',
      url: `/api/workspaces/${owner.orgId}/guest-links`,
      headers: headers(owner),
      payload: { appointmentId: mine.appointmentId },
    })
    expect(replaced.statusCode, replaced.body).toBe(201)
    for (const token of [mine.token, 'badtoken', ''])
      refused(
        await move(token, { date: '2026-10-08', startMinutes: 720 }),
        404,
        new RegExp(INVALID),
      )
    refused(await times('x'.repeat(43)), 404, new RegExp(INVALID))
  })

  it('offers only days the link it came from still opens on', async () => {
    const owner = await register()
    const { slug } = await studio(owner)
    const { token } = await book(slug)
    // A link issued 100 days ago lives 20 more days at most, so later days are not offered.
    api.database.run('UPDATE guest_links SET created_at=?', clock - 100 * DAY)
    const offer = (await times(token)).json<MoveTimes>()
    expect(offer.days.at(-1)!.date).toBe('2026-10-24')
    refused(await move(token, { date: '2026-10-30', startMinutes: 660 }), 409, /open days shown/)
    expect((await move(token, { date: '2026-10-24', startMinutes: 660 })).statusCode).toBe(200)
  })

  it('keeps the guest link open for a visit the desk moves later', async () => {
    const owner = await register()
    const { slug } = await studio(owner)
    const { appointmentId, token } = await book(slug)
    const moved = await run(owner, {
      type: 'reschedule',
      appointmentId,
      staffId: 'staff-maya',
      date: '2026-11-03',
      startMinutes: 600,
    })
    expect(moved.statusCode, moved.body).toBe(200)
    const link = api.database.get<{ created_at: number; expires_at: number }>(
      'SELECT created_at,expires_at FROM guest_links WHERE appointment_id=? AND revoked_at IS NULL',
      appointmentId,
    )!
    expect(link.expires_at).toBe(
      Math.min(
        link.created_at + GUEST_LINK_MAX_MS,
        Date.parse('2026-11-03T10:00:00.000Z') + GUEST_LINK_AFTER_VISIT_MS,
      ),
    )
    // A day before the new time, long after the old one, the guest can still open their visit.
    clock = Date.parse('2026-11-02T10:00:00.000Z')
    expect((await visit(token)).json<GuestView>().visit.date).toBe('2026-11-03')
  })

  it('tells the guest about the new time, as a move at the desk does', async () => {
    const owner = await register('owner@example.invalid', false)
    const send = async (command: Command) => {
      const response = await run(owner, command)
      expect(response.statusCode, response.body).toBe(200)
      return response.json<{ recordId: string }>().recordId
    }
    await send({ type: 'resource', input: { name: 'Room One', type: 'treatment' } })
    const serviceId = await send({
      type: 'service',
      input: {
        name: 'Restorative facial',
        description: 'A fictional service',
        category: 'Skin',
        durationMinutes: 60,
        bufferMinutes: 15,
        priceMinor: 9500,
        depositMinor: 0,
        resourceType: 'treatment',
      },
    })
    const staffId = await send({
      type: 'staff',
      input: { name: 'Maya Lind', role: 'Facialist', serviceIds: [serviceId], tone: 'sage' },
    })
    const { slug } = await studio(owner)
    const { token } = await book(slug, 600, '2026-10-08', staffId, serviceId)
    await api.outbox.tick()
    expect(sent.map((m) => m.subject || 'sms').sort()).toEqual([
      'Your visit to Linden Studio is booked',
      'sms',
    ])
    sent = []
    const moved = await move(token, { date: '2026-10-09', startMinutes: 660 })
    expect(moved.statusCode, moved.body).toBe(200)
    await api.outbox.tick()
    expect(sent.map((m) => m.subject || 'sms').sort()).toEqual([
      'Your visit to Linden Studio has moved',
      'sms',
    ])
    expect(sent.find((m) => m.channel === 'email')!.body).toContain('Friday 9 October at 11:00')
    // The link in the message opens the moved visit, and the guest's own link still works.
    const link = /\/manage#([A-Za-z0-9_-]+)/.exec(sent.find((m) => m.channel === 'email')!.body)![1]
    for (const each of [link, token])
      expect((await visit(each)).json<GuestView>().visit.startMinutes).toBe(660)
  })
})
