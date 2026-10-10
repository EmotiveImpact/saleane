import { randomUUID } from 'node:crypto'
import { conversation, talkWindowSeconds, voiceFor } from '../lumane'
import type { Allowance, Conversation, LiveEvent, LiveLine, PendingProposal } from '../lumane'
import type { UseRequest } from '../lumane'
import { askSaleane, HISTORY_TURNS } from '../src/assistant/ask'
import {
  SHORTEST_TALK_SECONDS,
  TALK_FAILED,
  TALK_GRACE_SECONDS,
  TALK_PROGRESS,
  TALK_UNHEARD,
  talkCost,
  talkInstructions,
  talkQuestionUse,
  talkUse,
} from '../src/assistant/talk'
import { DEFAULT_VOICE, VOICES } from '../src/assistant/voices'
import type { Command } from '../src/domain/commands'
import { holding, reserveFor, settleUse } from './aiUsage'
import type { Actor, Context, Org } from './context'

export type Held = PendingProposal<Command> & { organisationId: string; accountId: string }

type Talk = {
  id: string
  /** The supplier's own id for the session, which never leaves the server. */
  sessionId: string
  organisationId: string
  accountId: string
  /** When the talk started, in milliseconds. */
  startedAt: number
  /** The longest it may run, in seconds. */
  window: number
  use: UseRequest
  talk: Conversation
  line?: LiveLine
  /** What the supplier reported when the talk ended, in seconds. */
  reported?: number
  /** Set once the talk has been counted. */
  endedAt?: number
  reason?: string
  timers: ReturnType<typeof setTimeout>[]
  /** Set once SALEANE has asked the supplier to end the talk. */
  closing: boolean
  reattached: boolean
}

/** A finished talk is kept this long, so the panel can read how it ended. */
const KEEP_ENDED_MS = 5 * 60_000

const USED_UP =
  "This month's talking time is used up. It resets on the 1st, or the owner can add Plus. You can still type."
const NOT_NOW = 'Talking is not available just now. You can type your question instead.'

/**
 * NEXT-12 part 2: talks with Ask SALEANE. Each talk holds its whole window of minutes and its
 * longest cost before the voice starts, and is settled with what the supplier reports when it
 * ends. SALEANE ends every talk itself when its window is up, and stops counting on its own clock
 * if the supplier goes quiet. Every question is answered by the same Ask turn as a typed one, with
 * the person's own permissions, and any change it prepares waits on screen for approval.
 */
