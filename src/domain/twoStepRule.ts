import { z } from 'zod'
import type { BusinessState } from './model'

/**
 * Stage 6: the owner's choice to ask everyone in the studio to use two-step sign-in. While it is
 * on, anyone in the studio who has not set two-step sign-in up is held at "Protect your account"
 * straight after signing in: the server refuses every studio request from them with
 * `TWO_STEP_REQUIRED` until they have (server/context.ts, `orgFor`). Only the owner changes it,
 * and only once their own two-step sign-in is on (server/twoStepRule.ts). Partner keys, guest
 * links and the booking page are not people signing in, so they are never held.
 */
export const twoStepRuleSchema = z.object({ forEveryone: z.boolean() }).strict()
export type TwoStepRule = z.infer<typeof twoStepRuleSchema>

export const twoStepRuleCommandSchemas = [
  z.object({ type: z.literal('two-step-rule'), forEveryone: z.boolean() }).strict(),
] as const

/** The short code a held person's refusal carries, so a page can take them to set it up. */
export const TWO_STEP_REQUIRED = 'two_step_required'

/** Whether this studio asks everyone in it to use two-step sign-in. */
export const twoStepForEveryone = (s: Pick<BusinessState, 'operations'>) =>
  !!s.operations?.twoStep?.forEveryone

/** What a held person is told, naming the studio that asks. */
export const twoStepHeldMessage = (studio: string) =>
  `${studio} asks everyone to use two-step sign-in. Set it up to open the studio.`

/** "Maya", "Maya and Theo" or "Maya, Theo and Ines". */
export const listNames = (names: readonly string[]) =>
  names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : (names[0] ?? '')

/** "Fernleaf Rooms asks" or "Fernleaf Rooms and Willow House ask". */
export const studiosAsking = (names: readonly string[]) =>
  `${listNames(names)} ${names.length > 1 ? 'ask' : 'asks'}`
