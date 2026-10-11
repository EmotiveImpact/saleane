// @vitest-environment node
import { createHmac, generateKeyPairSync, sign } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApiHandler } from './app'
import type { ApiHandler } from './app'
import type { BusinessState } from '../src/domain/model'
import type { Command } from '../src/domain/commands'
import {
  postmarkProvider,
  providersFromEnv,
  testProvider,
  twilioProvider,
  twilioSignature,
} from './messaging/providers'
import type { MessageProvider, OutgoingMessage, Providers, SendResult } from './messaging/providers'
import type { OutboxRow } from './messaging/outbox'
import { emailPalette } from '../src/email/colours'

// PILOT-01 acceptance: confirmations and reminders go once, honestly labelled, never from samples.
const origin = 'http://127.0.0.1:5173'
const contact = {
  name: 'Rosa Guest',
  email: 'rosa.guest@example.invalid',
  phone: '+44 7700 900333',
  marketingConsent: false,
}
type Login = { cookie: string; csrf: string; orgId: string }
let api: ApiHandler
let clock: number
let sent: OutgoingMessage[]
let answer: (message: OutgoingMessage) => SendResult

function recording(channel: 'email' | 'sms'): MessageProvider {
  return {
    name: channel === 'email' ? 'postmark' : 'twilio',
    live: true,
    channel,
    send: async (message) => {
      // Account emails (NEXT-03) are tested in accountMail.test.ts.
      if (message.fromName === 'SALEANE') return { outcome: 'test' }
      sent.push(message)
      return answer(message)
    },
  }
}
function start(providers?: Providers) {
  api?.close()
  api = createApiHandler({
    origin,
    databasePath: ':memory:',
    now: () => clock,
    turnstile: null,
    providers: providers ?? {
      email: recording('email'),
      sms: recording('sms'),
      receipt: (provider, request) =>
        request.headers['x-test-signature'] === 'good'
          ? [{ provider, providerRef: request.body, delivered: !request.body.startsWith('bad') }]
          : null,
    },
  })
}
beforeEach(() => {
  // 07:00Z on 6 October is 08:00 in London.
  clock = Date.parse('2026-10-06T07:00:00.000Z')
  sent = []
  let n = 0
  answer = () => ({ outcome: 'accepted', providerRef: `ref-${++n}` })
  start()
})
afterEach(() => api.close())

const headers = (login: Login) => ({ cookie: login.cookie, 'x-csrf-token': login.csrf })
async function register(sample = false): Promise<Login> {
  const response = await api.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: {
      name: 'Ada Owner',
      email: 'owner@example.invalid',
      password: 'Fictional local account 2026!',
      workspace: { name: 'Linden Studio', locationName: 'London', region: 'UK', sample },
    },
  })
  expect(response.statusCode, response.body).toBe(201)
  return {
    ...response.json<{ csrf: string; orgId: string }>(),
    cookie: String(response.headers['set-cookie']).split(';')[0],
  }
}
const workspace = async (login: Login) =>
  (await api.inject({ url: `/api/workspaces/${login.orgId}`, headers: headers(login) })).json<{
    slug: string
    state: BusinessState
    deliveryConfigured: boolean
  }>()
