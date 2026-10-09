import { describe, expect, it } from 'vitest'
import { execute } from './commands'
import type { CommandResult } from './commands'
import { seed } from './seed'
import { DEMO_DATE, parseState } from './model'
import type { BusinessState } from './model'
import { addDays } from './format'
import { defaultOperations } from './operations'
import { composeMessage, planMessages } from './reminders'
import {
  alsoBookedLine,
  cancelledTooLine,
  laterInRepeat,
  repeatDates,
  repeatLabel,
  repeatVisits,
} from './repeat'

// NEXT-09: a client who comes every few weeks has the next visits booked in one go, each a visit
// of its own that can move or be cancelled alone, or cancelled with the ones after it.
const first = addDays(DEMO_DATE, 1)
const booking = {
  clientId: 'client-1',
  serviceId: 'service-facial',
  staffId: 'staff-maya',
  date: first,
  startMinutes: 540,
  source: 'desk' as const,
}
function ok(result: CommandResult): asserts result is Extract<CommandResult, { ok: true }> {
  if (!result.ok) throw new Error(result.error)
}
let ids = 0
const makeId = () => `id-${++ids}`
function bookEvery(s: BusinessState, everyWeeks = 4, count = 4, now?: string) {
  const visits = repeatDates(first, everyWeeks, count)
    .slice(1)
    .map((date) => ({ date, startMinutes: 540 }))
  const result = execute(s, { type: 'book-repeat', booking, everyWeeks, visits }, now, makeId)
  ok(result)
  const made = repeatVisits(
    result.state,
    result.state.appointments.find((a) => a.id === result.recordId)!,
  )
  return { state: result.state, made, recordId: result.recordId }
}

