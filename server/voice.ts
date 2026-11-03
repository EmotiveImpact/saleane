import { openaiLive } from '../lumane'
import type { LiveSocket, VoiceLayer } from '../lumane'

/** No voice: talking is not offered, and nothing is sent anywhere. */
export const noVoice: VoiceLayer = {
  name: 'test',
  live: false,
  minorPerMinute: 0,
  start: () => Promise.reject(new Error('Talking is not switched on.')),
  attach: () => Promise.reject(new Error('Talking is not switched on.')),
}

/** SALEANE's chosen voice: OpenAI's GPT-Live speaks while Claude thinks (decided 7 October 2026). */
export const DEFAULT_VOICE_MODEL = 'gpt-live-1'

/**
 * OpenAI's published price for GPT-Live, in US cents a minute, billed by the second, as listed on
 * 10 October 2026 (https://openai.com/index/introducing-gpt-live-1-in-the-api/). The thinking is
 * Claude's, counted separately. A model missing here needs SALEANE_VOICE_PRICE.
 */
export const VOICE_PRICES: Record<string, number> = { 'gpt-live-1': 5 }

/**
 * Reads the voice supplier from the environment. Unset means no talking. Naming OpenAI without its
 * key, or without Claude to do the thinking, stops the server rather than quietly going without.
 */
export function voiceFromEnv(
  env: Record<string, string | undefined> = process.env,
  options: {
    fetcher?: typeof fetch
    connect?: (url: string, headers: Record<string, string>) => LiveSocket
  } = {},
): VoiceLayer {
  const name = env.SALEANE_VOICE_PROVIDER?.trim() || 'test'
  if (name === 'test') return noVoice
  if (name !== 'openai') throw new Error(`Unknown voice provider "${name}".`)
  const apiKey = env.OPENAI_API_KEY?.trim()
  if (!apiKey) throw new Error('Set OPENAI_API_KEY to talk with OpenAI.')
  if (env.SALEANE_AI_PROVIDER?.trim() !== 'claude')
    throw new Error(
      'Talking needs Claude to answer: set SALEANE_AI_PROVIDER=claude and ANTHROPIC_API_KEY too.',
    )
  const model = env.SALEANE_VOICE_MODEL?.trim() || DEFAULT_VOICE_MODEL
  const price = env.SALEANE_VOICE_PRICE?.trim()
    ? Number(env.SALEANE_VOICE_PRICE.trim())
    : VOICE_PRICES[model]
  if (!(price! > 0))
    throw new Error(
      `Set SALEANE_VOICE_PRICE to what one minute of ${model} costs in cents, such as 5.`,
    )
  return openaiLive({
    apiKey,
    model,
    minorPerMinute: price!,
    fetcher: options.fetcher,
    connect: options.connect,
  })
}
