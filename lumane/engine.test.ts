import { describe, expect, it, vi } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import {
  BrainError,
  actionSkill,
  check,
  decide,
  emptyUsage,
  readSkill,
  reclaim,
  record,
  remaining,
  reserve,
  runTurn,
  scriptedBrain,
  SkillRefusal,
  settle,
  talkWindowSeconds,
  voiceFor,
} from '.'
import type { Allowance, Brain, Skill, Usage, Voice } from '.'

type Ctx = { role: 'owner' | 'guest'; count: number }
const allowance: Allowance = {
  monthly: { typed: 3, talkSeconds: 600, guestChats: 2 },
  dailySpendCeilingMinor: 100,
  perPersonHourly: 2,
  maxTalkSessionSeconds: 300,
}
const at = '2026-10-07T09:00:00.000Z'
const skills: Skill<Ctx, { add: number }>[] = [
  readSkill<Ctx, Record<string, never>>({
    name: 'count',
    description: 'How many there are.',
    input: z.object({}).strict(),
    allowed: () => true,
    run: (ctx) => ({ count: ctx.count }),
  }),
  readSkill<Ctx, Record<string, never>>({
    name: 'secret',
    description: 'Owners only.',
    input: z.object({}).strict(),
    allowed: (ctx) => ctx.role === 'owner',
    run: () => 'owner data',
  }),
  actionSkill<Ctx, { add: number }, { add: number }>({
    name: 'add',
    description: 'Add some.',
    input: z.object({ add: z.number().int().positive() }).strict(),
    allowed: () => true,
    propose(_ctx, input) {
      if (input.add > 10) throw new SkillRefusal('Too many at once.')
      return { summary: `Add ${input.add}`, effect: { add: input.add } }
    },
  }),
]
const turn = (
  brain: Brain,
  overrides: Partial<{ usage: Usage; ctx: Ctx; worstCaseMinor: number }> = {},
) =>
  runTurn({
    brain,
    skills,
    ctx: overrides.ctx ?? { role: 'owner', count: 4 },
    instructions: 'Be brief.',
    history: [],
    text: 'How many?',
    meter: {
      allowance,
      usage: overrides.usage,
      personId: 'p1',
      at,
      kind: 'typed',
      worstCaseMinor: overrides.worstCaseMinor ?? 5,
    },
    newId: () => 'proposal-1',
  })

