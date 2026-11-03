import { z } from 'zod'
import { decide, usedEach } from '../../lumane'
import type { Usage } from '../../lumane'
import { holding, settleUse, storedUsage } from '../aiUsage'
import {
  commandFingerprint,
  keepChat,
  keepProposals,
  keptProposal,
  modelOf,
  openChat,
  recordTurn,
  settleProposal,
} from '../assistantRecords'
import { fail } from '../http'
import type { Context, Route } from '../context'
import { talks } from '../talk'
import { HISTORY_TURNS, askSaleane, askUse } from '../../src/assistant/ask'
import type { AskTurn } from '../../src/assistant/ask'
import type { Command } from '../../src/domain/commands'
import { ASK_NAME } from '../../src/assistant/name'
import { branchView } from '../../src/domain/branch'
import { businessDate } from '../../src/domain/operations'

/**
 * Ask Saleane for owners, managers and reception. Usage is kept per studio so the allowance holds
 * across restarts. Each change it prepares is kept in the database for 30 minutes, through a
 * restart, and is only ever returned to the person who asked; an approved change comes back as a
 * command, which the workspace then saves through the ordinary command route with its permission,
 * revision and request-key checks, and only then is it recorded as applied. The conversation's
 * last few lines are kept here too, so the AI never reads earlier lines a browser sent.
 * Returns false when the request belongs to another module.
 */
