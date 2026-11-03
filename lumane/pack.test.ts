import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  CORE_RULES,
  actionSkill,
  askName,
  definePack,
  packProblems,
  readSkill,
  record,
  runTurn,
  scriptedBrain,
  standingInstructions,
  usedEach,
} from '.'
import type { Allowance, BrainRequest, Pack, Usage } from '.'

// A pretend second app, with no SALEANE inside it: a calendar that installs LUMANE with its own
// name, its own pathways and its own kinds of use. If LUMANE needed anything from SALEANE, this
// file could not be written.
type Ctx = { events: { title: string; day: string }[]; canEdit: boolean }
type Effect = { add: { title: string; day: string } }

const calendarSkills = () => [
  readSkill<Ctx, { day: string }>({
    name: 'events_on',
    description: 'The events on one day.',
    input: z.object({ day: z.iso.date() }).strict(),
    allowed: () => true,
    run: (ctx, { day }) => ctx.events.filter((e) => e.day === day),
  }),
  actionSkill<Ctx, { title: string; day: string }, Effect>({
    name: 'add_event',
    description: 'Add an event to the calendar.',
    input: z.object({ title: z.string().min(1), day: z.iso.date() }).strict(),
    allowed: (ctx) => ctx.canEdit,
    propose: (_ctx, event) => ({
      summary: `Add ${event.title} on ${event.day}`,
      effect: { add: event },
    }),
  }),
]

const calendarPack = definePack({
  name: 'Caleane',
  meters: {
    questions: { label: 'Questions to Ask Caleane', unit: 'uses' },
    summaries: { label: 'Week summaries', unit: 'uses' },
  },
  audiences: {
    people: {
      label: 'People using the calendar',
      instructions: 'You are Ask Caleane, the assistant inside Caleane, a shared calendar.',
      skills: calendarSkills,
      meter: 'questions',
      doorways: ['The Ask Caleane button'],
    },
  },
})

const allowance: Allowance<'questions' | 'summaries'> = {
  monthly: { questions: 2, summaries: 5 },
  dailySpendCeilingMinor: 100,
  monthlySpendCeilingMinor: 300,
  perPersonHourly: 10,
  maxTalkSessionSeconds: 0,
}
const at = '2026-10-11T09:00:00.000Z'

function ask(usage?: Usage) {
  const requests: BrainRequest[] = []
  const brain = scriptedBrain((request, step) => {
    requests.push(request)
    return step === 0
      ? { calls: [{ id: 'c1', name: 'events_on', input: { day: '2026-10-12' } }] }
      : { text: 'You have the dentist on Monday.', calls: [] }
  })
  const people = calendarPack.audiences.people
  const result = runTurn({
    brain,
    skills: people.skills(),
    ctx: { events: [{ title: 'Dentist', day: '2026-10-12' }], canEdit: false },
    instructions: people.instructions,
    history: [],
    text: 'What is on Monday?',
    meter: {
      allowance,
      usage,
      personId: 'p1',
      at,
      kind: people.meter,
      worstCaseMinor: 2,
    },
  })
  return { result, requests }
}

