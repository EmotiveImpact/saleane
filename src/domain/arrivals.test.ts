import { describe, expect, it } from 'vitest'
import { seed } from './seed'
import { dispatch, execute } from './commands'
import type { Command } from './commands'
import type { BusinessState } from './model'
import { can, defaultOperations, operations, permissionFor } from './operations'
import { callerNumber, numberLabel, openMissedCalls } from './missedCalls'
import { BOOK_LINK, TEXT_BACK_MS, missedCallTextDue, planMessages } from './reminders'
import type { RecordedMessage } from './reminders'
import { guestHereWindow, guestView } from './guest'
import { practitionerView } from './practitioner'
import { clientExport, erasureReview } from './privacy'
import { MISSED_CALL_LIMIT } from './missedCallsSchema'
import { shownStatus } from './selectors'

// V1.5: missed-call text-back, and "I've arrived" from the guest's private link.
let sequence = 0
const makeId = () => `call-${++sequence}`
function run(s: BusinessState, command: Command, now = '2026-10-06T09:00:00.000Z') {
  const result = execute(s, command, now, makeId)
  if (!result.ok) throw new Error(result.error)
  return result
}
/** A real studio (not a sample), with texts back switched on unless asked otherwise. */
function local(textBack = true) {
  // Sample money uses simulated payment methods a real studio never records, so leave it out.
  const state = seed('UK')
  Object.assign(state, { sales: [], payments: [], counterSales: [], giftCards: [], holdings: [] })
  state.events = state.events.filter((e) => !e.saleId)
  state.operations = {
    ...defaultOperations('local'),
    hours: defaultOperations().hours,
    missedCalls: [],
  }
  if (textBack)
    state.operations.reminders = {
      ...(operations(seed('UK')).reminders ?? {
        confirmations: true,
        reminders: true,
        hoursBefore: 24,
        email: true,
        sms: true,
      }),
      missedCall: true,
    }
  return state
}
const texts = (s: BusinessState, at: string, recorded: RecordedMessage[] = []) =>
  planMessages(s, at, recorded).filter((m) => m.kind === 'missed_call')
// 10:00 in London on 6 October.
const AT = '2026-10-06T09:00:00.000Z'
const later = (minutes: number) => new Date(Date.parse(AT) + minutes * 60000).toISOString()

