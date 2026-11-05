import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHostedApp, neonStore } from './hosted'
import type { HostedApp, HostedResponse } from './hosted'
import { HttpError, readBytes } from './http'

/**
 * The Vercel Function that answers every /api request (see scripts/vercel-output.mjs). The pages
 * themselves are plain files on Vercel's network. Needs APP_ORIGIN, the exact public address, and
 * DATABASE_URL, which Neon's Vercel integration sets. Live providers stay off until their keys are
 * set, exactly as on a computer.
 */
const BODY_LIMIT = 4 * 1024 * 1024

let app: Promise<HostedApp> | undefined

const send = (response: ServerResponse, answer: HostedResponse) => {
  response.statusCode = answer.statusCode
  for (const [name, value] of Object.entries(answer.headers)) response.setHeader(name, value)
  response.end(answer.body)
}
const refuse = (response: ServerResponse, statusCode: number, error: string) =>
  send(response, {
    statusCode,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    body: Buffer.from(JSON.stringify({ error })),
  })

/** Settings that make SALEANE reach a real outside service; unset or "test" reaches none. */
const LIVE_SETTINGS = [
  'SALEANE_EMAIL_PROVIDER',
  'SALEANE_SMS_PROVIDER',
  'SALEANE_PAYMENTS_PROVIDER',
  'SALEANE_BILLING_PROVIDER',
  'SALEANE_AI_PROVIDER',
  'SALEANE_VOICE_PROVIDER',
  'SALEANE_SOCIAL',
  'SALEANE_GOOGLE_BOOKING',
  'SALEANE_CONNECTIONS',
]
export const allTestMode = (env: NodeJS.ProcessEnv = process.env) =>
  LIVE_SETTINGS.every((name) => ['', 'test', 'off'].includes(env[name]?.trim() ?? '')) &&
  // The AI receptionist's phone line answers real calls once its keys are set.
  !env.OPENAI_PROJECT_ID?.trim()

/** Vercel sets these itself from the visitor's connection and replaces any a visitor sends. */
export function visitorAddress(request: IncomingMessage) {
  const real = request.headers['x-real-ip']
  if (typeof real === 'string' && real.trim()) return real.trim()
  const forwarded = request.headers['x-forwarded-for']
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim()
  return first || request.socket?.remoteAddress || 'unknown'
}

export default async function handler(request: IncomingMessage, response: ServerResponse) {
  const origin = process.env.APP_ORIGIN?.trim()
  const connection = process.env.DATABASE_URL?.trim()
  if (!origin || !connection) {
    refuse(response, 503, 'SALEANE is being set up. Try again shortly.')
    return
  }
  let body: Buffer
  try {
    body = await readBytes(request, BODY_LIMIT)
  } catch (error) {
    refuse(
      response,
      error instanceof HttpError ? error.statusCode : 400,
      error instanceof Error ? error.message : 'The request could not be read.',
    )
    return
  }
  try {
    app ??= neonStore(connection).then(
      (store) =>
        createHostedApp({
          store,
          origin,
          directory: join(tmpdir(), 'saleane'),
          // In test mode nothing leaves SALEANE, so a request can simply run again on the newer copy.
          retries: allTestMode() ? 2 : 0,
        }),
      (error) => {
        app = undefined
        throw error
      },
    )
    const hosted = await app
    send(
      response,
      await hosted.handle({
        method: request.method ?? 'GET',
        url: request.url ?? '/',
        headers: request.headers,
        body,
        remoteAddress: visitorAddress(request),
      }),
    )
  } catch (error) {
    console.error('[SALEANE] A request could not be answered.', error)
    refuse(response, 500, 'SALEANE could not complete this request. Try again.')
  }
}
