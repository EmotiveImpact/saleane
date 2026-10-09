// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApiHandler } from './app'
import type { ApiHandler } from './app'
import type { BusinessState } from '../src/domain/model'
import type { Command } from '../src/domain/commands'
import type { MessageProvider, OutgoingMessage } from './messaging/providers'
import type { OutboxRow } from './messaging/outbox'

// V4: the AI receptionist answering texts to the studio's line, through the outbox.
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
      inbound: (provider, _slug, request) => {
        const form = new URLSearchParams(request.body)
        return [
          {
            from: form.get('From') ?? '',
            body: form.get('Body') ?? '',
            providerRef: `${provider}-${form.get('Ref')}`,
          },
        ]
      },
    },
  })
})
afterEach(() => api.close())

const headers = (login: Login) => ({ cookie: login.cookie, 'x-csrf-token': login.csrf })
const workspace = async (login: Login) =>
  (await api.inject({ url: `/api/workspaces/${login.orgId}`, headers: headers(login) })).json<{
    slug: string
    state: BusinessState
  }>()
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
let serviceId: string
let staffId: string
let clientId: string
async function studio(texts = true) {
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
  const login: Login = {
    ...response.json<{ csrf: string; orgId: string }>(),
    cookie: String(response.headers['set-cookie']).split(';')[0],
  }
  await run(login, { type: 'resource', input: { name: 'Room One', type: 'treatment' } })
  serviceId = await run(login, {
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
  staffId = await run(login, {
    type: 'staff',
    input: { name: 'Maya Lind', role: 'Facialist', serviceIds: [serviceId], tone: 'sage' },
  })
  clientId = await run(login, {
    type: 'client',
    contact: {
      name: 'Rosa Field',
      email: 'rosa@example.invalid',
      phone: '+44 7700 900456',
      marketingConsent: false,
    },
  })
  // The receptionist answers for a studio that takes online bookings, switched on by the owner.
  const { name, locationName, address, timeZone } = (await workspace(login)).state.organisation
  await run(login, {
    type: 'organisation',
    name,
    locationName,
    address,
    timeZone,
    bookingEnabled: true,
  })
  await run(login, {
    type: 'receptionist',
    settings: { enabled: true, handOver: true, texts },
  })
  return { login, slug: (await workspace(login)).slug }
}
let ref = 0
const text = (slug: string, body: string, from = '+447700900456') =>
  api.inject({
    method: 'POST',
    url: `/api/hooks/twilio/sms/${slug}`,
    headers: {
      origin: 'https://api.twilio.com',
      'content-type': 'application/x-www-form-urlencoded',
    },
    rawPayload: new URLSearchParams({ From: from, Body: body, Ref: String(++ref) }).toString(),
  })
const answers = () =>
  api.database.all<OutboxRow>("SELECT * FROM outbox WHERE kind='receptionist' ORDER BY created_at")
const chats = async (login: Login) =>
  (
    await api.inject({ url: `/api/workspaces/${login.orgId}/assistant`, headers: headers(login) })
  ).json<{ usage: { used: { guestChats: number } } }>().usage.used.guestChats

describe('the AI receptionist answering texts', () => {
  it('stays quiet until the studio chooses texts as well', async () => {
    const { slug } = await studio(false)
    expect((await text(slug, 'When are you open?')).statusCode).toBe(200)
    await api.outbox.tick()
    expect(answers()).toEqual([])
    expect(sent).toEqual([])
  })

  it('answers through the outbox once, with the guest, and says it is sent only when it is', async () => {
    const { login, slug } = await studio()
    const response = await text(slug, 'When are you open?')
    expect(response.body).toBe('<?xml version="1.0" encoding="UTF-8"?><Response/>')
    expect(answers()).toMatchObject([
      { status: 'pending', recipient: '+447700900456', client_id: clientId },
    ])
    await api.outbox.tick()
    await api.outbox.tick()
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ channel: 'sms', to: '+447700900456' })
    expect(sent[0].body).toMatch(/^Linden Studio AI receptionist: Linden Studio is open:/)
    expect(answers()[0].status).toBe('accepted')
    expect(await chats(login)).toBe(1)
  })

  it('offers a time as a link that opens the booking page with it chosen, in one chat', async () => {
    const { login, slug } = await studio()
    await text(slug, 'Any times for a facial on Thursday?')
    const times = answers()[0].body
    expect(times).toMatch(
      /^Linden Studio AI receptionist: Restorative facial on Thursday 8 October: /,
    )
    const first = /: (\d{2}:\d{2})/.exec(times)![1]
    clock += 60000
    await text(slug, `Book ${first} please`)
    const offer = answers()[1].body
    const start = Number(first.slice(0, 2)) * 60 + Number(first.slice(3))
    expect(offer).toContain(
      `${origin}/book/${slug}?service=${serviceId}&staff=any&date=2026-10-08&start=${start}`,
    )
    expect(offer).toMatch(/Nothing is booked until you confirm/)
    expect(await chats(login)).toBe(1)
    // An hour on, a new text is a new chat.
    clock += 61 * 60000
    await text(slug, 'When are you open?')
    expect(await chats(login)).toBe(2)
  })

  it('hands over to the team by text, and steps back once a person has texted the guest', async () => {
    const { login, slug } = await studio()
    await text(slug, 'Can someone call me about a group booking?')
    expect(answers()[0].body).toMatch(/passed this to the team/)
    const messageId = await run(login, {
      type: 'message',
      input: {
        clientId,
        purpose: 'appointment',
        channel: 'sms',
        subject: 'Group booking',
        body: 'Happy to help. How many of you?',
      },
    })
    await run(login, { type: 'message-queue', messageId })
    await api.outbox.tick()
    await text(slug, 'Six of us, on Saturday')
    expect(answers()).toHaveLength(1)
  })

  it('answers a text once, even when the provider sends it again after a failure', async () => {
    const { login, slug } = await studio(false)
    const again = (body: string) =>
      api.inject({
        method: 'POST',
        url: `/api/hooks/twilio/sms/${slug}`,
        headers: {
          origin: 'https://api.twilio.com',
          'content-type': 'application/x-www-form-urlencoded',
        },
        rawPayload: new URLSearchParams({
          From: '+447700900456',
          Body: body,
          Ref: 'same',
        }).toString(),
      })
    // Kept for the inbox but not answered, as if the answer had failed.
    await again('When are you open?')
    expect(answers()).toEqual([])
    await run(login, {
      type: 'receptionist',
      settings: { enabled: true, handOver: true, texts: true },
    })
    await again('When are you open?')
    await again('When are you open?')
    expect(answers()).toHaveLength(1)
    expect(await chats(login)).toBe(1)
  })

  it('answers in the client conversation the team matched the number to', async () => {
    const { login, slug } = await studio()
    await text(slug, 'Hello, is that the studio?', '+447700900999')
    expect(answers()[0].client_id).toBe('')
    const replyId = (await workspace(login)).state.replies!.find(
      (r) => r.from === '+447700900999',
    )!.id
    await run(login, { type: 'reply-link', replyId, clientId })
    clock += 60000
    await text(slug, 'When are you open?', '+447700900999')
    expect(answers()[1].client_id).toBe(clientId)
  })

  it('sends a guest the private link to their own visit, only to the number on the booking', async () => {
    const { login, slug } = await studio()
    const book = (date: string) =>
      run(login, {
        type: 'book',
        input: { serviceId, staffId, date, startMinutes: 600, clientId, source: 'desk' },
      })
    const first = await book('2026-10-08')
    // Someone else's number is never sent a link, nor told whether a visit exists.
    await text(slug, 'I need to cancel my appointment', '+447700900999')
    expect(answers()[0].body).toMatch(/only send the link to change a visit to the phone number/)
    clock += 61 * 60000
    await text(slug, 'Can I move my appointment?')
    const answer = answers()[1]
    expect(answer).toMatchObject({ appointment_id: first, client_id: clientId })
    // The stored answer keeps a placeholder; the link is made only as it goes.
    expect(answer.body).toContain('{{manage_link}}')
    expect(answer.body).toMatch(/Restorative facial with Maya Lind, Thursday 8 October at 10:00/)
    await api.outbox.tick()
    const fromReception = () => sent.filter((m) => m.body.includes('AI receptionist:'))
    const linked = fromReception().at(-1)!
    const link = /\/manage#(\S+)/.exec(linked.body)![1]
    expect(linked.to).toBe('+447700900456')
    const visit = await api.inject({
      method: 'POST',
      url: '/api/guest/visit',
      payload: { token: link },
    })
    expect(visit.statusCode, visit.body).toBe(200)
    expect(JSON.stringify(api.database.all('SELECT body FROM outbox'))).not.toContain(link)
    // If the visit moves before the answer goes, it would name the old time: nothing is sent.
    clock += 61 * 60000
    await text(slug, 'Can I cancel my visit?')
    expect(answers()[2]).toMatchObject({ appointment_id: first, status: 'pending' })
    await run(login, {
      type: 'reschedule',
      appointmentId: first,
      staffId,
      date: '2026-10-09',
      startMinutes: 600,
    })
    await api.outbox.tick()
    expect(answers()[2]).toMatchObject({ status: 'skipped' })
    // With two visits to come, it asks which, then sends the one chosen.
    const second = await book('2026-10-15')
    clock += 61 * 60000
    await text(slug, 'I need to reschedule')
    expect(answers()[3].body).toMatch(
      /Which visit would you like to change\? Reply with its number/,
    )
    clock += 60000
    await text(slug, '2')
    expect(answers()[4]).toMatchObject({ appointment_id: second })
    // If the number on the booking changes before it goes, nothing is sent.
    await run(login, {
      type: 'client-edit',
      clientId,
      contact: {
        name: 'Rosa Field',
        email: 'rosa@example.invalid',
        phone: '+44 7700 900111',
        marketingConsent: false,
      },
      preferences: '',
    })
    await api.outbox.tick()
    expect(fromReception().filter((m) => m.body.includes('/manage#'))).toHaveLength(1)
    expect(answers()[4]).toMatchObject({ status: 'skipped' })
  })

  it('does not send an answer if texts are turned off before it goes out', async () => {
    const { login, slug } = await studio()
    await text(slug, 'When are you open?')
    await run(login, {
      type: 'receptionist',
      settings: { enabled: true, handOver: true, texts: false },
    })
    await api.outbox.tick()
    expect(sent).toEqual([])
    expect(answers()[0]).toMatchObject({ status: 'skipped' })
  })
})
