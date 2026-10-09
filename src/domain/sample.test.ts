import { describe, expect, it } from 'vitest'
import { seed } from './seed'
import { DEMO_DATE, parseState } from './model'
import type { BusinessState } from './model'
import { addDays } from './format'
import {
  DEMO_MINUTES,
  businessMinutes,
  hoursFor,
  instantFor,
  operations,
  staffHoursFor,
} from './operations'
import { dueClients, report } from './selectors'
import { drifting, unusual } from './insights'
import { payPeriod } from './pay'
import { visitStatusAt } from './sampleDay'
import { guestHereWindow } from './guest'
import { patchTestStanding } from './patchTests'

// The sample studio as the demo shows it, regulars and all, and as the tests use it, with only
// its fifteen named clients. Either way it is a studio that agrees with itself.
const regions = ['UK', 'US'] as const
const full = regions.map((region) => [region, seed(region, { regulars: true })] as const)
const named = regions.map((region) => [region, seed(region, { regulars: false })] as const)
const every = [
  ...full.map(([region, s]) => [`${region} sample`, region, s] as const),
  ...named.map(([region, s]) => [`${region} sample's named clients`, region, s] as const),
]

/** Every moment the record holds, wherever it is. */
function instants(value: unknown, found: string[] = []): string[] {
  if (Array.isArray(value)) for (const item of value) instants(item, found)
  else if (value && typeof value === 'object')
    for (const item of Object.values(value)) instants(item, found)
  else if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(value))
    found.push(value)
  return found
}
const ends = (a: BusinessState['appointments'][number]) =>
  a.startMinutes + a.bookedDurationMinutes + a.bookedBufferMinutes

