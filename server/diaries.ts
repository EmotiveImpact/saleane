import { randomBytes, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { digest, equalToken } from './auth'
import { fail } from './http'
import type { Context, Org, Route } from './context'
import type { BusinessState } from '../src/domain/model'
import type { Role } from '../src/domain/operations'
import { businessDate, operations } from '../src/domain/operations'
import { addDays } from '../src/domain/format'
import { places } from '../src/domain/locations'
import {
  DIARY_DAYS_AFTER,
  DIARY_DAYS_BEFORE,
  DIARY_PRACTITIONER_DAYS_AFTER,
  diaryFile,
  diaryWho,
} from '../src/domain/diary'
import type { DiaryDetail, DiaryScope } from '../src/domain/diary'

/**
 * NEXT-10: team diaries in Google or Apple. Anyone with a diary of their own makes a private link
 * to it; owners and managers can also make one for another professional, a location or the whole
 * studio, and a general manager for their own location. The link is shown once and stored only as
 * a hash. Each time a calendar app reads it, the person who made it must still be allowed to see
 * what it shows, so taking their access away stops it too. Nothing can be changed through it.
 */
const LINK_LIMIT = 40
const READS_PER_MINUTE = 30
/** The link's private part: "sd_", eight hex characters to find it, then 32 secret characters. */
const TOKEN = /^(sd_([a-f0-9]{8})_[A-Za-z0-9_-]{32})\.ics$/

type LinkRow = {
  id: string
  organisation_id: string
  account_id: string
  kind: DiaryScope['kind']
  staff_id: string | null
  location_id: string | null
  detail: DiaryDetail
  prefix: string
  token_hash: string
  created_at: number
  last_read_at: number | null
  stopped_at: number | null
  stopped_by: string | null
  maker_name?: string
}
type Maker = { role: Role; staffId: string | null; locationId: string | null }

const linkInput = z
  .object({
    scope: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('person'), staffId: z.string().min(1).max(100) }).strict(),
      z.object({ kind: z.literal('location'), locationId: z.string().min(1).max(100) }).strict(),
      z.object({ kind: z.literal('studio') }).strict(),
    ]),
    detail: z.enum(['names', 'treatment']),
  })
  .strict()
const empty = z.object({}).strict()

const scopeOf = (row: LinkRow): DiaryScope =>
  row.kind === 'person'
    ? { kind: 'person', staffId: row.staff_id! }
    : row.kind === 'location'
      ? { kind: 'location', locationId: row.location_id! }
      : { kind: 'studio' }

const leads = (role: Role) => role === 'owner' || role === 'manager'

/** Why this person may not have this diary, or null when they may. */
export function diaryRefusal(s: BusinessState, maker: Maker, scope: DiaryScope): string | null {
  if (maker.role === 'regional') return 'A regional manager has no diary of visits.'
  if (scope.kind === 'person') {
    const person = s.staff.find((p) => p.id === scope.staffId)
    if (!person || person.archived) return 'That person is no longer on the team.'
    if (maker.staffId === scope.staffId || leads(maker.role)) return null
    return 'You can make a diary link for your own visits only.'
  }
  if (scope.kind === 'location') {
    if (!places(s).some((p) => p.id === scope.locationId)) return 'That location has closed.'
    if (leads(maker.role) || (maker.role === 'general' && maker.locationId === scope.locationId))
      return null
    return 'Only owners and managers can make a diary link for a location.'
  }
  return leads(maker.role)
    ? null
    : 'Only owners and managers can make a diary for the whole studio.'
}

/** How far the diary reaches: a practitioner sees what their own page shows, others half a year. */
function windowFor(s: BusinessState, maker: Maker, time: number) {
  const today = businessDate(s, new Date(time).toISOString())
  const after = maker.role === 'practitioner' ? DIARY_PRACTITIONER_DAYS_AFTER : DIARY_DAYS_AFTER
  return { from: addDays(today, -DIARY_DAYS_BEFORE), to: addDays(today, after) }
}

