import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import { digest } from './auth'
import { HttpError, fail, header, readBody } from './http'
import type { Context, Org, Route } from './context'
import {
  INTERNAL_ERROR,
  INVALID_PARAMS,
  INVALID_REQUEST,
  METHOD_NOT_FOUND,
  PARSE_ERROR,
  PROTOCOL_VERSIONS,
  SERVER_ERROR,
  TOOLS,
  TOOLS_VERSION,
  rpcMessage,
  runBookingTool,
  toolInputs,
  toolRefusal,
} from './aiBooking'
import type { ToolName } from './aiBooking'
import { aiBookingOn, studioDetails } from '../src/domain/aiBooking'
import { operations } from '../src/domain/operations'
import type { AssistantChannel } from '../src/domain/model'

/**
 * The messaging gateway: one connection for software that carries guests' messages to SALEANE
 * (Keiki on iMessage and WhatsApp, run through SALEANE's private server on Maritime), serving
 * every studio rather than one connection per studio.
 *
 * Who the guest is talking to is never left to the AI. Each request names, in headers set by the
 * carrier's own code from the message itself, the line the guest wrote to (`Saleane-Line`) and the
 * guest (`Saleane-Customer`). A line the studio owns belongs to one location; on a line shared by
 * many studios the guest chooses one, by its booking page name, and that choice is kept for that
 * guest on that line. Every tool then runs for that studio and location only, through the same
 * booking tools, holds and checks as the studio's booking page (server/aiBooking.ts): there is no
 * second booking engine. A booking needs the guest's yes to the treatment, day, time, price and
 * cancelling terms, and the same booking asked again (a retried message) returns the same visit.
 *
 * Off unless SALEANE_GATEWAY=on and a long SALEANE_GATEWAY_KEY are set. The key stays on the
 * carrier's server; it is never in a browser or the public repository. It answers nothing for a
 * studio whose owner has not turned on booking through assistants, nor for sample studios.
 */

export type GatewayOptions = { mode: 'off' | 'on'; key: string }

export function gatewayFromEnv(env: Record<string, string | undefined>): GatewayOptions {
  const mode = env.SALEANE_GATEWAY?.trim() || 'off'
  if (mode === 'off') return { mode: 'off', key: '' }
  if (mode !== 'on') throw new Error(`Unknown gateway mode "${mode}". Use "off" or "on".`)
  const key = env.SALEANE_GATEWAY_KEY?.trim() ?? ''
  if (key.length < 32)
    throw new Error('The messaging gateway needs a SALEANE_GATEWAY_KEY of 32 or more characters.')
  return { mode, key }
}

export const GATEWAY_PATH = '/api/gateway/mcp'
/** A guest's choice of studio on a shared line lasts this long after their last message. */
const BINDING_MS = 30 * 24 * 60 * 60000

/** Lines are written the same way by the owner and the carrier: case and spaces do not count. */
export const lineKey = (line: string) => digest(`gateway-line:${line.trim().toLowerCase()}`)

const lineHeader = z.string().trim().min(3).max(200)
const customerHeader = z.string().trim().min(3).max(200)

const chooseInput = z
  .object({
    booking_page: z.string().trim().min(1).max(300),
    location_id: z.string().trim().min(1).max(150).optional(),
  })
  .strict()

