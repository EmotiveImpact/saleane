import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import { digest } from './auth'
import { HttpError, canonical, header, readBody } from './http'
import type { Context } from './context'
import { appointmentView, refuse } from './partnerShared'
import type { KeyAuth } from './partnerShared'
import { erasureRequested } from './messaging/news'
import { giftCardHoldProblem } from './payments/service'
import { followGuestLinks } from './routes/guest'
import { dispatch, rescheduleResource } from '../src/domain/commands'
import type { Command, SoftwareSource } from '../src/domain/commands'
import { branchChangeRefusal, branchRefusal } from '../src/domain/branch'
import { places } from '../src/domain/locations'
import { instantFor } from '../src/domain/operations'
import {
  patchTestSettings,
  patchTestStanding,
  serviceNeedsPatchTest,
} from '../src/domain/patchTests'
import { otherTillRefundInputSchema, otherTillSaleInputSchema } from '../src/domain/otherTillSchema'
import type { OtherTillSale } from '../src/domain/otherTillSchema'
import { otherTillSales, sentBefore, shelfShort } from '../src/domain/otherTill'
import type { ApiScope } from '../src/domain/accessKeys'
import type { BusinessState, Client } from '../src/domain/model'

/**
 * Stage 5: other software sending things in through an access key: booking, moving and cancelling
 * visits, adding and changing clients, and a chain's own tills sending in their sales. Every write
 * goes through the desk's own commands and checks, is recorded in Who changed what under the key's
 * name, and tells connected software about it, marked as coming from that key.
 *
 * Every write carries an Idempotency-Key. The first successful answer is kept with a hash of what
 * was asked, in the same transaction as the change: the same key with the same request gets that
 * answer again and changes nothing; the same key with a different request is refused. A refused
 * request keeps nothing, so it can be put right and sent again with the same key.
 */

/** How long a kept answer can be asked for again. */
const KEPT_MS = 30 * 86400000
const id = z.string().min(1).max(150)
const clock = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a 24-hour time such as "14:30".')
  .transform((value) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5)))

/** Whether a client agreed to email news, as the other software heard it. Never assumed. */
const emailNews = z
  .object({
    agreed: z.boolean(),
    /** When the client said so. */
    at: z.iso.datetime({ offset: true }),
    /** How they said so, in the software's words: "Ticked the box on our booking form". */
    how: z.string().trim().min(2).max(200),
    /** The version of the studio's email news wording they agreed to (GET /api/v1/studio). */
    wordingVersion: z.number().int().min(1).optional(),
  })
  .strict()
const contact = z
  .object({
    name: z.string().trim().min(2).max(100),
    email: z.email().max(254),
    phone: z.string().trim().min(7).max(30),
    emailNews: emailNews.optional(),
  })
  .strict()
const bookInput = z
  .object({
    serviceId: id,
    /** A professional, or "any" for whoever is free. */
    professionalId: id.default('any'),
    date: z.iso.date(),
    start: clock,
    locationId: id.optional(),
    clientId: id.optional(),
    client: contact.optional(),
  })
  .strict()
  .refine((x) => !!x.clientId !== !!x.client, {
    message: 'Send either clientId or client, not both.',
    path: ['clientId'],
  })
const moveInput = z
  .object({
    date: z.iso.date().optional(),
    start: clock.optional(),
    professionalId: id.optional(),
    locationId: id.optional(),
  })
  .strict()
  .refine((x) => Object.keys(x).length > 0, { message: 'Say what to change.' })
const cancelInput = z.object({ reason: z.string().trim().min(2).max(300).optional() }).strict()
const clientChange = contact
  .partial()
  .strict()
  .refine((x) => Object.keys(x).length > 0, { message: 'Say what to change.' })
const tillKind = z.object({ kind: z.enum(['sale', 'refund']).default('sale') }).passthrough()

/** A refusal that also carries something the software can act on, such as the matching client. */
class Refusal extends HttpError {
  constructor(
    status: number,
    code: string,
    message: string,
    readonly extra: Record<string, unknown>,
  ) {
    super(status, message, code)
  }
}

const CODES: Record<number, string> = {
  400: 'invalid_request',
  401: 'unauthorised',
  402: 'locked',
  403: 'forbidden_scope',
  404: 'not_found',
  409: 'conflict',
  413: 'too_large',
  415: 'unsupported_media_type',
  422: 'unprocessable',
  429: 'rate_limited',
}

