import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { REPLY_NOTES, actionSkill, checkReply, judge, readSkill, runTurn, scriptedBrain } from '.'
import type { Allowance, Brain, Skill, TurnInput } from '.'

// LUMANE's hardening: the last check on every reply, what a turn reports, and a person leaving.
type Ctx = { count: number }
const allowance: Allowance = {
  monthly: { questions: 10 },
  dailySpendCeilingMinor: 100,
  monthlySpendCeilingMinor: 300,
  perPersonHourly: 5,
  maxTalkSessionSeconds: 300,
}
const at = '2026-10-07T09:00:00.000Z'
const skills: Skill<Ctx, { move: string }>[] = [
  readSkill<Ctx, Record<string, never>>({
    name: 'count',
    description: 'How many there are.',
    input: z.object({}).strict(),
    allowed: () => true,
    run: (ctx) => ({ count: ctx.count }),
  }),
  actionSkill<Ctx, { to: string }, { move: string }>({
    name: 'move',
    description: 'Move the meeting.',
    input: z.object({ to: z.string() }).strict(),
    allowed: () => true,
    propose: (_ctx, input) => ({ summary: `Move to ${input.to}`, effect: { move: input.to } }),
  }),
]
const turn = (brain: Brain, more: Partial<TurnInput<Ctx>> = {}) =>
  runTurn({
    brain,
    skills,
    ctx: { count: 4 },
    instructions: '',
    history: [],
    text: 'Move it to Friday.',
    meter: {
      allowance,
      usage: undefined,
      personId: 'p1',
      at,
      kind: 'questions',
      worstCaseMinor: 10,
    },
    newId: () => 'proposal-1',
    ...more,
  })
/** A brain that prepares a move, then replies with `text`. */
const moving = (text: string) =>
  scriptedBrain((_r, step) =>
    step === 0
      ? { calls: [{ id: 'c1', name: 'move', input: { to: 'Friday' } }] }
      : { text, calls: [] },
  )

