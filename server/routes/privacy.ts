import { z } from 'zod'
import { fail } from '../http'
import type { Context, Org, Route } from '../context'
import { businessDate } from '../../src/domain/operations'
import type { Role } from '../../src/domain/operations'
import {
  canPrivacy,
  clientExport,
  erasureReview,
  previewClientExport,
  previewStudioExport,
  studioExport,
} from '../../src/domain/privacy'
import type { PrivacyAction, TeamMember } from '../../src/domain/privacy'

const empty = z.object({}).strict()
const ERASURE_REQUESTED = 'client.erasure_requested'

/**
 * LOCAL-03 privacy routes under /api/workspaces/:id/privacy. Role checks run before any client
 * lookup, so a refused role cannot probe which clients exist. Exports and erasure requests are
 * written to the audit log by action and record id only; no exported field is logged. Nothing
 * here deletes a record. Returns false when the request belongs to another module.
 */
export async function privacyRoutes(ctx: Context, route: Route): Promise<boolean> {
  const { db, now, actorFor, orgFor, audit, rateLimit } = ctx
  const { request, method, path, body, reply } = route
  if (path[1] !== 'workspaces' || !path[2] || path[3] !== 'privacy') return false
  const actor = actorFor(request, method !== 'GET')
  const permitted = (action: PrivacyAction): Org => {
    const org = orgFor(path[2], actor)
    if (!canPrivacy(org.role, action))
      fail(
        403,
        action === 'studio.export'
          ? 'Only the owner can export the whole studio.'
          : 'Only an owner or manager can work with client data requests.',
      )
    return org
  }
  const clientIn = (org: Org) => {
    const client = org.state.clients.find((c) => c.id === path[5])
    if (!client) fail(404, 'This client was not found.')
    return client!
  }
  const meta = () => ({ generatedAt: new Date(now()).toISOString(), generatedBy: actor.name })
  const requests = (org: Org, clientId: string) =>
    db.all<{ occurredAt: number; actor: string | null }>(
      'SELECT e.occurred_at AS occurredAt,a.name AS actor FROM audit_events e LEFT JOIN accounts a ON a.id=e.actor_id WHERE e.organisation_id=? AND e.action=? AND e.record_id=? ORDER BY e.occurred_at,e.rowid',
      org.id,
      ERASURE_REQUESTED,
      clientId,
    )

  if (path[4] === 'clients' && path[5] && path.length === 7) {
    if (path[6] === 'export') {
      const org = permitted('client.export')
      const client = clientIn(org)
      if (method === 'GET') {
        reply(200, { preview: previewClientExport(clientExport(org.state, client.id, meta())) })
        return true
      }
      if (method === 'POST') {
        empty.parse(body ?? {})
        rateLimit(request, 'privacy-export', 20, 60000)
        const file = clientExport(org.state, client.id, meta())
        audit(org, actor.id, 'client.exported', client.id)
        reply(200, { export: file })
        return true
      }
    }
    if (path[6] === 'erasure') {
      const org = permitted('client.erasure')
      const client = clientIn(org)
      if (method === 'GET') {
        reply(200, {
          review: erasureReview(org.state, client.id, businessDate(org.state, meta().generatedAt)),
          requests: requests(org, client.id),
        })
        return true
      }
      if (method === 'POST') {
        empty.parse(body ?? {})
        // Recording is the whole action: an audit row, shown on the client. Nothing is removed.
        db.transaction(() => {
          if (requests(org, client.id).length)
            fail(409, 'An erasure request is already recorded for this client.')
          audit(org, actor.id, ERASURE_REQUESTED, client.id)
        })
        reply(201, { requests: requests(org, client.id), deleted: 0 })
        return true
      }
    }
  }
  if (path[4] === 'studio' && path[5] === 'export' && path.length === 6) {
    const org = permitted('studio.export')
    // Team members by name, email and role only: never password hashes, sessions or tokens.
    const team = db
      .all<{ name: string; email: string; role: Role; staffId: string | null }>(
        'SELECT a.name,a.email,m.role,m.staff_id AS staffId FROM memberships m JOIN accounts a ON a.id=m.account_id WHERE m.organisation_id=? ORDER BY a.name',
        org.id,
      )
      .map<TeamMember>(({ name, email, role, staffId }) => ({
        name,
        email,
        role,
        professional:
          role === 'practitioner'
            ? org.state.staff.find((person) => person.id === staffId)?.name
            : undefined,
      }))
    if (method === 'GET') {
      reply(200, { preview: previewStudioExport(studioExport(org.state, meta(), team)) })
      return true
    }
    if (method === 'POST') {
      empty.parse(body ?? {})
      rateLimit(request, 'privacy-export', 20, 60000)
      const file = studioExport(org.state, meta(), team)
      audit(org, actor.id, 'studio.exported', org.id)
      reply(200, { export: file })
      return true
    }
  }
  fail(404, 'This endpoint was not found.')
}
