import { describe, expect, it } from 'vitest'
import { runTurn, scriptedBrain } from '../../lumane'
import type { Skill } from '../../lumane'
import { commandSchema, rescheduleSlots } from '../domain/commands'
import type { Command } from '../domain/commands'
import { defaultOperations } from '../domain/operations'
import { seed } from '../domain/seed'
import { ALLOWANCES, INSTRUCTIONS, askContext, askSaleaneSkills } from './saleane'
import type { AskContext } from './saleane'

const s = seed('UK')
const skills = askSaleaneSkills()
const skill = (name: string) => skills.find((k) => k.name === name) as Skill<AskContext, Command>
const owner = askContext(s, 'owner')
const run = (name: string, ctx: AskContext, input: unknown) => {
  const k = skill(name)
  if (k.kind !== 'read') throw new Error(`${name} is not a read skill`)
  return k.run(ctx, k.input.parse(input) as never) as never
}
const propose = (name: string, ctx: AskContext, input: unknown) => {
  const k = skill(name)
  if (k.kind !== 'action') throw new Error(`${name} is not an action skill`)
  return k.propose(ctx, k.input.parse(input) as never)
}

describe('Ask Saleane skills', () => {
  it('reads the day with visits and free time for the studio', () => {
    const day = run('day_overview', owner, {}) as {
      date: string
      visits: { client: string; time: string; firstVisit: boolean }[]
      free: { professional: string; freeTimes: string[] }[]
    }
    expect(day.date).toBe('2026-10-06')
    expect(day.visits.length).toBeGreaterThan(0)
    expect(day.visits[0]).toMatchObject({
      client: expect.any(String),
      time: expect.stringMatching(/^\d\d:\d\d$/),
    })
    expect(day.free.length).toBeGreaterThan(0)
  })

  it('keeps practitioners out until their own scoped view is wired in', () => {
    const practitioner = askContext(s, 'practitioner')
    expect(skills.filter((k) => k.allowed(practitioner))).toEqual([])
  })

  it('shows takings and stock to owners and managers only', () => {
    const allowed = (role: AskContext['role']) =>
      skills.filter((k) => k.allowed(askContext(s, role))).map((k) => k.name)
    expect(allowed('owner')).toContain('takings')
    expect(allowed('manager')).toContain('low_stock')
    expect(allowed('reception')).not.toContain('takings')
    expect(allowed('reception')).not.toContain('low_stock')
    expect(allowed('reception')).toContain('day_overview')
  })

  it('reports takings in the studio currency', () => {
    const takings = run('takings', owner, { days: 30 }) as { takings: string }
    expect(takings.takings).toMatch(/^£/)
  })

  it('says that a renter’s own takings are left out, and gives rent only to those who see pay', () => {
    // Theo rents his chair in the sample, with £75.00 of his own takings in the last week.
    expect(run('takings', owner, { days: 7 })).toMatchObject({
      rentersOwnTakingsLeftOut: '£75',
      rentRecorded: '£50',
    })
    const general = run('takings', askContext(s, 'general'), { days: 7 })
    expect(general).toMatchObject({ rentersOwnTakingsLeftOut: '£75' })
    expect(general).not.toHaveProperty('rentRecorded')
  })

  it('lists low stock from the product levels', () => {
    const state = structuredClone(s)
    state.operations = {
      ...defaultOperations(),
      products: [
        { id: 'p1', name: 'Rose oil', sku: '', priceMinor: 2000, reorderAt: 3, archived: false },
        { id: 'p2', name: 'Clay mask', sku: '', priceMinor: 1500, reorderAt: 1, archived: false },
      ],
      movements: [
        {
          id: 'm1',
          productId: 'p1',
          quantity: 2,
          reason: 'received',
          note: '',
          createdAt: '2026-10-01T09:00:00.000Z',
        },
        {
          id: 'm2',
          productId: 'p2',
          quantity: 6,
          reason: 'received',
          note: '',
          createdAt: '2026-10-01T09:00:00.000Z',
        },
      ] as never,
    }
    expect(run('low_stock', askContext(state, 'owner'), {})).toEqual([
      { product: 'Rose oil', inStock: 2, reorderAt: 3 },
    ])
  })

  it('drafts an unsent message as a SALEANE command and leaves the studio unchanged', () => {
    const client = s.clients.find((c) => c.marketingConsent)!
    const before = JSON.stringify(s)
    const proposal = propose('draft_message', owner, {
      clientId: client.id,
      purpose: 'marketing',
      subject: 'A space on Thursday',
      body: 'We have a 2pm space on Thursday if you would like it.',
    })
    expect(commandSchema.parse(proposal.effect)).toMatchObject({ type: 'message' })
    expect(proposal.summary).toMatch(/stays unsent/)
    expect(JSON.stringify(s)).toBe(before)
  })

  it('refuses marketing to a client who has not agreed to it', () => {
    const client = s.clients.find((c) => !c.marketingConsent)!
    expect(() =>
      propose('draft_message', owner, {
        clientId: client.id,
        purpose: 'marketing',
        subject: 'Offer',
        body: 'Ten percent off.',
      }),
    ).toThrow(/not agreed to marketing/)
  })

  it('proposes a move only into a free time', () => {
    const maya = s.appointments.filter(
      (a) => a.status === 'confirmed' && a.staffId === 'staff-maya',
    )
    const [visit, clash] = [maya[1], maya[2]]
    expect(() =>
      propose('move_visit', owner, {
        appointmentId: visit.id,
        date: clash.date,
        startMinutes: clash.startMinutes,
      }),
    ).toThrow(/not free/)
    const open = rescheduleSlots(s, visit.id, visit.staffId, '2026-10-08')[0]
    const free = propose('move_visit', owner, {
      appointmentId: visit.id,
      date: '2026-10-08',
      startMinutes: open,
    })
    expect(commandSchema.parse(free.effect)).toMatchObject({
      type: 'reschedule',
      appointmentId: visit.id,
      date: '2026-10-08',
    })
    expect(free.summary).toMatch(/^Move .+ to 2026-10-08 at /)
  })

  it('answers "what\'s on today" end to end in test mode', async () => {
    const brain = scriptedBrain((request, step) => {
      if (step === 0) return { calls: [{ id: 'c1', name: 'day_overview', input: {} }] }
      const tool = request.messages.at(-1)
      const day = JSON.parse(tool?.role === 'tool' ? tool.result : '{}')
      return { text: `You have ${day.visits.length} visits today.`, calls: [] }
    })
    const result = await runTurn({
      brain,
      skills,
      ctx: owner,
      instructions: INSTRUCTIONS,
      history: [],
      text: "What's on today?",
      meter: {
        allowance: ALLOWANCES.included,
        usage: undefined,
        personId: 'owner-1',
        at: '2026-10-06T08:40:00.000Z',
        kind: 'typed',
        worstCaseMinor: 5,
      },
      newId: () => 'p',
    })
    expect(result).toMatchObject({
      status: 'answered',
      text: expect.stringMatching(/^You have \d+ visits today\.$/),
    })
  })

  it('keeps every plan profitable at full use', () => {
    // About 2p a typed question, 5p a talking minute and 1p a guest chat, worst case.
    const cost = (a: typeof ALLOWANCES.included) =>
      a.monthly.typed * 2 + (a.monthly.talkSeconds / 60) * 5 + a.monthly.guestChats * 1
    expect(cost(ALLOWANCES.included)).toBeLessThanOrEqual(4900 / 4)
    expect(cost(ALLOWANCES.plus) - cost(ALLOWANCES.included)).toBeLessThanOrEqual(3900 / 2)
  })
})
