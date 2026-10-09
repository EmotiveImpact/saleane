import { describe, expect, it } from 'vitest'
import { execute, previewTogether, slots } from './commands'
import type { Command, CommandResult } from './commands'
import { seed } from './seed'
import { DEMO_DATE, parseState } from './model'
import type { BusinessState } from './model'
import { addDays, timeLabel } from './format'
import { defaultOperations } from './operations'
import { composeMessage, planMessages } from './reminders'
import { affectedVisits } from './schedule'
import {
  bookedByLine,
  bookedWithYouLine,
  cancelledWithLine,
  othersTogether,
  togetherLabel,
  togetherVisits,
} from './together'

// NEXT-08: several people booked together on one day, each a client with a visit of their own.
const day = addDays(DEMO_DATE, 1)
const now = '2026-10-06T08:00:00.000Z'
let ids = 0
const makeId = () => `id-${++ids}`
function ok(result: CommandResult): asserts result is Extract<CommandResult, { ok: true }> {
  if (!result.ok) throw new Error(result.error)
}
/** The first quarter hour on the day when Maya and Sophia are both free. */
function sharedTime(s: BusinessState) {
  const sophia = new Set(slots(s, 'service-restore', 'staff-sophia', day, now))
  return slots(s, 'service-restore', 'staff-maya', day, now).find((t) => sophia.has(t))!
}
function couple(s: BusinessState, start = sharedTime(s)): Command {
  return {
    type: 'book-together',
    booking: {
      clientId: 'client-6',
      serviceId: 'service-restore',
      staffId: 'staff-maya',
      date: day,
      startMinutes: start,
      source: 'desk',
    },
    guests: [
      {
        clientId: 'client-2',
        serviceId: 'service-restore',
        staffId: 'staff-sophia',
        startMinutes: start,
      },
    ],
  }
}
function bookCouple(s = seed('UK')) {
  const result = execute(s, couple(s), now, makeId)
  ok(result)
  const lead = result.state.appointments.find((a) => a.id === result.recordId)!
  return { before: s, state: result.state, lead, party: togetherVisits(result.state, lead) }
}