describe('Lumane engine', () => {
  it('runs a read skill and answers from its result', async () => {
    const brain = scriptedBrain((request, step) =>
      step === 0
        ? { calls: [{ id: 'c1', name: 'count', input: {} }], costMinor: 2 }
        : {
            text: `There are ${JSON.parse((request.messages.at(-1) as { result: string }).result).count}.`,
            calls: [],
            costMinor: 1,
          },
    )
    const result = await turn(brain)
    expect(result.status).toBe('answered')
    if (result.status !== 'answered') return
    expect(result.text).toBe('There are 4.')
    expect(result.costMinor).toBe(3)
    expect(result.usage.used.typed).toBe(1)
    expect(result.usage.spendByDay['2026-10-07']).toBe(3)
    expect(result.audit).toEqual([{ at, personId: 'p1', skill: 'count', outcome: 'answered' }])
  })

  it('turns an action into a proposal and does nothing else', async () => {
    const brain = scriptedBrain((_r, step) =>
      step === 0
        ? { calls: [{ id: 'c1', name: 'add', input: { add: 2 } }] }
        : { text: 'Ready for you to approve.', calls: [] },
    )
    const result = await turn(brain)
    if (result.status !== 'answered') throw new Error('expected an answer')
    expect(result.proposals).toEqual([
      {
        id: 'proposal-1',
        skill: 'add',
        summary: 'Add 2',
        effect: { add: 2 },
        proposedAt: at,
        expiresAt: '2026-10-07T09:30:00.000Z',
      },
    ])
    const toolResult = result.messages.find((m) => m.role === 'tool')
    expect(toolResult).toMatchObject({
      result: expect.stringContaining('Nothing has been done yet'),
    })
  })

  it('approves only fresh proposals', async () => {
    const proposal = {
      id: 'x',
      skill: 'add',
      summary: 'Add 2',
      effect: { add: 2 },
      proposedAt: at,
      expiresAt: '2026-10-07T09:30:00.000Z',
    }
    expect(decide(proposal, true, '2026-10-07T09:10:00.000Z')).toEqual({
      outcome: 'approved',
      effect: { add: 2 },
    })
    expect(decide(proposal, false, '2026-10-07T09:10:00.000Z')).toEqual({ outcome: 'declined' })
    expect(decide(proposal, true, '2026-10-07T09:31:00.000Z')).toEqual({ outcome: 'expired' })
  })

  it('reports refusals, invalid input, unknown and forbidden skills back to the brain', async () => {
    const brain = scriptedBrain((_r, step) =>
      step === 0
        ? {
            calls: [
              { id: 'a', name: 'add', input: { add: 50 } },
              { id: 'b', name: 'add', input: { add: 'two' } },
              { id: 'c', name: 'nope', input: {} },
              { id: 'd', name: 'secret', input: {} },
            ],
          }
        : { text: 'Done.', calls: [] },
    )
    const result = await turn(brain, { ctx: { role: 'guest', count: 1 } })
    if (result.status !== 'answered') throw new Error('expected an answer')
    expect(result.proposals).toEqual([])
    expect(result.audit.map((a) => a.outcome)).toEqual([
      'refused',
      'invalid',
      'unknown',
      'not-allowed',
    ])
    expect(
      result.messages.filter((m) => m.role === 'tool').every((m) => m.role === 'tool' && m.isError),
    ).toBe(true)
  })

  it('only offers the brain skills this person may use', async () => {
    let offered: string[] = []
    const brain = scriptedBrain((request) => {
      offered = request.tools.map((t) => t.name)
      return { text: 'Hello.', calls: [] }
    })
    await turn(brain, { ctx: { role: 'guest', count: 1 } })
    expect(offered).toEqual(['count', 'add'])
  })

  it('never calls the brain once the allowance, hourly limit or daily ceiling is reached', async () => {
    const respond = vi.fn()
    const brain: Brain = { name: 'spy', respond }
    let usage = emptyUsage(at)
    const request = { meter: 'typed' as const, amount: 1, personId: 'p1', at, worstCaseMinor: 1 }
    usage = record(usage, request, 1)
    usage = record(usage, { ...request, personId: 'p2' }, 1)
    usage = record(usage, { ...request, personId: 'p3' }, 1)
    expect(await turn(brain, { usage })).toMatchObject({ status: 'refused', reason: 'allowance' })

    const busy = record(record(emptyUsage(at), request, 1), request, 1)
    expect(await turn(brain, { usage: busy })).toMatchObject({ status: 'refused', reason: 'rate' })

    const spent = record(emptyUsage(at), { ...request, personId: 'p9' }, 98)
    expect(await turn(brain, { usage: spent, worstCaseMinor: 5 })).toMatchObject({
      status: 'refused',
      reason: 'spend',
    })
    expect(respond).not.toHaveBeenCalled()
  })

  it('stops a request that needs too many steps', async () => {
    const brain = scriptedBrain(() => ({
      calls: [{ id: 'c', name: 'count', input: {} }],
      costMinor: 1,
    }))
    const result = await turn(brain, { worstCaseMinor: 50 })
    if (result.status !== 'answered') throw new Error('expected an answer')
    expect(result.text).toMatch(/more steps/)
    expect(result.costMinor).toBe(6)
  })

  it('starts no further call that would take a request past its share', async () => {
    const brain = scriptedBrain(() => ({
      calls: [{ id: 'c', name: 'count', input: {} }],
      costMinor: 2,
    }))
    const result = await turn(brain, { worstCaseMinor: 5 })
    if (result.status !== 'answered') throw new Error('expected an answer')
    expect(result.text).toMatch(/more steps/)
    // 2, then 4: a third call costing 2 like the others would pass 5, so it does not start.
    expect(result.costMinor).toBe(4)
    // Calls grow as the conversation does: the costliest so far is the guide, not the first.
    let step = 0
    const growing = scriptedBrain(() => ({
      calls: [{ id: 'c', name: 'count', input: {} }],
      costMinor: [1, 3][step++] ?? 3,
    }))
    expect(await turn(growing, { worstCaseMinor: 5 })).toMatchObject({ costMinor: 4 })
  })

  it('starts no further call once a request has taken too long, and passes the facts on', async () => {
    let clock = 0
    const seen: (string | undefined)[] = []
    const brain = scriptedBrain((request) => {
      seen.push(request.context)
      clock += 15_000
      return { calls: [{ id: 'c', name: 'count', input: {} }] }
    })
    const result = await runTurn({
      brain,
      skills,
      ctx: { role: 'owner', count: 4 },
      instructions: 'Be brief.',
      context: 'Today is Wednesday 7 October.',
      history: [],
      text: 'How many?',
      meter: { allowance, usage: undefined, personId: 'p1', at, kind: 'typed', worstCaseMinor: 5 },
      timeLimitMs: 30_000,
      clock: () => clock,
    })
    expect(result).toMatchObject({ status: 'answered', text: expect.stringMatching(/more steps/) })
    expect(seen).toEqual(['Today is Wednesday 7 October.', 'Today is Wednesday 7 October.'])
  })

  it('ends as unavailable when the brain fails, without counting the request', async () => {
    const brain: Brain = {
      name: 'broken',
      respond: async () => {
        throw new BrainError('unreachable', 'Could not connect.', 3)
      },
    }
    const result = await turn(brain)
    expect(result).toMatchObject({
      status: 'unavailable',
      reason: 'unreachable',
      detail: 'Could not connect.',
      costMinor: 3,
    })
    if (result.status !== 'unavailable') throw new Error('expected unavailable')
    expect(result.usage.used.typed).toBe(0)
    expect(result.usage.spendByDay['2026-10-07']).toBe(3)
  })
})

