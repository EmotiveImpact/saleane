// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApiHandler } from './app'
import type { ApiHandler } from './app'
import type { BusinessState } from '../src/domain/model'
import type { Command } from '../src/domain/commands'
import { defaultReminderSettings } from '../src/domain/reminders'
import { providersFromEnv, twilioSignature } from './messaging/providers'
import type { MessageProvider, OutgoingMessage } from './messaging/providers'
import type { OutboxRow } from './messaging/outbox'
import type { GuestView } from '../src/domain/guest'

// V1.5: missed-call text-back and "I've arrived", through the server.
const origin = 'http://127.0.0.1:5173'
type Login = { cookie: string; csrf: string; orgId: string }
let api: ApiHandler
let clock: number
let sent: OutgoingMessage[]

function recording(channel: 'email' | 'sms'): MessageProvider {
  return {
    name: channel === 'email' ? 'postmark' : 'twilio',
    live: true,
    channel,
    send: async (message) => {
      sent.push(message)
      return { outcome: 'accepted', providerRef: `ref-${sent.length}` }
    },
  }
}
beforeEach(() => {
  // 08:00 in London on 6 October.
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
      // Stands in for Twilio's signature check, which is tested on its own below.
      voice: (_slug, request) => {
        if (request.headers['x-test-signature'] !== 'good') return null
        const form = new URLSearchParams(request.body)
        return { from: form.get('From') ?? '', missed: form.get('DialCallStatus') !== 'completed' }
      },
    },
  })
})
afterEach(() => api.close())

