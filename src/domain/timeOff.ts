import type { BusinessState } from './model'
import { addDays } from './format'
import { hoursFor, operations, timeOffOn, usualHoursFor } from './operations'
import type { TimeOff } from './operations'
import { dayAppointments } from './selectors'

/** V2: rotas, holidays and time off. */
export const TIME_OFF_LABEL: Record<TimeOff['kind'], string> = {
  holiday: 'Holiday',
  sick: 'Sick',
  other: 'Away',
}

export function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86400000)
}

/** Whether a person would normally work that day, from the venue's and their own weekly hours. */
export function usuallyWorks(s: BusinessState, staffId: string, date: string) {
  const venue = hoursFor(s, date)
  const own = usualHoursFor(s, staffId, date)
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
    if (usuallyWorks(s, away.staffId, date)) days += 1
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

export type RotaDay =
  | { date: string; state: 'working'; open: number; close: number; visits: number }
  | { date: string; state: 'off' }
  | { date: string; state: 'away'; away: TimeOff }
  | { date: string; state: 'closed' }

/** One person's week: hours they work, days off, days away and how many visits are booked. */
export function rotaWeek(s: BusinessState, monday: string) {
  const dates = Array.from({ length: 7 }, (_, i) => addDays(monday, i))
  const visitsOn = new Map(dates.map((date) => [date, dayAppointments(s, date)]))
  return s.staff
    .filter((person) => !person.archived)
    .map((person) => ({
      person,
      days: dates.map((date): RotaDay => {
        const venue = hoursFor(s, date)
        const away = timeOffOn(s, person.id, date)
        if (away) return { date, state: 'away', away }
        if (venue.closed) return { date, state: 'closed' }
        if (!usuallyWorks(s, person.id, date)) return { date, state: 'off' }
        const own = usualHoursFor(s, person.id, date)
        return {
          date,
          state: 'working',
          open: Math.max(venue.open, own.open),
          close: Math.min(venue.close, own.close),
          visits: visitsOn.get(date)!.filter((a) => a.staffId === person.id).length,
        }
      }),
    }))
}

/** The Monday on or before a day. */
export function mondayOf(date: string) {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay()
  return addDays(date, -((day + 6) % 7))
}
