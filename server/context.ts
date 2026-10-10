import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import { LocalDatabase } from './database'
import { workspaceInput } from './workspace'
import { digest, equalToken, passwordHash, token } from './auth'
import { COOKIE, HttpError, SESSION_MS, fail, header, sessionToken } from './http'
import { turnstileFromEnv } from './turnstile'
import type { Turnstile } from './turnstile'
import type { Providers } from './messaging/providers'
import { providersFromEnv } from './messaging/providers'
import type { PaymentProvider } from './payments/providers'
import { paymentProviderFromEnv } from './payments/providers'
import { aiFromEnv } from './ai'
import type { AiSupplier } from './ai'
import { parseState } from '../src/domain/model'
import type { BusinessState } from '../src/domain/model'
import type { ConnectionTransport } from './connections'
import { availableResource } from '../src/domain/commands'
import { staffLocationOn } from '../src/domain/locations'
import { operations } from '../src/domain/operations'
import { areaPlaces } from '../src/domain/area'
import { changeDetail, type ChangeDetail } from '../src/domain/changeRecord'
import { branchOpen } from '../src/domain/branch'
import {
  TWO_STEP_REQUIRED,
  twoStepForEveryone,
  twoStepHeldMessage,
} from '../src/domain/twoStepRule'
import type { Role, Tax } from '../src/domain/operations'
import { places } from '../src/domain/locations'
import { allowanceFor } from '../src/domain/pricing'
import type { BillingSummary } from '../src/domain/billing'
import type { Allowance } from '../lumane'

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
    /** V2: the location the guest chose. Absent means the main location. */
    locationId: z.string().min(1).max(150).optional(),
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
export const roleSchema = z.enum(['manager', 'reception', 'practitioner', 'regional', 'general'])
export type Actor = { id: string; name: string; email: string; csrf: string }
export type Org = {
  id: string
  slug: string
  state: BusinessState
  role: Role
  staffId: string | null
  /** V5: the region a regional manager looks after; null for every other role. */
  areaId: string | null
  /** V5: the location a general manager runs; null for every other role. */
  locationId: string | null
}
export type OrgRow = {
  id: string
  slug: string
  state: string
  role: Role
  staff_id: string | null
  area_id: string | null
  location_id: string | null
}
export type Invitation = {
  token_hash: string
  organisation_id: string
  email: string
  role: Role
  staff_id: string | null
  area_id: string | null
  location_id: string | null
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
  /** The tax setting shown when the time was held. Absent on holds made before it was kept. */
  tax?: Tax | null
  /**
   * Stage 5: held at a quiet-time price from the guest's invitation. `price` is then the lower
   * price, and the usual price it was below is kept so the booking checks it has not changed.
   * The link is kept only as its hash.
   */
  offer?: { messageId: string; tokenHash: string; usualPriceMinor: number }
}
export type HoldRow = {
  id: string
  input: string
  expires_at: number
  appointment_id: string | null
  fingerprint: string | null
}

/**
 * Public hold limits. A hold lapses after HOLD_MS; one visitor (network address) keeps at most
 * HOLDS_PER_VISITOR, newest replacing oldest; and a studio carries at most
 * max(STUDIO_HOLDS_MIN, STUDIO_HOLDS_PER_PROFESSIONAL x active professionals) at once.
 */
export const HOLD_LIMITS = {
  HOLD_MS: 5 * 60000,
  HOLDS_PER_VISITOR: 2,
  STUDIO_HOLDS_MIN: 8,
  STUDIO_HOLDS_PER_PROFESSIONAL: 3,
  HOLDS_PER_MINUTE: 6,
  HOLDS_PER_HOUR: 30,
}

