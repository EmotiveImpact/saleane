import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import { digest, token } from './auth'
import { HttpError, canonical, fail, header, readBody } from './http'
import type { Context, Org, Route } from './context'
import { HOLD_LIMITS, guestContact } from './context'
import { bookHeld, holdTime } from './routes/public'
import { slots } from '../src/domain/commands'
import { businessDate, operations } from '../src/domain/operations'
import { addDays } from '../src/domain/format'
import { guestPhone, phoneProblem } from '../src/domain/phone'
import { BOOKING_DAYS } from '../src/domain/bookingTerms'
import type { AssistantChannel } from '../src/domain/model'
import {
  aiBookingAction,
  aiBookingActor,
  aiBookingOn,
  assistantFrom,
  bookedAnswer,
  bookingChoice,
  clockMinutes,
  freeTimes,
  studioDetails,
  treatmentList,
} from '../src/domain/aiBooking'
import type { ToolAnswer, ToolRefusal } from '../src/domain/aiBooking'

/**
 * Stage 5: booking through ChatGPT or Claude. A remote MCP server for each studio (Model Context
 * Protocol: JSON-RPC 2.0 over HTTP POST, the streamable HTTP transport, answered with
 * application/json), so an AI assistant can read what the booking page shows and book a time for
 * the guest it is helping. Off until the owner turns it on; a studio whose online booking is off
 * or which is locked for an unpaid bill answers nothing, as its booking page does. A booking goes
 * through the booking page's own hold and book, with the same checks. Test mode, the only mode so
 * far, answers only on this computer: ChatGPT and Claude reach it once SALEANE is online.
 */

export type AiBookingOptions = { mode: 'off' | 'test' }

export function aiBookingFromEnv(env: NodeJS.ProcessEnv): AiBookingOptions {
  const mode = env.SALEANE_AI_BOOKING ?? 'test'
  if (mode !== 'off' && mode !== 'test')
    throw new Error(`Unknown AI booking mode "${mode}". Use "off" or "test".`)
  return { mode }
}

/** The address of a studio's connection, by its booking page's name. */
export const MCP_PATH = /^\/api\/mcp\/([a-z0-9-]{1,80})$/
export const mcpAddress = (origin: string, slug: string) => `${origin}/api/mcp/${slug}`
/** Protocol versions this server speaks, newest first. */
export const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26'] as const
/** The version of these tools, changed when what they take or give changes. */
const TOOLS_VERSION = '2026-10-10'
/** A connection stays open this long after its last request; after that it connects again. */
const SESSION_IDLE_MS = 12 * 60 * 60000
const SESSION_LIMIT = 5000
/**
 * The same booking asked for again this soon after it was made (an answer that never reached the
 * assistant) returns that visit again; after that it is a new booking, which finds the time taken.
 */
const RETRY_MS = 15 * 60000
const LOCAL = ['127.0.0.1', 'localhost', '[::1]']

// JSON-RPC 2.0 error codes.
const PARSE_ERROR = -32700
const INVALID_REQUEST = -32600
const METHOD_NOT_FOUND = -32601
const INVALID_PARAMS = -32602
const INTERNAL_ERROR = -32603
/** A refusal from SALEANE itself: not turned on, too many requests, a session that has ended. */
const SERVER_ERROR = -32000

const id = z.string().trim().min(1).max(150)
const civilDate = z.iso.date()
const toolInputs = {
  studio_details: z.object({}).strict(),
  list_treatments: z.object({}).strict(),
  find_free_times: z
    .object({
      treatment_id: id,
      professional_id: id.optional(),
      location_id: id.optional(),
      from_date: civilDate.optional(),
      to_date: civilDate.optional(),
    })
    .strict(),
  book_time: z
    .object({
      treatment_id: id,
      date: civilDate,
      start: z.string().trim().max(5),
      professional_id: id.optional(),
      location_id: id.optional(),
      guest_name: z.string().trim().max(100),
      guest_email: z.string().trim().max(254),
      guest_phone: z.string().trim().max(30),
      guest_confirmed: z.boolean(),
    })
    .strict(),
}
type ToolName = keyof typeof toolInputs

