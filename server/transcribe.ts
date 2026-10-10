/**
 * NEXT-16: turning a voice note into words. OpenAI writes down a short recording, and SALEANE keeps
 * only the words the professional saves, never the recording. Off unless talking to Ask SALEANE is
 * switched on with OpenAI, which uses the same key. The model's limits (16,000 tokens in and 2,000
 * out, from its model page on 10 October 2026) cap what any one recording can cost.
 */
export type Transcriber = {
  name: 'test' | 'openai'
  live: boolean
  model?: string
  /** Writes down one recording, with what it cost in minor units. */
  transcribe(audio: Buffer, type: string): Promise<{ text: string; costMinor: number }>
}

export class TranscribeError extends Error {
  constructor(
    message: string,
    /** What the attempt may still have cost, should the request have reached OpenAI. */
    readonly costMinor = 0,
  ) {
    super(message)
    this.name = 'TranscribeError'
  }
}

export const noTranscriber: Transcriber = {
  name: 'test',
  live: false,
  transcribe: () => Promise.reject(new TranscribeError('Voice notes are not switched on.')),
}

/** SALEANE's model for voice notes: OpenAI's smaller transcription model. */
export const DEFAULT_TRANSCRIBE_MODEL = 'gpt-4o-mini-transcribe'

/**
 * OpenAI's published prices for transcription, in US cents per million tokens, as listed on 10
 * October 2026 (https://developers.openai.com/api/docs/models/gpt-4o-mini-transcribe): audio in
 * $1.25, text out $5.00. Every token in is counted at the audio price.
 */
export const TRANSCRIBE_PRICES: Record<string, { input: number; output: number }> = {
  'gpt-4o-mini-transcribe': { input: 125, output: 500 },
}

/** The most one recording may cost, at those limits. Held before the recording is sent. */
export const TRANSCRIBE_WORST_MINOR = (16_000 * 125 + 2_000 * 500) / 1_000_000

const EXTENSION: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mp4': 'mp4',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
}
export const VOICE_NOTE_TYPES = Object.keys(EXTENSION)

export function openaiTranscriber(options: {
  apiKey: string
  model?: string
  fetcher?: typeof fetch
}): Transcriber {
  const model = options.model ?? DEFAULT_TRANSCRIBE_MODEL
  const prices = TRANSCRIBE_PRICES[model]
  if (!prices) throw new Error(`SALEANE does not know what ${model} costs.`)
  const fetcher = options.fetcher ?? fetch
  return {
    name: 'openai',
    live: true,
    model,
    async transcribe(audio, type) {
      const form = new FormData()
      const kind = type.split(';')[0].trim().toLowerCase()
      form.append(
        'file',
        new Blob([new Uint8Array(audio)], { type: kind }),
        `note.${EXTENSION[kind] ?? 'webm'}`,
      )
      form.append('model', model)
      form.append('language', 'en')
      form.append('response_format', 'json')
      let response: Response
      try {
        response = await fetcher('https://api.openai.com/v1/audio/transcriptions', {
          method: 'POST',
          headers: { authorization: `Bearer ${options.apiKey}` },
          body: form,
          signal: AbortSignal.timeout(30_000),
        })
      } catch {
        throw new TranscribeError('OpenAI could not be reached.', TRANSCRIBE_WORST_MINOR)
      }
      let json: {
        text?: unknown
        usage?: { type?: string; input_tokens?: number; output_tokens?: number }
        error?: { message?: string }
      } = {}
      try {
        json = await response.json()
      } catch {
        /* A failure page may have no JSON body. */
      }
      if (!response.ok || typeof json.text !== 'string')
        throw new TranscribeError(
          `OpenAI could not write down the note (${response.status}${json.error?.message ? `: ${json.error.message.slice(0, 200)}` : ''}).`,
        )
      const usage = json.usage?.type === 'tokens' ? json.usage : undefined
      // Without its usage, the note is counted at the most it could have cost.
      const costMinor = usage
        ? ((usage.input_tokens ?? 0) * prices.input + (usage.output_tokens ?? 0) * prices.output) /
          1_000_000
        : TRANSCRIBE_WORST_MINOR
      return { text: json.text.trim(), costMinor }
    },
  }
}

/** Voice notes listen only where talking is switched on with OpenAI, with its key. */
export function transcriberFromEnv(
  env: Record<string, string | undefined> = process.env,
  fetcher?: typeof fetch,
): Transcriber {
  if (env.SALEANE_VOICE_PROVIDER?.trim() !== 'openai') return noTranscriber
  const apiKey = env.OPENAI_API_KEY?.trim()
  if (!apiKey) return noTranscriber
  return openaiTranscriber({ apiKey, fetcher })
}
