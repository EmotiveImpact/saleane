import { randomBytes, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { digest, equalToken } from './auth'
import { fail, header } from './http'
import type { Context, Route } from './context'
import { businessDate, operations } from '../src/domain/operations'
import { addDays } from '../src/domain/format'
import { offeredAt, places, serviceAt } from '../src/domain/locations'
import { dailySummary } from '../src/domain/accounts'
import type { BusinessState } from '../src/domain/model'
import { API_VERSION } from './connections'

/**
 * V5: read-only access for other software and partners. The owner makes a key for one studio,
 * chooses what it may read, and can revoke it at any time. A partner's key can also be kept to one
 * location and stop on a chosen day. Keys are stored only as a hash; the key itself is shown once.
 * Nothing can be changed through a key.
 */

export const apiScopes = [
  'appointments:read',
  'clients:read',
  'services:read',
  'takings:read',
] as const
/** What a key for one location may read: its own visits, and the menu and team. */
const LOCATION_SCOPES: readonly ApiScope[] = ['appointments:read', 'services:read']
/**
 * The last day a key may run to: the day before the same date next year, so it runs for at most
 * one year (a key made on 29 February may run to 28 February).
 */
function lastEndDay(today: string) {
  const year = Number(today.slice(0, 4)) + 1
  const [month, day] = [Number(today.slice(5, 7)), Number(today.slice(8, 10))]
  // Date.UTC rolls 29 February into 1 March in a year without it.
  const next = new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10)
  return addDays(next, -1)
}
export type ApiScope = (typeof apiScopes)[number]
const KEY_LIMIT = 10
const KEY_PER_MINUTE = 120
/** The longest date range one request may ask for. */
const MAX_DAYS = 31
const PAGE = 200

type KeyRow = {
  id: string
  organisation_id: string
  name: string
  prefix: string
  key_hash: string
  scopes: string
  created_by: string
  created_at: number
  last_used_at: number | null
  revoked_at: number | null
  location_id: string | null
  ends_on: string | null
}

const keyInput = z
  .object({
    name: z.string().trim().min(2).max(60),
    scopes: z.array(z.enum(apiScopes)).min(1).max(apiScopes.length),
    /** Only this location's visits, for a partner that works with one branch. */
    locationId: z.string().min(1).max(100).optional(),
    /** The last day the key works, in the studio's own days. */
    endsOn: z.iso.date().optional(),
  })
  .strict()
const empty = z.object({}).strict()
const range = z.object({
  from: z.iso.date(),
  to: z.iso.date(),
})
const page = z.object({
  limit: z.coerce.number().int().min(1).max(PAGE).default(100),
  offset: z.coerce.number().int().min(0).default(0),
})

const keyView = (row: KeyRow) => ({
  id: row.id,
  name: row.name,
  prefix: row.prefix,
  scopes: JSON.parse(row.scopes) as ApiScope[],
  createdBy: row.created_by,
  createdAt: new Date(row.created_at).toISOString(),
  lastUsedAt: row.last_used_at ? new Date(row.last_used_at).toISOString() : null,
  locationId: row.location_id,
  endsOn: row.ends_on,
})

const hhmm = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
const days = (from: string, to: string) => (Date.parse(to) - Date.parse(from)) / 86400000

function appointmentView(s: BusinessState, a: BusinessState['appointments'][number]) {
  return {
    id: a.id,
    clientId: a.clientId,
    status: a.status,
    date: a.date,
    start: hhmm(a.startMinutes),
    durationMinutes: a.bookedDurationMinutes,
    service: a.bookedServiceName ?? s.services.find((x) => x.id === a.serviceId)?.name ?? null,
    serviceId: a.serviceId,
    professional: s.staff.find((p) => p.id === a.staffId)?.name ?? null,
    professionalId: a.staffId,
    source: a.source,
  }
}

function dates(query: Record<string, string>) {
  const { from, to } = range.parse(query)
  // Both dates are included, so 31 days means `to` is at most 30 days after `from`.
  if (days(from, to) < 0 || days(from, to) >= MAX_DAYS)
    fail(400, `Ask for up to ${MAX_DAYS} days at a time, with "from" on or before "to".`)
  return { from, to }
}