export function diaryRoutes() {
  // Counted per link wherever its requests come from, on top of the server's own per-address limit.
  const reads = new Map<string, { count: number; expires: number }>()
  const limit = (c: Context, prefix: string) => {
    const time = c.now()
    if (reads.size > 5000) for (const [k, v] of reads) if (v.expires <= time) reads.delete(k)
    const existing = reads.get(prefix)
    const entry =
      existing && existing.expires > time ? existing : { count: 0, expires: time + 60000 }
    entry.count += 1
    reads.set(prefix, entry)
    if (entry.count > READS_PER_MINUTE)
      fail(429, 'This diary was asked for too often. Wait before trying again.')
  }
  const makerOf = (c: Context, row: LinkRow): Maker | null => {
    const member = c.db.get<{ role: Role; staff_id: string | null; location_id: string | null }>(
      'SELECT role,staff_id,location_id FROM memberships WHERE organisation_id=? AND account_id=?',
      row.organisation_id,
      row.account_id,
    )
    return member
      ? { role: member.role, staffId: member.staff_id, locationId: member.location_id }
      : null
  }

  /** The people who may manage links: owners and managers see all, everyone else their own. */
  async function manage(c: Context, route: Route): Promise<boolean> {
    const { request, method, path, body, reply } = route
    if (path[1] !== 'workspaces' || path[3] !== 'diary-links') return false
    const actor = c.actorFor(request, method !== 'GET')
    const org = c.orgFor(path[2], actor)
    const s = org.state
    const maker: Maker = { role: org.role, staffId: org.staffId, locationId: org.locationId }
    const sample = operations(s).mode === 'sandbox'
    if (sample && method !== 'GET')
      fail(
        409,
        'A sample studio never shares anything outside SALEANE. Make diary links in a studio of your own.',
      )
    const time = c.now()
    const rows = () =>
      c.db.all<LinkRow>(
        `SELECT l.*,a.name AS maker_name FROM diary_links l JOIN accounts a ON a.id=l.account_id
         WHERE l.organisation_id=? AND l.stopped_at IS NULL ${leads(org.role) ? '' : 'AND l.account_id=?'}
         ORDER BY l.created_at`,
        ...(leads(org.role) ? [org.id] : [org.id, actor.id]),
      )
    const view = (row: LinkRow) => {
      const scope = scopeOf(row)
      const by = makerOf(c, row)
      const reason = by
        ? diaryRefusal(s, by, scope)
        : 'The person who made it no longer has access.'
      return {
        id: row.id,
        who: diaryWho(s, scope),
        kind: row.kind,
        detail: row.detail,
        madeBy: row.maker_name ?? 'Someone',
        mine: row.account_id === actor.id,
        createdAt: new Date(row.created_at).toISOString(),
        lastReadAt: row.last_read_at ? new Date(row.last_read_at).toISOString() : null,
        // A link that cannot work any more still shows, so it can be stopped on purpose.
        ...(reason ? { stoppedWorking: reason } : {}),
      }
    }
    const own = s.staff.find((p) => p.id === org.staffId && !p.archived)
    const list = () => ({
      links: rows().map(view),
      sample,
      locale: s.organisation.locale,
      timeZone: s.organisation.timeZone,
      daysAhead: maker.role === 'practitioner' ? DIARY_PRACTITIONER_DAYS_AFTER : DIARY_DAYS_AFTER,
      choices: {
        own: own ? { staffId: own.id, name: own.name } : null,
        people: leads(org.role)
          ? s.staff
              .filter((p) => !p.archived && p.id !== own?.id)
              .map((p) => ({ id: p.id, name: p.name }))
          : [],
        locations:
          leads(org.role) && places(s).length > 1
            ? places(s).map((p) => ({ id: p.id, name: p.name }))
            : org.role === 'general' && org.locationId
              ? places(s)
                  .filter((p) => p.id === org.locationId)
                  .map((p) => ({ id: p.id, name: p.name }))
              : [],
        studio: leads(org.role),
      },
    })
    if (path.length === 4 && method === 'GET') {
      reply(200, list())
      return true
    }
    if (path.length === 4 && method === 'POST') {
      const input = linkInput.parse(body)
      const refusal = diaryRefusal(s, maker, input.scope)
      if (refusal) fail(403, refusal)
      const prefix = randomBytes(4).toString('hex')
      const token = `sd_${prefix}_${randomBytes(24).toString('base64url')}`
      const id = randomUUID()
      c.db.transaction(() => {
        const count = c.db.get<{ n: number }>(
          'SELECT COUNT(*) AS n FROM diary_links WHERE organisation_id=? AND stopped_at IS NULL',
          org.id,
        )!.n
        if (count >= LINK_LIMIT)
          fail(409, `Keep up to ${LINK_LIMIT} diary links. Stop one nobody uses.`)
        c.db.run(
          'INSERT INTO diary_links(id,organisation_id,account_id,kind,staff_id,location_id,detail,prefix,token_hash,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
          id,
          org.id,
          actor.id,
          input.scope.kind,
          input.scope.kind === 'person' ? input.scope.staffId : null,
          input.scope.kind === 'location' ? input.scope.locationId : null,
          input.detail,
          prefix,
          digest(token),
          time,
        )
        c.audit(org, actor.id, 'diary-link.made', id)
      })
      // The link is shown once, here, and never again.
      reply(201, { ...list(), link: `${c.allowedOrigin}/api/diary/${token}.ics`, created: id })
      return true
    }
    if (path.length === 6 && path[5] === 'stop' && method === 'POST') {
      empty.parse(body ?? {})
      const row = c.db.get<LinkRow>(
        'SELECT * FROM diary_links WHERE id=? AND organisation_id=? AND stopped_at IS NULL',
        path[4],
        org.id,
      )
      if (!row || (row.account_id !== actor.id && !leads(org.role)))
        fail(404, 'This diary link was not found.')
      c.db.transaction(() => {
        c.db.run(
          'UPDATE diary_links SET stopped_at=?,stopped_by=? WHERE id=? AND stopped_at IS NULL',
          time,
          actor.id,
          row!.id,
        )
        c.audit(org, actor.id, 'diary-link.stopped', row!.id)
      })
      reply(200, list())
      return true
    }
    fail(404, 'This endpoint was not found.')
  }

  /** The diary itself, read by a calendar app with the link alone: `GET /api/diary/sd_….ics`. */
  async function read(c: Context, route: Route): Promise<boolean> {
    const { method, path, response } = route
    if (path[1] !== 'diary') return false
    if (method !== 'GET' && method !== 'HEAD') fail(405, 'A diary is read only. Use GET.')
    const match = path.length === 3 ? TOKEN.exec(path[2]) : null
    if (!match) fail(404, 'This diary link does not work.')
    limit(c, match![2])
    const row = c.db.get<LinkRow>(
      'SELECT * FROM diary_links WHERE prefix=? AND stopped_at IS NULL',
      match![2],
    )
    if (!row || !equalToken(digest(match![1]), row.token_hash))
      fail(404, 'This diary link does not work, or was stopped.')
    const org: Org | null = c.systemOrg(row!.organisation_id)
    if (!org || operations(org.state).mode === 'sandbox')
      fail(404, 'This diary link does not work, or was stopped.')
    if (c.plans.locked(org!.id)) fail(402, 'This studio is locked until its SALEANE bill is paid.')
    const maker = makerOf(c, row!)
    const scope = scopeOf(row!)
    // The maker must still be allowed to see it; a general manager whose location closed is not.
    if (
      !maker ||
      (maker.role === 'general' &&
        (!maker.locationId || !places(org!.state).some((p) => p.id === maker.locationId))) ||
      diaryRefusal(org!.state, maker, scope)
    )
      fail(404, 'This diary link no longer works. Ask for a new one.')
    const time = c.now()
    const file = diaryFile(org!.state, scope, {
      detail: row!.detail,
      ...windowFor(org!.state, maker!, time),
      now: time,
    })
    c.db.run('UPDATE diary_links SET last_read_at=? WHERE id=?', time, row!.id)
    response.statusCode = 200
    response.setHeader('Content-Type', 'text/calendar; charset=utf-8')
    response.setHeader('Content-Disposition', 'inline; filename="saleane-diary.ics"')
    response.end(method === 'HEAD' ? undefined : file)
    return true
  }

  return { manage, read }
}
