import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { decide } from '../../lumane'
import type { PendingProposal } from '../../lumane'
import { holding, settleUse } from '../aiUsage'
import { fail } from '../http'
import type { Context, Route } from '../context'
import { dispatch } from '../../src/domain/commands'
import { businessDate } from '../../src/domain/operations'
import { callerNumber } from '../../src/domain/missedCalls'
import {
  CHAT_HISTORY_TURNS,
  askReceptionist,
  isOn,
  listedTimes,
  receptionUse,
} from '../../src/assistant/receptionist'
import type { ReceptionEffect } from '../../src/assistant/receptionist'

type Held = PendingProposal<ReceptionEffect> & { organisationId: string; visitor: string }
type Chat = { organisationId: string; visitor: string; expires: number }

/** A chat stays open this long after its last message; after that a new message starts a new chat. */
const CHAT_IDLE_MS = 60 * 60000
const CHAT_LIMIT = 10000

const RESTING =
  'The chat is resting for now. You can still choose a time on this page, or call the studio.'
/** Fill-ins the outbox or a text answer would replace, which the page must never show. */
const FILL_INS = /\{\{[^{}]*\}\}|\[\[[^[\]]*\]\]/g
const UNAVAILABLE =
  'Sorry, I cannot answer just now. You can still choose a time on this page, or call the studio.'

/**
 * V4: the AI receptionist on the public booking page. A guest's chat counts once against the
 * studio's monthly guest-chat allowance, however many messages it takes. What it offers stays on
 * this server for 30 minutes and only the same visitor can take it up: a time comes back for the
 * page's ordinary booking steps, and a message goes to the inbox only when the guest sends it.
 */
export function receptionistRoutes() {
  const held = new Map<string, Held>()
  // Chats this server started. Only these count as one chat; a guest's own word that a chat is
  // under way is not taken, so the monthly allowance cannot be stepped round.
  const chats = new Map<string, Chat>()
  return async function receptionist(ctx: Context, route: Route): Promise<boolean> {
    const { request, method, path, body, reply } = route
    if (path[1] !== 'public' || !path[2] || path[3] !== 'receptionist') return false
    const org = ctx.publicOrg(path[2])
    const at = new Date(ctx.now()).toISOString()
    for (const [id, proposal] of held) if (proposal.expiresAt < at) held.delete(id)
    for (const [id, chat] of chats) if (chat.expires <= ctx.now()) chats.delete(id)
    if (path.length === 4 && method === 'GET') {
      reply(200, { available: isOn(org.state), studio: org.state.organisation.name })
      return true
    }
    if (!isOn(org.state)) fail(404, 'The chat is not available for this studio.')
    const visitor = ctx.visitorFor(request)
    if (path.length === 4 && method === 'POST') {
      ctx.rateLimit(request, 'receptionist', 40, 10 * 60000)
      const input = z
        .object({
          text: z.string().trim().min(1).max(500),
          chat: z.uuid().optional(),
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
      const brain = ctx.ai.brainFor(org.state, 'reception')
      const known = input.chat ? chats.get(input.chat) : undefined
      const continuing = !!known && known.organisationId === org.id && known.visitor === visitor
      // Without a chat this server started, earlier messages are not taken on trust.
      const history = continuing ? input.history : undefined
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
          history,
          continuing,
          usage: before,
          allowance,
          ...(brain ? { brain } : {}),
        }),
      )
      // The studio's allowance message is for the owner; the guest hears something kinder.
      if (result.status === 'refused') {
        if (reserved)
          ctx.db.transaction(() => settleUse(ctx, org.id, use, { counted: false, costMinor: 0 }))
        reply(200, { text: RESTING, proposals: [], chat: null })
        return true
      }
      // When the AI cannot answer, the chat is not counted but what it cost is.
      if (result.status === 'unavailable') {
        console.error(
          `[SALEANE] The receptionist's AI could not answer (${result.reason}): ${result.detail}`,
        )
        ctx.db.transaction(() =>
          settleUse(ctx, org.id, use, { counted: false, costMinor: result.costMinor }),
        )
        reply(200, { text: UNAVAILABLE, proposals: [], chat: continuing ? input.chat : null })
        return true
      }
      ctx.db.transaction(() =>
        settleUse(ctx, org.id, use, { counted: true, costMinor: result.costMinor }),
      )
      for (const proposal of result.proposals)
        held.set(proposal.id, { ...proposal, organisationId: org.id, visitor })
      const chat = continuing ? input.chat! : randomUUID()
      if (!continuing && chats.size >= CHAT_LIMIT) chats.delete(chats.keys().next().value!)
      chats.set(chat, { organisationId: org.id, visitor, expires: ctx.now() + CHAT_IDLE_MS })
      reply(200, {
        // The page shows words only: any fill-in meant for a text message is taken out.
        text: result.text.replace(FILL_INS, '').trim(),
        chat,
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
      const proposal = held.get(path[5])
      if (!proposal || proposal.organisationId !== org.id || proposal.visitor !== visitor)
        fail(404, 'This has expired. Ask again.')
      const decision = decide(proposal!, true, at)
      held.delete(path[5])
      if (decision.outcome !== 'approved') fail(404, 'This has expired. Ask again.')
      const effect = (decision as { effect: ReceptionEffect }).effect
      // A visit's link goes only by text to the number on the booking, never through this chat.
      if (effect.kind === 'manage') fail(404, 'This has expired. Ask again.')
      if (effect.kind === 'time') {
        // The page books it through its own steps: hold, details, policy and confirmation.
        reply(200, effect)
        return true
      }
      ctx.db.transaction(() => {
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
