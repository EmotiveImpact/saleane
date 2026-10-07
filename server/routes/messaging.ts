import { z } from 'zod'
import { fail } from '../http'
import { can } from '../../src/domain/operations'
import { MANAGE_LINK } from '../../src/domain/reminders'
import type { Context, Route } from '../context'
import type { Outbox, OutboxRow } from '../messaging/outbox'

const query = z.object({
  clientId: z.string().min(1).max(150).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
})

/** The private link is never stored; the record shows where it went. */
function view(row: OutboxRow) {
  return {
    id: row.id,
    appointmentId: row.appointment_id,
    clientId: row.client_id,
    kind: row.kind,
    channel: row.channel,
    recipient: row.recipient,
    subject: row.subject,
    body: row.body.replaceAll(MANAGE_LINK, '[private link to manage the visit]'),
    status: row.status,
    provider: row.provider,
    detail: row.detail,
    attempts: row.attempts,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  }
}

/** PILOT-01: what the outbox did, for the studio's team; and the provider modes in force. */
export function messagingRoutes(outbox: Outbox) {
  return async (ctx: Context, route: Route): Promise<boolean> => {
    const { request, method, path, url, reply } = route
    if (path[1] !== 'workspaces' || path[3] !== 'outbox') return false
    const actor = ctx.actorFor(request, method !== 'GET')
    const org = ctx.orgFor(path[2], actor)
    // Practitioners see their own day only; the outbox lists every client's messages.
    if (org.role === 'practitioner') fail(403, 'Your role cannot view sent messages.')
    if (path.length === 4 && method === 'GET') {
      const input = query.parse(Object.fromEntries(url.searchParams))
      const rows = input.clientId
        ? ctx.db.all<OutboxRow>(
            'SELECT * FROM outbox WHERE organisation_id=? AND client_id=? ORDER BY created_at DESC LIMIT ?',
            org.id,
            input.clientId,
            input.limit,
          )
        : ctx.db.all<OutboxRow>(
            'SELECT * FROM outbox WHERE organisation_id=? ORDER BY created_at DESC LIMIT ?',
            org.id,
            input.limit,
          )
      reply(200, {
        messages: rows.map(view),
        providers: {
          email: { name: outbox.providers.email.name, live: outbox.providers.email.live },
          sms: { name: outbox.providers.sms.name, live: outbox.providers.sms.live },
        },
      })
      return true
    }
    if (path.length === 6 && path[5] === 'retry' && method === 'POST') {
      if (!can(org.role, 'message.queue')) fail(403, 'Your role cannot send messages again.')
      if (!outbox.retry(org.id, path[4]))
        fail(409, 'Only a message that failed or is unclear can be sent again.')
      ctx.audit(org, actor.id, 'outbox.retry', path[4])
      void outbox.tick().catch(() => {})
      reply(200, { ok: true })
      return true
    }
    fail(404, 'This endpoint was not found.')
  }
}