const WRITE_WORDS: Partial<Record<ApiScope, string>> = {
  'appointments:write': 'add or change visits',
  'clients:write': 'add or change clients',
  'sales:write': 'send in till sales',
}

/** The Idempotency-Key header: printable, up to 255 characters, quoted or not. */
function idempotencyKey(request: IncomingMessage) {
  const raw =
    header(request, 'idempotency-key')
      ?.trim()
      .replace(/^"(.*)"$/, '$1') ?? ''
  if (!/^[\x21-\x7e]{1,255}$/.test(raw))
    refuse(
      400,
      'idempotency_key_missing',
      'Send an Idempotency-Key header with every write: a new random value for each change, the same value when you send that change again.',
    )
  return raw
}

const clientView = (c: Client) => ({
  id: c.id,
  name: c.name,
  email: c.email,
  phone: c.phone,
  emailNews: c.marketingConsent,
  createdAt: c.createdAt,
})

function saleView(s: BusinessState, sale: OtherTillSale) {
  const original = sale.refundOf ? otherTillSales(s).find((x) => x.id === sale.refundOf) : undefined
  return {
    id: sale.id,
    kind: sale.kind,
    locationId: sale.locationId,
    receipt: sale.receipt,
    ...(original ? { refundOf: original.receipt } : {}),
    occurredAt: sale.occurredAt,
    recordedAt: sale.recordedAt,
    staffId: sale.staffId ?? null,
    currency: sale.currency,
    totalMinor: sale.totalMinor,
    taxMinor: sale.taxMinor,
    lines: sale.lines.map((line) => ({
      kind: line.kind,
      name: line.name,
      serviceId: line.serviceId ?? null,
      productId: line.productId ?? null,
      quantity: line.quantity,
      totalMinor: line.totalMinor,
      taxMinor: line.taxMinor,
      taxRateBps: line.taxRateBps,
      ...(line.productId ? { shelf: line.shelf ?? 0 } : {}),
    })),
    payments: sale.payments,
    ...(sale.reason ? { reason: sale.reason } : {}),
    /** Products SALEANE's count at the location was short of, so someone should count them. */
    shelfShort: shelfShort(sale),
    tookPayment: false,
  }
}

type Answer = { status: number; body: unknown; recordId?: string }

