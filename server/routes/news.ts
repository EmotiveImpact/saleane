import { z } from 'zod'
import { fail } from '../http'
import type { Context, Route } from '../context'
import type { Outbox } from '../messaging/outbox'
import { erasureRequested, newsSlot, openNewsLink, stopNewsByLink } from '../messaging/news'
import { can, operations } from '../../src/domain/operations'
import { newsAt, newsAudience, newsMessages, newsSummary } from '../../src/domain/news'
import { newsWays } from '../../src/domain/newsSchema'
import { outboxStatuses } from '../../src/domain/reminders'
import type { OutboxStatus } from '../../src/domain/reminders'
import { tokenSchema } from './guest'

const INVALID = 'This link has expired or been replaced. Ask the studio to stop your news.'
const audienceQuery = z
  .object({
    by: z.enum(newsWays),
    /** Location ids, comma separated; absent means every client of the studio. */
    locations: z.string().max(2000).optional(),
  })
  .strict()

/**
 * Stage 4: a message to clients. For the owner, managers and general managers: how far each
 * approved message has gone, counted from the outbox and the providers' answers, and how many
 * clients a draft would reach, worked out here where erasure requests are known. Only numbers
 * leave this route, never a list of who. For a client: the link at the foot of an email that stops
 * news, with every failure reading the same. Returns false when the request belongs elsewhere.
 */
export function newsRoutes(outbox: Outbox) {
  return async (ctx: Context, route: Route): Promise<boolean> => {
    const { request, method, path, url, body, reply } = route
    if (path[1] === 'news' && path.length === 3 && (path[2] === 'open' || path[2] === 'stop')) {
      if (method !== 'POST') fail(405, 'Use POST.')
      const parsed = z.object({ token: tokenSchema }).strict().safeParse(body)
      if (!parsed.success) fail(404, INVALID)
      const raw = parsed.data!.token
      if (path[2] === 'open') {
        ctx.rateLimit(request, 'news-read', 30, 5 * 60000)
        const { org, client } = openNewsLink(ctx, raw)
        const look = operations(org.state).look
        reply(200, {
          studio: org.state.organisation.name,
          ...(look ? { look } : {}),
          stopped: !client.marketingConsent,
        })
        return true
      }
      ctx.rateLimit(request, 'news-write', 10, 5 * 60000)
      const org = stopNewsByLink(ctx, raw)
      const look = operations(org.state).look
      reply(200, { studio: org.state.organisation.name, ...(look ? { look } : {}), stopped: true })
      return true
    }
    if (path[1] !== 'workspaces' || path[3] !== 'news') return false
    if (method !== 'GET') fail(405, 'Use GET.')
    const org = ctx.orgFor(path[2], ctx.actorFor(request))
    if (!can(org.role, 'news')) fail(403, 'Your role cannot see messages to clients.')
    if (org.role === 'general' && !org.locationId)
      fail(403, 'Your access is not linked to a location.')
    const own =
      org.role === 'general' ? newsAt(org.state, org.locationId!) : newsMessages(org.state)
    if (path.length === 4) {
      const counts = new Map<string, Record<OutboxStatus, number>>()
      const empty = () =>
        Object.fromEntries(outboxStatuses.map((status) => [status, 0])) as Record<
          OutboxStatus,
          number
        >
      for (const m of own) if (m.approvedAt) counts.set(newsSlot(m.id), empty())
      for (const row of ctx.db.all<{ slot: string; status: OutboxStatus; n: number }>(
        "SELECT slot,status,COUNT(*) AS n FROM outbox WHERE organisation_id=? AND kind='news' GROUP BY slot,status",
        org.id,
      )) {
        const tally = counts.get(row.slot)
        if (tally) tally[row.status] = row.n
      }
      reply(200, {
        mode: operations(org.state).mode,
        providers: {
          email: { live: outbox.providers.email.live },
          sms: { live: outbox.providers.sms.live },
        },
        messages: own
          .filter((m) => m.approvedAt)
          .map((m) => ({ id: m.id, outbox: counts.get(newsSlot(m.id))! })),
      })
      return true
    }
    if (path.length === 5 && path[4] === 'audience') {
      const input = audienceQuery.parse(Object.fromEntries(url.searchParams))
      const locationIds = input.locations ? input.locations.split(',').filter(Boolean) : undefined
      // A general manager counts only the clients of their own location.
      if (
        org.role === 'general' &&
        (locationIds?.length !== 1 || locationIds[0] !== org.locationId)
      )
        fail(403, 'Count only the clients of your own location.')
      const audience = newsAudience(
        org.state,
        { by: input.by, locationIds },
        { now: new Date(ctx.now()).toISOString(), erased: erasureRequested(ctx, org.id) },
      )
      reply(200, newsSummary(audience))
      return true
    }
    fail(404, 'This endpoint was not found.')
  }
}
