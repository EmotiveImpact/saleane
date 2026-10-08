import { z } from 'zod'
import { current, decide } from '../../lumane'
import type { PendingProposal, Usage } from '../../lumane'
import { fail } from '../http'
import type { Context, Route } from '../context'
import { dispatch } from '../../src/domain/commands'
import { businessDate } from '../../src/domain/operations'
import { callerNumber } from '../../src/domain/missedCalls'
import { CHAT_HISTORY_TURNS, askReceptionist, isOn } from '../../src/assistant/receptionist'
import type { ReceptionEffect } from '../../src/assistant/receptionist'

type Held = PendingProposal<ReceptionEffect> & { organisationId: string; visitor: string }

const RESTING =
  'The chat is resting for now. You can still choose a time on this page, or call the studio.'

/**
 * V4: the AI receptionist on the public booking page. A guest's chat counts once against the
 * studio's monthly guest-chat allowance, however many messages it takes. What it offers stays on
 * this server for 30 minutes and only the same visitor can take it up: a time comes back for the
 * page's ordinary booking steps, and a message goes to the inbox only when the guest sends it.
 */
export function receptionistRoutes() {
  const held = new Map<string, Held>()
  return async function receptionist(ctx: Context, route: Route): Promise<boolean> {
    const { request, method, path, body, reply } = route
    if (path[1] !== 'public' || !path[2] || path[3] !== 'receptionist') return false
    const org = ctx.publicOrg(path[2])
    const at = new Date(ctx.now()).toISOString()
    for (const [id, proposal] of held) if (proposal.expiresAt < at) held.delete(id)
    if (path.length === 4 && method === 'GET') {
      reply(200, { available: isOn(org.state), studio: org.state.organisation.name })
      return true
    }
    if (!isOn(org.state)) fail(404, 'The chat is not available for this studio.')
    const visitor = ctx.visitorFor(request)
    if (path.length === 4 && method === 'POST') {
      ctx.rateLimit(request, 'receptionist', 40, 10 * 60000)
      const { text, history } = z
        .object({
          text: z.string().trim().min(1).max(500),
          history: z
            .array(
              z
                .object({ from: z.enum(['guest', 'receptionist']), text: z.string().max(2000) })
                .strict(),
            )
            .max(CHAT_HISTORY_TURNS)
            .optional(),
        })
        .strict()
        .parse(body)
      const stored = () =>
        ((raw) => (raw ? (JSON.parse(raw.usage) as Usage) : undefined))(
          ctx.db.get<{ usage: string }>(
            'SELECT usage FROM assistant_usage WHERE organisation_id=?',
            org.id,
          ),
        )
      const result = await askReceptionist({
        state: ctx.withHolds(org),
        today: businessDate(org.state, at),
        now: at,
        visitorId: visitor,
        text,
        history,
        usage: stored(),
      })
      // The studio's allowance message is for the owner; the guest hears something kinder.
      if (result.status === 'refused') {
        reply(200, { text: RESTING, proposals: [] })
        return true
      }
      ctx.db.transaction(() => {
        // Re-read inside the write, so two guests at once both count.
        const before = current(stored(), at)
        const next = result.usage
        const used = {
          ...before.used,
          // One chat counts once, at its first message.
          guestChats: before.used.guestChats + (history?.length ? 0 : 1),
        }
        const day = at.slice(0, 10)
        const merged: Usage = {
          period: before.period,
          used,
          spendByDay: {
            ...before.spendByDay,
            [day]: (before.spendByDay[day] ?? 0) + Math.max(0, result.costMinor),
          },
          recent: { ...before.recent, [visitor]: next.recent[visitor] ?? [] },
        }
        ctx.db.run(
          'INSERT INTO assistant_usage(organisation_id,usage,updated_at) VALUES(?,?,?) ON CONFLICT(organisation_id) DO UPDATE SET usage=excluded.usage,updated_at=excluded.updated_at',
          org.id,
          JSON.stringify(merged),
          ctx.now(),
        )
      })
      for (const proposal of result.proposals)
        held.set(proposal.id, { ...proposal, organisationId: org.id, visitor })
      reply(200, {
        text: result.text,
        proposals: result.proposals.map(({ id, summary, effect, expiresAt }) => ({
          id,
          summary,
          kind: effect.kind,
          expiresAt,
        })),
      })
      return true
    }
    if (path[4] === 'proposals' && path.length === 6 && method === 'POST') {
      ctx.rateLimit(request, 'public-write', 20, 5 * 60000)
      z.object({ approve: z.literal(true) })
        .strict()
        .parse(body)
      const proposal = held.get(path[5])
      if (!proposal || proposal.organisationId !== org.id || proposal.visitor !== visitor)
        fail(404, 'This has expired. Ask again.')
      const decision = decide(proposal!, true, at)
      held.delete(path[5])
      if (decision.outcome !== 'approved') fail(404, 'This has expired. Ask again.')
      const effect = (decision as { effect: ReceptionEffect }).effect
      if (effect.kind === 'time') {
        // The page books it through its own steps: hold, details, policy and confirmation.
        reply(200, effect)
        return true
      }
      ctx.db.transaction(() => {
        const fresh = ctx.publicOrg(path[2])
        // A local number such as 07700 900456 is kept with its country code, so it finds the client.
        const from = effect.contact.includes('@')
          ? effect.contact
          : (callerNumber(fresh.state, effect.contact) ?? effect.contact)
        const result = dispatch(
          fresh.state,
          {
            type: 'reply-received',
            channel: 'chat',
            from,
            body: `${effect.name}: ${effect.message}`,
            providerRef: proposal!.id,
          },
          'AI receptionist',
          at,
        )
        if (!result.ok) fail(422, result.error)
        if (result.state !== fresh.state)
          ctx.persist(fresh, result.state, null, 'receptionist.message', result.recordId)
      })
      reply(200, { kind: 'message', sent: true })
      return true
    }
    return fail(404, 'This endpoint was not found.')
  }
}
