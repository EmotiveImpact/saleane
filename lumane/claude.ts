import { BrainError } from './brain'
import type { Brain, BrainMessage, BrainReply, BrainRequest, ToolSpec } from './brain'

/**
 * Claude, from Anthropic, as a Lumane brain, through the Messages API.
 * https://platform.claude.com/docs/en/api/messages
 *
 * It sends the app's standing instructions, the facts for this request, the conversation and the
 * skills, and returns Claude's words and the skills it asks for. It works out what each call cost
 * from the tokens Anthropic reports, so the allowance counts real spend. It never changes model and
 * never falls back to a cheaper one: if Claude cannot answer, the turn says so.
 */
export type TokenPrices = {
  /** What a million input tokens cost, in minor units (cents). */
  input: number
  /** What a million output tokens cost, thinking included, in minor units (cents). */
  output: number
  /** What a million input tokens read back from the cache cost; a tenth of `input` if left out. */
  cacheRead?: number
}

export type ClaudeOptions = {
  apiKey: string
  model: string
  prices: TokenPrices
  /** The longest reply one call may write, thinking included, in tokens. */
  maxTokens?: number
  /** How much Claude thinks before answering. Low keeps answers quick and cheap. */
  effort?: 'low' | 'medium' | 'high'
  /** How long one call may take before it is given up. */
  timeoutMs?: number
  fetcher?: typeof fetch
  /** Waits before the one retry after Anthropic says it is busy. Replaced in tests. */
  wait?: (ms: number) => Promise<void>
}

const ENDPOINT = 'https://api.anthropic.com/v1/messages'
const VERSION = '2023-06-01'
/** Writing the cached part costs a quarter more than plain input (the five-minute cache). */
const CACHE_WRITE = 1.25
/** Statuses that mean Anthropic is busy or briefly down, worth one more try. */
const BUSY = new Set([429, 500, 502, 503, 504, 529])
/** What Claude's words say when it declines a request. */
export const DECLINED = 'Sorry, I cannot help with that.'

type Cache = { type: 'ephemeral' }
type Block =
  | { type: 'text'; text: string; cache_control?: Cache }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }
  | { type: string; [key: string]: unknown }
export type ClaudeTurn = { role: 'user' | 'assistant'; content: Block[] }

export type ClaudeUsage = {
  input_tokens?: number | null
  output_tokens?: number | null
  cache_creation_input_tokens?: number | null
  cache_read_input_tokens?: number | null
}
type ContentBlock = { type: string; text?: string; id?: string; name?: string; input?: unknown }

/**
 * The conversation in Anthropic's shape. A reply Claude wrote in this turn goes back exactly as it
 * came, thinking included, as Anthropic requires. Several results in a row go back as one turn,
 * empty words are left out, and the conversation opens with the person, so an earlier answer at
 * the very start of a short history is dropped.
 */
export function claudeMessages(messages: BrainMessage[]): ClaudeTurn[] {
  const turns: ClaudeTurn[] = []
  const words = (text: string | undefined): Block[] =>
    text?.trim() ? [{ type: 'text', text: text.trim() }] : []
  for (const message of messages) {
    const role = message.role === 'assistant' ? 'assistant' : 'user'
    const blocks: Block[] =
      message.role === 'user'
        ? words(message.text)
        : message.role === 'tool'
          ? [
              {
                type: 'tool_result',
                tool_use_id: message.callId,
                content: message.result || 'Nothing.',
                ...(message.isError ? { is_error: true } : {}),
              },
            ]
          : Array.isArray(message.raw)
            ? (message.raw as Block[])
            : [
                ...words(message.text),
                ...message.calls.map((call): Block => ({
                  type: 'tool_use',
                  id: call.id,
                  name: call.name,
                  input: call.input ?? {},
                })),
              ]
    if (!blocks.length) continue
    const last = turns.at(-1)
    if (last?.role === role) last.content = [...last.content, ...blocks]
    else if (turns.length || role === 'user') turns.push({ role, content: blocks })
  }
  return turns
}

/**
 * The skills in Anthropic's shape, leaving out what Claude does not need: the schema's dialect,
 * and long date patterns where a format already says the same. Every skill still checks its own
 * input in full. The last skill marks the end of the part Anthropic may cache.
 */
export function claudeTools(tools: ToolSpec[]) {
  return tools.map((tool, index) => ({
    name: tool.name,
    description: tool.description,
    input_schema: lean(tool.inputSchema),
    ...(index === tools.length - 1 ? { cache_control: { type: 'ephemeral' } as Cache } : {}),
  }))
}

