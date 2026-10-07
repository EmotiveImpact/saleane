import type { Appointment, BusinessState } from './model'
import { addDays } from './format'

/**
 * V1.5: when a guest is usually due back. A treatment can say how many weeks guests normally
 * leave between visits, such as six for a colour; without that, four weeks is the gentle default
 * used by the "due back" list on Today.
 */
export const DEFAULT_RETURN_DAYS = 28

/** The client's most recent completed visit, latest time first when two fall on one day. */
export function lastCompletedVisit(s: BusinessState, clientId: string): Appointment | undefined {
  return s.appointments
    .filter((a) => a.clientId === clientId && a.status === 'completed')
    .sort((a, b) => b.date.localeCompare(a.date) || b.startMinutes - a.startMinutes)[0]
}

/** The weeks the treatment itself sets, if any. */
export function returnWeeksFor(s: BusinessState, visit: Pick<Appointment, 'serviceId'>) {
  return s.services.find((x) => x.id === visit.serviceId)?.returnWeeks
}

/** The studio date a guest is due back after this visit. */
export function dueBackOn(s: BusinessState, visit: Pick<Appointment, 'serviceId' | 'date'>) {
  const weeks = returnWeeksFor(s, visit)
  return addDays(visit.date, weeks ? weeks * 7 : DEFAULT_RETURN_DAYS)
}

/**
 * The client and any other records with the same email. Online booking opens a fresh record each
 * time rather than matching an existing one, so one guest can appear more than once.
 */
export function sameGuest(s: BusinessState, clientId: string) {
  const email = s.clients
    .find((c) => c.id === clientId)
    ?.email.trim()
    .toLowerCase()
  return new Set(
    s.clients
      .filter((c) => c.id === clientId || (!!email && c.email.trim().toLowerCase() === email))
      .map((c) => c.id),
  )
}

/** Whether the guest, under any of their records, has anything booked or is in the studio now. */
export function hasVisitAhead(s: BusinessState, clientId: string) {
  const ids = sameGuest(s, clientId)
  return s.appointments.some(
    (a) => ids.has(a.clientId) && (a.status === 'confirmed' || a.status === 'arrived'),
  )
}

/** Whether this is the guest's most recent completed visit across all their records. */
export function isLatestVisit(s: BusinessState, visit: Appointment) {
  const ids = sameGuest(s, visit.clientId)
  return !s.appointments.some(
    (a) =>
      ids.has(a.clientId) &&
      a.status === 'completed' &&
      a.id !== visit.id &&
      (a.date > visit.date || (a.date === visit.date && a.startMinutes > visit.startMinutes)),
  )
}
