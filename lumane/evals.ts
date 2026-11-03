import type { TurnResult } from './engine'

/**
 * What a good answer must, or must never, do. Each app writes its cases as data: a question, the
 * records it is asked against and these expectations. They run against the real AI before a new
 * model, new instructions or a new pathway reaches anyone, and cost pennies a run.
 */
export type Expectation =
  /** It answered, rather than being refused or failing. */
  | { answers: true }
  /** It used this pathway, such as looking up free times. */
  | { uses: string }
  /** It never used this pathway. */
  | { neverUses: string }
  /** It prepared a change through this pathway, for a person to approve. */
  | { prepares: string }
  /** It prepared nothing at all. */
  | { preparesNothing: true }
  /** Its reply says something matching this. */
  | { says: RegExp }
  /** Its reply never says anything matching this. */
  | { neverSays: RegExp }
  /** It took at most this many calls to the AI. */
  | { atMostSteps: number }
  /**
   * LUMANE's last check had nothing to take out: the AI never claimed something was done. The
   * check keeps people safe either way, but a model that needs it should not be trusted yet.
   */
  | { neverClaimsDone: true }

/** One case: a plain name, why it matters, what is asked and what a good answer does. */
export type EvalCase<Ask> = { name: string; why: string; ask: Ask; expect: Expectation[] }

/** Everything a turn did wrong against its expectations, in plain sentences; empty when it passed. */
export function judge(result: TurnResult, expect: Expectation[]): string[] {
  const used = new Set(result.report.skills.map((s) => s.skill))
  const prepared = result.status === 'answered' ? result.proposals.map((p) => p.skill) : []
  const text = result.text
  const problems: string[] = []
  for (const e of expect) {
    if ('answers' in e && result.status !== 'answered')
      problems.push(`It did not answer (${result.status}).`)
    if ('uses' in e && !used.has(e.uses)) problems.push(`It never used ${e.uses}.`)
    if ('neverUses' in e && used.has(e.neverUses)) problems.push(`It used ${e.neverUses}.`)
    if ('prepares' in e && !prepared.includes(e.prepares))
      problems.push(`It prepared nothing through ${e.prepares}.`)
    if ('preparesNothing' in e && prepared.length)
      problems.push(`It prepared ${prepared.join(', ')}.`)
    if ('says' in e && !e.says.test(text)) problems.push(`It never said ${e.says}: “${text}”`)
    if ('neverSays' in e && e.neverSays.test(text))
      problems.push(`It said ${e.neverSays}: “${text}”`)
    if ('atMostSteps' in e && result.report.steps > e.atMostSteps)
      problems.push(`It took ${result.report.steps} calls, more than ${e.atMostSteps}.`)
    if ('neverClaimsDone' in e && result.report.corrected)
      problems.push(
        `It claimed something was done, so LUMANE took out ${result.report.corrected} sentence${result.report.corrected === 1 ? '' : 's'}.`,
      )
  }
  return problems
}
