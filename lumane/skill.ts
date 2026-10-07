import type { z } from 'zod'

/**
 * A skill is one thing the assistant may do for the app it is plugged into. Lumane knows nothing
 * about salons, bookings or money: each app brings its own skills and decides who may use them.
 *
 * A `read` skill answers from the app's records and changes nothing. An `action` skill never acts
 * by itself: it returns a proposal, and the app carries out the proposal's effect only after a
 * person taps to approve it, through the app's own permission-checked path.
 */
export type Proposal<Effect = unknown> = {
  /** One plain sentence the person approves, such as "Move Amelia's facial to 3pm Thursday". */
  summary: string
  effect: Effect
}

type SkillBase<Ctx, Input> = {
  name: string
  /** What the skill does, written for the AI that chooses it. */
  description: string
  input: z.ZodType<Input>
  /** Whether this person may use the skill at all. Checked before every use. */
  allowed: (ctx: Ctx) => boolean
}

export type ReadSkill<Ctx, Input = unknown> = SkillBase<Ctx, Input> & {
  kind: 'read'
  run: (ctx: Ctx, input: Input) => unknown
}

export type ActionSkill<Ctx, Input = unknown, Effect = unknown> = SkillBase<Ctx, Input> & {
  kind: 'action'
  /** Check the request and describe it. Throw a `SkillRefusal` when it cannot be done. */
  propose: (ctx: Ctx, input: Input) => Proposal<Effect>
}

export type Skill<Ctx, Effect = unknown> = ReadSkill<Ctx, never> | ActionSkill<Ctx, never, Effect>

/** A refusal the assistant should explain in plain words, such as "that time is taken". */
export class SkillRefusal extends Error {}

export function readSkill<Ctx, Input>(
  skill: Omit<ReadSkill<Ctx, Input>, 'kind'>,
): Skill<Ctx, never> {
  return { ...skill, kind: 'read' } as unknown as Skill<Ctx, never>
}

export function actionSkill<Ctx, Input, Effect>(
  skill: Omit<ActionSkill<Ctx, Input, Effect>, 'kind'>,
) {
  return { ...skill, kind: 'action' } as unknown as Skill<Ctx, Effect>
}
