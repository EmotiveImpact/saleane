import { z } from 'zod'
import { fail } from '../http'
import { can } from '../../src/domain/operations'
import { MANAGE_LINK } from '../../src/domain/reminders'
import { NEWS_STOP_LINK } from '../../src/domain/news'
import { repliesList } from '../../src/domain/inbox'
import type { BusinessState } from '../../src/domain/model'
import type { Context, Route } from '../context'
import type { Outbox, OutboxRow } from '../messaging/outbox'

const query = z.object({
  clientId: z.string().min(1).max(150).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
})

/**
 * V4: the receptionist answers a sender before anyone knows who they are. Once the team matches
 * the guest's message to a client, the answer follows it into that client's conversation.
 */
function linkedClients(state: BusinessState) {
  const linked = new Map<string, string>()
  for (const r of repliesList(state))
    if (r.clientId) linked.set(`${r.channel}|reception:${r.providerRef}`, r.clientId)
  return linked
}

/** The private link is never stored; the record shows where it went. */
function view(row: OutboxRow, linked: Map<string, string>) {
  return {
    id: row.id,
    appointmentId: row.appointment_id,
    clientId:
      row.client_id ||
      (row.kind === 'receptionist' ? linked.get(`${row.channel}|${row.slot}`) : undefined) ||
      '',
    kind: row.kind,
    channel: row.channel,
    recipient: row.recipient,
    subject: row.subject,
    body: row.body
      .replaceAll(MANAGE_LINK, '[private link to manage the visit]')
      .replaceAll(NEWS_STOP_LINK, '[private link to stop news]'),
    status: row.status,
    provider: row.provider,
    detail: row.detail,
    attempts: row.attempts,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    // V1.5: a message written in the inbox names itself in its slot.
    ...(row.kind === 'message' ? { messageId: row.slot.slice('message:'.length) } : {}),
    // V4: so is an answer on a social app.
    ...(row.kind === 'social' ? { answerId: row.slot.slice('social:'.length) } : {}),
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
      const linked = linkedClients(org.state)
      const rows = input.clientId
        ? ctx.db.all<OutboxRow>(
            `SELECT * FROM outbox WHERE organisation_id=? AND (client_id=? OR (client_id='' AND kind='receptionist' AND channel || '|' || slot IN (SELECT value FROM json_each(?)))) ORDER BY created_at DESC LIMIT ?`,
            org.id,
            input.clientId,
            JSON.stringify([...linked].filter(([, id]) => id === input.clientId).map(([k]) => k)),
            input.limit,
          )
        : // Stage 4: a message to clients is followed on its own page and on each client's,
          // so its many copies do not crowd out the studio's other messages here.
          ctx.db.all<OutboxRow>(
            "SELECT * FROM outbox WHERE organisation_id=? AND kind<>'news' ORDER BY created_at DESC LIMIT ?",
            org.id,
            input.limit,
          )
      reply(200, {
        messages: rows.map((row) => view(row, linked)),
        providers: {
          email: { name: outbox.providers.email.name, live: outbox.providers.email.live },
          sms: { name: outbox.providers.sms.name, live: outbox.providers.sms.live },
        },
      })
      return true
    }
    if (path.length === 6 && path[5] === 'retry' && method === 'POST') {
      if (!can(org.role, 'message.queue')) fail(403, 'Your role cannot send messages again.')
      // Stage 4: a copy of a message to clients goes again only on the owner's word.
      const kind = ctx.db.get<{ kind: string }>(
        'SELECT kind FROM outbox WHERE id=? AND organisation_id=?',
        path[4],
        org.id,
      )?.kind
      if (kind === 'news' && !can(org.role, 'news-send'))
        fail(403, 'Only the owner can send a message to clients again.')
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
