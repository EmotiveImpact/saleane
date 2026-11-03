import { randomBytes, randomUUID } from 'node:crypto'
import { callWindowSeconds, conversation, usedOf, voiceFor } from '../lumane'
import type { Conversation, LiveEvent, LiveLine, UseRequest } from '../lumane'
import { digest } from './auth'
import { fail } from './http'
import { holding, reserveFor, settleUse, storedUsage } from './aiUsage'
import { modelOf, recordTurn } from './assistantRecords'
import type { Context, Org, Route } from './context'
import { openaiWebhookGenuine } from './openaiWebhook'
import type { PhoneLine } from './phoneLine'
import { bookingLink } from './messaging/receptionistText'
import {
  CALL_FAILED,
  CALL_GRACE_SECONDS,
  CALL_PROGRESS,
  CALL_RING_SECONDS,
  CALL_UNHEARD,
  LONGEST_CALL_SECONDS,
  SHORTEST_CALL_SECONDS,
  callCost,
  callInstructions,
  callQuestionUse,
  callUse,
} from '../src/assistant/phone'
import { answersCalls } from '../src/assistant/receptionist'
import { askReceptionist } from '../src/assistant/receptionistAsk'
import type { ReceptionEffect, ReceptionTurn } from '../src/assistant/receptionist'
import { BOOKING_LINK, MANAGE_LINK_SPOT } from '../src/assistant/receptionistBrain'
import { DEFAULT_VOICE, VOICES } from '../src/assistant/voices'
import { dispatch } from '../src/domain/commands'
import { businessDate, operations } from '../src/domain/operations'
import { textNumber } from '../src/domain/reminders'
import {
  CALL_TEXTS_LIMIT,
  CALL_TEXT_LIMIT,
  CALL_TURN_LIMIT,
} from '../src/domain/answeredCallsSchema'
import type { CallTurn } from '../src/domain/answeredCallsSchema'

/** A call the phone line is handing to OpenAI, known by the one-off code it carries. */
type Pending = { organisationId: string; number?: string; until: number }

type Call = {
  /** OpenAI's id for the call, which never leaves the server. */
  sessionId: string
  organisationId: string
  /** The caller's number, from the phone line, or undefined when withheld. */
  number?: string
  /** The caller's place in the hourly limit and in the records: never their number itself. */
  visitor: string
  startedAt: number
  /** The longest it may run, in seconds. */
  window: number
  use: UseRequest
  talk: Conversation
  /** Called off as the call ends, so no further call to Claude is paid for. */
  ending: AbortController
  line?: LiveLine
  /** What OpenAI reported when the call ended, in seconds. */
  reported?: number
  endedAt?: number
  costMinor?: number
  timers: ReturnType<typeof setTimeout>[]
  closing: boolean
  reattached: boolean
  released: boolean
  /** Each time the receptionist texted the caller a link to book, as it described the time. */
  texted: string[]
  message?: { name: string; contact: string; message: string }
}

/** How long a code waits for OpenAI to say the call arrived. */
const PENDING_MS = (CALL_RING_SECONDS + 30) * 1000
/** Webhooks already handled, kept long enough to outlast OpenAI's own retries. */
const SEEN_MS = 24 * 60 * 60000
/** A finished call is kept this long in memory, for its late end report. */
const KEEP_ENDED_MS = 5 * 60_000

/** The one-off code's SIP header. Twilio sends `x-` headers on to the far end as they are. */
const CODE_HEADER = 'x-saleane-call'

const xml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * NEXT-17: the studio's calls answered by the AI receptionist. A call the desk misses is handed to
 * OpenAI with a one-off code; when OpenAI says it has the call, its minutes are held, it is
 * answered with the studio's voice and tone, and every question is answered by the receptionist
 * with Claude, as in the booking page's chat. SALEANE ends each call itself when its window is up
 * and counts it from what OpenAI reports, or its own clock when OpenAI goes quiet. As a call ends
 * it is written down for the desk with what was said, any booking link texted and any message.
 */
