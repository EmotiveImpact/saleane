import { createHmac, timingSafeEqual } from 'node:crypto'

/** How old, or how far ahead, a webhook's time may be, as OpenAI's own library allows. */
export const WEBHOOK_TOLERANCE_SECONDS = 300

/** The HMAC of one webhook with the project's secret, base64 after `whsec_`. */
const hmac = (secret: string, id: string, timestamp: string, body: string) =>
  createHmac(
    'sha256',
    secret.startsWith('whsec_')
      ? Buffer.from(secret.slice('whsec_'.length), 'base64')
      : Buffer.from(secret, 'utf8'),
  )
    .update(`${id}.${timestamp}.${body}`)
    .digest()

/**
 * NEXT-17: whether a webhook really came from OpenAI. OpenAI signs each one the Standard Webhooks
 * way, as its own library checks: an HMAC-SHA256 of `id.timestamp.body` with the project's webhook
 * secret (base64 after `whsec_`), sent as one or more `v1,<base64>` signatures, with a timestamp
 * within five minutes of now either way.
 */
export function openaiWebhookGenuine(
  secret: string,
  headers: Record<string, string | string[] | undefined>,
  body: string,
  nowMs: number,
) {
  const one = (name: string) => {
    const value = headers[name]
    return Array.isArray(value) ? value[0] : value
  }
  const id = one('webhook-id')
  const timestamp = one('webhook-timestamp')
  const signatures = one('webhook-signature')
  if (!id || !timestamp || !signatures || !/^\d{1,12}$/.test(timestamp)) return false
  const age = Math.floor(nowMs / 1000) - Number(timestamp)
  if (age > WEBHOOK_TOLERANCE_SECONDS || age < -WEBHOOK_TOLERANCE_SECONDS) return false
  const expected = hmac(secret, id, timestamp, body)
  return signatures.split(' ').some((candidate) => {
    const given = Buffer.from(
      candidate.startsWith('v1,') ? candidate.slice(3) : candidate,
      'base64',
    )
    return given.length === expected.length && timingSafeEqual(given, expected)
  })
}

/** Signs a webhook as OpenAI does, for tests and for checking a set-up by hand. */
export function openaiWebhookSignature(
  secret: string,
  id: string,
  timestamp: string,
  body: string,
) {
  return `v1,${hmac(secret, id, timestamp, body).toString('base64')}`
}
