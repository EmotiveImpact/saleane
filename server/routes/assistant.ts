import { z } from 'zod'
import { current, decide, record } from '../../lumane'
import type { PendingProposal, Usage } from '../../lumane'
import { fail } from '../http'
import type { Context, Route } from '../context'
import { HISTORY_TURNS, TYPED_WORST_CASE_MINOR, askSaleane } from '../../src/assistant/ask'
import type { Command } from '../../src/domain/commands'

type Held = PendingProposal<Command> & { organisationId: string; accountId: string }

/**
 * Ask Saleane for owners, managers and reception. Usage is kept per studio so the allowance holds
 * across restarts. Proposals stay on this server for 30 minutes and are only ever returned to the
 * person who asked; an approved proposal comes back as a command, which the workspace then saves
 * through the ordinary command route with its permission, revision and request-key checks.
 * Returns false when the request belongs to another module.
 */
export function assistantRoutes() {
  const held = new Map<string, Held>()
  return async function assistant(ctx: Context, route: Route): Promise<boolean> {
    const { request, method, path, body, reply } = route
    if (path[1] !== 'workspaces' || path[3] !== 'assistant') return false
    const actor = ctx.actorFor(request, method !== 'GET')
    const org = ctx.orgFor(path[2], actor)
    if (org.role === 'practitioner') fail(403, 'Ask SALEANE is not available for your role yet.')
    const at = new Date(ctx.now()).toISOString()
    for (const [id, proposal] of held) if (proposal.expiresAt < at) held.delete(id)
    // NEXT-02: each open location's allowance, Plus once paid for, and none once read only.
    const allowance = ctx.plans.allowance(org)
    const stored = () =>
      ((raw) => (raw ? (JSON.parse(raw.usage) as Usage) : undefined))(
        ctx.db.get<{ usage: string }>(
          'SELECT usage FROM assistant_usage WHERE organisation_id=?',
          org.id,
        ),
      )
    const meter = (usage: Usage | undefined) => ({
      used: current(usage, at).used,
      allowance: allowance.monthly,
    })

    // NEXT-12: a real AI answers once SALEANE has its key, except in a sample studio.
    const brain = ctx.ai.brainFor(org.state, 'ask')
    if (path.length === 4 && method === 'GET') {
      reply(200, { mode: brain ? 'live' : 'test', usage: meter(stored()) })
      return true
    }
    if (path.length === 4 && method === 'POST') {
      ctx.rateLimit(request, 'assistant', 30, 60000)
      const { text, history } = z
        .object({
          text: z.string().trim().min(1).max(500),
          history: z
            .array(
              z.object({ from: z.enum(['you', 'saleane']), text: z.string().max(2000) }).strict(),
            )
            .max(HISTORY_TURNS)
            .optional(),
        })
        .strict()
        .parse(body)
      const result = await askSaleane({
        state: org.state,
        role: org.role,
        personId: actor.id,
        text,
        history,
        usage: stored(),
        at,
        allowance,
        ...(brain ? { brain } : {}),
      })
      if (result.status === 'refused') {
        reply(200, { status: 'refused', text: result.text, proposals: [], usage: meter(stored()) })
        return true
      }
      const answered = result.status === 'answered'
      if (!answered)
        console.error(
          `[SALEANE] Ask SALEANE's AI could not answer (${result.reason}): ${result.detail}`,
        )
      // Re-read inside the write, so two questions at once both count. A question the AI could
      // not answer is not counted against the month, but whatever it cost is.
      const usage = ctx.db.transaction(() => {
        const next = record(
          stored(),
          {
            meter: 'typed',
            amount: answered ? 1 : 0,
            personId: actor.id,
            at,
            worstCaseMinor: TYPED_WORST_CASE_MINOR,
          },
          result.costMinor,
        )
        ctx.db.run(
          'INSERT INTO assistant_usage(organisation_id,usage,updated_at) VALUES(?,?,?) ON CONFLICT(organisation_id) DO UPDATE SET usage=excluded.usage,updated_at=excluded.updated_at',
          org.id,
          JSON.stringify(next),
          ctx.now(),
        )
        if (answered)
          for (const proposal of result.proposals)
            ctx.audit(org, actor.id, 'assistant.proposed', proposal.id)
        return next
      })
      if (!answered) {
        reply(200, { status: 'unavailable', text: result.text, proposals: [], usage: meter(usage) })
        return true
      }
      for (const proposal of result.proposals)
        held.set(proposal.id, {
          ...(proposal as PendingProposal<Command>),
          organisationId: org.id,
          accountId: actor.id,
        })
      reply(200, {
        status: 'answered',
        text: result.text,
        proposals: result.proposals.map(({ id, summary, expiresAt }) => ({
          id,
          summary,
          expiresAt,
        })),
        usage: meter(usage),
      })
      return true
    }
    if (path[4] === 'proposals' && path.length === 6 && method === 'POST') {
      const { approve } = z.object({ approve: z.boolean() }).strict().parse(body)
      const proposal = held.get(path[5])
      if (!proposal || proposal.organisationId !== org.id || proposal.accountId !== actor.id)
        fail(404, 'This suggestion has expired. Ask again.')
      held.delete(path[5])
      const decision = decide(proposal!, approve, at)
      ctx.audit(org, actor.id, `assistant.${decision.outcome}`, proposal!.id)
      reply(
        200,
        decision.outcome === 'approved'
          ? { outcome: 'approved', command: decision.effect }
          : { outcome: decision.outcome },
      )
      return true
    }
    return fail(404, 'This endpoint was not found.')
  }
}