export function talks(held: Map<string, Held>) {
  const open = new Map<string, Talk>()

  function sweep(ctx: Context) {
    for (const [id, talk] of open)
      if (talk.endedAt !== undefined && ctx.now() - talk.endedAt > KEEP_ENDED_MS) open.delete(id)
  }

  /** Counts a talk once: the seconds the supplier reported, or SALEANE's own clock without them. */
  function finish(ctx: Context, talk: Talk, reason: string) {
    if (talk.endedAt !== undefined) return
    talk.endedAt = ctx.now()
    talk.reason = reason
    for (const timer of talk.timers) clearTimeout(timer)
    talk.line?.detach()
    const price = ctx.voice.minorPerMinute
    const clock = Math.max(0, (talk.endedAt - talk.startedAt) / 1000)
    const seconds = Math.min(
      talk.window + TALK_GRACE_SECONDS,
      talk.reported ?? Math.max(talk.talk.seconds, clock),
    )
    const org = ctx.systemOrg(talk.organisationId)
    ctx.db.transaction(() => {
      settleUse(ctx, talk.organisationId, talk.use, {
        counted: true,
        amount: Math.ceil(seconds),
        costMinor: talkCost(seconds, price),
      })
      if (org) ctx.audit(org, talk.accountId, 'assistant.talked', talk.id)
    })
  }

  function later(talk: Talk, seconds: number, run: () => void) {
    const timer = setTimeout(run, seconds * 1000)
    timer.unref?.()
    talk.timers.push(timer)
  }

  /**
   * Asks the supplier to end the talk. Should it not confirm within the grace time, SALEANE stops
   * following it and counts it on its own clock, so a talk stopped early is never counted as long.
   */
  function close(ctx: Context, talk: Talk) {
    if (talk.endedAt !== undefined || talk.closing) return
    talk.closing = true
    later(talk, TALK_GRACE_SECONDS, () => finish(ctx, talk, 'unconfirmed'))
    try {
      talk.line?.close()
    } catch {
      // The line has gone; the timer above still counts the talk.
    }
  }

  function onEvent(ctx: Context, talk: Talk, event: LiveEvent) {
    talk.talk.handle(event)
    if (event.type === 'usage' && event.seconds >= talk.window) close(ctx, talk)
    if (event.type === 'error') console.error(`[SALEANE] The voice reported: ${event.message}`)
    if (event.type === 'closed') {
      talk.reported = event.seconds
      finish(ctx, talk, event.reason)
    }
    // The server's line dropped while the talk may still run: follow it again once, to end it.
    if (event.type === 'lost' && talk.endedAt === undefined) {
      if (talk.reattached) return finish(ctx, talk, 'lost')
      talk.reattached = true
      ctx.voice
        .attach(talk.sessionId, (next) => onEvent(ctx, talk, next))
        .then((line) => {
          talk.line = line
          talk.talk.use(line)
          talk.closing = false
          close(ctx, talk)
        })
        .catch(() => finish(ctx, talk, 'lost'))
    }
  }

  return {
    /** Starts a talk for the browser's offer, or says plainly why not. */
    async start(
      ctx: Context,
      org: Org,
      actor: Actor,
      allowance: Allowance,
      sdp: string,
    ): Promise<
      | { status: 'talking'; id: string; sdp: string; seconds: number }
      | { status: 'refused' | 'unavailable'; text: string }
    > {
      sweep(ctx)
      // A new talk from the same person replaces one still open, which they have left.
      for (const talk of open.values())
        if (
          talk.accountId === actor.id &&
          talk.organisationId === org.id &&
          talk.endedAt === undefined
        )
          close(ctx, talk)
      const at = new Date(ctx.now()).toISOString()
      const price = ctx.voice.minorPerMinute
      const hold = reserveFor(
        ctx,
        org.id,
        allowance,
        (before) => {
          const seconds = Math.floor(talkWindowSeconds(allowance, before, at))
          return seconds < SHORTEST_TALK_SECONDS ? USED_UP : talkUse(actor.id, at, seconds, price)
        },
        // Held for the whole talk and its ending, with a minute to spare, should SALEANE stop
        // before counting it.
        (use) =>
          new Date(Date.parse(at) + (use.amount + TALK_GRACE_SECONDS + 60) * 1000).toISOString(),
      )
      if (!hold.held) return { status: 'refused', text: hold.text }
      const use = hold.request
      const giveBack = (costMinor: number) =>
        ctx.db.transaction(() => settleUse(ctx, org.id, use, { counted: false, costMinor }))

      let session: { id: string; sdp: string }
      try {
        session = await ctx.voice.start({
          sdp,
          instructions: talkInstructions(org.state),
          voice: voiceFor(VOICES, DEFAULT_VOICE, {}, { kind: 'person', personId: actor.id })
            .supplierVoice,
        })
      } catch (error) {
        // A refused start costs nothing; one that may have reached OpenAI counts its start-up time.
        const reached = (error as { kind?: string }).kind === 'unreachable'
        giveBack(reached ? talkCost(0, price) : 0)
        console.error(`[SALEANE] Talking could not start: ${(error as Error).message}`)
        return { status: 'unavailable', text: NOT_NOW }
      }

      const talk: Talk = {
        id: randomUUID(),
        sessionId: session.id,
        organisationId: org.id,
        accountId: actor.id,
        startedAt: ctx.now(),
        window: use.amount,
        use,
        timers: [],
        closing: false,
        reattached: false,
        talk: conversation({
          progress: TALK_PROGRESS,
          unheard: TALK_UNHEARD,
          failed: TALK_FAILED,
          historyTurns: HISTORY_TURNS / 2,
          think: async (heard, history) => {
            const thought = await answer(ctx, org.id, actor, heard, history)
            // Someone whose access was removed mid-talk is not answered, and the talk ends.
            if (!thought) {
              close(ctx, talk)
              return { text: TALK_FAILED }
            }
            return thought
          },
        }),
      }
      try {
        talk.line = await ctx.voice.attach(session.id, (event) => onEvent(ctx, talk, event))
      } catch (error) {
        // Without its own line SALEANE could not end the talk, so the browser is not let in.
        giveBack(talkCost(0, price))
        console.error(`[SALEANE] Talking could not be followed: ${(error as Error).message}`)
        return { status: 'unavailable', text: NOT_NOW }
      }
      talk.talk.use(talk.line)
      open.set(talk.id, talk)
      // SALEANE ends the talk itself when its window is up.
      later(talk, talk.window, () => close(ctx, talk))
      return { status: 'talking', id: talk.id, sdp: session.sdp, seconds: talk.window }
    },

    /** The person's own talk in this studio, or undefined. */
    find(ctx: Context, orgId: string, actor: Actor, id: string) {
      sweep(ctx)
      const talk = open.get(id)
      return talk && talk.organisationId === orgId && talk.accountId === actor.id ? talk : undefined
    },

    end(ctx: Context, talk: Talk) {
      close(ctx, talk)
    },

    /** What the panel shows: the time left, and each question with its answer and suggestions. */
    view(ctx: Context, talk: Talk) {
      const ended = talk.endedAt !== undefined
      const elapsed = ((talk.endedAt ?? ctx.now()) - talk.startedAt) / 1000
      return {
        id: talk.id,
        status: ended ? ('ended' as const) : ('talking' as const),
        secondsLeft: ended ? 0 : Math.max(0, Math.ceil(talk.window - elapsed)),
        turns: talk.talk.turns.map(({ id, heard, answer, proposals }) => ({
          id,
          heard,
          ...(answer === undefined ? {} : { answer }),
          proposals,
        })),
      }
    },
  }

  /**
   * One spoken question, answered as a typed one would be: the person's current access, the
   * studio's current records and allowance, its share held before Claude is asked. Only its cost
   * counts, as the talk is counted in minutes.
   */
  async function answer(
    ctx: Context,
    orgId: string,
    actor: Actor,
    heard: string,
    history: { from: 'you' | 'saleane'; text: string }[],
  ) {
    let org: Org
    try {
      org = ctx.orgFor(orgId, actor)
    } catch {
      return undefined
    }
    const brain = ctx.ai.brainFor(org.state, 'ask')
    if (!brain || org.role === 'practitioner') return { text: TALK_FAILED }
    const allowance = ctx.plans.allowance(org)
    const at = new Date(ctx.now()).toISOString()
    const use = talkQuestionUse(actor.id, at)
    const { held: reserved, result } = await holding(ctx, org.id, allowance, use, (before) =>
      askSaleane({
        state: org.state,
        role: org.role,
        personId: actor.id,
        text: heard.slice(0, 500),
        history,
        usage: before,
        at,
        allowance,
        brain,
        use,
        spoken: true,
      }),
    )
    if (result.status === 'refused') {
      if (reserved)
        ctx.db.transaction(() => settleUse(ctx, org.id, use, { counted: false, costMinor: 0 }))
      return { text: result.text }
    }
    const answered = result.status === 'answered'
    if (!answered)
      console.error(
        `[SALEANE] Ask SALEANE's AI could not answer a spoken question (${result.reason}).`,
      )
    ctx.db.transaction(() => {
      settleUse(ctx, org.id, use, { counted: answered, costMinor: result.costMinor })
      if (answered)
        for (const proposal of result.proposals)
          ctx.audit(org, actor.id, 'assistant.proposed', proposal.id)
    })
    if (!answered) return { text: result.text }
    for (const proposal of result.proposals)
      held.set(proposal.id, {
        ...(proposal as PendingProposal<Command>),
        organisationId: org.id,
        accountId: actor.id,
      })
    return {
      text: result.text,
      proposals: result.proposals.map(({ id, summary, expiresAt }) => ({ id, summary, expiresAt })),
    }
  }
}
