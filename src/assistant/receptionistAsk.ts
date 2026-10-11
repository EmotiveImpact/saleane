import { runTurn } from '../../lumane'
import type { Allowance, Brain, BrainMessage, TurnResult, Usage, UseRequest } from '../../lumane'
import type { BusinessState } from '../domain/model'
import { SALEANE_PACK } from './pack'
import {
  CHAT_HISTORY_TURNS,
  CHAT_TIME_LIMIT_MS,
  CHAT_WORST_CASE_MINOR,
  receptionContext,
  receptionFacts,
} from './receptionist'
import type { ReceptionEffect, ReceptionTurn } from './receptionist'
import { receptionistBrain } from './receptionistBrain'
import type { ReceptionChannel } from './receptionistBrain'
import { ALLOWANCES } from './saleane'
import { aiVoice } from './tone'

/**
 * What one guest message uses of the allowance, held before the AI is asked: a chat counts once,
 * at its first message.
 */
export const receptionUse = (visitorId: string, at: string, continuing: boolean) =>
  ({
    meter: SALEANE_PACK.audiences.guests.meter,
    amount: continuing ? 0 : 1,
    personId: visitorId,
    at,
    worstCaseMinor: CHAT_WORST_CASE_MINOR,
  }) satisfies UseRequest

export type ReceptionInput = {
  state: BusinessState
  today: string
  now: string
  /** Who is chatting: the visitor's own anonymous id, for the hourly limit. */
  visitorId: string
  text: string
  history?: ReceptionTurn[]
  /** The booking page's chat (the default) or a text to the studio's line. */
  channel?: ReceptionChannel
  /** True for a later message in a chat already counted against the month's guest chats. */
  continuing?: boolean
  /** The client writing, when the server matched the number they wrote from to their record. */
  guestId?: string
  usage: Usage | undefined
  allowance?: Allowance
  /** A real AI supplier's brain. Left out, the test-mode brain answers: free, and nothing leaves. */
  brain?: Brain
}

/**
 * One guest message to the receptionist, through the guests' side of SALEANE's pack. The server
 * passes a real AI's brain once the owner has given SALEANE its key; otherwise the test-mode brain
 * answers from the same skills, calling no AI supplier, costing nothing and sending nothing.
 */
export function askReceptionist(input: ReceptionInput): Promise<TurnResult<ReceptionEffect>> {
  const ctx = receptionContext(input.state, input.today, input.now, input.guestId)
  const guests = SALEANE_PACK.audiences.guests
  return runTurn({
    brain:
      input.brain ??
      receptionistBrain(
        ctx.today,
        input.state.organisation.locale,
        input.channel,
        aiVoice(input.state).tone,
      ),
    skills: guests.skills(),
    ctx,
    instructions: guests.instructions,
    context: receptionFacts(ctx, input.channel),
    timeLimitMs: CHAT_TIME_LIMIT_MS,
    history: (input.history ?? [])
      .slice(-CHAT_HISTORY_TURNS)
      .map((turn): BrainMessage =>
        turn.from === 'guest'
          ? { role: 'user', text: turn.text.slice(0, 1000) }
          : { role: 'assistant', text: turn.text.slice(0, 2000), calls: [] },
      ),
    text: input.text,
    meter: (({ meter, ...use }) => ({
      allowance: input.allowance ?? ALLOWANCES.included,
      usage: input.usage,
      kind: meter,
      ...use,
    }))(receptionUse(input.visitorId, input.now, !!input.continuing)),
  }) as Promise<TurnResult<ReceptionEffect>>
}
