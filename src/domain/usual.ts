import type { Appointment, BusinessState, Service } from './model'
import { addDays } from './format'
import { guestOf } from './cancelledTimes'
import { dueBackOn } from './dueBack'
import { hasLocations, offeredAt, placeOf, places, staffPlaces } from './locations'
import { instantFor } from './operations'
import { onlinePatchTestStop } from './patchTests'

/**
 * Stage 5: "my usual". The treatment a guest keeps coming back for, who they see, where, and when
 * they like to come, worked out from their own completed visits. The client page's "At a glance"
 * (clientInsight.ts), the AI receptionist, the guest's visit page and Ask SALEANE all read it
 * from here, so they never disagree about what someone's usual is.
 *
 * The rules are the client page's, unchanged:
 *
 * - only completed visits in the last 12 months count (364 days, the page's visit track);
 * - a favourite treatment, professional or location needs at least three such visits, the top one
 *   in at least two of them, no tie for the top, and at least half of them;
 * - a day of the week or part of the day is a habit from four visits, two thirds of them alike,
 *   and the typical start time is the middle start of the visits in that part of the day (on that
 *   day when there is one).
 *
 * A guest may have several client records, because every online booking opens a new one. Records
 * with the same email are one guest (cancelledTimes.ts groups them), so their visits are read
 * together. The client page keeps reading one record at a time, as it always has.
 *
 * Nothing here contacts anyone or books anything. Whatever reads it decides what to say, and every
 * booking still goes through the usual checks and confirmation.
 */

/** "In the last 12 months": the same year as the client page's visit track. */
export const USUAL_YEAR_DAYS = 364
/** A favourite needs at least this many visits in the year to choose from. */
export const FAVOURITE_FROM = 3
/** A day or time of day counts as a habit from this many visits, two thirds of them alike. */
export const PATTERN_FROM = 4
/** The next usual day is looked for no further ahead than the AI receptionist looks for times. */
export const USUAL_AHEAD_DAYS = 90
/** Morning ends at 12:00 and evening starts at 17:00, as the time pickers group them. */
export const AFTERNOON = 12 * 60
export const EVENING = 17 * 60

export type PartOfDay = 'morning' | 'afternoon' | 'evening'

/** Where each part of the day starts and ends, as the time pickers and the receptionist read it. */
export const PART_TIMES: Record<PartOfDay, { after?: string; before?: string }> = {
  morning: { before: '12:00' },
  afternoon: { after: '12:00', before: '17:00' },
  evening: { after: '17:00' },
}

/** The day of the week of a studio date, 0 for Sunday. */
export const weekdayOf = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay()
export const partOf = (minutes: number): PartOfDay =>
  minutes < AFTERNOON ? 'morning' : minutes < EVENING ? 'afternoon' : 'evening'

/** The most common value and how often, only when it clearly leads: no tie, at least half. */
export function clearFavourite(ids: string[]) {
  const counts = new Map<string, number>()
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1)
  const ranked = [...counts].sort((a, b) => b[1] - a[1])
  const [top, second] = ranked
  if (!top || ids.length < FAVOURITE_FROM || top[1] < 2) return undefined
  if (second && second[1] === top[1]) return undefined
  if (top[1] * 2 < ids.length) return undefined
  return { id: top[0], visits: top[1], of: ids.length }
}

/** The most common value when at least two thirds of `values` share it. */
export function strongPattern<T>(values: T[]) {
  if (values.length < PATTERN_FROM) return undefined
  const counts = new Map<T, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  const [top] = [...counts].sort((a, b) => b[1] - a[1])
  return top && top[1] * 3 >= values.length * 2 ? top[0] : undefined
}

function median(values: number[]) {
  if (!values.length) return undefined
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor((sorted.length - 1) / 2)]
}

type Visit = Pick<Appointment, 'serviceId' | 'staffId' | 'locationId' | 'date' | 'startMinutes'>

/** The habits in a year of completed visits, each only when it is clear. */
export type UsualPattern = {
  visits: number
  treatment?: { id: string; visits: number; of: number }
  professional?: { id: string; visits: number; of: number }
  location?: { id: string; visits: number; of: number }
  weekday?: number
  partOfDay?: PartOfDay
  /** The middle start of the visits in their usual part of the day, on their usual day if any. */
  startMinutes?: number
}

