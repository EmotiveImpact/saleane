import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import type { LocalDatabase } from './database'
import { createContext } from './context'
import type { ApiOptions, Route } from './context'
import { HttpError, fail, header, inject, readBody } from './http'
import type { InjectOptions, InjectResponse } from './http'
import { authRoutes } from './routes/auth'
import { workspaceRoutes } from './routes/workspace'
import { publicRoutes } from './routes/public'
import { guestRoutes } from './routes/guest'
import { daySheetRoutes } from './routes/daysheet'
import { privacyRoutes } from './routes/privacy'
import { messagingRoutes } from './routes/messaging'
import { createOutbox } from './messaging/outbox'
import { recordPhoneCall, recordReply } from './messaging/calls'
import type { Outbox } from './messaging/outbox'
import { paymentRoutes } from './routes/payments'
import { assistantRoutes } from './routes/assistant'
import { receptionistRoutes } from './routes/receptionist'
import { createPayments } from './payments/service'
import type { Payments } from './payments/service'
import { connectionTransportFromEnv, createConnections } from './connections'
import type { Connections } from './connections'
import { partnerApi } from './partnerApi'

export type { ApiOptions } from './context'
export type { InjectOptions, InjectResponse } from './http'
export type ApiHandler = ((
  request: IncomingMessage,
  response: ServerResponse,
  next?: () => void,
) => Promise<void>) & {
  database: LocalDatabase
  outbox: Outbox
  payments: Payments
  connections: Connections
  close: () => void
  inject: (request: InjectOptions) => Promise<InjectResponse>
}

// Route modules are tried in order; each claims its own paths and returns false otherwise.
const baseRoutes = [
  authRoutes,
  privacyRoutes,
  workspaceRoutes,
  publicRoutes,
  guestRoutes,
  daySheetRoutes,
]

