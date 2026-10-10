import { z } from 'zod'
import type { BusinessState } from './model'
import { businessDate, hoursFor, instantFor, operations, staffHoursFor } from './operations'
import { addDays } from './format'
import { offeredAt, placeOf, resourceLocation, staffLocationOn } from './locations'

const civilDate = z.iso.date()

/**
 * The room or chair a visit can take at this time, or null when the professional, the hours, a
 * closure or another visit is in the way. Without a location, the main one is meant. `step` is the booking grid in minutes; a visit carried
 * over from another system (PILOT-03) may sit on a five-minute grid.
 */
export function availableAllocation(
  s: BusinessState,
  serviceId: string,
  staffId: string,
  date: string,
  start: number,
  duration: number,
  buffer: number,
  resourceType: string,
  excludeId?: string,
  now = new Date().toISOString(),
  preferredResourceId?: string,
  step = 15,
  locationId?: string,
  /** NEXT-08: the visits this one is booked together with, who may share a room for two. */
  together?: string,
): string | null {
  // V2: a visit is at one location (by default where the person works that day); the person must
  // work there that day and the room be there.
  const place = locationId ?? staffLocationOn(s, staffId, date)
  const site = placeOf(s, place)
  if (!site || (site.archived && !excludeId)) return null
  // A treatment can be left off a location's menu; visits already booked there keep their place.
  const service = s.services.find((item) => item.id === serviceId)
  if (
    service &&
    !offeredAt(service, place) &&
    s.appointments.find((a) => a.id === excludeId)?.locationId !== place
  )
    return null
  const staff = s.staff.find((item) => item.id === staffId)
  if (
    !staff ||
    staff.archived ||
    !staff.serviceIds.includes(serviceId) ||
    !civilDate.safeParse(date).success ||
    date < businessDate(s, now) ||
    !Number.isInteger(start) ||
    start < 0 ||
    start % step !== 0
  )
    return null
  const end = start + duration + buffer
  if (staffLocationOn(s, staffId, date) !== place) return null
  const h = hoursFor(s, date, place),
    ph = staffHoursFor(s, staffId, date)
  if (
    !h ||
    !ph ||
    h.closed ||
    ph.closed ||
    start < Math.max(h.open, ph.open) ||
    end > Math.min(h.close, ph.close)
  )
    return null
  if (
    operations(s).closures.some(
      (c) =>
        c.date === date &&
        (!c.staffId || c.staffId === staffId) &&
        start < c.endMinutes &&
        end > c.startMinutes,
    )
  )
    return null
  try {
    const instant = instantFor(s, date, start)
    const finish = instantFor(s, end === 1440 ? addDays(date, 1) : date, end % 1440)
    if (Date.parse(finish) - Date.parse(instant) !== (duration + buffer) * 60000) return null
    if (operations(s).mode === 'local' && Date.parse(instant) < Date.parse(now)) return null
  } catch {
    return null
  }

  const busy = s.appointments.filter(
    (a) =>
      a.date === date && a.id !== excludeId && a.status !== 'cancelled' && a.status !== 'no_show',
  )
  const visitEnd = (a: (typeof busy)[number]) =>
    a.startMinutes + a.bookedDurationMinutes + a.bookedBufferMinutes
  if (busy.some((a) => a.staffId === staffId && start < visitEnd(a) && end > a.startMinutes))
    return null
  // V1.5: a room with resting time stays empty that long after each visit, before and after this one.
  return (
    s.resources.find((resource) => {
      if (
        resource.archived ||
        (preferredResourceId && resource.id !== preferredResourceId) ||
        resource.type !== resourceType ||
        resourceLocation(s, resource) !== place
      )
        return false
      const rest = resource.restMinutes ?? 0
      const sharing = busy.filter(
        (a) =>
          a.resourceId === resource.id && start < visitEnd(a) + rest && end + rest > a.startMinutes,
      )
      if (!sharing.length) return true
      // NEXT-08: a room for two takes one other visit booked together with this one at any moment.
      // Visits that follow one another in it can each sit beside this one, as long as no two of
      // them are in the room at once (intervals that meet pairwise all meet at one moment).
      return (
        !!resource.forTwo &&
        !!together &&
        sharing.every((a) => a.together?.id === together) &&
        sharing.every((a, i) =>
          sharing
            .slice(i + 1)
            .every(
              (b) => a.startMinutes >= visitEnd(b) + rest || b.startMinutes >= visitEnd(a) + rest,
            ),
        )
      )
    })?.id ?? null
  )
}
