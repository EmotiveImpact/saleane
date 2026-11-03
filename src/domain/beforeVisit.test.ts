import { describe, expect, it } from 'vitest'
import { seed } from './seed'
import { practitionerView } from './practitioner'
import { DEMO_DATE } from './model'
import type { Appointment, BusinessState } from './model'
import { addDays } from './format'
import {
  beforeVisit,
  guestMilestones,
  milestoneLine,
  milestoneTag,
  nextToArrive,
  studioMilestone,
  studioMilestoneLine,
  visitMilestones,
} from './beforeVisit'

const visits = (...dates: string[]) => dates.map((date) => ({ date }))
const context = { visitDate: '2026-10-13', locale: 'en-GB' as const }
/** `n` earlier visits, newest first, a fortnight apart before `date`. */
const earlierThan = (date: string, n: number) =>
  Array.from({ length: n }, (_, i) => ({ date: addDays(date, -14 * (i + 1)) }))

describe('guest milestones', () => {
  it('welcomes a first visit, and says nothing else about a new guest', () => {
    expect(guestMilestones({ date: '2026-10-13' }, [])).toEqual([{ kind: 'first-visit' }])
    expect(milestoneLine({ kind: 'first-visit' }, 'Naomi', context)).toBe(
      'Naomi’s first visit. A warm welcome, and a moment to settle in.',
    )
  })
  it('counts the fifth, tenth, twenty-fifth and so on, from visits they came to', () => {
    const at = (n: number) =>
      guestMilestones({ date: '2026-10-13' }, earlierThan('2026-10-13', n - 1))
    expect(at(5)).toContainEqual({ kind: 'visit-count', count: 5 })
    expect(at(10)).toContainEqual({ kind: 'visit-count', count: 10 })
    expect(at(25)).toContainEqual({ kind: 'visit-count', count: 25 })
    expect(at(150)).toContainEqual({ kind: 'visit-count', count: 150 })
    for (const n of [2, 4, 6, 11, 99, 120])
      expect(
        at(n).some((m) => m.kind === 'visit-count'),
        String(n),
      ).toBe(false)
    expect(milestoneLine({ kind: 'visit-count', count: 10 }, 'Amelia', context)).toBe(
      'Amelia’s tenth visit.',
    )
    expect(milestoneTag({ kind: 'visit-count', count: 25 })).toBe('Twenty-fifth visit')
    expect(milestoneLine({ kind: 'visit-count', count: 150 }, 'Amelia', context)).toBe(
      'Amelia’s 150th visit.',
    )
  })
  it('marks a year since the first visit once, at the first visit after it', () => {
    const first = '2025-10-01'
    const year = guestMilestones({ date: '2026-10-13' }, visits('2026-08-20', first))
    expect(year).toContainEqual({ kind: 'anniversary', years: 1 })
    expect(milestoneLine({ kind: 'anniversary', years: 1 }, 'Rosa', context)).toBe(
      'A year since Rosa’s first visit.',
    )
    // Already marked at a visit after the anniversary.
    const later = guestMilestones({ date: '2026-10-27' }, visits('2026-10-13', '2026-08-20', first))
    expect(later.some((m) => m.kind === 'anniversary')).toBe(false)
    // Too long after it to be worth saying.
    const late = guestMilestones({ date: '2026-12-13' }, visits('2026-08-20', first))
    expect(late.some((m) => m.kind === 'anniversary')).toBe(false)
    expect(milestoneLine({ kind: 'anniversary', years: 2 }, 'Rosa', context)).toBe(
      'Two years since Rosa’s first visit.',
    )
  })
  it('notices a birthday close to the visit, across the turn of the year', () => {
    expect(guestMilestones({ date: '2026-10-13' }, visits('2026-09-01'), '10-13')).toContainEqual({
      kind: 'birthday',
      offsetDays: 0,
    })
    expect(guestMilestones({ date: '2026-12-30' }, visits('2026-09-01'), '01-02')).toContainEqual({
      kind: 'birthday',
      offsetDays: 3,
    })
    expect(
      guestMilestones({ date: '2026-10-13' }, visits('2026-09-01'), '10-20').some(
        (m) => m.kind === 'birthday',
      ),
    ).toBe(false)
    expect(milestoneLine({ kind: 'birthday', offsetDays: 2 }, 'Noor', context)).toBe(
      'Noor’s birthday is on Thursday.',
    )
    expect(milestoneLine({ kind: 'birthday', offsetDays: -1 }, 'Noor', context)).toBe(
      'Noor’s birthday was on Monday.',
    )
  })
  it('welcomes back a guest after six months or more away', () => {
    const back = guestMilestones({ date: '2026-10-13' }, visits('2026-02-10'))
    expect(back).toContainEqual({ kind: 'back', months: 8 })
    expect(milestoneLine({ kind: 'back', months: 8 }, 'Ben', context)).toBe(
      'Ben is back after eight months.',
    )
    expect(guestMilestones({ date: '2026-10-13' }, visits('2026-06-10'))).toEqual([])
  })
  it('never uses words that claim more than the record', () => {
    for (const m of [
      { kind: 'first-visit' as const },
      { kind: 'visit-count' as const, count: 10 },
      { kind: 'anniversary' as const, years: 1 },
      { kind: 'birthday' as const, offsetDays: 0 },
      { kind: 'back' as const, months: 7 },
    ])
      expect(milestoneLine(m, 'Ada', context)).not.toMatch(/—|!|congrat/i)
  })
})

