import { fail } from '../http'
import type { Context, Route } from '../context'
import { businessDate, operations } from '../../src/domain/operations'
import { compare, perOwner, studioMeasures } from '../../src/domain/benchmark'
import type { Measures } from '../../src/domain/benchmark'

/**
 * V5: how this studio compares with similar studios. Only owners and managers read it, only a
 * studio that shares sees it, and it compares with other sharing studios in the same market and
 * of the same kind (sample studios only with samples). Nothing about any one other studio is
 * returned: just the spread of their measures, and only when there are enough of them.
 */
export async function benchmarkRoutes(ctx: Context, route: Route): Promise<boolean> {
  const { request, method, path, reply } = route
  if (path[1] !== 'workspaces' || path[3] !== 'benchmark' || path.length !== 4) return false
  if (method !== 'GET') fail(405, 'The comparison is read-only.')
  const org = ctx.orgFor(path[2], ctx.actorFor(request))
  if (org.role !== 'owner' && org.role !== 'manager')
    fail(403, 'Only the owner and managers see how the studio compares.')
  const iso = new Date(ctx.now()).toISOString()
  const sharing = operations(org.state).benchmark?.sharing === true
  if (!sharing) {
    reply(200, { sharing: false })
    return true
  }
  const sample = operations(org.state).mode === 'sandbox'
  const ids = ctx.db.all<{ id: string }>(
    "SELECT id FROM organisations WHERE id<>? AND json_extract(state,'$.operations.benchmark.sharing')=1 AND json_extract(state,'$.organisation.region')=?",
    org.id,
    org.state.organisation.region,
  )
  // Studios are grouped by owner: one owner's studios count once, and studios sharing an owner
  // with this one are left out, so an owner never compares against themselves.
  const ownerOf = (id: string) =>
    ctx.db
      .all<{ account_id: string }>(
        "SELECT account_id FROM memberships WHERE organisation_id=? AND role='owner' ORDER BY account_id",
        id,
      )
      .map((row) => row.account_id)
  const mine = new Set(ownerOf(org.id))
  const groups = new Map<string, Measures[]>()
  for (const row of ids) {
    const other = ctx.systemOrg(row.id)
    if (!other || (operations(other.state).mode === 'sandbox') !== sample) continue
    const owners = ownerOf(row.id)
    if (!owners.length || owners.some((o) => mine.has(o))) continue
    const measures = studioMeasures(other.state, businessDate(other.state, iso))
    if (!measures) continue
    const key = owners[0]
    groups.set(key, [...(groups.get(key) ?? []), measures])
  }
  const others = perOwner([...groups.values()])
  const own = studioMeasures(org.state, businessDate(org.state, iso))
  reply(200, {
    sharing: true,
    since: operations(org.state).benchmark?.since ?? null,
    enoughVisits: own !== null,
    comparison: compare(own, others),
  })
  return true
}