async function signIn(login: Login) {
  const response = await api.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: 'owner@example.invalid', password: 'Fictional local account 2026!' },
  })
  expect(response.statusCode, response.body).toBe(200)
  login.csrf = response.json<{ csrf: string }>().csrf
  login.cookie = String(response.headers['set-cookie']).split(';')[0]
}
async function run(login: Login, command: Command) {
  const { state } = await workspace(login)
  const response = await api.inject({
    method: 'POST',
    url: `/api/workspaces/${login.orgId}/commands`,
    headers: { ...headers(login), 'idempotency-key': crypto.randomUUID() },
    payload: { revision: state.revision, command },
  })
  expect(response.statusCode, response.body).toBe(200)
  return response.json<{ recordId: string }>().recordId
}
async function localStudio() {
  const owner = await register()
  await run(owner, { type: 'resource', input: { name: 'Room One', type: 'treatment' } })
  const serviceId = await run(owner, {
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
  const staffId = await run(owner, {
    type: 'staff',
    input: { name: 'Maya Lind', role: 'Facialist', serviceIds: [serviceId], tone: 'sage' },
  })
  // A new studio takes online bookings once the owner switches them on.
  const { name, locationName, address, timeZone } = (await workspace(owner)).state.organisation
  await run(owner, {
    type: 'organisation',
    name,
    locationName,
    address,
    timeZone,
    bookingEnabled: true,
  })
  return { owner, serviceId, staffId, slug: (await workspace(owner)).slug }
}
async function book(
  slug: string,
  serviceId: string,
  staffId: string,
  date = '2026-10-08',
  guest = contact,
) {
  const held = await api.inject({
    method: 'POST',
    url: `/api/public/${slug}/holds`,
    payload: { serviceId, staffId, date, startMinutes: 600 },
  })
  expect(held.statusCode, held.body).toBe(201)
  const booked = await api.inject({
    method: 'POST',
    url: `/api/public/${slug}/book`,
    payload: {
      hold: held.json<{ hold: string }>().hold,
      contact: guest,
      policy: true,
      ...(guest.marketingConsent ? { emailNewsVersion: 1 } : {}),
    },
  })
  expect(booked.statusCode, booked.body).toBe(200)
  return booked.json<{ appointmentId: string; manage: { url: string } }>()
}
/** Guests usually come back for this treatment after six weeks. */
async function withReturnWeeks(owner: Login, serviceId: string) {
  const { state } = await workspace(owner)
  const service = state.services.find((x) => x.id === serviceId)!
  const input = Object.fromEntries(
    Object.entries(service).filter(([key]) => key !== 'id' && key !== 'organisationId'),
  ) as Omit<typeof service, 'id' | 'organisationId'>
  await run(owner, { type: 'service', id: serviceId, input: { ...input, returnWeeks: 6 } })
}
const rows = () => api.database.all<OutboxRow>('SELECT * FROM outbox ORDER BY created_at,channel')
const outbox = (login: Login, query = '') =>
  api.inject({ url: `/api/workspaces/${login.orgId}/outbox${query}`, headers: headers(login) })

describe('appointment messages (PILOT-01)', () => {
  it('confirms a new booking once by email and text, with a working private link', async () => {
    const { serviceId, staffId, slug, owner } = await localStudio()
    const { manage } = await book(slug, serviceId, staffId)
    await api.outbox.tick()
    await api.outbox.tick()
    expect(sent.map((m) => m.channel).sort()).toEqual(['email', 'sms'])
    const email = sent.find((m) => m.channel === 'email')!
    expect(email.to).toBe(contact.email)
    expect(email.subject).toBe('Your visit to Linden Studio is booked')
    expect(email.body).toContain('Restorative facial with Maya')
    expect(email.body).toContain('Thursday 8 October at 10:00')
    expect(sent.find((m) => m.channel === 'sms')!.to).toBe('+447700900333')
    // Each message carries its own link, and the booking page link keeps working too.
    const link = /\/manage#([A-Za-z0-9_-]+)/.exec(email.body)![1]
    for (const token of [link, manage.url.split('#')[1]])
      expect(
        (await api.inject({ method: 'POST', url: '/api/guest/visit', payload: { token } }))
          .statusCode,
      ).toBe(200)
    expect(rows().map((r) => r.status)).toEqual(['accepted', 'accepted'])
    // The stored message never contains the private link.
    expect(rows().every((r) => r.body.includes('{{manage_link}}'))).toBe(true)
    const listed = await outbox(owner)
    expect(listed.statusCode).toBe(200)
    expect(listed.body).not.toContain(link)
    expect(listed.json<{ messages: { status: string }[] }>().messages).toHaveLength(2)
  })

  it('reminds the day before, once, and tells the guest when a visit moves or is cancelled', async () => {
    const { serviceId, staffId, slug, owner } = await localStudio()
    const { appointmentId } = await book(slug, serviceId, staffId)
    await api.outbox.tick()
    sent = []
    clock = Date.parse('2026-10-07T08:30:00.000Z') // 25.5 hours before 10:00 BST on the 8th
    await api.outbox.tick()
    expect(sent).toEqual([])
    clock = Date.parse('2026-10-07T09:30:00.000Z')
    await api.outbox.tick()
    await api.outbox.tick()
    expect(sent.map((m) => m.subject || m.channel).sort()).toEqual([
      'See you soon at Linden Studio',
      'sms',
    ])
    sent = []
    await signIn(owner)
    await run(owner, {
      type: 'reschedule',
      appointmentId,
      staffId,
      date: '2026-10-09',
      startMinutes: 660,
    })
    await api.outbox.tick()
    expect(sent.map((m) => m.subject || 'sms').sort()).toEqual([
      'Your visit to Linden Studio has moved',
      'sms',
    ])
    sent = []
    await run(owner, { type: 'cancel', appointmentId, reason: 'Guest called to cancel' })
    await api.outbox.tick()
    expect(sent.map((m) => m.subject || 'sms').sort()).toEqual([
      'Your visit to Linden Studio is cancelled',
      'sms',
    ])
    expect(sent.every((m) => !m.body.includes('/manage#'))).toBe(true)
    sent = []
    await api.outbox.tick()
    expect(sent).toEqual([])
  })

  it('never sends from a sample studio, and respects studio and client choices', async () => {
    const sampleOwner = await register(true)
    const sample = await workspace(sampleOwner)
    await book(sample.slug, 'service-facial', 'staff-maya')
    await api.outbox.tick()
    expect(sent).toEqual([])
    expect(rows()).toEqual([])

    start()
    const { owner, serviceId, staffId, slug } = await localStudio()
    await run(owner, {
      type: 'reminders',
      settings: { confirmations: true, reminders: true, hoursBefore: 24, email: true, sms: false },
    })
    const { appointmentId } = await book(slug, serviceId, staffId)
    const { state } = await workspace(owner)
    const clientId = state.appointments.find((a) => a.id === appointmentId)!.clientId
    await run(owner, { type: 'contact-preferences', clientId, email: false, sms: true })
    await api.outbox.tick()
    expect(sent).toEqual([])
    const timeline = (await workspace(owner)).state.events.filter((e) => e.clientId === clientId)
    expect(timeline.map((e) => e.title)).toContain('Visit messages updated')
  })

  it('skips a message whose visit changed after it was planned', async () => {
    const { serviceId, staffId, slug, owner } = await localStudio()
    const { appointmentId } = await book(slug, serviceId, staffId)
    api.outbox.plan()
    await run(owner, { type: 'cancel', appointmentId, reason: 'Studio closed for the day' })
    await api.outbox.deliver()
    expect(sent).toEqual([])
    expect(rows().map((r) => [r.status, r.detail])).toEqual([
      ['skipped', 'The visit changed before this went out.'],
      ['skipped', 'The visit changed before this went out.'],
    ])
    // Nobody was told about it, so nobody is told it is off.
    await api.outbox.tick()
    expect(sent).toEqual([])
  })

  it('asks a guest booked for a colour to come in for a patch test, unless one is recorded first', async () => {
    const { serviceId, staffId, slug, owner } = await localStudio()
    await run(owner, {
      type: 'service',
      id: serviceId,
      input: {
        name: 'Restorative facial',
        description: 'A fictional service',
        category: 'Skin',
        durationMinutes: 60,
        bufferMinutes: 15,
        priceMinor: 9500,
        depositMinor: 0,
        resourceType: 'treatment',
        patchTest: true,
      },
    })
    const { appointmentId } = await book(slug, serviceId, staffId, '2026-10-12')
    api.outbox.plan()
    const planned = rows().filter((r) => r.kind === 'patch_test')
    expect(planned.map((r) => r.channel).sort()).toEqual(['email', 'sms'])
    expect(planned[0].body).toContain('needs a quick patch test at least 48 hours before')
    const { state } = await workspace(owner)
    const clientId = state.appointments.find((a) => a.id === appointmentId)!.clientId
    // A test recorded before the message goes out stops it.
    await run(owner, {
      type: 'patch-test',
      input: {
        clientId,
        testedAt: '2026-10-06T06:30:00.000Z',
        product: 'Gloss toner 7.1',
        staffId,
        notes: '',
      },
    })
    await api.outbox.deliver()
    expect(sent.map((m) => m.subject).filter((x) => x.includes('patch test'))).toEqual([])
    expect(
      rows()
        .filter((r) => r.kind === 'patch_test')
        .map((r) => r.detail),
    ).toEqual([
      'A patch test was recorded, or it was too late, before it went out.',
      'A patch test was recorded, or it was too late, before it went out.',
    ])
    // That test then shows a reaction, so the guest is asked again for a new one.
    const after = await workspace(owner)
    const patchTestId = after.state.patchTests!.find((t) => t.clientId === clientId)!.id
    await run(owner, { type: 'patch-test-result', patchTestId, outcome: 'reaction', notes: '' })
    api.outbox.plan()
    expect(
      rows()
        .filter((r) => r.kind === 'patch_test' && r.status === 'pending')
        .map((r) => r.channel)
        .sort(),
    ).toEqual(['email', 'sms'])
  })

  it('says the patch test rules as they are when the message goes out', async () => {
    const { serviceId, staffId, slug, owner } = await localStudio()
    await run(owner, {
      type: 'service',
      id: serviceId,
      input: {
        name: 'Restorative facial',
        description: 'A fictional service',
        category: 'Skin',
        durationMinutes: 60,
        bufferMinutes: 15,
        priceMinor: 9500,
        depositMinor: 0,
        resourceType: 'treatment',
        patchTest: true,
      },
    })
    await book(slug, serviceId, staffId, '2026-10-12')
    api.outbox.plan()
    await run(owner, {
      type: 'patch-test-settings',
      settings: { hoursBefore: 72, validMonths: 6, remind: true },
    })
    await api.outbox.deliver()
    const told = sent.filter(
      (m) => m.subject.includes('patch test') || m.body.includes('patch test'),
    )
    expect(told).toHaveLength(2)
    for (const m of told) expect(m.body).toContain('at least 72 hours before')
    // The record shows what was sent, not what was first queued.
    for (const r of rows().filter((r) => r.kind === 'patch_test'))
      expect(r.body).toContain('at least 72 hours before')
  })

  it('asks for private feedback once after checkout, and not once the guest has answered', async () => {
    const { serviceId, staffId, slug, owner } = await localStudio()
    const { appointmentId } = await book(slug, serviceId, staffId, '2026-10-06')
    await api.outbox.tick()
    await api.outbox.tick()
    clock = Date.parse('2026-10-06T10:05:00.000Z')
    await signIn(owner)
    await run(owner, { type: 'arrive', appointmentId })
    await run(owner, { type: 'checkout', appointmentId, tipMinor: 0, method: 'cash' })
    sent = []
    clock = Date.parse('2026-10-06T12:10:00.000Z')
    await api.outbox.tick()
    expect(sent.map((m) => [m.channel, m.subject])).toEqual([
      ['email', 'How was your visit to Linden Studio?'],
    ])
    const token = /\/manage#([A-Za-z0-9_-]+)/.exec(sent[0].body)![1]
    const answered = await api.inject({
      method: 'POST',
      url: '/api/guest/feedback',
      payload: { token, visitRating: 5, practitionerRating: 5, comment: '' },
    })
    expect(answered.statusCode, answered.body).toBe(200)
    sent = []
    await api.outbox.tick()
    expect(sent).toEqual([])
  })

  it('skips a feedback request the guest answered before it went out', async () => {
    const { serviceId, staffId, slug, owner } = await localStudio()
    const { appointmentId, manage } = await book(slug, serviceId, staffId, '2026-10-06')
    await api.outbox.tick()
    await api.outbox.tick()
    clock = Date.parse('2026-10-06T10:05:00.000Z')
    await signIn(owner)
    await run(owner, { type: 'arrive', appointmentId })
    await run(owner, { type: 'checkout', appointmentId, tipMinor: 0, method: 'cash' })
    clock = Date.parse('2026-10-06T12:10:00.000Z')
    api.outbox.plan()
    const answered = await api.inject({
      method: 'POST',
      url: '/api/guest/feedback',
      payload: {
        token: manage.url.split('#')[1],
        visitRating: 4,
        practitionerRating: 5,
        comment: '',
      },
    })
    expect(answered.statusCode, answered.body).toBe(200)
    sent = []
    await api.outbox.deliver()
    expect(sent).toEqual([])
    expect(rows().find((r) => r.kind === 'feedback')).toMatchObject({
      status: 'skipped',
      detail: 'Answered, turned off or too late before it went out.',
    })
  })

  it('skips a feedback request still waiting two days after checkout', async () => {
    const { serviceId, staffId, slug, owner } = await localStudio()
    const { appointmentId } = await book(slug, serviceId, staffId, '2026-10-06')
    await api.outbox.tick()
    await api.outbox.tick()
    clock = Date.parse('2026-10-06T10:05:00.000Z')
    await signIn(owner)
    await run(owner, { type: 'arrive', appointmentId })
    await run(owner, { type: 'checkout', appointmentId, tipMinor: 0, method: 'cash' })
    clock = Date.parse('2026-10-06T12:10:00.000Z')
    api.outbox.plan()
    sent = []
    clock = Date.parse('2026-10-08T12:10:00.000Z')
    await api.outbox.deliver()
    expect(sent).toEqual([])
    expect(rows().find((r) => r.kind === 'feedback')).toMatchObject({ status: 'skipped' })
  })

  it('emails aftercare advice soon after checkout, once, before the feedback request', async () => {
    const { serviceId, staffId, slug, owner } = await localStudio()
    await run(owner, {
      type: 'guest-notes',
      arrivalNote: '',
      prepNotes: [],
      aftercareNotes: [{ serviceId, note: 'Skip make-up for the rest of today.' }],
    })
    const { appointmentId } = await book(slug, serviceId, staffId, '2026-10-06')
    await api.outbox.tick()
    await api.outbox.tick()
    clock = Date.parse('2026-10-06T10:05:00.000Z')
    await signIn(owner)
    await run(owner, { type: 'arrive', appointmentId })
    await run(owner, { type: 'checkout', appointmentId, tipMinor: 0, method: 'cash' })
    sent = []
    await api.outbox.tick()
    expect(sent).toEqual([])
    clock = Date.parse('2026-10-06T10:40:00.000Z')
    await api.outbox.tick()
    expect(sent.map((m) => [m.channel, m.subject])).toEqual([
      ['email', 'Looking after your Restorative facial'],
    ])
    expect(sent[0].body).toContain('Skip make-up for the rest of today.')
    expect(sent[0].body).not.toContain('/manage#')
    sent = []
    clock = Date.parse('2026-10-06T12:10:00.000Z')
    await api.outbox.tick()
    expect(sent.map((m) => m.subject)).toEqual(['How was your visit to Linden Studio?'])
  })

  it('tells a guest who agreed to hear when they are due back, with the booking page link', async () => {
    const { serviceId, staffId, slug, owner } = await localStudio()
    await withReturnWeeks(owner, serviceId)
    const keen = { ...contact, marketingConsent: true }
    const { appointmentId } = await book(slug, serviceId, staffId, '2026-10-06', keen)
    await api.outbox.tick()
    await api.outbox.tick()
    clock = Date.parse('2026-10-06T10:05:00.000Z')
    await signIn(owner)
    await run(owner, { type: 'arrive', appointmentId })
    await run(owner, { type: 'checkout', appointmentId, tipMinor: 0, method: 'cash' })
    await api.outbox.tick()
    sent = []
    // 14 November, 10:00 in London: three days before the six weeks are up.
    clock = Date.parse('2026-11-14T10:00:00.000Z')
    await signIn(owner)
    await api.outbox.tick()
    expect(sent.map((m) => [m.channel, m.subject])).toEqual([
      ['email', 'Time for your next visit to Linden Studio?'],
    ])
    expect(sent[0].body).toContain(`Book when it suits you: ${origin}/book/${slug}`)
    expect(sent[0].body).not.toContain('{{')
    // NEXT-13: kept apart from visit messages, and the Sent list shows the address it went with.
    expect(sent[0].stream).toBe('broadcast')
    expect(sent[0].html).toContain(`href="${origin}/book/${slug}"`)
    const listed = (await outbox(owner)).json<{ messages: { kind: string; body: string }[] }>()
    const dueBack = listed.messages.find((m) => m.kind === 'due_back')!
    expect(dueBack.body).toContain(`Book when it suits you: ${origin}/book/${slug}`)
    expect(dueBack.body).not.toContain('{{')
    sent = []
    await api.outbox.tick()
    expect(sent).toEqual([])
  })

  it('sends a due back note to the email on file when it goes, not when it was planned', async () => {
    const { serviceId, staffId, slug, owner } = await localStudio()
    await withReturnWeeks(owner, serviceId)
    const keen = { ...contact, marketingConsent: true }
    const { appointmentId } = await book(slug, serviceId, staffId, '2026-10-06', keen)
    await api.outbox.tick()
    await api.outbox.tick()
    clock = Date.parse('2026-10-06T10:05:00.000Z')
    await signIn(owner)
    await run(owner, { type: 'arrive', appointmentId })
    await run(owner, { type: 'checkout', appointmentId, tipMinor: 0, method: 'cash' })
    await api.outbox.tick()
    clock = Date.parse('2026-11-14T10:00:00.000Z')
    await signIn(owner)
    api.outbox.plan()
    const { state } = await workspace(owner)
    const guest = state.clients.find((c) => c.email === keen.email)!
    await run(owner, {
      type: 'client-edit',
      clientId: guest.id,
      contact: { ...keen, email: 'rosa.new@example.invalid' },
      preferences: guest.preferences,
    })
    sent = []
    await api.outbox.deliver()
    expect(sent.map((m) => [m.subject, m.to])).toEqual([
      ['Time for your next visit to Linden Studio?', 'rosa.new@example.invalid'],
    ])
    expect(rows().find((r) => r.kind === 'due_back')?.recipient).toBe('rosa.new@example.invalid')
  })

  it('skips a due back note when the guest books before it goes', async () => {
    const { serviceId, staffId, slug, owner } = await localStudio()
    await withReturnWeeks(owner, serviceId)
    const keen = { ...contact, marketingConsent: true }
    const { appointmentId } = await book(slug, serviceId, staffId, '2026-10-06', keen)
    await api.outbox.tick()
    await api.outbox.tick()
    clock = Date.parse('2026-10-06T10:05:00.000Z')
    await signIn(owner)
    await run(owner, { type: 'arrive', appointmentId })
    await run(owner, { type: 'checkout', appointmentId, tipMinor: 0, method: 'cash' })
    await api.outbox.tick()
    clock = Date.parse('2026-11-14T10:00:00.000Z')
    api.outbox.plan()
    await book(slug, serviceId, staffId, '2026-11-18', keen)
    sent = []
    await api.outbox.deliver()
    expect(sent.map((m) => m.subject)).not.toContain('Time for your next visit to Linden Studio?')
    expect(rows().find((r) => r.kind === 'due_back')).toMatchObject({
      status: 'skipped',
      detail: 'Booked again, turned off or no longer agreed before it went out.',
    })
  })

  it('wishes a guest who agreed a happy birthday once, from no visit in particular', async () => {
    const { serviceId, staffId, slug, owner } = await localStudio()
    const keen = { ...contact, marketingConsent: true }
    await book(slug, serviceId, staffId, '2026-10-08', keen)
    await api.outbox.tick()
    const { state } = await workspace(owner)
    const guest = state.clients.find((c) => c.email === keen.email)!
    await run(owner, { type: 'client-birthday', clientId: guest.id, birthday: '10-07' })
    sent = []
    // 7 October, 09:30 in London.
    clock = Date.parse('2026-10-07T08:30:00.000Z')
    await signIn(owner)
    await api.outbox.tick()
    expect(sent.map((m) => [m.subject, m.to])).toEqual([
      ['Happy birthday from Linden Studio', keen.email],
    ])
    // Already booked for tomorrow, so simply a happy birthday with no invitation.
    expect(sent[0].body).toContain('We look forward to seeing you soon.')
    expect(sent[0].body).not.toContain('{{')
    expect(sent[0].stream).toBe('broadcast')
    expect(rows().find((r) => r.kind === 'birthday')).toMatchObject({
      appointment_id: '',
      client_id: guest.id,
      slot: '2026',
    })
    sent = []
    clock = Date.parse('2026-10-07T12:00:00.000Z')
    await api.outbox.tick()
    expect(sent.map((m) => m.subject)).not.toContain('Happy birthday from Linden Studio')
  })

  it('skips a we miss you note when the guest books before it goes', async () => {
    const { serviceId, staffId, slug, owner } = await localStudio()
    const keen = { ...contact, marketingConsent: true }
    const { appointmentId } = await book(slug, serviceId, staffId, '2026-10-06', keen)
    await api.outbox.tick()
    await api.outbox.tick()
    clock = Date.parse('2026-10-06T10:05:00.000Z')
    await signIn(owner)
    await run(owner, { type: 'arrive', appointmentId })
    await run(owner, { type: 'checkout', appointmentId, tipMinor: 0, method: 'cash' })
    await api.outbox.tick()
    // 6 January 2027, 10:00 in London: three months after the visit.
    clock = Date.parse('2027-01-06T10:00:00.000Z')
    api.outbox.plan()
    expect(rows().find((r) => r.kind === 'miss_you')).toMatchObject({ status: 'pending' })
    await book(slug, serviceId, staffId, '2027-01-12', keen)
    sent = []
    await api.outbox.deliver()
    expect(sent.map((m) => m.subject)).not.toContain('We miss you at Linden Studio')
    expect(rows().find((r) => r.kind === 'miss_you')).toMatchObject({
      status: 'skipped',
      detail: 'Turned off, booked again or no longer agreed before it went out.',
    })
  })

  it('retries a busy provider, stops at a refusal, and never resends an unclear one by itself', async () => {
    const { serviceId, staffId, slug, owner } = await localStudio()
    await book(slug, serviceId, staffId)
    answer = (m) =>
      m.channel === 'email'
        ? { outcome: 'failed', detail: 'Busy', retry: true }
        : { outcome: 'unknown', detail: 'Connection dropped' }
    await api.outbox.tick()
    expect(rows().map((r) => r.status)).toEqual(['pending', 'unknown'])
    clock += 61000
    await api.outbox.tick()
    clock += 5 * 60000 + 1000
    await api.outbox.tick()
    clock += 60 * 60000
    await api.outbox.tick()
    expect(sent.filter((m) => m.channel === 'email')).toHaveLength(3)
    expect(sent.filter((m) => m.channel === 'sms')).toHaveLength(1)
    expect(rows().map((r) => r.status)).toEqual(['failed', 'unknown'])
    // Staff can choose to send again; it goes through the same checks.
    answer = () => ({ outcome: 'accepted', providerRef: 'again' })
    const unclear = rows().find((r) => r.status === 'unknown')!
    const retried = await api.inject({
      method: 'POST',
      url: `/api/workspaces/${owner.orgId}/outbox/${unclear.id}/retry`,
      headers: headers(owner),
      payload: {},
    })
    expect(retried.statusCode, retried.body).toBe(200)
    await api.outbox.tick()
    expect(rows().find((r) => r.id === unclear.id)!.status).toBe('accepted')
  })

  it('marks a message delivered only on a verified receipt', async () => {
    const { serviceId, staffId, slug } = await localStudio()
    await book(slug, serviceId, staffId)
    await api.outbox.tick()
    const receipt = (signature: string, body: string) =>
      api.inject({
        method: 'POST',
        url: '/api/hooks/twilio',
        headers: { 'x-test-signature': signature, origin: 'https://api.twilio.com' },
        rawPayload: body,
      })
    const text = rows().find((r) => r.channel === 'sms')!.provider_ref!
    expect((await receipt('forged', text)).statusCode).toBe(403)
    expect(rows().map((r) => r.status)).toEqual(['accepted', 'accepted'])
    expect((await receipt('good', text)).statusCode).toBe(200)
    expect((await receipt('good', 'bad-unknown')).statusCode).toBe(200)
    expect(
      rows()
        .filter((r) => r.status === 'delivered')
        .map((r) => r.channel),
    ).toEqual(['sms'])
  })

  it('marks an email delivered from another sender’s signed receipt, and failed by a later bounce (NEXT-13)', async () => {
    let n = 0
    const fetcher = (async () =>
      new Response(JSON.stringify({ id: `<mg-${++n}@mg.example.invalid>` }), {
        status: 200,
      })) as unknown as typeof fetch
    const chosen = providersFromEnv(
      {
        SALEANE_EMAIL_PROVIDER: 'mailgun',
        MAILGUN_API_KEY: 'key',
        MAILGUN_DOMAIN: 'mg.example.invalid',
        MAILGUN_WEBHOOK_SIGNING_KEY: 'signing-key',
        SALEANE_EMAIL_FROM: 'hello@example.invalid',
      },
      origin,
      fetcher,
    )
    start({ ...chosen, sms: recording('sms') })
    const { serviceId, staffId, slug } = await localStudio()
    await book(slug, serviceId, staffId)
    await api.outbox.tick()
    const email = rows().find((r) => r.channel === 'email')!
    expect([email.status, email.provider]).toEqual(['accepted', 'mailgun'])
    // Kept without Mailgun's angle brackets, as its receipts name it.
    expect(email.provider_ref).toMatch(/^mg-\d+@mg\.example\.invalid$/)
    const receipt = (key: string, event: Record<string, unknown> = { event: 'delivered' }) => {
      const timestamp = String(Math.floor(Date.now() / 1000)),
        token = 'token-1'
      return api.inject({
        method: 'POST',
        url: '/api/hooks/mailgun',
        headers: { 'content-type': 'application/json' },
        rawPayload: JSON.stringify({
          signature: {
            timestamp,
            token,
            signature: createHmac('sha256', key)
              .update(timestamp + token)
              .digest('hex'),
          },
          'event-data': {
            ...event,
            message: { headers: { 'message-id': email.provider_ref } },
          },
        }),
      })
    }
    expect((await receipt('forged-key')).statusCode).toBe(403)
    expect(rows().find((r) => r.id === email.id)!.status).toBe('accepted')
    expect((await receipt('signing-key')).statusCode).toBe(200)
    expect(rows().find((r) => r.id === email.id)!.status).toBe('delivered')
    // A delayed bounce: the guest's provider took it, then sent it back.
    const bounce = {
      event: 'failed',
      severity: 'permanent',
      'delivery-status': { message: 'No such user' },
    }
    expect((await receipt('signing-key', bounce)).statusCode).toBe(200)
    const bounced = rows().find((r) => r.id === email.id)!
    expect([bounced.status, bounced.detail]).toEqual([
      'failed',
      'The guest’s email provider refused it: No such user',
    ])
    // A delivered receipt arriving late does not undo it.
    expect((await receipt('signing-key')).statusCode).toBe(200)
    expect(rows().find((r) => r.id === email.id)!.status).toBe('failed')
  })

  it('marks a SendGrid email failed from a later bounce that names only its outbox row (NEXT-13)', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
    let n = 0,
      drop = false
    const fetcher = (async () => {
      // The line drops after SendGrid took it: the row is left unclear, with no reference.
      if (drop)
        throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } })
      return new Response(null, { status: 202, headers: { 'x-message-id': `sg-${++n}` } })
    }) as unknown as typeof fetch
    const chosen = providersFromEnv(
      {
        SALEANE_EMAIL_PROVIDER: 'sendgrid',
        SENDGRID_API_KEY: 'SG.key',
        SENDGRID_WEBHOOK_PUBLIC_KEY: publicKey
          .export({ type: 'spki', format: 'der' })
          .toString('base64'),
        SALEANE_EMAIL_FROM: 'hello@example.invalid',
      },
      origin,
      fetcher,
    )
    start({ ...chosen, sms: recording('sms') })
    const { serviceId, staffId, slug } = await localStudio()
    await book(slug, serviceId, staffId)
    await api.outbox.tick()
    const email = rows().find((r) => r.channel === 'email')!
    const text = rows().find((r) => r.channel === 'sms')!
    expect([email.status, email.provider]).toEqual(['accepted', 'sendgrid'])
    expect(email.provider_ref).toMatch(/^sg-\d+$/)
    // `others` stands for the rest of a busy studio's batch, which SendGrid posts together.
    const bounce = (outbox: string, others = 0) => {
      const timestamp = String(Math.floor(Date.now() / 1000))
      const body = JSON.stringify([
        ...Array.from({ length: others }, (_, i) => ({
          event: 'processed',
          sg_message_id: `elsewhere-${i}.filter0001.1.2`,
        })),
        { event: 'bounce', outbox, reason: '550 mailbox full' },
      ])
      return api.inject({
        method: 'POST',
        url: '/api/hooks/sendgrid',
        headers: {
          'content-type': 'application/json',
          'x-twilio-email-event-webhook-timestamp': timestamp,
          'x-twilio-email-event-webhook-signature': sign(
            'sha256',
            Buffer.from(timestamp + body),
            privateKey,
          ).toString('base64'),
        },
        rawPayload: body,
      })
    }
    // A row another sender carried cannot be reached through SendGrid's receipts.
    expect((await bounce(text.id)).statusCode).toBe(200)
    expect(rows().find((r) => r.id === text.id)!.status).toBe(text.status)
    // A batch past SendGrid's 768 KiB is not one it sends, and stays refused.
    expect((await bounce(email.id, 20_000)).statusCode).toBe(413)
    expect(rows().find((r) => r.id === email.id)!.status).toBe('accepted')
    // About 680 KiB, well past the 64 KiB other requests may carry.
    expect((await bounce(email.id, 10_000)).statusCode).toBe(200)
    const failed = rows().find((r) => r.id === email.id)!
    expect([failed.status, failed.detail]).toEqual([
      'failed',
      'The guest’s email provider sent it back (bounced).',
    ])
    // A send left unclear is settled by SendGrid's own word on it.
    drop = true
    await book(slug, serviceId, staffId, '2026-10-09')
    await api.outbox.tick()
    const unclear = rows().find((r) => r.channel === 'email' && r.status === 'unknown')!
    expect([unclear.provider, unclear.provider_ref]).toEqual(['sendgrid', null])
    expect((await bounce(unclear.id)).statusCode).toBe(200)
    expect(rows().find((r) => r.id === unclear.id)!.status).toBe('failed')
  })

  it('keeps the outbox from practitioners and reports test mode by default', async () => {
    start({ email: testProvider('email'), sms: testProvider('sms'), receipt: () => null })
    const { owner, serviceId, staffId, slug } = await localStudio()
    expect((await workspace(owner)).deliveryConfigured).toBe(false)
    await book(slug, serviceId, staffId)
    await api.outbox.tick()
    expect(rows().map((r) => [r.status, r.provider])).toEqual([
      ['test', 'test'],
      ['test', 'test'],
    ])
    const listed = (await outbox(owner)).json<{ providers: unknown }>()
    expect(listed.providers).toEqual({
      email: { name: 'test', live: false },
      sms: { name: 'test', live: false },
    })
  })
})