describe('visits booked together', () => {
  it('books a couple side by side in the room for two, as one change', () => {
    const { before, state, lead, party } = bookCouple()
    expect(party.map((a) => a.clientId)).toEqual(['client-6', 'client-2'])
    expect(party.every((a) => a.resourceId === 'room-two' && a.status === 'confirmed')).toBe(true)
    expect(party.every((a) => a.together?.id === lead.together!.id)).toBe(true)
    expect(party.map((a) => !!a.together!.lead)).toEqual([true, false])
    expect(state.revision).toBe(before.revision + 1)
    expect(togetherLabel(state, lead)).toBe('Booked with Olivia James')
    const lines = state.events.filter(
      (e) => e.type === 'booked' && party.some((a) => a.id === e.appointmentId),
    )
    expect(lines.map((e) => e.detail.split('. ').at(-1))).toEqual([
      'Booked together with Olivia James.',
      'Booked together with Grace Chen.',
    ])
  })

  it('keeps a room for two to one visit for anyone not booked together', () => {
    const s = seed('UK')
    const start = sharedTime(s)
    const first = execute(
      s,
      {
        type: 'book',
        input: {
          clientId: 'client-6',
          serviceId: 'service-restore',
          staffId: 'staff-maya',
          date: day,
          startMinutes: start,
          resourceId: 'room-two',
          source: 'desk',
        },
      },
      now,
      makeId,
    )
    ok(first)
    const stranger = execute(
      first.state,
      {
        type: 'book',
        input: {
          clientId: 'client-2',
          serviceId: 'service-restore',
          staffId: 'staff-sophia',
          date: day,
          startMinutes: start,
          resourceId: 'room-two',
          source: 'desk',
        },
      },
      now,
      makeId,
    )
    expect(stranger.ok).toBe(false)
  })

  it('puts people in rooms of their own when no room for two is free', () => {
    const s = seed('UK')
    for (const room of s.resources) delete room.forTwo
    const { party } = bookCouple(s)
    expect(new Set(party.map((a) => a.resourceId)).size).toBe(2)
  })

  it('books nothing when one person cannot be booked, and says who', () => {
    const s = seed('UK')
    const command = couple(s) as Extract<Command, { type: 'book-together' }>
    command.guests.push({
      clientId: 'client-3',
      serviceId: 'service-facial',
      staffId: 'staff-maya',
      startMinutes: command.booking.startMinutes,
    })
    const result = execute(s, command, now, makeId)
    expect(result.ok || result.error).toBe(
      'Ellie Brooks: That time is no longer available. Choose another time or professional.',
    )
  })

  it('books each person once, with their own email, at the studio', () => {
    const s = seed('UK')
    const twice = couple(s) as Extract<Command, { type: 'book-together' }>
    twice.guests[0].clientId = 'client-6'
    const again = execute(s, twice, now, makeId)
    expect(again.ok || again.error).toMatch(/^Each person is booked once\./)
    const borrowed = couple(s) as Extract<Command, { type: 'book-together' }>
    borrowed.guests[0] = {
      contact: {
        name: 'Amy Lee',
        email: 'Grace.Chen@example.com',
        phone: '+44 7700 900111',
        marketingConsent: false,
      },
      serviceId: 'service-restore',
      staffId: 'staff-sophia',
      startMinutes: twice.booking.startMinutes,
    }
    const result = execute(s, borrowed, now, makeId)
    expect(result.ok || result.error).toBe(
      'Amy Lee: that email is Grace Chen’s. Choose them from your clients, or use their own email.',
    )
    borrowed.guests[0].contact!.email = 'amy.lee@example.com'
    const added = execute(s, borrowed, now, makeId)
    ok(added)
    expect(added.state.clients.some((c) => c.name === 'Amy Lee')).toBe(true)
    const online = couple(s) as Extract<Command, { type: 'book-together' }>
    online.booking.source = 'online'
    const refused = execute(s, online, now, makeId)
    expect(refused.ok || refused.error).toBe('Visits for several people are booked by the studio.')
  })

  it('cancels one visit, or the visit and everyone booked with it', () => {
    const { state, lead, party } = bookCouple()
    const one = execute(state, { type: 'cancel', appointmentId: party[1].id, reason: 'Unwell' })
    ok(one)
    expect(togetherVisits(one.state, lead).map((a) => a.status)).toEqual(['confirmed', 'cancelled'])
    expect(othersTogether(one.state, lead)).toEqual([])
    const all = execute(state, {
      type: 'cancel',
      appointmentId: lead.id,
      reason: 'Wedding moved',
      andTogether: true,
    })
    ok(all)
    expect(togetherVisits(all.state, lead).map((a) => a.status)).toEqual(['cancelled', 'cancelled'])
    const note = all.state.events.filter((e) => e.type === 'cancelled').at(-1)!
    expect(note.appointmentId).toBe(party[1].id)
    expect(note.detail).toMatch(/^Wedding moved\. Cancelled together with Grace Chen’s visit/)
    const guest = execute(state, {
      type: 'cancel',
      appointmentId: lead.id,
      reason: 'Guest cancelled',
      deposit: 'retained',
      andTogether: true,
    })
    expect(guest.ok || guest.error).toBe('A guest cancels one visit at a time.')
  })

  it('keeps a visit moved within the day with the others, and lets one moved to another day go', () => {
    const { state, lead, party } = bookCouple()
    const later = slots(state, 'service-restore', 'staff-sophia', day, now).find(
      (t) => t > party[1].startMinutes + 120,
    )!
    const within = execute(state, {
      type: 'reschedule',
      appointmentId: party[1].id,
      date: day,
      startMinutes: later,
      staffId: 'staff-sophia',
    })
    ok(within)
    expect(togetherVisits(within.state, lead)).toHaveLength(2)
    const nextDay = addDays(day, 1)
    const time = slots(state, 'service-restore', 'staff-sophia', nextDay, now)[0]
    const away = execute(state, {
      type: 'reschedule',
      appointmentId: party[1].id,
      date: nextDay,
      startMinutes: time,
      staffId: 'staff-sophia',
    })
    ok(away)
    expect(away.state.appointments.find((a) => a.id === party[1].id)!.together).toBeUndefined()
    expect(away.state.events.at(-1)!.detail).toMatch(/No longer booked together with the others\.$/)
    expect(togetherLabel(away.state, lead)).toBe('')
  })

  it('refuses a booking for several people split across days, or one person twice', () => {
    const { state, party } = bookCouple()
    const split = structuredClone(state)
    split.appointments.find((a) => a.id === party[1].id)!.date = addDays(day, 1)
    expect(() => parseState(split, 'UK')).toThrow('Broken booking for several people.')
    const same = structuredClone(state)
    same.appointments.find((a) => a.id === party[1].id)!.clientId = 'client-6'
    expect(() => parseState(same, 'UK')).toThrow('Broken booking for several people.')
  })

  it('does not let a room for two become a room for one under two visits', () => {
    const { state } = bookCouple()
    const room = state.resources.find((r) => r.id === 'room-two')!
    const result = execute(
      state,
      { type: 'resource', id: room.id, input: { name: room.name, type: room.type } },
      now,
    )
    expect(result.ok || result.error).toMatch(/Treatment room 2 would no longer take two at once/)
    const single = structuredClone(state)
    single.resources.find((r) => r.id === 'room-two')!.forTwo = undefined
    expect(affectedVisits(state, single, now)).toHaveLength(2)
  })

  it('shows the desk the times still free for the next person', () => {
    const s = seed('UK')
    const start = sharedTime(s)
    // With Treatment room 1 taken, Sophia is free beside Maya only in the room for two.
    s.resources = s.resources.map((r) => (r.id === 'room-one' ? { ...r, archived: true } : r))
    const first = {
      clientId: 'client-6',
      serviceId: 'service-restore',
      staffId: 'staff-maya',
      startMinutes: start,
    }
    const preview = previewTogether(s, day, [first], undefined, now)
    if (!preview.ok) throw new Error(preview.error)
    expect(
      slots(
        preview.state,
        'service-restore',
        'staff-sophia',
        day,
        now,
        undefined,
        preview.together,
      ),
    ).toContain(start)
    expect(slots(preview.state, 'service-restore', 'staff-sophia', day, now)).not.toContain(start)
    const both = previewTogether(
      s,
      day,
      [first, { serviceId: 'service-restore', staffId: 'any', startMinutes: start }],
      undefined,
      now,
    )
    if (!both.ok) throw new Error(both.error)
    expect(both.made.map((a) => [a.staffId, a.resourceId])).toEqual([
      ['staff-maya', 'room-two'],
      ['staff-sophia', 'room-two'],
    ])
  })
})