describe('LUMANE’s last check on each reply', () => {
  it('takes out a claim that something was done, and says it waits for approval', async () => {
    const result = await turn(moving("Done! I've moved the review to Friday at 14:00."))
    if (result.status !== 'answered') throw new Error('expected an answer')
    expect(result.text).toBe(REPLY_NOTES.prepared)
    expect(result.proposals).toHaveLength(1)
    expect(result.report.corrected).toBe(2)
  })

  it('keeps every other sentence exactly as written', async () => {
    const result = await turn(
      moving(
        'Friday at 14:00 suits all five.\nEveryone has been sent the new time.\nShall I tell them?',
      ),
    )
    if (result.status !== 'answered') throw new Error('expected an answer')
    expect(result.text).toBe(
      `Friday at 14:00 suits all five.\nShall I tell them? ${REPLY_NOTES.prepared}`,
    )
  })

  it('leaves an honest reply alone, and so does a sentence about the approval itself', () => {
    for (const honest of [
      'Friday at 14:00 is free. Here is the move, ready for you to approve.',
      'Once you approve, I will have moved it to Friday.',
      'If I moved it to Friday, everyone could come.',
      'I have not moved anything.',
      "I've added up this week's meetings: there are 12.",
      'Nothing is booked until you confirm on that page.',
      'No one has been told yet.',
    ])
      expect(checkReply(honest, true)).toEqual({ text: honest, corrected: 0 })
  })

  it('reads the records as facts unless the turn prepared something', () => {
    const fact = 'The review has been moved to Friday. We sent the invitations on Monday.'
    expect(checkReply(fact, false).corrected).toBe(0)
    expect(checkReply(fact, true).corrected).toBe(2)
    expect(checkReply('You’re booked in for Friday at 10:00.', false).corrected).toBe(0)
    expect(checkReply('You’re booked in for Friday at 10:00.', true).corrected).toBe(1)
  })

  it('never lets the assistant say it acted, even with nothing prepared', () => {
    expect(checkReply('I cancelled it for you. Anything else?', false)).toEqual({
      text: `Anything else? ${REPLY_NOTES.unprepared}`,
      corrected: 1,
    })
    expect(checkReply("That's done.", false).text).toBe(REPLY_NOTES.unprepared)
  })

  it('takes the app’s own claims and words', async () => {
    const result = await turn(moving('I’ve refunded the deposit.'), {
      reply: {
        claims: [/\bI(?:['’]ve|\s+have)?\s+refunded\b/i],
        notes: { prepared: 'Nothing happens until you choose it.' },
      },
    })
    if (result.status !== 'answered') throw new Error('expected an answer')
    expect(result.text).toBe('Nothing happens until you choose it.')
  })
})

describe('What a turn reports, without its words', () => {
  it('counts the calls to the AI, the pathways used and why it ended', async () => {
    let clock = 1_000
    const brain = scriptedBrain((_r, step) => {
      clock += 400
      return step === 0
        ? { calls: [{ id: 'c1', name: 'count', input: {} }], costMinor: 1 }
        : { text: 'There are 4.', calls: [], costMinor: 1 }
    })
    const result = await turn(brain, { clock: () => clock })
    expect(result).toMatchObject({
      status: 'answered',
      report: {
        steps: 2,
        ended: 'answered',
        ms: 800,
        corrected: 0,
        skills: [{ skill: 'count', outcome: 'answered' }],
      },
    })
    expect(JSON.stringify(result.report)).not.toMatch(/There are|Friday/)
  })

  it('says when a turn ran out of steps or was refused before reaching the AI', async () => {
    const looping = scriptedBrain(() => ({ calls: [{ id: 'c', name: 'count', input: {} }] }))
    expect(await turn(looping, { maxSteps: 2 })).toMatchObject({
      report: { steps: 2, ended: 'steps' },
    })
    const refused = await turn(looping, {
      meter: {
        allowance: { ...allowance, monthly: { questions: 0 } },
        usage: undefined,
        personId: 'p1',
        at,
        kind: 'questions',
        worstCaseMinor: 10,
      },
    })
    expect(refused).toMatchObject({ status: 'refused', report: { steps: 0, ended: 'refused' } })
  })
})

describe('A person leaving', () => {
  it('starts no call once they have gone, and counts nothing', async () => {
    const left = new AbortController()
    left.abort()
    let called = 0
    const brain = scriptedBrain(() => {
      called++
      return { text: 'Hello.', calls: [] }
    })
    const result = await turn(brain, { signal: left.signal })
    expect(called).toBe(0)
    expect(result).toMatchObject({
      status: 'unavailable',
      reason: 'left',
      costMinor: 0,
      report: { steps: 0, ended: 'left' },
    })
    if (result.status === 'unavailable') expect(result.usage.used.questions ?? 0).toBe(0)
  })

  it('stops paying for calls when they leave part way, and keeps nothing it prepared', async () => {
    const left = new AbortController()
    const brain = scriptedBrain((_r, step) => {
      if (step === 0) {
        left.abort()
        return { calls: [{ id: 'c1', name: 'move', input: { to: 'Friday' } }], costMinor: 2 }
      }
      return { text: 'Ready.', calls: [], costMinor: 2 }
    })
    const result = await turn(brain, { signal: left.signal })
    expect(result).toMatchObject({
      status: 'unavailable',
      reason: 'left',
      costMinor: 2,
      report: { steps: 1, ended: 'left' },
    })
    expect('proposals' in result).toBe(false)
    if (result.status === 'unavailable') expect(result.usage.spendByDay['2026-10-07']).toBe(2)
  })
})

describe('Judging an answer against what a good one does', () => {
  it('passes a turn that does what was expected, and names each miss in a plain sentence', async () => {
    const result = await turn(moving('Friday at 14:00 is free. Here it is to approve.'))
    expect(
      judge(result, [
        { answers: true },
        { prepares: 'move' },
        { neverUses: 'count' },
        { says: /14:00/ },
        { neverSays: /done/i },
        { atMostSteps: 2 },
        { neverClaimsDone: true },
      ]),
    ).toEqual([])
    const claimed = await turn(moving("I've moved it."))
    expect(
      judge(claimed, [{ uses: 'count' }, { preparesNothing: true }, { neverClaimsDone: true }]),
    ).toEqual([
      'It never used count.',
      'It prepared move.',
      'It claimed something was done, so LUMANE took out 1 sentence.',
    ])
  })
})
