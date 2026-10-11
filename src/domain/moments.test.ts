import { describe, expect, it } from 'vitest'
import { seed } from './seed'
import { DEMO_DATE } from './model'
import type { Appointment, BusinessState, Sale } from './model'
import { addDays } from './format'
import { guestView } from './guest'
import { report, staffDay } from './selectors'
import type { DaySegment } from './selectors'
import {
  CLOSING_LINE,
  allInHand,
  closingLedger,
  fullyBooked,
  pauses,
  settledLine,
  shortestTreatment,
  visitPauses,
} from './moments'

const org = { locale: 'en-GB' as const, currency: 'GBP' as const }
const sale = (over: Partial<Sale> = {}) =>
  ({
    method: 'cash',
    balanceMinor: 9500,
    currency: 'GBP',
    ...over,
  }) as Sale

describe('Settled. at checkout', () => {
  it('says money recorded by hand was recorded, never charged or paid', () => {
    const cash = settledLine(sale(), { sandbox: false, organisation: org })
    const terminal = settledLine(sale({ method: 'external_card' }), {
      sandbox: false,
      organisation: org,
    })
    expect(cash).toBe('Recorded as paid by cash.')
    expect(terminal).toBe('Recorded as paid by card terminal.')
    for (const line of [cash, terminal]) expect(line).not.toMatch(/charged|^paid/i)
  })
  it('lets only a payment the provider confirmed say "Paid by card"', () => {
    const confirmed = settledLine(
      sale({ method: 'card', processor: { provider: 'stripe', live: true } }),
      { sandbox: false, organisation: org },
    )
    const test = settledLine(
      sale({ method: 'card', processor: { provider: 'stripe', live: false } }),
      { sandbox: false, organisation: org },
    )
    expect(confirmed).toBe('Paid by card. The payment provider confirmed it.')
    expect(test).toBe('A test card payment. No money moved.')
  })
  it('says a sample studio checkout is a demo, whatever the method', () => {
    for (const method of ['demo_card', 'demo_cash', 'cash'] as const)
      expect(settledLine(sale({ method }), { sandbox: true, organisation: org })).toBe(
        'A sample studio, so this checkout is a demo. No money moved.',
      )
  })
  it('names a plan or gift card that took care of it', () => {
    expect(
      settledLine(sale({ balanceMinor: 0, coveredMinor: 9500 }), {
        sandbox: false,
        planName: 'Facial club',
        organisation: org,
      }),
    ).toBe('Covered by Facial club. Nothing left to collect.')
    expect(
      settledLine(sale({ balanceMinor: 0, giftCardMinor: 9500 }), {
        sandbox: false,
        organisation: org,
      }),
    ).toBe('Paid from a gift card. Nothing left to collect.')
    expect(
      settledLine(sale({ balanceMinor: 4500, giftCardMinor: 2000 }), {
        sandbox: false,
        organisation: org,
      }),
    ).toBe('Recorded as paid by cash. £20.00 came from a gift card.')
    expect(settledLine(sale({ balanceMinor: 0 }), { sandbox: false, organisation: org })).toBe(
      'Nothing was left to collect at checkout.',
    )
  })
})

/** Books one visit over every free stretch in each working person's day. */
function fillDay(s: BusinessState, date: string, leave: (staffId: string) => number = () => 0) {
  const model = s.appointments[0]
  let n = 0
  for (const person of s.staff) {
    const day = staffDay(s, person.id, date)
    if (!day.working) continue
    for (const segment of day.segments) {
      if (segment.kind !== 'free') continue
      const gap = leave(person.id)
      const length = segment.to - segment.from - gap
      if (length <= 0) continue
      s.appointments.push({
        ...model,
        id: `visit-fill-${n++}`,
        staffId: person.id,
        date,
        startMinutes: segment.from + gap,
        status: 'confirmed',
        bookedDurationMinutes: length,
        bookedBufferMinutes: 0,
      } as Appointment)
    }
  }
  return s
}

