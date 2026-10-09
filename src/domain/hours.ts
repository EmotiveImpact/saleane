import type { BusinessState } from './model'
import type { Command } from './commandSchema'
import { businessMinutes, instantFor, operations, staffHoursFor } from './operations'
import { hasLocations, staffLocationOn } from './locations'
import { addDays, timeLabel } from './format'
import { SHIFT_EARLIER, SHIFT_LIMIT, SHIFT_MAX_HOURS } from './hoursSchema'
import type { Shift } from './hoursSchema'

/**
 * NEXT-07: hours worked, for payroll. Someone is clocked in while they have a shift with no finish
 * time that started within the last 16 hours. An older one is a forgotten clock-out: it counts for
 * nothing until an owner or manager sets when it ended, and it is shown until they do. SALEANE adds
 * up the hours; it does not pay anyone.
 */
const MINUTE = 60_000
const MAX_OPEN = SHIFT_MAX_HOURS * 60 * MINUTE

type HoursCommand = Extract<
  Command,
  { type: 'clock-in' | 'clock-out' | 'shift-save' | 'shift-remove' }
>
export const HOURS_COMMANDS = ['clock-in', 'clock-out', 'shift-save', 'shift-remove'] as const

/** Every shift still standing, oldest first. */
export function shifts(s: BusinessState) {
  return (operations(s).shifts ?? []).filter((shift) => !shift.removed)
}

/** Minutes worked, less the break; null while it has no finish time. */
export function shiftMinutes(shift: Shift) {
  if (!shift.end) return null
  const worked = Math.round((Date.parse(shift.end) - Date.parse(shift.start)) / MINUTE)
  return Math.max(0, worked - shift.breakMinutes)
}

/** The shift someone is clocked in on now, if any. */
export function clockedIn(s: BusinessState, staffId: string, now: number) {
  return shifts(s).find(
    (shift) => shift.staffId === staffId && !shift.end && now - Date.parse(shift.start) <= MAX_OPEN,
  )
}

/** A shift left open too long to be clocked out: someone must set when it ended. */
export const needsFinish = (shift: Shift, now: number) =>
  !shift.removed && !shift.end && now - Date.parse(shift.start) > MAX_OPEN

export type HoursSummary = {
  staffId: string
  minutes: number
  shifts: Shift[]
  /** Shifts in the period with no finish time yet, counted as nothing until one is set. */
  open: number
}

/** Hours for each person over a run of studio days, newest shift first. */
export function hoursPeriod(s: BusinessState, from: string, to: string) {
  const summary = new Map<string, HoursSummary>()
  for (const shift of shifts(s)) {
    if (shift.date < from || shift.date > to) continue
    const row = summary.get(shift.staffId) ?? {
      staffId: shift.staffId,
      minutes: 0,
      shifts: [],
      open: 0,
    }
    const minutes = shiftMinutes(shift)
    if (minutes === null) row.open += 1
    else row.minutes += minutes
    row.shifts.push(shift)
    summary.set(shift.staffId, row)
  }
  for (const row of summary.values()) row.shifts.sort((a, b) => b.start.localeCompare(a.start))
  return summary
}

/** "7 h 30 min", "8 h" or "45 min". */
export function hoursLabel(minutes: number) {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (!h) return `${m} min`
  return m ? `${h} h ${m} min` : `${h} h`
}
/** "No break", "30 min" or "1 hour". */
export const breakLabel = (minutes: number) =>
  minutes === 0 ? 'No break' : minutes === 60 ? '1 hour' : `${minutes} min`
/** Hours as a number for a spreadsheet: 7.50. */
export const decimalHours = (minutes: number) => (minutes / 60).toFixed(2)

/** "09:05" (or "09:05 AM" in the US) on the studio's clock for an instant. */
export const clockTime = (s: BusinessState, instant: string) =>
  timeLabel(businessMinutes(s, instant), s.organisation.locale)
/** "09:05" for a time field: always the 24-hour clock. */
export function clockValue(s: BusinessState, instant: string) {
  const minutes = businessMinutes(s, instant)
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}
const toMinutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3))

