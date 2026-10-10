// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApiHandler } from './app'
import type { ApiHandler } from './app'
import { aiFromEnv, testAi } from './ai'
import type { AiSupplier } from './ai'
import { noVoice, voiceFromEnv } from './voice'
import { VoiceError } from '../lumane'
import type { LiveEvent, LiveStart, Usage, VoiceLayer } from '../lumane'

// NEXT-12 part 2: talking to Ask SALEANE. OpenAI's voice is pretended by a layer that records each
// talk and lets the test say what OpenAI reports; Claude is pretended by a fetch, as in
// realAi.test.ts.
const origin = 'http://127.0.0.1:5173'
type Login = { cookie: string; csrf: string; orgId: string }
type Said = { kind: 'answer' | 'note'; id: string; text: string }
let api: ApiHandler
let clock = Date.parse('2026-10-06T08:00:00.000Z')
afterEach(() => {
  vi.useRealTimers()
  api?.close()
})

const usage = { input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 4000 }
const words = (text: string) => ({
  content: [{ type: 'text', text }],
  stop_reason: 'end_turn',
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
  return { requests, fetcher }
}
const claude = (fetcher: typeof fetch): AiSupplier =>
  aiFromEnv({ SALEANE_AI_PROVIDER: 'claude', ANTHROPIC_API_KEY: 'test-key' }, fetcher)

function fakeVoice() {
  const starts: LiveStart[] = []
  const lines: { id: string; said: Said[]; closed: boolean; fire: (e: LiveEvent) => void }[] = []
  const state: { failStart?: Error; failAttach?: boolean } = {}
  const layer: VoiceLayer = {
    name: 'openai',
    live: true,
    model: 'gpt-live-1',
    minorPerMinute: 5,
    async start(input) {
      starts.push(input)
      if (state.failStart) throw state.failStart
      return { id: `live_${starts.length}`, sdp: 'v=0 answer' }
    },
    async attach(id, onEvent) {
      if (state.failAttach) throw new VoiceError('unreachable', 'No line.')
      const entry = { id, said: [] as Said[], closed: false, fire: onEvent }
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
  }
  return { layer, starts, lines, state }
}

function start(ai: AiSupplier, voice: VoiceLayer) {
  clock = Date.parse('2026-10-06T08:00:00.000Z')
  api = createApiHandler({
    origin,
    databasePath: ':memory:',
    now: () => clock,
    turnstile: null,
    ai,
    voice,
  })
}
const headers = (login: Login) => ({ cookie: login.cookie, 'x-csrf-token': login.csrf })
async function register(sample = false, email = 'owner@example.invalid') {
  const response = await api.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: {
      name: 'Ada Owner',
      email,
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
const path = (login: Login, rest = '') => `/api/workspaces/${login.orgId}/assistant${rest}`
const talk = (login: Login) =>
  api.inject({
    method: 'POST',
    url: path(login, '/talk'),
    headers: headers(login),
    payload: { sdp: 'v=0 offer from the browser' },
  })
const read = (login: Login, id: string) =>
  api.inject({ url: path(login, `/talk/${id}`), headers: headers(login) })
const stored = (login: Login) =>
  JSON.parse(
    api.database.get<{ usage: string }>(
      'SELECT usage FROM assistant_usage WHERE organisation_id=?',
      login.orgId,
    )?.usage ?? '{"used":{},"spendByDay":{}}',
  ) as Usage
function used(login: Login, talkSeconds: number) {
  api.database.run(
    'INSERT INTO assistant_usage(organisation_id,usage,updated_at) VALUES(?,?,?)',
    login.orgId,
    JSON.stringify({
      period: '2026-10',
      used: { typed: 0, talkSeconds, guestChats: 0 },
      spendByDay: {},
      recent: {},
    }),
    clock,
  )
}
const day = '2026-10-06'

describe('who can talk', () => {
  it('offers talking only with both OpenAI’s voice and Claude, and never in a sample studio', async () => {
    const voice = fakeVoice()
    start(claude(anthropic([]).fetcher), voice.layer)
    const login = await register()
    expect((await api.inject({ url: '/api/health' })).json()).toMatchObject({
      services: { ai: true, voice: true },
    })
    expect((await api.inject({ url: path(login), headers: headers(login) })).json()).toMatchObject({
      mode: 'live',
      talk: true,
    })
    const sample = await register(true, 'sample@example.invalid')
    expect(
      (await api.inject({ url: path(sample), headers: headers(sample) })).json(),
    ).toMatchObject({ mode: 'test', talk: false })
    expect((await talk(sample)).statusCode).toBe(409)
    expect(voice.starts).toHaveLength(0)
    api.close()

    start(claude(anthropic([]).fetcher), noVoice)
    const quiet = await register()
    expect((await api.inject({ url: path(quiet), headers: headers(quiet) })).json()).toMatchObject({
      mode: 'live',
      talk: false,
    })
    expect(() =>
      createApiHandler({ origin, databasePath: ':memory:', ai: testAi, voice: voice.layer }),
    ).toThrow('Talking needs Claude')
  })

  it('reads the voice from the environment, and refuses to start half set up', () => {
    const claudeOn = { SALEANE_AI_PROVIDER: 'claude', ANTHROPIC_API_KEY: 'k' }
    expect(voiceFromEnv({})).toBe(noVoice)
    expect(voiceFromEnv({ SALEANE_VOICE_PROVIDER: 'test' })).toBe(noVoice)
    expect(() => voiceFromEnv({ SALEANE_VOICE_PROVIDER: 'other' })).toThrow('Unknown voice')
    expect(() => voiceFromEnv({ ...claudeOn, SALEANE_VOICE_PROVIDER: 'openai' })).toThrow(
      'Set OPENAI_API_KEY',
    )
    expect(() => voiceFromEnv({ SALEANE_VOICE_PROVIDER: 'openai', OPENAI_API_KEY: 'k' })).toThrow(
      'Talking needs Claude',
    )
    const env = { ...claudeOn, SALEANE_VOICE_PROVIDER: 'openai', OPENAI_API_KEY: 'k' }
    expect(voiceFromEnv(env)).toMatchObject({ live: true, model: 'gpt-live-1', minorPerMinute: 5 })
    expect(() => voiceFromEnv({ ...env, SALEANE_VOICE_MODEL: 'gpt-live-2' })).toThrow(
      'SALEANE_VOICE_PRICE',
    )
    expect(
      voiceFromEnv({ ...env, SALEANE_VOICE_MODEL: 'gpt-live-2', SALEANE_VOICE_PRICE: '6' }),
    ).toMatchObject({ model: 'gpt-live-2', minorPerMinute: 6 })
  })
})

describe('a talk', () => {
  it('holds its minutes first, answers spoken questions with Claude, and keeps only what it ran', async () => {
    const claudeSide = anthropic([words('Nothing is booked today yet.')])
    const voice = fakeVoice()
    start(claude(claudeSide.fetcher), voice.layer)
    const login = await register()
    const started = await talk(login)
    expect(started.statusCode, started.body).toBe(200)
    const { id, sdp, seconds } = started.json<{ id: string; sdp: string; seconds: number }>()
    expect({ sdp, seconds }).toEqual({ sdp: 'v=0 answer', seconds: 600 })
    expect(id).not.toBe('live_1')
    expect(voice.starts[0]).toMatchObject({ sdp: 'v=0 offer from the browser', voice: 'vesper' })
    expect(voice.starts[0].instructions).toMatch(/team at Linden Studio\./)
    expect(voice.starts[0].instructions).toMatch(/in British English/)
    // Ten minutes and their longest cost, 615 seconds at 5 cents a minute, are held first.
    expect(stored(login)).toMatchObject({
      used: { talkSeconds: 600 },
      spendByDay: { [day]: 51.25 },
    })

    const [line] = voice.lines
    line.fire({ type: 'heard', text: 'What is on ' })
    line.fire({ type: 'heard', text: 'today?' })
    line.fire({ type: 'delegated', id: 'item_1' })
    await expect.poll(() => line.said.length).toBe(2)
    expect(line.said).toEqual([
      {
        kind: 'note',
        id: 'item_1',
        text: 'SALEANE is looking at the studio records now. Nothing has been changed.',
      },
      { kind: 'answer', id: 'item_1', text: 'Nothing is booked today yet.' },
    ])
    expect(claudeSide.requests[0].system[1].text).toMatch(/They are talking, not typing/)
    // A spoken question costs what Claude charged, and is not a typed question.
    expect(stored(login).used.typed).toBe(0)
    expect(stored(login).spendByDay[day]).toBeCloseTo(51.59)

    clock += 95_000
    expect((await read(login, id)).json()).toMatchObject({
      status: 'talking',
      secondsLeft: 505,
      turns: [
        { heard: 'What is on today?', answer: 'Nothing is booked today yet.', proposals: [] },
      ],
    })
    line.fire({ type: 'usage', seconds: 94 })
    line.fire({ type: 'closed', reason: 'close_requested', seconds: 95 })
    expect((await read(login, id)).json()).toMatchObject({ status: 'ended', secondsLeft: 0 })
    // 95 seconds at 5 cents a minute, plus Claude's 0.34.
    expect(stored(login).used.talkSeconds).toBe(95)
    expect(stored(login).spendByDay[day]).toBeCloseTo(95 / 12 + 0.34)
    expect(
      api.database.get<{ n: number }>(
        "SELECT count(*) AS n FROM audit_events WHERE action='assistant.talked' AND organisation_id=?",
        login.orgId,
      )?.n,
    ).toBe(1)
  })

  it('shows a change prepared while talking, to approve on screen like a typed one', async () => {
    const claudeSide = anthropic([
      {
        content: [
          {
            type: 'tool_use',
            id: 'toolu_1',
            name: 'add_reminder',
            input: { text: 'Call Amelia about her patch test', dueDate: '2026-10-07' },
          },
        ],
        stop_reason: 'tool_use',
        usage,
      },
      words('I have prepared a reminder for tomorrow. It is waiting on your screen to approve.'),
    ])
    const voice = fakeVoice()
    start(claude(claudeSide.fetcher), voice.layer)
    const login = await register()
    const { id } = (await talk(login)).json<{ id: string }>()
    const [line] = voice.lines
    line.fire({ type: 'heard', text: 'Remind me to call Amelia tomorrow.' })
    line.fire({ type: 'delegated', id: 'item_1' })
    await expect.poll(() => line.said.length).toBe(2)
    const view = (await read(login, id)).json<{
      turns: { proposals: { id: string; summary: string }[] }[]
    }>()
    const [proposal] = view.turns[0].proposals
    expect(proposal.summary).toMatch(/Call Amelia about her patch test/)
    const approved = await api.inject({
      method: 'POST',
      url: path(login, `/proposals/${proposal.id}`),
      headers: headers(login),
      payload: { approve: true },
    })
    expect(approved.json()).toMatchObject({ outcome: 'approved', command: { type: 'task-add' } })
  })

  it('ends when its window is up, and counts on SALEANE’s own clock if OpenAI goes quiet', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const voice = fakeVoice()
    start(claude(anthropic([]).fetcher), voice.layer)
    const login = await register()
    used(login, 1760)
    const started = (await talk(login)).json<{ id: string; seconds: number }>()
    expect(started.seconds).toBe(40)
    const [line] = voice.lines
    vi.advanceTimersByTime(39_000)
    expect(line.closed).toBe(false)
    vi.advanceTimersByTime(1_000)
    expect(line.closed).toBe(true)
    // OpenAI never confirms. Fifteen seconds later SALEANE counts what its own clock shows.
    clock += 55_000
    vi.advanceTimersByTime(15_000)
    expect((await read(login, started.id)).json()).toMatchObject({ status: 'ended' })
    expect(stored(login).used.talkSeconds).toBe(1760 + 55)
    expect(stored(login).spendByDay[day]).toBeCloseTo(55 / 12)
  })

  it('counts a talk stopped early by its own clock when OpenAI does not confirm the end', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const voice = fakeVoice()
    start(claude(anthropic([]).fetcher), voice.layer)
    const login = await register()
    const { id } = (await talk(login)).json<{ id: string }>()
    clock += 30_000
    const stopped = await api.inject({
      method: 'POST',
      url: path(login, `/talk/${id}/end`),
      headers: headers(login),
      payload: {},
    })
    expect(stopped.json()).toMatchObject({ status: 'talking' })
    expect(voice.lines[0].closed).toBe(true)
    clock += 15_000
    vi.advanceTimersByTime(15_000)
    expect((await read(login, id)).json()).toMatchObject({ status: 'ended' })
    expect(stored(login).used.talkSeconds).toBe(45)
    expect(stored(login).spendByDay[day]).toBeCloseTo(45 / 12)
  })

  it('refuses plainly when the month’s talking time is used up, and gives the hold back when OpenAI cannot start', async () => {
    const voice = fakeVoice()
    start(claude(anthropic([]).fetcher), voice.layer)
    const login = await register()
    used(login, 1775)
    expect((await talk(login)).json()).toMatchObject({
      status: 'refused',
      text: "This month's talking time is used up. It resets on the 1st, or the owner can add Plus. You can still type.",
    })
    expect(voice.starts).toHaveLength(0)
    api.database.run('DELETE FROM assistant_usage WHERE organisation_id=?', login.orgId)

    voice.state.failStart = new VoiceError('busy', 'OpenAI answered 429')
    expect((await talk(login)).json()).toMatchObject({
      status: 'unavailable',
      text: 'Talking is not available just now. You can type your question instead.',
    })
    expect(stored(login)).toMatchObject({ used: { talkSeconds: 0 }, spendByDay: { [day]: 0 } })
    // One that may have reached OpenAI counts its 15 seconds of start-up.
    voice.state.failStart = new VoiceError('unreachable', 'reset')
    await talk(login)
    expect(stored(login).spendByDay[day]).toBeCloseTo(1.25)
    // Without its own line SALEANE could not end the talk, so the browser is not let in.
    voice.state.failStart = undefined
    voice.state.failAttach = true
    expect((await talk(login)).json()).toMatchObject({ status: 'unavailable' })
    expect(stored(login)).toMatchObject({ used: { talkSeconds: 0 } })
    expect(stored(login).spendByDay[day]).toBeCloseTo(2.5)
  })

  it('replaces a talk left open, follows a dropped one to end it, and keeps each to its person', async () => {
    const voice = fakeVoice()
    start(claude(anthropic([]).fetcher), voice.layer)
    const login = await register()
    const first = (await talk(login)).json<{ id: string }>()
    const second = (await talk(login)).json<{ id: string }>()
    expect(voice.lines[0].closed).toBe(true)
    voice.lines[0].fire({ type: 'closed', reason: 'close_requested', seconds: 3 })
    expect((await read(login, first.id)).json()).toMatchObject({ status: 'ended' })

    // The server's line drops: SALEANE follows the talk again, once, to end it.
    voice.lines[1].fire({ type: 'lost' })
    await expect.poll(() => voice.lines.length).toBe(3)
    expect(voice.lines[2]).toMatchObject({ id: 'live_2', closed: true })
    voice.lines[2].fire({ type: 'closed', reason: 'close_requested', seconds: 8 })
    expect((await read(login, second.id)).json()).toMatchObject({ status: 'ended' })
    expect(stored(login).used.talkSeconds).toBe(11)

    const other = await register(false, 'other@example.invalid')
    expect((await read(other, second.id)).statusCode).toBe(404)
    expect(
      (
        await api.inject({
          method: 'POST',
          url: path(other, `/talk/${second.id}/end`),
          headers: headers(other),
          payload: {},
        })
      ).statusCode,
    ).toBe(404)
  })
})