export function assistantRoutes() {
  const talking = talks()
  const routes = async function assistant(ctx: Context, route: Route): Promise<boolean> {
    const { request, response, method, path, body, reply } = route
    if (path[1] !== 'workspaces' || path[3] !== 'assistant') return false
    const actor = ctx.actorFor(request, method !== 'GET')
    const org = ctx.orgFor(path[2], actor)
    if (org.role === 'practitioner') fail(403, `${ASK_NAME} is not available for your role yet.`)
    const at = new Date(ctx.now()).toISOString()
    // NEXT-02: each open location's allowance, Plus once paid for, and none once read only.
    const allowance = ctx.plans.allowance(org)
    const stored = () => storedUsage(ctx, org.id)
    const meter = (usage: Usage | undefined) => ({
      used: usedEach(allowance, usage, at),
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
      const { sdp, conversation } = z
        .object({ sdp: z.string().min(10).max(30000), conversation: z.uuid().optional() })
        .strict()
        .parse(body)
      // What is said joins the panel's conversation, so a typed follow-up knows what was asked.
      const chat = openChat<AskTurn>(ctx, org.id, 'team', actor.id, conversation, { adopt: true })
      // The browser can leave while the talk starts (a closed tab, a dropped network). It could
      // then never connect or end the talk, so one that starts anyway is ended and counted.
      let left = false
      const leave = () => {
        if (!response.writableFinished) left = true
      }
      response.on('close', leave)
      const started = await talking
        .start(
          ctx,
          org,
          actor,
          allowance,
          sdp,
          () => left || request.socket?.destroyed === true,
          chat.id,
        )
        .finally(() => response.off('close', leave))
      // SALEANE stopped while the talk started: its records are closed, so none are read.
      if (talking.stopping()) {
        reply(200, started)
        return true
      }
      reply(200, { ...started, conversation: chat.id, usage: meter(stored()) })
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
      // Earlier lines are never taken from the browser: only the conversation kept here is read.
      const { text, conversation } = z
        .object({ text: z.string().trim().min(1).max(500), conversation: z.uuid().optional() })
        .strict()
        .parse(body)
      const chat = openChat<AskTurn>(ctx, org.id, 'team', actor.id, conversation, { adopt: true })
      // Stage 4: a general manager's questions are answered from their own location's view only.
      const state =
        org.role === 'general' && org.locationId
          ? branchView(org.state, org.locationId, businessDate(org.state, at))
          : org.state
      // Someone who closes the panel or loses their connection is not there to read the answer,
      // so no further call to the AI is paid for.
      const left = new AbortController()
      const leave = () => {
        if (!response.writableFinished) left.abort()
      }
      response.on('close', leave)
      // The question's share is held first, so questions asked at the same moment cannot all pass
      // the checks; the turn checks the usage as it was before, and so refuses exactly when this did.
      const use = askUse(actor.id, at)
      const { held: reserved, result } = await holding(ctx, org.id, allowance, use, (before) =>
        askSaleane({
          state,
          role: org.role,
          personId: actor.id,
          text,
          history: chat.turns,
          usage: before,
          at,
          allowance,
          signal: left.signal,
          ...(brain ? { brain } : {}),
        }),
      ).finally(() => response.off('close', leave))
      const model = modelOf(ctx, !!brain)
      if (result.status === 'refused') {
        ctx.db.transaction(() => {
          if (reserved) settleUse(ctx, org.id, use, { counted: false, costMinor: 0 })
          recordTurn(ctx, org.id, 'team', 'panel', actor.id, model, result)
        })
        reply(200, { status: 'refused', text: result.text, proposals: [], usage: meter(stored()) })
        return true
      }
      const answered = result.status === 'answered'
      if (!answered && result.reason !== 'left')
        console.error(
          `[SALEANE] ${ASK_NAME}'s AI could not answer (${result.reason}): ${result.detail}`,
        )
      // What it really cost replaces the share held. A question the AI could not answer is not
      // counted against the month, but whatever it cost is. A change it prepared, the turn's record
      // and the conversation's new lines are kept in the same transaction.
      const usage = ctx.db.transaction(() => {
        const next = settleUse(ctx, org.id, use, { counted: answered, costMinor: result.costMinor })
        recordTurn(ctx, org.id, 'team', 'panel', actor.id, model, result)
        if (answered) {
          keepProposals(ctx, org.id, 'team', actor.id, result.proposals, commandFingerprint)
          for (const proposal of result.proposals)
            ctx.audit(org, actor.id, 'assistant.proposed', proposal.id)
          keepChat<AskTurn>(
            ctx,
            org.id,
            'team',
            actor.id,
            chat.id,
            [
              { from: 'you', text },
              { from: 'saleane', text: result.text },
            ],
            HISTORY_TURNS,
          )
        }
        return next
      })
      if (!answered) {
        reply(200, { status: 'unavailable', text: result.text, proposals: [], usage: meter(usage) })
        return true
      }
      reply(200, {
        status: 'answered',
        text: result.text,
        conversation: chat.id,
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
      const decided = ctx.db.transaction(() => {
        const proposal = keptProposal<Command>(ctx, org.id, 'team', actor.id, path[5])
        if (!proposal || proposal.status === 'declined' || proposal.status === 'expired')
          return undefined
        // Already saved: the panel only needs to know, and nothing is saved twice.
        if (proposal.status === 'applied') return { outcome: 'applied' as const }
        const decision = decide(proposal, approve, at)
        if (decision.outcome === 'expired') {
          if (proposal.status === 'waiting') settleProposal(ctx, proposal.id, 'expired')
          return undefined
        }
        // Approved before, but the change did not save (the connection dropped, or someone else
        // saved first): the same change comes back to try again, or can now be turned down.
        if (proposal.status === 'approved' && decision.outcome === 'approved')
          return { outcome: 'approved' as const, command: decision.effect }
        settleProposal(ctx, proposal.id, decision.outcome)
        ctx.audit(org, actor.id, `assistant.${decision.outcome}`, proposal.id)
        return decision.outcome === 'approved'
          ? { outcome: 'approved' as const, command: decision.effect }
          : { outcome: decision.outcome }
      })
      if (!decided) fail(404, 'This suggestion has expired. Ask again.')
      reply(200, decided)
      return true
    }
    return fail(404, 'This endpoint was not found.')
  }
  /** Ends every talk still running, as SALEANE stops. */
  return Object.assign(routes, { stop: (ctx: Context) => talking.stopAll(ctx) })
}
