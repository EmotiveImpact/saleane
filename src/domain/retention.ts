import type { Appointment, BusinessState, Staff } from './model'
import { addDays } from './format'

/**
 * Retention figures for the Business page. Pure: every figure is derived from the studio record
 * and the venue's current day, so the same record always gives the same answer.
 *
 * A rate is `null` when nobody is in its group yet, so the page can say "Not enough visits yet"
 * rather than showing a misleading 0%.
 */
export type Rate = { count: number; of: number; rate: number | null }
export type PractitionerRebooking = Rate & { staff: Staff }
export type Retention = {
  from: string
  to: string
  previousFrom: string
  previousTo: string
  byPractitioner: PractitionerRebooking[]
  newClientReturn: Rate
  returningClients: Rate
  lapsedClients: number
}

/** A lapsed client has been away for more than this multiple of their usual gap. */
export const LAPSED_MULTIPLE = 1.5

const rate = (count: number, of: number): Rate => ({ count, of, rate: of ? count / of : null })
const live = (a: Appointment) => a.status !== 'cancelled' && a.status !== 'no_show'
const later = (a: Appointment, b: Appointment) =>
  a.date > b.date || (a.date === b.date && a.startMinutes > b.startMinutes)
const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000)
/** Booked and still ahead: a confirmed visit, or one in the studio now, on or after today. */
const upcoming = (a: Appointment, today: string) =>
  (a.status === 'confirmed' || a.status === 'arrived') && a.date >= today

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

export function retention(s: BusinessState, days: number, today: string): Retention {
  const from = addDays(today, 1 - days)
  const previousTo = addDays(from, -1)
  const previousFrom = addDays(from, -days)
  const inPeriod = (a: Appointment) => a.date >= from && a.date <= today
  const byClient = new Map<string, Appointment[]>()
  for (const a of s.appointments) byClient.set(a.clientId, [...(byClient.get(a.clientId) ?? []), a])
  const rebookedFrom = new Set(
    s.appointments.filter((a) => a.rebookedFromId && live(a)).map((a) => a.rebookedFromId!),
  )

  // Same definition as the studio "Recorded rebooking" figure, split by who did the visit.
  const completed = s.appointments.filter((a) => a.status === 'completed' && inPeriod(a))
  const byPractitioner = s.staff
    .map((staff) => {
      const visits = completed.filter((a) => a.staffId === staff.id)
      return {
        staff,
        ...rate(visits.filter((a) => rebookedFrom.has(a.id)).length, visits.length),
      }
    })
    .filter((row) => row.of > 0 || !row.staff.archived)
    .sort(
      (a, b) =>
        (b.rate ?? -1) - (a.rate ?? -1) || b.of - a.of || a.staff.name.localeCompare(b.staff.name),
    )

  let newClients = 0,
    newReturned = 0,
    previousClients = 0,
    previousReturned = 0,
    lapsedClients = 0
  for (const visits of byClient.values()) {
    const done = visits
      .filter((a) => a.status === 'completed')
      .sort((a, b) => a.date.localeCompare(b.date) || a.startMinutes - b.startMinutes)
    const first = done[0]
    const ahead = visits.some((a) => upcoming(a, today))

    // New-client return: first ever completed visit in the period, then any later visit that
    // happened or is still booked.
    if (first && inPeriod(first)) {
      newClients++
      if (
        visits.some(
          (a) =>
            a.id !== first.id &&
            later(a, first) &&
            (a.status === 'completed' || upcoming(a, today)),
        )
      )
        newReturned++
    }

    // Returning clients: seen in the previous period, then seen again or booked ahead now.
    if (done.some((a) => a.date >= previousFrom && a.date <= previousTo)) {
      previousClients++
      if (done.some(inPeriod) || ahead) previousReturned++
    }

    // Lapsed: an established rhythm (two or more visit days) that has now been broken.
    const dates = [...new Set(done.map((a) => a.date))]
    if (dates.length >= 2 && !ahead) {
      const usual = median(dates.slice(1).map((date, i) => daysBetween(dates[i], date)))
      if (daysBetween(dates[dates.length - 1], today) > usual * LAPSED_MULTIPLE) lapsedClients++
    }
  }

  return {
    from,
    to: today,
    previousFrom,
    previousTo,
    byPractitioner,
    newClientReturn: rate(newReturned, newClients),
    returningClients: rate(previousReturned, previousClients),
    lapsedClients,
  }
}
