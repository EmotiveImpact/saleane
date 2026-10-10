import type { BusinessState } from './model'
import { hoursFor, operations } from './operations'
import { offeredAt, places, resourceLocation, staffPlaces } from './locations'

/**
 * The open locations a guest can book at: somewhere a treatment is offered, someone who does it
 * works there, and a room or chair it needs is there. A new location still being set up stays
 * off the booking page until it can take a visit. The booking page and booking through an AI
 * assistant (Stage 5) show the same places.
 */
export function bookingLocations(s: BusinessState) {
  const people = s.staff.filter((person) => !person.archived)
  return places(s).filter((place) =>
    s.services.some(
      (service) =>
        !service.archived &&
        offeredAt(service, place.id) &&
        people.some(
          (person) =>
            person.serviceIds.includes(service.id) && staffPlaces(s, person.id).includes(place.id),
        ) &&
        s.resources.some(
          (resource) =>
            !resource.archived &&
            resource.type === service.resourceType &&
            resourceLocation(s, resource) === place.id,
        ),
    ),
  )
}

/** A location shut all day: closed on its weekly hours, or closed for the whole of its hours. */
export function placeClosed(s: BusinessState, date: string, locationId?: string) {
  const hours = hoursFor(s, date, locationId)
  if (!hours || hours.closed) return true
  return operations(s).closures.some(
    (c) =>
      c.date === date && !c.staffId && c.startMinutes <= hours.open && c.endMinutes >= hours.close,
  )
}
