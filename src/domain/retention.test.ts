import { describe, expect, it } from 'vitest'
import { seed } from './seed'
import { DEMO_DATE } from './model'
import type { Appointment, BusinessState } from './model'
import { addDays } from './format'
import { report } from './selectors'
import { retention } from './retention'

const today = DEMO_DATE
const day = (offset: number) => addDays(today, offset)

/** A seeded studio with its visit history cleared, so each test states the visits it needs. */
function studio(): BusinessState & { visit: (v: Partial<Appointment>) => Appointment } {
  const s = seed('UK')
  s.appointments = []
  s.sales = []
  s.payments = []
  s.events = []
  let n = 0
  const visit = (v: Partial<Appointment>) => {
    const a: Appointment = {
      id: `a-${++n}`,
      organisationId: s.organisation.id,
      locationId: s.organisation.locationId,
      clientId: 'client-1',
      serviceId: 'service-facial',
      staffId: 'staff-maya',
      resourceId: 'room-one',
      date: today,
      startMinutes: 600,
      status: 'completed',
      source: 'desk',
      createdAt: '2026-01-01T09:00:00.000Z',
      bookedPriceMinor: 8500,
      bookedDepositMinor: 0,
      bookedDurationMinutes: 60,
      bookedBufferMinutes: 0,
      ...v,
    }
    s.appointments.push(a)
    return a
  }
  return Object.assign(s, { visit })
}

describe('retention figures', () => {
  it('reports every rate as not enough visits when nobody is in the group', () => {
    const r = retention(studio(), 28, today)
    expect(r.newClientReturn).toEqual({ count: 0, of: 0, rate: null })
    expect(r.returningClients.rate).toBeNull()
    expect(r.lapsedClients).toBe(0)
    expect(r.byPractitioner.every((row) => row.rate === null)).toBe(true)
  })

  it('splits recorded rebooking by practitioner using the studio definition', () => {
    const s = studio()
    const done = s.visit({ date: day(-3) })
    s.visit({ date: day(-2), clientId: 'client-2' })
    s.visit({ date: day(-1), clientId: 'client-3', staffId: 'staff-sophia' })
    // A rebook linked from checkout counts; a cancelled one does not.
    s.visit({ date: day(30), status: 'confirmed', source: 'rebook', rebookedFromId: done.id })
    const cancelledFrom = s.visit({ date: day(-1), clientId: 'client-4', staffId: 'staff-sophia' })
    s.visit({
      date: day(20),
      clientId: 'client-4',
      staffId: 'staff-sophia',
      status: 'cancelled',
      source: 'rebook',
      rebookedFromId: cancelledFrom.id,
    })
    const r = retention(s, 7, today)
    const maya = r.byPractitioner.find((row) => row.staff.id === 'staff-maya')!
    const sophia = r.byPractitioner.find((row) => row.staff.id === 'staff-sophia')!
    expect(maya).toMatchObject({ count: 1, of: 2, rate: 0.5 })
    expect(sophia).toMatchObject({ count: 0, of: 2, rate: 0 })
    expect(r.byPractitioner[0].staff.id).toBe('staff-maya')
    // Professionals with no completed visits are listed last, without a rate.
    expect(r.byPractitioner.at(-1)!.rate).toBeNull()
    // The parts add up to the existing studio figure.
    const total = r.byPractitioner.reduce((sum, row) => sum + row.count, 0)
    const of = r.byPractitioner.reduce((sum, row) => sum + row.of, 0)
    expect(total / of).toBe(report(s, 7).rebookRate)
  })

  it('counts new clients who came back or are booked, but not cancelled or missed visits', () => {
    const s = studio()
    // client-1: first visit in the period, then a later completed visit.
    s.visit({ clientId: 'client-1', date: day(-10) })
    s.visit({ clientId: 'client-1', date: day(-2) })
    // client-2: first visit in the period, upcoming visit booked.
    s.visit({ clientId: 'client-2', date: day(-5) })
    s.visit({ clientId: 'client-2', date: day(14), status: 'confirmed' })
    // client-3: first visit in the period, only a cancelled and a missed visit after.
    s.visit({ clientId: 'client-3', date: day(-6) })
    s.visit({ clientId: 'client-3', date: day(-1), status: 'no_show' })
    s.visit({ clientId: 'client-3', date: day(10), status: 'cancelled' })
    // client-4: first visit before the period, so not a new client this period.
    s.visit({ clientId: 'client-4', date: day(-60) })
    s.visit({ clientId: 'client-4', date: day(-3) })
    // client-5: a confirmed visit left in the past is neither completed nor upcoming.
    s.visit({ clientId: 'client-5', date: day(-8) })
    s.visit({ clientId: 'client-5', date: day(-4), status: 'confirmed' })
    expect(retention(s, 28, today).newClientReturn).toEqual({ count: 2, of: 4, rate: 0.5 })
  })

  it('counts clients from the previous period who were seen again or are booked ahead', () => {
    const s = studio()
    s.visit({ clientId: 'client-1', date: day(-10) }) // previous 7 days: -13 to -7
    s.visit({ clientId: 'client-1', date: day(-2) }) // seen again
    s.visit({ clientId: 'client-2', date: day(-9) })
    s.visit({ clientId: 'client-2', date: day(21), status: 'confirmed' }) // booked ahead
    s.visit({ clientId: 'client-3', date: day(-8) }) // not back
    s.visit({ clientId: 'client-4', date: day(-12) })
    s.visit({ clientId: 'client-4', date: day(-1), status: 'no_show' }) // missed is not back
    s.visit({ clientId: 'client-5', date: day(-3) }) // only in the current period
    const r = retention(s, 7, today)
    expect(r.previousFrom).toBe(day(-13))
    expect(r.previousTo).toBe(day(-7))
    expect(r.returningClients).toEqual({ count: 2, of: 4, rate: 0.5 })
  })

  it('counts lapsed clients against their own usual gap', () => {
    const s = studio()
    // Every 4 weeks, last seen 50 days ago: 50 > 1.5 × 28, lapsed.
    s.visit({ clientId: 'client-1', date: day(-106) })
    s.visit({ clientId: 'client-1', date: day(-78) })
    s.visit({ clientId: 'client-1', date: day(-50) })
    // Every 8 weeks, last seen 50 days ago: not yet lapsed.
    s.visit({ clientId: 'client-2', date: day(-106) })
    s.visit({ clientId: 'client-2', date: day(-50) })
    // Lapsed by rhythm but already booked: not lapsed.
    s.visit({ clientId: 'client-3', date: day(-90) })
    s.visit({ clientId: 'client-3', date: day(-80) })
    s.visit({ clientId: 'client-3', date: day(3), status: 'confirmed' })
    // One visit only: no usual gap yet.
    s.visit({ clientId: 'client-4', date: day(-200) })
    // Two visits on the same day give no gap to measure.
    s.visit({ clientId: 'client-5', date: day(-200) })
    s.visit({ clientId: 'client-5', date: day(-200), startMinutes: 720 })
    // Exactly 1.5 × the usual gap is not over it.
    s.visit({ clientId: 'client-6', date: day(-50) })
    s.visit({ clientId: 'client-6', date: day(-30) })
    expect(retention(s, 28, today).lapsedClients).toBe(1)
  })

  it('gives sensible figures for the sample studio', () => {
    const r = retention(seed('UK'), 28, today)
    expect(r.from).toBe(day(-27))
    expect(r.byPractitioner.length).toBeGreaterThan(0)
    for (const figure of [r.newClientReturn, r.returningClients])
      if (figure.rate !== null) expect(figure.rate).toBeGreaterThanOrEqual(0)
  })
})
