// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApiHandler } from './app'
import type { ApiHandler } from './app'
import type { BusinessState } from '../src/domain/model'
import type { Command } from '../src/domain/commands'
import type { GuestView } from '../src/domain/guest'
import type { MessageProvider, OutgoingMessage } from './messaging/providers'
import type { OutboxRow } from './messaging/outbox'

// Stage 5: "my usual" through the server. Rosa has had a facial with Maya on a Saturday morning
// every four weeks since July. Her first two visits are on the record the desk made; the next two
// she booked online, which opened a second record with the same email and number. On Friday
// 9 October she texts the studio for her usual, and her last visit's private link offers it too.
const origin = 'http://127.0.0.1:5173'
const password = 'Fictional local account 2026!'
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
  // 08:00 in London on Saturday 11 July.
  clock = Date.parse('2026-07-11T07:00:00.000Z')
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
/** A new day: the clock moves to 08:00 in London and the owner signs in again. */
async function morning(login: Login, date: string) {
  clock = Date.parse(`${date}T07:00:00.000Z`)
  const again = await api.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: 'owner@example.invalid', password },
  })
  expect(again.statusCode, again.body).toBe(200)
  login.cookie = String(again.headers['set-cookie']).split(';')[0]
  login.csrf = again.json<{ csrf: string }>().csrf
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
const guestVisit = (token: string) =>
  api.inject({ method: 'POST', url: '/api/guest/visit', payload: { token } })

async function studio() {
  const register = await api.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: {
      name: 'Ada Owner',
      email: 'owner@example.invalid',
      password,
      workspace: { name: 'Linden Studio', locationName: 'London', region: 'UK', sample: false },
    },
  })
  expect(register.statusCode, register.body).toBe(201)
  const owner: Login = {
    ...register.json<{ csrf: string; orgId: string }>(),
    cookie: String(register.headers['set-cookie']).split(';')[0],
  }
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
    },
  })
  const maya = await run(owner, {
    type: 'staff',
    input: { name: 'Maya Lind', role: 'Facialist', serviceIds: [serviceId], tone: 'sage' },
  })
  const record = (name: string, email: string, phone: string) =>
    run(owner, { type: 'client', contact: { name, email, phone, marketingConsent: false } })
  const desk = await record('Rosa Field', 'rosa@example.invalid', '+44 7700 900456')
  // Someone else entirely, whose visits must never reach Rosa.
  const other = await record('Grace Chen', 'grace@example.invalid', '+44 7700 900123')
  const visit = async (clientId: string, date: string, link = false, startMinutes = 600) => {
    await morning(owner, date)
    const id = await run(owner, {
      type: 'book',
      input: { serviceId, staffId: maya, date, startMinutes, clientId, source: 'desk' },
    })
    let token: string | undefined
    if (link) {
      const issued = await api.inject({
        method: 'POST',
        url: `/api/workspaces/${owner.orgId}/guest-links`,
        headers: headers(owner),
        payload: { appointmentId: id },
      })
      expect(issued.statusCode, issued.body).toBe(201)
      token = issued.json<{ url: string }>().url.split('#')[1]
    }
    await run(owner, { type: 'arrive', appointmentId: id })
    await run(owner, { type: 'checkout', appointmentId: id, tipMinor: 0, method: 'cash' })
    return { id, token }
  }
  const visits = [await visit(desk, '2026-07-11'), await visit(desk, '2026-08-08')]
  await visit(other, '2026-08-08', false, 14 * 60)
  const online = await record('Rosa Field', 'Rosa@Example.invalid', '+447700900456')
  visits.push(await visit(online, '2026-09-05'))
  const last = await visit(online, '2026-10-03', true)
  visits.push(last)
  // Friday 9 October, 08:00 in London. The receptionist answers texts.
  await morning(owner, '2026-10-09')
  await run(owner, {
    type: 'receptionist',
    settings: { enabled: true, handOver: true, texts: true },
  })
  const { slug } = await workspace(owner)
  return { owner, slug, serviceId, maya, desk, online, other, visits, token: last.token! }
}

