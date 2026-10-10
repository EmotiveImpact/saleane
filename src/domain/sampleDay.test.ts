import { describe, expect, it } from 'vitest'
import { addDays } from './format'
import { DEMO_DATE } from './model'
import type { BusinessState } from './model'
import { hoursFor, instantFor, staffHoursFor } from './operations'
import { catchUpSampleDay, moveSampleDay } from './sampleDay'
import { shownStatus } from './selectors'
import { seed } from './seed'

// The browser demo moves its London sample studio onto today, without the sample's receipts, and
// lets the real clock run it from there.
const sample = seed('UK', { regulars: true })
const moved = (today: string) => moveSampleDay(seed('UK', { regulars: true }), today)
function demo(today: string, minutes: number) {
  const s = moved(today)
  const o = s.operations!
  const unsold = o.movements.filter((movement) => !movement.saleId && !movement.counterSaleId)
  s.operations = { ...o, mode: 'local', movements: unsold }
  s.sales = []
  s.payments = []
  s.counterSales = []
  s.events = s.events.filter((event) => !event.saleId)
  const now = instantFor(s, today, minutes)
  return { s: catchUpSampleDay(s, Date.parse(now)), now }
}
const onDay = (s: BusinessState, date: string) =>
  s.appointments.filter(
    (a) => a.date === date && a.status !== 'cancelled' && a.status !== 'no_show',
  )

/** Every moment the record holds, wherever it is. */
function instants(value: unknown, found: string[] = []): string[] {
  if (Array.isArray(value)) for (const item of value) instants(item, found)
  else if (value && typeof value === 'object')
    for (const item of Object.values(value)) instants(item, found)
  else if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(value))
    found.push(value)
  return found
}

/** What holds whatever the time: nothing yet to happen is recorded, and the history is in order. */
function agreesWithItself(s: BusinessState, now: string) {
  expect(instants(s).filter((at) => at > now)).toEqual([])
  for (const client of s.clients) {
    const first = s.appointments
      .filter((a) => a.clientId === client.id)
      .map((a) => a.createdAt)
      .sort()[0]
    expect(client.createdAt, client.id).toBe(first)
  }
  for (const a of s.appointments) {
    const booked = s.events.find((e) => e.type === 'booked' && e.appointmentId === a.id)
    if (booked) expect(booked.occurredAt, a.id).toBe(a.createdAt)
    if (!a.rebookedFromId) continue
    const before = s.appointments.find((x) => x.id === a.rebookedFromId)!
    expect(before.status, a.id).toBe('completed')
    const ended = instantFor(s, before.date, before.startMinutes + before.bookedDurationMinutes)
    expect(a.createdAt >= ended, `${a.id} booked before ${before.id} ended`).toBe(true)
  }
  // The desk welcomes guests who are here; a guest may have said so first.
  for (const event of s.events.filter((e) => e.type === 'arrived')) {
    const a = s.appointments.find((x) => x.id === event.appointmentId)!
    if (a.status === 'confirmed') expect(event.occurredAt).toBe(a.guestHereAt)
  }
}

describe('moving the sample studio onto another day', () => {
  it('keeps every visit on a day its studio and person work, and every time on the studio clock', () => {
    for (const today of ['2026-10-09', '2026-11-01', '2027-01-04']) {
      const s = moved(today)
      expect(onDay(s, today).map((a) => [a.id, a.startMinutes])).toEqual(
        onDay(sample, DEMO_DATE).map((a) => [a.id, a.startMinutes]),
      )
      for (const a of s.appointments) {
        const off = hoursFor(s, a.date).closed || staffHoursFor(s, a.staffId, a.date).closed
        expect(off, `${a.id} on ${a.date}`).toBe(false)
      }
      // The studio closes on the day the sample's Sunday has become.
      expect(hoursFor(s, addDays(today, -2)).closed).toBe(true)
      // Amelia was welcomed at 09:26, summer time or not.
      const welcome = s.events.find((e) => e.id === 'event-arrived-visit-amelia')!
      expect(welcome.occurredAt).toBe(instantFor(s, today, 9 * 60 + 26))
    }
  })
})

