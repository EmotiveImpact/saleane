import { z } from 'zod'
import { decide } from '../../lumane'
import { holding, settleUse } from '../aiUsage'
import {
  keepChat,
  keepProposals,
  keptProposal,
  modelOf,
  openChat,
  recordTurn,
  settleProposal,
} from '../assistantRecords'
import { digest } from '../auth'
import { canonical, fail } from '../http'
import type { Context, Route } from '../context'
import { dispatch } from '../../src/domain/commands'
import { businessDate } from '../../src/domain/operations'
import { callerNumber } from '../../src/domain/missedCalls'
import { CHAT_HISTORY_TURNS, isOn, listedTimes } from '../../src/assistant/receptionist'
import { askReceptionist, receptionUse } from '../../src/assistant/receptionistAsk'
import type { ReceptionEffect, ReceptionTurn } from '../../src/assistant/receptionist'

const RESTING =
  'The chat is resting for now. You can still choose a time on this page, or call the studio.'
/** Fill-ins the outbox or a text answer would replace, which the page must never show. */
const FILL_INS = /\{\{[^{}]*\}\}|\[\[[^[\]]*\]\]/g
const UNAVAILABLE =
  'Sorry, I cannot answer just now. You can still choose a time on this page, or call the studio.'

/**
 * V4: the AI receptionist on the public booking page. A guest's chat counts once against the
 * studio's monthly guest-chat allowance, however many messages it takes. What it offers is kept
 * in the database for 30 minutes and only the same visitor can take it up: a time comes back for
 * the page's ordinary booking steps, and a message goes to the inbox only when the guest sends it.
 * The chat's last few lines are kept here too, for an hour after its last message, so the AI never
 * reads earlier lines the page sent: a guest cannot write the studio's side of the conversation.
 */
