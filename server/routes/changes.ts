import { z } from 'zod'
import { fail } from '../http'
import type { Context, Route } from '../context'
import { actionsIn, changeGroups, describeChange, recordNames } from '../../src/domain/changeRecord'
import type { ChangeGroup, ChangeRow } from '../../src/domain/changeRecord'
import { instantIn } from '../../src/domain/operations'
import { addDays } from '../../src/domain/format'

const PAGE = 50
/** The most a single request returns, for a download. */
const MOST = 500
const groups = Object.keys(changeGroups) as [ChangeGroup, ...ChangeGroup[]]
const query = z
  .object({
    /**
     * One person's account, `key:<id>` for one access key's changes (Stage 5), or `automatic`
     * for changes nobody signed in made.
     */
    who: z.string().min(1).max(100).optional(),
    group: z.enum(groups).optional(),
    /** Changes on this day of the studio's and earlier. */
    on: z.iso.date().optional(),
    /** Where the last page ended. */
    before: z
      .string()
      .regex(/^\d{1,15}\.\d{1,15}$/)
      .optional(),
    limit: z.coerce.number().int().min(1).max(MOST).optional(),
  })
  .strict()

/** The first moment after a day in the studio's time zone. */
function endOf(timeZone: string, date: string) {
  const next = addDays(date, 1)
  // Where the clocks change at midnight, the day still ends with the next day's first hour.
  for (const minute of [0, 60, 120])
    try {
      return Date.parse(instantIn(timeZone, next, minute))
    } catch {
      /* try the next hour */
    }
  return Date.parse(`${next}T00:00:00Z`)
}

/**
 * NEXT-05: who changed what, for the owner. Every saved change is in the audit log already; this
 * reads it newest first, a page at a time, in plain words. Nobody else sees it: the whole record
 * names clients and every location.
 */
export async function changeRoutes(ctx: Context, route: Route): Promise<boolean> {
  const { request, method, path, url, reply } = route
  if (path[1] !== 'workspaces' || path[3] !== 'changes' || path.length !== 4) return false
  if (method !== 'GET') fail(405, 'The change record cannot be edited.')
  const org = ctx.orgFor(path[2], ctx.actorFor(request))
  if (org.role !== 'owner') fail(403, 'Only the owner can see who changed what.')
  const input = query.parse(Object.fromEntries(url.searchParams))
  const where = ['e.organisation_id=?'],
    params: (string | number)[] = [org.id]
  if (input.who === 'automatic') where.push('e.actor_id IS NULL')
  else if (input.who) {
    where.push('e.actor_id=?')
    params.push(input.who)
  }
  if (input.group) {
    where.push('e.action IN (SELECT value FROM json_each(?))')
    params.push(JSON.stringify(actionsIn(input.group)))
  }
  if (input.on) {
    where.push('e.occurred_at<?')
    params.push(endOf(org.state.organisation.timeZone, input.on))
  }
  if (input.before) {
    const [at, seq] = input.before.split('.').map(Number)
    where.push('(e.occurred_at<? OR (e.occurred_at=? AND e.rowid<?))')
    params.push(at, at, seq)
  }
  const limit = input.limit ?? PAGE
  const rows = ctx.db.all<ChangeRow & { seq: number }>(
    `SELECT e.rowid AS seq,e.id,e.action,e.record_id AS recordId,e.occurred_at AS occurredAt,
       a.name AS actor,r.name AS account,e.detail,k.name AS keyName
     FROM audit_events e
     LEFT JOIN accounts a ON a.id=e.actor_id
     LEFT JOIN api_keys k ON e.actor_id='key:'||k.id AND k.organisation_id=e.organisation_id
     LEFT JOIN accounts r ON r.id=e.record_id AND e.action IN ('membership.changed','invitation.accepted')
     WHERE ${where.join(' AND ')}
     ORDER BY e.occurred_at DESC,e.rowid DESC LIMIT ?`,
    ...params,
    limit + 1,
  )
  const page = rows.slice(0, limit)
  const last = page.at(-1)
  const names = recordNames(org.state)
  reply(200, {
    entries: page.map((row) => describeChange(org.state, names, row)),
    next: rows.length > limit && last ? `${last.occurredAt}.${last.seq}` : null,
    // Everyone who has made a change here, including people who have since left, for the filter.
    ...(input.before
      ? {}
      : {
          // Stage 5: and every access key whose software has made a change, revoked or not.
          people: ctx.db.all<{ id: string; name: string }>(
            `SELECT id,name FROM (
               SELECT id,name FROM accounts WHERE id IN
                 (SELECT DISTINCT actor_id FROM audit_events WHERE organisation_id=? AND actor_id IS NOT NULL)
               UNION ALL
               SELECT 'key:'||id AS id,name||' (access key)' AS name FROM api_keys WHERE organisation_id=?
                 AND 'key:'||id IN (SELECT DISTINCT actor_id FROM audit_events WHERE organisation_id=? AND actor_id LIKE 'key:%')
             ) ORDER BY name COLLATE NOCASE`,
            org.id,
            org.id,
            org.id,
          ),
        }),
  })
  return true
}
