import { describe, expect, it } from 'vitest'
import { execute } from './commands'
import { addDays } from './format'
import { bankHolidays, localSignals, parseGovUkBankHolidays, seasonCalendar } from './localSignals'
import type { LocalSignal, LocalSource } from './localSignals'
import type { Appointment, BusinessState } from './model'
import { can } from './operations'
import { seed } from './seed'
import { specialResult, specialsList, suggestionInput, suggestSpecials } from './specials'

const today = '2026-10-06'
const now = '2026-10-06T09:00:00.000Z'
const base = seed('UK')
let n = 0
const makeId = () => `special-test-${++n}`

const source = (signals: Partial<LocalSignal>[]): LocalSource => ({
  id: 'stub',
  label: 'Stub',
  live: false,
  signals: () =>
    signals.map((x, i) => ({
      id: `stub-${i}`,
      kind: 'event',
      title: `Stub ${i}`,
      startDate: addDays(today, 10),
      endDate: addDays(today, 12),
      leadDays: 14,
      categories: ['Hair'],
      why: 'Because.',
      idea: 'An idea.',
      source: 'Stub',
      ...x,
    })),
})

function plan(s: BusinessState, input = suggestionInput(suggestSpecials(s, today)[0])) {
  return execute(s, { type: 'special-plan', input }, now, makeId)
}

describe('local and seasonal signals', () => {
  it('keeps each country to its own occasions and every source in test mode', () => {
    const uk = seasonCalendar.signals(base, today, '2027-12-31').map((x) => x.id)
    const us = seasonCalendar.signals(seed('US'), today, '2027-12-31').map((x) => x.id)
    expect(uk).toContain('mothers-day-uk-2027')
    expect(uk).not.toContain('thanksgiving-2026')
    expect(us).toContain('thanksgiving-2026')
    expect(us).not.toContain('mothers-day-uk-2027')
    expect(localSignals(base, today, '2027-12-31').length).toBeGreaterThan(10)
  })

  it('reads the GOV.UK bank holiday list and turns Monday holidays into long weekends', () => {
    const parsed = parseGovUkBankHolidays({
      'england-and-wales': {
        division: 'england-and-wales',
        events: [
          { title: 'Early May bank holiday', date: '2027-05-03' },
          { title: 'Broken', date: 'soon' },
        ],
      },
    })
    expect(parsed).toEqual([{ title: 'Early May bank holiday', date: '2027-05-03' }])
    expect(() => parseGovUkBankHolidays({})).toThrow()
    const may = bankHolidays.signals(base, '2027-04-01', '2027-05-10')
    expect(may).toMatchObject([{ startDate: '2027-04-30', endDate: '2027-05-03' }])
  })
})

describe('suggested specials', () => {
  it('suggests what is coming up soon enough to plan, with its reason and the room to fill', () => {
    const ideas = suggestSpecials(base, today)
    expect(ideas.length).toBe(3)
    for (const g of ideas) {
      expect(g.reason.length).toBeGreaterThan(10)
      expect(g.room).toBeGreaterThanOrEqual(0)
      expect(g.endDate >= today).toBe(true)
    }
    const starts = ideas.map((g) => g.startDate)
    expect([...starts].sort()).toEqual(starts)
  })

  it('waits for the lead time, skips what has nearly passed and what the studio does not offer', () => {
    const ideas = suggestSpecials(base, today, {
      sources: [
        source([
          { id: 'too-early', startDate: addDays(today, 40), leadDays: 14 },
          { id: 'nearly-over', startDate: addDays(today, -5), endDate: addDays(today, 1) },
          { id: 'kept', startDate: addDays(today, -2), endDate: addDays(today, 5) },
        ]),
      ],
    })
    expect(ideas.map((g) => g.signal.id)).toEqual(['kept'])
    expect(ideas[0].startDate).toBe(today)
    const noHair = structuredClone(base)
    noHair.services = noHair.services.map((x) =>
      x.category === 'Hair' ? { ...x, archived: true } : x,
    )
    expect(suggestSpecials(noHair, today, { sources: [source([{}])] })).toEqual([])
  })

  it('plans a special only for managers, once, and stops offering it', () => {
    expect(can('owner', 'special') && can('manager', 'special')).toBe(true)
    expect(can('reception', 'special') || can('practitioner', 'special')).toBe(false)
    const first = suggestSpecials(base, today)[0]
    const result = plan(base)
    if (!result.ok) throw new Error(result.error)
    expect(specialsList(result.state)).toMatchObject([{ signalId: first.signal.id }])
    expect(suggestSpecials(result.state, today).map((g) => g.signal.id)).not.toContain(
      first.signal.id,
    )
    expect(plan(result.state, suggestionInput(first))).toMatchObject({ ok: false })
    // Planning changes no prices and records no messages.
    expect(result.state.services).toEqual(base.services)
    expect(result.state.events).toEqual(base.events)
  })

  it('refuses a special that ends before it starts, has passed or runs too long', () => {
    const input = suggestionInput(suggestSpecials(base, today)[0])
    expect(plan(base, { ...input, endDate: addDays(input.startDate, -1) }).ok).toBe(false)
    expect(plan(base, { ...input, startDate: '2026-09-01', endDate: '2026-09-05' }).ok).toBe(false)
    expect(plan(base, { ...input, endDate: addDays(input.startDate, 100) }).ok).toBe(false)
  })
})

describe('whether a special worked', () => {
  function withVisits(s: BusinessState, dates: string[]) {
    const template = s.appointments.find((a) => {
      const service = s.services.find((x) => x.id === a.serviceId)
      return service?.category === 'Body' && a.status === 'completed'
    })!
    const next = structuredClone(s)
    dates.forEach((date, i) =>
      next.appointments.push({ ...template, id: `result-${date}-${i}`, date } as Appointment),
    )
    return next
  }

  it('compares the special days with the same length of time before it', () => {
    const start = addDays(today, -14)
    const special = {
      id: 'sp-1',
      organisationId: base.organisation.id,
      createdAt: now,
      signalId: 'stub',
      title: 'Recovery week',
      reason: 'A race nearby.',
      offer: 'Recovery massage.',
      categories: ['Body' as const],
      startDate: start,
      endDate: addDays(start, 6),
    }
    const s = withVisits(base, [
      ...Array.from({ length: 8 }, (_, i) => addDays(start, i % 7)),
      ...[1, 2, 3, 4].map((k) => addDays(start, -7 * k)),
    ])
    const before = specialResult(base, special, today)
    const after = specialResult(s, special, today)
    expect(after.state).toBe('finished')
    expect(after.visits - before.visits).toBe(8)
    expect(after.usual).not.toBeNull()
    expect(after.verdict).toBe('more')
    expect(
      specialResult(
        s,
        { ...special, startDate: addDays(today, 3), endDate: addDays(today, 9) },
        today,
      ),
    ).toMatchObject({ state: 'upcoming', visits: 0, verdict: null })
  })

  it('counts a stopped special only up to the day it stopped', () => {
    const result = plan(base)
    if (!result.ok) throw new Error(result.error)
    const special = specialsList(result.state)[0]
    const stopped = execute(
      result.state,
      { type: 'special-stop', specialId: special.id },
      now,
      makeId,
    )
    if (!stopped.ok) throw new Error(stopped.error)
    const kept = specialsList(stopped.state)[0]
    expect(kept.stoppedOn).toBe(special.startDate < today ? today : special.startDate)
    expect(
      execute(stopped.state, { type: 'special-stop', specialId: special.id }, now, makeId).ok,
    ).toBe(false)
  })
})