describe('my usual through the server', () => {
  it('answers a text for "my usual" with what it is and times, then links the time chosen', async () => {
    const { owner, slug, serviceId, maya, online } = await studio()
    await text(slug, 'Can I book my usual?')
    const [usual] = answers()
    expect(usual).toMatchObject({
      recipient: '+447700900456',
      client_id: online,
      status: 'pending',
    })
    // Her text is kept with the same record as the answer, so the Inbox shows one conversation.
    const { state } = await workspace(owner)
    expect(state.replies?.map((r) => r.clientId)).toEqual([online])
    expect(usual.body).toMatch(
      /^Linden Studio AI receptionist: Your usual is Restorative facial with Maya Lind, on Saturday mornings\. Free on Saturday 31 October with Maya Lind: 09:00, /,
    )
    expect(usual.body).not.toMatch(/Grace|£|rosa@/i)
    clock += 60000
    await text(slug, '10:00 please')
    const offer = answers()[1].body
    expect(offer).toContain(
      `${origin}/book/${slug}?service=${serviceId}&staff=${maya}&date=2026-10-31&start=600`,
    )
    expect(offer).toMatch(/Nothing is booked until you confirm on that page/)
    await api.outbox.tick()
    await api.outbox.tick()
    const toRosa = sent.filter((m) => m.body.includes('AI receptionist:'))
    expect(toRosa.map((m) => m.to)).toEqual(['+447700900456', '+447700900456'])
  })

  it('does not know the usual of a number it cannot match to one guest', async () => {
    const { owner, slug } = await studio()
    // Two people with different emails share a phone: neither is known by it.
    for (const [name, email] of [
      ['Ann Hale', 'ann@example.invalid'],
      ['Ben Hale', 'ben@example.invalid'],
    ])
      await run(owner, {
        type: 'client',
        contact: { name, email, phone: '+44 7700 900777', marketingConsent: false },
      })
    const unknown =
      'I cannot tell who is writing from this number, so I do not know your usual. Which treatment would you like? Tell me and I will find you a time. The team can see your message too.'
    await text(slug, 'my usual please', '+447700900777')
    expect(answers()[0].body).toBe(`Linden Studio AI receptionist: ${unknown}`)
    await text(slug, 'Same as last time', '+447700900999')
    expect(answers()[1].body).toBe(`Linden Studio AI receptionist: ${unknown}`)
  })

  it('offers "Book your usual" on the last visit’s private link, and nothing more', async () => {
    const { owner, slug, serviceId, maya, desk, online, visits, token } = await studio()
    const response = await guestVisit(token)
    expect(response.statusCode, response.body).toBe(200)
    const view = response.json<GuestView>()
    expect(view.visit).toMatchObject({ status: 'completed', date: '2026-10-03' })
    expect(view.usual).toEqual({
      path: `/book/${slug}?service=${serviceId}&staff=${maya}&date=2026-10-31`,
      serviceName: 'Restorative facial',
      professional: 'Maya',
      date: '2026-10-31',
    })
    for (const secret of [
      desk,
      online,
      'Rosa',
      'Field',
      'rosa@example.invalid',
      '900456',
      'Grace',
      ...visits.slice(0, -1).flatMap((v) => [v.id]),
      '2026-07-11',
      '2026-08-08',
      '2026-09-05',
    ])
      expect(response.body).not.toContain(secret)
    // Once another visit is booked, under either record, there is no usual to book again.
    await run(owner, {
      type: 'book',
      input: {
        serviceId,
        staffId: maya,
        date: '2026-10-31',
        startMinutes: 600,
        clientId: desk,
        source: 'desk',
      },
    })
    expect((await guestVisit(token)).json<GuestView>().usual).toBeUndefined()
  })

  it('leaves the link out while the studio is not taking bookings online', async () => {
    const { owner, token } = await studio()
    const { name, locationName, address, timeZone } = (await workspace(owner)).state.organisation
    await run(owner, {
      type: 'organisation',
      name,
      locationName,
      address,
      timeZone,
      bookingEnabled: false,
    })
    const view = (await guestVisit(token)).json<GuestView>()
    expect(view.visit.status).toBe('completed')
    expect(view.usual).toBeUndefined()
  })
})
