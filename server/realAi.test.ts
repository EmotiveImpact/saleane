// @vitest-environment node
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
function start(
  ai: AiSupplier,
  databasePath = ':memory:',
  at = '2026-10-06T08:00:00.000Z',
  options: { missedAgainMs?: number } = {},
) {
  clock = Date.parse(at)
  sent = []
  api = createApiHandler({
    ...options,
    origin,
    databasePath,
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
    )?.usage ?? '{"used":{},"spendByDay":{}}',
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

  it('holds each question’s share first, so two at once cannot pass the day’s ceiling together', async () => {
    let release!: (answer: Record<string, unknown>) => void
    const later = new Promise<Record<string, unknown>>((done) => (release = done))
    const { requests, fetcher } = anthropic([later])
    start(claude(fetcher))
    const login = await register(false)
    // 140 of the day's 150 spent: room for one more question's 6, not two.
    api.database.run(
      'INSERT INTO assistant_usage(organisation_id,usage,updated_at) VALUES(?,?,?)',
      login.orgId,
      JSON.stringify({
        period: '2026-10',
        used: { typed: 4, talkSeconds: 0, guestChats: 0 },
        spendByDay: { '2026-10-06': 140 },
        recent: {},
      }),
      clock,
    )
    const first = ask(login, 'What is on today?')
    await expect.poll(() => requests.length).toBe(1)
    expect(stored(login)).toMatchObject({ used: { typed: 5 }, spendByDay: { '2026-10-06': 146 } })
    const second = await ask(login, 'And tomorrow?')
    expect(second.json()).toMatchObject({
      status: 'refused',
      text: "The assistant has reached today's limit. It will be back tomorrow.",
    })
    expect(requests).toHaveLength(1)
    release(words('Nothing is booked today yet.'))
    expect((await first).json()).toMatchObject({
      status: 'answered',
      usage: { used: { typed: 5 } },
    })
    // What the question really cost replaces the 6 held for it.
    expect(stored(login).spendByDay['2026-10-06']).toBe(140.34)
  })

  it('gives back a question held by a request that never finished, once its time has passed', async () => {
    const { requests, fetcher } = anthropic([words('Nothing is booked today yet.')])
    start(claude(fetcher))
    const login = await register(false)
    // The month's 300 questions are used, one of them held at 07:50 by a request SALEANE never
    // settled (it stopped mid-answer). Its five minutes are up, so its question comes back.
    const held = {
      meter: 'typed',
      amount: 1,
      personId: 'someone',
      at: '2026-10-06T07:50:00.000Z',
      worstCaseMinor: 6,
    }
    api.database.run(
      'INSERT INTO assistant_usage(organisation_id,usage,updated_at) VALUES(?,?,?)',
      login.orgId,
      JSON.stringify({
        period: '2026-10',
        used: { typed: 300, talkSeconds: 0, guestChats: 0 },
        spendByDay: { '2026-10-06': 20 },
        recent: {},
        holds: [{ request: held, until: '2026-10-06T07:55:00.000Z' }],
      }),
      clock,
    )
    const answer = await ask(login, 'What is on today?')
    expect(answer.json()).toMatchObject({ status: 'answered', usage: { used: { typed: 300 } } })
    expect(requests).toHaveLength(1)
    // The day's 20 already counts its worst case of 6, which stays, as what it cost is unknown.
    expect(stored(login)).toMatchObject({
      used: { typed: 300 },
      spendByDay: { '2026-10-06': 20.34 },
      holds: [],
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

  it('answers a text thanked but left unanswered when SALEANE stopped, once it starts again', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'saleane-missed-')), 'studio.sqlite')
    let stop!: (error: Error) => void
    const stuck = () => anthropic([new Promise((_, fail) => (stop = fail))])
    let first = stuck()
    start(claude(first.fetcher), file)
    const { slug } = await studio()
    expect((await text(slug, 'When are you open?', 'm1')).statusCode).toBe(200)
    await expect.poll(() => first.requests.length).toBe(1)
    // SALEANE stops while Claude is answering. Twilio was thanked, so it will not send it again.
    api.close()
    stop(new Error('SALEANE stopped'))
    await new Promise((done) => setTimeout(done, 20))
    const { requests, fetcher } = anthropic([words('We are open 9 to 6.')])
    start(claude(fetcher), file, '2026-10-06T08:04:00.000Z')
    await expect.poll(() => answers().length).toBe(1)
    expect(answers()[0].body).toBe('Linden Studio AI receptionist: We are open 9 to 6.')
    expect(requests).toHaveLength(1)
    // Answered, it is not answered again on the next start.
    api.close()
    first = stuck()
    start(claude(first.fetcher), file, '2026-10-06T08:05:00.000Z')
    expect((await text(slug, 'Are you open on Sunday?', 'm2')).statusCode).toBe(200)
    await expect.poll(() => first.requests.length).toBe(1)
    api.close()
    stop(new Error('SALEANE stopped'))
    await new Promise((done) => setTimeout(done, 20))
    // Started again eleven minutes on, the message is left for the team rather than answered late.
    const late = anthropic([])
    start(claude(late.fetcher), file, '2026-10-06T08:16:00.000Z')
    await new Promise((done) => setTimeout(done, 50))
    expect(late.requests).toEqual([])
    expect(answers()).toHaveLength(1)
  })

  it('answers a text its own stopped request kept from the last guest chat, once that hold runs out', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'saleane-held-')), 'studio.sqlite')
    let stop!: (error: Error) => void
    const first = anthropic([new Promise((_, fail) => (stop = fail))])
    start(claude(first.fetcher), file)
    const { login, slug } = await studio()
    // 199 of the month's 200 guest chats are used, so this text's chat is the last.
    api.database.run(
      'INSERT OR REPLACE INTO assistant_usage(organisation_id,usage,updated_at) VALUES(?,?,?)',
      login.orgId,
      JSON.stringify({
        period: '2026-10',
        used: { typed: 0, talkSeconds: 0, guestChats: 199 },
        spendByDay: {},
        recent: {},
      }),
      clock,
    )
    expect((await text(slug, 'When are you open?', 'm1')).statusCode).toBe(200)
    await expect.poll(() => first.requests.length).toBe(1)
    api.close()
    stop(new Error('SALEANE stopped'))
    await new Promise((done) => setTimeout(done, 20))
    // Started again two minutes on, the stopped request still holds that last chat.
    const { requests, fetcher } = anthropic([words('We are open 9 to 6.')])
    start(claude(fetcher), file, '2026-10-06T08:02:00.000Z', { missedAgainMs: 200 })
    await new Promise((done) => setTimeout(done, 50))
    expect(requests).toEqual([])
    expect(stored(login).used.guestChats).toBe(200)
    // Its five minutes are up when SALEANE looks again, so the chat comes back and is answered.
    clock = Date.parse('2026-10-06T08:06:00.000Z')
    await expect.poll(() => answers().length).toBe(1)
    expect(answers()[0].body).toBe('Linden Studio AI receptionist: We are open 9 to 6.')
    expect(requests).toHaveLength(1)
    expect(stored(login)).toMatchObject({ used: { guestChats: 200 }, holds: [] })
  })

  it('tries again later only a text the allowance refused, not one Claude could not answer', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'saleane-busy-')), 'studio.sqlite')
    let stop!: (error: Error) => void
    const first = anthropic([new Promise((_, fail) => (stop = fail))])
    start(claude(first.fetcher), file)
    const { slug } = await studio()
    expect((await text(slug, 'When are you open?', 'm1')).statusCode).toBe(200)
    await expect.poll(() => first.requests.length).toBe(1)
    api.close()
    stop(new Error('SALEANE stopped'))
    await new Promise((done) => setTimeout(done, 20))
    // Started again, Anthropic is busy for the text, tried twice a second apart: it is left for
    // the team, and the later look does not ask Claude again.
    const busy = anthropic([{ status: 529 }, { status: 529 }])
    start(claude(busy.fetcher), file, '2026-10-06T08:02:00.000Z', { missedAgainMs: 1500 })
    await expect.poll(() => busy.requests.length, { timeout: 3000 }).toBe(2)
    clock = Date.parse('2026-10-06T08:08:00.000Z')
    await new Promise((done) => setTimeout(done, 2000))
    expect(busy.requests).toHaveLength(2)
    expect(answers()).toEqual([])
  })

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
    // The chat's share is held while Anthropic is tried twice, a second apart, then given back.
    await expect.poll(() => stored(login).used.guestChats).toBe(1)
    await expect.poll(() => stored(login).used.guestChats, { timeout: 5000 }).toBe(0)
    expect(stored(login).spendByDay['2026-10-06']).toBe(0)
    expect(answers()).toEqual([])
  })

  it('answers a second text after the first, as the same chat and in order', async () => {
    let release!: (answer: Record<string, unknown>) => void
    const later = new Promise<Record<string, unknown>>((done) => (release = done))
    const { requests, fetcher } = anthropic([later, words('On Sunday we are closed.')])
    start(claude(fetcher))
    const { login, slug } = await studio()
    await text(slug, 'When are you open?', 'r1')
    await text(slug, 'And on Sunday?', 'r2')
    // The second waits for the first to be answered.
    expect(requests).toHaveLength(1)
    release(words('We are open 9 to 6, Monday to Saturday.'))
    await expect.poll(() => answers().length).toBe(2)
    expect(answers().map((a) => a.body)).toEqual([
      'Linden Studio AI receptionist: We are open 9 to 6, Monday to Saturday.',
      'Linden Studio AI receptionist: On Sunday we are closed.',
    ])
    expect(requests[1].messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'When are you open?' }] },
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'We are open 9 to 6, Monday to Saturday.' }],
      },
      { role: 'user', content: [{ type: 'text', text: 'And on Sunday?' }] },
    ])
    expect(stored(login).used.guestChats).toBe(1)
  })

  it('does not send its answer when someone from the studio replied meanwhile', async () => {
    let release!: (answer: Record<string, unknown>) => void
    const later = new Promise<Record<string, unknown>>((done) => (release = done))
    const { requests, fetcher } = anthropic([later])
    start(claude(fetcher))
    const { login, slug } = await studio()
    await text(slug, 'Can I bring my daughter?', 'r1')
    expect(requests).toHaveLength(1)
    // Maya answers Rosa herself while Claude is still writing.
    api.database.run(
      `INSERT INTO outbox(id,organisation_id,dedupe_key,appointment_id,client_id,kind,channel,slot,recipient,subject,body,status,next_attempt_at,created_at,updated_at)
       VALUES('team-1',?,'team-1','','','message','sms','team-1','+447700900456','','Of course, see you then.','accepted',?,?,?)`,
      login.orgId,
      clock,
      clock,
      clock,
    )
    release(words('Yes, children are welcome.'))
    // Its cost is kept; the chat is not counted and nothing is sent.
    await expect.poll(() => stored(login).spendByDay['2026-10-06']).toBe(0.34)
    expect(stored(login).used.guestChats).toBe(0)
    expect(answers()).toEqual([])
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
