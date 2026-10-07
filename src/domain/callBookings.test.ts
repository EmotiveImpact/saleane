import { describe, expect, it } from 'vitest'
import { seed } from './seed'
import { dispatch, execute, slots } from './commands'
import type { Command } from './commands'
import type { BusinessState } from './model'
import { can, defaultOperations, operations } from './operations'
import { callsBookedThisWeek, openMissedCalls } from './missedCalls'
import { clientExport } from './privacy'

// V1.5: booking a visit straight from a missed call.
let sequence = 0
const makeId = () => `callbook-${++sequence}`
// 10:00 in London on 6 October.
const AT = '2026-10-06T09:00:00.000Z'
const DAY = '2026-10-13'
function run(s: BusinessState, command: Command, now = AT) {
  const result = execute(s, command, now, makeId)
  if (!result.ok) throw new Error(result.error)
  return result
}
/** A real studio (not a sample) with two calls: client-2's number, and a stranger's. */
function local() {
  // Sample money uses simulated payment methods a real studio never records, so leave it out.
  const state = seed('UK')
  Object.assign(state, { sales: [], payments: [], counterSales: [], giftCards: [], holdings: [] })
  state.events = state.events.filter((e) => !e.saleId)
  state.operations = {
    ...defaultOperations('local'),
    hours: defaultOperations().hours,
    missedCalls: [],
  }
  const known = run(state, { type: 'missed-call', number: '07700 900002' })
  const stranger = run(known.state, { type: 'missed-call', number: '07700 900999' })
  return { s: stranger.state, known: known.recordId!, stranger: stranger.recordId! }
}
function booking(s: BusinessState, extra: Record<string, unknown>): Command {
  const startMinutes = slots(s, 'service-facial', 'staff-maya', DAY)[0]
  return {
    type: 'book',
    input: {
      serviceId: 'service-facial',
      staffId: 'staff-maya',
      date: DAY,
      startMinutes,
      source: 'desk',
      ...extra,
    },
  } as Command
}
const call = (s: BusinessState, id: string) => operations(s).missedCalls!.find((c) => c.id === id)!

describe('booking from a missed call', () => {
  it('links the visit to the call and takes it off the list', () => {
    const { s, known } = local()
    const booked = dispatch(s, booking(s, { clientId: 'client-2', callId: known }), 'Ella', AT)
    if (!booked.ok) throw new Error(booked.error)
    expect(call(booked.state, known)).toMatchObject({
      appointmentId: booked.recordId,
      calledBackAt: AT,
      calledBackBy: 'Ella',
    })
    expect(openMissedCalls(booked.state, AT).map((c) => c.id)).not.toContain(known)
    const event = booked.state.events.find(
      (e) => e.appointmentId === booked.recordId && e.type === 'booked',
    )!
    expect(event.detail).toMatch(/called back after a missed call/)
    expect(callsBookedThisWeek(booked.state, AT)).toBe(1)
    expect(
      clientExport(booked.state, 'client-2', { generatedAt: AT, generatedBy: 'Ella' }).missedCalls,
    ).toEqual([
      expect.objectContaining({
        from: '+447700900002',
        bookedVisit: expect.stringMatching(/^V\d+$/),
      }),
    ])
  })

  it('books a stranger as a new client and matches the call to them', () => {
    const { s, stranger } = local()
    const contact = {
      name: 'Nell Caller',
      email: 'nell@example.invalid',
      phone: '+44 7700 900999',
      marketingConsent: false,
    }
    const booked = run(s, booking(s, { contact, callId: stranger }))
    const visit = booked.state.appointments.find((a) => a.id === booked.recordId)!
    expect(booked.state.clients.find((c) => c.id === visit.clientId)?.name).toBe('Nell Caller')
    expect(call(booked.state, stranger)).toMatchObject({
      clientId: visit.clientId,
      appointmentId: visit.id,
    })
  })

  it('keeps an earlier call back time, and refuses a second visit or another client', () => {
    const { s, known } = local()
    const later = '2026-10-06T10:00:00.000Z'
    const done = run(s, { type: 'missed-call-done', callId: known })
    const booked = run(
      done.state,
      booking(done.state, { clientId: 'client-2', callId: known }),
      later,
    )
    expect(call(booked.state, known).calledBackAt).toBe(AT)
    const again = execute(
      booked.state,
      booking(booked.state, { clientId: 'client-2', callId: known }),
      later,
      makeId,
    )
    expect(again.ok || again.error).toBe('A visit is already booked for that call.')
    const other = execute(s, booking(s, { clientId: 'client-3', callId: known }), AT, makeId)
    expect(other.ok || other.error).toMatch(/another client/)
    const missing = execute(s, booking(s, { clientId: 'client-2', callId: 'nope' }), AT, makeId)
    expect(missing.ok || missing.error).toBe('That call is not on the list.')
  })

  it('counts calls from today and the six days before', () => {
    const { s, known } = local()
    const booked = run(s, booking(s, { clientId: 'client-2', callId: known }))
    // 10:00 in London six and seven days later.
    expect(callsBookedThisWeek(booked.state, '2026-10-12T09:00:00.000Z')).toBe(1)
    expect(callsBookedThisWeek(booked.state, '2026-10-13T09:00:00.000Z')).toBe(0)
  })

  it('does not count a cancelled visit as a call that became a booking', () => {
    const { s, known } = local()
    const booked = run(s, booking(s, { clientId: 'client-2', callId: known }))
    const cancelled = run(booked.state, {
      type: 'cancel',
      appointmentId: booked.recordId!,
      reason: 'Changed plans',
    })
    expect(callsBookedThisWeek(cancelled.state, AT)).toBe(0)
  })

  it('is open to the desk, which can already book and see calls', () => {
    expect(can('reception', 'book') && can('reception', 'missed-call')).toBe(true)
    expect(can('practitioner', 'missed-call')).toBe(false)
  })
})
