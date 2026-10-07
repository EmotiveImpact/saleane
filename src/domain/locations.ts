import type { Appointment, BusinessState } from './model'
import { operations, usualHoursFor } from './operations'

/**
 * V2: several locations. The main location lives on the organisation; further ones are kept in
 * operations. Rooms belong to one location, and each person works at one location on a given day
 * (set on their weekly hours). Anything without a location belongs to the main one, so a studio
 * with one location behaves exactly as before.
 */
export type Place = {
  id: string
  name: string
  address: string
  arrivalNote?: string
  main: boolean
  archived: boolean
}

export function places(s: BusinessState, includeArchived = false): Place[] {
  const org = s.organisation
  const main: Place = {
    id: org.locationId,
    name: org.locationName,
    address: org.address,
    ...(org.arrivalNote ? { arrivalNote: org.arrivalNote } : {}),
    main: true,
    archived: false,
  }
  const more = (operations(s).locations ?? []).map((l) => ({
    id: l.id,
    name: l.name,
    address: l.address,
    ...(l.arrivalNote ? { arrivalNote: l.arrivalNote } : {}),
    main: false,
    archived: !!l.archived,
  }))
  return [main, ...more].filter((p) => includeArchived || !p.archived)
}

/** More than one open location: only then do screens ask which one. */
export function hasLocations(s: BusinessState) {
  return places(s).length > 1
}

export function placeOf(s: BusinessState, locationId: string | undefined) {
  return places(s, true).find((p) => p.id === (locationId ?? s.organisation.locationId))
}

export function resourceLocation(s: BusinessState, resource: { locationId?: string }) {
  return resource.locationId ?? s.organisation.locationId
}

/** Where a person works on a day, from their weekly hours. */
export function staffLocationOn(s: BusinessState, staffId: string, date: string) {
  return usualHoursFor(s, staffId, date).locationId ?? s.organisation.locationId
}

/** Every location someone works at across a usual week (from 2026-10-05, a Monday). */
export function staffPlaces(s: BusinessState, staffId: string) {
  return [
    ...new Set(
      Array.from({ length: 7 }, (_, i) =>
        staffLocationOn(s, staffId, `2026-10-${String(5 + i).padStart(2, '0')}`),
      ),
    ),
  ]
}

/** Where a visit takes place: its name and address for guests and messages. */
export function visitPlace(s: BusinessState, a: Pick<Appointment, 'locationId'>) {
  return placeOf(s, a.locationId) ?? places(s)[0]
}

/** Ledger checks: every location named is known, and every id is used once. */
export function locationsProblem(s: BusinessState) {
  const all = places(s, true)
  const known = new Set(all.map((p) => p.id))
  if (known.size !== all.length) return 'Duplicate location IDs.'
  if (s.resources.some((r) => r.locationId && !known.has(r.locationId)))
    return 'A room names a missing location.'
  if (s.staff.some((p) => p.hours?.some((h) => h.locationId && !known.has(h.locationId))))
    return 'Working hours name a missing location.'
  if (s.appointments.some((a) => !known.has(a.locationId)))
    return 'An appointment names a missing location.'
  if (operations(s).hours.some((h) => h.locationId))
    return 'Studio opening hours cannot name a location.'
  return null
}

/** The room's name, with its location when the studio has more than one: "Room 2, Islington". */
export function roomWithPlace(s: BusinessState, a: Pick<Appointment, 'resourceId' | 'locationId'>) {
  const room = s.resources.find((r) => r.id === a.resourceId)?.name ?? ''
  return hasLocations(s) || a.locationId !== s.organisation.locationId
    ? [room, visitPlace(s, a).name].filter(Boolean).join(', ')
    : room
}
