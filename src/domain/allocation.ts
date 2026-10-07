import { z } from 'zod'
import type { BusinessState } from './model'
import { businessDate, hoursFor, instantFor, operations, staffHoursFor } from './operations'
import { addDays } from './format'
import { placeOf, resourceLocation, staffLocationOn } from './locations'

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
): string | null {
  // V2: a visit is at one location (by default where the person works that day); the person must
  // work there that day and the room be there.
  const place = locationId ?? staffLocationOn(s, staffId, date)
  const site = placeOf(s, place)
  if (!site || (site.archived && !excludeId)) return null
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

  const overlapping = s.appointments.filter(
    (a) =>
      a.date === date &&
      a.id !== excludeId &&
      a.status !== 'cancelled' &&
      a.status !== 'no_show' &&
      start < a.startMinutes + a.bookedDurationMinutes + a.bookedBufferMinutes &&
      end > a.startMinutes,
  )
  if (overlapping.some((a) => a.staffId === staffId)) return null
  return (
    s.resources.find(
      (resource) =>
        !resource.archived &&
        resourceLocation(s, resource) === place &&
        (!preferredResourceId || resource.id === preferredResourceId) &&
        resource.type === resourceType &&
        !overlapping.some((a) => a.resourceId === resource.id),
    )?.id ?? null
  )
}