/** What a set of completed visits says about someone's habits, by the rules above. */
export function usualPattern(year: Visit[]): UsualPattern {
  const treatment = clearFavourite(year.map((a) => a.serviceId))
  const professional = clearFavourite(year.map((a) => a.staffId))
  const location = clearFavourite(year.map((a) => a.locationId))
  const weekday = strongPattern(year.map((a) => weekdayOf(a.date)))
  const partOfDay = strongPattern(year.map((a) => partOf(a.startMinutes)))
  const startMinutes =
    partOfDay === undefined
      ? undefined
      : median(
          year
            .filter(
              (a) =>
                partOf(a.startMinutes) === partOfDay &&
                (weekday === undefined || weekdayOf(a.date) === weekday),
            )
            .map((a) => a.startMinutes),
        )
  return {
    visits: year.length,
    ...(treatment ? { treatment } : {}),
    ...(professional ? { professional } : {}),
    ...(location ? { location } : {}),
    ...(weekday !== undefined ? { weekday } : {}),
    ...(partOfDay !== undefined ? { partOfDay } : {}),
    ...(startMinutes !== undefined ? { startMinutes } : {}),
  }
}

/**
 * The next usual day: the first day on their usual day of the week from when they are next due
 * back (dueBack.ts, as on Today and the client page), and never before tomorrow. When that is
 * further away than USUAL_AHEAD_DAYS, or they are already due, it is the first such day from
 * tomorrow. Without a usual day of the week, it is the due date itself, or tomorrow.
 */
export function nextUsualDate(today: string, weekday: number | undefined, dueOn?: string) {
  const tomorrow = addDays(today, 1)
  const onTheDay = (from: string) => {
    let date = from
    if (weekday !== undefined) while (weekdayOf(date) !== weekday) date = addDays(date, 1)
    return date
  }
  const due = dueOn && dueOn > tomorrow ? onTheDay(dueOn) : undefined
  return due && due <= addDays(today, USUAL_AHEAD_DAYS) ? due : onTheDay(tomorrow)
}

/** Why there is no usual to book. */
export type NoUsual =
  /** Fewer than FAVOURITE_FROM completed visits in the last 12 months. */
  | 'new'
  /** No one treatment stands out. */
  | 'no-clear-treatment'
  /** Their usual treatment is archived or no longer in the record. */
  | 'treatment-gone'

/** Something that changed since their usual took shape, said plainly wherever it is shown. */
export type UsualChange =
  /** The person they usually see is archived: no longer taking bookings. */
  | { kind: 'professional-away'; staffId: string; name: string }
  /** The person they usually see no longer does the treatment. */
  | { kind: 'professional-not-doing'; staffId: string; name: string }
  /** The person they usually see no longer works at their usual location; where they work now. */
  | {
      kind: 'professional-moved'
      staffId: string
      name: string
      locationId?: string
      location?: string
    }
  /** Their usual location has closed. */
  | { kind: 'location-closed'; locationId: string; location: string }
  /** Their usual location no longer offers the treatment, or nobody there does it. */
  | { kind: 'location-not-offered'; locationId: string; location: string }

export type GuestUsual = {
  /** Every client record read: this one and any other with the same email. */
  clientIds: string[]
  /** Completed visits in the last 12 months across those records. */
  visits: number
  lastVisit?: string
  /** Their clear favourite treatment, named as the menu names it, or as it was last booked. */
  treatment?: { serviceId: string; name: string }
  /** The person they usually see, only while that person can still be booked for it there. */
  professional?: { staffId: string; name: string }
  /** With several locations: where they usually go, while it is open and still offers it. */
  location?: { locationId: string; name: string }
  weekday?: number
  partOfDay?: PartOfDay
  startMinutes?: number
  /** The next usual day (nextUsualDate). */
  nextDate?: string
  /** Why there is no usual to book; absent when there is one. */
  none?: NoUsual
  changes: UsualChange[]
  /**
   * Why the usual cannot be booked online, in the booking page's own words: a patch test comes
   * first, or no open location offers it with someone to do it. The desk can still book it.
   */
  onlineStop?: string
}

/** Whether a guest could book the treatment at a location: offered there, with someone there. */
function bookableAt(s: BusinessState, service: Service, locationId: string, now: string) {
  return (
    offeredAt(service, locationId) &&
    s.staff.some(
      (p) =>
        !p.archived &&
        p.serviceIds.includes(service.id) &&
        staffPlaces(s, p.id, now).includes(locationId),
    )
  )
}

/**
 * A guest's usual, from the completed visits of every record with the same email as `clientId`.
 * It never reads anyone else's visits. `today` is the studio's date.
 */