const text = (description: string) => ({ type: 'string', description })
/** The tools as tools/list describes them, with JSON Schema for what each takes. */
const TOOLS = [
  {
    name: 'studio_details',
    title: 'Studio details and opening hours',
    description:
      "The studio's name, today's date on its clock, each location's address, phone, email and opening hours, days it is closed, how cancelling works and its booking page.",
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'list_treatments',
    title: 'Treatments to book',
    description:
      'The treatments guests can book here, with their length, full price, locations and the professionals who do them. Treatments that need a deposit or a patch test are listed by name only: guests book those on the studio’s booking page.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'find_free_times',
    title: 'Find free times',
    description:
      'Free start times for one treatment, day by day, on the studio’s own clock, for a professional or anyone. At most 14 days in one answer.',
    inputSchema: {
      type: 'object',
      properties: {
        treatment_id: text('The treatment, from list_treatments.'),
        professional_id: text('A professional from list_treatments. Leave out for anyone.'),
        location_id: text('A location from studio_details. Leave out for any.'),
        from_date: {
          type: 'string',
          format: 'date',
          description:
            'The first day, as YYYY-MM-DD on the studio’s calendar. Leave out for today.',
        },
        to_date: {
          type: 'string',
          format: 'date',
          description: 'The last day, as YYYY-MM-DD. Leave out for a week.',
        },
      },
      required: ['treatment_id'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'book_time',
    title: 'Book a time',
    description:
      'Books a free time for the guest, with the same checks as the studio’s booking page, and gives their private link to see, move or cancel the visit. First tell the guest the treatment, day, time, price and the cancelling terms, and set guest_confirmed to true only after they say yes. The guest is never signed up for news or offers.',
    inputSchema: {
      type: 'object',
      properties: {
        treatment_id: text('The treatment, from list_treatments.'),
        date: { type: 'string', format: 'date', description: 'The day, as YYYY-MM-DD.' },
        start: {
          type: 'string',
          pattern: '^([01][0-9]|2[0-3]):[0-5][0-9]$',
          description: 'The start time on the studio’s clock, as HH:MM, from find_free_times.',
        },
        professional_id: text('A professional from list_treatments. Leave out for anyone.'),
        location_id: text('A location from studio_details. Leave out for any.'),
        guest_name: text('The guest’s full name.'),
        guest_email: { type: 'string', format: 'email', description: 'The guest’s email address.' },
        guest_phone: text('The guest’s phone number, ideally with its country code.'),
        guest_confirmed: {
          type: 'boolean',
          description:
            'True only once the guest has said yes to this treatment, day, time, price and the cancelling terms.',
        },
      },
      required: [
        'treatment_id',
        'date',
        'start',
        'guest_name',
        'guest_email',
        'guest_phone',
        'guest_confirmed',
      ],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
] as const

type Session = { orgId: string; assistant: AssistantChannel; expires: number }
type RpcId = string | number | null
const message = z
  .object({
    jsonrpc: z.literal('2.0'),
    id: z.union([z.string().max(200), z.number()]).optional(),
    method: z.string().max(200).optional(),
    params: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough()

const answer = ({ text, data }: ToolAnswer) => ({
  content: [{ type: 'text', text }],
  structuredContent: data,
})
const refusal = (words: string) => ({ content: [{ type: 'text', text: words }], isError: true })

export function aiBooking(options: AiBookingOptions) {
  const sessions = new Map<string, Session>()
  // Keys for repeated bookings are kept per process, so they never reveal what was asked.
  const salt = token()

  /** The tool's answer, or a refusal the assistant reads and can put right. */
  function runTool(
    ctx: Context,
    request: IncomingMessage,
    org: Org,
    name: ToolName,
    args: unknown,
    who: { assistant: AssistantChannel; key: string },
  ) {
    const bookingUrl = `${ctx.allowedOrigin}/book/${org.slug}`
    const now = new Date(ctx.now()).toISOString()
    if (name === 'studio_details') return answer(studioDetails(org.state, { bookingUrl, now }))
    if (name === 'list_treatments') return answer(treatmentList(org.state, { bookingUrl }))
    if (name === 'find_free_times') {
      const found = freeTimes(ctx.withHolds(org), toolInputs.find_free_times.parse(args), {
        bookingUrl,
        now,
      })
      return 'refused' in found ? refusal(found.refused) : answer(found)
    }
    const input = toolInputs.book_time.parse(args)
    const booked = book(ctx, request, org, input, { ...who, bookingUrl })
    return 'refused' in booked ? refusal(booked.refused) : answer(booked)
  }

  /**
   * Books a time for the guest through the booking page's own hold and book: price, deposit and
   * tax checked again, the patch test rule and the online booking rules. Marketing consent is
   * never assumed. The same request again soon after returns the same visit.
   */
  function book(
    ctx: Context,
    request: IncomingMessage,
    org: Org,
    input: z.infer<(typeof toolInputs)['book_time']>,
    who: { assistant: AssistantChannel; key: string; bookingUrl: string },
  ): ToolAnswer | ToolRefusal {
    ctx.rateLimit(request, 'public-write', 20, 5 * 60000)
    if (!input.guest_confirmed)
      return {
        refused:
          'Nothing was booked. Tell the guest the treatment, day, time, price and the cancelling terms, and book again with guest_confirmed set to true once they say yes.',
      }
    const state = org.state
    const choice = bookingChoice(state, input, who.bookingUrl)
    if ('refused' in choice) return choice
    const startMinutes = clockMinutes(input.start)
    if (startMinutes === null)
      return { refused: 'Give the start as HH:MM on the studio’s clock, such as 09:30.' }
    const today = businessDate(state, new Date(ctx.now()).toISOString())
    if (input.date < today || input.date > addDays(today, BOOKING_DAYS - 1))
      return { refused: 'Choose a day from today, within the year ahead.' }
    const contact = guestContact.safeParse({
      name: input.guest_name,
      email: input.guest_email,
      phone: input.guest_phone,
      // Never assumed: the guest agrees to news and offers only on the booking page itself.
      marketingConsent: false,
    })
    if (!contact.success)
      return { refused: 'Give the guest’s full name and a working email address.' }
    const region = state.organisation.region
    const phone = guestPhone(region, contact.data.phone)
    if (!phone) return { refused: phoneProblem(region) }
    const asked = {
      serviceId: choice.service.id,
      staffId: choice.staffId,
      date: input.date,
      startMinutes,
      ...(choice.locationId ? { locationId: choice.locationId } : {}),
    }
    // The hold's key comes from what was asked, on which connection, so the same request again
    // finds the same hold. The connection's id is secret to the assistant, so nobody else who
    // knows the guest's details can ask again for their private link.
    const raw = `aib_${digest(`${salt}:${org.id}:${who.key}:${canonical({ ...asked, contact: contact.data })}`)}`
    const hash = digest(raw)
    const earlier = ctx.db.get<{ appointment_id: string | null; expires_at: number }>(
      'SELECT appointment_id,expires_at FROM booking_holds WHERE token_hash=? AND organisation_id=?',
      hash,
      org.id,
    )
    const time = ctx.now()
    if (earlier?.appointment_id) {
      const visit = state.appointments.find((a) => a.id === earlier.appointment_id)
      if (time > earlier.expires_at + RETRY_MS || visit?.status !== 'confirmed')
        return { refused: 'That time is no longer free. Use find_free_times to choose another.' }
    }
    const run = () =>
      bookHeld(ctx, org.slug, {
        hold: raw,
        contact: contact.data,
        channel: who.assistant,
        actor: aiBookingActor(who.assistant),
        action: aiBookingAction(who.assistant),
      })
    let result: ReturnType<typeof bookHeld>
    try {
      if (!earlier?.appointment_id) {
        if (earlier)
          ctx.db.run(
            'DELETE FROM booking_holds WHERE token_hash=? AND appointment_id IS NULL',
            hash,
          )
        // Only a time the booking page would offer.
        const offered = slots(
          ctx.withHolds(org),
          asked.serviceId,
          asked.staffId,
          asked.date,
          new Date(time).toISOString(),
          asked.locationId,
        )
        if (!offered.includes(startMinutes))
          return { refused: 'That time is not free. Use find_free_times to choose another.' }
        ctx.rateLimit(request, 'public-hold-minute', HOLD_LIMITS.HOLDS_PER_MINUTE, 60000)
        ctx.rateLimit(request, 'public-hold-hour', HOLD_LIMITS.HOLDS_PER_HOUR, 60 * 60000)
        // Held for this connection, so guests behind the same address never replace its hold.
        holdTime(ctx, org.slug, asked, { raw, visitor: digest(`ai-booking:${raw}`) })
      }
      try {
        result = run()
      } catch (error) {
        // A time held but not booked goes back for other guests at once.
        ctx.db.run('DELETE FROM booking_holds WHERE token_hash=? AND appointment_id IS NULL', hash)
        throw error
      }
    } catch (error) {
      if (error instanceof HttpError && error.statusCode !== 429) return { refused: error.message }
      throw error
    }
    const fresh = ctx.systemOrg(org.id)!
    return bookedAnswer(fresh.state, result.appointmentId, {
      manageUrl: result.manage.url,
      now: ctx.now(),
      emailsLive: operations(fresh.state).mode !== 'sandbox' && ctx.messaging.email.live,
    })
  }

  type Outcome = { result: unknown } | { code: number; words: string }

  /** The answer to one JSON-RPC request from the assistant. */
  function respond(
    ctx: Context,
    request: IncomingMessage,
    response: ServerResponse,
    org: Org,
    method: string,
    params: Record<string, unknown>,
    connection: { sessionId: string; assistant: AssistantChannel },
  ): Outcome {
    const invalid = { code: INVALID_PARAMS, words: `Invalid params for ${method}.` }
    if (method === 'initialize') {
      const init = z
        .object({
          protocolVersion: z.string().max(40),
          clientInfo: z
            .object({ name: z.string().max(200), title: z.string().max(200).optional() })
            .passthrough()
            .optional(),
        })
        .passthrough()
        .safeParse(params)
      if (!init.success) return invalid
      const assistant = assistantFrom(
        init.data.clientInfo?.name,
        init.data.clientInfo?.title,
        header(request, 'user-agent'),
      )
      for (const [key, open] of sessions) if (open.expires <= ctx.now()) sessions.delete(key)
      if (sessions.size >= SESSION_LIMIT) sessions.delete(sessions.keys().next().value!)
      const created = token()
      sessions.set(created, { orgId: org.id, assistant, expires: ctx.now() + SESSION_IDLE_MS })
      response.setHeader('Mcp-Session-Id', created)
      const bookingUrl = `${ctx.allowedOrigin}/book/${org.slug}`
      const name = org.state.organisation.name
      return {
        result: {
          protocolVersion: (PROTOCOL_VERSIONS as readonly string[]).includes(
            init.data.protocolVersion,
          )
            ? init.data.protocolVersion
            : PROTOCOL_VERSIONS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'saleane-booking', title: `${name} booking`, version: TOOLS_VERSION },
          instructions: `This connection books visits at ${name} for the guest you are helping, with the same checks as the studio's own booking page. Use studio_details for the address, opening hours and cancelling terms, list_treatments for what can be booked here, and find_free_times for free times. Before book_time, tell the guest the treatment, day, time, price and the cancelling terms, and set guest_confirmed only after they say yes. Never sign the guest up for news or offers. Treatments that need a deposit or a patch test are booked on the studio's booking page: ${bookingUrl}`,
        },
      }
    }
    if (method === 'ping') return { result: {} }
    if (method === 'tools/list') return { result: { tools: TOOLS } }
    if (method !== 'tools/call')
      return { code: METHOD_NOT_FOUND, words: `Method not found: ${method}` }
    const call = z
      .object({ name: z.string().max(100), arguments: z.unknown().optional() })
      .passthrough()
      .safeParse(params)
    if (!call.success) return invalid
    if (!Object.hasOwn(toolInputs, call.data.name))
      return { code: INVALID_PARAMS, words: `Unknown tool: ${call.data.name}` }
    const name = call.data.name as ToolName
    const args = toolInputs[name].safeParse(call.data.arguments ?? {})
    if (!args.success)
      return {
        code: INVALID_PARAMS,
        words: `Invalid arguments for ${name}: ${args.error.issues
          .map((issue) => `${issue.path.join('.') || 'arguments'}: ${issue.message}`)
          .join('; ')}`,
      }
    // Each tool call counts like a guest's message to the AI receptionist.
    ctx.rateLimit(request, 'ai-booking-tool', 40, 10 * 60000)
    return {
      result: runTool(ctx, request, org, name, args.data, {
        assistant: connection.assistant,
        key: connection.sessionId,
      }),
    }
  }

  /**
   * The studio's connection, called by an AI assistant rather than a SALEANE page, so it is
   * handled before the checks for the workspace's own pages. Returns false for other paths.
   */
  async function endpoint(
    ctx: Context,
    request: IncomingMessage,
    response: ServerResponse,
    method: string,
    pathname: string,
  ): Promise<boolean> {
    const match = MCP_PATH.exec(pathname)
    if (!match) return false
    let rpcId: RpcId = null
    const send = (status: number, body?: unknown) => {
      response.statusCode = status
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
      // Test mode answers only on this computer, so no assistant on the internet can book into a
      // real studio's diary before SALEANE is online and this connection is checked.
      if (!LOCAL.includes(ctx.origin.hostname))
        fail(
          503,
          'Booking through ChatGPT or Claude is in test mode, so it only answers on the computer SALEANE runs on.',
        )
      // A web page elsewhere never reaches it through someone's browser.
      const from = header(request, 'origin')
      if (from && from !== ctx.allowedOrigin)
        fail(403, 'This connection does not take requests from web pages.')
      ctx.rateLimit(request, 'ai-booking', 120, 10 * 60000)
      // Online booking off, or a studio locked for an unpaid bill, answers as its booking page does.
      const org = ctx.publicOrg(match[1])
      if (!aiBookingOn(org.state))
        fail(404, 'Booking through ChatGPT or Claude is not turned on for this studio.')
      const sessionId = header(request, 'mcp-session-id')
      const session = sessionId ? sessions.get(sessionId) : undefined
      if (method === 'DELETE') {
        if (!session || session.orgId !== org.id) fail(404, 'This connection has ended.')
        sessions.delete(sessionId!)
        send(204)
        return true
      }
      if (method !== 'POST') {
        response.setHeader('Allow', 'POST, DELETE')
        fail(405, 'Send requests with POST.')
      }
      const version = header(request, 'mcp-protocol-version')
      if (version && !(PROTOCOL_VERSIONS as readonly string[]).includes(version))
        fail(400, `This connection speaks protocol versions ${PROTOCOL_VERSIONS.join(', ')}.`)
      if (!/^application\/json(?:\s*;|$)/i.test(header(request, 'content-type') ?? ''))
        fail(415, 'Send JSON.')
      let body: unknown
      try {
        body = JSON.parse((await readBody(request, true)) as string)
      } catch (error) {
        if (error instanceof HttpError) throw error
        rpcError(400, PARSE_ERROR, 'Parse error: send one JSON-RPC message.')
        return true
      }
      if (Array.isArray(body)) {
        rpcError(400, INVALID_REQUEST, 'Send one JSON-RPC message at a time.')
        return true
      }
      const parsed = message.safeParse(body)
      if (!parsed.success) {
        rpcError(400, INVALID_REQUEST, 'Invalid request: this is not a JSON-RPC 2.0 message.')
        return true
      }
      const rpc = parsed.data
      rpcId = rpc.id ?? null
      // Every message after the first carries the connection it belongs to, which also keys a
      // repeated booking; a connection this server no longer knows (after a restart, say) is told
      // to connect again.
      if (rpc.method !== 'initialize') {
        if (!sessionId)
          fail(
            400,
            'Connect first: send initialize, then send the Mcp-Session-Id it gives with every message.',
          )
        if (!session || session.orgId !== org.id)
          fail(404, 'This connection has ended. Connect again.')
        session!.expires = ctx.now() + SESSION_IDLE_MS
      }
      // A notification, or an answer to something this server never asks, needs no reply.
      if (rpc.method === undefined) {
        if (!('result' in rpc) && !('error' in rpc)) {
          rpcError(400, INVALID_REQUEST, 'Invalid request: a JSON-RPC request needs a method.')
          return true
        }
        send(202)
        return true
      }
      if (rpc.id === undefined) {
        send(202)
        return true
      }
      const outcome = respond(ctx, request, response, org, rpc.method, rpc.params ?? {}, {
        sessionId: sessionId ?? '',
        assistant: session?.assistant ?? 'assistant',
      })
      if ('code' in outcome) rpcError(200, outcome.code, outcome.words)
      else send(200, { jsonrpc: '2.0', id: rpcId, result: outcome.result })
    } catch (error) {
      if (error instanceof HttpError) rpcError(error.statusCode, SERVER_ERROR, error.message)
      else if (error instanceof z.ZodError) rpcError(200, INVALID_PARAMS, 'Invalid params.')
      else rpcError(500, INTERNAL_ERROR, 'The local service could not complete this request.')
    }
    return true
  }

  /** The owner's view: whether the connection answers here, and the address to give out. */
  async function manage(ctx: Context, route: Route): Promise<boolean> {
    const { request, method, path, reply } = route
    if (path[1] !== 'workspaces' || path[3] !== 'ai-booking' || path.length !== 4) return false
    const org = ctx.orgFor(path[2], ctx.actorFor(request, method !== 'GET'))
    if (org.role !== 'owner')
      fail(403, 'Only the owner can see the address for ChatGPT and Claude.')
    if (method !== 'GET') fail(405, 'Use GET.')
    reply(200, {
      mode: options.mode,
      // Test mode answers only when SALEANE runs on this computer.
      reachable: options.mode === 'test' && LOCAL.includes(ctx.origin.hostname),
      address: mcpAddress(ctx.allowedOrigin, org.slug),
      sample: operations(org.state).mode === 'sandbox',
    })
    return true
  }

  return { endpoint, manage }
}