describe('designed emails (NEXT-13)', () => {
  const visible = (html: string) =>
    html
      .replace(/<head>[\s\S]*?<\/head>/, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&#x27;/g, "'")
      .replace(/&amp;/g, '&')
      .replace(/\s+/g, ' ')

  it('sends each email in the studio colours with the same words, and texts as they were', async () => {
    const { serviceId, staffId, slug, owner } = await localStudio()
    await run(owner, { type: 'studio-look', look: { first: '#a35f4b', second: '#c98a5e' } })
    await book(slug, serviceId, staffId)
    await api.outbox.tick()
    await api.outbox.tick()
    const email = sent.find((m) => m.channel === 'email')!
    const text = sent.find((m) => m.channel === 'sms')!
    expect(text.html).toBeUndefined()
    expect(text.stream).toBeUndefined()
    expect(email.stream).toBe('transactional')
    const html = email.html!
    expect(html.startsWith('<!DOCTYPE html><html lang="en-GB">')).toBe(true)
    // The private link in the button is the one in the plain words, made once for this email.
    const link = /(http:\/\/127\.0\.0\.1:5173\/manage#[A-Za-z0-9_-]+)/.exec(email.body)![1]
    expect(html).toContain(`href="${link}"`)
    expect(html.match(/\/manage#/g)).toHaveLength(1)
    // Clay, deepened with ink for white words, and the second colour under the name.
    const palette = emailPalette({ first: '#a35f4b', second: '#c98a5e' })
    expect(palette.action).not.toBe('#a35f4b')
    expect(html).toContain(`background:${palette.action}`)
    expect(html).toContain('background:#c98a5e')
    for (const line of email.body.split('\n').filter((l) => l && !l.includes('/manage#')))
      expect(visible(html)).toContain(line.replace(/:$/, ''))
    expect(visible(html)).toContain('View, add to your calendar or cancel')
    // The stored record keeps only the plain words, with the placeholder.
    expect(rows().every((r) => !r.body.includes('<'))).toBe(true)
  })

  it('shows a sent email as the guest saw it, and samples before any guest', async () => {
    const { serviceId, staffId, slug, owner } = await localStudio()
    await book(slug, serviceId, staffId)
    await api.outbox.tick()
    const listed = (await outbox(owner)).json<{
      messages: { id: string; channel: string }[]
    }>().messages
    const emailId = listed.find((m) => m.channel === 'email')!.id
    const textId = listed.find((m) => m.channel === 'sms')!.id
    const shown = await outbox(owner, `/${emailId}/email`)
    expect(shown.statusCode, shown.body).toBe(200)
    const { subject, html } = shown.json<{ subject: string; html: string }>()
    expect(subject).toBe('Your visit to Linden Studio is booked')
    expect(visible(html)).toContain('Restorative facial with Maya')
    // No private link is made for a look: the button shows and goes nowhere.
    expect(html).not.toContain('/manage#')
    expect(visible(html)).toContain('View, add to your calendar or cancel')
    expect((await outbox(owner, `/${textId}/email`)).statusCode).toBe(404)
    expect((await outbox(owner, `/missing/email`)).statusCode).toBe(404)

    const sample = await outbox(owner, '/sample?kind=confirmation')
    expect(sample.statusCode, sample.body).toBe(200)
    const confirmation = sample.json<{ subject: string; html: string }>()
    expect(confirmation.subject).toBe('Your visit to Linden Studio is booked')
    // Tomorrow at 10:00, with the studio's own treatment and professional, for a made-up guest.
    expect(visible(confirmation.html)).toContain('Hello Alex,')
    expect(visible(confirmation.html)).toContain('Restorative facial with Maya')
    expect(visible(confirmation.html)).toContain('Wednesday 7 October at 10:00')
    const birthday = (await outbox(owner, '/sample?kind=birthday')).json<{ html: string }>()
    expect(birthday.html).toContain(`href="${origin}/book/${slug}"`)
    expect((await outbox(owner, '/sample?kind=invoice')).statusCode).toBe(400)
    // Nothing was written down or sent for a look.
    expect(rows()).toHaveLength(2)

    // Another studio's owner cannot see this studio's email.
    const other = await api.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        name: 'Bea Owner',
        email: 'bea@example.invalid',
        password: 'Fictional local account 2026!',
        workspace: { name: 'Elm Rooms', locationName: 'Leeds', region: 'UK', sample: false },
      },
    })
    const bea = {
      ...other.json<{ csrf: string; orgId: string }>(),
      cookie: String(other.headers['set-cookie']).split(';')[0],
    }
    expect((await outbox(bea, `/${emailId}/email`)).statusCode).toBe(404)

    // Maya, a practitioner here, sees her own day only: no guest's email, and no samples.
    const invitation = await api.inject({
      method: 'POST',
      url: `/api/workspaces/${owner.orgId}/invitations`,
      headers: headers(owner),
      payload: { email: 'maya@example.invalid', role: 'practitioner', staffId },
    })
    expect(invitation.statusCode, invitation.body).toBe(201)
    const joined = await api.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        name: 'Maya Lind',
        email: 'maya@example.invalid',
        password: 'Fictional local account 2026!',
        invitation: invitation.json<{ invitation: string }>().invitation,
      },
    })
    expect(joined.statusCode, joined.body).toBe(201)
    const maya = {
      csrf: joined.json<{ csrf: string }>().csrf,
      orgId: owner.orgId,
      cookie: String(joined.headers['set-cookie']).split(';')[0],
    }
    expect((await outbox(maya, `/${emailId}/email`)).statusCode).toBe(403)
    expect((await outbox(maya, '/sample?kind=confirmation')).statusCode).toBe(403)
  })
})