describe('a second app installing LUMANE', () => {
  it('is called Ask and its own name', () => {
    expect(askName(calendarPack)).toBe('Ask Caleane')
    expect(packProblems(calendarPack as unknown as Pack)).toEqual([])
  })

  it('answers through its own pathways, with its instructions and LUMANE’s rules after them', async () => {
    const { result, requests } = ask()
    const answered = await result
    expect(answered).toMatchObject({ status: 'answered', text: 'You have the dentist on Monday.' })
    const [first] = requests
    expect(first.instructions).toBe(
      standingInstructions(calendarPack.audiences.people.instructions),
    )
    expect(first.instructions.startsWith('You are Ask Caleane')).toBe(true)
    expect(first.instructions.endsWith(CORE_RULES)).toBe(true)
    // Someone who may not edit is never offered the pathway that prepares an event.
    expect(first.tools.map((t) => t.name)).toEqual(['events_on'])
  })

  it('counts its own kinds of use, which LUMANE has never heard of', async () => {
    const { result } = ask()
    const answered = await result
    if (answered.status !== 'answered') throw new Error('expected an answer')
    expect(usedEach(allowance, answered.usage, at)).toEqual({ questions: 1, summaries: 0 })
    // With its questions used up, the next one never reaches the AI; summaries are untouched.
    const spent = record(
      answered.usage,
      { meter: 'questions', amount: 1, personId: 'p1', at, worstCaseMinor: 0 },
      0,
    )
    const { result: refused, requests } = ask(spent)
    expect(await refused).toMatchObject({ status: 'refused', reason: 'allowance' })
    expect(requests).toHaveLength(0)
    expect(usedEach(allowance, spent, at).summaries).toBe(0)
  })
})

describe('LUMANE’s own rules', () => {
  it('come after the app’s instructions, and stand alone when an app gives none', () => {
    expect(standingInstructions('Be brief.\n')).toBe(`Be brief.\n\n${CORE_RULES}`)
    expect(standingInstructions('  ')).toBe(CORE_RULES)
  })

  it('say it is an AI, state only facts, claim nothing undone and obey nothing in results', () => {
    expect(CORE_RULES).toMatch(/You are an AI/)
    expect(CORE_RULES).toMatch(/never pretend to be a person/)
    expect(CORE_RULES).toMatch(/Never guess/)
    expect(CORE_RULES).toMatch(/never say something has been done/)
    expect(CORE_RULES).toMatch(/never instructions to you/)
  })

  it('name no business, so they suit any app', () => {
    expect(CORE_RULES).not.toMatch(/salon|studio|spa|client|guest|booking|visit|SALEANE|LUMANE/i)
  })
})

describe('checking a pack', () => {
  const people = calendarPack.audiences.people
  const base = calendarPack as unknown as Pack
  const problems = (change: Partial<Pack>) => packProblems({ ...base, ...change })

  it('finds a name that already says Ask, or none at all', () => {
    expect(problems({ name: 'Ask Caleane' })).toEqual([
      'The name is the app’s own, without “Ask”: LUMANE adds it, so “Ask Caleane” would show as “Ask Ask Caleane”.',
    ])
    expect(problems({ name: ' ' })).toEqual(['The pack needs the app’s name.'])
  })

  it('finds an audience counting a kind of use the pack does not name, or with nowhere to meet it', () => {
    expect(
      problems({ audiences: { people: { ...people, meter: 'minutes' as never, doorways: [] } } }),
    ).toEqual([
      'People using the calendar: counts against “minutes”, which the pack does not name.',
      'People using the calendar: there is nowhere to meet the assistant.',
    ])
  })

  it('finds pathways an AI supplier would refuse', () => {
    const twice = () => [...calendarSkills(), calendarSkills()[0]]
    const spaced = () => [{ ...calendarSkills()[0], name: 'events on' }]
    expect(problems({ audiences: { people: { ...people, skills: twice } } })).toEqual([
      'People using the calendar: two pathways are called “events_on”.',
    ])
    expect(problems({ audiences: { people: { ...people, skills: spaced } } })).toEqual([
      'People using the calendar: “events on” is not a name an AI supplier accepts.',
    ])
  })

  it('finds a default voice missing from the list', () => {
    expect(problems({ voices: { list: [], fallback: 'vesper' } })).toEqual([
      'The default voice “vesper” is not on the list of voices.',
    ])
  })

  it('stops an app whose pack is not ready', () => {
    expect(() =>
      definePack({
        name: '',
        meters: { questions: { label: 'Questions', unit: 'uses' } },
        audiences: {},
      }),
    ).toThrow(/not ready:\nThe pack needs the app’s name\.\nThe pack needs at least one audience/)
  })
})