export function guestUsual(s: BusinessState, clientId: string, today: string): GuestUsual {
  const guest = guestOf(s, clientId)
  const clientIds = guest ? [...guest.ids] : [clientId]
  const completed = (
    guest?.completed ??
    s.appointments.filter((a) => a.clientId === clientId && a.status === 'completed')
  ).filter((a) => a.date <= today)
  const yearStart = addDays(today, -USUAL_YEAR_DAYS)
  const year = completed.filter((a) => a.date >= yearStart)
  const last = completed.reduce<Appointment | undefined>(
    (latest, a) =>
      !latest ||
      a.date > latest.date ||
      (a.date === latest.date && a.startMinutes > latest.startMinutes)
        ? a
        : latest,
    undefined,
  )
  const pattern = usualPattern(year)
  const base: GuestUsual = {
    clientIds,
    visits: year.length,
    ...(last ? { lastVisit: last.date } : {}),
    ...(pattern.weekday !== undefined ? { weekday: pattern.weekday } : {}),
    ...(pattern.partOfDay ? { partOfDay: pattern.partOfDay } : {}),
    ...(pattern.startMinutes !== undefined ? { startMinutes: pattern.startMinutes } : {}),
    ...(last ? { nextDate: nextUsualDate(today, pattern.weekday, dueBackOn(s, last)) } : {}),
    changes: [],
  }
  if (year.length < FAVOURITE_FROM) return { ...base, none: 'new' }
  if (!pattern.treatment) return { ...base, none: 'no-clear-treatment' }
  const serviceId = pattern.treatment.id
  const service = s.services.find((x) => x.id === serviceId)
  const name =
    service?.name ??
    year
      .filter((a) => a.serviceId === serviceId)
      .sort((a, b) => b.date.localeCompare(a.date))
      .find((a) => a.bookedServiceName)?.bookedServiceName ??
    'Their usual treatment'
  const treatment = { serviceId, name }
  if (!service || service.archived) return { ...base, treatment, none: 'treatment-gone' }

  let now: string
  try {
    now = instantFor(s, today, AFTERNOON)
  } catch {
    now = `${today}T12:00:00.000Z`
  }
  const changes: UsualChange[] = []
  let location: GuestUsual['location']
  // Where they usually go: named only while there is more than one open location, though a
  // location that has closed is always said, even when only one is left open.
  const usualPlace = pattern.location && placeOf(s, pattern.location.id)
  if (usualPlace && usualPlace.archived)
    changes.push({ kind: 'location-closed', locationId: usualPlace.id, location: usualPlace.name })
  else if (usualPlace && hasLocations(s)) {
    if (!bookableAt(s, service, usualPlace.id, now))
      changes.push({
        kind: 'location-not-offered',
        locationId: usualPlace.id,
        location: usualPlace.name,
      })
    else location = { locationId: usualPlace.id, name: usualPlace.name }
  }
  let professional: GuestUsual['professional']
  const person = pattern.professional && s.staff.find((p) => p.id === pattern.professional!.id)
  if (person) {
    const who = { staffId: person.id, name: person.name }
    if (person.archived) changes.push({ kind: 'professional-away', ...who })
    else if (!person.serviceIds.includes(service.id))
      changes.push({ kind: 'professional-not-doing', ...who })
    else if (location && !staffPlaces(s, person.id, now).includes(location.locationId)) {
      const elsewhere = staffPlaces(s, person.id, now)
        .map((id) => placeOf(s, id))
        .find((p) => p && !p.archived && offeredAt(service, p.id))
      changes.push({
        kind: 'professional-moved',
        ...who,
        ...(elsewhere ? { locationId: elsewhere.id, location: elsewhere.name } : {}),
      })
    } else professional = who
  }
  const anywhere = places(s).some((p) => bookableAt(s, service, p.id, now))
  const onlineStop =
    onlinePatchTestStop(s, service.id) ??
    (anywhere ? null : `${service.name} cannot be booked online just now.`)
  return {
    ...base,
    treatment,
    ...(professional ? { professional } : {}),
    ...(location ? { location } : {}),
    changes,
    ...(onlineStop ? { onlineStop } : {}),
  }
}

/** Whether the guest has a visit booked from today, under any of their records. */
export function bookedAhead(s: BusinessState, clientIds: string[], today: string) {
  const ids = new Set(clientIds)
  return s.appointments.some(
    (a) =>
      ids.has(a.clientId) &&
      a.date >= today &&
      (a.status === 'confirmed' || a.status === 'arrived'),
  )
}