const headers = (login: Login) => ({ cookie: login.cookie, 'x-csrf-token': login.csrf })
async function register(): Promise<Login> {
  const response = await api.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: {
      name: 'Ada Owner',
      email: 'owner@example.invalid',
      password: 'Fictional local account 2026!',
      workspace: { name: 'Linden Studio', locationName: 'London', region: 'UK', sample: false },
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
  }>()
async function send(login: Login, command: Command) {
  const { state } = await workspace(login)
  return api.inject({
    method: 'POST',
    url: `/api/workspaces/${login.orgId}/commands`,
    headers: { ...headers(login), 'idempotency-key': crypto.randomUUID() },
    payload: { revision: state.revision, command },
  })
}
async function run(login: Login, command: Command) {
  const response = await send(login, command)
  expect(response.statusCode, response.body).toBe(200)
  return response.json<{ recordId: string }>().recordId
}
const rows = () => api.database.all<OutboxRow>('SELECT * FROM outbox ORDER BY created_at')
const textBack = (owner: Login) =>
  run(owner, { type: 'reminders', settings: { ...defaultReminderSettings, missedCall: true } })
/** A new studio takes online bookings once the owner switches them on. */
async function bookOnline(owner: Login) {
  const { name, locationName, address, timeZone } = (await workspace(owner)).state.organisation
  await run(owner, {
    type: 'organisation',
    name,
    locationName,
    address,
    timeZone,
    bookingEnabled: true,
  })
}

describe('missed-call text-back', () => {
  it('texts a caller once with the booking link, and only when switched on', async () => {
    const owner = await register()
    await bookOnline(owner)
    const { slug } = await workspace(owner)
    await run(owner, { type: 'missed-call', number: '07700 900456' })
    await api.outbox.tick()
    expect(rows()).toEqual([])
    await textBack(owner)
    // A second call from the same number, still within 15 minutes of the latest one.
    clock += 5 * 60000
    await run(owner, { type: 'missed-call', number: '+44 7700 900456' })
    await api.outbox.tick()
    expect(sent.map((m) => [m.channel, m.to])).toEqual([['sms', '+447700900456']])
    expect(sent[0].body).toContain(`${origin}/book/${slug}`)
    expect(rows()).toMatchObject([
      { kind: 'missed_call', appointment_id: '', client_id: '', status: 'accepted' },
    ])
    // The stored copy keeps the placeholder, not the address it was sent with.
    expect(rows()[0].body).toContain('{{book_link}}')
    const { state } = await workspace(owner)
    expect(state.operations?.missedCalls).toMatchObject([
      { number: '+447700900456', calls: 2, actor: 'Ada Owner', source: 'desk' },
    ])
    // Ringing again later the same day brings no second text.
    clock += 60 * 60000
    await run(owner, { type: 'missed-call', number: '07700 900456' })
    await api.outbox.tick()
    expect(sent).toHaveLength(1)
  })

  it('skips the text when someone calls back before it goes', async () => {
    const owner = await register()
    await textBack(owner)
    const callId = await run(owner, { type: 'missed-call', number: '07700 900456' })
    api.outbox.plan()
    await run(owner, { type: 'missed-call-done', callId })
    await api.outbox.deliver()
    expect(sent).toEqual([])
    expect(rows()).toMatchObject([
      { status: 'skipped', detail: 'Called back, turned off or too late before it went out.' },
    ])
  })

  it('writes down a call the phone line says nobody answered', async () => {
    const owner = await register()
    await textBack(owner)
    const { slug } = await workspace(owner)
    const hook = (signature: string, form: Record<string, string>, to = slug) =>
      api.inject({
        method: 'POST',
        url: `/api/hooks/twilio/voice/${to}`,
        headers: {
          'x-test-signature': signature,
          origin: 'https://api.twilio.com',
          'content-type': 'application/x-www-form-urlencoded',
        },
        rawPayload: new URLSearchParams(form).toString(),
      })
    const missed = { From: '+447700900456', DialCallStatus: 'no-answer' }
    expect((await hook('forged', missed)).statusCode).toBe(403)
    const answered = await hook('good', { From: '+447700900457', DialCallStatus: 'completed' })
    expect(answered.statusCode).toBe(200)
    expect(answered.body).toBe('<?xml version="1.0" encoding="UTF-8"?><Response/>')
    const reply = await hook('good', missed)
    expect(reply.statusCode).toBe(200)
    expect(reply.headers['content-type']).toContain('text/xml')
    expect(reply.body).toContain('Sorry we missed your call.')
    // A withheld number and an unknown studio are left alone.
    expect((await hook('good', { From: 'anonymous', DialCallStatus: 'busy' })).statusCode).toBe(200)
    expect((await hook('good', missed, 'no-such-studio')).statusCode).toBe(200)
    const { state } = await workspace(owner)
    expect(state.operations?.missedCalls).toMatchObject([
      { number: '+447700900456', source: 'phone', actor: 'Phone line', calls: 1 },
    ])
    await api.outbox.tick()
    expect(sent.map((m) => m.to)).toEqual(['+447700900456'])
  })

  it('reads a phone line callback only with a genuine Twilio signature', () => {
    const providers = providersFromEnv(
      {
        SALEANE_SMS_PROVIDER: 'twilio',
        TWILIO_ACCOUNT_SID: 'AC123',
        TWILIO_AUTH_TOKEN: 'secret',
        TWILIO_FROM: 'MG123',
      },
      'https://studio.example.invalid',
    )
    const body = new URLSearchParams({ From: '+447700900456', DialCallStatus: 'busy' })
    const signature = twilioSignature(
      'secret',
      'https://studio.example.invalid/api/hooks/twilio/voice/linden',
      body,
    )
    const read = (slug: string, sig: string) =>
      providers.voice!(slug, {
        url: '',
        headers: { 'x-twilio-signature': sig },
        body: body.toString(),
      })
    expect(read('linden', signature)).toEqual({ from: '+447700900456', missed: true })
    expect(read('another-studio', signature)).toBeNull()
    expect(read('linden', 'forged')).toBeNull()
    expect(providersFromEnv({}).voice!('linden', { url: '', headers: {}, body: '' })).toBeNull()
  })
})

describe("I've arrived", () => {
  it('lets a guest tell the desk from their private link, from half an hour before', async () => {
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
    await bookOnline(owner)
    const { slug } = await workspace(owner)
    const held = await api.inject({
      method: 'POST',
      url: `/api/public/${slug}/holds`,
      payload: { serviceId, staffId, date: '2026-10-06', startMinutes: 600 },
    })
    expect(held.statusCode, held.body).toBe(201)
    const booked = await api.inject({
      method: 'POST',
      url: `/api/public/${slug}/book`,
      payload: {
        hold: held.json<{ hold: string }>().hold,
        contact: {
          name: 'Rosa Guest',
          email: 'rosa.guest@example.invalid',
          phone: '+44 7700 900333',
          marketingConsent: false,
        },
        policy: true,
      },
    })
    expect(booked.statusCode, booked.body).toBe(200)
    const { appointmentId, manage } = booked.json<{
      appointmentId: string
      manage: { url: string }
    }>()
    const token = manage.url.split('#')[1]
    const here = () => api.inject({ method: 'POST', url: '/api/guest/here', payload: { token } })
    // 08:00 in London; the visit is at 10:00.
    const early = await here()
    expect(early.statusCode).toBe(409)
    expect(early.json<{ error: string }>().error).toContain('30 minutes before')
    clock = Date.parse('2026-10-06T08:40:00.000Z')
    const told = await here()
    expect(told.statusCode, told.body).toBe(200)
    expect(told.json<GuestView>().here).toMatchObject({
      saidAt: '2026-10-06T08:40:00.000Z',
      welcomed: false,
    })
    expect((await here()).statusCode).toBe(200)
    const { state } = await workspace(owner)
    const visit = state.appointments.find((a) => a.id === appointmentId)!
    expect(visit).toMatchObject({ status: 'confirmed', guestHereAt: '2026-10-06T08:40:00.000Z' })
    expect(state.events.filter((e) => e.title === 'Said they have arrived')).toHaveLength(1)
    // Only the guest says this; the studio welcomes them instead.
    expect((await send(owner, { type: 'guest-here', appointmentId })).statusCode).toBe(403)
  })
})