const CHOOSE_TOOL = {
  name: 'choose_studio',
  title: 'Choose the studio',
  description:
    "Chooses the studio this guest wants to book with, on a line shared by several studios. Use the studio's booking page name or address exactly as the guest gives it, such as linden-studio or https://…/book/linden-studio, and a location_id from studio_details when it has several locations. Never guess a studio the guest did not name.",
  inputSchema: {
    type: 'object',
    properties: {
      booking_page: {
        type: 'string',
        description: "The studio's booking page name or address, as the guest gave it.",
      },
      location_id: {
        type: 'string',
        description: 'A location from studio_details, when the studio has more than one.',
      },
    },
    required: ['booking_page'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
} as const

const UNCHOSEN =
  'This guest has not chosen a studio yet. Ask which studio they want to book with (its booking page name, such as linden-studio), then call choose_studio. Do not guess.'

/** Which assistant the visit's history names: the channel in the line, when it says. */
function channelOf(line: string, said: string | undefined): AssistantChannel {
  const text = `${said ?? ''} ${line}`.toLowerCase()
  if (text.includes('whatsapp')) return 'whatsapp'
  if (text.includes('imessage')) return 'imessage'
  return 'assistant'
}

const sameSecret = (given: string, key: string) => {
  const a = createHash('sha256').update(given).digest()
  const b = createHash('sha256').update(key).digest()
  return timingSafeEqual(a, b)
}

/** The booking page name, from a name or a booking page address. */
function slugFrom(text: string) {
  const trimmed = text.trim()
  const fromUrl = /\/book\/([a-z0-9-]{1,80})(?:[/?#]|$)/i.exec(trimmed)
  const slug = (fromUrl?.[1] ?? trimmed).toLowerCase()
  return /^[a-z0-9-]{1,80}$/.test(slug) ? slug : null
}

export function gateway(options: GatewayOptions) {
  const hmac = (what: string) => createHmac('sha256', options.key).update(what).digest('base64url')
  // The same on every instance, so a retried booking finds the same hold wherever it lands.
  const salt = options.mode === 'on' ? hmac('saleane-gateway-holds') : ''
  const customerKey = (customer: string) => hmac(`customer:${customer.trim().toLowerCase()}`)

  /** The studio and location this guest on this line is talking to, if settled. */
  function placeFor(ctx: Context, lineHash: string, customerHash: string) {
    const owned = ctx.db.get<{
      organisation_id: string
      location_id: string | null
      label: string
    }>('SELECT organisation_id,location_id,label FROM gateway_lines WHERE line_hash=?', lineHash)
    if (owned) return { ...owned, owned: true as const }
    const bound = ctx.db.get<{
      organisation_id: string
      location_id: string | null
      used_at: number
    }>(
      'SELECT organisation_id,location_id,used_at FROM gateway_bindings WHERE line_hash=? AND customer_hash=?',
      lineHash,
      customerHash,
    )
    if (!bound || bound.used_at + BINDING_MS < ctx.now()) return undefined
    return { ...bound, owned: false as const }
  }

  /** The studio as its booking page sees it, only while assistants may book there. */
  function openStudio(ctx: Context, organisationId: string): Org {
    const row = ctx.db.get<{ slug: string }>(
      'SELECT slug FROM organisations WHERE id=?',
      organisationId,
    )
    if (!row) fail(404, 'This studio is no longer on SALEANE.')
    const org = ctx.publicOrg(row!.slug)
    if (operations(org.state).mode !== 'local')
      fail(404, 'Sample studios do not take bookings by message.')
    if (!aiBookingOn(org.state))
      fail(404, 'This studio has not turned on booking through assistants.')
    return org
  }

  const locationIds = (ctx: Context, org: Org) =>
    (
      studioDetails(org.state, {
        bookingUrl: '',
        now: new Date(ctx.now()).toISOString(),
      }).data as { locations: { id: string }[] }
    ).locations.map((l) => l.id)

  function choose(ctx: Context, lineHash: string, customerHash: string, args: unknown) {
    const input = chooseInput.parse(args)
    const owned = ctx.db.get('SELECT 1 FROM gateway_lines WHERE line_hash=?', lineHash)
    if (owned)
      return toolRefusal('This line belongs to one studio already, so there is nothing to choose.')
    const slug = slugFrom(input.booking_page)
    if (!slug) return toolRefusal('Give the studio’s booking page name, such as linden-studio.')
    let org: Org
    try {
      const row = ctx.db.get<{ id: string }>('SELECT id FROM organisations WHERE slug=?', slug)
      if (!row) fail(404, 'No studio on SALEANE has that booking page name.')
      org = openStudio(ctx, row!.id)
    } catch (error) {
      if (error instanceof HttpError && error.statusCode === 404)
        return toolRefusal(`${error.message} Check the name with the guest.`)
      throw error
    }
    const places = locationIds(ctx, org)
    const location = input.location_id ?? (places.length === 1 ? places[0] : undefined)
    if (input.location_id && !places.includes(input.location_id))
      return toolRefusal(
        'That location is not one of this studio’s. Use studio_details to see them.',
      )
    const time = ctx.now()
    ctx.db.run(
      `INSERT INTO gateway_bindings(line_hash,customer_hash,organisation_id,location_id,bound_at,used_at)
       VALUES(?,?,?,?,?,?)
       ON CONFLICT(line_hash,customer_hash) DO UPDATE SET organisation_id=excluded.organisation_id,
         location_id=excluded.location_id,bound_at=excluded.bound_at,used_at=excluded.used_at`,
      lineHash,
      customerHash,
      org.id,
      location ?? null,
      time,
      time,
    )
    const name = org.state.organisation.name
    return {
      content: [
        {
          type: 'text',
          text: location
            ? `Chosen: ${name}. Use studio_details, list_treatments and find_free_times for this studio.`
            : `Chosen: ${name}, which has several locations. Use studio_details, then choose_studio again with the location_id the guest wants.`,
        },
      ],
      structuredContent: {
        studio: name,
        bookingPage: org.slug,
        ...(location ? { locationId: location } : {}),
      },
    }
  }

  /**
   * Runs a booking tool for the settled studio and location only. A location the AI names is
   * accepted only when it is the settled one.
   */
  function runFor(
    ctx: Context,
    request: IncomingMessage,
    place: { organisation_id: string; location_id: string | null },
    name: ToolName,
    args: Record<string, unknown>,
    who: { assistant: AssistantChannel; customer: string; customerHash: string; lineHash: string },
  ) {
    const org = openStudio(ctx, place.organisation_id)
    let input = args
    if ((name === 'find_free_times' || name === 'book_time') && place.location_id) {
      if (input.location_id && input.location_id !== place.location_id)
        return toolRefusal(
          'This conversation is for another location of the studio. Use choose_studio to change it.',
        )
      input = { ...input, location_id: place.location_id }
    }
    if (
      name === 'book_time' &&
      !String(input.guest_phone ?? '').trim() &&
      /^\+?[0-9 ()-]{7,20}$/.test(who.customer)
    )
      input = { ...input, guest_phone: who.customer }
    // Limits count per guest, not per carrier: every message arrives from the carrier's server.
    const asGuest = Object.create(request, {
      socket: { value: { remoteAddress: `gateway:${who.customerHash}` } },
    }) as IncomingMessage
    return runBookingTool(ctx, asGuest, org, name, input, {
      assistant: who.assistant,
      key: `${who.lineHash}:${who.customerHash}`,
      salt,
    })
  }

  async function endpoint(
    ctx: Context,
    request: IncomingMessage,
    response: ServerResponse,
    method: string,
    pathname: string,
  ): Promise<boolean> {
    if (pathname !== GATEWAY_PATH) return false
    let rpcId: string | number | null = null
    const send = (status: number, body?: unknown) => {
      response.statusCode = status
      response.setHeader('Cache-Control', 'no-store')
      if (body === undefined) {
        response.end()
        return
      }
      response.setHeader('Content-Type', 'application/json; charset=utf-8')
      response.end(JSON.stringify(body))
    }
    const rpcError = (status: number, code: number, words: string) =>
      send(status, { jsonrpc: '2.0', id: rpcId, error: { code, message: words } })
    try {
      if (options.mode === 'off') fail(404, 'This endpoint was not found.')
      // Server to server only: a web page never reaches it through someone's browser.
      const from = header(request, 'origin')
      if (from && from !== ctx.allowedOrigin)
        fail(403, 'This connection does not take requests from web pages.')
      const bearer = /^Bearer\s+(\S+)$/i.exec(header(request, 'authorization') ?? '')?.[1] ?? ''
      if (!bearer || !sameSecret(bearer, options.key)) {
        ctx.rateLimit(request, 'gateway-refused', 20, 10 * 60000)
        fail(401, 'This connection needs the gateway key.')
      }
      if (method !== 'POST') {
        response.setHeader('Allow', 'POST')
        fail(405, 'Send requests with POST.')
      }
      const version = header(request, 'mcp-protocol-version')
      if (version && !(PROTOCOL_VERSIONS as readonly string[]).includes(version))
        fail(400, `This connection speaks protocol versions ${PROTOCOL_VERSIONS.join(', ')}.`)
      if (!/^application\/json(?:\s*;|$)/i.test(header(request, 'content-type') ?? ''))
        fail(415, 'Send JSON.')
      const line = lineHeader.safeParse(header(request, 'saleane-line') ?? '')
      const customer = customerHeader.safeParse(header(request, 'saleane-customer') ?? '')
      if (!line.success || !customer.success)
        fail(
          400,
          'Every request names the line the guest wrote to (Saleane-Line) and the guest (Saleane-Customer).',
        )
      const lineHash = lineKey(line.data!)
      const customerHash = customerKey(customer.data!)
      let body: unknown
      try {
        body = JSON.parse((await readBody(request, true)) as string)
      } catch (error) {
        if (error instanceof HttpError) throw error
        rpcError(400, PARSE_ERROR, 'Parse error: send one JSON-RPC message.')
        return true
      }
      const parsed = rpcMessage.safeParse(body)
      if (Array.isArray(body) || !parsed.success) {
        rpcError(400, INVALID_REQUEST, 'Invalid request: send one JSON-RPC 2.0 message.')
        return true
      }
      const rpc = parsed.data
      rpcId = rpc.id ?? null
      if (rpc.method === undefined || rpc.id === undefined) {
        send(202)
        return true
      }
      ctx.rateLimit(
        Object.create(request, { socket: { value: { remoteAddress: `gateway:${customerHash}` } } }),
        'gateway-guest',
        60,
        10 * 60000,
      )
      const assistant = channelOf(line.data!, header(request, 'saleane-channel'))
      const params = rpc.params ?? {}
      let result: unknown
      if (rpc.method === 'initialize') {
        result = {
          protocolVersion: (PROTOCOL_VERSIONS as readonly string[]).includes(
            String(params.protocolVersion ?? ''),
          )
            ? params.protocolVersion
            : PROTOCOL_VERSIONS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: {
            name: 'saleane-gateway',
            title: 'SALEANE bookings by message',
            version: TOOLS_VERSION,
          },
          instructions:
            "You book visits for the guest you are messaging, at the studio they chose, with the same checks as the studio's own booking page. If no studio is chosen yet, ask the guest which one and call choose_studio. Use studio_details, list_treatments and find_free_times. Before book_time, tell the guest the treatment, day, time, price and cancelling terms, and set guest_confirmed only after they say yes. Never sign the guest up for news or offers, and always say you are an AI.",
        }
      } else if (rpc.method === 'ping') result = {}
      else if (rpc.method === 'tools/list') result = { tools: [CHOOSE_TOOL, ...TOOLS] }
      else if (rpc.method === 'tools/call') {
        const call = z
          .object({
            name: z.string().max(100),
            arguments: z.record(z.string(), z.unknown()).optional(),
          })
          .passthrough()
          .safeParse(params)
        if (!call.success) {
          rpcError(200, INVALID_PARAMS, 'Invalid params for tools/call.')
          return true
        }
        const name = call.data.name
        const args = call.data.arguments ?? {}
        if (name === CHOOSE_TOOL.name) {
          const checked = chooseInput.safeParse(args)
          if (!checked.success) {
            rpcError(200, INVALID_PARAMS, 'Invalid arguments for choose_studio.')
            return true
          }
          result = choose(ctx, lineHash, customerHash, checked.data)
        } else if (!Object.hasOwn(toolInputs, name)) {
          rpcError(200, INVALID_PARAMS, `Unknown tool: ${name}`)
          return true
        } else {
          const checked = toolInputs[name as ToolName].safeParse(
            name === 'book_time' ? { guest_phone: '', ...args } : args,
          )
          if (!checked.success) {
            rpcError(
              200,
              INVALID_PARAMS,
              `Invalid arguments for ${name}: ${checked.error.issues
                .map((issue) => `${issue.path.join('.') || 'arguments'}: ${issue.message}`)
                .join('; ')}`,
            )
            return true
          }
          const place = placeFor(ctx, lineHash, customerHash)
          if (!place) result = toolRefusal(UNCHOSEN)
          else {
            try {
              result = runFor(
                ctx,
                request,
                place,
                name as ToolName,
                checked.data as Record<string, unknown>,
                {
                  assistant,
                  customer: customer.data!,
                  customerHash,
                  lineHash,
                },
              )
              if (!place.owned)
                ctx.db.run(
                  'UPDATE gateway_bindings SET used_at=? WHERE line_hash=? AND customer_hash=?',
                  ctx.now(),
                  lineHash,
                  customerHash,
                )
            } catch (error) {
              if (error instanceof HttpError && error.statusCode === 404)
                result = toolRefusal(`${error.message} Ask the guest to choose another studio.`)
              else throw error
            }
          }
        }
      } else {
        rpcError(200, METHOD_NOT_FOUND, `Method not found: ${rpc.method}`)
        return true
      }
      send(200, { jsonrpc: '2.0', id: rpcId, result })
    } catch (error) {
      if (error instanceof HttpError) rpcError(error.statusCode, SERVER_ERROR, error.message)
      else if (error instanceof z.ZodError) rpcError(200, INVALID_PARAMS, 'Invalid params.')
      else {
        console.error('[SALEANE] The messaging gateway could not answer.', error)
        rpcError(500, INTERNAL_ERROR, 'SALEANE could not complete this request.')
      }
    }
    return true
  }

  /**
   * The owner's view and the lines the studio owns outright. A line can belong to one studio only;
   * claiming one another studio holds is refused without saying whose it is.
   */
  async function manage(ctx: Context, route: Route): Promise<boolean> {
    const { request, method, path, reply, body } = route
    if (path[1] !== 'workspaces' || path[3] !== 'gateway') return false
    const actor = ctx.actorFor(request, method !== 'GET')
    const org = ctx.orgFor(path[2], actor)
    if (org.role !== 'owner') fail(403, 'Only the owner can manage booking by message.')
    const lines = () =>
      ctx.db.all<{
        line_hash: string
        label: string
        location_id: string | null
        created_at: number
      }>(
        'SELECT line_hash,label,location_id,created_at FROM gateway_lines WHERE organisation_id=? ORDER BY created_at',
        org.id,
      )
    if (path.length === 4 && method === 'GET') {
      reply(200, {
        mode: options.mode,
        on: aiBookingOn(org.state),
        sample: operations(org.state).mode === 'sandbox',
        bookingPage: org.slug,
        lines: lines().map((l) => ({ id: l.line_hash, label: l.label, locationId: l.location_id })),
      })
      return true
    }
    if (path.length === 5 && path[4] === 'lines' && method === 'POST') {
      const data = z
        .object({ line: lineHeader, locationId: z.string().trim().min(1).max(150).optional() })
        .strict()
        .parse(body)
      if (operations(org.state).mode !== 'local') fail(422, 'Sample studios cannot own a line.')
      const places = locationIds(ctx, org)
      const location = data.locationId ?? (places.length === 1 ? places[0] : undefined)
      if (!location || !places.includes(location))
        fail(422, 'Choose which location this line is for.')
      const hash = lineKey(data.line)
      const taken = ctx.db.get<{ organisation_id: string }>(
        'SELECT organisation_id FROM gateway_lines WHERE line_hash=?',
        hash,
      )
      if (taken && taken.organisation_id !== org.id)
        fail(409, 'This line is already in use. If it is yours, contact SALEANE support.')
      ctx.db.transaction(() => {
        ctx.db.run(
          `INSERT INTO gateway_lines(line_hash,label,organisation_id,location_id,created_by,created_at) VALUES(?,?,?,?,?,?)
           ON CONFLICT(line_hash) DO UPDATE SET label=excluded.label,location_id=excluded.location_id`,
          hash,
          data.line.trim(),
          org.id,
          location,
          actor.id,
          ctx.now(),
        )
        // Guests who chose a studio on this line before it became one studio's own start afresh.
        ctx.db.run('DELETE FROM gateway_bindings WHERE line_hash=?', hash)
        ctx.audit(org, actor.id, 'gateway.line', hash)
      })
      reply(201, {
        lines: lines().map((l) => ({ id: l.line_hash, label: l.label, locationId: l.location_id })),
      })
      return true
    }
    if (path.length === 6 && path[4] === 'lines' && method === 'DELETE') {
      ctx.db.transaction(() => {
        const removed = ctx.db.run(
          'DELETE FROM gateway_lines WHERE line_hash=? AND organisation_id=?',
          path[5],
          org.id,
        )
        if (Number(removed.changes) !== 1) fail(404, 'This line was not found.')
        ctx.audit(org, actor.id, 'gateway.line-removed', path[5])
      })
      reply(200, {
        lines: lines().map((l) => ({ id: l.line_hash, label: l.label, locationId: l.location_id })),
      })
      return true
    }
    fail(405, 'This method is not allowed here.')
    return true
  }

  return { endpoint, manage, salt }
}
