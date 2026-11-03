// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { createApiHandler } from './app'
import type { ApiHandler } from './app'
import { aiFromEnv } from './ai'
import { phoneFromEnv } from './phoneLine'
import { openaiWebhookGenuine, openaiWebhookSignature } from './openaiWebhook'
import type { LiveEvent, Usage, VoiceLayer } from '../lumane'
import type { BusinessState } from '../src/domain/model'
import type { Command } from '../src/domain/commands'
import type { MessageProvider, OutgoingMessage } from './messaging/providers'
import type { OutboxRow } from './messaging/outbox'
import type { BillingView } from '../src/domain/billing'

// NEXT-17: the phone receptionist. The studio's phone line (Twilio) and OpenAI's voice are
// pretended here; Claude is pretended by a fetch, as in realAi.test.ts.
const origin = 'http://127.0.0.1:5173'
const secret = `whsec_${Buffer.from('a fictional webhook secret').toString('base64')}`
const line = { sipUri: 'sip:proj_fiction@sip.api.openai.com:5061', webhookSecret: secret }
type Login = { cookie: string; csrf: string; orgId: string }
let api: ApiHandler
let clock: number
let sent: OutgoingMessage[]
afterEach(() => api?.close())

const usage = { input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 4000 }
const words = (text: string) => ({
  content: [{ type: 'text', text }],
  stop_reason: 'end_turn',
  usage,
})
const tool = (name: string, input: Record<string, unknown>) => ({
  content: [{ type: 'tool_use', id: `toolu_${name}`, name, input }],
  stop_reason: 'tool_use',
  usage,
})
function anthropic(answers: Record<string, unknown>[]) {
  const requests: { system: { text: string }[] }[] = []
  const fetcher = (async (_url: string, init: RequestInit) => {
    requests.push(JSON.parse(String(init.body)))
    const next = answers.shift()
    if (!next) throw new Error('No answer left')
    return new Response(JSON.stringify(next), { status: 200 })
  }) as unknown as typeof fetch
  return { requests, fetcher, answers }
}

function fakeVoice() {
  const accepted: { id: string; instructions: string; voice: string }[] = []
  const rejected: { id: string; status: number }[] = []
  const hungUp: string[] = []
  const lines: {
    id: string
    said: { kind: string; id: string; text: string }[]
    closed: boolean
    fire: (e: LiveEvent) => void
  }[] = []
  const layer: VoiceLayer = {
    name: 'openai',
    live: true,
    model: 'gpt-live-1',
    minorPerMinute: 5,
    start: async () => ({ id: 'unused', sdp: '' }),
    async attach(id, onEvent) {
      const entry = { id, said: [] as (typeof lines)[0]['said'], closed: false, fire: onEvent }
      lines.push(entry)
      return {
        answer: (d, text) => entry.said.push({ kind: 'answer', id: d, text }),
        note: (d, text) => entry.said.push({ kind: 'note', id: d, text }),
        close: () => {
          entry.closed = true
        },
        detach: () => {},
      }
    },
    calls: {
      accept: async (id, input) => {
        accepted.push({ id, ...input })
      },
      reject: async (id, status) => {
        rejected.push({ id, status })
      },
      hangup: async (id) => {
        hungUp.push(id)
      },
    },
  }
  return { layer, accepted, rejected, hungUp, lines }
}

function recording(channel: 'email' | 'sms'): MessageProvider {
  return {
    name: channel === 'email' ? 'postmark' : 'twilio',
    live: true,
    channel,
    send: async (message) => {
      if (message.fromName === 'SALEANE') return { outcome: 'test' }
      sent.push(message)
      return { outcome: 'accepted', providerRef: `ref-${sent.length}` }
    },
  }
}

