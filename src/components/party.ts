import type { BusinessState } from '../domain/model'
import { previewTogether, slots } from '../domain/commands'
import type { PartyPerson } from '../domain/commands'

/**
 * NEXT-08: the others coming with the first person, as the desk adds them while booking. Each is
 * a client of their own, with their own treatment, professional and time on the same day.
 */
export type PartyGuest = {
  key: number
  clientId: string
  someoneNew: boolean
  name: string
  email: string
  phone: string
  serviceId: string
  /** A professional, or "any" for whoever is free. */
  staffId: string
  /** The time the desk chose; otherwise the first person's time, or the nearest free one. */
  pick: number | null
}

/** Where one of the others would be booked, worked out from everyone above them. */
export type PartyRow = {
  times: number[]
  start: number | null
  why: 'same' | 'moved' | 'chosen' | 'full' | 'waiting'
  staffId?: string
  resourceId?: string
  /** Someone above them they would share a room for two with. */
  sharingWith?: string
}

const NEAR = 120

/**
 * For each of the others, the times still free once everyone above them is booked, and the time
 * they would have: the first person's when free, so they are side by side, or the nearest.
 */
export function partyRows(
  s: BusinessState,
  date: string,
  first: PartyPerson | null,
  guests: PartyGuest[],
  locationId: string | undefined,
  personName: (index: number) => string,
): PartyRow[] {
  if (!first) return guests.map(() => ({ times: [], start: null, why: 'waiting' }))
  const people: PartyPerson[] = [first]
  const rows: PartyRow[] = []
  let stuck = false
  for (const guest of guests) {
    const preview = stuck ? undefined : previewTogether(s, date, people, locationId)
    if (!preview?.ok) {
      stuck = true
      rows.push({ times: [], start: null, why: 'waiting' })
      continue
    }
    const times = guest.serviceId
      ? slots(
          preview.state,
          guest.serviceId,
          guest.staffId,
          date,
          undefined,
          locationId,
          preview.together,
        )
      : []
    const near = [...times].sort(
      (a, b) => Math.abs(a - first.startMinutes) - Math.abs(b - first.startMinutes) || a - b,
    )[0]
    const row: PartyRow =
      guest.pick !== null && times.includes(guest.pick)
        ? {
            times,
            start: guest.pick,
            why: guest.pick === first.startMinutes ? 'same' : 'chosen',
          }
        : times.includes(first.startMinutes)
          ? { times, start: first.startMinutes, why: 'same' }
          : near !== undefined && Math.abs(near - first.startMinutes) <= NEAR
            ? { times, start: near, why: 'moved' }
            : { times, start: null, why: 'full' }
    rows.push(row)
    if (row.start === null) stuck = true
    else
      people.push({
        ...(guest.clientId && !guest.someoneNew ? { clientId: guest.clientId } : {}),
        serviceId: guest.serviceId,
        staffId: guest.staffId,
        startMinutes: row.start,
      })
  }
  // Who each would be with, and in which room, once everyone is in place.
  const all = previewTogether(s, date, people, locationId)
  if (all.ok)
    all.made.slice(1).forEach((visit, index) => {
      const row = rows[index]
      row.staffId = visit.staffId
      row.resourceId = visit.resourceId
      const partner = all.made.findIndex(
        (other) =>
          other !== visit &&
          other.resourceId === visit.resourceId &&
          other.startMinutes < visit.startMinutes + visit.bookedDurationMinutes &&
          visit.startMinutes < other.startMinutes + other.bookedDurationMinutes,
      )
      if (partner >= 0) row.sharingWith = personName(partner)
    })
  return rows
}