/** Whether two spans of time meet. An open shift runs until now. */
function overlaps(shift: Shift, start: number, end: number, now: number) {
  const from = Date.parse(shift.start)
  const to = shift.end ? Date.parse(shift.end) : Math.min(now, from + MAX_OPEN)
  return from < end && start < to
}

export function runHoursCommand(
  next: BusinessState,
  command: HoursCommand,
  now: string,
  today: string,
  makeId: () => string,
) {
  const o = (next.operations ??= {} as NonNullable<BusinessState['operations']>)
  const list = (o.shifts ??= [])
  const at = Date.parse(now)
  const person = (staffId: string, active = true) => {
    const found = next.staff.find((p) => p.id === staffId && (!active || !p.archived))
    if (!found) throw new Error('Choose someone on the team.')
    return found
  }
  const first = (name: string) => name.split(' ')[0]

  if (command.type === 'clock-in') {
    const who = person(command.staffId)
    const open = clockedIn(next, who.id, at)
    if (open)
      throw new Error(`${first(who.name)} clocked in at ${clockTime(next, open.start)} already.`)
    if (list.length >= SHIFT_LIMIT) throw new Error('Too many shifts to keep.')
    const shift: Shift = {
      id: makeId(),
      staffId: who.id,
      date: today,
      ...(hasLocations(next) ? { locationId: staffLocationOn(next, who.id, today) } : {}),
      start: now,
      breakMinutes: 0,
      source: 'clock',
      createdAt: now,
      actor: 'Local operator',
    }
    list.push(shift)
    return shift.id
  }

  if (command.type === 'clock-out') {
    const who = person(command.staffId)
    const open = clockedIn(next, who.id, at)
    if (!open) throw new Error(`${first(who.name)} is not clocked in.`)
    const worked = Math.round((at - Date.parse(open.start)) / MINUTE)
    if (command.breakMinutes && command.breakMinutes >= worked)
      throw new Error('The break is as long as the shift. Choose a shorter break.')
    open.end = now
    open.breakMinutes = command.breakMinutes
    open.endedBy = 'Local operator'
    return open.id
  }

  if (command.type === 'shift-remove') {
    const shift = list.find((x) => x.id === command.shiftId)
    if (!shift || shift.removed) throw new Error('Those hours are not in the record.')
    shift.removed = { at: now, actor: 'Local operator', reason: command.reason }
    return shift.id
  }

  // shift-save: hours added or put right by hand.
  const { input } = command
  const existing = command.id ? list.find((x) => x.id === command.id) : undefined
  if (command.id && (!existing || existing.removed))
    throw new Error('Those hours are not in the record.')
  if (existing && existing.staffId !== input.staffId)
    throw new Error(
      'Hours cannot move to someone else. Remove them and add them for the right person.',
    )
  const who = person(input.staffId, false)
  if (input.date > today) throw new Error('Add hours only for days that have started.')
  if (input.date < addDays(today, -400)) throw new Error('That day is too long ago to change.')
  // A time left as it was keeps its clocked seconds, so changing only the break moves nothing else.
  const kept = (chosen: number, was: string | undefined) =>
    was && Math.floor(Date.parse(was) / MINUTE) * MINUTE === chosen ? Date.parse(was) : chosen
  const start = kept(
    Date.parse(instantFor(next, input.date, toMinutes(input.start))),
    existing?.start,
  )
  // A finish at or before the start is the next morning, for a shift that ran past midnight.
  const endDate =
    toMinutes(input.end) <= toMinutes(input.start) ? addDays(input.date, 1) : input.date
  const end = kept(Date.parse(instantFor(next, endDate, toMinutes(input.end))), existing?.end)
  if (end - start > MAX_OPEN)
    throw new Error(`A shift can be up to ${SHIFT_MAX_HOURS} hours. Check the start and finish.`)
  if (end > at) throw new Error('That finish time has not come yet.')
  if (input.breakMinutes >= Math.round((end - start) / MINUTE))
    throw new Error('The break is as long as the shift. Choose a shorter break.')
  const clash = shifts(next).find(
    (x) => x.id !== existing?.id && x.staffId === who.id && overlaps(x, start, end, at),
  )
  if (clash)
    throw new Error(
      `${first(who.name)} has hours from ${clockTime(next, clash.start)} that day already. Change those instead.`,
    )
  const byHand = { at: now, actor: 'Local operator', reason: input.reason }
  const times = {
    date: input.date,
    start: new Date(start).toISOString(),
    end: new Date(end).toISOString(),
    breakMinutes: input.breakMinutes,
  }
  if (existing) {
    // The times it had are kept on the shift, with who set them and why.
    const before = {
      date: existing.date,
      start: existing.start,
      ...(existing.end ? { end: existing.end } : {}),
      breakMinutes: existing.breakMinutes,
      at: existing.byHand?.at ?? existing.createdAt,
      actor: existing.byHand?.actor ?? existing.endedBy ?? existing.actor,
      ...(existing.byHand ? { reason: existing.byHand.reason } : {}),
    }
    existing.earlier = [...(existing.earlier ?? []), before].slice(-SHIFT_EARLIER)
    Object.assign(existing, times, { byHand })
    // Hours moved to another day belong where the person worked that day.
    if (existing.date !== before.date && hasLocations(next))
      existing.locationId = staffLocationOn(next, who.id, input.date)
    return existing.id
  }
  if (list.length >= SHIFT_LIMIT) throw new Error('Too many shifts to keep.')
  const shift: Shift = {
    id: makeId(),
    staffId: who.id,
    ...times,
    ...(hasLocations(next) ? { locationId: staffLocationOn(next, who.id, input.date) } : {}),
    source: 'added',
    createdAt: now,
    actor: 'Local operator',
    byHand,
  }
  list.push(shift)
  return shift.id
}

