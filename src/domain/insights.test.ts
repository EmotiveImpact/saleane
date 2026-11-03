import { describe, expect, it } from 'vitest'
import { addDays } from './format'
import { drifting, gapInvitation, gapSuggestions, morningBrief, unusual } from './insights'
import type { Appointment, BusinessState } from './model'
import { seed } from './seed'
import { report } from './selectors'

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
    // The full sample, whose regulars were in yesterday too.
    const brief = morningBrief(seed('UK', { regulars: true }), today)
    expect(brief).toMatchObject({ date: today, visits: 12, guests: 12, firstVisits: 0 })
    expect(brief.bookedMinutes).toBeGreaterThan(0)
    expect(brief.yesterday.takingsMinor).toBeGreaterThan(0)
  })

  it('stays quiet on an ordinary day, apart from the sample studio running low on a product', () => {
    expect(unusual(seed('UK', { regulars: true }), today).map((x) => x.kind)).toEqual(['low-stock'])
  })

  it('compares takings like for like when someone rents a chair', () => {
    // Stage 3: Theo rents his chair from 21 September, so he is left out of every week compared.
    // The named clients alone took less this week, which is worth saying.
    const notice = unusual(base, today).find((x) => x.kind === 'takings-down')
    expect(notice?.detail).toMatch(/^The last 7 days took 31% less/)
    // Had he not rented, his visit this week would have counted and the week would be ordinary.
    const noRent = structuredClone(base)
    noRent.operations!.rentals = []
    noRent.operations!.rentPayments = []
    expect(unusual(noRent, today).map((x) => x.kind)).toEqual(['low-stock'])
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

describe('quiet gap invitations and staff rebooking', () => {
  it('writes a short invitation that names the time and promises nothing is booked yet', () => {
    const [offer] = gapSuggestions(base, today, '2026-10-06T08:00:00.000Z')
    const label = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`
    const text = gapInvitation(base, offer, today, label)
    const first = offer.name.split(' ')[0]
    expect(text.subject).toContain(first)
    expect(text.body).toContain(label(offer.startMinutes))
    expect(text.body).toContain(offer.date === today ? 'today' : 'tomorrow')
    expect(text.body).toContain('reply to this message and we will book you in')
  })

  it("counts each professional's rebooked visits so the studio rate adds up", () => {
    const s = structuredClone(base)
    const done = s.appointments.find((a) => a.status === 'completed' && a.date <= today)!
    s.appointments.push({
      ...done,
      id: 'test-rebooked',
      date: addDays(today, 28),
      status: 'confirmed',
      rebookedFromId: done.id,
    })
    const r = report(s, 30)
    expect(r.byStaff.find((row) => row.staff.id === done.staffId)?.rebooked).toBe(1)
    const total = r.byStaff.reduce((sum, row) => sum + row.rebooked, 0)
    for (const row of r.byStaff) expect(row.rebooked).toBeLessThanOrEqual(row.visits)
    expect(r.rebookRate).toBe(r.completed ? total / r.completed : null)
  })
})
