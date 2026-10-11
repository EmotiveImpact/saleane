import { describe, expect, it } from 'vitest'
import { MAX_UPDATE_CHARS, liveEvent, openaiLive, updates } from './live'
import type { LiveEvent, LiveSocket } from './live'

// OpenAI's GPT-Live, pretended by a fetch and a socket that record what SALEANE sends and answer
// as OpenAI's Live API documents (sessions, the server's own connection, client delegation).
type Listener = (event: { data?: unknown }) => void
function fakeSocket() {
  const listeners: Record<string, Listener[]> = {}
  const sent: Record<string, unknown>[] = []
  let closed = false
  const socket: LiveSocket = {
    send: (data) => sent.push(JSON.parse(data)),
    close: () => {
      closed = true
      for (const listener of listeners.close ?? []) listener({})
    },
    addEventListener: (type, listener) => (listeners[type] ??= []).push(listener),
  }
  const fire = (type: string, data?: unknown) => {
    for (const listener of listeners[type] ?? []) listener({ data })
  }
  return {
    socket,
    sent,
    open: () => fire('open'),
    fail: () => fire('error'),
    drop: () => fire('close'),
    event: (event: Record<string, unknown>) => fire('message', JSON.stringify(event)),
    closed: () => closed,
  }
}

function voice(answer: () => Response | Promise<Response>) {
  const requests: { url: string; init: RequestInit }[] = []
  const sockets: { url: string; headers: Record<string, string> }[] = []
  const fake = fakeSocket()
  const layer = openaiLive({
    apiKey: 'test-key',
    model: 'gpt-live-1',
    minorPerMinute: 5,
    timeoutMs: 200,
    fetcher: (async (url: string, init: RequestInit) => {
      requests.push({ url, init })
      return answer()
    }) as unknown as typeof fetch,
    connect: (url, headers) => {
      sockets.push({ url, headers })
      return fake.socket
    },
  })
  return { layer, requests, sockets, fake }
}
const created = () =>
  new Response(
    JSON.stringify({
      session: { id: 'live_123', object: 'live.session' },
      transport: { type: 'webrtc', sdp: 'v=0 answer' },
    }),
    { status: 201 },
  )

describe('starting a talk with OpenAI', () => {
  it('starts a session for the browser’s offer, with the key kept on the server', async () => {
    const { layer, requests } = voice(created)
    const session = await layer.start({
      sdp: 'v=0 offer',
      instructions: 'Be kind.',
      voice: 'vesper',
    })
    expect(session).toEqual({ id: 'live_123', sdp: 'v=0 answer' })
    expect(requests).toHaveLength(1)
    const [{ url, init }] = requests
    expect(url).toBe('https://api.openai.com/v1/live/sessions')
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer test-key',
      'Content-Type': 'application/json',
    })
    expect(JSON.parse(String(init.body))).toEqual({
      session: {
        model: 'gpt-live-1',
        instructions: 'Be kind.',
        store: false,
        audio: { output: { voice: 'vesper' } },
        delegation: { type: 'client' },
        client: {
          data_channel: {
            allowed_client_events: ['session.close'],
            allowed_server_events: [{ type: 'session.closed' }],
          },
        },
      },
      transport: { type: 'webrtc', sdp: 'v=0 offer' },
    })
    expect(layer).toMatchObject({ name: 'openai', live: true, minorPerMinute: 5 })
  })

  it('names why a session could not start', async () => {
    const kind = async (answer: () => Response | Promise<Response>) =>
      voice(answer)
        .layer.start({ sdp: 'v=0', instructions: '', voice: 'vesper' })
        .catch((error: { kind: string }) => error.kind)
    expect(await kind(() => new Response('{}', { status: 401 }))).toBe('refused')
    expect(await kind(() => new Response('{}', { status: 429 }))).toBe('busy')
    expect(await kind(() => new Response('{}', { status: 503 }))).toBe('unreachable')
    expect(await kind(() => new Response('{}', { status: 400 }))).toBe('failed')
    expect(await kind(() => Promise.reject(new Error('reset')))).toBe('unreachable')
    expect(await kind(() => new Response('{"session":{"id":"live_1"}}', { status: 201 }))).toBe(
      'failed',
    )
  })
})

describe('phone calls with OpenAI', () => {
  it('answers, turns away and hangs up a call by its session id', async () => {
    const { layer, requests } = voice(() => new Response('', { status: 200 }))
    await layer.calls!.accept('rtc_1/x', { instructions: 'Answer the phone.', voice: 'vesper' })
    await layer.calls!.reject('rtc_2', 486)
    await layer.calls!.hangup('rtc_1/x')
    expect(requests.map((r) => r.url)).toEqual([
      'https://api.openai.com/v1/live/sessions/rtc_1%2Fx/accept',
      'https://api.openai.com/v1/live/sessions/rtc_2/reject',
      'https://api.openai.com/v1/live/sessions/rtc_1%2Fx/hangup',
    ])
    expect(JSON.parse(String(requests[0].init.body))).toEqual({
      session: {
        type: 'live',
        model: 'gpt-live-1',
        instructions: 'Answer the phone.',
        store: false,
        audio: { output: { voice: 'vesper' } },
        delegation: { type: 'client' },
      },
    })
    expect(JSON.parse(String(requests[1].init.body))).toEqual({ status_code: 486 })
    expect(requests[2].init.body).toBeUndefined()
    expect(requests[2].init.headers).toEqual({ Authorization: 'Bearer test-key' })
  })

  it('names why a call could not be answered', async () => {
    const failed = await voice(() => new Response('{}', { status: 404 }))
      .layer.calls!.accept('rtc_1', { instructions: '', voice: 'vesper' })
      .catch((error: { kind: string }) => error.kind)
    expect(failed).toBe('failed')
  })
})

