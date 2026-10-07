import { z } from 'zod'
import type { BusinessState } from './model'
import { businessDate, hoursFor, instantFor, operations, staffHoursFor } from './operations'
import { addDays } from './format'

const civilDate = z.iso.date()

/**
 * The room or chair a visit can take at this time, or null when the professional, the hours, a
 * closure or another visit is in the way. `step` is the booking grid in minutes; a visit carried
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
): string | null {
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
  const h = hoursFor(s, date),
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
        resource.type !== resourceType
      )
        return false
      const rest = resource.restMinutes ?? 0
      return !busy.some(
        (a) =>
          a.resourceId === resource.id && start < visitEnd(a) + rest && end + rest > a.startMinutes,
      )
    })?.id ?? null
  )
}
