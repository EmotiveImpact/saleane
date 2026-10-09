import { describe, expect, it } from 'vitest'
import { dispatch, execute } from './commands'
import type { Command } from './commands'
import type { BusinessState } from './model'
import { parseState } from './model'
import { can, permissionFor } from './operations'
import { createWorkspace } from './workspace'
import { seed } from './seed'
import { payCsv, payPeriod } from './pay'
import {
  clockedIn,
  clockTime,
  hoursLabel,
  hoursPeriod,
  needsFinish,
  shiftMinutes,
  shifts,
} from './hours'
import { SHIFT_LIMIT } from './hoursSchema'
import { changeWords } from './changeRecord'

// NEXT-07: hours worked, for payroll.
const at = (time: string, date = '2026-10-06') => `${date}T${time}:00.000Z`
// The studio is in London, an hour ahead of UTC in October: 08:00Z is 09:00 at the studio.
const nine = at('08:00')
let sequence = 0
function studio(): BusinessState {
  const s = createWorkspace({ name: 'Hours test studio', region: 'UK' })
  const sample = seed('UK')
  for (const key of ['clients', 'services', 'staff', 'resources'] as const)
    Object.assign(s, {
      [key]: sample[key].map((row) => ({ ...row, organisationId: s.organisation.id })),
    })
  return s
}
function run(s: BusinessState, command: Command, now = nine) {
  return execute(s, command, now, () => `hours-${++sequence}`)
}
function apply(s: BusinessState, command: Command, now = nine) {
  const result = run(s, command, now)
  if (!result.ok) throw new Error(result.error)
  return result.state
}
function refusal(s: BusinessState, command: Command, now = nine) {
  const result = run(s, command, now)
  return result.ok ? null : result.error
}
const save = (
  input: Partial<{
    staffId: string
    date: string
    start: string
    end: string
    breakMinutes: number
    reason: string
  }>,
  id?: string,
): Command => ({
  type: 'shift-save',
  ...(id ? { id } : {}),
  input: {
    staffId: 'staff-maya',
    date: '2026-10-05',
    start: '09:00',
    end: '17:30',
    breakMinutes: 30,
    reason: 'Forgot to clock',
    ...input,
  },
})