describe('repeat visits', () => {
  it('books each visit on its own, linked as one repeat', () => {
    const s = seed('UK')
    const { state, made, recordId } = bookEvery(s)
    expect(made.map((a) => a.date)).toEqual(repeatDates(first, 4, 4))
    expect(made[0].id).toBe(recordId)
    expect(new Set(made.map((a) => a.repeat?.id)).size).toBe(1)
    expect(made.every((a) => a.status === 'confirmed' && a.staffId === 'staff-maya')).toBe(true)
    expect(state.revision).toBe(s.revision + 1)
    expect(repeatLabel(state, made[1])).toBe('Visit 2 of 4, repeating every 4 weeks')
    const lines = state.events.filter(
      (e) => e.type === 'booked' && made.some((a) => a.id === e.appointmentId),
    )
    expect(lines).toHaveLength(4)
    expect(lines.at(-1)!.detail).toMatch(/Visit 4 of 4, repeating every 4 weeks\.$/)
  })

  it('books nothing when a later visit cannot be booked, and says which', () => {
    const s = seed('UK')
    const { state } = bookEvery(s)
    const clash = execute(
      state,
      {
        type: 'book-repeat',
        booking: { ...booking, clientId: 'client-2', date: addDays(first, 7) },
        everyWeeks: 3,
        visits: [{ date: addDays(first, 28), startMinutes: 540 }],
      },
      undefined,
      makeId,
    )
    expect(clash.ok).toBe(false)
    if (!clash.ok)
      expect(clash.error).toMatch(
        /^Wednesday 4 November at 09:00: That time is no longer available\./,
      )
  })

  it('keeps the rhythm, a year at most and the studio’s own hand', () => {
    const s = seed('UK')
    const book = (everyWeeks: number, dates: string[], source: 'desk' | 'online' = 'desk') =>
      execute(s, {
        type: 'book-repeat',
        booking: { ...booking, source },
        everyWeeks,
        visits: dates.map((date) => ({ date, startMinutes: 540 })),
      })
    const offBeat = book(4, [addDays(first, 21)])
    expect(offBeat.ok || offBeat.error).toBe(
      'Each repeat visit falls every 4 weeks after the first.',
    )
    const backwards = book(4, [addDays(first, 56), addDays(first, 28)])
    expect(backwards.ok).toBe(false)
    const tooFar = book(
      12,
      [1, 2, 3, 4, 5].map((n) => addDays(first, n * 84)),
    )
    expect(tooFar.ok || tooFar.error).toBe('Repeat visits can be booked up to a year ahead.')
    // Twelve visits at most, the first included, whatever a request asks for.
    const thirteen = book(
      1,
      Array.from({ length: 12 }, (_, n) => addDays(first, (n + 1) * 7)),
    )
    expect(thirteen.ok).toBe(false)
    expect(
      book(
        1,
        Array.from({ length: 11 }, (_, n) => addDays(first, (n + 1) * 7)),
      ).ok,
    ).toBe(true)
    const online = book(4, [addDays(first, 28)], 'online')
    expect(online.ok || online.error).toBe('Repeat visits are booked by the studio.')
    expect(
      execute(s, { type: 'book-repeat', booking, everyWeeks: 7, visits: [] } as never).ok,
    ).toBe(false)
  })

  it('moves one visit alone', () => {
    const { state, made } = bookEvery(seed('UK'))
    const moved = execute(state, {
      type: 'reschedule',
      appointmentId: made[1].id,
      date: made[1].date,
      startMinutes: 600,
      staffId: 'staff-maya',
    })
    ok(moved)
    const after = repeatVisits(moved.state, made[0])
    expect(after.map((a) => a.startMinutes)).toEqual([540, 600, 540, 540])
    expect(after[1].repeat).toEqual(made[1].repeat)
  })

  it('cancels one visit, or that visit and the ones after it', () => {
    const { state, made } = bookEvery(seed('UK'))
    const one = execute(state, { type: 'cancel', appointmentId: made[1].id, reason: 'Away' })
    ok(one)
    expect(repeatVisits(one.state, made[0]).map((a) => a.status)).toEqual([
      'confirmed',
      'cancelled',
      'confirmed',
      'confirmed',
    ])
    expect(repeatLabel(one.state, made[2])).toBe('Visit 2 of 3, repeating every 4 weeks')

    const rest = execute(state, {
      type: 'cancel',
      appointmentId: made[1].id,
      reason: 'Moving away',
      andLater: true,
    })
    ok(rest)
    expect(repeatVisits(rest.state, made[0]).map((a) => a.status)).toEqual([
      'confirmed',
      'cancelled',
      'cancelled',
      'cancelled',
    ])
    const notes = rest.state.events.filter((e) => e.type === 'cancelled').slice(-3)
    expect(notes.map((e) => e.appointmentId)).toEqual(made.slice(1).map((a) => a.id))
    expect(notes[0].detail).not.toMatch(/earlier visit/)
    expect(notes[1].detail).toMatch(
      /^Moving away\. Cancelled with the earlier visit of its repeat\./,
    )
    expect(laterInRepeat(rest.state, made[0])).toEqual([])
  })

  it('lets a guest cancel only their own visit', () => {
    const { state, made } = bookEvery(seed('UK'))
    const result = execute(state, {
      type: 'cancel',
      appointmentId: made[0].id,
      reason: 'Guest cancelled',
      deposit: 'retained',
      andLater: true,
    })
    expect(result.ok || result.error).toBe('A guest cancels one visit at a time.')
  })

  it('refuses a repeat that mixes clients or rhythms', () => {
    const { state, made } = bookEvery(seed('UK'))
    const broken = structuredClone(state)
    broken.appointments.find((a) => a.id === made[2].id)!.clientId = 'client-2'
    expect(() => parseState(broken, 'UK')).toThrow('Broken repeat booking.')
    const rhythm = structuredClone(state)
    rhythm.appointments.find((a) => a.id === made[2].id)!.repeat!.everyWeeks = 2
    expect(() => parseState(rhythm, 'UK')).toThrow('Broken repeat booking.')
  })
})

