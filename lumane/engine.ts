import { z } from 'zod'
import { check, record } from './allowance'
import type { Allowance, Meter, Usage } from './allowance'
import type { Brain, BrainMessage, ToolSpec } from './brain'
import { SkillRefusal } from './skill'
import type { Proposal, Skill } from './skill'

export type PendingProposal<Effect = unknown> = Proposal<Effect> & {
  id: string
  skill: string
  proposedAt: string
  /** After this instant the proposal is stale and must be asked for again. */
  expiresAt: string
}

export type AuditEntry = {
  at: string
  personId: string
  skill: string
  outcome: 'answered' | 'proposed' | 'refused' | 'not-allowed' | 'invalid' | 'unknown'
  detail?: string
}

export type TurnInput<Ctx> = {
  brain: Brain
  skills: Skill<Ctx>[]
  ctx: Ctx
  /** The app's standing instructions: its voice, its rules, what it must never claim. */
  instructions: string
  history: BrainMessage[]
  text: string
  meter: {
    allowance: Allowance
    usage: Usage | undefined
    personId: string
    at: string
    kind: Exclude<Meter, 'talkSeconds'>
    /** The most this turn could cost, in minor units, checked against the daily ceiling. */
    worstCaseMinor: number
  }
  /** The most skill rounds one request may take, so a single request cannot run away. */
  maxSteps?: number
  /** Minutes before a proposal goes stale. */
  proposalMinutes?: number
  newId?: () => string
}

export type TurnResult<Effect = unknown> =
  | {
      status: 'refused'
      reason: 'allowance' | 'rate' | 'spend'
      text: string
      usage: Usage | undefined
    }
  | {
      status: 'answered'
      text: string
      proposals: PendingProposal<Effect>[]
      messages: BrainMessage[]
      usage: Usage
      costMinor: number
      audit: AuditEntry[]
    }

export function toolSpecs<Ctx>(skills: Skill<Ctx>[], ctx: Ctx): ToolSpec[] {
  return skills
    .filter((skill) => skill.allowed(ctx))
    .map((skill) => ({
      name: skill.name,
      description:
        skill.kind === 'action'
          ? `${skill.description} This only proposes the change; a person must approve it.`
          : skill.description,
      inputSchema: z.toJSONSchema(skill.input as z.ZodType) as Record<string, unknown>,
    }))
}

const STOPPED = 'I stopped there because that request needed more steps than I can take at once.'

/**
 * One request to the assistant. The allowance is checked first, so a refused request never
 * reaches the AI supplier. Read skills run straight away; action skills only produce proposals,
 * which the app carries out after a person approves them.
 */
export async function runTurn<Ctx>(input: TurnInput<Ctx>): Promise<TurnResult> {
  const { meter } = input
  const request = {
    meter: meter.kind,
    amount: 1,
    personId: meter.personId,
    at: meter.at,
    worstCaseMinor: meter.worstCaseMinor,
  }
  const allowed = check(meter.allowance, meter.usage, request)
  if (!allowed.ok)
    return { status: 'refused', reason: allowed.reason, text: allowed.message, usage: meter.usage }

  const newId = input.newId ?? (() => crypto.randomUUID())
  const expiresAt = new Date(
    Date.parse(meter.at) + (input.proposalMinutes ?? 30) * 60_000,
  ).toISOString()
  const tools = toolSpecs(input.skills, input.ctx)
  const messages: BrainMessage[] = [...input.history, { role: 'user', text: input.text }]
  const proposals: PendingProposal[] = []
  const audit: AuditEntry[] = []
  let costMinor = 0
  let text = STOPPED

  for (let step = 0; step < (input.maxSteps ?? 6); step++) {
    const reply = await input.brain.respond({ instructions: input.instructions, messages, tools })
    costMinor += reply.costMinor
    messages.push({ role: 'assistant', text: reply.text, calls: reply.calls })
    if (!reply.calls.length) {
      text = reply.text?.trim() || 'Sorry, I have no answer for that.'
      break
    }
    for (const call of reply.calls) {
      const outcome = useSkill(input, call.name, call.input, newId, expiresAt)
      audit.push({ at: meter.at, personId: meter.personId, skill: call.name, ...outcome.audit })
      if (outcome.proposal) proposals.push(outcome.proposal)
      messages.push({
        role: 'tool',
        callId: call.id,
        result: outcome.result,
        isError: outcome.isError || undefined,
      })
    }
  }

  return {
    status: 'answered',
    text,
    proposals,
    messages,
    usage: record(meter.usage, request, costMinor),
    costMinor,
    audit,
  }
}

function useSkill<Ctx>(
  input: TurnInput<Ctx>,
  name: string,
  raw: unknown,
  newId: () => string,
  expiresAt: string,
): {
  result: string
  isError?: boolean
  proposal?: PendingProposal
  audit: Pick<AuditEntry, 'outcome' | 'detail'>
} {
  const skill = input.skills.find((s) => s.name === name)
  if (!skill)
    return {
      result: `There is no skill called ${name}.`,
      isError: true,
      audit: { outcome: 'unknown' },
    }
  if (!skill.allowed(input.ctx))
    return {
      result: 'This person may not use that skill.',
      isError: true,
      audit: { outcome: 'not-allowed' },
    }
  const parsed = (skill.input as z.ZodType).safeParse(raw)
  if (!parsed.success)
    return {
      result: `The request was not valid: ${z.prettifyError(parsed.error)}`,
      isError: true,
      audit: { outcome: 'invalid' },
    }
  try {
    if (skill.kind === 'read') {
      const answer = skill.run(input.ctx, parsed.data as never)
      return { result: JSON.stringify(answer), audit: { outcome: 'answered' } }
    }
    const proposal = skill.propose(input.ctx, parsed.data as never)
    const pending: PendingProposal = {
      ...proposal,
      id: newId(),
      skill: skill.name,
      proposedAt: input.meter.at,
      expiresAt,
    }
    return {
      result: JSON.stringify({
        proposalId: pending.id,
        summary: pending.summary,
        status: 'Waiting for a person to approve. Nothing has been done yet.',
      }),
      proposal: pending,
      audit: { outcome: 'proposed', detail: pending.summary },
    }
  } catch (error) {
    if (error instanceof SkillRefusal)
      return {
        result: error.message,
        isError: true,
        audit: { outcome: 'refused', detail: error.message },
      }
    throw error
  }
}

/**
 * Decide a proposal. Approving returns the effect for the app to carry out through its own
 * permission checks; a stale proposal is never carried out.
 */
export function decide<Effect>(
  proposal: PendingProposal<Effect>,
  approve: boolean,
  at: string,
): { outcome: 'approved'; effect: Effect } | { outcome: 'declined' | 'expired' } {
  if (Date.parse(at) > Date.parse(proposal.expiresAt)) return { outcome: 'expired' }
  return approve ? { outcome: 'approved', effect: proposal.effect } : { outcome: 'declined' }
}