/** One write, inside its transaction. Everything here is synchronous. */
function handle(c: Context, auth: KeyAuth, method: string, path: string[], body: unknown): Answer {
  const { org, row, scopes, only } = auth
  const s = org.state
  const now = new Date(c.now()).toISOString()
  const need = (scope: ApiScope) => {
    if (!scopes.includes(scope))
      refuse(
        403,
        'forbidden_scope',
        `This key cannot ${WRITE_WORDS[scope]}. Ask the studio owner to make a key that may, with ${scope}.`,
      )
  }
  const software = (consent?: z.infer<typeof emailNews>): SoftwareSource => {
    if (consent && Date.parse(consent.at) > c.now() + 5 * 60000)
      refuse(422, 'unprocessable', 'When the client agreed cannot be later than now.')
    return {
      keyId: row.id,
      name: row.name,
      ...(consent
        ? {
            consent: {
              at: new Date(consent.at).toISOString(),
              how: consent.how,
              ...(consent.wordingVersion ? { wordingVersion: consent.wordingVersion } : {}),
            },
          }
        : {}),
    }
  }
  const erased = new Set(erasureRequested(c, org.id))
  const notErased = (clientId: string) => {
    if (erased.has(clientId))
      refuse(
        409,
        'erasure_requested',
        'This client asked the studio to erase their details, so nothing more is added for them.',
      )
  }
  const sameClient = (name: string, email: string, except = '') =>
    s.clients.find(
      (x) =>
        x.id !== except &&
        x.email.toLowerCase() === email.trim().toLowerCase() &&
        x.name.toLowerCase() === name.trim().toLowerCase(),
    )
  const duplicate = (found: Client) => {
    throw new Refusal(
      409,
      'duplicate_client',
      'A client with this name and email is already in SALEANE. Use their clientId.',
      { clientId: found.id },
    )
  }
  /** Runs a command as the key, and saves it with the key as the one who made the change. */
  const run = (command: Command, source = software()) => {
    if (only) {
      const refusal = branchRefusal(s, only, command)
      if (refusal) refuse(403, 'wrong_location', refusal)
    }
    const result = dispatch(s, command, `${row.name} (access key)`, now, { software: source })
    if (!result.ok) return refuse(422, 'unprocessable', result.error)
    if (only) {
      const refusal = branchChangeRefusal(s, result.state, only)
      if (refusal) refuse(403, 'wrong_location', refusal)
    }
    const held = giftCardHoldProblem(c, org.id, result.state)
    if (held) refuse(409, 'conflict', held)
    if (result.state.revision !== s.revision)
      c.persist(org, result.state, `key:${row.id}`, command.type, result.recordId)
    return result
  }
  /** Stage 3's patch test rule, for software that cannot see the desk's warnings. */
  const patchTestCheck = (
    serviceId: string,
    clientId: string | undefined,
    date: string,
    at: number,
  ) => {
    if (!serviceNeedsPatchTest(s, serviceId)) return
    const name = s.services.find((x) => x.id === serviceId)!.name
    let start: string
    try {
      start = instantFor(s, date, at)
    } catch {
      return refuse(422, 'unprocessable', 'That time does not exist in the studio’s time zone.')
    }
    const standing = clientId ? patchTestStanding(s, clientId, start) : undefined
    if (standing?.state === 'reaction')
      refuse(
        422,
        'patch_test_needed',
        `${name} needs a patch test, and this client reacted to their last one. The studio decides what happens next.`,
      )
    if (patchTestSettings(s).stopOnline && standing?.state !== 'clear')
      refuse(
        422,
        'patch_test_needed',
        `${name} needs a clear patch test that covers this time. Book a patch test first, or ask the studio to book it.`,
      )
  }
  const visitAt = (visitId: string) => {
    const visit = s.appointments.find((a) => a.id === visitId)
    // A key for one location never learns of visits elsewhere.
    if (!visit || (only && visit.locationId !== only))
      return refuse(404, 'not_found', 'This visit was not found.')
    return visit
  }
  const openPlace = (locationId: string | undefined) => {
    if (only && locationId && locationId !== only)
      refuse(403, 'wrong_location', 'This key works at one location only.')
    if (locationId && !places(s).some((p) => p.id === locationId))
      refuse(422, 'unprocessable', 'Choose one of the studio’s open locations.')
    return locationId ?? only ?? undefined
  }

  const resource = path.join('/')
  // POST /api/v1/appointments: book a visit.
  if (resource === 'appointments' && method === 'POST') {
    need('appointments:write')
    const input = bookInput.parse(body)
    const locationId = openPlace(input.locationId)
    const service = s.services.find((x) => x.id === input.serviceId && !x.archived)
    if (!service) refuse(422, 'unprocessable', 'That treatment is not on the menu.')
    if (input.clientId) {
      if (!s.clients.some((x) => x.id === input.clientId))
        refuse(404, 'not_found', 'This client was not found.')
      notErased(input.clientId)
    } else {
      const found = sameClient(input.client!.name, input.client!.email)
      if (found) duplicate(found)
    }
    patchTestCheck(input.serviceId, input.clientId, input.date, input.start)
    const ask = {
      serviceId: input.serviceId,
      staffId: input.professionalId,
      date: input.date,
      startMinutes: input.start,
      ...(locationId ? { locationId } : {}),
    }
    let allocation: { staffId: string; resourceId: string }
    try {
      allocation = c.chooseStaff(c.withHolds(org), ask)!
    } catch (error) {
      if (error instanceof HttpError && error.statusCode === 409)
        return refuse(
          409,
          'time_taken',
          'That time is not free. Choose another time or professional.',
        )
      throw error
    }
    const news = input.client?.emailNews
    const result = run(
      {
        type: 'book',
        input: {
          ...ask,
          ...allocation,
          source: 'desk',
          ...(input.clientId
            ? { clientId: input.clientId }
            : {
                contact: {
                  name: input.client!.name,
                  email: input.client!.email,
                  phone: input.client!.phone,
                  marketingConsent: news?.agreed ?? false,
                },
              }),
        },
      },
      software(news),
    )
    const visit = result.state.appointments.find((a) => a.id === result.recordId)!
    return { status: 201, body: appointmentView(result.state, visit), recordId: visit.id }
  }
  // PATCH /api/v1/appointments/{id}: move a visit.
  if (path[0] === 'appointments' && path.length === 2 && method === 'PATCH') {
    need('appointments:write')
    const visit = visitAt(path[1])
    notErased(visit.clientId)
    const input = moveInput.parse(body)
    const locationId = input.locationId ? openPlace(input.locationId) : undefined
    const date = input.date ?? visit.date
    const startMinutes = input.start ?? visit.startMinutes
    const staffId = input.professionalId ?? visit.staffId
    if (visit.status !== 'confirmed')
      refuse(409, 'not_upcoming', 'Only a visit still to come can be moved.')
    patchTestCheck(visit.serviceId, visit.clientId, date, startMinutes)
    const resourceId = rescheduleResource(
      c.withHolds(org),
      visit.id,
      staffId,
      date,
      startMinutes,
      now,
      undefined,
      locationId,
    )
    if (!resourceId)
      refuse(409, 'time_taken', 'That time is not free. Choose another time or professional.')
    const result = run({
      type: 'reschedule',
      appointmentId: visit.id,
      date,
      startMinutes,
      staffId,
      resourceId: resourceId!,
      ...(locationId ? { locationId } : {}),
    })
    // Open guest links follow the visit, as they do when the desk moves it.
    if (result.state !== s) followGuestLinks(c, { ...org, state: result.state }, visit.id)
    const moved = result.state.appointments.find((a) => a.id === visit.id)!
    return { status: 200, body: appointmentView(result.state, moved), recordId: visit.id }
  }
  // POST /api/v1/appointments/{id}/cancel: cancel a visit, under the desk's rules.
  if (
    path[0] === 'appointments' &&
    path.length === 3 &&
    path[2] === 'cancel' &&
    method === 'POST'
  ) {
    need('appointments:write')
    const visit = visitAt(path[1])
    const input = cancelInput.parse(body ?? {})
    if (visit.status === 'cancelled')
      refuse(409, 'already_cancelled', 'This visit is already cancelled.')
    if (visit.status !== 'confirmed')
      refuse(409, 'not_upcoming', 'Only a visit still to come can be cancelled.')
    const result = run({
      type: 'cancel',
      appointmentId: visit.id,
      reason: input.reason ?? `Cancelled through ${row.name}`,
    })
    const cancelled = result.state.appointments.find((a) => a.id === visit.id)!
    return { status: 200, body: appointmentView(result.state, cancelled), recordId: visit.id }
  }
  // POST /api/v1/clients: add a client.
  if (resource === 'clients' && method === 'POST') {
    need('clients:write')
    const input = contact.parse(body)
    const found = sameClient(input.name, input.email)
    if (found) duplicate(found)
    const result = run(
      {
        type: 'client',
        contact: {
          name: input.name,
          email: input.email,
          phone: input.phone,
          marketingConsent: input.emailNews?.agreed ?? false,
        },
      },
      software(input.emailNews),
    )
    const client = result.state.clients.find((x) => x.id === result.recordId)!
    return { status: 201, body: clientView(client), recordId: client.id }
  }
  // PATCH /api/v1/clients/{id}: change a client's details, or what they said about email news.
  if (path[0] === 'clients' && path.length === 2 && method === 'PATCH') {
    need('clients:write')
    const client = s.clients.find((x) => x.id === path[1])
    if (!client) return refuse(404, 'not_found', 'This client was not found.')
    notErased(client.id)
    const input = clientChange.parse(body)
    const name = input.name ?? client.name
    const email = input.email ?? client.email
    const found = sameClient(name, email, client.id)
    if (found) duplicate(found)
    const result = run(
      {
        type: 'client-edit',
        clientId: client.id,
        contact: {
          name,
          email,
          phone: input.phone ?? client.phone,
          marketingConsent: input.emailNews ? input.emailNews.agreed : client.marketingConsent,
        },
        preferences: client.preferences,
      },
      software(input.emailNews),
    )
    const changed = result.state.clients.find((x) => x.id === client.id)!
    return { status: 200, body: clientView(changed), recordId: client.id }
  }
  // POST /api/v1/till-sales: a sale or a refund from another till.
  if (resource === 'till-sales' && method === 'POST') {
    need('sales:write')
    const { kind, ...rest } = tillKind.parse(body)
    const locationId = (rest as { locationId?: string }).locationId ?? only
    if (!locationId)
      refuse(400, 'invalid_request', 'Say which location the sale was at, with locationId.')
    openPlace(locationId!)
    const input = { ...rest, locationId }
    const command: Command =
      kind === 'sale'
        ? { type: 'other-till-sale', sale: otherTillSaleInputSchema.parse(input) }
        : { type: 'other-till-refund', refund: otherTillRefundInputSchema.parse(input) }
    const sent = command.type === 'other-till-sale' ? command.sale : command.refund
    const earlier = sentBefore(s, locationId!, kind, sent.receipt)
    if (earlier)
      throw new Refusal(
        409,
        'duplicate_receipt',
        `Receipt ${earlier.receipt} from this location is already in SALEANE, so it was not added again.`,
        { saleId: earlier.id },
      )
    const result = run(command)
    const sale = otherTillSales(result.state).find((x) => x.id === result.recordId)!
    return { status: 201, body: saleView(result.state, sale), recordId: sale.id }
  }
  if (
    (path[0] === 'appointments' &&
      (path.length <= 2 || (path.length === 3 && path[2] === 'cancel'))) ||
    (path[0] === 'clients' && path.length <= 2) ||
    resource === 'till-sales'
  )
    refuse(
      405,
      'method_not_allowed',
      'Use POST to add, PATCH to change, and POST to …/cancel to cancel. See docs/CONNECTIONS.md.',
    )
  return refuse(404, 'not_found', 'This endpoint was not found.')
}