function lean(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(lean)
  if (!node || typeof node !== 'object') return node
  const schema = node as Record<string, unknown>
  return Object.fromEntries(
    Object.entries(schema)
      .filter(
        ([key]) => key !== '$schema' && !(key === 'pattern' && typeof schema.format === 'string'),
      )
      .map(([key, value]) => [
        key,
        key === 'properties' && value && typeof value === 'object'
          ? Object.fromEntries(Object.entries(value).map(([name, field]) => [name, lean(field)]))
          : lean(value),
      ]),
  )
}

/** What a call cost in minor units, from Anthropic's token counts, rounded up to a hundredth. */
export function claudeCost(usage: ClaudeUsage | undefined, prices: TokenPrices) {
  const tokens = (n: number | null | undefined) => (typeof n === 'number' && n > 0 ? n : 0)
  const millionths =
    tokens(usage?.input_tokens) * prices.input +
    tokens(usage?.cache_creation_input_tokens) * prices.input * CACHE_WRITE +
    tokens(usage?.cache_read_input_tokens) * (prices.cacheRead ?? prices.input / 10) +
    tokens(usage?.output_tokens) * prices.output
  return Math.max(0, Math.ceil((millionths / 1_000_000) * 100 - 1e-9) / 100)
}

export function claudeBrain(options: ClaudeOptions): Brain {
  const fetcher = options.fetcher ?? fetch
  const maxTokens = options.maxTokens ?? 2048
  const timeoutMs = options.timeoutMs ?? 25_000
  const wait = options.wait ?? ((ms: number) => new Promise((done) => setTimeout(done, ms)))

  async function call(body: string) {
    try {
      return await fetcher(ENDPOINT, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': options.apiKey,
          'anthropic-version': VERSION,
        },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch {
      // The request may have reached Anthropic before the connection dropped, so count what it
      // could have cost: every character a token, and the longest reply.
      throw new BrainError(
        'unreachable',
        'Claude could not be reached.',
        claudeCost({ input_tokens: body.length, output_tokens: maxTokens }, options.prices),
      )
    }
  }

  return {
    name: 'claude',
    live: true,
    async respond(request: BrainRequest): Promise<BrainReply> {
      const body = JSON.stringify({
        model: options.model,
        max_tokens: maxTokens,
        output_config: { effort: options.effort ?? 'low' },
        system: [
          { type: 'text', text: request.instructions, cache_control: { type: 'ephemeral' } },
          ...(request.context?.trim() ? [{ type: 'text', text: request.context.trim() }] : []),
        ],
        messages: claudeMessages(request.messages),
        ...(request.tools.length ? { tools: claudeTools(request.tools) } : {}),
      })
      let response = await call(body)
      if (BUSY.has(response.status)) {
        await response.body?.cancel().catch(() => {})
        const after = Number(response.headers.get('retry-after'))
        await wait(Math.min(Number.isFinite(after) && after > 0 ? after * 1000 : 1000, 2000))
        response = await call(body)
      }
      let json: {
        content?: ContentBlock[]
        stop_reason?: string
        usage?: ClaudeUsage
        error?: { type?: string; message?: string }
      } = {}
      try {
        json = await response.json()
      } catch {
        /* A failure page may have no JSON body. */
      }
      if (!response.ok) {
        const detail = [json.error?.type ?? `status ${response.status}`, json.error?.message]
          .filter(Boolean)
          .join(': ')
          .slice(0, 300)
        if (BUSY.has(response.status))
          throw new BrainError('busy', `Claude is busy just now (${detail}).`)
        if ([401, 402, 403].includes(response.status))
          throw new BrainError('refused', `Anthropic refused the account (${detail}).`)
        throw new BrainError('failed', `Claude could not answer (${detail}).`)
      }
      const costMinor = claudeCost(json.usage, options.prices)
      if (json.stop_reason === 'refusal') return { text: DECLINED, calls: [], costMinor }
      const content = Array.isArray(json.content) ? json.content : []
      const text = content
        .filter((block) => block.type === 'text' && typeof block.text === 'string')
        .map((block) => block.text!.trim())
        .filter(Boolean)
        .join('\n\n')
      // A reply cut off by a length limit may end mid-sentence or mid-request, so none of it is
      // used: the request ends as unavailable, with what it cost recorded.
      if (json.stop_reason === 'max_tokens' || json.stop_reason?.includes('exceeded'))
        throw new BrainError(
          'failed',
          `Claude's reply was cut off by its length limit (${json.stop_reason}).`,
          costMinor,
        )
      const calls = content
        .filter((block) => block.type === 'tool_use' && block.id && block.name)
        .map((block) => ({ id: block.id!, name: block.name!, input: block.input ?? {} }))
      return {
        ...(text ? { text } : {}),
        calls,
        costMinor,
        ...(calls.length ? { raw: content } : {}),
      }
    },
  }
}