describe('following a talk', () => {
  it('connects with the key, and hears the session in SALEANE’s own words', async () => {
    const { layer, sockets, fake } = voice(created)
    const events: LiveEvent[] = []
    const attached = layer.attach('live_123', (event) => events.push(event))
    fake.open()
    await attached
    expect(sockets).toEqual([
      {
        url: 'wss://api.openai.com/v1/live/sessions/live_123/attach',
        headers: { Authorization: 'Bearer test-key' },
      },
    ])
    fake.event({
      type: 'session.input_transcript.delta',
      delta: 'Who is ',
      start_ms: 0,
      end_ms: 640,
    })
    fake.event({ type: 'session.output_transcript.delta', delta: 'Let me look.' })
    fake.event({
      type: 'session.delegation.created',
      offset_ms: 1200,
      delegation: { id: 'item_1', type: 'delegation', target: 'client' },
    })
    fake.event({ type: 'session.usage.updated', usage: { seconds: 12.5 } })
    fake.event({ type: 'session.commentary.appended', client_event_id: 'x' })
    fake.event({ type: 'error', error: { message: 'Unknown delegation.' } })
    fake.event({ type: 'session.closed', reason: 'close_requested', usage: { seconds: 41 } })
    fake.drop()
    expect(events).toEqual([
      { type: 'heard', text: 'Who is ', startMs: 0, endMs: 640 },
      { type: 'said', text: 'Let me look.' },
      { type: 'delegated', id: 'item_1', offsetMs: 1200 },
      { type: 'usage', seconds: 12.5 },
      { type: 'error', message: 'Unknown delegation.' },
      { type: 'closed', reason: 'close_requested', seconds: 41 },
    ])
  })

  it('answers a question handed over, notes progress quietly, and ends the session', async () => {
    const { layer, fake } = voice(created)
    const attached = layer.attach('live_123', () => {})
    fake.open()
    const line = await attached
    line.note('item_1', 'Looking now.')
    const long = Array.from({ length: 80 }, (_, i) => `Visit ${i + 1} is at ten.`).join(' ')
    line.answer('item_1', long)
    line.close()
    const [note, ...rest] = fake.sent
    expect(note).toEqual({
      type: 'session.thinking.append',
      delegation_id: 'item_1',
      content: 'Looking now.',
    })
    const answers = rest.slice(0, -1)
    expect(answers.length).toBeGreaterThan(1)
    for (const update of answers) {
      expect(update).toMatchObject({ type: 'session.commentary.append', delegation_id: 'item_1' })
      expect(String(update.content).length).toBeLessThanOrEqual(MAX_UPDATE_CHARS)
      expect(String(update.content)).toMatch(/\.$/)
    }
    expect(answers.map((u) => u.content).join(' ')).toBe(long)
    expect(rest.at(-1)).toEqual({ type: 'session.close' })
    line.detach()
    expect(fake.closed()).toBe(true)
  })

  it('reports a dropped line, and gives up if it cannot connect', async () => {
    const dropped = voice(created)
    const events: LiveEvent[] = []
    const attached = dropped.layer.attach('live_123', (event) => events.push(event))
    dropped.fake.open()
    await attached
    dropped.fake.drop()
    expect(events).toEqual([{ type: 'lost' }])

    const refused = voice(created)
    const failing = refused.layer.attach('live_123', () => {})
    refused.fake.fail()
    await expect(failing).rejects.toMatchObject({ kind: 'unreachable' })

    const silent = voice(created)
    await expect(silent.layer.attach('live_123', () => {})).rejects.toMatchObject({
      kind: 'unreachable',
    })
  })
})

describe('the voice’s updates', () => {
  it('splits a long answer between sentences, and leaves a short one whole', () => {
    expect(updates('  Two visits today.  ')).toEqual(['Two visits today.'])
    expect(updates('One. Two. Three.', 10)).toEqual(['One. Two.', 'Three.'])
    expect(updates('a'.repeat(25), 10)).toEqual(['a'.repeat(10), 'a'.repeat(10), 'a'.repeat(5)])
  })

  it('ignores what SALEANE does not need', () => {
    expect(liveEvent('not json')).toBeUndefined()
    expect(liveEvent(JSON.stringify({ type: 'session.input_transcript.delta', delta: '' }))).toBe(
      undefined,
    )
    expect(liveEvent(JSON.stringify({ type: 'session.usage.updated', usage: {} }))).toBe(undefined)
    expect(liveEvent(JSON.stringify({ type: 'session.closed' }))).toEqual({
      type: 'closed',
      reason: 'closed',
    })
  })
})
