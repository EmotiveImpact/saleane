// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApiHandler } from './app'
import type { ApiHandler } from './app'
import type { BusinessState } from '../src/domain/model'
import type { Command } from '../src/domain/commands'
import type { MessageProvider, OutgoingMessage } from './messaging/providers'
import type { OutboxRow } from './messaging/outbox'

// NEXT-11: invitations to a cancelled time, through the server. SALEANE writes them when a visit
// is cancelled; they go only once approved, and not at all if the time is booked first.
const origin = 'http://127.0.0.1:5173'
type Login = { cookie: string; csrf: string; orgId: string }
let api: ApiHandler
let clock: number
let sent: OutgoingMessage[]
const recording = (channel: 'email' | 'sms'): MessageProvider => ({
  name: channel === 'email' ? 'postmark' : 'twilio',
  live: true,
  channel,
  send: async (message) => {
    if (message.fromName === 'SALEANE') return { outcome: 'test' }
    sent.push(message)
    return { outcome: 'accepted', providerRef: `ref-${sent.length}` }
  },
})
beforeEach(() => {
  // 08:00 in London on Tuesday 6 October.
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
      inbound: () => null,
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
async function workspace(login: Login) {
  const response = await api.inject({
    url: `/api/workspaces/${login.orgId}`,
    headers: headers(login),
  })
  expect(response.statusCode, response.body).toBe(200)
  return response.json<{ slug: string; state: BusinessState }>()
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
const invitations = () => sent.filter((m) => m.subject === 'A time has opened at Linden Studio')
const rows = () => api.database.all<OutboxRow>("SELECT * FROM outbox WHERE kind='message'")

/**
 * A real studio in test mode, in its free trial. Grace, who agreed to hear from the studio, had a
 * facial with Maya on 6 October; guests come back for it after a week. On Monday 12 October
 * Olivia's facial with Maya on Wednesday 14 October is cancelled.
 */
async function studio() {
  const owner = await register()
  await run(owner, {
    type: 'organisation',
    name: 'Linden Studio',
    locationName: 'London',
    address: '1 Linden Street',
    timeZone: 'Europe/London',
    bookingEnabled: true,
  })
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
      returnWeeks: 1,
    },
  })
  const maya = await run(owner, {
    type: 'staff',
    input: { name: 'Maya Lewis', role: 'Facialist', serviceIds: [serviceId], tone: 'sage' },
  })
  const client = (name: string, email: string, phone: string) =>
    run(owner, { type: 'client', contact: { name, email, phone, marketingConsent: false } })
  const grace = await client('Grace Chen', 'grace@example.invalid', '+44 7700 900123')
  const olivia = await client('Olivia James', 'olivia@example.invalid', '+44 7700 900124')
  await run(owner, { type: 'consent', clientId: grace, consent: true })
  const book = (clientId: string, date: string, startMinutes = 600) =>
    run(owner, {
      type: 'book',
      input: { serviceId, staffId: maya, date, startMinutes, clientId, source: 'desk' },
    })
  const first = await book(grace, '2026-10-06')
  await run(owner, { type: 'arrive', appointmentId: first })
  await run(owner, { type: 'checkout', appointmentId: first, tipMinor: 0, method: 'cash' })
  // Monday 12 October, 09:00 in London, signed in again.
  clock = Date.parse('2026-10-12T08:00:00.000Z')
  const again = await api.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: 'owner@example.invalid', password: 'Fictional local account 2026!' },
  })
  expect(again.statusCode, again.body).toBe(200)
  owner.cookie = String(again.headers['set-cookie']).split(';')[0]
  owner.csrf = again.json<{ csrf: string }>().csrf
  const visit = await book(olivia, '2026-10-14')
  await run(owner, { type: 'cancel', appointmentId: visit, reason: 'Away that week' })
  return { owner, serviceId, maya, grace, olivia, book }
}
const invitation = async (owner: Login) =>
  (await workspace(owner)).state.operations!.messages.find((m) => m.opening)!

describe('invitations to a cancelled time', () => {
  it('are written by SALEANE, wait for approval, then go with the time already chosen', async () => {
    const { owner, serviceId, maya, grace } = await studio()
    const message = await invitation(owner)
    expect(message).toMatchObject({
      clientId: grace,
      purpose: 'marketing',
      status: 'draft',
      actor: 'SALEANE',
      opening: { date: '2026-10-14', startMinutes: 600, staffId: maya, serviceId },
    })
    // Nothing goes before approval. (Grace's "due back" email is a message of its own.)
    await api.outbox.tick()
    expect(invitations()).toEqual([])
    expect(sent.map((m) => m.subject)).toEqual(['Time for your next visit to Linden Studio?'])
    expect(sent[0].body).toContain('It is about a week since your Restorative facial with Maya')
    await run(owner, { type: 'message-queue', messageId: message.id })
    await api.outbox.tick()
    await api.outbox.tick()
    const { slug } = await workspace(owner)
    expect(invitations()).toHaveLength(1)
    const [sentInvitation] = invitations()
    expect(sentInvitation).toMatchObject({ channel: 'email', to: 'grace@example.invalid' })
    expect(sentInvitation.body).toContain(
      'A time has just opened for Restorative facial with Maya on Wednesday 14 October at 10:00',
    )
    const reply = operationsBookLine(sentInvitation.body)
    expect(reply).toBe(
      `${origin}/book/${slug}?service=${serviceId}&staff=${maya}&date=2026-10-14&start=600`,
    )
    expect(sentInvitation.body).not.toContain('{{book_link}}')
  })

  it('are not sent once the time is booked, even after approval', async () => {
    const { owner, olivia, book } = await studio()
    const message = await invitation(owner)
    await run(owner, { type: 'message-queue', messageId: message.id })
    // Olivia rings back and takes her time again before the invitation goes.
    await book(olivia, '2026-10-14')
    await api.outbox.tick()
    await api.outbox.tick()
    expect(invitations()).toEqual([])
    expect(rows()).toMatchObject([
      { status: 'skipped', detail: 'The time was booked, or had passed, before it went out.' },
    ])
  })
})

/** The booking link in an invitation, or the line that stands in for it. */
function operationsBookLine(body: string) {
  return /book it here: (\S+)/.exec(body)?.[1] ?? /reply to this email or call us/.exec(body)?.[0]
}
