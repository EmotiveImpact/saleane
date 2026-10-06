import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import { LocalDatabase } from './database'
import { workspaceInput } from './workspace'
import { digest, equalToken, passwordHash, token } from './auth'
import { COOKIE, SESSION_MS, fail, header, sessionToken } from './http'
import { parseState } from '../src/domain/model'
import type { BusinessState } from '../src/domain/model'
import { availableResource } from '../src/domain/commands'
import { operations } from '../src/domain/operations'
import type { Role } from '../src/domain/operations'

export const emailSchema = z.email().trim().toLowerCase().max(254)
export const accountDetails = z.object({
  name: z.string().trim().min(2).max(100),
  email: emailSchema,
  password: z.string().min(12).max(128),
})
export const registration = accountDetails
  .extend({
    workspace: workspaceInput.optional(),
    invitation: z.string().min(32).max(100).optional(),
  })
  .strict()
export const holdInput = z
  .object({
    serviceId: z.string().min(1).max(100),
    staffId: z.string().min(1).max(100),
    date: z.iso.date(),
    startMinutes: z.number().int().min(0).max(1439),
  })
  .strict()
export const guestContact = z
  .object({
    name: z.string().trim().min(2).max(100),
    email: emailSchema,
    phone: z.string().trim().max(30),
    marketingConsent: z.boolean(),
  })
  .strict()
export const roleSchema = z.enum(['manager', 'reception', 'practitioner'])
export type Actor = { id: string; name: string; email: string; csrf: string }
export type Org = {
  id: string
  slug: string
  state: BusinessState
  role: Role
  staffId: string | null
}
export type OrgRow = {
  id: string
  slug: string
  state: string
  role: Role
  staff_id: string | null
}
export type Invitation = {
  token_hash: string
  organisation_id: string
  email: string
  role: Role
  staff_id: string | null
  expires_at: number
  used_at: number | null
}
export type HoldAllocation = z.infer<typeof holdInput> & {
  resourceId: string
  duration: number
  buffer: number
  price: number
  deposit: number
  resourceType: string
}
export type HoldRow = {
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

/** Shared request authority: database, clock, sessions, tenant lookup, holds and audit. */
export function createContext(options: ApiOptions) {
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
  return {
    options,
    origin,
    allowedOrigin,
    db,
    now,
    dummyHash,
    rateLimit,
    actorFor,
    signIn,
    memberships,
    orgFor,
    publicOrg,
    audit,
    insertWorkspace,
    persist,
    withHolds,
    chooseStaff,
    rejectPractitioner,
    invitationFor,
    join,
  }
}
export type Context = ReturnType<typeof createContext>

/** One parsed API request, handed to each route module in turn. */
export type Route = {
  request: IncomingMessage
  response: ServerResponse
  method: string
  url: URL
  path: string[]
  body: unknown
  reply: (status: number, body: unknown) => void
}