describe.each(every)('the %s', (_, region, s) => {
  it('is a valid studio record, the same every time', () => {
    expect(parseState(structuredClone(s), region)).toEqual(s)
    expect(seed(region, { regulars: s.clients.length > 15 })).toEqual(s)
    expect(JSON.stringify(s)).not.toMatch(/fixture/i)
  })

  it('books each visit when the studio is open and its person is working, and never twice', () => {
    for (const a of s.appointments) {
      const studio = hoursFor(s, a.date)
      const own = staffHoursFor(s, a.staffId, a.date)
      expect(studio.closed || own.closed, `${a.id} on a day off`).toBe(false)
      expect(a.startMinutes).toBeGreaterThanOrEqual(Math.max(studio.open, own.open))
      expect(ends(a)).toBeLessThanOrEqual(Math.min(studio.close, own.close))
      const clash = s.appointments.find(
        (b) =>
          b !== a &&
          b.date === a.date &&
          (b.staffId === a.staffId || b.resourceId === a.resourceId) &&
          b.startMinutes < ends(a) &&
          a.startMinutes < ends(b),
      )
      expect(clash?.id, `${a.id} overlaps`).toBeUndefined()
    }
  })

  it('stands at 10:45 on the sample day, with nothing recorded after it', () => {
    expect(businessMinutes(s)).toBe(DEMO_MINUTES)
    for (const a of s.appointments.filter((x) => x.date === DEMO_DATE))
      if (a.status !== 'cancelled' && a.status !== 'no_show')
        expect(a.status, a.id).toBe(visitStatusAt(a, DEMO_MINUTES))
    const moment = instantFor(s, DEMO_DATE, DEMO_MINUTES)
    expect(instants(s).filter((at) => at > moment)).toEqual([])
    // A guest says they are here only once their private link lets them.
    for (const a of s.appointments.filter((x) => x.guestHereAt))
      expect(guestHereWindow(s, a.id, Date.parse(a.guestHereAt!)).open, a.id).toBe(true)
  })

  it('keeps each guest’s history in order: booked, then seen, then paid', () => {
    for (const client of s.clients) {
      const own = s.appointments.filter((a) => a.clientId === client.id)
      // A client joins the studio when they first book.
      expect(client.createdAt).toBe(own.map((a) => a.createdAt).sort()[0])
    }
    for (const a of s.appointments) {
      expect(a.createdAt < instantFor(s, a.date, a.startMinutes), `${a.id} booked late`).toBe(true)
      const sale = s.sales.find((x) => x.appointmentId === a.id)
      expect(!!sale, `${a.id} receipt`).toBe(a.status === 'completed')
      if (sale)
        expect(sale.paidAt).toBe(instantFor(s, a.date, a.startMinutes + a.bookedDurationMinutes))
      if (a.rebookedFromId) {
        const before = s.appointments.find((x) => x.id === a.rebookedFromId)!
        expect(before.clientId).toBe(a.clientId)
        expect(before.status).toBe('completed')
        expect(before.date < a.date).toBe(true)
      }
    }
  })

  it('takes feedback only from a guest about their own finished visit, that evening', () => {
    for (const f of s.feedback ?? []) {
      const a = s.appointments.find((x) => x.id === f.appointmentId)!
      expect(a).toMatchObject({ status: 'completed', clientId: f.clientId, staffId: f.staffId })
      expect(f.createdAt > instantFor(s, a.date, a.startMinutes + a.bookedDurationMinutes)).toBe(
        true,
      )
      expect(f.createdAt < instantFor(s, addDays(a.date, 1), 0)).toBe(true)
      // Fewer than five stars always says why.
      if (Math.min(f.visitRating, f.practitionerRating) < 4) expect(f.comment).not.toBe('')
    }
  })

  it('never sells or uses stock it does not have', () => {
    const o = operations(s)
    for (const product of o.products) {
      let held = 0
      for (const m of o.movements
        .filter((x) => x.productId === product.id)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || b.quantity - a.quantity)) {
        held += m.quantity
        expect(held, `${product.name} on ${m.createdAt}`).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('patch tests guests before colour, but for the three colour visits the desk can follow', () => {
    const colour = s.appointments.filter(
      (a) => s.services.find((x) => x.id === a.serviceId)?.patchTest,
    )
    const standing = (a: (typeof colour)[number]) =>
      patchTestStanding(s, a.clientId, instantFor(s, a.date, a.startMinutes)).state
    expect(Object.fromEntries(colour.map((a) => [a.id, standing(a)]))).toMatchObject({
      'visit-gloss-ellie': 'clear',
      'visit-gloss-grace': 'waiting',
      'visit-gloss-luca': 'needed',
    })
    for (const a of colour.filter((x) => x.id.startsWith('visit-r')))
      expect(standing(a), a.id).toBe('clear')
    // A result is recorded once the 48 hours have passed.
    for (const test of s.patchTests ?? [])
      if (test.result)
        expect(Date.parse(test.result.at) - Date.parse(test.testedAt)).toBeGreaterThanOrEqual(
          48 * 3_600_000,
        )
  })

  it('gives everyone two days off a week and closes the studio on Sundays', () => {
    expect(
      operations(s)
        .hours.filter((h) => h.closed)
        .map((h) => h.day),
    ).toEqual([0])
    for (const person of s.staff) expect(person.hours!.filter((h) => h.closed)).toHaveLength(2)
  })

  it('keeps Charlotte, Emily and Jamie as the ones ready to return, and nothing else unusual', () => {
    expect(dueClients(s).map((c) => c.name)).toEqual([
      'Charlotte Hayes',
      'Emily Clarke',
      'Jamie Morgan',
    ])
    expect(drifting(s, DEMO_DATE).map((d) => d.name)).toEqual([
      'Jamie Morgan',
      'Emily Clarke',
      'Charlotte Hayes',
    ])
    expect(unusual(s, DEMO_DATE).map((n) => n.kind)).toEqual(['low-stock'])
  })

  it('gives fictional contact details only', () => {
    for (const client of s.clients) {
      expect(client.email).toMatch(/@example\.com$/)
      expect(client.phone).toMatch(
        region === 'UK' ? /^\+44 7700 900\d{3}$/ : /^\+1 \d{3} 555 01\d{2}$/,
      )
    }
  })
})

describe.each(full)('the %s sample studio, as the demo shows it', (_, s) => {
  it('is busy: most of the past month booked, and every open day this month has visits', () => {
    for (let date = '2026-10-01'; date <= '2026-10-31'; date = addDays(date, 1))
      expect(
        s.appointments.some((a) => a.date === date),
        date,
      ).toBe(!hoursFor(s, date).closed)
    // Three people, each with four or so visits on a working day in the weeks before.
    const r = report(s, 28)
    expect(r.completed).toBeGreaterThan(3 * 20 * 3.5)
  })

  it('rebooks about three visits in five at checkout', () => {
    const r = report(s, 30)
    expect(r.rebookRate).toBeGreaterThan(0.5)
    expect(r.rebookRate).toBeLessThan(0.7)
  })

  it('agrees with Pay about Theo, who rents his chair: his visits are his own takings', () => {
    const theo = payPeriod(s, '2026-10-01', DEMO_DATE).find((row) => row.staff.id === 'staff-theo')
    expect(theo).toMatchObject({ visits: 0, commissionMinor: 0 })
    expect(
      s.appointments.filter(
        (a) => a.staffId === 'staff-theo' && a.status === 'completed' && a.date >= '2026-10-01',
      ).length,
    ).toBeGreaterThan(0)
  })
})
