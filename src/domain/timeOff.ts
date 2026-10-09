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