describe('Lumane allowances', () => {
  const request = { meter: 'typed' as const, amount: 1, personId: 'p1', at, worstCaseMinor: 1 }

  it('starts each month from zero', () => {
    const october = record(emptyUsage(at), request, 10)
    expect(remaining(allowance, october, 'typed', at)).toBe(2)
    expect(remaining(allowance, october, 'typed', '2026-11-01T00:00:00.000Z')).toBe(3)
  })

  it('lets the hourly limit recover after an hour', () => {
    const busy = record(record(emptyUsage(at), request, 0), request, 0)
    expect(check(allowance, busy, request)).toMatchObject({ ok: false, reason: 'rate' })
    expect(check(allowance, busy, { ...request, at: '2026-10-07T10:00:01.000Z' })).toEqual({
      ok: true,
    })
  })

  it('holds a request’s share before the AI is asked, then settles it with what it cost', () => {
    const asked = { ...request, worstCaseMinor: 6 }
    const held = reserve(allowance, undefined, asked)
    if (!held.ok) throw new Error('expected the share to be held')
    expect(held.usage.used.typed).toBe(1)
    expect(held.usage.spendByDay['2026-10-07']).toBe(6)
    expect(held.usage.recent.p1).toEqual([at])
    // A second request at the same moment is checked against the share already held.
    expect(reserve(allowance, held.usage, { ...asked, personId: 'p2' })).toMatchObject({ ok: true })
    expect(reserve({ ...allowance, dailySpendCeilingMinor: 10 }, held.usage, asked)).toMatchObject({
      ok: false,
      reason: 'spend',
    })
    // Answered for 0.34: counted, and the 6 held becomes 0.34.
    expect(settle(held.usage, asked, { counted: true, costMinor: 0.34 })).toMatchObject({
      used: { typed: 1 },
      spendByDay: { '2026-10-07': 0.34 },
      recent: { p1: [at] },
    })
    // Not answered: the question is given back, what it cost is kept.
    expect(settle(held.usage, asked, { counted: false, costMinor: 1 })).toMatchObject({
      used: { typed: 0 },
      spendByDay: { '2026-10-07': 1 },
    })
    // Held in October and settled after November has begun: November is left alone.
    const november = emptyUsage('2026-11-01T00:00:00.000Z')
    expect(settle(november, asked, { counted: false, costMinor: 0 })).toBe(november)
  })

  it('gives back a hold never settled once its time has passed, keeping its worst case spent', () => {
    const asked = { ...request, worstCaseMinor: 6 }
    const held = reserve(allowance, undefined, asked)
    if (!held.ok) throw new Error('expected the share to be held')
    expect(held.usage.holds).toEqual([{ request: asked, until: '2026-10-07T09:05:00.000Z' }])
    // Settled normally, the hold goes.
    expect(settle(held.usage, asked, { counted: true, costMinor: 1 }).holds).toEqual([])
    // Within its five minutes nothing changes; after them, the question comes back.
    expect(reclaim(held.usage, '2026-10-07T09:04:59.000Z')).toBe(held.usage)
    const back = reclaim(held.usage, '2026-10-07T09:05:01.000Z')!
    expect(back).toMatchObject({ used: { typed: 0 }, spendByDay: { '2026-10-07': 6 }, holds: [] })
    // A request that finishes after all is counted once, at what it cost.
    expect(settle(back, asked, { counted: true, costMinor: 1 })).toMatchObject({
      used: { typed: 1 },
      spendByDay: { '2026-10-07': 1 },
    })
    expect(settle(back, asked, { counted: false, costMinor: 1 })).toMatchObject({
      used: { typed: 0 },
      spendByDay: { '2026-10-07': 1 },
    })
  })

  it('caps a talking session at the session limit or what is left', () => {
    expect(talkWindowSeconds(allowance, undefined, at)).toBe(300)
    const talked = record(emptyUsage(at), { ...request, meter: 'talkSeconds', amount: 450 }, 0)
    expect(talkWindowSeconds(allowance, talked, at)).toBe(150)
  })
})

