/**
 * The voice layer: a supplier that listens and speaks in real time while the app's own brain does
 * the thinking. The person's browser sends its audio straight to the supplier; the app's server
 * starts each session, keeps the key, and follows the session on a second connection of its own,
 * where it hears what was said, answers the questions handed to it, and ends the session.
 *
 * `openaiLive` connects OpenAI's GPT-Live; a test can pass its own `VoiceLayer` instead.
 */

/** What the server hears about a session, in the app's own words rather than the supplier's. */
export type LiveEvent =
  /**
   * Part of what the person said, as the supplier heard it, with where it starts on the session's
   * timeline in milliseconds when the supplier says.
   */
  | { type: 'heard'; text: string; startMs?: number; endMs?: number }
  /** Part of what the voice said aloud. */
  | { type: 'said'; text: string }
  /**
   * The voice wants the app to answer what the person has just asked, from this point on the
   * session's timeline in milliseconds when the supplier says.
   */
  | { type: 'delegated'; id: string; offsetMs?: number }
  /** The session's length so far, in seconds. */
  | { type: 'usage'; seconds: number }
  /** The session has ended, and how long it ran when the supplier reports it. */
  | { type: 'closed'; reason: string; seconds?: number }
  /** The supplier reported a problem. The session may still be running. */
  | { type: 'error'; message: string }
  /** The connection to the session dropped without the supplier saying it ended. */
  | { type: 'lost' }

/** The server's own connection to one running session. */
export interface LiveLine {
  /** What the voice should say in answer to a question it handed over. */
  answer(delegationId: string, text: string): void
  /** Quiet context for the voice, such as "looking now", that it need not say aloud. */
  note(delegationId: string, text: string): void
  /** Ends the session. The supplier then reports it closed. */
  close(): void
  /** Stops following the session without ending it. */
  detach(): void
}

export type LiveStart = {
  /** The browser's offer to connect, in the WebRTC session format. */
  sdp: string
  /** The voice's standing instructions for the whole session. */
  instructions: string
  /** The supplier's id for the voice. */
  voice: string
}

/** How to answer a phone call the supplier has received. */
export type CallAnswer = {
  /** The voice's standing instructions for the whole call. */
  instructions: string
  /** The supplier's id for the voice. */
  voice: string
}

/**
 * Phone calls that reach the supplier over SIP, each known by the session id the supplier's
 * webhook gives. Once accepted, a call is followed with `attach` like any other session.
 */
export interface CallControl {
  accept(id: string, input: CallAnswer): Promise<void>
  /** Turns the call away with a SIP status, such as 486 (busy) or 603 (declined). */
  reject(id: string, status: number): Promise<void>
  hangup(id: string): Promise<void>
}

export interface VoiceLayer {
  name: string
  /** True when it calls a real supplier, which costs money and sends the person's voice away. */
  live: boolean
  model?: string
  /** What one minute of talking costs, in minor units. */
  minorPerMinute: number
  /** Starts a session for the browser's offer. Returns the session id and the supplier's answer. */
  start(input: LiveStart): Promise<{ id: string; sdp: string }>
  /** Follows a running session; resolves once connected. */
  attach(id: string, onEvent: (event: LiveEvent) => void): Promise<LiveLine>
  /** Phone calls, when the supplier takes them. */
  calls?: CallControl
}

/** Why a session could not be started or followed. */
export class VoiceError extends Error {
  constructor(
    readonly kind: 'unreachable' | 'busy' | 'refused' | 'failed',
    message: string,
  ) {
    super(message)
    this.name = 'VoiceError'
  }
}

/** The parts of a WebSocket the voice layer uses, so a test can stand in for the supplier. */
export type LiveSocket = {
  send(data: string): void
  close(code?: number, reason?: string): void
  addEventListener(
    type: 'open' | 'message' | 'close' | 'error',
    listener: (event: { data?: unknown }) => void,
  ): void
}

