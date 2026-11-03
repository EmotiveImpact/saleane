import type { Context, Org } from '../context'
import { countedKinds, monthStartIn, usedStatuses } from '../../src/domain/marketing'

/**
 * NEXT-14: the marketing emails a studio has used this month, from the outbox, against what its
 * plan includes. A hard stop, like the AI allowances, so sending never costs SALEANE more than the
 * studio pays: a campaign that would go over is not approved, and an automatic email that would go
 * over is not sent. Counted on the studio's own calendar, by the month each copy was queued.
 */
export function marketingEmailUse(ctx: Context, org: Org) {
  const from = monthStartIn(org.state.organisation.timeZone, ctx.now())
  const row = ctx.db.get<{ used: number }>(
    `SELECT count(*) AS used FROM outbox
     WHERE organisation_id=? AND channel='email' AND created_at>=?
       AND kind IN (SELECT value FROM json_each(?))
       AND (status IN (SELECT value FROM json_each(?)) OR (kind='news' AND status='pending'))`,
    org.id,
    from,
    JSON.stringify(countedKinds),
    JSON.stringify(usedStatuses),
  )
  const limit = ctx.plans.marketingEmails(org)
  const used = row?.used ?? 0
  return { used, limit, left: Math.max(0, limit - used) }
}
