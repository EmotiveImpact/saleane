import { runTurn } from '../../lumane'
import type { Allowance, TurnResult, Usage } from '../../lumane'
import type { BusinessState } from '../domain/model'
import type { Role } from '../domain/operations'
import { ALLOWANCES, INSTRUCTIONS, askContext, askSaleaneSkills } from './saleane'
import { testModeBrain } from './testBrain'

/** The most one typed request could cost with a real AI, in pence or cents. */
export const TYPED_WORST_CASE_MINOR = 4

export type AskInput = {
  state: BusinessState
  role: Role
  personId: string
  text: string
  usage: Usage | undefined
  /** When the request is made, as an ISO instant. */
  at: string
  allowance?: Allowance
}

/**
 * One typed request to Ask Saleane. Only the test-mode brain exists so far: it costs nothing and
 * calls no AI supplier. The server and the browser demo both use this, so they behave the same.
 */
export function askSaleane(input: AskInput): Promise<TurnResult> {
  const ctx = askContext(input.state, input.role, input.at)
  return runTurn({
    brain: testModeBrain(ctx.today, input.state.organisation.locale),
    skills: askSaleaneSkills(),
    ctx,
    instructions: INSTRUCTIONS,
    history: [],
    text: input.text,
    meter: {
      allowance: input.allowance ?? ALLOWANCES.included,
      usage: input.usage,
      personId: input.personId,
      at: input.at,
      kind: 'typed',
      worstCaseMinor: TYPED_WORST_CASE_MINOR,
    },
  })
}