describe('message providers', () => {
  const message: OutgoingMessage = {
    id: 'out-1',
    channel: 'email',
    to: 'guest@example.invalid',
    subject: 'Hello',
    body: 'Body',
    fromName: 'Linden "Studio"',
  }
  it('stays in test mode unless every key for a live provider is set', () => {
    expect(providersFromEnv({}).email.live).toBe(false)
    expect(() => providersFromEnv({ SALEANE_EMAIL_PROVIDER: 'postmark' })).toThrow(
      'Set POSTMARK_SERVER_TOKEN and SALEANE_EMAIL_FROM and POSTMARK_BROADCAST_STREAM',
    )
    // Postmark's broadcast stream is named by each server, so it is never guessed.
    expect(() =>
      providersFromEnv({
        SALEANE_EMAIL_PROVIDER: 'postmark',
        POSTMARK_SERVER_TOKEN: 'token',
        SALEANE_EMAIL_FROM: 'hello@example.invalid',
      }),
    ).toThrow('Set POSTMARK_BROADCAST_STREAM to send real messages.')
    expect(() => providersFromEnv({ SALEANE_SMS_PROVIDER: 'pigeon' })).toThrow('Unknown')
  })
  it('sends email through Postmark and reads its answer', async () => {
    const calls: [string, RequestInit][] = []
    const provider = postmarkProvider({
      token: 'server-token',
      from: 'hello@example.invalid',
      broadcastStream: 'broadcasts',
      fetcher: async (url, init) => {
        calls.push([String(url), init!])
        return new Response(JSON.stringify({ ErrorCode: 0, MessageID: 'pm-1' }), { status: 200 })
      },
    })
    expect(await provider.send(message)).toEqual({ outcome: 'accepted', providerRef: 'pm-1' })
    expect(calls[0][0]).toBe('https://api.postmarkapp.com/email')
    expect(JSON.parse(String(calls[0][1].body))).toMatchObject({
      From: 'Linden Studio <hello@example.invalid>',
      To: 'guest@example.invalid',
      TextBody: 'Body',
      MessageStream: 'outbound',
    })
    expect(JSON.parse(String(calls[0][1].body))).not.toHaveProperty('HtmlBody')
    // NEXT-13: the designed email goes with the plain words; news goes on the broadcast stream.
    await provider.send({ ...message, html: '<p>Body</p>', stream: 'broadcast' })
    expect(JSON.parse(String(calls[1][1].body))).toMatchObject({
      TextBody: 'Body',
      HtmlBody: '<p>Body</p>',
      MessageStream: 'broadcasts',
    })
    const own = postmarkProvider({
      token: 't',
      from: 'f@example.invalid',
      broadcastStream: 'studio-news',
      fetcher: async (url, init) => {
        calls.push([String(url), init!])
        return new Response(JSON.stringify({ ErrorCode: 0, MessageID: 'pm-2' }), { status: 200 })
      },
    })
    await own.send({ ...message, stream: 'broadcast' })
    expect(JSON.parse(String(calls[2][1].body)).MessageStream).toBe('studio-news')
    const refused = postmarkProvider({
      token: 't',
      from: 'f@example.invalid',
      broadcastStream: 'broadcasts',
      fetcher: async () =>
        new Response(JSON.stringify({ ErrorCode: 406, Message: 'Inactive recipient' }), {
          status: 422,
        }),
    })
    expect(await refused.send(message)).toEqual({
      outcome: 'failed',
      detail: 'Inactive recipient',
      retry: false,
    })
    const dropped = postmarkProvider({
      token: 't',
      from: 'f@example.invalid',
      broadcastStream: 'broadcasts',
      fetcher: async () => {
        throw new TypeError('fetch failed')
      },
    })
    expect((await dropped.send(message)).outcome).toBe('unknown')
  })
  it('sends texts through Twilio and verifies its signed receipts', async () => {
    let form = new URLSearchParams()
    const provider = twilioProvider({
      accountSid: 'AC123',
      authToken: 'secret',
      from: '+447700900000',
      fetcher: async (_url, init) => {
        form = new URLSearchParams(String(init!.body))
        return new Response(JSON.stringify({ sid: 'SM1', status: 'queued' }), { status: 201 })
      },
    })
    expect(await provider.send({ ...message, channel: 'sms', to: '+447700900333' })).toEqual({
      outcome: 'accepted',
      providerRef: 'SM1',
    })
    expect(form.get('From')).toBe('+447700900000')
    const providers = providersFromEnv(
      {
        SALEANE_SMS_PROVIDER: 'twilio',
        TWILIO_ACCOUNT_SID: 'AC123',
        TWILIO_AUTH_TOKEN: 'secret',
        TWILIO_FROM: 'MG123',
      },
      'https://studio.example.invalid',
    )
    const body = new URLSearchParams({ MessageSid: 'SM1', MessageStatus: 'delivered' })
    const signature = twilioSignature(
      'secret',
      'https://studio.example.invalid/api/hooks/twilio',
      body,
    )
    const read = (sig: string) =>
      providers.receipt('twilio', {
        url: '',
        headers: { 'x-twilio-signature': sig },
        body: body.toString(),
      })
    expect(read(signature)).toEqual([{ provider: 'twilio', providerRef: 'SM1', delivered: true }])
    expect(read('forged')).toBeNull()
    expect(providers.receipt('postmark', { url: '', headers: {}, body: '{}' })).toBeNull()
  })
})
