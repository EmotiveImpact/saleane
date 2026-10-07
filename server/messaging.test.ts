// @vitest-environment node
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
  return { owner, serviceId, staffId, slug: (await workspace(owner)).slug }
}
async function book(slug: string, serviceId: string, staffId: string, date = '2026-10-08') {
  const held = await api.inject({
    method: 'POST',
    url: `/api/public/${slug}/holds`,
    payload: { serviceId, staffId, date, startMinutes: 600 },
  })
  expect(held.statusCode, held.body).toBe(201)
  const booked = await api.inject({
    method: 'POST',
    url: `/api/public/${slug}/book`,
    payload: { hold: held.json<{ hold: string }>().hold, contact, policy: true },
  })
  expect(booked.statusCode, booked.body).toBe(200)
  return booked.json<{ appointmentId: string; manage: { url: string } }>()
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
    expect(timeline.map((e) => e.title)).toContain('Appointment messages updated')
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
    const service = (await workspace(owner)).state.services.find((x) => x.id === serviceId)!
    const { id: _id, organisationId: _org, ...input } = service
    await run(owner, { type: 'service', id: serviceId, input: { ...input, patchTest: true } })
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
      'Set POSTMARK_SERVER_TOKEN and SALEANE_EMAIL_FROM',
    )
    expect(() => providersFromEnv({ SALEANE_SMS_PROVIDER: 'pigeon' })).toThrow('Unknown')
  })
  it('sends email through Postmark and reads its answer', async () => {
    const calls: [string, RequestInit][] = []
    const provider = postmarkProvider({
      token: 'server-token',
      from: 'hello@example.invalid',
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
    })
    const refused = postmarkProvider({
      token: 't',
      from: 'f@example.invalid',
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