export type ApiOptions = {
  origin: string
  databasePath?: string
  database?: LocalDatabase
  now?: () => number
  allowRegistration?: boolean
  /** Bot check for public holds. Omitted reads TURNSTILE_* from the environment; null disables. */
  turnstile?: Turnstile | null
  /** Message providers. Omitted reads SALEANE_EMAIL_PROVIDER and friends; unset is test mode. */
  providers?: Providers
  /** Runs the message outbox on this interval. Omitted leaves it to be run by hand (tests). */
  outboxIntervalMs?: number
  /**
   * NEXT-12: how long after starting SALEANE tries again the guests' messages a restart left
   * unanswered and the allowance then refused. Omitted is once the stopped requests' holds have
   * run out.
   */
  missedAgainMs?: number
  /** Card payments. Omitted reads SALEANE_PAYMENTS_PROVIDER; unset is test mode, charging nothing. */
  paymentProvider?: PaymentProvider
  /** NEXT-02: SALEANE's own card account for studios' plans. Omitted reads SALEANE_BILLING_PROVIDER. */
  billingProvider?: PaymentProvider
  /** NEXT-06: where help requests are emailed; unset reads SALEANE_SUPPORT_EMAIL, null keeps them. */
  supportEmail?: string | null
  /** V5: how connected software is reached. Omitted uses fetch with private addresses refused. */
  connectionTransport?: ConnectionTransport
  /** V4: Book with Google's partner credentials; read from the environment when left out. */
  googleBooking?: import('./googleBooking').GoogleBookingOptions
  /** Stage 5: booking through ChatGPT or Claude; read from SALEANE_AI_BOOKING when left out. */
  aiBooking?: import('./aiBooking').AiBookingOptions
  /** V4: messages to the studio's Instagram, Facebook and WhatsApp accounts. */
  social?: import('./messaging/meta').SocialOptions
  /** Stage 2: how receipts reach a printer. Omitted uses the real network printer and test printer. */
  printers?: {
    network?: import('./till/printers').PrinterTransport
    test?: import('./till/printers').PrinterTransport
  }
  /** NEXT-12: the AI that answers. Omitted reads SALEANE_AI_PROVIDER; unset is test mode. */
  ai?: AiSupplier
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
  const turnstile = options.turnstile === undefined ? turnstileFromEnv() : options.turnstile
  const messaging = options.providers ?? providersFromEnv(process.env, allowedOrigin)
  const paymentProvider =
    options.paymentProvider ?? paymentProviderFromEnv(process.env, allowedOrigin)
  const ai = options.ai ?? aiFromEnv(process.env)
  const rates = new Map<string, { count: number; expires: number }>()
  const address = (request: IncomingMessage) => request.socket?.remoteAddress ?? 'local'
  // Holds last minutes, so a per-process salt keeps stored visitor keys from revealing addresses.
  const visitorSalt = token()
  const visitorFor = (request: IncomingMessage) => digest(`${visitorSalt}:${address(request)}`)

  const rateLimit = (request: IncomingMessage, bucket: string, limit: number, window: number) => {
    const time = now()
    if (rates.size > 5000)
      for (const [key, entry] of rates) if (entry.expires <= time) rates.delete(key)
    if (rates.size > 10000) fail(503, 'SALEANE is busy. Try again shortly.')
    const key = `${address(request)}:${bucket}`
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
      fail(403, 'Refresh the page before saving.')
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
  /** NEXT-04: whether this account has two-step sign-in on. */
  const twoStepOn = (accountId: string) =>
    !!db.get('SELECT id FROM accounts WHERE id=? AND totp_enabled_at IS NOT NULL', accountId)
  const memberships = (actor: Actor) =>
    db
      .all<{
        id: string
        slug: string
        role: Role
        staffId: string | null
        name: string
        region: string
        mode: string
        locked: number
        twoStep: number | null
      }>(
        `SELECT o.id,o.slug,m.role,m.staff_id AS staffId,json_extract(o.state,'$.organisation.name') AS name,json_extract(o.state,'$.organisation.region') AS region,json_extract(o.state,'$.operations.mode') AS mode,
           EXISTS(SELECT 1 FROM studio_plans p WHERE p.organisation_id=o.id AND p.locked_at IS NOT NULL) AS locked,
           json_extract(o.state,'$.operations.twoStep.forEveryone') AS twoStep
         FROM memberships m JOIN organisations o ON o.id=m.organisation_id WHERE m.account_id=? ORDER BY o.created_at,o.id`,
        actor.id,
      )
      // NEXT-02: a studio locked for an unpaid bill says so before anyone tries to open it.
      // Stage 6: so does a studio that asks everyone to use two-step sign-in.
      .map(({ locked, twoStep, ...row }) => ({
        ...row,
        ...(locked ? { locked: true } : {}),
        ...(twoStep === 1 ? { twoStepRequired: true } : {}),
      }))
  /**
   * A signed-in member's studio. A regional manager is refused everywhere except the routes that
   * pass `area: true` and then serve only their area's view (fail closed: new routes stay shut).
   * A general manager whose location has closed is refused everywhere, before anything runs.
   * Stage 6: in a studio that asks everyone to use two-step sign-in, someone who has not set it up
   * is refused everywhere too, with a code their page uses to take them to set it up. Only joining
   * from an invitation passes `joining`, so the invitation is used up and they are then held.
   */
  const orgFor = (
    orgId: string,
    actor: Actor,
    opts: { area?: boolean; joining?: boolean } = {},
  ): Org => {
    const row = db.get<OrgRow>(
      'SELECT o.id,o.slug,o.state,m.role,m.staff_id,m.area_id,m.location_id FROM organisations o JOIN memberships m ON m.organisation_id=o.id WHERE o.id=? AND m.account_id=?',
      orgId,
      actor.id,
    )
    if (!row) fail(404, 'That studio was not found.')
    const raw = JSON.parse(row!.state) as BusinessState
    const state = parseState(raw, raw.organisation.region)
    // First, so every refusal a held person meets takes them to set two-step sign-in up.
    if (!opts.joining && twoStepForEveryone(state) && !twoStepOn(actor.id))
      throw new HttpError(403, twoStepHeldMessage(state.organisation.name), TWO_STEP_REQUIRED)
    // A practitioner reads only through their projection, which needs a linked professional.
    if (row!.role === 'practitioner' && !row!.staff_id)
      fail(403, 'Your access is not linked to a professional. Ask the owner to update it.')
    if (row!.role === 'regional' && !opts.area)
      fail(403, 'Your access covers your area’s view only.')
    if (row!.role === 'general' && (!row!.location_id || !branchOpen(state, row!.location_id)))
      fail(403, 'Your location has closed. Ask the owner to update your access.')
    return {
      id: row!.id,
      slug: row!.slug,
      role: row!.role,
      staffId: row!.staff_id,
      areaId: row!.area_id,
      locationId: row!.location_id,
      state,
    }
  }
  /** A studio read by the server itself (outbox, payment confirmations), with owner authority. */
  const systemOrg = (id: string): Org | null => {
    const row = db.get<{ id: string; slug: string; state: string }>(
      'SELECT id,slug,state FROM organisations WHERE id=?',
      id,
    )
    if (!row) return null
    const raw = JSON.parse(row.state) as BusinessState
    return {
      id: row.id,
      slug: row.slug,
      state: parseState(raw, raw.organisation.region),
      role: 'owner',
      staffId: null,
      areaId: null,
      locationId: null,
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
    if (!operations(state).bookingEnabled || plans.locked(row!.id))
      fail(404, 'Online booking is not available for this studio.')
    return {
      id: row!.id,
      slug: row!.slug,
      state,
      role: 'owner',
      staffId: null,
      areaId: null,
      locationId: null,
    }
  }
  const audit = (
    org: Org,
    actorId: string | null,
    action: string,
    recordId: string,
    revision = org.state.revision,
    detail?: ChangeDetail,
  ) =>
    db.run(
      'INSERT INTO audit_events(id,organisation_id,actor_id,action,record_id,revision,occurred_at,detail) VALUES(?,?,?,?,?,?,?,?)',
      randomUUID(),
      org.id,
      actorId,
      action,
      recordId,
      revision,
      now(),
      detail ? JSON.stringify(detail) : null,
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
      areaId: null,
      locationId: null,
    }
    audit(org, accountId, 'workspace.created', org.id)
    plans.begin(org)
    return org
  }
  /**
   * Told about every saved change, inside the same transaction, with the record before and after
   * and who saved it (null for a guest or the server itself).
   */
  const persistListeners: ((
    org: Org,
    before: BusinessState,
    after: BusinessState,
    change: { actorId: string | null; action: string; recordId: string },
  ) => void)[] = []
  const onPersist = (listener: (typeof persistListeners)[number]) => persistListeners.push(listener)
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
    if (Number(result.changes) !== 1)
      fail(409, 'Someone else saved a change just now. Reload to see it, then try again.')
    // NEXT-05: which details of the record changed, for the owner's change record.
    audit(
      org,
      actorId,
      action,
      recordId,
      parsed.revision,
      changeDetail(org.state, parsed, action, recordId),
    )
    for (const listener of persistListeners)
      listener(org, org.state, parsed, { actorId, action, recordId })
  }
  /**
   * NEXT-02: each studio's plan, as the billing module answers once it is set up: what the studio
   * record carries about it, and the studio's AI allowance. Until then, no plan and the included
   * allowance for each open location.
   */
  const plans: {
    /** A new studio's plan begins as it is made, so its free trial starts that day. */
    begin: (org: Org) => void
    summary: (org: Org) => BillingSummary | null
    allowance: (org: Org) => Allowance
    /** A locked studio takes no online bookings and answers no access key. */
    locked: (orgId: string) => boolean
    /** A read-only studio takes no membership payments from its clients' cards. */
    readOnly: (orgId: string) => boolean
  } = {
    begin: () => {},
    summary: () => null,
    locked: () => false,
    readOnly: () => false,
    allowance: (org) => allowanceFor({ locations: places(org.state).length, plus: false }),
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
        locationId:
          allocation.locationId ?? staffLocationOn(state, allocation.staffId, allocation.date),
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
        input.locationId,
      )
      if (resourceId) return { staffId: professional.id, resourceId }
    }
    fail(409, 'That time was just taken. Choose another time or professional.')
  }
  /** A practitioner seat links one active professional, held by at most one person. */
  const linkableProfessional = (org: Org, staffId: string | undefined, exceptAccount = '') => {
    if (!staffId) fail(422, 'Choose the professional this person works as.')
    if (!org.state.staff.some((person) => person.id === staffId && !person.archived))
      fail(422, 'Choose an active professional from this studio.')
    const taken = db.get(
      "SELECT account_id FROM memberships WHERE organisation_id=? AND role='practitioner' AND staff_id=? AND account_id<>?",
      org.id,
      staffId!,
      exceptAccount,
    )
    if (taken) fail(409, 'Another team member already works as this professional.')
    return staffId!
  }
  /** V5: a regional manager's region must exist and hold at least one open location. */
  const linkableArea = (org: Org, areaId: string | undefined) => {
    if (!areaId) fail(422, 'Choose the region this person looks after.')
    if (!areaPlaces(org.state, areaId!).ids.size)
      fail(422, 'Choose a region with at least one open location.')
    return areaId!
  }
  /** V5: a general manager's location must be open. */
  const linkableLocation = (org: Org, locationId: string | undefined) => {
    if (!locationId) fail(422, 'Choose the location this person runs.')
    if (!branchOpen(org.state, locationId!)) fail(422, 'Choose an open location.')
    return locationId!
  }
  const invitationFor = (raw: string, email: string) => {
    const invite = db.get<Invitation>(
      'SELECT * FROM invitations WHERE token_hash=? AND expires_at>? AND used_at IS NULL',
      digest(raw),
      now(),
    )
    if (!invite || invite.email !== email)
      fail(400, 'This invitation does not match your email or has expired.')
    return invite!
  }
  const join = (invite: Invitation, accountId: string) => {
    db.run(
      'INSERT OR IGNORE INTO memberships(organisation_id,account_id,role,staff_id,area_id,location_id) VALUES(?,?,?,?,?,?)',
      invite.organisation_id,
      accountId,
      invite.role,
      invite.staff_id,
      invite.area_id,
      invite.location_id,
    )
    db.run('UPDATE invitations SET used_at=? WHERE token_hash=?', now(), invite.token_hash)
    const actor = db.get<Actor>('SELECT id,name,email FROM accounts WHERE id=?', accountId)!
    const org = orgFor(invite.organisation_id, actor, { area: true, joining: true })
    // The region may have been removed or emptied since the invitation.
    if (invite.role === 'regional') linkableArea(org, invite.area_id ?? undefined)
    // The location may have closed since the invitation.
    if (invite.role === 'general') linkableLocation(org, invite.location_id ?? undefined)
    // The professional may have been archived or linked to someone else since the invitation.
    if (invite.role === 'practitioner')
      linkableProfessional(org, invite.staff_id ?? undefined, accountId)
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
    address,
    visitorFor,
    turnstile,
    messaging,
    paymentProvider,
    ai,
    actorFor,
    signIn,
    twoStepOn,
    memberships,
    orgFor,
    systemOrg,
    publicOrg,
    audit,
    insertWorkspace,
    persist,
    onPersist,
    plans,
    withHolds,
    chooseStaff,
    linkableProfessional,
    linkableArea,
    linkableLocation,
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
