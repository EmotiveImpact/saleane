// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApiHandler } from './app'
import type { ApiHandler, InjectResponse } from './app'
import type { BusinessState } from '../src/domain/model'
import type { Command } from '../src/domain/commands'
import type { GuestView } from '../src/domain/guest'

// Guest extras: notes, all-in price inputs and booking source reach guests narrowly.
const origin = 'http://127.0.0.1:5173'
const password = 'Fictional local account 2026!'
const contact = {
  name: 'Extras Guest',
  email: 'extras.guest@example.invalid',
  phone: '+44 7700 900444',
  marketingConsent: false,
}
type Login = { cookie: string; csrf: string; orgId: string }
let api: ApiHandler

beforeEach(() => {
  api = createApiHandler({
    origin,
    databasePath: ':memory:',
    now: () => Date.parse('2026-10-06T07:00:00.000Z'),
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
              name: 'Reference Studio',
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
async function member(owner: Login, email: string, role: 'manager' | 'reception') {
  const invitation = await api.inject({
    method: 'POST',
    url: `/api/workspaces/${owner.orgId}/invitations`,
    headers: headers(owner),
    payload: { email, role },
  })
  expect(invitation.statusCode, invitation.body).toBe(201)
  return {
    ...(await register(email, invitation.json<{ invitation: string }>().invitation)),
    orgId: owner.orgId,
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
async function book(slug: string, from?: unknown, date = '2026-10-07') {
  const held = await api.inject({
    method: 'POST',
    url: `/api/public/${slug}/holds`,
    payload: {
      serviceId: 'service-facial',
      staffId: 'staff-maya',
      date,
      startMinutes: 540,
    },
  })
  expect(held.statusCode, held.body).toBe(201)
  const booked = await api.inject({
    method: 'POST',
    url: `/api/public/${slug}/book`,
    payload: {
      hold: held.json<{ hold: string }>().hold,
      contact,
      policy: true,
      ...(from === undefined ? {} : { from }),
    },
  })
  expect(booked.statusCode, booked.body).toBe(200)
  return booked.json<{ appointmentId: string; manage: { url: string } }>()
}
const notes: Command = {
  type: 'guest-notes',
  arrivalNote: 'Ring the bell at the blue door. Allow ten minutes to settle in.',
  prepNotes: [{ serviceId: 'service-facial', note: 'Come with clean skin.' }],
}

describe('guest extras', () => {
  it('lets owners and managers save guest notes, and refuses reception', async () => {
    const owner = await register('owner@example.invalid')
    const manager = await member(owner, 'manager@example.invalid', 'manager')
    const reception = await member(owner, 'desk@example.invalid', 'reception')
    let { state } = await studio(owner)
    const refused = await run(reception, state.revision, notes)
    expect(refused.statusCode).toBe(403)
    const saved = await run(manager, state.revision, notes)
    expect(saved.statusCode, saved.body).toBe(200)
    state = (await studio(owner)).state
    expect(state.organisation.arrivalNote).toMatch(/^Ring the bell/)
    expect(state.services.find((s) => s.id === 'service-facial')?.prepNote).toBe(
      'Come with clean skin.',
    )
    const tooLong = await run(owner, state.revision, {
      type: 'guest-notes',
      arrivalNote: 'x'.repeat(401),
      prepNotes: [],
    })
    expect(tooLong.statusCode).toBe(400)
  })

  it('gives the booking page the notes and tax basis, and nothing private', async () => {
    const owner = await register('owner@example.invalid')
    const { slug, state } = await studio(owner)
    expect((await run(owner, state.revision, notes)).statusCode).toBe(200)
    const taxed = await run(owner, state.revision + 1, {
      type: 'tax',
      label: 'VAT',
      rateBps: 2000,
      inclusive: false,
    })
    expect(taxed.statusCode, taxed.body).toBe(200)
    await book(slug)
    const catalog = await api.inject({ url: `/api/public/${slug}` })
    expect(catalog.statusCode).toBe(200)
    const body = catalog.json<{
      organisation: { arrivalNote?: string }
      services: { id: string; prepNote?: string }[]
      tax: unknown
    }>()
    expect(body.organisation.arrivalNote).toMatch(/^Ring the bell/)
    expect(body.services.find((s) => s.id === 'service-facial')?.prepNote).toBe(
      'Come with clean skin.',
    )
    expect(body.tax).toEqual({ label: 'VAT', rateBps: 2000, inclusive: false })
    for (const secret of [contact.email, contact.name, contact.phone, 'clientId', 'payments'])
      expect(catalog.body).not.toContain(secret)
  })

  it('shows the guest only the notes, address and calendar UID added to their visit', async () => {
    const owner = await register('owner@example.invalid')
    const { slug, state } = await studio(owner)
    expect((await run(owner, state.revision, notes)).statusCode).toBe(200)
    const { appointmentId, manage } = await book(slug)
    const response = await api.inject({
      method: 'POST',
      url: '/api/guest/visit',
      payload: { token: manage.url.split('#')[1] },
    })
    expect(response.statusCode, response.body).toBe(200)
    const view = response.json<GuestView>()
    expect(Object.keys(view).sort()).toEqual([
      'arrival',
      'cancellation',
      'deposit',
      // Whether the guest can move the visit online, and why not; never other guests' times.
      'move',
      'organisation',
      'payment',
      'visit',
      // No "come in sooner?" for a visit the next day; see the waitlist tests for that answer.
    ])
    expect(Object.keys(view.organisation).sort()).toEqual([
      'address',
      'currency',
      'locale',
      'locationName',
      'name',
      'region',
      'timeZone',
    ])
    expect(Object.keys(view.visit).sort()).toEqual([
      'calendarUid',
      'date',
      'durationMinutes',
      'professional',
      'serviceName',
      'startMinutes',
      'status',
    ])
    expect(view.arrival).toEqual({
      studioNote: 'Ring the bell at the blue door. Allow ten minutes to settle in.',
      serviceNote: 'Come with clean skin.',
    })
    for (const secret of [contact.email, contact.phone, contact.name, appointmentId, 'clientId'])
      expect(response.body).not.toContain(secret)
    expect(response.body).not.toContain(manage.url.split('#')[1])
  })

  it('records a known booking source and ignores anything else', async () => {
    const owner = await register('owner@example.invalid')
    const { slug } = await studio(owner)
    const google = await book(slug, 'google', '2026-10-08')
    const instagram = await book(slug, 'Instagram', '2026-10-09')
    const unknown = await book(slug, 'facebook', '2026-10-13')
    const odd = await book(slug, { from: 'google' }, '2026-10-14')
    const none = await book(slug, undefined, '2026-10-15')
    const { state } = await studio(owner)
    const channel = (id: string) => state.appointments.find((a) => a.id === id)?.channel
    expect(channel(google.appointmentId)).toBe('google')
    expect(channel(instagram.appointmentId)).toBe('instagram')
    expect(channel(unknown.appointmentId)).toBeUndefined()
    expect(channel(odd.appointmentId)).toBeUndefined()
    expect(channel(none.appointmentId)).toBeUndefined()
    expect(
      state.events.find((e) => e.appointmentId === google.appointmentId && e.type === 'booked')
        ?.detail,
    ).toMatch(/Booked through your Google link\./)
  })
})
