import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable, Writable } from 'node:stream'
import { z } from 'zod'
import { LocalDatabase } from './database'
import { checkPassword, digest, equalToken, passwordHash, token } from './auth'
import { createWorkspace, workspaceInput } from './workspace'
import { parseState } from '../src/domain/model'
import type { BusinessState } from '../src/domain/model'
import {
  availableResource,
  commandSchema,
  dispatch,
  rescheduleResource,
  slots,
} from '../src/domain/commands'
import type { Command } from '../src/domain/commands'
import { businessDate, can, operations, permissionFor } from '../src/domain/operations'
import type { Role } from '../src/domain/operations'

const COOKIE = 'saleane_session'
const SESSION_MS = 12 * 60 * 60 * 1000
const BODY_LIMIT = 64 * 1024
const emailSchema = z.email().trim().toLowerCase().max(254)
const accountDetails = z.object({
  name: z.string().trim().min(2).max(100),
  email: emailSchema,
  password: z.string().min(12).max(128),
})
const registration = accountDetails
  .extend({
    workspace: workspaceInput.optional(),
    invitation: z.string().min(32).max(100).optional(),
  })
  .strict()
const holdInput = z
  .object({
    serviceId: z.string().min(1).max(100),
    staffId: z.string().min(1).max(100),
    date: z.iso.date(),
    startMinutes: z.number().int().min(0).max(1439),
  })
  .strict()
const guestContact = z
  .object({
    name: z.string().trim().min(2).max(100),
    email: emailSchema,
    phone: z.string().trim().max(30),
    marketingConsent: z.boolean(),
  })
  .strict()
const roleSchema = z.enum(['manager', 'reception', 'practitioner'])

class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message)
  }
}
function fail(status: number, message: string): never {
  throw new HttpError(status, message)
}
type Actor = { id: string; name: string; email: string; csrf: string }
type Org = { id: string; slug: string; state: BusinessState; role: Role; staffId: string | null }
type OrgRow = { id: string; slug: string; state: string; role: Role; staff_id: string | null }
type Invitation = {
  token_hash: string
  organisation_id: string
  email: string
  role: Role
  staff_id: string | null
  expires_at: number
  used_at: number | null
}
type HoldAllocation = z.infer<typeof holdInput> & {
  resourceId: string
  duration: number
  buffer: number
  price: number
  deposit: number
  resourceType: string
}
type HoldRow = {
  id: string
  input: string
  expires_at: number
  appointment_id: string | null
  fingerprint: string | null
}

export type ApiOptions = {
  origin: string
  databasePath?: string
  database?: LocalDatabase
  now?: () => number
  allowRegistration?: boolean
}
export type InjectOptions = {
  method?: string
  url: string
  headers?: Record<string, string>
  payload?: unknown
  remoteAddress?: string
  rawPayload?: string
}
export type InjectResponse = {
  statusCode: number
  headers: Record<string, string | string[]>
  body: string
  json: <T = Record<string, unknown>>() => T
}
export type ApiHandler = ((
  request: IncomingMessage,
  response: ServerResponse,
  next?: () => void,
) => Promise<void>) & {
  database: LocalDatabase
  close: () => void
  inject: (request: InjectOptions) => Promise<InjectResponse>
}

