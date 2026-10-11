import { fail } from '../http'
import type { Context, Route } from '../context'
import type { Outbox } from '../messaging/outbox'
import { can, leads, operations } from '../../src/domain/operations'
import { newsAt, newsMessages } from '../../src/domain/news'
import { automaticKinds, marketingResults } from '../../src/domain/marketing'
import type { SentCopy } from '../../src/domain/marketing'
import type { MessageKind, OutboxStatus } from '../../src/domain/reminders'
import { marketingEmailUse } from '../messaging/marketingEmails'

/**
 * NEXT-14: the Marketing section's results. For the owner, managers and general managers: what
 * each campaign and each automatic message did, counted from the outbox, the stop links used and
 * the visits booked afterwards. Only numbers leave this route, never a list of who. A general
 * manager sees only their own location's campaigns, and no automatic messages, which go for the
 * whole studio.
 */
export function marketingRoutes(outbox: Outbox) {
  return async (ctx: Context, route: Route): Promise<boolean> => {
    const { request, method, path, reply } = route
    if (path[1] !== 'workspaces' || path[3] !== 'marketing') return false
    if (method !== 'GET') fail(405, 'Use GET.')
    if (path.length !== 4) fail(404, 'This endpoint was not found.')
    const org = ctx.orgFor(path[2], ctx.actorFor(request))
    if (!leads(org.role) || !can(org.role, 'news'))
      fail(403, 'Your role cannot see marketing results.')
    if (org.role === 'general' && !org.locationId)
      fail(403, 'Your access is not linked to a location.')
    const whole = org.role !== 'general'
    const campaigns =
      org.role === 'general' ? newsAt(org.state, org.locationId!) : newsMessages(org.state)
    const kinds = whole ? ['news', ...automaticKinds] : ['news']
    const copies = ctx.db
      .all<{
        kind: MessageKind
        slot: string
        client_id: string
        status: OutboxStatus
        created_at: number
        updated_at: number
      }>(
        `SELECT kind,slot,client_id,status,created_at,updated_at FROM outbox
         WHERE organisation_id=? AND kind IN (SELECT value FROM json_each(?))`,
        org.id,
        JSON.stringify(kinds),
      )
      .map((row): SentCopy => ({
        kind: row.kind,
        slot: row.slot,
        clientId: row.client_id,
        status: row.status,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }))
    const used = ctx.db
      .all<{ message_id: string; used_at: number }>(
        'SELECT message_id,used_at FROM news_links WHERE organisation_id=? AND used_at IS NOT NULL',
        org.id,
      )
      .map((row) => ({ messageId: row.message_id, usedAt: row.used_at }))
    const mode = operations(org.state).mode
    // NEXT-14: the month's marketing emails, for a studio that sends. A sample studio sends none.
    const use = mode === 'local' ? marketingEmailUse(ctx, org) : null
    reply(200, {
      mode,
      ...(use ? { emails: { used: use.used, limit: use.limit } } : {}),
      providers: {
        email: { live: outbox.providers.email.live },
        sms: { live: outbox.providers.sms.live },
      },
      ...marketingResults(org.state, copies, used, {
        campaignIds: campaigns.filter((m) => m.approvedAt).map((m) => m.id),
        automatic: whole,
        now: ctx.now(),
      }),
    })
    return true
  }
}
