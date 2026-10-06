import { fail } from '../http'
import type { Context, Route } from '../context'
import { daySheet } from '../../src/domain/daySheet'

/**
 * OFF-01: the read-only day sheet a signed-in member may keep while offline. Membership, role and
 * linked professional come from the server membership; a practitioner receives only their own
 * visits. Returns false when the request belongs to another module.
 */
export async function daySheetRoutes(ctx: Context, route: Route): Promise<boolean> {
  const { request, method, path, reply } = route
  if (path[1] !== 'workspaces' || path[3] !== 'day-sheet' || path.length !== 4) return false
  if (method !== 'GET') fail(405, 'The day sheet is read-only.')
  const org = ctx.orgFor(path[2], ctx.actorFor(request))
  let sheet
  try {
    sheet = daySheet(org.state, org, new Date(ctx.now()).toISOString())
  } catch {
    return fail(403, 'Your professional profile is no longer active. Ask the owner to update it.')
  }
  reply(200, sheet)
  return true
}