/** Puts the signed-in person's name on shifts they clocked, closed, added, changed or removed. */
export function stampShiftActors(before: BusinessState, after: BusinessState, actor: string) {
  const old = new Map((operations(before).shifts ?? []).map((x) => [x.id, x]))
  for (const shift of operations(after).shifts ?? []) {
    const was = old.get(shift.id)
    if (!was) shift.actor = actor
    if (shift.end && !was?.end && shift.source === 'clock' && !shift.byHand) shift.endedBy = actor
    if (shift.byHand && shift.byHand.at !== was?.byHand?.at) shift.byHand.actor = actor
    if (shift.removed && !was?.removed) shift.removed.actor = actor
  }
}

/**
 * Sample hours for a sample studio: each person's usual day on the fortnight before the sample day,
 * arriving a few minutes either side of the start and leaving a little after the end, with a
 * half-hour break, or longer on a long day. The same studio always gets the same hours.
 */
export function sampleShifts(s: BusinessState, today: string): Shift[] {
  const made: Shift[] = []
  const spread = (key: string, size: number) =>
    [...key].reduce((sum, c) => (sum * 31 + c.charCodeAt(0)) % 9973, 7) % size
  for (let back = 14; back >= 1; back--) {
    const date = addDays(today, -back)
    for (const person of s.staff.filter((p) => !p.archived)) {
      const day = staffHoursFor(s, person.id, date)
      if (day.closed) continue
      const startAt = Math.max(0, day.open - 12 + spread(`${person.id}${date}in`, 15))
      const endAt = Math.min(1439, day.close - 3 + spread(`${person.id}${date}out`, 22))
      const start = instantFor(s, date, startAt)
      const end = instantFor(s, date, endAt)
      made.push({
        id: `shift-${person.id}-${date}`,
        staffId: person.id,
        date,
        ...(hasLocations(s) ? { locationId: staffLocationOn(s, person.id, date) } : {}),
        start,
        end,
        breakMinutes: endAt - startAt > 9 * 60 ? 45 : 30,
        source: 'clock',
        createdAt: start,
        actor: person.name,
        endedBy: person.name,
      })
    }
  }
  return made
}

/** What a general manager reads of the hours: only shifts at their own location. */
export const shiftsAt = (list: Shift[], locationId: string, mainId: string) =>
  list.filter((shift) => (shift.locationId ?? mainId) === locationId)