describe('hours worked', () => {
  it('clocks someone in and out, less their break', () => {
    let s = apply(studio(), { type: 'clock-in', staffId: 'staff-maya' })
    const open = clockedIn(s, 'staff-maya', Date.parse(nine))!
    expect(open).toMatchObject({ date: '2026-10-06', start: nine, source: 'clock' })
    expect(clockTime(s, open.start)).toBe('09:00')
    expect(shiftMinutes(open)).toBeNull()
    expect(refusal(s, { type: 'clock-in', staffId: 'staff-maya' }, at('09:00'))).toBe(
      'Maya clocked in at 09:00 already.',
    )
    // A break as long as the shift is a mistake.
    expect(
      refusal(s, { type: 'clock-out', staffId: 'staff-maya', breakMinutes: 60 }, at('08:45')),
    ).toBe('The break is as long as the shift. Choose a shorter break.')
    s = apply(s, { type: 'clock-out', staffId: 'staff-maya', breakMinutes: 30 }, at('16:40'))
    expect(clockedIn(s, 'staff-maya', Date.parse(at('16:41')))).toBeUndefined()
    const [done] = shifts(s)
    expect(done.end).toBe(at('16:40'))
    expect(shiftMinutes(done)).toBe(8 * 60 + 10)
    expect(hoursLabel(shiftMinutes(done)!)).toBe('8 h 10 min')
    expect(refusal(s, { type: 'clock-out', staffId: 'staff-maya', breakMinutes: 0 })).toBe(
      'Maya is not clocked in.',
    )
    expect(refusal(s, { type: 'clock-in', staffId: 'staff-nobody' })).toBe(
      'Choose someone on the team.',
    )
  })

  it('treats a shift left open past 16 hours as a forgotten clock-out, counted as nothing', () => {
    const s = apply(studio(), { type: 'clock-in', staffId: 'staff-theo' })
    const [open] = shifts(s)
    const later = Date.parse(at('08:01', '2026-10-07'))
    expect(clockedIn(s, 'staff-theo', later)).toBeUndefined()
    expect(needsFinish(open, later)).toBe(true)
    expect(needsFinish(open, Date.parse(at('20:00')))).toBe(false)
    // They can clock in again the next day; the old shift waits for someone to set its finish.
    const next = apply(s, { type: 'clock-in', staffId: 'staff-theo' }, at('08:01', '2026-10-07'))
    const week = hoursPeriod(next, '2026-10-01', '2026-10-07').get('staff-theo')!
    expect(week).toMatchObject({ minutes: 0, open: 2 })
  })

  it('adds missed hours and puts mistakes right, always with a reason', () => {
    let s = apply(studio(), save({}))
    const [added] = shifts(s)
    expect(added).toMatchObject({
      source: 'added',
      date: '2026-10-05',
      start: at('08:00', '2026-10-05'),
      end: at('16:30', '2026-10-05'),
      breakMinutes: 30,
      byHand: { reason: 'Forgot to clock' },
    })
    expect(shiftMinutes(added)).toBe(8 * 60)
    // A finish before the start is the next morning.
    s = apply(s, save({ date: '2026-10-03', start: '18:00', end: '01:00', breakMinutes: 0 }))
    expect(shiftMinutes(shifts(s)[1])).toBe(7 * 60)
    // Changing keeps the same shift and records why.
    s = apply(s, save({ end: '18:00', reason: 'Stayed late for a colour' }, added.id))
    expect(shiftMinutes(shifts(s)[0])).toBe(8 * 60 + 30)
    expect(shifts(s)[0].byHand?.reason).toBe('Stayed late for a colour')
    // What it said before is kept with it.
    expect(shifts(s)[0].earlier).toEqual([
      {
        date: '2026-10-05',
        start: at('08:00', '2026-10-05'),
        end: at('16:30', '2026-10-05'),
        breakMinutes: 30,
        at: nine,
        actor: 'Local operator',
        reason: 'Forgot to clock',
      },
    ])
    expect(hoursPeriod(s, '2026-10-01', '2026-10-06').get('staff-maya')).toMatchObject({
      minutes: 15 * 60 + 30,
      open: 0,
    })

    expect(refusal(s, save({ start: '12:00', end: '14:00' }))).toBe(
      'Maya has hours from 09:00 that day already. Change those instead.',
    )
    expect(refusal(s, save({ date: '2026-10-07' }))).toBe(
      'Add hours only for days that have started.',
    )
    expect(refusal(s, save({ date: '2026-10-06', start: '08:00', end: '11:00' }))).toBe(
      'That finish time has not come yet.',
    )
    expect(refusal(s, save({ date: '2025-08-01' }))).toBe('That day is too long ago to change.')
    expect(refusal(s, save({ date: '2026-10-01', start: '06:00', end: '23:00' }))).toBe(
      'A shift can be up to 16 hours. Check the start and finish.',
    )
    expect(refusal(s, save({ date: '2026-10-01', breakMinutes: 240, end: '13:00' }))).toBe(
      'The break is as long as the shift. Choose a shorter break.',
    )
    expect(refusal(s, save({ staffId: 'staff-theo' }, added.id))).toBe(
      'Hours cannot move to someone else. Remove them and add them for the right person.',
    )
    expect(refusal(s, save({}, 'shift-missing'))).toBe('Those hours are not in the record.')
    expect(run(s, save({ reason: 'no' })).ok).toBe(false)
  })

  it('keeps clocked seconds when only the break is put right', () => {
    let s = apply(studio(), { type: 'clock-in', staffId: 'staff-maya' }, '2026-10-06T08:00:37.000Z')
    s = apply(
      s,
      { type: 'clock-out', staffId: 'staff-maya', breakMinutes: 0 },
      '2026-10-06T16:10:12.000Z',
    )
    const [clocked] = shifts(s)
    const later = '2026-10-06T17:00:00.000Z'
    s = apply(
      s,
      save({ date: '2026-10-06', start: '09:00', end: '17:10', breakMinutes: 30 }, clocked.id),
      later,
    )
    expect(shifts(s)[0]).toMatchObject({
      start: '2026-10-06T08:00:37.000Z',
      end: '2026-10-06T16:10:12.000Z',
      breakMinutes: 30,
    })
    expect(shiftMinutes(shifts(s)[0])).toBe(490 - 30)
    // A time that is changed is the minute chosen.
    s = apply(s, save({ date: '2026-10-06', start: '09:00', end: '17:30' }, clocked.id), later)
    expect(shifts(s)[0]).toMatchObject({
      start: '2026-10-06T08:00:37.000Z',
      end: '2026-10-06T16:30:00.000Z',
    })
  })

  it('moves hours put on another day to where the person worked that day', () => {
    let s = apply(studio(), {
      type: 'location',
      input: { name: 'Islington', address: '1 Upper Street' },
    })
    const main = s.organisation.locationId
    const islington = s.operations!.locations![0].id
    // Maya works at Islington on Mondays and at the main location otherwise.
    s.staff.find((p) => p.id === 'staff-maya')!.hours = Array.from({ length: 7 }, (_, day) => ({
      day,
      open: 540,
      close: 1080,
      closed: false,
      ...(day === 1 ? { locationId: islington } : {}),
    }))
    s = apply(s, save({ date: '2026-10-03' }))
    const [added] = shifts(s)
    expect(added.locationId).toBe(main)
    s = apply(s, save({ date: '2026-10-05', reason: 'Wrong day' }, added.id))
    expect(shifts(s)[0]).toMatchObject({ date: '2026-10-05', locationId: islington })
  })

  it('removes hours without deleting them', () => {
    let s = apply(studio(), save({}))
    const [shift] = shifts(s)
    s = apply(s, { type: 'shift-remove', shiftId: shift.id, reason: 'Added twice' })
    expect(shifts(s)).toEqual([])
    expect(s.operations!.shifts![0].removed).toMatchObject({ reason: 'Added twice' })
    expect(hoursPeriod(s, '2026-10-01', '2026-10-06').size).toBe(0)
    expect(refusal(s, { type: 'shift-remove', shiftId: shift.id, reason: 'Again' })).toBe(
      'Those hours are not in the record.',
    )
    // Hours removed in error can be added again.
    expect(run(s, save({})).ok).toBe(true)
  })

  it('names who clocked, changed and removed hours', () => {
    let result = dispatch(
      studio(),
      { type: 'clock-in', staffId: 'staff-maya' },
      'Ada at the desk',
      nine,
    )
    if (!result.ok) throw new Error(result.error)
    result = dispatch(
      result.state,
      { type: 'clock-out', staffId: 'staff-maya', breakMinutes: 0 },
      'Maya Chen',
      at('12:00'),
    )
    if (!result.ok) throw new Error(result.error)
    let [shift] = shifts(result.state)
    expect(shift).toMatchObject({ actor: 'Ada at the desk', endedBy: 'Maya Chen' })
    result = dispatch(
      result.state,
      save({ date: '2026-10-06', start: '09:00', end: '13:00' }, shift.id),
      'Owner Olu',
      at('12:30'),
    )
    if (!result.ok) throw new Error(result.error)
    ;[shift] = shifts(result.state)
    expect(shift.byHand).toMatchObject({ actor: 'Owner Olu', reason: 'Forgot to clock' })
    expect(shift.endedBy).toBe('Maya Chen')
    expect(changeWords['shift-save']).toEqual([
      'team',
      'Changed hours worked',
      'Added hours worked',
    ])
  })

  it('lets everyone clock in, and only owners and managers change hours', () => {
    expect(permissionFor({ type: 'clock-in' })).toBe('clock')
    expect(permissionFor({ type: 'shift-save' })).toBe('shift-fix')
    for (const role of ['owner', 'manager', 'reception', 'general', 'practitioner'] as const)
      expect(can(role, 'clock'), role).toBe(true)
    expect(can('regional', 'clock')).toBe(false)
    expect(can('owner', 'shift-fix')).toBe(true)
    expect(can('manager', 'shift-fix')).toBe(true)
    for (const role of ['reception', 'general', 'practitioner', 'regional'] as const)
      expect(can(role, 'shift-fix'), role).toBe(false)
  })

  it('keeps shifts within a limit and through a save and load', () => {
    const s = apply(studio(), save({}))
    expect(parseState(JSON.parse(JSON.stringify(s)), 'UK').operations?.shifts).toHaveLength(1)
    expect(SHIFT_LIMIT).toBeGreaterThanOrEqual(10 * 300 * 4)
  })

  it('puts hours in the payroll spreadsheet, and keeps someone who has left on it', () => {
    let s = apply(studio(), save({}))
    s = apply(s, save({ staffId: 'staff-theo', start: '10:00', end: '14:15', breakMinutes: 0 }))
    s = { ...s, staff: s.staff.map((p) => (p.id === 'staff-theo' ? { ...p, archived: true } : p)) }
    const rows = payPeriod(s, '2026-10-01', '2026-10-06')
    expect(rows.map((row) => row.staff.id)).toContain('staff-theo')
    const csv = payCsv(
      rows,
      '2026-10-01',
      '2026-10-06',
      'GBP',
      hoursPeriod(s, '2026-10-01', '2026-10-06'),
    )
    const [header, ...lines] = csv.trim().split('\n')
    expect(header.endsWith(',Hours worked,Shifts,Shifts with no finish time')).toBe(true)
    expect(lines.find((line) => line.startsWith('Maya'))).toMatch(/,8\.00,1,0$/)
    expect(lines.find((line) => line.startsWith('Theo'))).toMatch(/,4\.25,1,0$/)
    expect(lines.find((line) => line.startsWith('Sophia'))).toMatch(/,0\.00,0,0$/)
    // Without hours the spreadsheet is as it was.
    expect(payCsv(rows, '2026-10-01', '2026-10-06', 'GBP').split('\n')[0]).not.toContain('Hours')
  })

  it('gives a sample studio a fortnight of hours', () => {
    const s = seed('UK')
    const list = shifts(s)
    expect(list.length).toBeGreaterThan(20)
    expect(list.every((x) => x.end && x.date < '2026-10-06')).toBe(true)
    const month = hoursPeriod(s, '2026-10-01', '2026-10-06')
    for (const row of month.values()) expect(row.minutes).toBeGreaterThan(0)
  })
})
