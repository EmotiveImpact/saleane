import { describe, expect, it } from 'vitest'
import { execute } from './commands'
import type { Command } from './commands'
import type { BusinessState } from './model'
import { seed } from './seed'
import { operations } from './operations'
import type { Operations } from './operations'
import { guestMoveBlock, guestView } from './guest'
import { GUEST_MOVE_DAYS, guestMoveDays, guestMoveTimes } from './guestMove'

// The sample studio's day is Tuesday 6 October 2026, open 9:00 to 18:00 in London.
const now = Date.parse('2026-10-06T08:00:00.000Z')
const contact = {
  name: 'Moving Guest',
  email: 'moving.guest@example.invalid',
  phone: '+44 7700 900444',
  marketingConsent: false,
}

/** A 60-minute facial (with 15 minutes' rest) with Maya, booked online. */
function booked(date: string, startMinutes = 600) {
  const result = execute(
    seed('UK'),
    {
      type: 'book',
      input: {
        serviceId: 'service-facial',
        staffId: 'staff-maya',
        date,
        startMinutes,
        contact,
        source: 'online',
      },
    } as Command,
    new Date(now).toISOString(),
    () => crypto.randomUUID(),
  )
  if (!result.ok) throw new Error(result.error)
  const visit = result.state.appointments.find(
    (a) => a.date === date && a.startMinutes === startMinutes && a.staffId === 'staff-maya',
  )!
  return { s: result.state, id: visit.id }
}
const withOperations = (s: BusinessState, change: Partial<Operations>): BusinessState => ({
  ...s,
  operations: { ...operations(s), ...change },
})
const everyDay = (open: number, close: number) =>
  Array.from({ length: 7 }, (_, day) => ({ day, open, close, closed: false }))

describe('a guest moving their own visit', () => {
  it('can move it online until the same cutoff as cancelling with the deposit given back', () => {
    const { s, id } = booked('2026-10-08')
    const cutoff = Date.parse(guestView(s, id, now).cancellation.cutoffAt)
    expect(new Date(cutoff).toISOString()).toBe('2026-10-07T09:00:00.000Z')
    expect(guestMoveBlock(s, id, now)).toBeNull()
    expect(guestMoveBlock(s, id, cutoff - 1)).toBeNull()
    expect(guestView(s, id, now).move).toEqual({ available: true })
    expect(guestMoveBlock(s, id, cutoff)).toBe('cutoff')
    expect(guestView(s, id, cutoff).move).toEqual({ available: false, reason: 'cutoff' })
    // Not while the studio has stopped taking bookings online.
    const off = withOperations(s, { bookingEnabled: false })
    expect(guestView(off, id, now).move).toEqual({ available: false, reason: 'off' })
    // Nothing to offer once the visit is under way or cancelled.
    expect(guestMoveBlock(s, id, Date.parse('2026-10-08T09:00:00.000Z'))).toBe('closed')
    const cancelled = {
      ...s,
      appointments: s.appointments.map((a) =>
        a.id === id ? { ...a, status: 'cancelled' as const } : a,
      ),
    }
    expect(guestMoveBlock(cancelled, id, now)).toBe('closed')
    expect(guestView(cancelled, id, now).move).toBeUndefined()
  })

  it('offers sixty days from today, closed days greyed, never past the link’s life', () => {
    const { s, id } = booked('2026-10-08')
    const days = guestMoveDays(s, id, now)
    expect(days).toHaveLength(GUEST_MOVE_DAYS)
    expect(days[0]).toEqual({ date: '2026-10-06', open: true })
    expect(days.at(-1)).toEqual({ date: '2026-12-04', open: true })

    const sundays = everyDay(540, 1080).map((h) => (h.day === 0 ? { ...h, closed: true } : h))
    const closure = {
      id: 'closure-training',
      date: '2026-10-15',
      startMinutes: 0,
      endMinutes: 1440,
      reason: 'Team training',
    }
    const shut = withOperations(s, { hours: sundays, closures: [closure] })
    const open = (date: string) => guestMoveDays(shut, id, now).find((d) => d.date === date)?.open
    expect(open('2026-10-11')).toBe(false)
    expect(open('2026-10-15')).toBe(false)
    expect(open('2026-10-14')).toBe(true)
    // A closure for part of the day, or for one person, leaves the day open.
    const morning = withOperations(s, { closures: [{ ...closure, endMinutes: 720 }] })
    expect(guestMoveDays(morning, id, now).find((d) => d.date === '2026-10-15')?.open).toBe(true)

    // Today is shut once the studio has closed for the day.
    expect(guestMoveDays(s, id, Date.parse('2026-10-06T17:00:00.000Z'))[0].open).toBe(false)
    // The link stops opening on 20 October, so the last day offered leaves room before that.
    const capped = guestMoveDays(s, id, now, Date.parse('2026-10-20T12:00:00.000Z'))
    expect(capped.at(-1)!.date).toBe('2026-10-18')
  })

  it('offers free times with the same professional, or anyone qualified', () => {
    const { s, id } = booked('2026-10-08')
    const same = guestMoveTimes(s, id, '2026-10-08', now, false)
    expect(same.length).toBeGreaterThan(0)
    expect(same.every((t) => t.staffId === 'staff-maya' && t.professional === 'Maya')).toBe(true)
    // Not the visit's own time, and only times the whole treatment and rest fit in the day.
    expect(same.some((t) => t.startMinutes === 600)).toBe(false)
    expect(same.every((t) => t.startMinutes >= 540 && t.startMinutes + 75 <= 1080)).toBe(true)
    const anyone = guestMoveTimes(s, id, '2026-10-08', now, true)
    expect(anyone.length).toBeGreaterThanOrEqual(same.length)
    // Maya keeps every time she is free for; Theo does not do facials.
    for (const time of same) expect(anyone).toContainEqual(time)
    expect(anyone.some((t) => t.staffId === 'staff-theo')).toBe(false)
    // A time already gone today is never offered.
    const later = Date.parse('2026-10-06T11:00:00.000Z')
    expect(
      guestMoveTimes(s, id, '2026-10-06', later, true).every((t) => t.startMinutes > 720),
    ).toBe(true)
  })
})

describe('asking to come in sooner', () => {
  it('is offered only for a visit a few days away', () => {
    const soon = booked('2026-10-08')
    expect(guestView(soon.s, soon.id, now).waitlist).toBeUndefined()
    const later = booked('2026-10-09')
    // The studio closes at 18:00, too early to start a 75-minute treatment in the evening.
    expect(guestView(later.s, later.id, now).waitlist).toEqual({
      joined: null,
      offered: ['morning', 'afternoon'],
    })
  })

  it('offers only the parts of the day the treatment could start in', () => {
    const { s, id } = booked('2026-10-09')
    // Open late: every part of the day suits, so nothing is left out.
    expect(guestView(withOperations(s, { hours: everyDay(540, 1260) }), id, now).waitlist).toEqual({
      joined: null,
    })
    // Open from noon until 17:30: afternoons only.
    expect(guestView(withOperations(s, { hours: everyDay(720, 1050) }), id, now).waitlist).toEqual({
      joined: null,
      offered: ['afternoon'],
    })
  })
})
