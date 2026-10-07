import { describe, expect, it, vi } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import {
  actionSkill,
  check,
  decide,
  emptyUsage,
  readSkill,
  record,
  remaining,
  runTurn,
  scriptedBrain,
  SkillRefusal,
  talkWindowSeconds,
} from '.'
import type { Allowance, Brain, Skill, Usage } from '.'

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
    const result = await turn(brain)
    if (result.status !== 'answered') throw new Error('expected an answer')
    expect(result.text).toMatch(/more steps/)
    expect(result.costMinor).toBe(6)
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