describe('Fully booked. Beautifully done.', () => {
  const future = '2030-01-08'
  it('shows only when nothing long enough for anyone’s shortest treatment is left', () => {
    const s = seed('UK')
    expect(fullyBooked(s, DEMO_DATE)).toBe(false)
    expect(fullyBooked(s, future)).toBe(false)
    expect(fullyBooked(fillDay(s, future), future)).toBe(true)
  })
  it('never shows on an empty day, or a day nobody works', () => {
    const s = seed('UK')
    expect(fullyBooked(s, future)).toBe(false)
    // A Sunday: the studio is closed, so there is nobody working and nothing booked.
    expect(fullyBooked(s, '2030-01-06')).toBe(false)
  })
  it('counts a gap too short for that person’s shortest treatment as filled', () => {
    const s = seed('UK')
    const maya = 'staff-maya'
    // Maya's shortest treatment takes 75 minutes with its turnaround; Theo's patch test, 15.
    expect(shortestTreatment(s, maya, s.organisation.locationId)).toBe(75)
    expect(shortestTreatment(s, 'staff-theo', s.organisation.locationId)).toBe(15)
    const short = fillDay(seed('UK'), future, (id) => (id === maya ? 60 : 0))
    expect(fullyBooked(short, future)).toBe(true)
    const room = fillDay(seed('UK'), future, (id) => (id === maya ? 75 : 0))
    expect(fullyBooked(room, future)).toBe(false)
    const theo = fillDay(seed('UK'), future, (id) => (id === 'staff-theo' ? 15 : 0))
    expect(fullyBooked(theo, future)).toBe(false)
  })
  it('lets a treatment start only on the quarter hour', () => {
    const s = fillDay(seed('UK'), future)
    // Maya's day is one visit from 09:00 to 18:00. Split it to leave 75 minutes free.
    const hers = s.appointments.find(
      (a) => a.id.startsWith('visit-fill') && a.staffId === 'staff-maya',
    )!
    const later = { ...hers, id: 'visit-fill-later' }
    s.appointments.push(later)
    // From 10:50 to 12:05: only 65 of those minutes start on a quarter hour.
    hers.bookedDurationMinutes = 650 - hers.startMinutes
    later.startMinutes = 725
    later.bookedDurationMinutes = 1080 - 725
    expect(fullyBooked(s, future)).toBe(true)
    // From 10:45 to 12:00: a 75-minute treatment fits.
    hers.bookedDurationMinutes = 645 - hers.startMinutes
    later.startMinutes = 720
    later.bookedDurationMinutes = 1080 - 720
    expect(fullyBooked(s, future)).toBe(false)
  })
  it('never says it about a day that has passed', () => {
    const s = fillDay(seed('UK'), future)
    expect(fullyBooked(s, future, { today: addDays(future, 1) })).toBe(false)
    expect(fullyBooked(s, future, { today: future })).toBe(true)
  })
  it('counts only one location for a general manager', () => {
    const s = fillDay(seed('UK'), future)
    expect(fullyBooked(s, future, { locationId: s.organisation.locationId })).toBe(true)
    expect(fullyBooked(s, future, { locationId: 'loc-elsewhere' })).toBe(false)
  })
  it('leaves out someone who has left, or who does no treatment', () => {
    const s = fillDay(seed('UK'), future, (id) => (id === 'staff-sophia' ? 120 : 0))
    expect(fullyBooked(s, future)).toBe(false)
    s.staff.find((p) => p.id === 'staff-sophia')!.archived = true
    expect(fullyBooked(s, future)).toBe(true)
    const t = fillDay(seed('UK'), future, (id) => (id === 'staff-sophia' ? 120 : 0))
    t.staff.find((p) => p.id === 'staff-sophia')!.serviceIds = []
    expect(fullyBooked(t, future)).toBe(true)
  })
  it('is the sample’s Monday 12 October, once the regulars are in', () => {
    const s = seed('UK', { regulars: true })
    expect(fullyBooked(s, addDays(DEMO_DATE, 6))).toBe(true)
    expect(fullyBooked(s, DEMO_DATE)).toBe(false)
  })
})