describe('missed calls', () => {
  it('reads local and international numbers, and refuses anything else', () => {
    const uk = seed('UK')
    const us = seed('US')
    expect(callerNumber(uk, '07700 900123')).toBe('+447700900123')
    expect(callerNumber(uk, '+44 (0)7700-900123')).toBe('+447700900123')
    expect(callerNumber(uk, '+44 7700 900123')).toBe('+447700900123')
    expect(callerNumber(uk, '0044 7700 900123')).toBe('+447700900123')
    expect(callerNumber(us, '(212) 555-0100')).toBe('+12125550100')
    expect(callerNumber(us, '1 212 555 0100')).toBe('+12125550100')
    expect(callerNumber(uk, '(212) 555-0100')).toBe(null)
    expect(callerNumber(uk, 'anonymous')).toBe(null)
    expect(numberLabel('+447700900123')).toBe('+44 7700 900123')
    expect(numberLabel('+12125550100')).toBe('+1 212 555 0100')
    expect(numberLabel('+33612345678')).toBe('+33612345678')
    expect(() => run(local(), { type: 'missed-call', number: 'withheld' })).toThrow(/07700 900123/)
  })

  it('writes a call down once a day per number, matched to the client, until called back', () => {
    const s = local()
    const first = run(s, { type: 'missed-call', number: '07700 900002' })
    const call = operations(first.state).missedCalls![0]
    expect(call).toMatchObject({
      number: '+447700900002',
      calls: 1,
      source: 'desk',
      clientId: 'client-2',
      at: AT,
    })
    const again = run(first.state, { type: 'missed-call', number: '+44 7700 900002' }, later(20))
    expect(operations(again.state).missedCalls).toHaveLength(1)
    expect(operations(again.state).missedCalls![0]).toMatchObject({ calls: 2, lastAt: later(20) })
    expect(openMissedCalls(again.state, later(20)).map((c) => c.id)).toEqual([call.id])
    const done = dispatch(again.state, { type: 'missed-call-done', callId: call.id }, 'Ella', AT)
    if (!done.ok) throw new Error(done.error)
    expect(operations(done.state).missedCalls![0]).toMatchObject({ calledBackBy: 'Ella' })
    expect(openMissedCalls(done.state, later(30))).toEqual([])
    const twice = execute(done.state, { type: 'missed-call-done', callId: call.id }, later(40))
    expect(twice.ok && twice.state).toBe(done.state)
    // Ringing again after the call back opens a new line for the desk.
    const next = run(done.state, { type: 'missed-call', number: '07700 900002' }, later(60))
    expect(operations(next.state).missedCalls).toHaveLength(2)
  })

  it('keeps every call, goes in the client export, and refuses a call when the list is full', () => {
    const s = run(local(), { type: 'missed-call', number: '07700 900002' }).state
    const file = clientExport(s, 'client-2', { generatedAt: AT, generatedBy: 'Ella' })
    expect(file.missedCalls).toEqual([
      { from: '+447700900002', firstCall: AT, lastCall: AT, calls: 1 },
    ])
    expect(
      erasureReview(s, 'client-2', '2026-10-06').removable.find((r) => r.label.includes('Missed')),
    ).toMatchObject({ count: 1 })
    const full = local()
    full.operations!.missedCalls = Array.from({ length: MISSED_CALL_LIMIT }, (_, i) => ({
      id: `old-${i}`,
      number: '+447700900999',
      at: '2026-01-01T09:00:00.000Z',
      lastAt: '2026-01-01T09:00:00.000Z',
      calls: 1,
      source: 'desk' as const,
      actor: 'Ella',
    }))
    expect(() => run(full, { type: 'missed-call', number: '07700 900456' })).toThrow(/full/)
  })

  it('lets the desk log and tick off calls, but not practitioners', () => {
    for (const type of ['missed-call', 'missed-call-done']) {
      const action = permissionFor({ type })
      expect(can('reception', action)).toBe(true)
      expect(can('practitioner', action)).toBe(false)
    }
  })

  it('texts the caller once, soon after, only when switched on', () => {
    const s = run(local(), { type: 'missed-call', number: '07700 900456' }).state
    const call = operations(s).missedCalls![0]
    const plan = texts(s, later(1))
    expect(plan.map((m) => [m.recipient, m.channel, m.slot, m.clientId, m.appointmentId])).toEqual([
      ['+447700900456', 'sms', '+447700900456@2026-10-06', '', ''],
    ])
    expect(plan[0].body).toContain(BOOK_LINK)
    expect(plan[0].body).toContain('sorry we missed your call')
    expect(plan[0].body).toContain('Reply STOP')
    const recorded: RecordedMessage[] = plan.map((m) => ({ ...m, status: 'test' }))
    // Ringing again the same day does not bring a second text.
    const again = run(s, { type: 'missed-call', number: '07700 900456' }, later(5)).state
    expect(texts(again, later(6), recorded)).toEqual([])
    expect(missedCallTextDue(s, call, later(TEXT_BACK_MS / 60000))).toBe(false)
    expect(missedCallTextDue(s, call, AT)).toBe(true)
    expect(texts(local(false), later(1))).toEqual([])
    const off = run(local(false), { type: 'missed-call', number: '07700 900456' }).state
    expect(texts(off, later(1))).toEqual([])
  })

  it('never texts a client who asked for no texts, or after a call back', () => {
    const s = local()
    s.clients.find((c) => c.id === 'client-2')!.noTextReminders = true
    const quiet = run(s, { type: 'missed-call', number: '07700 900002' }).state
    expect(texts(quiet, later(1))).toEqual([])
    const open = run(local(), { type: 'missed-call', number: '07700 900456' }).state
    const id = operations(open).missedCalls![0].id
    const called = run(open, { type: 'missed-call-done', callId: id }).state
    expect(texts(called, later(1))).toEqual([])
    const noTexts = local()
    noTexts.operations!.reminders = { ...noTexts.operations!.reminders!, sms: false }
    expect(
      texts(run(noTexts, { type: 'missed-call', number: '07700 900456' }).state, later(1)),
    ).toEqual([])
  })

  it('asks the caller to wait for a call back when online booking is off', () => {
    const s = run(local(), { type: 'missed-call', number: '07700 900456' }).state
    s.operations!.bookingEnabled = false
    expect(texts(s, later(1))[0].body).not.toContain(BOOK_LINK)
  })
})