export type OpenAiLiveOptions = {
  apiKey: string
  /** GPT-Live's model id. */
  model: string
  minorPerMinute: number
  fetcher?: typeof fetch
  /** Opens the server's own connection to a session. Node's WebSocket by default. */
  connect?: (url: string, headers: Record<string, string>) => LiveSocket
  /** How long starting or following a session may take before it is given up. */
  timeoutMs?: number
  /** OpenAI's address, replaced only in tests. */
  baseUrl?: string
}

/**
 * Text the voice is given to say is kept to OpenAI's limit of 500 tokens an update, with room to
 * spare: longer answers go in several updates, split between sentences.
 */
export const MAX_UPDATE_CHARS = 1500

/** Splits an answer into updates no longer than the limit, between sentences where it can. */
export function updates(text: string, max = MAX_UPDATE_CHARS): string[] {
  const parts: string[] = []
  let rest = text.trim()
  while (rest.length > max) {
    const window = rest.slice(0, max)
    const cut = Math.max(
      window.lastIndexOf('. '),
      window.lastIndexOf('? '),
      window.lastIndexOf('! '),
      window.lastIndexOf('\n'),
    )
    const at = cut > max / 3 ? cut + 1 : window.lastIndexOf(' ') > 0 ? window.lastIndexOf(' ') : max
    parts.push(rest.slice(0, at).trim())
    rest = rest.slice(at).trim()
  }
  if (rest) parts.push(rest)
  return parts
}

const nodeSocket = (url: string, headers: Record<string, string>): LiveSocket => {
  // Node's WebSocket takes headers as an option, which the browser's does not.
  const Socket = WebSocket as unknown as new (
    url: string,
    options: { headers: Record<string, string> },
  ) => LiveSocket
  return new Socket(url, { headers })
}

/**
 * OpenAI's GPT-Live, with the app answering the questions it hands over ("client delegation").
 * The session is created from the server with the app's key, so the key never reaches the
 * browser, and OpenAI keeps nothing from it (`store: false`). The browser may only end the session
 * and hear that it ended; everything else happens on the server's own connection.
 */