function header(request: IncomingMessage, name: string) {
  const value = request.headers[name]
  return typeof value === 'string' ? value : undefined
}
function sessionToken(request: IncomingMessage): string | undefined {
  return header(request, 'cookie')
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1)
}
async function readBody(request: IncomingMessage): Promise<unknown> {
  const length = Number(header(request, 'content-length'))
  if (Number.isFinite(length) && length > BODY_LIMIT) {
    request.resume()
    fail(413, 'This request is too large.')
  }
  if (header(request, 'content-encoding') && header(request, 'content-encoding') !== 'identity')
    fail(415, 'Encoded request bodies are not supported.')
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    let done = false
    const finish = (error?: Error, value?: unknown) => {
      if (done) return
      done = true
      clearTimeout(timer)
      request.removeListener('data', onData)
      request.removeListener('end', onEnd)
      request.removeListener('error', onError)
      request.removeListener('aborted', onAborted)
      if (error) {
        // Draining a rejected or aborted stream can emit a subsequent error.
        request.once('error', () => {})
        request.resume()
        reject(error)
      } else resolve(value)
    }
    const onData = (chunk: Buffer | string) => {
      const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += data.length
      if (size > BODY_LIMIT) finish(new HttpError(413, 'This request is too large.'))
      else chunks.push(data)
    }
    const onEnd = () => {
      try {
        finish(undefined, JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        finish(new HttpError(400, 'Use a valid JSON request.'))
      }
    }
    const onError = () => finish(new HttpError(400, 'The request could not be read.'))
    const onAborted = () => finish(new HttpError(400, 'The request was interrupted.'))
    const timer = setTimeout(() => finish(new HttpError(408, 'The request took too long.')), 10000)
    timer.unref()
    request.on('data', onData).on('end', onEnd).on('error', onError).on('aborted', onAborted)
  })
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(',')}}`
  return JSON.stringify(value) ?? 'null'
}

export function createApiHandler(options: ApiOptions): ApiHandler {
  const origin = new URL(options.origin)
  if (
    !['http:', 'https:'].includes(origin.protocol) ||
    origin.username ||
    origin.password ||
    origin.pathname !== '/' ||
    origin.search ||
    origin.hash
  )
    throw new Error('APP_ORIGIN must be a complete HTTP origin.')
  const allowedOrigin = origin.origin
  const db = options.database ?? new LocalDatabase(options.databasePath)
  const now = options.now ?? Date.now
  const dummyHash = passwordHash(token())
  const rates = new Map<string, { count: number; expires: number }>()

  const rateLimit = (request: IncomingMessage, bucket: string, limit: number, window: number) => {
    const time = now()
    if (rates.size > 5000)
      for (const [key, entry] of rates) if (entry.expires <= time) rates.delete(key)
    if (rates.size > 10000) fail(503, 'The local service is busy. Try again shortly.')
    const key = `${request.socket?.remoteAddress ?? 'local'}:${bucket}`
    const existing = rates.get(key)
    const entry =
      existing && existing.expires > time ? existing : { count: 0, expires: time + window }
    entry.count += 1
    rates.set(key, entry)
    if (entry.count > limit) fail(429, 'Too many requests. Wait before trying again.')
  }
  const actorFor = (request: IncomingMessage, write = false): Actor => {
    const raw = sessionToken(request)
    if (!raw || !/^[A-Za-z0-9_-]{43}$/.test(raw)) fail(401, 'Sign in to continue.')
    const actor = db.get<Actor>(
      'SELECT a.id,a.name,a.email,s.csrf FROM sessions s JOIN accounts a ON a.id=s.account_id WHERE s.token_hash=? AND s.expires_at>?',
      digest(raw!),
      now(),
    )
    if (!actor) fail(401, 'Your session has ended. Sign in again.')
    if (write && !equalToken(header(request, 'x-csrf-token'), actor!.csrf))
      fail(403, 'Refresh the workspace before saving.')
    return actor!
  }
  const signIn = (response: ServerResponse, accountId: string) => {
    const raw = token(),
      csrf = token(),
      time = now()
    db.run('DELETE FROM sessions WHERE expires_at<=?', time)
    const existing = db.all<{ token_hash: string }>(
      'SELECT token_hash FROM sessions WHERE account_id=? ORDER BY created_at DESC',
      accountId,
    )
    for (const old of existing.slice(4))
      db.run('DELETE FROM sessions WHERE token_hash=?', old.token_hash)
    db.run(
      'INSERT INTO sessions(token_hash,account_id,csrf,created_at,expires_at) VALUES(?,?,?,?,?)',
      digest(raw),
      accountId,
      csrf,
      time,
      time + SESSION_MS,
    )
    response.setHeader(
      'Set-Cookie',
      `${COOKIE}=${raw}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_MS / 1000}${origin.protocol === 'https:' ? '; Secure' : ''}`,
    )
    return csrf
  }
  const memberships = (actor: Actor) =>
    db.all<{
      id: string
      slug: string
      role: Role
      staffId: string | null
      name: string
      region: string
      mode: string
    }>(
      `SELECT o.id,o.slug,m.role,m.staff_id AS staffId,json_extract(o.state,'$.organisation.name') AS name,json_extract(o.state,'$.organisation.region') AS region,json_extract(o.state,'$.operations.mode') AS mode FROM memberships m JOIN organisations o ON o.id=m.organisation_id WHERE m.account_id=? ORDER BY o.created_at,o.id`,
      actor.id,
    )
  const orgFor = (orgId: string, actor: Actor): Org => {
    const row = db.get<OrgRow>(
      'SELECT o.id,o.slug,o.state,m.role,m.staff_id FROM organisations o JOIN memberships m ON m.organisation_id=o.id WHERE o.id=? AND m.account_id=?',
      orgId,
      actor.id,
    )
    if (!row) fail(404, 'Workspace was not found.')
    // Practitioner provisioning is gated until a tested assigned-client DTO exists.
    if (row!.role === 'practitioner')
      fail(403, 'Practitioner access is not enabled in this local candidate.')
    const raw = JSON.parse(row!.state) as BusinessState
    return {
      id: row!.id,
      slug: row!.slug,
      role: row!.role,
      staffId: row!.staff_id,
      state: parseState(raw, raw.organisation.region),
    }
  }
  const publicOrg = (slug: string): Org => {
    const row = db.get<{ id: string; slug: string; state: string }>(
      'SELECT id,slug,state FROM organisations WHERE slug=?',
      slug,
    )
    if (!row) fail(404, 'Online booking is not available for this studio.')
    const raw = JSON.parse(row!.state) as BusinessState
    const state = parseState(raw, raw.organisation.region)
    if (!operations(state).bookingEnabled)
      fail(404, 'Online booking is not available for this studio.')
    return { id: row!.id, slug: row!.slug, state, role: 'owner', staffId: null }
  }
  const audit = (
    org: Org,
    actorId: string | null,
    action: string,
    recordId: string,
    revision = org.state.revision,
  ) =>
    db.run(
      'INSERT INTO audit_events(id,organisation_id,actor_id,action,record_id,revision,occurred_at) VALUES(?,?,?,?,?,?,?)',
      randomUUID(),
      org.id,
      actorId,
      action,
      recordId,
      revision,
      now(),
    )
  const insertWorkspace = (state: BusinessState, accountId: string) => {
    const slug = `${
      state.organisation.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 40) || 'studio'
    }-${randomUUID().slice(0, 8)}`
    db.run(
      'INSERT INTO organisations(id,slug,state,revision,created_at) VALUES(?,?,?,?,?)',
      state.organisation.id,
      slug,
      JSON.stringify(state),
      state.revision,
      now(),
    )
    db.run(
      "INSERT INTO memberships(organisation_id,account_id,role,staff_id) VALUES(?,?,'owner',?)",
      state.organisation.id,
      accountId,
      state.staff[0]?.id ?? null,
    )
    const org = {
      id: state.organisation.id,
      slug,
      state,
      role: 'owner' as const,
      staffId: state.staff[0]?.id ?? null,
    }
    audit(org, accountId, 'workspace.created', org.id)
    return org
  }
  const persist = (
    org: Org,
    state: BusinessState,
    actorId: string | null,
    action: string,
    recordId: string,
  ) => {
    const parsed = parseState(state, org.state.organisation.region)
    const result = db.run(
      'UPDATE organisations SET state=?,revision=? WHERE id=? AND revision=?',
      JSON.stringify(parsed),
      parsed.revision,
      org.id,
      org.state.revision,
    )
    if (Number(result.changes) !== 1) fail(409, 'This workspace changed. Reload before saving.')
    audit(org, actorId, action, recordId, parsed.revision)
  }
  const withHolds = (org: Org, excludeHash = '') => {
    const state = structuredClone(org.state)
    for (const hold of db.all<HoldRow>(
      'SELECT id,input,expires_at,appointment_id,fingerprint FROM booking_holds WHERE organisation_id=? AND expires_at>? AND appointment_id IS NULL AND token_hash<>?',
      org.id,
      now(),
      excludeHash,
    )) {
      const allocation = JSON.parse(hold.input) as HoldAllocation
      state.appointments.push({
        id: hold.id,
        organisationId: org.id,
        locationId: state.organisation.locationId,
        clientId: 'ephemeral-hold',
        serviceId: allocation.serviceId,
        staffId: allocation.staffId,
        resourceId: allocation.resourceId,
        date: allocation.date,
        startMinutes: allocation.startMinutes,
        status: 'confirmed',
        source: 'online',
        createdAt: new Date(now()).toISOString(),
        bookedPriceMinor: 0,
        bookedDepositMinor: 0,
        bookedDurationMinutes: allocation.duration,
        bookedBufferMinutes: allocation.buffer,
      })
    }
    return state
  }
  const chooseStaff = (
    state: BusinessState,
    input: z.infer<typeof holdInput>,
    preferredResourceId?: string,
  ) => {
    const eligible =
      input.staffId === 'any'
        ? state.staff.filter((person) => person.serviceIds.includes(input.serviceId))
        : state.staff.filter((person) => person.id === input.staffId)
    for (const professional of eligible) {
      const resourceId = availableResource(
        state,
        input.serviceId,
        professional.id,
        input.date,
        input.startMinutes,
        new Date(now()).toISOString(),
        preferredResourceId,
      )
      if (resourceId) return { staffId: professional.id, resourceId }
    }
    fail(409, 'That time was just taken. Choose another time or professional.')
  }
  const rejectPractitioner = (role: string) => {
    if (role === 'practitioner')
      fail(422, 'Practitioner access awaits an assigned-client view and is not enabled yet.')
  }
  const invitationFor = (raw: string, email: string) => {
    const invite = db.get<Invitation>(
      'SELECT * FROM invitations WHERE token_hash=? AND expires_at>? AND used_at IS NULL',
      digest(raw),
      now(),
    )
    if (!invite || invite.email !== email)
      fail(400, 'This invitation does not match your email or has expired.')
    rejectPractitioner(invite!.role)
    return invite!
  }
  const join = (invite: Invitation, accountId: string) => {
    db.run(
      'INSERT OR IGNORE INTO memberships(organisation_id,account_id,role,staff_id) VALUES(?,?,?,?)',
      invite.organisation_id,
      accountId,
      invite.role,
      invite.staff_id,
    )
    db.run('UPDATE invitations SET used_at=? WHERE token_hash=?', now(), invite.token_hash)
    const actor = db.get<Actor>('SELECT id,name,email FROM accounts WHERE id=?', accountId)!
    const org = orgFor(invite.organisation_id, actor)
    audit(org, accountId, 'invitation.accepted', accountId)
    return org.id
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
      if (method === 'GET' && url.pathname === '/api/health') {
        reply(200, {
          ok: true,
          database: 'sqlite',
          localOnly: true,
          services: { email: false, payments: false },
        })
        return
      }
      if (method === 'GET' && url.pathname === '/api/session') {
        const actor = actorFor(request)
        reply(200, {
          user: { id: actor.id, name: actor.name, email: actor.email },
          csrf: actor.csrf,
          workspaces: memberships(actor),
          localOnly: true,
          services: { email: false, payments: false },
        })
        return
      }
      if (method === 'POST' && url.pathname === '/api/auth/register') {
        rateLimit(request, 'auth', 10, 5 * 60000)
        if (options.allowRegistration === false) fail(403, 'New account registration is disabled.')
        const data = registration.parse(body)
        if (!!data.workspace === !!data.invitation)
          fail(400, 'Choose a new workspace or use an invitation.')
        const accountId = randomUUID(),
          hash = await passwordHash(data.password)
        const orgId = db.transaction(() => {
          if (db.get('SELECT id FROM accounts WHERE email=?', data.email))
            fail(409, 'An account could not be created with these details. Try signing in.')
          const invite = data.invitation ? invitationFor(data.invitation, data.email) : undefined
          db.run(
            'INSERT INTO accounts(id,email,name,password_hash,created_at) VALUES(?,?,?,?,?)',
            accountId,
            data.email,
            data.name,
            hash,
            now(),
          )
          return invite
            ? join(invite, accountId)
            : insertWorkspace(createWorkspace(data.workspace!), accountId).id
        })
        reply(201, { orgId, csrf: signIn(response, accountId) })
        return
      }
      if (method === 'POST' && url.pathname === '/api/auth/login') {
        rateLimit(request, 'auth', 10, 5 * 60000)
        const data = z
          .object({ email: emailSchema, password: z.string().min(1).max(128) })
          .strict()
          .parse(body)
        const account = db.get<{ id: string; password_hash: string }>(
          'SELECT id,password_hash FROM accounts WHERE email=?',
          data.email,
        )
        const valid = await checkPassword(
          data.password,
          account?.password_hash ?? (await dummyHash),
        )
        if (!valid || !account) fail(401, 'Email or password is incorrect.')
        reply(200, { csrf: signIn(response, account!.id) })
        return
      }
      if (method === 'POST' && url.pathname === '/api/auth/logout') {
        actorFor(request, true)
        db.run('DELETE FROM sessions WHERE token_hash=?', digest(sessionToken(request)!))
        response.setHeader(
          'Set-Cookie',
          `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${origin.protocol === 'https:' ? '; Secure' : ''}`,
        )
        reply(200, { ok: true })
        return
      }
      if (method === 'POST' && url.pathname === '/api/auth/password') {
        const actor = actorFor(request, true)
        rateLimit(request, 'auth', 10, 5 * 60000)
        const data = z
          .object({ current: z.string().min(1).max(128), password: z.string().min(12).max(128) })
          .strict()
          .parse(body)
        const account = db.get<{ password_hash: string }>(
          'SELECT password_hash FROM accounts WHERE id=?',
          actor.id,
        )!
        if (!(await checkPassword(data.current, account.password_hash)))
          fail(403, 'The current password is incorrect.')
        const hash = await passwordHash(data.password)
        db.transaction(() => {
          db.run('UPDATE accounts SET password_hash=? WHERE id=?', hash, actor.id)
          db.run('DELETE FROM sessions WHERE account_id=?', actor.id)
        })
        reply(200, { csrf: signIn(response, actor.id) })
        return
      }
      if (method === 'POST' && url.pathname === '/api/workspaces') {
        const actor = actorFor(request, true)
        const data = z.object({ workspace: workspaceInput }).strict().parse(body)
        const org = db.transaction(() => insertWorkspace(createWorkspace(data.workspace), actor.id))
        reply(201, { orgId: org.id, slug: org.slug })
        return
      }
      if (method === 'POST' && url.pathname === '/api/invitations/accept') {
        const actor = actorFor(request, true),
          data = z
            .object({ invitation: z.string().min(32).max(100) })
            .strict()
            .parse(body)
        const orgId = db.transaction(() =>
          join(invitationFor(data.invitation, actor.email), actor.id),
        )
        reply(200, { orgId })
        return
      }
      if (path[1] === 'workspaces' && path[2]) {
        const actor = actorFor(request, method !== 'GET')
        const orgId = path[2]
        if (path.length === 3 && method === 'GET') {
          const org = orgFor(orgId, actor)
          reply(200, {
            ...org,
            today: businessDate(org.state, new Date(now()).toISOString()),
            mode: operations(org.state).mode,
            deliveryConfigured: false,
            paymentsConfigured: false,
          })
          return
        }
        if (path[3] === 'commands' && path.length === 4 && method === 'POST') {
          const data = z
            .object({ revision: z.number().int().nonnegative(), command: commandSchema })
            .strict()
            .parse(body)
          const key = header(request, 'idempotency-key')
          if (!key || !/^[A-Za-z0-9._:-]{8,100}$/.test(key))
            fail(400, 'Use an idempotency key between 8 and 100 safe characters.')
          const fingerprint = digest(canonical(data.command))
          const result = db.transaction(() => {
            const org = orgFor(orgId, actor)
            if (!can(org.role, permissionFor(data.command)))
              fail(403, 'Your role cannot make this change.')
            const receipt = db.get<{ fingerprint: string; record_id: string }>(
              'SELECT fingerprint,record_id FROM command_receipts WHERE organisation_id=? AND account_id=? AND key=?',
              org.id,
              actor.id,
              key!,
            )
            if (receipt) {
              if (receipt.fingerprint !== fingerprint)
                fail(409, 'This request key was already used for a different change.')
              return { ok: true, state: org.state, recordId: receipt.record_id, replayed: true }
            }
            if (org.state.revision !== data.revision)
              fail(409, 'This workspace changed. Reload before saving.')
            let command: Command = data.command
            if (command.type === 'book') {
              const allocation = chooseStaff(
                withHolds(org),
                command.input,
                command.input.resourceId,
              )
              command = { ...command, input: { ...command.input, ...allocation } }
            } else if (command.type === 'reschedule') {
              const resourceId = rescheduleResource(
                withHolds(org),
                command.appointmentId,
                command.staffId,
                command.date,
                command.startMinutes,
                new Date(now()).toISOString(),
                command.resourceId,
              )
              if (!resourceId)
                fail(409, 'This time is reserved or unavailable. Choose another time.')
              command = { ...command, resourceId }
            }
            const result = dispatch(org.state, command, actor.name, new Date(now()).toISOString())
            if (!result.ok) fail(422, result.error)
            if (result.state.revision !== org.state.revision)
              persist(org, result.state, actor.id, command.type, result.recordId)
            db.run(
              'INSERT INTO command_receipts(organisation_id,account_id,key,fingerprint,record_id,revision,created_at) VALUES(?,?,?,?,?,?,?)',
              org.id,
              actor.id,
              key!,
              fingerprint,
              result.recordId,
              result.state.revision,
              now(),
            )
            return result
          })
          reply(200, result)
          return
        }
        if (path[3] === 'team' && path.length === 4 && method === 'GET') {
          const org = orgFor(orgId, actor)
          if (org.role !== 'owner') fail(403, 'Only the owner can manage access.')
          reply(200, {
            members: db.all(
              'SELECT a.id,a.name,a.email,m.role,m.staff_id AS staffId FROM memberships m JOIN accounts a ON a.id=m.account_id WHERE m.organisation_id=? ORDER BY a.name',
              org.id,
            ),
            invitations: db.all(
              'SELECT email,role,staff_id AS staffId,expires_at AS expiresAt FROM invitations WHERE organisation_id=? AND used_at IS NULL AND expires_at>?',
              org.id,
              now(),
            ),
            practitionerAccessEnabled: false,
          })
          return
        }
        if (path[3] === 'invitations' && path.length === 4 && method === 'POST') {
          const data = z.object({ email: emailSchema, role: roleSchema }).strict().parse(body)
          rejectPractitioner(data.role)
          const raw = token(),
            expiresAt = now() + 48 * 60 * 60000
          db.transaction(() => {
            const org = orgFor(orgId, actor)
            if (org.role !== 'owner') fail(403, 'Only the owner can invite staff.')
            const member = db.get(
              'SELECT a.id FROM memberships m JOIN accounts a ON a.id=m.account_id WHERE m.organisation_id=? AND a.email=?',
              org.id,
              data.email,
            )
            if (member) fail(409, 'This person already belongs to the workspace.')
            db.run(
              'UPDATE invitations SET used_at=? WHERE organisation_id=? AND email=? AND used_at IS NULL',
              now(),
              org.id,
              data.email,
            )
            db.run(
              'INSERT INTO invitations(token_hash,organisation_id,email,role,created_at,expires_at) VALUES(?,?,?,?,?,?)',
              digest(raw),
              org.id,
              data.email,
              data.role,
              now(),
              expiresAt,
            )
            audit(org, actor.id, 'invitation.created', digest(data.email))
          })
          reply(201, {
            url: `${allowedOrigin}/join?invitation=${raw}`,
            invitation: raw,
            expiresAt: new Date(expiresAt).toISOString(),
            delivery: 'not_sent',
          })
          return
        }
        if (path[3] === 'membership' && path.length === 4 && method === 'POST') {
          const data = z
            .object({
              accountId: z.string().min(1).max(100),
              role: z.enum(['manager', 'reception', 'practitioner', 'remove']),
            })
            .strict()
            .parse(body)
          rejectPractitioner(data.role)
          db.transaction(() => {
            const org = orgFor(orgId, actor)
            if (org.role !== 'owner') fail(403, 'Only the owner can change access.')
            const member = db.get<{ role: Role }>(
              'SELECT role FROM memberships WHERE organisation_id=? AND account_id=?',
              org.id,
              data.accountId,
            )
            if (!member || member.role === 'owner')
              fail(422, 'Owner access cannot be changed here.')
            if (data.role === 'remove')
              db.run(
                'DELETE FROM memberships WHERE organisation_id=? AND account_id=?',
                org.id,
                data.accountId,
              )
            else
              db.run(
                'UPDATE memberships SET role=?,staff_id=NULL WHERE organisation_id=? AND account_id=?',
                data.role,
                org.id,
                data.accountId,
              )
            audit(org, actor.id, 'membership.changed', data.accountId)
          })
          reply(200, { ok: true })
          return
        }
        if (path[3] === 'audit' && path.length === 4 && method === 'GET') {
          const org = orgFor(orgId, actor)
          if (!['owner', 'manager'].includes(org.role)) fail(403, 'A manager role is required.')
          reply(200, {
            events: db.all(
              "SELECT e.id,e.action,e.record_id AS recordId,e.revision,e.occurred_at AS occurredAt,COALESCE(a.name,CASE WHEN e.action='workspace.restored' THEN 'Local recovery' ELSE 'Guest booking' END) AS actor FROM audit_events e LEFT JOIN accounts a ON a.id=e.actor_id WHERE e.organisation_id=? ORDER BY e.occurred_at DESC,e.rowid DESC LIMIT 200",
              org.id,
            ),
          })
          return
        }
        if (path[3] === 'messages' && path[4] === 'send' && method === 'POST') {
          orgFor(orgId, actor)
          fail(503, 'Message delivery is not configured. Drafts and queues remain local.')
        }
      }
      if (path[1] === 'public' && path[2]) {
        const slug = path[2]
        if (path.length === 3 && method === 'GET') {
          const org = publicOrg(slug),
            state = org.state,
            sample = operations(state).mode === 'sandbox'
          reply(200, {
            organisation: state.organisation,
            services: state.services
              .filter((service) => !service.archived)
              .map((service) => ({ ...service, depositMinor: sample ? service.depositMinor : 0 })),
            staff: state.staff
              .filter((person) => !person.archived)
              .map((person) => ({
                id: person.id,
                name: person.name,
                role: person.role,
                serviceIds: person.serviceIds,
                tone: person.tone,
              })),
            today: businessDate(state, new Date(now()).toISOString()),
            sample,
            depositPolicy: sample ? 'simulated' : 'pay_at_studio',
            paymentCollectionConfigured: false,
          })
          return
        }
        if (path[3] === 'availability' && path.length === 4 && method === 'GET') {
          const query = z
            .object({
              serviceId: z.string().min(1).max(100),
              staffId: z.string().min(1).max(100),
              date: z.iso.date(),
            })
            .parse(Object.fromEntries(url.searchParams))
          const org = publicOrg(slug)
          reply(200, {
            times: slots(
              withHolds(org),
              query.serviceId,
              query.staffId,
              query.date,
              new Date(now()).toISOString(),
            ),
          })
          return
        }
        if (
          path[3] === 'holds' &&
          path[4] === 'release' &&
          path.length === 5 &&
          method === 'POST'
        ) {
          rateLimit(request, 'public-write', 20, 5 * 60000)
          const data = z
            .object({ hold: z.string().min(32).max(100) })
            .strict()
            .parse(body)
          const released = db.transaction(() => {
            const org = publicOrg(slug)
            return (
              db.run(
                'DELETE FROM booking_holds WHERE token_hash=? AND organisation_id=? AND appointment_id IS NULL',
                digest(data.hold),
                org.id,
              ).changes > 0
            )
          })
          reply(200, { released })
          return
        }
        if (path[3] === 'holds' && path.length === 4 && method === 'POST') {
          rateLimit(request, 'public-write', 20, 5 * 60000)
          const data = holdInput.parse(body)
          const raw = token(),
            expires = now() + 5 * 60000
          db.transaction(() => {
            const org = publicOrg(slug),
              blocked = withHolds(org),
              allocation = chooseStaff(blocked, data)
            const service = org.state.services.find((service) => service.id === data.serviceId)!
            const input: HoldAllocation = {
              ...data,
              ...allocation,
              duration: service.durationMinutes,
              buffer: service.bufferMinutes,
              price: service.priceMinor,
              deposit: service.depositMinor,
              resourceType: service.resourceType,
            }
            db.run(
              'DELETE FROM booking_holds WHERE expires_at<=? AND appointment_id IS NULL',
              now(),
            )
            db.run(
              'INSERT INTO booking_holds(token_hash,id,organisation_id,input,expires_at) VALUES(?,?,?,?,?)',
              digest(raw),
              randomUUID(),
              org.id,
              JSON.stringify(input),
              expires,
            )
          })
          reply(201, { hold: raw, expiresAt: new Date(expires).toISOString() })
          return
        }
        if (path[3] === 'book' && path.length === 4 && method === 'POST') {
          rateLimit(request, 'public-write', 20, 5 * 60000)
          const data = z
            .object({
              hold: z.string().min(32).max(100),
              contact: guestContact,
              policy: z.literal(true),
            })
            .strict()
            .parse(body)
          const fingerprint = digest(canonical(data.contact))
          const result = db.transaction(() => {
            const org = publicOrg(slug)
            const hash = digest(data.hold)
            const hold = db.get<HoldRow>(
              'SELECT id,input,expires_at,appointment_id,fingerprint FROM booking_holds WHERE token_hash=? AND organisation_id=?',
              hash,
              org.id,
            )
            if (!hold) fail(409, 'This reservation expired. Choose a time again.')
            if (hold!.appointment_id) {
              if (hold!.fingerprint !== fingerprint)
                fail(409, 'This reservation has already been used.')
              return { appointmentId: hold!.appointment_id, replayed: true }
            }
            if (hold!.expires_at <= now())
              fail(409, 'This reservation expired. Choose a time again.')
            const allocation = JSON.parse(hold!.input) as HoldAllocation
            const service = org.state.services.find(
              (service) => service.id === allocation.serviceId,
            )
            if (
              !service ||
              service.durationMinutes !== allocation.duration ||
              service.bufferMinutes !== allocation.buffer ||
              service.priceMinor !== allocation.price ||
              service.depositMinor !== allocation.deposit ||
              service.resourceType !== allocation.resourceType
            )
              fail(
                409,
                'This service changed during the reservation. Review it and choose a time again.',
              )
            chooseStaff(withHolds(org, hash), allocation, allocation.resourceId)
            const command = commandSchema.parse({
              type: 'book',
              input: {
                serviceId: allocation.serviceId,
                staffId: allocation.staffId,
                resourceId: allocation.resourceId,
                date: allocation.date,
                startMinutes: allocation.startMinutes,
                contact: data.contact,
                source: 'online',
              },
            })
            const result = dispatch(
              org.state,
              command,
              'Guest booking',
              new Date(now()).toISOString(),
            )
            if (!result.ok) fail(422, result.error)
            persist(org, result.state, null, 'public.book', result.recordId)
            db.run(
              'UPDATE booking_holds SET appointment_id=?,fingerprint=? WHERE token_hash=?',
              result.recordId,
              fingerprint,
              hash,
            )
            return {
              appointmentId: result.recordId,
              sample: operations(org.state).mode === 'sandbox',
              depositPolicy:
                operations(org.state).mode === 'sandbox' ? 'simulated' : 'pay_at_studio',
              confirmation: 'local_only',
            }
          })
          reply(200, result)
          return
        }
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
  handler.close = () => db.close()
  handler.inject = (input) => inject(handler, allowedOrigin, input)
  return handler
}

async function inject(
  handler: ApiHandler,
  origin: string,
  input: InjectOptions,
): Promise<InjectResponse> {
  const method = input.method ?? 'GET'
  const payload =
    input.rawPayload ?? (input.payload === undefined ? '' : JSON.stringify(input.payload))
  const request = Readable.from(payload ? [Buffer.from(payload)] : []) as unknown as IncomingMessage
  Object.assign(request, {
    method,
    url: input.url,
    headers: {
      host: new URL(origin).host,
      ...(method === 'GET' ? {} : { origin, 'content-type': 'application/json' }),
      ...Object.fromEntries(
        Object.entries(input.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value]),
      ),
    },
    socket: { remoteAddress: input.remoteAddress ?? '127.0.0.1' },
  })
  const chunks: Buffer[] = [],
    headers: Record<string, string | string[]> = {}
  const response = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.from(chunk))
      callback()
    },
  }) as unknown as ServerResponse
  response.statusCode = 200
  response.setHeader = ((name: string, value: string | string[] | number) => {
    headers[name.toLowerCase()] = typeof value === 'number' ? String(value) : value
    return response
  }) as ServerResponse['setHeader']
  const finished = new Promise<void>((resolve) => response.on('finish', resolve))
  await handler(request, response)
  await finished
  const body = Buffer.concat(chunks).toString('utf8')
  return { statusCode: response.statusCode, headers, body, json: <T>() => JSON.parse(body) as T }
}
