import { describe, expect, it } from 'vitest'
import { dispatch, execute } from './commands'
import type { Command } from './commands'
import type { BusinessState } from './model'
import { parseState } from './model'
import { can, permissionFor, staffHoursFor } from './operations'
import { createWorkspace } from './workspace'
import { seed } from './seed'
import { availableMinutes } from './selectors'
import { scheduleImpact } from './schedule'
import { holidaySummary, mondayOf, rotaWeek, workingDaysAway } from './timeOff'

// V2: rotas, holidays and time off.
const now = '2026-10-06T08:00:00.000Z'
let sequence = 0
function local(): BusinessState {
  const s = createWorkspace({ name: 'Rota test studio', region: 'UK' })
  const sample = seed('UK')
  for (const key of ['clients', 'services', 'staff', 'resources'] as const)
    Object.assign(s, {
      [key]: sample[key].map((row) => ({ ...row, organisationId: s.organisation.id })),
    })
  return s
}
function run(s: BusinessState, command: Command, at = now) {
  return execute(s, command, at, () => `rota-${++sequence}`)
}
function apply(s: BusinessState, command: Command, at = now) {
  const result = run(s, command, at)
  if (!result.ok) throw new Error(result.error)
  return result.state
}
const away = (staffId: string, from: string, to: string, kind = 'holiday') =>
  ({ type: 'time-off', input: { staffId, from, to, kind } }) as Command
/** A visit with Maya on a day. */
function booked(s: BusinessState, date: string) {
  return apply(s, {
    type: 'import-appointments',
    source: 'Test',
    reviewed: true,
    appointments: [
      {
        clientId: 'client-1',
        serviceId: 'service-facial',
        staffId: 'staff-maya',
        date,
        startMinutes: 600,
        priceMinor: 9500,
        depositPaidMinor: 0,
      },
    ],
  })
}

describe('time off', () => {
  it('stops a person being booked while they are away', () => {
    const s = apply(local(), away('staff-maya', '2026-10-12', '2026-10-16'))
    expect(staffHoursFor(s, 'staff-maya', '2026-10-12').closed).toBe(true)
    // Back at work on the Monday after; Maya does not work weekends.
    expect(staffHoursFor(s, 'staff-maya', '2026-10-19').closed).toBe(false)
    expect(availableMinutes(s, '2026-10-12')).toBeLessThan(availableMinutes(local(), '2026-10-12'))
    expect(run(s, away('staff-maya', '2026-10-16', '2026-10-20')).ok).toBe(false)
    // Booking Maya on a day away is refused.
    expect(run(s, { ...bookingOn('2026-10-13') }).ok).toBe(false)
  })

  it('refuses time off that would strand a booked visit, and names it', () => {
    const s = booked(local(), '2026-10-14')
    const command = away('staff-maya', '2026-10-12', '2026-10-16')
    const clashes = scheduleImpact(s, command as never, now)
    expect(clashes).toHaveLength(1)
    expect(clashes[0].reason).toContain('away (holiday)')
    const result = run(s, command)
    expect(result.ok).toBe(false)
    expect(!result.ok && result.error).toContain('Move or cancel it first')
  })

  it('cancels time off, keeps the record and frees the days', () => {
    let s = apply(local(), away('staff-maya', '2026-10-12', '2026-10-16'))
    const id = s.operations!.timeOff!.at(-1)!.id
    const result = dispatch(s, { type: 'cancel-time-off', timeOffId: id }, 'Ava · owner', now)
    if (!result.ok) throw new Error(result.error)
    s = result.state
    expect(s.operations!.timeOff!.at(-1)).toMatchObject({ cancelledBy: 'Ava · owner' })
    expect(staffHoursFor(s, 'staff-maya', '2026-10-12').closed).toBe(false)
    expect(run(s, { type: 'cancel-time-off', timeOffId: id }).ok).toBe(false)
    // The same days can be booked off again.
    expect(run(s, away('staff-maya', '2026-10-12', '2026-10-13')).ok).toBe(true)
  })

  it('counts working days against the yearly holiday allowance', () => {
    let s = apply(local(), { type: 'leave-allowance', staffId: 'staff-maya', days: 28 })
    // Monday to Sunday: the sample team works every day the venue opens.
    s = apply(s, away('staff-maya', '2026-10-12', '2026-10-18'))
    s = apply(s, away('staff-maya', '2026-10-20', '2026-10-20', 'sick'))
    const days = workingDaysAway(s, { staffId: 'staff-maya', from: '2026-10-12', to: '2026-10-18' })
    expect(holidaySummary(s, 'staff-maya', 2026)).toEqual({
      booked: days,
      allowance: 28,
      left: 28 - days,
    })
    // Over New Year, each day counts in its own year.
    s = apply(s, away('staff-maya', '2026-12-30', '2027-01-02'))
    expect(holidaySummary(s, 'staff-maya', 2027).booked).toBe(
      workingDaysAway(s, { staffId: 'staff-maya', from: '2027-01-01', to: '2027-01-02' }),
    )
    expect(holidaySummary(s, 'staff-sophia', 2026)).toEqual({
      booked: 0,
      allowance: undefined,
      left: undefined,
    })
  })

  it('limits who can record it and how long one stretch is', () => {
    for (const type of ['time-off', 'cancel-time-off', 'leave-allowance']) {
      expect(can('manager', permissionFor({ type }))).toBe(true)
      expect(can('reception', permissionFor({ type }))).toBe(false)
      expect(can('practitioner', permissionFor({ type }))).toBe(false)
    }
    expect(run(local(), away('staff-maya', '2026-10-01', '2026-12-31')).ok).toBe(false)
    expect(run(local(), away('staff-maya', '2026-10-12', '2026-10-11')).ok).toBe(false)
    expect(run(local(), away('nobody', '2026-10-12', '2026-10-12')).ok).toBe(false)
  })

  it('rejects time off for someone not on the team in the ledger', () => {
    const s = apply(local(), away('staff-maya', '2026-10-12', '2026-10-12'))
    const tampered = structuredClone(s)
    tampered.operations!.timeOff![0].staffId = 'missing'
    expect(() => parseState(tampered, 'UK')).toThrow('Invalid time off')
  })

  it('shows the week with hours, visits and who is away', () => {
    const s = seed('UK')
    const week = rotaWeek(s, '2026-10-19')
    const sophia = week.find((row) => row.person.id === 'staff-sophia')!
    expect(sophia.days.slice(0, 5).every((day) => day.state === 'away')).toBe(true)
    const today = rotaWeek(s, mondayOf('2026-10-06'))
    const maya = today.find((row) => row.person.id === 'staff-maya')!
    const tuesday = maya.days.find((day) => day.date === '2026-10-06')!
    expect(tuesday.state === 'working' && tuesday.visits).toBeGreaterThan(0)
    expect(mondayOf('2026-10-06')).toBe('2026-10-05')
    expect(mondayOf('2026-10-11')).toBe('2026-10-05')
  })
})

function bookingOn(date: string): Command {
  return {
    type: 'import-appointments',
    source: 'Test',
    reviewed: true,
    appointments: [
      {
        clientId: 'client-1',
        serviceId: 'service-facial',
        staffId: 'staff-maya',
        date,
        startMinutes: 600,
        priceMinor: 9500,
        depositPaidMinor: 0,
      },
    ],
  } as Command
}
