import type { BusinessState } from './model'
import { operations } from './operations'
import { newStudioOperations } from './workspace'

/**
 * "Get your studio ready": what a new studio sets before its first guests book. Each step ticks
 * itself from the studio record. Opening hours and "no deposit or fee" can also be confirmed by
 * hand (`confirmed`), because leaving them as they are is a real choice that leaves no trace in
 * the record.
 */
export type ReadyStep =
  'hours' | 'treatments' | 'team' | 'rooms' | 'tax' | 'deposits' | 'contact' | 'online'
/** The permission (see `can`) each step needs; anyone else is told who sets it. */
export const stepPermission: Record<ReadyStep, string> = {
  hours: 'hours',
  treatments: 'catalogue',
  team: 'catalogue',
  rooms: 'catalogue',
  tax: 'tax',
  deposits: 'protection',
  contact: 'organisation',
  online: 'organisation',
}

const current = <T extends { archived?: boolean }>(rows: T[]) => rows.filter((row) => !row.archived)

/** Something a guest could book: a treatment, someone who does it, and a room or chair of its kind. */
export function bookable(s: BusinessState) {
  const staff = current(s.staff),
    rooms = current(s.resources)
  return current(s.services).some(
    (service) =>
      staff.some((person) => person.serviceIds.includes(service.id)) &&
      rooms.some((room) => room.type === service.resourceType),
  )
}

/** The week still exactly as a new studio starts it (Monday to Saturday, 9 to 6). */
function startingWeek(s: BusinessState) {
  const starting = newStudioOperations().hours
  return operations(s).hours.every((day) => {
    const first = starting.find((d) => d.day === day.day)
    if (!first || first.closed !== day.closed || day.locationId) return false
    return day.closed || (first.open === day.open && first.close === day.close)
  })
}

export function readySteps(
  s: BusinessState,
  confirmed: ReadonlySet<ReadyStep> = new Set(),
): { id: ReadyStep; done: boolean }[] {
  const o = operations(s)
  const services = current(s.services)
  const done: Record<ReadyStep, boolean> = {
    hours: confirmed.has('hours') || !startingWeek(s),
    treatments: services.length > 0,
    team: current(s.staff).some((person) =>
      services.some((service) => person.serviceIds.includes(service.id)),
    ),
    rooms: current(s.resources).length > 0,
    // An explicit rate, 0% included, is a choice; no rate at all is not.
    tax: o.tax !== undefined,
    deposits:
      confirmed.has('deposits') ||
      o.protection !== undefined ||
      services.some((service) => service.depositMinor > 0),
    contact: Boolean(s.organisation.phone || s.organisation.email),
    online: o.bookingEnabled,
  }
  return (Object.keys(done) as ReadyStep[]).map((id) => ({ id, done: done[id] }))
}