export function partnerApi() {
  // Counted per key wherever its requests come from, on top of the server's own per-address limit.
  const uses = new Map<string, { count: number; expires: number }>()
  const limit = (c: Context, prefix: string) => {
    const time = c.now()
    if (uses.size > 5000) for (const [k, v] of uses) if (v.expires <= time) uses.delete(k)
    const existing = uses.get(prefix)
    const entry =
      existing && existing.expires > time ? existing : { count: 0, expires: time + 60000 }
    entry.count += 1
    uses.set(prefix, entry)
    if (entry.count > KEY_PER_MINUTE)
      fail(429, 'Too many requests for this key. Wait before trying again.')
  }
  /** Owner-managed keys, under the workspace like every other studio setting. */
  async function manage(c: Context, route: Route): Promise<boolean> {
    const { request, method, path, body, reply } = route
    if (path[1] !== 'workspaces' || path[3] !== 'api-keys') return false
    const actor = c.actorFor(request, method !== 'GET')
    const org = c.orgFor(path[2], actor)
    // A key reads studio records from outside SALEANE, so only the owner decides.
    if (org.role !== 'owner') fail(403, 'Only the owner can make access keys.')
    const sample = operations(org.state).mode === 'sandbox'
    if (sample && method !== 'GET')
      fail(
        409,
        'A sample studio never shares anything outside SALEANE. Make access keys in a studio of your own.',
      )
    const list = () => ({
      keys: c.db
        .all<KeyRow>(
          'SELECT * FROM api_keys WHERE organisation_id=? AND revoked_at IS NULL ORDER BY created_at',
          org.id,
        )
        .map(keyView),
      apiVersion: API_VERSION,
      sample,
    })
    const time = c.now()
    if (path.length === 4 && method === 'GET') {
      reply(200, list())
      return true
    }
    if (path.length === 4 && method === 'POST') {
      const input = keyInput.parse(body)
      const today = businessDate(org.state, new Date(time).toISOString())
      if (input.locationId) {
        if (!places(org.state).some((p) => p.id === input.locationId))
          fail(422, 'Choose one of your open locations.')
        if (input.scopes.some((scope) => !LOCATION_SCOPES.includes(scope)))
          fail(
            422,
            'A key for one location can read its visits and the treatments and team only. Clients and takings belong to the whole studio.',
          )
      }
      if (input.endsOn && (input.endsOn < today || input.endsOn > lastEndDay(today)))
        fail(422, 'Choose an end date from today to a year ahead.')
      const prefix = randomBytes(4).toString('hex')
      const key = `sal_${prefix}_${randomBytes(24).toString('base64url')}`
      const id = randomUUID()
      c.db.transaction(() => {
        const count = c.db.get<{ n: number }>(
          'SELECT COUNT(*) AS n FROM api_keys WHERE organisation_id=? AND revoked_at IS NULL',
          org.id,
        )!.n
        if (count >= KEY_LIMIT)
          fail(409, `Keep up to ${KEY_LIMIT} access keys. Revoke one you no longer use.`)
        c.db.run(
          'INSERT INTO api_keys(id,organisation_id,name,prefix,key_hash,scopes,created_by,created_at,location_id,ends_on) VALUES(?,?,?,?,?,?,?,?,?,?)',
          id,
          org.id,
          input.name,
          prefix,
          digest(key),
          JSON.stringify([...new Set(input.scopes)]),
          actor.name,
          time,
          input.locationId ?? null,
          input.endsOn ?? null,
        )
        c.audit(org, actor.id, 'api-key.created', id)
      })
      // The key is shown once, here, and never again.
      reply(201, { ...list(), key, created: id })
      return true
    }
    if (path.length === 6 && path[5] === 'revoke' && method === 'POST') {
      empty.parse(body ?? {})
      const result = c.db.run(
        'UPDATE api_keys SET revoked_at=? WHERE id=? AND organisation_id=? AND revoked_at IS NULL',
        time,
        path[4],
        org.id,
      )
      if (Number(result.changes) !== 1) fail(404, 'This access key was not found.')
      c.audit(org, actor.id, 'api-key.revoked', path[4])
      reply(200, list())
      return true
    }
    fail(404, 'This endpoint was not found.')
  }

  /** The read-only API itself: `Authorization: Bearer sal_…`, GET only. */
  async function read(c: Context, route: Route): Promise<boolean> {
    const { request, method, path, url, reply } = route
    if (path[1] !== 'v1') return false
    if (method !== 'GET') fail(405, 'This API only reads. Use GET.')
    const raw = /^Bearer\s+(sal_[a-f0-9]{8}_[A-Za-z0-9_-]{32})$/.exec(
      header(request, 'authorization') ?? '',
    )?.[1]
    if (!raw) fail(401, 'Send an access key as "Authorization: Bearer sal_…".')
    const prefix = raw!.slice(4, 12)
    limit(c, prefix)
    const row = c.db.get<KeyRow>(
      'SELECT * FROM api_keys WHERE prefix=? AND revoked_at IS NULL',
      prefix,
    )
    if (!row || !equalToken(digest(raw!), row.key_hash))
      fail(401, 'This access key is not valid or was revoked.')
    const org = c.systemOrg(row!.organisation_id)
    if (!org || operations(org.state).mode === 'sandbox')
      fail(401, 'This access key is not valid or was revoked.')
    if (c.plans.locked(org!.id)) fail(402, 'This studio is locked until its SALEANE bill is paid.')
    const s = org!.state
    // A key past its last day, or for a location since closed, reads nothing more.
    if (row!.ends_on && businessDate(s, new Date(c.now()).toISOString()) > row!.ends_on)
      fail(401, 'This access key has reached its end date.')
    const only = row!.location_id
    if (only && !places(s).some((p) => p.id === only))
      fail(401, 'This access key was for a location that has closed.')
    const scopes = JSON.parse(row!.scopes) as ApiScope[]
    const need = (scope: ApiScope) => {
      if (!scopes.includes(scope)) fail(403, `This key cannot read that. It needs ${scope}.`)
    }
    c.db.run('UPDATE api_keys SET last_used_at=? WHERE id=?', c.now(), row!.id)
    const query = Object.fromEntries(url.searchParams)
    const resource = path.slice(2).join('/')
    if (resource === 'studio') {
      reply(200, {
        apiVersion: API_VERSION,
        studio: {
          id: s.organisation.id,
          name: s.organisation.name,
          timeZone: s.organisation.timeZone,
          currency: s.organisation.currency,
        },
        scopes,
        locationId: only,
        endsOn: row!.ends_on,
      })
      return true
    }
    if (resource === 'appointments') {
      need('appointments:read')
      const { from, to } = dates(query)
      const { limit, offset } = page.parse(query)
      const all = s.appointments
        .filter((a) => a.date >= from && a.date <= to && (!only || a.locationId === only))
        .sort((a, b) => a.date.localeCompare(b.date) || a.startMinutes - b.startMinutes)
      reply(200, {
        apiVersion: API_VERSION,
        data: all.slice(offset, offset + limit).map((a) => appointmentView(s, a)),
        total: all.length,
      })
      return true
    }
    if (resource === 'takings') {
      need('takings:read')
      const { from, to } = dates(query)
      // Totals by day only: no receipts, no names. Money given back is shown, never netted away.
      reply(200, {
        apiVersion: API_VERSION,
        currency: s.organisation.currency,
        data: dailySummary(s, from, to),
      })
      return true
    }
    if (resource === 'clients') {
      need('clients:read')
      const { limit, offset } = page.parse(query)
      const all = [...s.clients].sort(
        (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
      )
      reply(200, {
        apiVersion: API_VERSION,
        data: all.slice(offset, offset + limit).map((client) => ({
          id: client.id,
          name: client.name,
          email: client.email,
          phone: client.phone,
          emailNews: client.marketingConsent,
          createdAt: client.createdAt,
        })),
        total: all.length,
      })
      return true
    }
    if (resource === 'services') {
      need('services:read')
      const { limit: size, offset } = page.parse(query)
      // A key for one location sees that location's menu, at its prices.
      const active = s.services
        .filter((x) => !x.archived && (!only || offeredAt(x, only)))
        .map((x) => (only ? serviceAt(x, only) : x))
      reply(200, {
        apiVersion: API_VERSION,
        total: active.length,
        data: active.slice(offset, offset + size).map((x) => ({
          id: x.id,
          name: x.name,
          category: x.category,
          durationMinutes: x.durationMinutes,
          priceMinor: x.priceMinor,
        })),
        team: s.staff
          .filter((p) => !p.archived)
          .map((p) => ({ id: p.id, name: p.name, role: p.role, serviceIds: p.serviceIds })),
      })
      return true
    }
    fail(404, 'This endpoint was not found.')
  }

  return { manage, read }
}
