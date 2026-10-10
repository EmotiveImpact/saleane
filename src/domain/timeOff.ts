import type { BusinessState } from './model'
import { addDays } from './format'
import { hoursFor, operations, plannedHoursFor } from './operations'
import type { TimeOff } from './operations'

/** V2: holidays and time off. The week's rota itself is in rota.ts (Stage 3). */
export const TIME_OFF_LABEL: Record<TimeOff['kind'], string> = {
  holiday: 'Holiday',
  sick: 'Sick',
  other: 'Away',
}

export function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86400000)
}

/**
 * Whether a person is planned to work that day: their weekly hours, or the day as changed on the
 * rota (Stage 3), within the opening hours of where they work.
 */
export function plannedToWork(s: BusinessState, staffId: string, date: string) {
  const own = plannedHoursFor(s, staffId, date)
  const venue = hoursFor(s, date, own.locationId)
  return (
    !venue.closed &&
    !own.closed &&
    Math.min(venue.close, own.close) > Math.max(venue.open, own.open)
  )
}

/** Working days a stretch of time off covers, optionally only those within one calendar year. */
export function workingDaysAway(
  s: BusinessState,
  away: Pick<TimeOff, 'staffId' | 'from' | 'to'>,
  year?: number,
) {
  let days = 0
  for (let date = away.from; date <= away.to; date = addDays(date, 1)) {
    if (year !== undefined && Number(date.slice(0, 4)) !== year) continue
    // The days they were planned to work, so a changed or extra day on the rota counts as planned.
    if (plannedToWork(s, away.staffId, date)) days += 1
  }
  return days
}

/** Holiday allowance for a person, in days, if one has been set. */
export function allowanceFor(s: BusinessState, staffId: string) {
  return operations(s).leaveAllowances?.find((a) => a.staffId === staffId)?.days
}

/** Holiday days booked in a calendar year (taken and still to come), and what is left. */
export function holidaySummary(s: BusinessState, staffId: string, year: number) {
  const booked = (operations(s).timeOff ?? [])
    .filter((t) => !t.cancelledAt && t.staffId === staffId && t.kind === 'holiday')
    .reduce((sum, t) => sum + workingDaysAway(s, t, year), 0)
  const allowance = allowanceFor(s, staffId)
  return { booked, allowance, left: allowance === undefined ? undefined : allowance - booked }
}

/** The Monday on or before a day. */
export function mondayOf(date: string) {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay()
  return addDays(date, -((day + 6) % 7))
}

/**
 * Ledger checks for changed time off (Stage 4): a record changed to another names one for the same
 * person and is cancelled; a record changed from another names one for the same person.
 */
export function timeOffProblem(s: BusinessState) {
  const list = operations(s).timeOff ?? []
  const byId = new Map(list.map((t) => [t.id, t]))
  for (const away of list) {
    const to = away.changedTo ? byId.get(away.changedTo) : undefined
    const from = away.changedFrom ? byId.get(away.changedFrom) : undefined
    if (
      (away.changedTo && (!to || to.staffId !== away.staffId || !away.cancelledAt)) ||
      (away.changedFrom && (!from || from.staffId !== away.staffId))
    )
      return 'Invalid changed time off.'
  }
  return null
}

/** For who changed what: the days and kind of time off before and after a change. */
export function timeOffChangeDetail(
  before: BusinessState,
  after: BusinessState,
  action: string,
  recordId: string,
) {
  if (action !== 'time-off-change') return null
  const now = (operations(after).timeOff ?? []).find((t) => t.id === recordId)
  const was = now?.changedFrom
    ? (operations(before).timeOff ?? []).find((t) => t.id === now.changedFrom)
    : undefined
  if (!now || !was) return null
  return {
    fields: [
      { f: 'firstDay', from: was.from, to: now.from },
      { f: 'lastDay', from: was.to, to: now.to },
      { f: 'timeOffKind', from: TIME_OFF_LABEL[was.kind], to: TIME_OFF_LABEL[now.kind] },
      ...((was.note ?? '') !== (now.note ?? '') ? [{ f: 'note' }] : []),
    ].filter((field) => !('from' in field) || field.from !== field.to),
  }
}
