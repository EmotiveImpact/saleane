import { describe, expect, it } from 'vitest'
import { addDays } from './format'
import { drifting, gapSuggestions, morningBrief, unusual } from './insights'
import type { Appointment, BusinessState } from './model'
import { seed } from './seed'

const today = '2026-10-06'
const tomorrow = addDays(today, 1)
const base = seed('UK')
const template = base.appointments.find((a) => a.status === 'completed')!
let n = 0
const visit = (date: string, changes: Partial<Appointment> = {}): Appointment => ({
  ...template,
  id: `test-visit-${++n}`,
  date,
  startMinutes: 10 * 60,
  status: 'completed',
  ...changes,
})
const withVisits = (...visits: Appointment[]): BusinessState => ({
  ...base,
  appointments: [...base.appointments, ...visits],
})

describe('Smart insights', () => {
  it('briefs the day from the diary and compares with the same weekday before', () => {
    const brief = morningBrief(base, today)
    expect(brief).toMatchObject({ date: today, visits: 12, guests: 12, firstVisits: 0 })
    expect(brief.bookedMinutes).toBeGreaterThan(0)
    expect(brief.yesterday.takingsMinor).toBeGreaterThan(0)
  })

  it('stays quiet on an ordinary day', () => {
    expect(unusual(base, today)).toEqual([])
  })

  it('notices a quiet day ahead only against enough history', () => {
    const busyWednesdays = [1, 2, 3, 4].flatMap((w) =>
      [9, 11, 13, 15].map((h) =>
        visit(addDays(tomorrow, -7 * w), { startMinutes: h * 60, bookedDurationMinutes: 90 }),
      ),
    )
    const notices = unusual(withVisits(...busyWednesdays), today)
    expect(notices.map((x) => x.kind)).toContain('quiet-day')
    expect(notices.find((x) => x.kind === 'quiet-day')!.detail).toMatch(
      /^Nothing booked so far. This day of the week usually has about \d+(\.5)? hours\.$/,
    )
  })

  it('notices more cancellations than usual', () => {
    const lost = [0, 1, 2].map((d) =>
      visit(addDays(today, -d), { status: d ? 'cancelled' : 'no_show', id: `lost-${d}` }),
    )
    const notice = unusual(withVisits(...lost), today).find((x) => x.kind === 'cancellations')
    expect(notice?.detail).toMatch(/^3 visits were cancelled or missed/)
  })

  it('warns about a client who keeps missing visits and is booked tomorrow', () => {
    const clientId = base.clients[3].id
    const s = withVisits(
      visit(addDays(today, -40), { clientId, status: 'no_show' }),
      visit(addDays(today, -20), { clientId, status: 'no_show' }),
      visit(tomorrow, { clientId, status: 'confirmed' }),
    )
    const notice = unusual(s, today).find((x) => x.kind === 'missed-visits')
    expect(notice).toMatchObject({ clientId, managersOnly: false })
    expect(notice!.title).toBe(`${base.clients[3].name} has missed 2 visits`)
  })

  it('keeps money notices to managers', () => {
    const recent = new Set(
      base.appointments.filter((a) => a.date >= addDays(today, -6)).map((a) => a.id),
    )
    const s = { ...base, sales: base.sales.filter((sale) => !recent.has(sale.appointmentId)) }
    const notice = unusual(s, today).find((x) => x.kind === 'takings-down')
    expect(notice).toMatchObject({ managersOnly: true })
  })

  it('finds clients past their own usual gap, longest overdue first', () => {
    const list = drifting(base, today)
    expect(list.map((d) => d.name).slice(0, 3)).toEqual([
      'Jamie Morgan',
      'Emily Clarke',
      'Charlotte Hayes',
    ])
    expect(list.every((d) => d.weeksSince >= 5)).toBe(true)

    // A client who comes every three weeks is noticed after four and a half.
    const clientId = base.clients[0].id
    const regular = withVisits(
      ...[0, 21, 42].map((d) => visit(addDays(today, -80 + d), { clientId })),
    )
    const cleared: BusinessState = {
      ...regular,
      appointments: regular.appointments.filter(
        (a) => a.clientId !== clientId || a.id.startsWith('test-visit'),
      ),
    }
    expect(drifting(cleared, today).find((d) => d.clientId === clientId)?.usualWeeks).toBe(3)
  })

  it('matches drifting clients with open times today and tomorrow', () => {
    const suggestions = gapSuggestions(base, today, '2026-10-06T08:00:00.000Z')
    expect(suggestions.length).toBeGreaterThan(0)
    for (const g of suggestions) expect([today, tomorrow]).toContain(g.date)
    expect(new Set(suggestions.map((g) => g.clientId)).size).toBe(suggestions.length)
    const times = suggestions.map((g) => `${g.staffId} ${g.date} ${g.startMinutes}`)
    expect(new Set(times).size).toBe(times.length)
  })
})