export function createApiHandler(options: ApiOptions): ApiHandler {
  const ctx = createContext(options)
  const { origin, allowedOrigin, db, rateLimit } = ctx
  const outbox = createOutbox(ctx, ctx.messaging)
  const payments = createPayments(ctx, ctx.paymentProvider)
  const connections = createConnections(
    ctx,
    options.connectionTransport ?? connectionTransportFromEnv(),
  )
  const partners = partnerApi()
  const routes = [
    partners.read,
    partners.manage,
    connections.routes,
    messagingRoutes(outbox),
    paymentRoutes(payments),
    assistantRoutes(),
    receptionistRoutes(),
    ...baseRoutes,
  ]
  if (options.outboxIntervalMs) {
    outbox.start(options.outboxIntervalMs)
    connections.start(options.outboxIntervalMs)
  }

  const handler = (async (
    request: IncomingMessage,
    response: ServerResponse,
    next?: () => void,
  ) => {
    if (!(request.url ?? '').startsWith('/api/')) {
      next?.()
      return
    }
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.setHeader('Referrer-Policy', 'same-origin')
    response.setHeader('X-Frame-Options', 'DENY')
    const reply = (status: number, body: unknown) => {
      response.statusCode = status
      response.setHeader('Content-Type', 'application/json; charset=utf-8')
      response.end(JSON.stringify(body))
    }
    try {
      if (header(request, 'host') !== origin.host)
        fail(403, 'This request must use the configured SALEANE address.')
      rateLimit(request, 'api', 180, 60000)
      const method = request.method ?? 'GET'
      const url = new URL(request.url!, allowedOrigin)
      // Provider delivery receipts come from the provider, not a SALEANE page, and prove
      // themselves by signature instead of by origin and session.
      const hook = /^\/api\/hooks\/(postmark|twilio)$/.exec(url.pathname)
      if (hook) {
        if (method !== 'POST') fail(405, 'Use POST.')
        const body = (await readBody(request, true)) as string
        const receipts = outbox.providers.receipt(hook[1], {
          url: url.toString(),
          headers: request.headers as Record<string, string | undefined>,
          body,
        })
        if (!receipts) fail(403, 'This receipt could not be verified.')
        for (const receipt of receipts!) outbox.record(receipt)
        reply(200, { ok: true })
        return
      }
      // V1.5: the studio's phone line says how a call ended. A missed one is written down for the
      // desk to call back, and may bring one text with the booking link.
      const voice = /^\/api\/hooks\/twilio\/voice\/([a-z0-9-]{1,80})$/.exec(url.pathname)
      if (voice) {
        if (method !== 'POST') fail(405, 'Use POST.')
        const body = (await readBody(request, true)) as string
        const call = outbox.providers.voice?.(voice[1], {
          url: url.toString(),
          headers: request.headers as Record<string, string | undefined>,
          body,
        })
        if (!call) fail(403, 'This call could not be verified.')
        if (call!.missed && recordPhoneCall(ctx, voice[1], call!.from)) outbox.soon()
        response.statusCode = 200
        response.setHeader('Content-Type', 'text/xml; charset=utf-8')
        response.end(
          call!.missed
            ? '<?xml version="1.0" encoding="UTF-8"?><Response><Say>Sorry we missed your call. We will call you back as soon as we can.</Say></Response>'
            : '<?xml version="1.0" encoding="UTF-8"?><Response/>',
        )
        return
      }
      // V1.5: a guest's reply to the studio's text line or email address, kept for the inbox.
      const inbound =
        /^\/api\/hooks\/(?:(twilio)\/sms|(postmark)\/inbound)\/([a-z0-9-]{1,80})$/.exec(
          url.pathname,
        )
      if (inbound) {
        if (method !== 'POST') fail(405, 'Use POST.')
        const provider = inbound[1] ?? inbound[2]
        const body = (await readBody(request, true)) as string
        const replies = outbox.providers.inbound?.(provider, inbound[3], {
          url: url.toString(),
          headers: request.headers as Record<string, string | undefined>,
          body,
        })
        if (!replies) fail(403, 'This message could not be verified.')
        for (const reply of replies!)
          recordReply(ctx, inbound[3], provider === 'twilio' ? 'sms' : 'email', reply)
        if (provider === 'twilio') {
          // No automatic answer: the team replies from the inbox.
          response.statusCode = 200
          response.setHeader('Content-Type', 'text/xml; charset=utf-8')
          response.end('<?xml version="1.0" encoding="UTF-8"?><Response/>')
        } else reply(200, { ok: true })
        return
      }
      if (url.pathname === '/api/hooks/stripe') {
        if (method !== 'POST') fail(405, 'Use POST.')
        const body = (await readBody(request, true)) as string
        const events = await payments.provider.events({
          headers: request.headers as Record<string, string | undefined>,
          body,
        })
        if (!events) fail(403, 'This event could not be verified.')
        for (const event of events!) payments.apply(event)
        reply(200, { ok: true })
        return
      }
      const path = url.pathname
        .split('/')
        .filter(Boolean)
        .map((part) => {
          try {
            return decodeURIComponent(part)
          } catch {
            return fail(400, 'This address is not valid.')
          }
        })
      // V5: the partner API reads only, and proves itself with a key rather than a session.
      if (path[1] === 'v1' && method !== 'GET') fail(405, 'This API only reads. Use GET.')
      let body: unknown
      if (!['GET', 'HEAD'].includes(method)) {
        if (
          header(request, 'origin') !== allowedOrigin ||
          header(request, 'sec-fetch-site') === 'cross-site'
        )
          fail(403, 'This request must come from your SALEANE workspace.')
        if (!/^application\/json(?:\s*;|$)/i.test(header(request, 'content-type') ?? ''))
          fail(415, 'Use a JSON request.')
        body = await readBody(request)
      }
      const route: Route = { request, response, method, url, path, body, reply }
      for (const handle of routes)
        if (await handle(ctx, route)) {
          // A booking, move or cancellation may need a message; send it soon, not next interval.
          if (method !== 'GET' && options.outboxIntervalMs) {
            outbox.soon()
            connections.soon()
          }
          return
        }
      fail(404, 'This endpoint was not found.')
    } catch (error) {
      const status =
        error instanceof z.ZodError ? 400 : error instanceof HttpError ? error.statusCode : 500
      reply(status, {
        error:
          error instanceof z.ZodError
            ? 'Check the required fields and try again.'
            : status < 500 && error instanceof Error
              ? error.message
              : 'The local service could not complete this request. Try again.',
      })
    }
  }) as ApiHandler
  handler.database = db
  handler.outbox = outbox
  handler.payments = payments
  handler.connections = connections
  handler.close = () => {
    outbox.stop()
    connections.stop()
    db.close()
  }
  handler.inject = (input) => inject(handler, allowedOrigin, input)
  return handler
}