function start(answers: Record<string, unknown>[], phone: typeof line | null = line) {
  clock = Date.parse('2026-10-06T07:00:00.000Z')
  sent = []
  const claude = anthropic(answers)
  const voice = fakeVoice()
  const legs: (string | undefined)[] = []
  api = createApiHandler({
    origin,
    databasePath: ':memory:',
    now: () => clock,
    turnstile: null,
    ai: aiFromEnv({ SALEANE_AI_PROVIDER: 'claude', ANTHROPIC_API_KEY: 'test-key' }, claude.fetcher),
    voice: voice.layer,
    phone,
    providers: {
      email: recording('email'),
      sms: recording('sms'),
      receipt: () => null,
      // Stands in for Twilio's signature check, which calls.test.ts tests on its own.
      voice: (_slug, request, leg) => {
        if (request.headers['x-test-signature'] !== 'good') return null
        legs.push(leg)
        const form = new URLSearchParams(request.body)
        return { from: form.get('From') ?? '', missed: form.get('DialCallStatus') !== 'completed' }
      },
    },
  })
  return { claude, voice, legs }
}

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
let clientId: string
/** A studio taking online bookings, with the AI receptionist answering calls, and paid for. */
async function studio({ calls = true, phone = true } = {}) {
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
  await run(login, {
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
  const { name, locationName, address, timeZone } = (await workspace(login)).state.organisation
  await run(login, {
    type: 'organisation',
    name,
    locationName,
    address,
    timeZone,
    bookingEnabled: true,
  })
  await run(login, { type: 'receptionist', settings: { enabled: true, handOver: true, calls } })
  // A paid month, with the phone receptionist when chosen.
  await billing(login)
  api.database.run(
    "UPDATE studio_plans SET status='active',period_start=?,period_end=?,anchor_day=6,phone=?,phone_next=? WHERE organisation_id=?",
    clock,
    clock + 30 * 86_400_000,
    phone ? 1 : 0,
    phone ? 1 : 0,
    login.orgId,
  )
  return { login, slug: (await workspace(login)).slug }
}
const billing = async (login: Login) =>
  (
    await api.inject({ url: `/api/workspaces/${login.orgId}/billing`, headers: headers(login) })
  ).json<BillingView>()

const missed = (slug: string, status = 'no-answer', leg = '') =>
  api.inject({
    method: 'POST',
    url: `/api/hooks/twilio/voice/${slug}${leg}`,
    headers: {
      'x-test-signature': 'good',
      origin: 'https://api.twilio.com',
      'content-type': 'application/x-www-form-urlencoded',
    },
    rawPayload: new URLSearchParams({ From: '+447700900456', DialCallStatus: status }).toString(),
  })
let hook = 0
function openai(event: Record<string, unknown>, id = `wh_${++hook}`, sign = secret) {
  const body = JSON.stringify(event)
  const timestamp = String(Math.floor(clock / 1000))
  return api.inject({
    method: 'POST',
    url: '/api/hooks/openai',
    headers: {
      'content-type': 'application/json',
      'webhook-id': id,
      'webhook-timestamp': timestamp,
      'webhook-signature': openaiWebhookSignature(sign, id, timestamp, body),
    },
    rawPayload: body,
  })
}
const incoming = (sessionId: string, code?: string) => ({
  type: 'live.transport.incoming',
  data: {
    type: 'sip',
    session_id: sessionId,
    sip_headers: code ? [{ name: 'X-Saleane-Call', value: code }] : [],
  },
})
const codeIn = (twiml: string) => /x-saleane-call=([A-Za-z0-9_-]+)/.exec(twiml)?.[1]
const stored = (login: Login) =>
  JSON.parse(
    api.database.get<{ usage: string }>(
      'SELECT usage FROM assistant_usage WHERE organisation_id=?',
      login.orgId,
    )?.usage ?? '{"used":{},"spendByDay":{}}',
  ) as Usage
const texts = () =>
  api.database.all<OutboxRow>("SELECT * FROM outbox WHERE kind='receptionist' ORDER BY created_at")

describe('OpenAI webhook signatures', () => {
  const body = '{"type":"live.transport.incoming"}'
  const now = Date.parse('2026-10-06T07:00:00.000Z')
  const ts = String(now / 1000)
  const signed = (signature: string, timestamp = ts) => ({
    'webhook-id': 'wh_1',
    'webhook-timestamp': timestamp,
    'webhook-signature': signature,
  })
  it('takes only a signature made with the secret, within five minutes', () => {
    const good = openaiWebhookSignature(secret, 'wh_1', ts, body)
    expect(openaiWebhookGenuine(secret, signed(good), body, now)).toBe(true)
    // Several signatures, as when a secret is being changed: any one that matches will do.
    expect(openaiWebhookGenuine(secret, signed(`v1,AAAA ${good}`), body, now)).toBe(true)
    expect(openaiWebhookGenuine(secret, signed(good), `${body} `, now)).toBe(false)
    const other = `whsec_${Buffer.from('another secret').toString('base64')}`
    expect(openaiWebhookGenuine(other, signed(good), body, now)).toBe(false)
    expect(openaiWebhookGenuine(secret, signed(good), body, now + 301_000)).toBe(false)
    expect(openaiWebhookGenuine(secret, signed(good), body, now - 301_000)).toBe(false)
    expect(openaiWebhookGenuine(secret, {}, body, now)).toBe(false)
  })

  it('reads the phone line from the environment only when it is complete', () => {
    expect(phoneFromEnv({})).toBeNull()
    expect(() => phoneFromEnv({ OPENAI_PROJECT_ID: 'proj_abc' })).toThrow(/both/)
    expect(() =>
      phoneFromEnv({ OPENAI_PROJECT_ID: 'proj_abc', OPENAI_WEBHOOK_SECRET: secret }),
    ).toThrow(/SALEANE_VOICE_PROVIDER=openai/)
    expect(() =>
      phoneFromEnv({
        OPENAI_PROJECT_ID: 'abc',
        OPENAI_WEBHOOK_SECRET: secret,
        SALEANE_VOICE_PROVIDER: 'openai',
      }),
    ).toThrow(/proj_/)
    expect(
      phoneFromEnv({
        OPENAI_PROJECT_ID: 'proj_abc',
        OPENAI_WEBHOOK_SECRET: secret,
        SALEANE_VOICE_PROVIDER: 'openai',
      }),
    ).toEqual({ sipUri: 'sip:proj_abc@sip.api.openai.com:5061', webhookSecret: secret })
  })
})

describe('the AI receptionist answering calls the desk misses', () => {
  it('answers a missed call, texts a link to book and writes the call down for the desk', async () => {
    const { voice, claude, legs } = start([])
    const { login, slug } = await studio()
    claude.answers.push(
      tool('offer_time', { treatmentId: serviceId, date: '2026-10-08', time: '11:00' }),
      words('I will text you a link to book Thursday at 11. Nothing is booked until you confirm.'),
    )
    const handed = await missed(slug)
    expect(handed.statusCode).toBe(200)
    expect(handed.body).toContain('<Dial action="http://127.0.0.1:5173/api/hooks/twilio/voice/')
    expect(handed.body).toContain(`/${slug}/ai" timeout="15" answerOnBridge="true">`)
    expect(handed.body).toContain(
      '<Sip>sip:proj_fiction@sip.api.openai.com:5061;transport=tls;secure=true?x-saleane-call=',
    )
    expect(legs).toEqual([undefined])
    const code = codeIn(handed.body)!
    // Handed to the AI, so not yet a missed call.
    expect((await workspace(login)).state.operations?.missedCalls ?? []).toEqual([])

    expect((await openai(incoming('sess_1', code))).statusCode).toBe(200)
    await api.phone.settled()
    expect(voice.accepted).toHaveLength(1)
    expect(voice.accepted[0].id).toBe('sess_1')
    expect(voice.accepted[0].instructions).toMatch(/AI receptionist for Linden Studio/)
    expect(voice.accepted[0].instructions).toMatch(/in British English/)
    // Ten minutes are held for the call before it is answered.
    expect(stored(login).used.phoneSeconds).toBe(600)

    const [call] = voice.lines
    call.fire({ type: 'heard', text: 'Could I book a facial on Thursday at eleven?' })
    call.fire({ type: 'delegated', id: 'item_1' })
    await expect.poll(() => call.said.length).toBe(2)
    expect(call.said[1]).toEqual({
      kind: 'answer',
      id: 'item_1',
      text: 'I will text you a link to book Thursday at 11. Nothing is booked until you confirm.',
    })
    expect(claude.requests[0].system.map((part) => part.text).join('\n')).toMatch(
      /calling the studio's phone/,
    )
    // The link goes out as a text, once, through the outbox.
    expect(texts()).toMatchObject([
      { status: 'pending', channel: 'sms', recipient: '+447700900456' },
    ])
    expect(texts()[0].slot).toMatch(/^call:/)
    expect(texts()[0].body).toContain(
      `${origin}/book/${slug}?service=${serviceId}&staff=any&date=2026-10-08&start=660`,
    )
    expect(texts()[0].body).toMatch(/Nothing is booked until you confirm on that page\.$/)
    // The question on the call left a record of what it did, without the words or the number.
    const turns = api.database.all<Record<string, unknown>>('SELECT * FROM assistant_turns')
    expect(turns).toMatchObject([
      { audience: 'guests', doorway: 'phone', account_id: null, status: 'answered', prepared: 1 },
    ])
    expect(JSON.parse(String(turns[0].skills))).toContainEqual({
      skill: 'offer_time',
      outcome: 'proposed',
    })
    expect(JSON.stringify(turns)).not.toMatch(/facial|7700/i)
    await api.outbox.tick()
    expect(sent).toHaveLength(1)
    expect(texts()[0].status).toBe('accepted')

    clock += 125_000
    call.fire({ type: 'closed', reason: 'hangup', seconds: 125 })
    // Counted from what OpenAI reported, and written down for the desk.
    expect(stored(login).used.phoneSeconds).toBe(125)
    const answered = (await workspace(login)).state.operations?.answeredCalls ?? []
    expect(answered).toMatchObject([
      {
        number: '+447700900456',
        seconds: 125,
        clientId,
        texted: ['Restorative facial, Thursday 8 October at 11:00'],
        turns: [
          { from: 'guest', text: 'Could I book a facial on Thursday at eleven?' },
          { from: 'receptionist' },
        ],
      },
    ])

    // OpenAI sending the same event again changes nothing.
    expect((await openai(incoming('sess_1', code), `wh_${hook}`)).statusCode).toBe(200)
    await api.phone.settled()
    expect(voice.accepted).toHaveLength(1)

    // The desk follows it up.
    await run(login, { type: 'answered-call-done', callId: answered[0].id })
    expect((await workspace(login)).state.operations?.answeredCalls?.[0]).toMatchObject({
      doneAt: expect.any(String),
    })
  })

  it('turns away a call nobody handed over, and a code used twice', async () => {
    const { voice } = start([])
    const { slug } = await studio()
    await openai(incoming('sess_stranger'))
    await api.phone.settled()
    expect(voice.rejected).toEqual([{ id: 'sess_stranger', status: 603 }])
    const code = codeIn((await missed(slug)).body)!
    await openai(incoming('sess_2', code))
    await openai(incoming('sess_3', code))
    await api.phone.settled()
    expect(voice.accepted.map((a) => a.id)).toEqual(['sess_2'])
    expect(voice.rejected).toContainEqual({ id: 'sess_3', status: 603 })
  })

  it('refuses a webhook that is not signed with the project’s secret', async () => {
    start([])
    await studio()
    const forged = await openai(
      incoming('sess_1', 'x'),
      'wh_forged',
      `whsec_${Buffer.from('not the secret').toString('base64')}`,
    )
    expect(forged.statusCode).toBe(400)
  })

  it('leaves the missed call as before when the AI cannot take it', async () => {
    start([])
    const { login, slug } = await studio({ phone: false })
    const reply = await missed(slug)
    expect(reply.body).toContain('<Say>Sorry we missed your call.')
    expect((await workspace(login)).state.operations?.missedCalls).toHaveLength(1)
  })

  it('writes down a missed call when the handed-over call does not reach the AI', async () => {
    const { legs } = start([])
    const { login, slug } = await studio()
    const reached = await missed(slug, 'completed', '/ai')
    expect(reached.body).toBe('<?xml version="1.0" encoding="UTF-8"?><Response/>')
    const failed = await missed(slug, 'failed', '/ai')
    expect(failed.body).toContain('<Say>Sorry we missed your call.')
    expect(legs).toEqual(['ai', 'ai'])
    expect((await workspace(login)).state.operations?.missedCalls).toHaveLength(1)
  })

  it('ends a call when its minutes run out, and hangs up calls still running on shutdown', async () => {
    const { voice } = start([])
    const { login, slug } = await studio()
    // Five minutes left this month: the call may run for five.
    api.database.run(
      'INSERT OR REPLACE INTO assistant_usage(organisation_id,usage,updated_at) VALUES(?,?,?)',
      login.orgId,
      JSON.stringify({
        period: '2026-10',
        used: { typed: 0, talkSeconds: 0, guestChats: 0, phoneSeconds: 300 * 60 - 300 },
        spendByDay: {},
        recent: {},
      }),
      clock,
    )
    await openai(incoming('sess_short', codeIn((await missed(slug)).body)))
    await api.phone.settled()
    expect(voice.accepted).toHaveLength(1)
    voice.lines[0].fire({ type: 'usage', seconds: 300 })
    expect(voice.hungUp).toEqual(['sess_short'])
    expect(voice.lines[0].closed).toBe(true)
  })
})

describe('the phone receptionist on the plan', () => {
  it('cannot be bought until calls are connected', async () => {
    start([], null)
    const { login } = await studio({ phone: false })
    const view = await billing(login)
    expect(view.phoneConnected).toBe(false)
    const refused = await api.inject({
      method: 'POST',
      url: `/api/workspaces/${login.orgId}/billing/phone`,
      headers: headers(login),
      payload: { on: true },
    })
    expect(refused.statusCode).toBe(409)
  })

  it('is charged for the rest of the month, then on every monthly bill', async () => {
    start([])
    const { login } = await studio({ phone: false })
    api.database.run(
      "UPDATE studio_plans SET card_customer_ref='cus_test',card_method_ref='pm_test',card_brand='Visa',card_last4='4242' WHERE organisation_id=?",
      login.orgId,
    )
    // Halfway through the paid month.
    api.database.run(
      'UPDATE studio_plans SET period_start=?,period_end=? WHERE organisation_id=?',
      clock - 15 * 86_400_000,
      clock + 15 * 86_400_000,
      login.orgId,
    )
    const added = await api.inject({
      method: 'POST',
      url: `/api/workspaces/${login.orgId}/billing/phone`,
      headers: headers(login),
      payload: { on: true },
    })
    expect(added.statusCode, added.body).toBe(200)
    const view = added.json<{ outcome: string; billing: BillingView }>()
    expect(view.outcome).toBe('paid')
    expect(view.billing).toMatchObject({ phone: true, phoneNext: true, phoneConnected: true })
    expect(view.billing.invoices[0]).toMatchObject({ kind: 'phone', status: 'paid' })
    expect(view.billing.invoices[0].lines[0].text).toBe(
      'Phone receptionist, 1 location, for the 15 days left of 30',
    )
    // Half of £79, with VAT.
    expect(view.billing.invoices[0].totalMinor).toBe(Math.round(3950 * 1.2))
    expect(view.billing.nextBill?.bill.lines.map((l) => l.text)).toContain(
      'Phone receptionist, 1 location',
    )
    expect(view.billing.ai.phoneSeconds).toEqual({ used: 0, of: 300 * 60 })
    const status = await api.inject({
      url: `/api/workspaces/${login.orgId}/phone`,
      headers: headers(login),
    })
    expect(status.json()).toEqual({
      connected: true,
      included: true,
      chosen: true,
      answering: true,
      minutes: { used: 0, of: 300 },
    })
  })
})