export function receptionistRoutes() {
  return async function receptionist(ctx: Context, route: Route): Promise<boolean> {
    const { request, response, method, path, body, reply } = route
    if (path[1] !== 'public' || !path[2] || path[3] !== 'receptionist') return false
    const org = ctx.publicOrg(path[2])
    const at = new Date(ctx.now()).toISOString()
    if (path.length === 4 && method === 'GET') {
      reply(200, { available: isOn(org.state), studio: org.state.organisation.name })
      return true
    }
    if (!isOn(org.state)) fail(404, 'The chat is not available for this studio.')
    const visitor = ctx.visitorFor(request)
    if (path.length === 4 && method === 'POST') {
      ctx.rateLimit(request, 'receptionist', 40, 10 * 60000)
      const input = z
        .object({ text: z.string().trim().min(1).max(500), chat: z.uuid().optional() })
        .strict()
        .parse(body)
      const brain = ctx.ai.brainFor(org.state, 'reception')
      // Only a chat this server started with this visitor carries on, with the lines kept here; a
      // guest's own word that a chat is under way is not taken, so the monthly allowance cannot be
      // stepped round.
      const chat = openChat<ReceptionTurn>(ctx, org.id, 'guests', visitor, input.chat)
      const continuing = chat.continuing
      // A guest who closes the page is not there to read the answer, so no further call is paid for.
      const left = new AbortController()
      const leave = () => {
        if (!response.writableFinished) left.abort()
      }
      response.on('close', leave)
      // NEXT-12: the message's share is held before the AI is asked, so guests writing at the same
      // moment cannot all pass the checks, then settled with what it really cost.
      const use = receptionUse(visitor, at, continuing)
      const allowance = ctx.plans.allowance(org)
      const { held: reserved, result } = await holding(ctx, org.id, allowance, use, (before) =>
        askReceptionist({
          state: ctx.withHolds(org),
          today: businessDate(org.state, at),
          now: at,
          visitorId: visitor,
          text: input.text,
          history: chat.turns,
          continuing,
          usage: before,
          allowance,
          signal: left.signal,
          ...(brain ? { brain } : {}),
        }),
      ).finally(() => response.off('close', leave))
      const model = modelOf(ctx, !!brain)
      // The studio's allowance message is for the owner; the guest hears something kinder.
      if (result.status === 'refused') {
        ctx.db.transaction(() => {
          if (reserved) settleUse(ctx, org.id, use, { counted: false, costMinor: 0 })
          recordTurn(ctx, org.id, 'guests', 'chat', null, model, result)
        })
        reply(200, { text: RESTING, proposals: [], chat: null })
        return true
      }
      // When the AI cannot answer, the chat is not counted but what it cost is.
      if (result.status === 'unavailable') {
        if (result.reason !== 'left')
          console.error(
            `[SALEANE] The receptionist's AI could not answer (${result.reason}): ${result.detail}`,
          )
        ctx.db.transaction(() => {
          settleUse(ctx, org.id, use, { counted: false, costMinor: result.costMinor })
          recordTurn(ctx, org.id, 'guests', 'chat', null, model, result)
        })
        reply(200, { text: UNAVAILABLE, proposals: [], chat: continuing ? chat.id : null })
        return true
      }
      // The page shows words only: any fill-in meant for a text message is taken out.
      const text = result.text.replace(FILL_INS, '').trim()
      // What it offers, the turn's record and the chat's new lines are kept with its cost.
      ctx.db.transaction(() => {
        settleUse(ctx, org.id, use, { counted: true, costMinor: result.costMinor })
        recordTurn(ctx, org.id, 'guests', 'chat', null, model, result)
        keepProposals(ctx, org.id, 'guests', visitor, result.proposals, (effect) =>
          digest(canonical(effect)),
        )
        keepChat<ReceptionTurn>(
          ctx,
          org.id,
          'guests',
          visitor,
          chat.id,
          [
            { from: 'guest', text: input.text },
            { from: 'receptionist', text },
          ],
          CHAT_HISTORY_TURNS,
        )
      })
      reply(200, {
        text,
        chat: chat.id,
        proposals: result.proposals.map(({ id, summary, effect, expiresAt }) => ({
          id,
          summary,
          kind: effect.kind,
          expiresAt,
        })),
        // The free times the answer lists, each a button that starts booking it on this page.
        times: listedTimes(result),
      })
      return true
    }
    if (path[4] === 'proposals' && path.length === 6 && method === 'POST') {
      ctx.rateLimit(request, 'public-write', 20, 5 * 60000)
      z.object({ approve: z.literal(true) })
        .strict()
        .parse(body)
      const taken = ctx.db.transaction(() => {
        const proposal = keptProposal<ReceptionEffect>(ctx, org.id, 'guests', visitor, path[5])
        // A visit's link goes only by text to the number on the booking, never through this chat.
        if (!proposal || proposal.effect.kind === 'manage') return undefined
        const effect = proposal.effect
        // A message passed on already is not passed on twice, however often the guest taps.
        if (proposal.status === 'applied' && effect.kind === 'message')
          return { kind: 'message' as const, sent: true as const }
        // Each offer is taken up once.
        if (proposal.status !== 'waiting') return undefined
        if (decide(proposal, true, at).outcome === 'expired') {
          settleProposal(ctx, proposal.id, 'expired')
          return undefined
        }
        if (effect.kind === 'time') {
          // The page books it through its own steps: hold, details, policy and confirmation.
          settleProposal(ctx, proposal.id, 'approved')
          return effect
        }
        const fresh = ctx.publicOrg(path[2])
        // A local number such as 07700 900456 is kept with its country code, as texts are. What
        // the visitor typed proves nothing, so the team matches the message to a client by hand.
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
            providerRef: proposal.id,
          },
          'AI receptionist',
          at,
        )
        if (!result.ok) fail(422, result.error)
        if (result.state !== fresh.state)
          ctx.persist(fresh, result.state, null, 'receptionist.message', result.recordId)
        settleProposal(ctx, proposal.id, 'applied')
        return { kind: 'message' as const, sent: true as const }
      })
      if (!taken) fail(404, 'This has expired. Ask again.')
      reply(200, taken)
      return true
    }
    return fail(404, 'This endpoint was not found.')
  }
}