describe('the demo studio on the real clock', () => {
  it('before opening, has every visit today still to come and nothing yet happened', () => {
    const { s, now } = demo('2026-10-09', 6 * 60 + 7)
    agreesWithItself(s, now)
    // Stage 4: the sample's requests move with it, less the refund for a receipt left out.
    const asked = s.operations!.requests!
    expect(asked.map((r) => r.kind)).toEqual(['price', 'rota'])
    expect(asked[1].rota?.date).toBe(addDays('2026-10-09', 6))
    const today = onDay(s, '2026-10-09')
    expect(today.length).toBe(onDay(sample, DEMO_DATE).length)
    expect(today.map((a) => shownStatus(a))).toEqual(today.map(() => 'confirmed'))
    expect(s.operations!.missedCalls!.filter((call) => call.at.startsWith('2026-10-09'))).toEqual(
      [],
    )
    // Bookings the sample made that morning were made the morning before instead.
    const thatMorning = sample.appointments.filter((a) => a.createdAt.startsWith(DEMO_DATE))
    expect(thatMorning.length).toBeGreaterThan(0)
    for (const a of thatMorning)
      expect(s.appointments.find((x) => x.id === a.id)!.createdAt).toBe(
        new Date(Date.parse(a.createdAt) + 2 * 86_400_000).toISOString(),
      )
  })

  it('at 10:45, is the sample day as the sample shows it', () => {
    const { s, now } = demo('2026-10-09', 10 * 60 + 45)
    agreesWithItself(s, now)
    const shown = (state: BusinessState, date: string) =>
      onDay(state, date).map((a) => [a.id, shownStatus(a)])
    expect(shown(s, '2026-10-09')).toEqual(shown(sample, DEMO_DATE))
    expect(shown(sample, DEMO_DATE)).toEqual(
      expect.arrayContaining([
        ['visit-olivia', 'completed'],
        ['visit-ellie', 'completed'],
        ['visit-amelia', 'arrived'],
        ['visit-noor', 'here'],
        ['visit-ava', 'confirmed'],
      ]),
    )
    expect(s.events.find((e) => e.id === 'event-arrived-visit-noor')).toBeDefined()
    // Emily rang twice before ten.
    expect(s.operations!.missedCalls!.find((call) => call.id === 'missed-call-1')).toMatchObject({
      calls: 2,
    })
  })

  it('at 10:20, has Amelia in her facial and Noor not yet here', () => {
    const { s, now } = demo('2026-10-09', 10 * 60 + 20)
    agreesWithItself(s, now)
    const status = Object.fromEntries(onDay(s, '2026-10-09').map((a) => [a.id, shownStatus(a)]))
    expect(status).toMatchObject({
      'visit-ellie': 'completed',
      'visit-olivia': 'arrived',
      'visit-amelia': 'arrived',
      'visit-noor': 'confirmed',
    })
    expect(s.events.find((e) => e.id === 'event-arrived-visit-noor')).toBeUndefined()
  })

  it('in the afternoon, has the morning done, those under way in the studio and the rest to come', () => {
    const { s, now } = demo('2026-10-09', 14 * 60 + 50)
    agreesWithItself(s, now)
    const status = Object.fromEntries(onDay(s, '2026-10-09').map((a) => [a.id, a.status]))
    expect(status).toMatchObject({
      'visit-amelia': 'completed',
      'visit-noor': 'completed',
      // 13:30 to 14:30, and gone by 14:50.
      'visit-zoe': 'completed',
      'visit-nina': 'arrived',
      'visit-luca': 'arrived',
      'visit-ruby': 'confirmed',
      'visit-isabel': 'confirmed',
    })
  })

  it('after closing, has seen everyone booked today', () => {
    const { s, now } = demo('2026-10-09', 19 * 60 + 30)
    agreesWithItself(s, now)
    expect(new Set(onDay(s, '2026-10-09').map((a) => a.status))).toEqual(new Set(['completed']))
  })
})