describe('I have arrived', () => {
  // Noor's facial is at 11:00 in London (10:00Z) on 6 October.
  const visit = 'visit-noor'
  const fresh = () => {
    const s = local(false)
    delete s.appointments.find((a) => a.id === visit)!.guestHereAt
    return s
  }

  it('opens half an hour before the visit and closes when it ends', () => {
    const s = fresh()
    expect(guestHereWindow(s, visit, Date.parse('2026-10-06T09:29:00.000Z'))).toMatchObject({
      open: false,
      reason: 'early',
      opensAt: '2026-10-06T09:30:00.000Z',
    })
    expect(guestHereWindow(s, visit, Date.parse('2026-10-06T09:30:00.000Z')).open).toBe(true)
    expect(guestHereWindow(s, visit, Date.parse('2026-10-06T11:30:00.000Z')).reason).toBe('closed')
    expect(() => run(s, { type: 'guest-here', appointmentId: visit }, AT)).toThrow(
      /30 minutes before/,
    )
  })

  it('tells the desk once, leaves the welcome to the desk, and only from the private link', () => {
    const now = '2026-10-06T09:45:00.000Z'
    const result = dispatch(
      fresh(),
      { type: 'guest-here', appointmentId: visit },
      'Guest (private link)',
      now,
    )
    if (!result.ok) throw new Error(result.error)
    const a = result.state.appointments.find((x) => x.id === visit)!
    expect(a).toMatchObject({ status: 'confirmed', guestHereAt: now })
    expect(shownStatus(a)).toBe('here')
    expect(result.state.events.at(-1)).toMatchObject({
      type: 'arrived',
      title: 'Said they have arrived',
      actor: 'Guest (private link)',
    })
    const again = execute(result.state, { type: 'guest-here', appointmentId: visit }, now)
    expect(again.ok && again.state).toBe(result.state)
    expect(guestView(result.state, visit, Date.parse(now)).here).toEqual({
      open: true,
      opensAt: '2026-10-06T09:30:00.000Z',
      saidAt: now,
      welcomed: false,
    })
    const mine = practitionerView(result.state, a.staffId, '2026-10-06')
    expect(mine.appointments.find((x) => x.id === visit)?.guestHere).toBe(true)
    const welcomed = run(result.state, { type: 'arrive', appointmentId: visit }, now).state
    expect(shownStatus(welcomed.appointments.find((x) => x.id === visit)!)).toBe('arrived')
    expect(guestView(welcomed, visit, Date.parse(now)).here?.welcomed).toBe(true)
    for (const role of ['owner', 'manager', 'reception', 'practitioner'] as const)
      expect(can(role, permissionFor({ type: 'guest-here' }))).toBe(false)
  })

  it('is forgotten when the visit moves, and not offered on other days', () => {
    const s = run(
      fresh(),
      { type: 'guest-here', appointmentId: visit },
      '2026-10-06T09:45:00.000Z',
    ).state
    const moved = run(
      s,
      {
        type: 'reschedule',
        appointmentId: visit,
        date: '2026-10-07',
        startMinutes: 660,
        staffId: 'staff-maya',
      },
      '2026-10-06T09:50:00.000Z',
    ).state
    expect(moved.appointments.find((x) => x.id === visit)).not.toHaveProperty('guestHereAt')
    expect(guestView(moved, visit, Date.parse('2026-10-06T09:50:00.000Z')).here).toBeUndefined()
  })
})