export function phoneCalls(line: PhoneLine | null, soon: () => void) {
  const pending = new Map<string, Pending>()
  const open = new Map<string, Call>()
  const seen = new Map<string, number>()
  /** Work under way for each webhook, so a test or a shutdown can wait for it. */
  const working = new Set<Promise<unknown>>()
  let stopped = false

  function sweep(ctx: Context) {
    const now = ctx.now()
    for (const [code, call] of pending) if (call.until < now) pending.delete(code)
    for (const [id, at] of seen) if (now - at > SEEN_MS) seen.delete(id)
    for (const [id, call] of open)
      if (call.endedAt !== undefined && now - call.endedAt > KEEP_ENDED_MS) open.delete(id)
  }

  /** Whether the studio has the AI answer its calls now, and can pay for at least a short one. */
  function ready(ctx: Context, org: Org) {
    if (!line || stopped || !ctx.voice.live || !ctx.voice.calls) return false
    if (operations(org.state).mode !== 'local' || !answersCalls(org.state)) return false
    if (!ctx.ai.brainFor(org.state, 'reception')) return false
    const at = new Date(ctx.now()).toISOString()
    const allowance = ctx.plans.allowance(org)
    return (
      callWindowSeconds(
        allowance,
        storedUsage(ctx, org.id),
        at,
        LONGEST_CALL_SECONDS,
        'phoneSeconds',
      ) >= SHORTEST_CALL_SECONDS
    )
  }

  /** Counts a call once, settles its minutes and writes it down for the desk. */
  function count(ctx: Context, call: Call) {
    if (call.endedAt !== undefined) return reconcile(ctx, call)
    call.endedAt = ctx.now()
    const price = ctx.voice.minorPerMinute
    const clock = Math.max(0, (call.endedAt - call.startedAt) / 1000)
    const seconds = Math.min(
      call.window + CALL_GRACE_SECONDS,
      call.reported ?? Math.max(call.talk.seconds, clock),
    )
    call.costMinor = callCost(seconds, price)
    ctx.db.transaction(() => {
      settleUse(ctx, call.organisationId, call.use, {
        counted: true,
        amount: Math.ceil(seconds),
        costMinor: call.costMinor!,
      })
      record(ctx, call, seconds)
    })
  }

  /** Adds to the day's spend what OpenAI's final report shows beyond what was counted. */
  function reconcile(ctx: Context, call: Call) {
    if (call.costMinor === undefined) return
    const seconds = Math.min(call.window + CALL_GRACE_SECONDS, call.reported ?? call.talk.seconds)
    const extra = callCost(seconds, ctx.voice.minorPerMinute) - call.costMinor
    if (extra <= 0) return
    call.costMinor += extra
    const cost = {
      ...call.use,
      amount: 0,
      at: new Date(ctx.now()).toISOString(),
      worstCaseMinor: 0,
    }
    ctx.db.transaction(() =>
      settleUse(ctx, call.organisationId, cost, { counted: false, costMinor: extra }),
    )
  }

  /** Writes the call down for the desk, with what was said on it. */
  function record(ctx: Context, call: Call, seconds: number) {
    const org = ctx.systemOrg(call.organisationId)
    if (!org) return
    const turns: CallTurn[] = []
    const say = (from: CallTurn['from'], text: string | undefined) => {
      const words = text?.trim().slice(0, CALL_TEXT_LIMIT)
      if (words) turns.push({ from, text: words })
    }
    for (const turn of call.talk.turns) {
      say('guest', turn.heard)
      say('receptionist', turn.answer)
    }
    const result = dispatch(
      org.state,
      {
        type: 'call-answered',
        ...(call.number ? { number: call.number } : {}),
        startedAt: new Date(call.startedAt).toISOString(),
        seconds: Math.round(seconds),
        // A long call keeps its last words, where it ended up.
        turns: turns.slice(-CALL_TURN_LIMIT),
        texted: call.texted,
        ...(call.message ? { message: call.message } : {}),
      },
      'Phone line',
      new Date(ctx.now()).toISOString(),
    )
    if (!result.ok) {
      console.error(`[SALEANE] An answered call could not be written down: ${result.error}`)
      return
    }
    try {
      ctx.persist(org, result.state, null, 'phone.answered', result.recordId)
    } catch (error) {
      // Read and saved in one transaction, so nothing can come between; should saving fail
      // anyway, the call stays counted and the failure is logged.
      console.error('[SALEANE] An answered call could not be written down.', error)
    }
  }

  /** Counts the call if it has not been, then stops following it. */
  function finish(ctx: Context, call: Call) {
    call.ending.abort()
    count(ctx, call)
    if (call.released) return
    call.released = true
    for (const timer of call.timers) clearTimeout(timer)
    call.line?.detach()
  }

  function later(call: Call, seconds: number, run: () => void) {
    const timer = setTimeout(run, seconds * 1000)
    timer.unref?.()
    call.timers.push(timer)
  }

  /**
   * Hangs the call up. Should OpenAI not confirm the end within the grace time, SALEANE stops
   * following it and counts it on its own clock.
   */
  function close(ctx: Context, call: Call) {
    if (call.released || call.closing) return
    call.closing = true
    call.talk.stop()
    call.ending.abort()
    later(call, CALL_GRACE_SECONDS, () => finish(ctx, call))
    ctx.voice.calls
      ?.hangup(call.sessionId)
      .catch((error: Error) =>
        console.error(`[SALEANE] A call could not be hung up: ${error.message}`),
      )
    try {
      call.line?.close()
    } catch {
      // The line has gone; the timer above still counts the call.
    }
  }

  function onEvent(ctx: Context, call: Call, event: LiveEvent) {
    if (call.endedAt === undefined || event.type === 'closed' || event.type === 'lost')
      call.talk.handle(event)
    if (event.type === 'usage' && event.seconds >= call.window) close(ctx, call)
    if (event.type === 'error') console.error(`[SALEANE] A call's voice reported: ${event.message}`)
    if (event.type === 'closed') {
      call.reported = event.seconds
      finish(ctx, call)
    }
    // SALEANE's line dropped while the call may still run: follow it again once, to end it.
    if (event.type === 'lost' && !call.released) {
      if (call.reattached) return finish(ctx, call)
      call.reattached = true
      ctx.voice
        .attach(call.sessionId, (next) => onEvent(ctx, call, next))
        .then((again) => {
          if (call.released) {
            try {
              again.close()
            } catch {
              // Nothing more can be done for a line that has gone.
            }
            again.detach()
            return
          }
          call.line = again
          call.talk.use(again)
          call.closing = false
          close(ctx, call)
        })
        .catch(() => finish(ctx, call))
    }
  }

  /**
   * One question on the call, answered by the receptionist as in the booking page's chat, with
   * the studio as it is now. A time it offers is texted to the caller as a link to book; a
   * message it prepares is kept with the call for the team.
   */
  async function think(
    ctx: Context,
    call: Call,
    heard: string,
    history: { from: 'you' | 'saleane'; text: string }[],
  ) {
    const org = ctx.systemOrg(call.organisationId)
    // Switched off mid-call: the caller is told so, and the call ends.
    if (!org || operations(org.state).mode !== 'local' || !answersCalls(org.state)) {
      close(ctx, call)
      return { text: CALL_FAILED }
    }
    const brain = ctx.ai.brainFor(org.state, 'reception')
    if (!brain) return { text: CALL_FAILED }
    const allowance = ctx.plans.allowance(org)
    const at = new Date(ctx.now()).toISOString()
    const use = callQuestionUse(call.visitor, at)
    const canText = !!call.number && call.texted.length < CALL_TEXTS_LIMIT
    const { held, result } = await holding(ctx, org.id, allowance, use, (before) =>
      askReceptionist({
        state: ctx.withHolds(org),
        today: businessDate(org.state, at),
        now: at,
        visitorId: call.visitor,
        text: heard.slice(0, 500),
        history: history.map((turn): ReceptionTurn => ({
          from: turn.from === 'you' ? 'guest' : 'receptionist',
          text: turn.text,
        })),
        channel: 'phone',
        continuing: true,
        canText,
        usage: before,
        allowance,
        brain,
        signal: call.ending.signal,
      }),
    )
    // SALEANE stopped while Claude answered: its records are closed, so nothing is written.
    if (stopped) return { text: CALL_FAILED }
    const model = modelOf(ctx, true)
    if (result.status === 'refused') {
      ctx.db.transaction(() => {
        if (held) settleUse(ctx, org.id, use, { counted: false, costMinor: 0 })
        recordTurn(ctx, org.id, 'guests', 'phone', null, model, result)
      })
      return { text: CALL_FAILED }
    }
    ctx.db.transaction(() => {
      settleUse(ctx, org.id, use, { counted: false, costMinor: result.costMinor })
      recordTurn(ctx, org.id, 'guests', 'phone', null, model, result)
    })
    if (result.status !== 'answered') {
      if (result.reason !== 'left')
        console.error(`[SALEANE] The receptionist could not answer a caller (${result.reason}).`)
      return { text: CALL_FAILED }
    }
    // The caller hung up while it was answered: nothing is texted for an offer they never heard.
    const going = call.endedAt !== undefined || call.closing
    for (const { effect, summary } of result.proposals) {
      if (effect.kind === 'message') call.message = { ...effect }
      if (effect.kind === 'time' && canText && !going && call.texted.length < CALL_TEXTS_LIMIT)
        if (textLink(ctx, org, call, effect, summary)) call.texted.push(summary.slice(0, 300))
    }
    // Fill-ins are for written answers; on a call, none is ever said.
    return {
      text: result.text.replaceAll(BOOKING_LINK, '').replaceAll(MANAGE_LINK_SPOT, '').trim(),
    }
  }

  /**
   * Texts the caller the booking page with the offered time chosen. It goes through the outbox like
   * any other text, so it is sent once and the inbox shows what became of it.
   */
  function textLink(ctx: Context, org: Org, call: Call, time: ReceptionEffect, summary: string) {
    const n = call.texted.length + 1
    const at = ctx.now()
    const body = `${org.state.organisation.name} AI receptionist: Here is the link to book ${summary}: ${bookingLink(ctx.allowedOrigin, org.slug, time, org.state)} Nothing is booked until you confirm on that page.`
    const inserted = ctx.db.run(
      `INSERT OR IGNORE INTO outbox(id,organisation_id,dedupe_key,appointment_id,client_id,kind,channel,slot,recipient,subject,body,status,next_attempt_at,created_at,updated_at)
       VALUES(?,?,?,'','','receptionist','sms',?,?,'',?,'pending',?,?,?)`,
      randomUUID(),
      org.id,
      `call:${call.sessionId}:${n}`,
      `call:${digest(call.sessionId).slice(0, 24)}:${n}`,
      call.number!,
      body,
      at,
      at,
      at,
    )
    if (Number(inserted.changes) !== 1) return false
    soon()
    return true
  }

  /** OpenAI has the call: hold its minutes, answer it and follow it, or turn it away. */
  async function arrived(ctx: Context, sessionId: string, code: string | undefined) {
    const calls = ctx.voice.calls!
    const turnAway = (status: number) =>
      calls
        .reject(sessionId, status)
        .catch((error: Error) =>
          console.error(`[SALEANE] A call could not be turned away: ${error.message}`),
        )
    const handed = code ? pending.get(code) : undefined
    if (code) pending.delete(code)
    // Not handed over by a studio's phone line just now: someone else dialled the address.
    if (!handed || handed.until < ctx.now()) return turnAway(603)
    const org = ctx.systemOrg(handed.organisationId)
    if (!org || !ready(ctx, org)) return turnAway(486)
    const visitor = digest(`phone:${org.id}:${handed.number ?? sessionId}`)
    const allowance = ctx.plans.allowance(org)
    const at = new Date(ctx.now()).toISOString()
    const price = ctx.voice.minorPerMinute
    const hold = reserveFor(
      ctx,
      org.id,
      allowance,
      (before) => {
        const seconds = Math.floor(
          callWindowSeconds(allowance, before, at, LONGEST_CALL_SECONDS, 'phoneSeconds'),
        )
        return seconds < SHORTEST_CALL_SECONDS ? 'used up' : callUse(visitor, at, seconds, price)
      },
      // Held for the whole call and its ending, with a minute to spare, should SALEANE stop
      // before counting it.
      (use) =>
        new Date(Date.parse(at) + (use.amount + CALL_GRACE_SECONDS + 60) * 1000).toISOString(),
    )
    if (!hold.held) return turnAway(486)
    const use = hold.request
    const giveBack = (costMinor: number) =>
      ctx.db.transaction(() => settleUse(ctx, org.id, use, { counted: false, costMinor }))
    try {
      // Guests hear the studio's voice, whoever is listening to Ask SALEANE.
      await calls.accept(sessionId, {
        instructions: callInstructions(org.state),
        voice: voiceFor(
          VOICES,
          DEFAULT_VOICE,
          { studio: operations(org.state).aiVoice?.voice },
          { kind: 'guest' },
        ).supplierVoice,
      })
    } catch (error) {
      if (stopped) return
      const reached = (error as { kind?: string }).kind === 'unreachable'
      giveBack(reached ? callCost(0, price) : 0)
      console.error(`[SALEANE] A call could not be answered: ${(error as Error).message}`)
      return
    }
    const call: Call = {
      sessionId,
      organisationId: org.id,
      ...(handed.number ? { number: handed.number } : {}),
      visitor,
      startedAt: ctx.now(),
      window: use.amount,
      use,
      ending: new AbortController(),
      timers: [],
      closing: false,
      reattached: false,
      released: false,
      texted: [],
      talk: conversation({
        progress: CALL_PROGRESS,
        unheard: CALL_UNHEARD,
        failed: CALL_FAILED,
        historyTurns: 4,
        think: (heard, history) => think(ctx, call, heard, history),
      }),
    }
    if (stopped) return
    try {
      call.line = await ctx.voice.attach(sessionId, (event) => onEvent(ctx, call, event))
    } catch (error) {
      if (stopped) return
      // Without its own line SALEANE could neither answer questions nor end the call.
      void calls.hangup(sessionId).catch(() => undefined)
      giveBack(callCost(0, price))
      console.error(`[SALEANE] A call could not be followed: ${(error as Error).message}`)
      return
    }
    if (stopped) {
      try {
        call.line.close()
      } catch {
        // The line has gone already.
      }
      call.line.detach()
      return
    }
    call.talk.use(call.line)
    open.set(sessionId, call)
    // SALEANE ends the call itself when its window is up, counted from when it was answered.
    later(call, call.window, () => close(ctx, call))
  }

  return {
    /** Whether the studio's calls can be answered now, for its settings. */
    ready,

    /**
     * The studio's phone line says the desk missed a call. When the AI can answer it, the TwiML
     * that hands the call to OpenAI, with a one-off code; otherwise undefined and the missed call
     * stands. The number comes from the phone line, whose request is signed.
     */
    divert(ctx: Context, slug: string, from: string, actionUrl: string) {
      if (!line) return undefined
      sweep(ctx)
      const row = ctx.db.get<{ id: string }>('SELECT id FROM organisations WHERE slug=?', slug)
      const org = row && ctx.systemOrg(row.id)
      if (!org || !ready(ctx, org)) return undefined
      const code = randomBytes(18).toString('base64url')
      const number = textNumber(from)
      pending.set(code, {
        organisationId: org.id,
        ...(number ? { number } : {}),
        until: ctx.now() + PENDING_MS,
      })
      const sip = `${line.sipUri};transport=tls;secure=true?${CODE_HEADER}=${code}`
      return `<?xml version="1.0" encoding="UTF-8"?><Response><Dial action="${xml(actionUrl)}" timeout="${CALL_RING_SECONDS}" answerOnBridge="true"><Sip>${xml(sip)}</Sip></Dial></Response>`
    },

    /**
     * OpenAI's webhook. Returns the status to answer with: 400 when it is not genuine. A call is
     * answered after OpenAI has been thanked, as OpenAI waits only briefly.
     */
    webhook(
      ctx: Context,
      headers: Record<string, string | string[] | undefined>,
      body: string,
    ): number {
      if (!line || !openaiWebhookGenuine(line.webhookSecret, headers, body, ctx.now())) return 400
      sweep(ctx)
      const id = String(headers['webhook-id'])
      if (seen.has(id)) return 200
      seen.set(id, ctx.now())
      let event: { type?: unknown; data?: Record<string, unknown> }
      try {
        event = JSON.parse(body) as typeof event
      } catch {
        return 400
      }
      const incoming =
        (event.type === 'live.transport.incoming' && event.data?.type === 'sip') ||
        event.type === 'live.call.incoming'
      const sessionId = event.data?.session_id
      if (!incoming || typeof sessionId !== 'string' || !sessionId || !ctx.voice.calls) return 200
      if (stopped) return 200
      // SIP headers come from the caller's side and prove nothing; the code only finds the call
      // the studio's own line handed over, once.
      const headersList = Array.isArray(event.data?.sip_headers) ? event.data.sip_headers : []
      const code = (headersList as { name?: unknown; value?: unknown }[]).find(
        (h) => typeof h.name === 'string' && h.name.toLowerCase() === CODE_HEADER,
      )?.value
      const work = arrived(ctx, sessionId, typeof code === 'string' ? code : undefined)
        .catch((error) => console.error('[SALEANE] A call could not be answered.', error))
        .finally(() => working.delete(work))
      working.add(work)
      return 200
    },

    /** Resolves once every call OpenAI has told SALEANE about has been answered or turned away. */
    settled: async () => {
      while (working.size) await Promise.all([...working])
    },

    /** The call in progress for OpenAI's id, for tests. */
    find: (sessionId: string) => open.get(sessionId),

    /**
     * SALEANE is stopping: every call is hung up, counted on SALEANE's own clock and written down,
     * before the database closes.
     */
    stopAll(ctx: Context) {
      stopped = true
      for (const call of open.values()) {
        if (call.released) continue
        call.talk.stop()
        void ctx.voice.calls?.hangup(call.sessionId).catch(() => undefined)
        try {
          call.line?.close()
        } catch {
          // The line has gone already.
        }
        finish(ctx, call)
      }
    },

    /**
     * For the studio's settings: whether calls can reach the AI on this server, whether its plan
     * has the phone receptionist (paid for, or chosen for the next bill), whether a call would be
     * answered now, and this month's minutes.
     */
    async routes(ctx: Context, route: Route) {
      const { request, method, path, reply } = route
      if (path[1] !== 'workspaces' || path[3] !== 'phone' || path.length !== 4) return false
      if (method !== 'GET') fail(405, 'Use GET.')
      const org = ctx.orgFor(path[2], ctx.actorFor(request, false))
      if (org.role === 'practitioner') fail(403, 'The phone line is not available for your role.')
      const at = new Date(ctx.now()).toISOString()
      const allowance = ctx.plans.allowance(org)
      const plan = ctx.db.get<{ phone_next: number }>(
        'SELECT phone_next FROM studio_plans WHERE organisation_id=?',
        org.id,
      )
      reply(200, {
        connected: !!line && ctx.voice.live && !!ctx.voice.calls && ctx.ai.live,
        included: allowance.monthly.phoneSeconds > 0,
        // Chosen in Plan and billing, though not yet paid for, as in a free trial.
        chosen: !!plan?.phone_next,
        answering: ready(ctx, org),
        minutes: {
          used: Math.ceil(usedOf(storedUsage(ctx, org.id), 'phoneSeconds', at) / 60),
          of: Math.floor(allowance.monthly.phoneSeconds / 60),
        },
      })
      return true
    },
  }
}

export type PhoneCalls = ReturnType<typeof phoneCalls>
