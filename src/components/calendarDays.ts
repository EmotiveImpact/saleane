import type { Appointment, BusinessState } from '../domain/model'
import { addDays } from '../domain/format'
import { places } from '../domain/locations'
import { hoursFor } from '../domain/operations'

/** Monday of the week that holds this date. */
export function weekStart(date: string) {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay()
  return addDays(date, -((weekday + 6) % 7))
}

/** The first of the month a given number of months away. */
export function addMonths(date: string, months: number) {
  const value = new Date(`${date.slice(0, 7)}-01T12:00:00Z`)
  value.setUTCMonth(value.getUTCMonth() + months)
  return value.toISOString().slice(0, 10)
}

/**
 * V2: the hours the calendar shows for a day. With every location shown, from the earliest opening
 * to the latest closing among them, and closed only when all of them are.
 */
export function shownHours(state: BusinessState, date: string, locationFilter: string) {
  if (locationFilter !== 'all') return hoursFor(state, date, locationFilter)
  const open = places(state)
    .map((place) => hoursFor(state, date, place.id))
    .filter((h) => !h.closed)
  if (!open.length) return hoursFor(state, date)
  return {
    ...open[0],
    open: Math.min(...open.map((h) => h.open)),
    close: Math.max(...open.map((h) => h.close)),
  }
}

type Timed = Pick<Appointment, 'id' | 'startMinutes' | 'bookedDurationMinutes'>
type Hours = { open: number; close: number; closed: boolean }

/** Where a visit ends. The week shows each visit's own time; the day view adds its turnaround. */
const endOf = (a: Timed) => a.startMinutes + a.bookedDurationMinutes

/**
 * The stretch of the day a week's timeline covers, on the hour: from the earliest opening to the
 * latest closing among its open days, and wide enough for any visit outside them.
 */
export function weekSpan(days: { hours: Hours; visits: Timed[] }[]) {
  const open = days.filter((d) => !d.hours.closed).map((d) => d.hours)
  const visits = days.flatMap((d) => d.visits)
  const from = [...open.map((h) => h.open), ...visits.map((a) => a.startMinutes)]
  const to = [...open.map((h) => h.close), ...visits.map(endOf)]
  const start = from.length ? Math.floor(Math.min(...from) / 60) * 60 : 9 * 60
  const end = to.length ? Math.ceil(Math.max(...to) / 60) * 60 : 18 * 60
  return { start, end: Math.max(end, start + 60) }
}

/**
 * Lays out visits that overlap side by side, as a paper diary would: each visit takes the first
 * column free when it starts, and the visits in a run of overlaps share that run's number of
 * columns, so they line up. Visits come in order of start time.
 */
export function sideBySide(visits: Timed[]) {
  const placed = new Map<string, { column: number; columns: number }>()
  let run: { id: string; column: number }[] = []
  let ends: number[] = []
  let runEnd = 0
  const close = () => {
    for (const visit of run) placed.set(visit.id, { column: visit.column, columns: ends.length })
    run = []
    ends = []
  }
  for (const visit of visits) {
    const from = visit.startMinutes
    const to = endOf(visit)
    if (run.length && from >= runEnd) close()
    let column = ends.findIndex((end) => end <= from)
    if (column === -1) column = ends.push(to) - 1
    else ends[column] = to
    runEnd = run.length ? Math.max(runEnd, to) : to
    run.push({ id: visit.id, column })
  }
  close()
  return placed
}