describe('A pause', () => {
  const visit = (from: number, to: number) =>
    ({ kind: 'visit', from, to, appointment: {} }) as DaySegment
  const free = (from: number, to: number) => ({ kind: 'free', from, to }) as DaySegment
  it('is free time between two visits, never before the first or after the last', () => {
    const day = [free(540, 600), visit(600, 675), free(675, 705), visit(705, 780), free(780, 1080)]
    expect([...pauses(day)]).toEqual([675])
  })
  it('is not free time beside a closure', () => {
    const day = [
      visit(600, 675),
      free(675, 705),
      { kind: 'closed', from: 705, to: 760, reason: 'Training' } as DaySegment,
      free(760, 800),
      visit(800, 860),
    ]
    expect(pauses(day).size).toBe(0)
  })
  it('appears in a sample day with a quarter hour between two visits', () => {
    const s = seed('UK')
    const day = staffDay(s, 'staff-maya', DEMO_DATE)
    expect([...pauses(day.segments)]).toContain(645)
  })
  it('lists pauses after a visit, leaving out cancelled visits and turnarounds', () => {
    const v = (id: string, start: number, status: Appointment['status'] = 'confirmed') => ({
      id,
      startMinutes: start,
      durationMinutes: 60,
      bufferMinutes: 15,
      status,
    })
    expect(visitPauses([v('c', 720), v('a', 540), v('b', 615), v('x', 660, 'cancelled')])).toEqual([
      { afterId: 'b', from: 690, to: 720 },
    ])
    // Ten minutes is a breath, not a pause.
    expect(visitPauses([v('a', 540), v('b', 625)])).toEqual([])
  })
})

describe('All in hand', () => {
  const visit = (start: number, status: Appointment['status'], guestHereAt?: string) => ({
    startMinutes: start,
    status,
    ...(guestHereAt ? { guestHereAt } : {}),
  })
  const day = [visit(540, 'completed'), visit(570, 'arrived'), visit(660, 'confirmed')]
  it('shows once nothing waits and everyone due so far is welcomed or checked out', () => {
    expect(allInHand({ waiting: 0, visits: day, nowMinutes: 645 })).toBe(true)
  })
  it('never shows while a call, patch test or reminder waits', () => {
    expect(allInHand({ waiting: 1, visits: day, nowMinutes: 645 })).toBe(false)
  })
  it('never shows while a guest is late, or waiting to be welcomed', () => {
    expect(allInHand({ waiting: 0, visits: day, nowMinutes: 665 })).toBe(false)
    const waiting = [...day.slice(0, 2), visit(660, 'confirmed', '2026-10-06T09:40:00.000Z')]
    expect(allInHand({ waiting: 0, visits: waiting, nowMinutes: 645 })).toBe(false)
  })
  it('is earned: nobody due yet is not all in hand', () => {
    expect(allInHand({ waiting: 0, visits: day, nowMinutes: 500 })).toBe(false)
    expect(allInHand({ waiting: 0, visits: [], nowMinutes: 700 })).toBe(false)
  })
  it('leaves cancelled and missed visits out', () => {
    const changed = [...day, visit(600, 'cancelled'), visit(610, 'no_show')]
    expect(allInHand({ waiting: 0, visits: changed, nowMinutes: 645 })).toBe(true)
  })
})

/** Checks out every visit still open today, by cash, as the desk would. */
function settleToday(s: BusinessState) {
  const model = s.sales[0]
  for (const a of s.appointments.filter((x) => x.date === DEMO_DATE)) {
    if (a.status === 'cancelled' || a.status === 'no_show' || a.status === 'completed') continue
    a.status = 'completed'
    s.sales.push({
      ...model,
      id: `sale-close-${a.id}`,
      appointmentId: a.id,
      serviceMinor: a.bookedPriceMinor,
      tipMinor: 500,
      totalMinor: a.bookedPriceMinor + 500,
      balanceMinor: a.bookedPriceMinor + 500 - a.bookedDepositMinor,
      depositAppliedMinor: a.bookedDepositMinor,
      method: 'cash',
    })
  }
  return s
}

