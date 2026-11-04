import { claudeBrain } from '../lumane'
import type { Brain, TokenPrices } from '../lumane'
import type { BusinessState } from '../src/domain/model'
import { operations } from '../src/domain/operations'

/** What the AI is answering: the team's Ask SALEANE, or guests through the receptionist. */
export type AiUse = 'ask' | 'reception'

export type AiSupplier = {
  name: 'test' | 'claude' | 'keiki'
  /** True once a real supplier is connected, so answers cost money and requests leave SALEANE. */
  live: boolean
  model?: string
  /**
   * The brain for one studio, or undefined for the test-mode brain. A sample studio always stays
   * in test mode, as its messages and payments do, so its fictional records never leave SALEANE.
   */
  brainFor(state: BusinessState, use: AiUse): Brain | undefined
}

export const testAi: AiSupplier = { name: 'test', live: false, brainFor: () => undefined }

/** SALEANE's chosen model: Claude Sonnet thinks, OpenAI's voice speaks (decided 7 October 2026). */
export const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-5-5'

/**
 * Anthropic's published prices per million tokens, in US cents, as listed on 10 October 2026
 * (https://platform.claude.com/docs/en/about-claude/pricing). Spend in a pound studio is counted
 * in the same numbers, which counts a little high and so errs on the safe side. A model missing
 * here needs SALEANE_AI_PRICES, so SALEANE never runs a model whose cost it cannot count.
 */
export const CLAUDE_PRICES: Record<string, TokenPrices> = {
  'claude-sonnet-5-5': { input: 200, output: 1000, cacheRead: 10 },
  'claude-sonnet-5': { input: 200, output: 1000, cacheRead: 20 },
  'claude-sonnet-4-6': { input: 300, output: 1500 },
  // Haiku 5.5's price holds for prompts up to 100,000 tokens, far more than SALEANE sends.
  'claude-haiku-5-5': { input: 10, output: 50, cacheRead: 1 },
}

/** The longest reply one call may write, thinking included: shorter for guests than for the team. */
const MAX_TOKENS: Record<AiUse, number> = { ask: 2048, reception: 1024 }

/**
 * Reads the AI supplier from the environment. Unset means test mode. Naming Claude without its key,
 * or a model without known prices, stops the server rather than quietly staying in test mode.
 */
export function aiFromEnv(
  env: Record<string, string | undefined> = process.env,
  fetcher?: typeof fetch,
): AiSupplier {
  const name = env.SALEANE_AI_PROVIDER?.trim() || 'test'
  if (name === 'test') return testAi
  if (name === 'keiki') return keikiFromEnv(env, fetcher)
  if (name !== 'claude') throw new Error(`Unknown AI provider "${name}".`)
  const apiKey = env.ANTHROPIC_API_KEY?.trim()
  if (!apiKey) throw new Error('Set ANTHROPIC_API_KEY to use Claude.')
  const model = env.SALEANE_AI_MODEL?.trim() || DEFAULT_CLAUDE_MODEL
  const prices = pricesFrom(env.SALEANE_AI_PRICES) ?? CLAUDE_PRICES[model]
  if (!prices)
    throw new Error(
      `Set SALEANE_AI_PRICES to the input and output price per million tokens in cents for ${model}, such as 200,1000.`,
    )
  const brains: Record<AiUse, Brain> = {
    ask: claudeBrain({
      apiKey,
      model,
      prices,
      maxTokens: MAX_TOKENS.ask,
      timeoutMs: 20_000,
      fetcher,
    }),
    reception: claudeBrain({
      apiKey,
      model,
      prices,
      maxTokens: MAX_TOKENS.reception,
      timeoutMs: 15_000,
      fetcher,
    }),
  }
  return {
    name: 'claude',
    live: true,
    model,
    brainFor: (state, use) => (operations(state).mode === 'sandbox' ? undefined : brains[use]),
  }
}

/** Keiki's Anthropic-compatible gateway (https://onkeiki.com/openapi.json, read 4 November 2026). */
export const KEIKI_ENDPOINT = 'https://onkeiki.com/api/anthropic/v1/messages'

/**
 * Keiki as the brain: its neutral agent gateway in passthrough, speaking the Messages API. SALEANE
 * keeps its own instructions, skills and loop (LUMANE), and its own booking checks; Keiki picks the
 * model behind the named agent. Keiki's price per token is not published for a passthrough agent,
 * so SALEANE_AI_PRICES must be set: SALEANE never runs an AI whose cost it cannot count.
 */
function keikiFromEnv(env: Record<string, string | undefined>, fetcher?: typeof fetch): AiSupplier {
  const apiKey = env.KEIKI_API_KEY?.trim()
  if (!apiKey) throw new Error('Set KEIKI_API_KEY, kept on the server, to use Keiki.')
  const model = env.KEIKI_AGENT?.trim()
  if (!model) throw new Error('Set KEIKI_AGENT to the Keiki agent name or ID to use.')
  const prices = pricesFrom(env.SALEANE_AI_PRICES)
  if (!prices)
    throw new Error(
      'Set SALEANE_AI_PRICES to the most Keiki can charge per million input and output tokens in cents, such as 300,1500.',
    )
  const endpoint = env.KEIKI_ENDPOINT?.trim() || KEIKI_ENDPOINT
  if (!endpoint.startsWith('https://')) throw new Error('KEIKI_ENDPOINT must be an https address.')
  const brain = (use: AiUse, timeoutMs: number) =>
    claudeBrain({
      apiKey,
      model,
      prices,
      maxTokens: MAX_TOKENS[use],
      timeoutMs,
      fetcher,
      compatible: { endpoint, label: 'Keiki' },
    })
  const brains: Record<AiUse, Brain> = {
    ask: brain('ask', 25_000),
    reception: brain('reception', 20_000),
  }
  return {
    name: 'keiki',
    live: true,
    model,
    brainFor: (state, use) => (operations(state).mode === 'sandbox' ? undefined : brains[use]),
  }
}

function pricesFrom(raw: string | undefined): TokenPrices | undefined {
  if (!raw?.trim()) return undefined
  const parts = raw.split(',').map((part) => Number(part.trim()))
  const [input, output, cacheRead] = parts
  if (parts.length < 2 || parts.length > 3 || !parts.every((n) => n > 0))
    throw new Error(
      'SALEANE_AI_PRICES must be two or three positive numbers: input, output and, if known, cache reads, such as 200,1000,10.',
    )
  return { input, output, ...(cacheRead ? { cacheRead } : {}) }
}