describe('messages for repeat visits', () => {
  // A local studio sends messages; the sample studio never does. Its sample payments are not valid
  // there, so the visits are booked and cancelled in the sample and planned as a local studio.
  const local = (s: BusinessState) => ({
    ...s,
    operations: { ...defaultOperations('local'), hours: defaultOperations().hours },
  })
  const withPhone = () => {
    const s = seed('UK')
    s.clients.find((c) => c.id === 'client-1')!.phone = '+44 7700 900333'
    return s
  }
  const now = '2026-10-06T08:00:00.000Z'

  it('confirms the visits together, in the first one’s message', () => {
    const { state, made } = bookEvery(withPhone(), 2, 3, now)
    const plan = planMessages(local(state), '2026-10-06T08:05:00.000Z', [])
    const confirmations = plan.filter((m) => m.kind === 'confirmation' && m.clientId === 'client-1')
    expect(confirmations.map((m) => `${m.appointmentId}:${m.channel}`).sort()).toEqual([
      `${made[0].id}:email`,
      `${made[0].id}:sms`,
    ])
    expect(alsoBookedLine(state, made[0])).toBe(
      'Also booked, every 2 weeks: Wednesday 21 October and Wednesday 4 November, each at 09:00.',
    )
    const email = confirmations.find((m) => m.channel === 'email')!
    expect(email.body).toContain(alsoBookedLine(state, made[0]))
    const text = confirmations.find((m) => m.channel === 'sms')!
    expect(text.body).toContain('Also booked: 2 more visits, every 2 weeks.')
  })

  it('does not confirm a later visit again once the first is cancelled', () => {
    const { state, made } = bookEvery(withPhone(), 2, 3, now)
    const sent = planMessages(local(state), '2026-10-06T08:05:00.000Z', []).map((m) => ({
      ...m,
      status: 'test' as const,
    }))
    const off = execute(
      state,
      { type: 'cancel', appointmentId: made[0].id, reason: 'Unwell' },
      '2026-10-06T09:00:00.000Z',
    )
    ok(off)
    const next = planMessages(local(off.state), '2026-10-06T09:05:00.000Z', sent)
    expect(next.filter((m) => m.kind === 'confirmation' && m.clientId === 'client-1')).toEqual([])
    expect(
      next
        .filter((m) => m.kind === 'cancelled' && m.clientId === 'client-1')
        .map((m) => m.appointmentId),
    ).toEqual([made[0].id, made[0].id])
  })

  it('tells the guest once when the visits are cancelled together', () => {
    const { state, made } = bookEvery(withPhone(), 2, 3, now)
    const sent = planMessages(local(state), '2026-10-06T08:05:00.000Z', []).map((m) => ({
      ...m,
      status: 'test' as const,
    }))
    const off = execute(
      state,
      { type: 'cancel', appointmentId: made[0].id, reason: 'Moving away', andLater: true },
      '2026-10-06T09:00:00.000Z',
    )
    ok(off)
    const cancelled = planMessages(local(off.state), '2026-10-06T09:05:00.000Z', sent).filter(
      (m) => m.kind === 'cancelled' && m.clientId === 'client-1',
    )
    expect(cancelled.map((m) => `${m.appointmentId}:${m.channel}`).sort()).toEqual([
      `${made[0].id}:email`,
      `${made[0].id}:sms`,
    ])
    const visit = off.state.appointments.find((a) => a.id === made[0].id)!
    expect(cancelledTooLine(off.state, visit)).toBe(
      'Your visits on Wednesday 21 October and Wednesday 4 November are cancelled too.',
    )
    expect(cancelled.find((m) => m.channel === 'email')!.body).toContain(
      cancelledTooLine(off.state, visit),
    )
    expect(composeMessage(local(off.state), visit, 'cancelled', 'sms').body).toContain(
      '2 later visits are cancelled too.',
    )
  })

  it('tells the guest a later visit is off when it was named in the first one’s message', () => {
    const { state, made } = bookEvery(withPhone(), 2, 3, now)
    const sent = planMessages(local(state), '2026-10-06T08:05:00.000Z', []).map((m) => ({
      ...m,
      status: 'test' as const,
    }))
    const off = execute(
      state,
      { type: 'cancel', appointmentId: made[2].id, reason: 'Away' },
      '2026-10-06T09:00:00.000Z',
    )
    ok(off)
    const cancelled = planMessages(local(off.state), '2026-10-06T09:05:00.000Z', sent).filter(
      (m) => m.kind === 'cancelled' && m.clientId === 'client-1',
    )
    expect(cancelled.map((m) => m.appointmentId)).toEqual([made[2].id, made[2].id])
  })
})