describe('The closing ledger', () => {
  it('keeps "Before you close" until every visit today is checked out', () => {
    const s = seed('UK')
    const day = closingLedger(s)
    expect(day.settled).toBe(false)
    expect(day.ledger).toBeNull()
    // Nine still to come and Amelia in the studio.
    expect(day.open).toBe(10)
    expect(day.total).toBe(12)
  })
  it('reads the settled day from the record, with the Business page’s own money rules', () => {
    const s = settleToday(seed('UK'))
    const day = closingLedger(s)
    const figures = report(s, 1)
    expect(day.settled).toBe(true)
    expect(day.ledger).toMatchObject({
      guestsSeen: 12,
      visits: 12,
      takingsMinor: figures.revenue,
      tipsMinor: figures.tips,
      productsMinor: figures.retail,
    })
    // Theo rents his chair: his guests count as seen, but his takings are his own.
    expect(day.ledger!.rentersMinor).toBeGreaterThan(0)
    const all = s.sales
      .filter((x) => s.appointments.find((a) => a.id === x.appointmentId)?.date === DEMO_DATE)
      .reduce((sum, x) => sum + x.serviceMinor, 0)
    expect(day.ledger!.takingsMinor).toBeLessThan(all)
    // Rebooked counts visits with a next visit booked from them at checkout.
    const rebooked = s.appointments.filter(
      (a) =>
        a.date === DEMO_DATE &&
        s.appointments.some((n) => n.rebookedFromId === a.id && n.status === 'confirmed'),
    ).length
    expect(day.ledger!.rebooked).toBe(rebooked)
    expect(CLOSING_LINE).toBe('Studio closed. See you tomorrow.')
  })
  it('counts a first-time guest only when they had never been seen before today', () => {
    const s = settleToday(seed('UK'))
    const before = closingLedger(s).ledger!.firstTime
    const regular = s.appointments.find(
      (a) =>
        a.date === DEMO_DATE &&
        s.appointments.some(
          (b) => b.clientId === a.clientId && b.date < DEMO_DATE && b.status === 'completed',
        ),
    )!
    for (const earlier of s.appointments.filter(
      (b) => b.clientId === regular.clientId && b.date < DEMO_DATE,
    ))
      earlier.status = 'cancelled'
    expect(closingLedger(s).ledger!.firstTime).toBe(before + 1)
  })
  it('writes one human note: a birthday tomorrow, or who comes first', () => {
    const s = settleToday(seed('UK', { regulars: true }))
    const tomorrow = addDays(DEMO_DATE, 1)
    const first = s.appointments
      .filter((a) => a.date === tomorrow && a.status === 'confirmed')
      .sort((a, b) => a.startMinutes - b.startMinutes)[0]
    expect(first).toBeDefined()
    const client = s.clients.find((c) => c.id === first.clientId)!
    const name = client.name.split(' ')[0]
    expect(closingLedger(s).ledger!.note).toMatch(new RegExp(`^Tomorrow starts with ${name} at`))
    client.birthday = tomorrow.slice(5)
    expect(closingLedger(s).ledger!.note).toMatch(
      new RegExp(`^${name} comes in tomorrow at .+, on their birthday\\.$`),
    )
  })
  it('mentions a guest seen today whose birthday is tomorrow, when nobody booked has one', () => {
    const s = settleToday(seed('UK'))
    const seen = s.clients.find((c) => c.id === 'client-3')!
    seen.birthday = addDays(DEMO_DATE, 1).slice(5)
    expect(closingLedger(s).ledger!.note).toBe(
      `${seen.name.split(' ')[0]}, seen today, has a birthday tomorrow.`,
    )
  })
  it('counts only one location when asked', () => {
    const s = settleToday(seed('UK'))
    expect(closingLedger(s, 'loc-elsewhere')).toMatchObject({ settled: false, total: 0 })
  })
})

describe('the guest’s label', () => {
  it('carries only the guest’s own first name, nothing else of theirs', () => {
    const s = seed('UK')
    const view = guestView(s, 'visit-noor', Date.parse('2026-10-06T08:00:00.000Z'))
    expect(view.guest).toEqual({ firstName: 'Noor' })
    expect(JSON.stringify(view)).not.toMatch(/Ahmed|noor\.ahmed@example\.com|7700 900004/)
  })
})
