import { z } from 'zod'
import { current, decide } from '../../lumane'
import type { PendingProposal, Usage } from '../../lumane'
import { holding, settleUse, storedUsage } from '../aiUsage'
import { fail } from '../http'
import type { Context, Route } from '../context'
import { talks } from '../talk'
import type { Held } from '../talk'
import { HISTORY_TURNS, askSaleane, askUse } from '../../src/assistant/ask'
import type { Command } from '../../src/domain/commands'

/**
 * Ask Saleane for owners, managers and reception. Usage is kept per studio so the allowance holds
 * across restarts. Proposals stay on this server for 30 minutes and are only ever returned to the
 * person who asked; an approved proposal comes back as a command, which the workspace then saves
 * through the ordinary command route with its permission, revision and request-key checks.
 * Returns false when the request belongs to another module.
 */
export function assistantRoutes() {
  const held = new Map<string, Held>()
  const talking = talks(held)
  const routes = async function assistant(ctx: Context, route: Route): Promise<boolean> {
    const { request, response, method, path, body, reply } = route
    if (path[1] !== 'workspaces' || path[3] !== 'assistant') return false
    const actor = ctx.actorFor(request, method !== 'GET')
    const org = ctx.orgFor(path[2], actor)
    if (org.role === 'practitioner') fail(403, 'Ask SALEANE is not available for your role yet.')
    const at = new Date(ctx.now()).toISOString()
    for (const [id, proposal] of held) if (proposal.expiresAt < at) held.delete(id)
    // NEXT-02: each open location's allowance, Plus once paid for, and none once read only.
    const allowance = ctx.plans.allowance(org)
    const stored = () => storedUsage(ctx, org.id)
    const meter = (usage: Usage | undefined) => ({
      used: current(usage, at).used,
      allowance: allowance.monthly,
    })

    // NEXT-12: a real AI answers once SALEANE has its key, except in a sample studio.
    const brain = ctx.ai.brainFor(org.state, 'ask')
    // NEXT-12 part 2: talking needs both the voice and Claude, which does the thinking.
    const talk = !!brain && ctx.voice.live
    if (path.length === 4 && method === 'GET') {
      reply(200, { mode: brain ? 'live' : 'test', talk, usage: meter(stored()) })
      return true
    }
    if (path[4] === 'talk' && path.length === 5 && method === 'POST') {
      if (!talk) fail(409, 'Talking is not switched on for this studio.')
      ctx.rateLimit(request, 'assistant-talk', 6, 60000)
      const { sdp } = z
        .object({ sdp: z.string().min(10).max(30000) })
        .strict()
        .parse(body)
      // The browser can leave while the talk starts (a closed tab, a dropped network). It could
      // then never connect or end the talk, so one that starts anyway is ended and counted.
      let left = false
      const leave = () => {
        if (!response.writableFinished) left = true
      }
      response.on('close', leave)
      const started = await talking
        .start(ctx, org, actor, allowance, sdp, () => left || request.socket?.destroyed === true)
        .finally(() => response.off('close', leave))
      // SALEANE stopped while the talk started: its records are closed, so none are read.
      if (talking.stopping()) {
        reply(200, started)
        return true
      }
      reply(200, { ...started, usage: meter(stored()) })
      return true
    }
    if (path[4] === 'talk' && path[5] && path.length <= 7) {
      const found = talking.find(ctx, org.id, actor, path[5])
      if (!found) fail(404, 'This talk has ended.')
      if (path.length === 6 && method === 'GET') {
        reply(200, { ...talking.view(ctx, found!), usage: meter(stored()) })
        return true
      }
      if (path[6] === 'end' && method === 'POST') {
        talking.end(ctx, found!)
        reply(200, { ...talking.view(ctx, found!), usage: meter(stored()) })
        return true
      }
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
      // The question's share is held first, so questions asked at the same moment cannot all pass
      // the checks; the turn checks the usage as it was before, and so refuses exactly when this did.
      const use = askUse(actor.id, at)
      const { held: reserved, result } = await holding(ctx, org.id, allowance, use, (before) =>
        askSaleane({
          state: org.state,
          role: org.role,
          personId: actor.id,
          text,
          history,
          usage: before,
          at,
          allowance,
          ...(brain ? { brain } : {}),
        }),
      )
      if (result.status === 'refused') {
        if (reserved)
          ctx.db.transaction(() => settleUse(ctx, org.id, use, { counted: false, costMinor: 0 }))
        reply(200, { status: 'refused', text: result.text, proposals: [], usage: meter(stored()) })
        return true
      }
      const answered = result.status === 'answered'
      if (!answered)
        console.error(
          `[SALEANE] Ask SALEANE's AI could not answer (${result.reason}): ${result.detail}`,
        )
      // What it really cost replaces the share held. A question the AI could not answer is not
      // counted against the month, but whatever it cost is.
      const usage = ctx.db.transaction(() => {
        const next = settleUse(ctx, org.id, use, { counted: answered, costMinor: result.costMinor })
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
  /** Ends every talk still running, as SALEANE stops. */
  return Object.assign(routes, { stop: (ctx: Context) => talking.stopAll(ctx) })
}