/** The sample studio with today's first booked visit, and that guest's visits. */
function firstToday(s: BusinessState) {
  return s.appointments
    .filter((a) => a.date === DEMO_DATE && a.status === 'confirmed')
    .sort((a, b) => a.startMinutes - b.startMinutes)[0]
}

describe('before the visit', () => {
  it('finds the next guest to arrive, allowing a few minutes for lateness', () => {
    const s = seed('UK')
    const first = firstToday(s)
    expect(nextToArrive(s, DEMO_DATE, 0)?.id).toBe(first.id)
    expect(nextToArrive(s, DEMO_DATE, first.startMinutes + 5)?.id).toBe(first.id)
    expect(nextToArrive(s, DEMO_DATE, first.startMinutes + 30)?.id).not.toBe(first.id)
    expect(nextToArrive(s, DEMO_DATE, 24 * 60)).toBeUndefined()
    const own = nextToArrive(s, DEMO_DATE, 0, { staffId: first.staffId })
    expect(own?.staffId).toBe(first.staffId)
  })
  it('reads the guest’s record: what to remember, last time, and whether the next visit is booked', () => {
    const s = seed('UK')
    const visit = firstToday(s)
    const card = beforeVisit(s, visit)!
    const client = s.clients.find((c) => c.id === visit.clientId)!
    expect(card.name).toBe(client.name)
    expect(card.remembered).toBe(client.preferences.trim())
    const before = s.appointments.filter(
      (a) => a.clientId === visit.clientId && a.status === 'completed' && a.date < visit.date,
    )
    if (before.length) expect(card.lastTime).toMatch(/, .+/)
    else expect(card.lastTime).toBeUndefined()
    expect(typeof card.nothingAfter).toBe('boolean')
  })
  it('counts a guest’s visits across their records with the same email', () => {
    const s = structuredClone(seed('UK'))
    const visit = firstToday(s)
    const client = s.clients.find((c) => c.id === visit.clientId)!
    // A second record with the same email holds four earlier visits.
    const other = { ...client, id: 'client-copy', preferences: '' }
    s.clients.push(other)
    s.appointments = s.appointments.filter((a) => a.clientId !== client.id || a.id === visit.id)
    for (let i = 1; i <= 4; i++)
      s.appointments.push({
        ...visit,
        id: `copy-${i}`,
        clientId: other.id,
        date: addDays(visit.date, -21 * i),
        status: 'completed',
      } as Appointment)
    expect(visitMilestones(s, visit)).toContainEqual({ kind: 'visit-count', count: 5 })
  })
})

describe('the studio’s milestone', () => {
  /** A studio with `before` completed visits before today and today's sample visits. */
  function studio(before: number) {
    const s = structuredClone(seed('UK'))
    const template = s.appointments[0]
    const today = s.appointments.filter((a) => a.date === DEMO_DATE)
    s.appointments = [
      ...Array.from(
        { length: before },
        (_, i) =>
          ({
            ...template,
            id: `past-${i}`,
            date: addDays(DEMO_DATE, -1 - (i % 300)),
            status: 'completed',
          }) as Appointment,
      ),
      ...today,
    ]
    return s
  }
  it('says which of today’s visits will be the hundredth, and that it happened once it has', () => {
    const s = studio(98)
    const m = studioMilestone(s, DEMO_DATE)!
    expect(m.count).toBe(100)
    expect(studioMilestoneLine(m, 'Linden Studio', 'Naomi', '10:00')).toBe(
      m.done
        ? 'Naomi’s visit today was Linden Studio’s hundredth.'
        : 'Naomi’s visit at 10:00 will be Linden Studio’s hundredth.',
    )
  })
  it('says nothing on an ordinary day', () => {
    expect(studioMilestone(studio(10), DEMO_DATE)).toBeUndefined()
  })
})

describe('the practitioner’s view', () => {
  it('carries one milestone sentence for a visit to come, and nothing behind it', () => {
    const s = seed('UK')
    const view = practitionerView(s, 'staff-maya', DEMO_DATE)
    const withMoment = view.appointments.filter((a) => a.moment)
    expect(withMoment.length).toBeGreaterThan(0)
    for (const a of withMoment) {
      expect(['confirmed', 'arrived']).toContain(a.status)
      expect(a.moment).toMatch(/’s |is back after/)
    }
    expect(view.appointments.filter((a) => a.status === 'completed').some((a) => a.moment)).toBe(
      false,
    )
  })
})