export function openaiLive(options: OpenAiLiveOptions): VoiceLayer {
  const fetcher = options.fetcher ?? fetch
  const connect = options.connect ?? nodeSocket
  const timeoutMs = options.timeoutMs ?? 10_000
  const base = options.baseUrl ?? 'https://api.openai.com/v1'
  const auth = { Authorization: `Bearer ${options.apiKey}` }

  /** Sends one request to OpenAI, turning a failure into a `VoiceError` of the right kind. */
  async function post(path: string, body?: unknown) {
    let response: Response
    try {
      response = await fetcher(`${base}${path}`, {
        method: 'POST',
        headers: { ...auth, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (error) {
      throw new VoiceError(
        'unreachable',
        `OpenAI could not be reached: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      const kind =
        response.status === 429
          ? 'busy'
          : [401, 402, 403].includes(response.status)
            ? 'refused'
            : response.status >= 500
              ? 'unreachable'
              : 'failed'
      throw new VoiceError(kind, `OpenAI answered ${response.status}: ${detail.slice(0, 300)}`)
    }
    return response
  }
  const call = (id: string, action: string) => `/live/sessions/${encodeURIComponent(id)}/${action}`

  return {
    name: 'openai',
    live: true,
    model: options.model,
    minorPerMinute: options.minorPerMinute,

    // A call reaches OpenAI over SIP from the studio's phone line, and the line negotiates the
    // sound, so no audio format is given. As with talking, OpenAI keeps nothing from it.
    calls: {
      async accept(id, { instructions, voice }) {
        await post(call(id, 'accept'), {
          session: {
            type: 'live',
            model: options.model,
            instructions,
            store: false,
            audio: { output: { voice } },
            delegation: { type: 'client' },
          },
        })
      },
      async reject(id, status) {
        await post(call(id, 'reject'), { status_code: status })
      },
      async hangup(id) {
        await post(call(id, 'hangup'))
      },
    },

    async start({ sdp, instructions, voice }) {
      const response = await post('/live/sessions', {
        session: {
          model: options.model,
          instructions,
          store: false,
          audio: { output: { voice } },
          delegation: { type: 'client' },
          client: {
            // Client events are named by type; server events by a selector object.
            data_channel: {
              allowed_client_events: ['session.close'],
              allowed_server_events: [{ type: 'session.closed' }],
            },
          },
        },
        transport: { type: 'webrtc', sdp },
      })
      const body = (await response.json().catch(() => undefined)) as
        { session?: { id?: unknown }; transport?: { sdp?: unknown } } | undefined
      const id = body?.session?.id
      const answer = body?.transport?.sdp
      if (typeof id !== 'string' || !id || typeof answer !== 'string' || !answer)
        throw new VoiceError('failed', 'OpenAI started a session without its id or answer.')
      return { id, sdp: answer }
    },

    attach(id, onEvent) {
      const socket = connect(`${wsBase(base)}/live/sessions/${encodeURIComponent(id)}/attach`, auth)
      const send = (event: Record<string, unknown>) => socket.send(JSON.stringify(event))
      const line: LiveLine = {
        answer(delegationId, text) {
          for (const content of updates(text))
            send({ type: 'session.commentary.append', delegation_id: delegationId, content })
        },
        note(delegationId, text) {
          send({ type: 'session.thinking.append', delegation_id: delegationId, content: text })
        },
        close: () => send({ type: 'session.close' }),
        detach: () => socket.close(1000, 'done'),
      }
      return new Promise<LiveLine>((resolve, reject) => {
        let open = false
        let closed = false
        const timer = setTimeout(() => {
          if (open) return
          socket.close()
          reject(new VoiceError('unreachable', 'The session could not be followed in time.'))
        }, timeoutMs)
        socket.addEventListener('open', () => {
          open = true
          clearTimeout(timer)
          resolve(line)
        })
        socket.addEventListener('error', () => {
          if (open) return
          clearTimeout(timer)
          reject(new VoiceError('unreachable', 'The session could not be followed.'))
        })
        socket.addEventListener('close', () => {
          clearTimeout(timer)
          if (open && !closed) onEvent({ type: 'lost' })
        })
        socket.addEventListener('message', ({ data }) => {
          const event = liveEvent(data)
          if (!event) return
          if (event.type === 'closed') closed = true
          onEvent(event)
        })
      })
    },
  }
}

const wsBase = (base: string) => base.replace(/^http/, 'ws')

const text = (value: unknown) => (typeof value === 'string' ? value : '')
const seconds = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined

/** One of OpenAI's session events in the app's words, or undefined for one it does not need. */
export function liveEvent(data: unknown): LiveEvent | undefined {
  let event: Record<string, unknown>
  try {
    event = JSON.parse(typeof data === 'string' ? data : String(data)) as Record<string, unknown>
  } catch {
    return undefined
  }
  const at = (key: string) => (event[key] ?? {}) as Record<string, unknown>
  switch (event.type) {
    case 'session.input_transcript.delta': {
      if (!text(event.delta)) return undefined
      const startMs = seconds(event.start_ms)
      const endMs = seconds(event.end_ms)
      return {
        type: 'heard',
        text: text(event.delta),
        ...(startMs === undefined ? {} : { startMs }),
        ...(endMs === undefined ? {} : { endMs }),
      }
    }
    case 'session.output_transcript.delta':
      return text(event.delta) ? { type: 'said', text: text(event.delta) } : undefined
    case 'session.delegation.created': {
      const id = text(at('delegation').id)
      if (!id) return undefined
      const offsetMs = seconds(event.offset_ms)
      return { type: 'delegated', id, ...(offsetMs === undefined ? {} : { offsetMs }) }
    }
    case 'session.usage.updated': {
      const used = seconds(at('usage').seconds)
      return used === undefined ? undefined : { type: 'usage', seconds: used }
    }
    case 'session.closed': {
      const used = seconds(at('usage').seconds)
      return {
        type: 'closed',
        reason: text(event.reason) || 'closed',
        ...(used === undefined ? {} : { seconds: used }),
      }
    }
    case 'error':
      return {
        type: 'error',
        message: text(at('error').message) || 'The voice reported a problem.',
      }
    default:
      return undefined
  }
}