describe('Lumane boundary', () => {
  it('imports nothing from the app that uses it', () => {
    const folder = join(process.cwd(), 'lumane')
    for (const file of readdirSync(folder).filter((f) => f.endsWith('.ts'))) {
      const source = readFileSync(join(folder, file), 'utf8')
      const imports = [...source.matchAll(/^(?:import .*|\}|export .*) from '([^']+)'/gm)].map(
        (m) => m[1],
      )
      for (const path of imports)
        expect(
          ['zod', 'vitest', '.'].includes(path) ||
            path.startsWith('./') ||
            path.startsWith('node:'),
          `${file} imports ${path}`,
        ).toBe(true)
    }
  })
})

describe('voices', () => {
  const list: Voice[] = [
    { key: 'a', label: 'A', supplier: 'openai', supplierVoice: 'a', accent: 'British' },
    { key: 'b', label: 'B', supplier: 'elevenlabs', supplierVoice: 'b1', accent: 'American' },
    { key: 'c', label: 'C', supplier: 'openai', supplierVoice: 'c', accent: 'British' },
  ]
  it('uses the default until the studio chooses', () => {
    expect(voiceFor(list, 'a', {}, { kind: 'guest' }).key).toBe('a')
    expect(voiceFor(list, 'a', { studio: 'b' }, { kind: 'guest' }).key).toBe('b')
  })
  it('lets each person choose their own voice, but guests always hear the studio voice', () => {
    const choices = { studio: 'b', people: { p1: 'c' } }
    expect(voiceFor(list, 'a', choices, { kind: 'person', personId: 'p1' }).key).toBe('c')
    expect(voiceFor(list, 'a', choices, { kind: 'person', personId: 'p2' }).key).toBe('b')
    expect(voiceFor(list, 'a', choices, { kind: 'guest' }).key).toBe('b')
  })
  it('falls back when a chosen voice leaves the list', () => {
    expect(voiceFor(list, 'a', { studio: 'gone' }, { kind: 'guest' }).key).toBe('a')
  })
})
