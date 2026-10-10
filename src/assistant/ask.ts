import { runTurn } from '../../lumane'
import type { Allowance, Brain, BrainMessage, TurnResult, Usage, UseRequest } from '../../lumane'
import type { BusinessState } from '../domain/model'
import type { Role } from '../domain/operations'
import { ALLOWANCES, INSTRUCTIONS, askContext, askFacts, askSaleaneSkills } from './saleane'
import { testModeBrain } from './testBrain'

/**
 * What one typed request may cost with a real AI, in pence or cents: no further call to the AI
 * starts that would take a question past this, judged by its costliest call so far. Most cost 1 to 3; see docs/evidence/NEXT-12.
 */
export const TYPED_WORST_CASE_MINOR = 6
/** What one typed question uses of the allowance, held before the AI is asked. */
export const askUse = (personId: string, at: string) =>
  ({
    meter: 'typed',
    amount: 1,
    personId,
    at,
    worstCaseMinor: TYPED_WORST_CASE_MINOR,
  }) satisfies UseRequest
/** No further call to a real AI starts after this long, well inside the browser's wait. */
export const TURN_TIME_LIMIT_MS = 30_000
/**
 * How long the panel waits for an answer: the time limit, plus one last call and its one retry
 * (each given up after 20 seconds), with a little to spare.
 */
export const ASK_WAIT_MS = 80_000

export type AskInput = {
  state: BusinessState
  role: Role
  personId: string
  text: string
  usage: Usage | undefined
  /** When the request is made, as an ISO instant. */
  at: string
  allowance?: Allowance
  /** The conversation so far in this panel, oldest first, so follow-ups like "and tomorrow?" work. */
  history?: AskTurn[]
  /** A real AI supplier's brain. Left out, the test-mode brain answers: free, and nothing leaves. */
  brain?: Brain
}

/** One earlier line of the conversation, as the person saw it. */
export type AskTurn = { from: 'you' | 'saleane'; text: string }
/** How much of the conversation is sent with each question: enough for a follow-up, no more. */
export const HISTORY_TURNS = 6

/**
 * One typed request to Ask Saleane. The server passes a real AI's brain once the owner has given
 * SALEANE its key; otherwise, and always in the browser demo, the test-mode brain answers from the
 * same skills, costing nothing and calling no AI supplier.
 */
export function askSaleane(input: AskInput): Promise<TurnResult> {
  const ctx = askContext(input.state, input.role, input.at)
  return runTurn({
    brain: input.brain ?? testModeBrain(ctx.today, input.state.organisation.locale),
    skills: askSaleaneSkills(),
    ctx,
    instructions: INSTRUCTIONS,
    context: askFacts(ctx),
    timeLimitMs: TURN_TIME_LIMIT_MS,
    history: (input.history ?? [])
      .slice(-HISTORY_TURNS)
      .map((turn): BrainMessage =>
        turn.from === 'you'
          ? { role: 'user', text: turn.text.slice(0, 2000) }
          : { role: 'assistant', text: turn.text.slice(0, 2000), calls: [] },
      ),
    text: input.text,
    meter: (({ meter, ...use }) => ({
      allowance: input.allowance ?? ALLOWANCES.included,
      usage: input.usage,
      kind: meter,
      ...use,
    }))(askUse(input.personId, input.at)),
  })
}
