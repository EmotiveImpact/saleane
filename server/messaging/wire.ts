import { timingSafeEqual } from 'node:crypto'
import type { SendResult } from './providers'

/**
 * What every live adapter shares: one request to a provider, read without guessing. A request
 * that never left this computer may be sent again; one that dropped on the way may already have
 * been sent, so it is left for a person to check.
 */
export type Fetch = typeof fetch
export type Answer = { status: number; json: Record<string, unknown>; headers: Headers }

const TIMEOUT_MS = 15000
/** Network errors that prove the request never left this computer, so a retry cannot duplicate. */
const NOT_SENT = new Set(['ENOTFOUND', 'ECONNREFUSED', 'EAI_AGAIN', 'ENETUNREACH'])

export async function post(
  fetcher: Fetch,
  url: string,
  init: RequestInit,
): Promise<Answer | SendResult> {
  try {
    const response = await fetcher(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) })
    let json: Record<string, unknown> = {}
    try {
      const read = (await response.json()) as unknown
      if (read && typeof read === 'object' && !Array.isArray(read))
        json = read as Record<string, unknown>
    } catch {
      /* Some answers, and some refusals, have no JSON body. */
    }
    return { status: response.status, json, headers: response.headers }
  } catch (error) {
    const code = (error as { cause?: { code?: string } })?.cause?.code
    if (code && NOT_SENT.has(code))
      return { outcome: 'failed', detail: 'The provider could not be reached.', retry: true }
    return {
      outcome: 'unknown',
      detail: 'The connection dropped before the provider answered. Check its dashboard first.',
    }
  }
}

export const isResult = (value: unknown): value is SendResult =>
  !!value && typeof value === 'object' && 'outcome' in value

/** A refusal: worth trying again only when the provider was busy or had a fault of its own. */
export const refused = (status: number, detail: string): SendResult => ({
  outcome: 'failed',
  detail,
  retry: status === 429 || status >= 500,
})

/** Compares two secrets in constant time. */
export function sameText(a: string | undefined, b: string) {
  if (!a) return false
  const left = Buffer.from(a),
    right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}