describe('messages for visits booked together', () => {
  // A local studio sends messages; the sample studio never does (see repeat.test.ts).
  const local = (s: BusinessState) => ({
    ...s,
    operations: { ...defaultOperations('local'), hours: defaultOperations().hours },
  })

  it('tells the person it was booked for who else is coming, and each guest who booked them', () => {
    const { state, lead, party } = bookCouple()
    expect(bookedWithYouLine(state, lead)).toBe(
      `Also booked with you: Olivia James, Deep Restore Massage with Sophia at ${timeLabel(party[1].startMinutes, state.organisation.locale)}.`,
    )
    expect(bookedByLine(state, party[1])).toBe('Booked together with Grace Chen.')
    const plan = planMessages(local(state), '2026-10-06T08:05:00.000Z', [])
    const confirmations = plan.filter(
      (m) => m.kind === 'confirmation' && party.some((a) => a.id === m.appointmentId),
    )
    expect(new Set(confirmations.map((m) => m.clientId))).toEqual(new Set(['client-6', 'client-2']))
    const leadEmail = confirmations.find((m) => m.clientId === 'client-6' && m.channel === 'email')!
    expect(leadEmail.body).toContain(bookedWithYouLine(state, lead))
    const guestEmail = confirmations.find(
      (m) => m.clientId === 'client-2' && m.channel === 'email',
    )!
    expect(guestEmail.body).toContain('Booked together with Grace Chen.')
    expect(composeMessage(local(state), lead, 'confirmation', 'sms').body).toContain(
      'Also booked with you: 1 more person.',
    )
  })

  it('tells each person their visit is off, and the person it was booked for that the others are too', () => {
    const { state, lead, party } = bookCouple()
    const sent = planMessages(local(state), '2026-10-06T08:05:00.000Z', []).map((m) => ({
      ...m,
      status: 'test' as const,
    }))
    const off = execute(
      state,
      { type: 'cancel', appointmentId: lead.id, reason: 'Wedding moved', andTogether: true },
      '2026-10-06T09:00:00.000Z',
    )
    ok(off)
    const cancelled = planMessages(local(off.state), '2026-10-06T09:05:00.000Z', sent).filter(
      (m) =>
        m.kind === 'cancelled' &&
        m.channel === 'email' &&
        party.some((a) => a.id === m.appointmentId),
    )
    expect(cancelled.map((m) => m.clientId).sort()).toEqual(['client-2', 'client-6'])
    expect(cancelled.find((m) => m.clientId === 'client-6')!.body).toContain(
      'The visit booked with yours for Olivia is cancelled too.',
    )
    const visit = off.state.appointments.find((a) => a.id === lead.id)!
    expect(cancelledWithLine(off.state, visit)).toBe(
      'The visit booked with yours for Olivia is cancelled too.',
    )
    expect(composeMessage(local(off.state), visit, 'cancelled', 'sms').body).toContain(
      'The visit booked with yours is cancelled too.',
    )
  })
})