type KeyChecks = {
  presented: (request: IncomingMessage) => string
  authenticate: (raw: string) => KeyAuth
}

/** Answers one write through an access key, with its own error bodies. */
export async function writeThroughKey(
  c: Context,
  request: IncomingMessage,
  response: ServerResponse,
  method: string,
  pathname: string,
  reply: (status: number, body: unknown) => void,
  checks: KeyChecks,
) {
  try {
    if (!/^application\/json(?:\s*;|$)/i.test(header(request, 'content-type') ?? ''))
      refuse(415, 'unsupported_media_type', 'Send JSON, with "Content-Type: application/json".')
    const raw = checks.presented(request)
    const key = idempotencyKey(request)
    const text = (await readBody(request, true)) as string
    let body: unknown
    try {
      body = JSON.parse(text || '{}')
    } catch {
      refuse(400, 'invalid_request', 'Send valid JSON.')
    }
    const path = pathname
      .split('/')
      .filter(Boolean)
      .slice(2)
      .map((part) => {
        try {
          return decodeURIComponent(part)
        } catch {
          return refuse(400, 'invalid_request', 'This address is not valid.')
        }
      })
    const hash = digest(`${method} ${path.join('/')}\n${canonical(body)}`)
    const answer = c.db.transaction(() => {
      const auth = checks.authenticate(raw)
      const time = c.now()
      c.db.run('DELETE FROM api_key_writes WHERE created_at<?', time - KEPT_MS)
      const kept = c.db.get<{ request_hash: string; status: number; response: string }>(
        'SELECT request_hash,status,response FROM api_key_writes WHERE key_id=? AND idempotency_key=?',
        auth.row.id,
        key,
      )
      if (kept) {
        if (kept.request_hash !== hash)
          refuse(
            422,
            'idempotency_key_reused',
            'This Idempotency-Key was already used for a different request. Use a new one for each change.',
          )
        return { status: kept.status, body: JSON.parse(kept.response) as unknown, replayed: true }
      }
      const done = handle(c, auth, method, path, body)
      c.db.run(
        'INSERT INTO api_key_writes(key_id,idempotency_key,organisation_id,request_hash,method,path,status,response,record_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
        auth.row.id,
        key,
        auth.org.id,
        hash,
        method,
        path.join('/'),
        done.status,
        JSON.stringify(done.body),
        done.recordId ?? null,
        time,
      )
      return { ...done, replayed: false }
    })
    if (answer.replayed) response.setHeader('Idempotent-Replayed', 'true')
    reply(answer.status, answer.body)
  } catch (error) {
    if (error instanceof z.ZodError) {
      reply(400, {
        error: 'Check the fields and try again.',
        code: 'invalid_request',
        fields: error.issues.slice(0, 20).map((issue) => ({
          field: issue.path.join('.'),
          problem: issue.message,
        })),
      })
      return
    }
    if (error instanceof HttpError) {
      reply(error.statusCode, {
        error: error.message,
        code: error.code ?? CODES[error.statusCode] ?? 'refused',
        ...(error instanceof Refusal ? error.extra : {}),
      })
      return
    }
    throw error
  }
}
