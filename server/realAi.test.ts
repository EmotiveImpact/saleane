// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { createApiHandler } from './app'
import type { ApiHandler } from './app'
import { aiFromEnv, testAi } from './ai'
import type { AiSupplier } from './ai'
import type { Command } from '../src/domain/commands'
import type { BusinessState } from '../src/domain/model'
import type { MessageProvider, OutgoingMessage } from './messaging/providers'
import type { OutboxRow } from './messaging/outbox'
import type { Usage } from '../lumane'

// NEXT-12: Claude answering Ask SALEANE and the receptionist. Anthropic is pretended by a fetch
// that records each request and answers from a queue, as its Messages API documents.
const origin = 'http://127.0.0.1:5173'
type Login = { cookie: string; csrf: string; orgId: string }
type Sent = { model: string; system: { text: string }[]; messages: unknown[]; tools?: unknown[] }
let api: ApiHandler
let clock = Date.parse('2026-10-06T08:00:00.000Z')
let sent: OutgoingMessage[] = []
afterEach(() => api?.close())

const usage = { input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 4000 }
const words = (text: string) => ({
  content: [{ type: 'text', text }],
  stop_reason: 'end_turn',
  usage,
})
type Answer = Record<string, unknown> | { status: number } | Promise<Record<string, unknown>>
function anthropic(answers: Answer[]) {
  const requests: Sent[] = []
  const fetcher = (async (_url: string, init: RequestInit) => {
    requests.push(JSON.parse(String(init.body)))
    const next = await answers.shift()
    if (!next) throw new Error('No answer left')
    if (typeof next.status === 'number')
      return new Response(JSON.stringify({ type: 'error', error: { type: 'overloaded_error' } }), {
        status: next.status as number,
      })
    return new Response(JSON.stringify(next), { status: 200 })
  }) as unknown as typeof fetch
  return { requests, fetcher }
}
const claude = (fetcher: typeof fetch): AiSupplier =>
  aiFromEnv({ SALEANE_AI_PROVIDER: 'claude', ANTHROPIC_API_KEY: 'test-key' }, fetcher)

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
function start(ai: AiSupplier) {
  clock = Date.parse('2026-10-06T08:00:00.000Z')
  sent = []
  api = createApiHandler({
    origin,
    databasePath: ':memory:',
    now: () => clock,
    turnstile: null,
    ai,
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
}
const headers = (login: Login) => ({ cookie: login.cookie, 'x-csrf-token': login.csrf })
async function register(sample: boolean) {
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
const assistant = (login: Login) =>
  api.inject({ url: `/api/workspaces/${login.orgId}/assistant`, headers: headers(login) })
const ask = (login: Login, text: string) =>
  api.inject({
    method: 'POST',
    url: `/api/workspaces/${login.orgId}/assistant`,
    headers: headers(login),
    payload: { text },
  })
const stored = (login: Login) =>
  JSON.parse(
    api.database.get<{ usage: string }>(
      'SELECT usage FROM assistant_usage WHERE organisation_id=?',
      login.orgId,
    )!.usage,
  ) as Usage

describe('choosing the AI from the environment', () => {
  it('stays in test mode unless Claude is named with its key and a price it knows', () => {
    expect(aiFromEnv({})).toBe(testAi)
    expect(aiFromEnv({ SALEANE_AI_PROVIDER: 'test' })).toBe(testAi)
    expect(() => aiFromEnv({ SALEANE_AI_PROVIDER: 'claude' })).toThrow(
      'Set ANTHROPIC_API_KEY to use Claude.',
    )
    expect(() => aiFromEnv({ SALEANE_AI_PROVIDER: 'gemini' })).toThrow(
      'Unknown AI provider "gemini".',
    )
    expect(() =>
      aiFromEnv({
        SALEANE_AI_PROVIDER: 'claude',
        ANTHROPIC_API_KEY: 'k',
        SALEANE_AI_MODEL: 'claude-new-model',
      }),
    ).toThrow(/Set SALEANE_AI_PRICES .* for claude-new-model/)
    expect(() =>
      aiFromEnv({ SALEANE_AI_PROVIDER: 'claude', ANTHROPIC_API_KEY: 'k', SALEANE_AI_PRICES: '3' }),
    ).toThrow(/two or three positive numbers/)
    const named = aiFromEnv({
      SALEANE_AI_PROVIDER: 'claude',
      ANTHROPIC_API_KEY: 'k',
      SALEANE_AI_MODEL: 'claude-new-model',
      SALEANE_AI_PRICES: '250, 1250',
    })
    expect(named).toMatchObject({ name: 'claude', live: true, model: 'claude-new-model' })
    expect(claude(fetch)).toMatchObject({ live: true, model: 'claude-sonnet-5-5' })
  })
})

describe('Ask SALEANE with Claude', () => {
  it('answers a real studio through Claude and counts what it cost', async () => {
    const { requests, fetcher } = anthropic([
      {
        content: [{ type: 'tool_use', id: 'toolu_1', name: 'day_overview', input: {} }],
        stop_reason: 'tool_use',
        usage,
      },
      words('Nothing is booked today yet.'),
    ])
    start(claude(fetcher))
    const login = await register(false)
    expect((await api.inject({ url: '/api/health' })).json()).toMatchObject({
      services: { ai: true },
    })
    expect((await assistant(login)).json()).toMatchObject({ mode: 'live' })
    const answer = await ask(login, 'What is on today?')
    expect(answer.statusCode, answer.body).toBe(200)
    expect(answer.json()).toMatchObject({
      status: 'answered',
      text: 'Nothing is booked today yet.',
      usage: { used: { typed: 1 } },
    })
    expect(requests).toHaveLength(2)
    expect(requests[0].model).toBe('claude-sonnet-5-5')
    expect(requests[0].system[1].text).toMatch(
      /^Today is Tuesday 6 October \(2026-10-06\) and it is 09:00 at the studio\.\nThe studio is Linden Studio\. Amounts are in GBP\.\nThe person asking is the studio's owner\./,
    )
    expect(requests[0].tools!.length).toBeGreaterThan(20)
    expect(stored(login).spendByDay['2026-10-06']).toBe(0.68)
  })

  it('says plainly when Claude cannot answer, and does not count the question', async () => {
    const { fetcher } = anthropic([{ status: 529 }, { status: 529 }])
    start(claude(fetcher))
    const login = await register(false)
    const answer = await ask(login, 'What is on today?')
    expect(answer.json()).toMatchObject({
      status: 'unavailable',
      text: 'Sorry, I could not answer just now. Nothing was changed. Please try again shortly.',
      proposals: [],
      usage: { used: { typed: 0 } },
    })
  })

  it('keeps a sample studio in test mode, so its fictional records never leave', async () => {
    const { requests, fetcher } = anthropic([])
    start(claude(fetcher))
    const login = await register(true)
    expect((await assistant(login)).json()).toMatchObject({ mode: 'test' })
    const answer = await ask(login, "Who's my 10 o'clock?")
    expect(answer.json()).toMatchObject({ status: 'answered' })
    expect(requests).toEqual([])
  })
})

describe('the receptionist with Claude', () => {
  async function studio() {
    const login = await register(false)
    await run(login, { type: 'resource', input: { name: 'Room One', type: 'treatment' } })
    const serviceId = await run(login, {
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
    await run(login, {
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
    await run(login, {
      type: 'receptionist',
      settings: { enabled: true, handOver: true, texts: true },
    })
    return { login, slug: (await workspace(login)).slug }
  }
  let ref = 0
  const text = (slug: string, body: string, Ref = String(++ref)) =>
    api.inject({
      method: 'POST',
      url: `/api/hooks/twilio/sms/${slug}`,
      headers: {
        origin: 'https://api.twilio.com',
        'content-type': 'application/x-www-form-urlencoded',
      },
      rawPayload: new URLSearchParams({ From: '+447700900456', Body: body, Ref }).toString(),
    })
  const answers = () =>
    api.database.all<OutboxRow>(
      "SELECT * FROM outbox WHERE kind='receptionist' ORDER BY created_at",
    )

  it('thanks the text line first, answers once, and never lets the AI write a fill-in', async () => {
    let release!: (answer: Record<string, unknown>) => void
    const later = new Promise<Record<string, unknown>>((done) => (release = done))
    const { requests, fetcher } = anthropic([later])
    start(claude(fetcher))
    const { slug } = await studio()
    const response = await text(slug, 'When are you open?', 'r1')
    expect(response.statusCode).toBe(200)
    expect(answers()).toEqual([])
    // The same text again while Claude is still answering is not answered twice.
    await text(slug, 'When are you open?', 'r1')
    expect(requests).toHaveLength(1)
    expect(requests[0].system[1].text).toMatch(/writing by text message/)
    expect(requests[0].system[1].text).toMatch(/The guest is a known client, Rosa\./)
    release(words('We are open 9 to 6. Book here: [[booking-link]] {{manage_link}}'))
    await expect.poll(() => answers().length).toBe(1)
    expect(answers()[0].body).toBe(
      `Linden Studio AI receptionist: We are open 9 to 6. Book here: ${origin}/book/${slug} `,
    )
  })

  it('leaves the text for the team when Claude cannot answer, counting only the cost', async () => {
    const { fetcher } = anthropic([{ status: 529 }, { status: 529 }])
    start(claude(fetcher))
    const { login, slug } = await studio()
    expect((await text(slug, 'When are you open?')).statusCode).toBe(200)
    // Anthropic is tried twice, a second apart, before the receptionist gives up.
    await expect
      .poll(() => api.database.get('SELECT 1 FROM assistant_usage'), { timeout: 5000 })
      .toBeTruthy()
    expect(answers()).toEqual([])
    expect(stored(login).used.guestChats).toBe(0)
  })

  it('answers on the booking page and keeps the page free of fill-ins', async () => {
    const { fetcher } = anthropic([
      words('Hello, I am the studio AI receptionist. See [[booking-link]] for times.'),
      { status: 529 },
      { status: 529 },
    ])
    start(claude(fetcher))
    const { login, slug } = await studio()
    const chat = (text: string) =>
      api.inject({
        method: 'POST',
        url: `/api/public/${slug}/receptionist`,
        headers: { origin },
        payload: { text },
      })
    const first = await chat('Hello')
    expect(first.json()).toMatchObject({
      text: 'Hello, I am the studio AI receptionist. See  for times.',
    })
    expect(stored(login).used.guestChats).toBe(1)
    const second = await chat('Hello again')
    expect(second.json()).toMatchObject({
      text: 'Sorry, I cannot answer just now. You can still choose a time on this page, or call the studio.',
      chat: null,
    })
    expect(stored(login).used.guestChats).toBe(1)
  })
})
