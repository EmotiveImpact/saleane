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

type GuestIndex = {
  key: Map<string, string>
  members: Map<string, string[]>
  latest: Map<string, Appointment>
  ahead: Set<string>
  agreed: Map<string, boolean>
}
/** Built once per state: the outbox checks every client on each pass, so lookups must be cheap. */
const indexes = new WeakMap<BusinessState, GuestIndex>()
const later = (a: Appointment, b: Appointment) =>
  a.date !== b.date
    ? a.date > b.date
    : a.startMinutes !== b.startMinutes
      ? a.startMinutes > b.startMinutes
      : a.id > b.id

/**
 * Online booking opens a fresh client record each time rather than matching an existing one, so
 * one guest can appear more than once. Records with the same email count as one guest.
 */
function guestIndex(s: BusinessState): GuestIndex {
  const known = indexes.get(s)
  if (known) return known
  const index: GuestIndex = {
    key: new Map(),
    members: new Map(),
    latest: new Map(),
    ahead: new Set(),
    agreed: new Map(),
  }
  for (const c of s.clients) {
    const key = c.email.trim().toLowerCase() || `id:${c.id}`
    index.key.set(c.id, key)
    index.members.set(key, [...(index.members.get(key) ?? []), c.id])
    index.agreed.set(key, (index.agreed.get(key) ?? true) && c.marketingConsent)
  }
  for (const a of s.appointments) {
    const key = index.key.get(a.clientId)
    if (!key) continue
    if (a.status === 'confirmed' || a.status === 'arrived') index.ahead.add(key)
    const best = index.latest.get(key)
    if (a.status === 'completed' && (!best || later(a, best))) index.latest.set(key, a)
  }
  indexes.set(s, index)
  return index
}
const keyOf = (s: BusinessState, clientId: string) =>
  guestIndex(s).key.get(clientId) ?? `id:${clientId}`

/** The client and any other records with the same email. */
export function sameGuest(s: BusinessState, clientId: string) {
  return new Set(guestIndex(s).members.get(keyOf(s, clientId)) ?? [clientId])
}

/** Whether the guest, under any of their records, has anything booked or is in the studio now. */
export function hasVisitAhead(s: BusinessState, clientId: string) {
  return guestIndex(s).ahead.has(keyOf(s, clientId))
}

/** Whether the guest agreed to hear from the studio under every record they have. */
export function agreedEverywhere(s: BusinessState, clientId: string) {
  return guestIndex(s).agreed.get(keyOf(s, clientId)) ?? false
}

/** The guest's most recent completed visit under any of their records. Ties go to the larger id. */
export function latestGuestVisit(s: BusinessState, clientId: string): Appointment | undefined {
  return guestIndex(s).latest.get(keyOf(s, clientId))
}

/** Whether this is the guest's most recent completed visit across all their records. */
export function isLatestVisit(s: BusinessState, visit: Appointment) {
  return latestGuestVisit(s, visit.clientId)?.id === visit.id
}
