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

export type { ApiOptions } from './context'
export type { InjectOptions, InjectResponse } from './http'
export type ApiHandler = ((
  request: IncomingMessage,
  response: ServerResponse,
  next?: () => void,
) => Promise<void>) & {
  database: LocalDatabase
  close: () => void
  inject: (request: InjectOptions) => Promise<InjectResponse>
}

// Route modules are tried in order; each claims its own paths and returns false otherwise.
const routes = [authRoutes, workspaceRoutes, publicRoutes, guestRoutes]

export function createApiHandler(options: ApiOptions): ApiHandler {
  const ctx = createContext(options)
  const { origin, allowedOrigin, db, rateLimit } = ctx

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
      for (const handle of routes) if (await handle(ctx, route)) return
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
  handler.close = () => db.close()
  handler.inject = (input) => inject(handler, allowedOrigin, input)
  return handler
}
