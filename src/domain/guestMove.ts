import type { BusinessState } from './model'
import { rescheduleResource } from './commands'
import { businessDate, hoursFor, instantFor, operations } from './operations'
import { addDays } from './format'

/**
 * A guest moves their own visit from their private link: the same treatment at the same location,
 * with the same professional or anyone qualified, to a time that is free for desk bookings and
 * online holds alike. What was booked (treatment, price, deposit, length and resting time) stays.
 * The server checks every move again; these lists only show the guest what they can choose.
 */

/** How far ahead, from today, a guest can move their visit. */
export const GUEST_MOVE_DAYS = 60

const DAY = 24 * 60 * 60000

export type MoveDay = {
  date: string
  /** False when the studio is closed all that day, or today once it has shut. */
  open: boolean
}
export type MoveTime = {
  startMinutes: number
  staffId: string
  /** The professional's first name, as the guest's visit shows it. */
  professional: string
}

const firstName = (name: string) => name.split(' ')[0]

/** Whether the visit's location is open on a day, for at least part of it, from now. */
function openOn(s: BusinessState, date: string, locationId: string, now: number) {
  const hours = hoursFor(s, date, locationId)
  if (!hours || hours.closed) return false
  // A closure for everyone across the whole day shuts it too.
  if (
    operations(s).closures.some(
      (c) =>
        c.date === date &&
        !c.staffId &&
        c.startMinutes <= hours.open &&
        c.endMinutes >= hours.close,
    )
  )
    return false
  try {
    return Date.parse(instantFor(s, date, Math.min(hours.close, 1439))) > now
  } catch {
    return true
  }
}

/**
 * The days a guest can move to, from today, each saying whether the studio is open. `linkEnds` is
 * when the link they are using stops opening at the latest, so the new visit is always a day the
 * link still opens on.
 */
export function guestMoveDays(
  s: BusinessState,
  appointmentId: string,
  now: number,
  linkEnds = Infinity,
): MoveDay[] {
  const a = s.appointments.find((item) => item.id === appointmentId)
  if (!a) throw new Error('This visit is not in the studio record.')
  const today = businessDate(s, new Date(now).toISOString())
  const days: MoveDay[] = []
  for (let i = 0; i < GUEST_MOVE_DAYS; i++) {
    const date = addDays(today, i)
    // A day ahead of the date's start in any time zone, with room to spare.
    if (Date.parse(`${date}T00:00:00Z`) + 2 * DAY > linkEnds) break
    days.push({ date, open: openOn(s, date, a.locationId, now) })
  }
  return days
}

/** Whether a time is still ahead on the studio's clock. Times the clocks skip never are. */
export function timeAhead(s: BusinessState, date: string, startMinutes: number, now: number) {
  try {
    return Date.parse(instantFor(s, date, startMinutes)) > now
  } catch {
    return false
  }
}

/**
 * The free times on one day for this visit, every fifteen minutes. Pass the studio record with
 * online holds added, so a time a guest is holding on the booking page is never offered. With
 * `anyone`, each time goes to the visit's own professional when they are free, otherwise to the
 * first qualified professional who is. The visit's own time is left out.
 */
export function guestMoveTimes(
  s: BusinessState,
  appointmentId: string,
  date: string,
  now: number,
  anyone: boolean,
): MoveTime[] {
  const a = s.appointments.find((item) => item.id === appointmentId)
  if (!a) throw new Error('This visit is not in the studio record.')
  const at = new Date(now).toISOString()
  const people = [
    ...s.staff.filter((person) => person.id === a.staffId),
    ...(anyone
      ? s.staff.filter(
          (person) =>
            person.id !== a.staffId && !person.archived && person.serviceIds.includes(a.serviceId),
        )
      : []),
  ]
  const times: MoveTime[] = []
  for (let start = 0; start < 1440; start += 15) {
    if (date === a.date && start === a.startMinutes) continue
    if (!timeAhead(s, date, start, now)) continue
    const person = people.find((p) => rescheduleResource(s, a.id, p.id, date, start, at))
    if (person)
      times.push({ startMinutes: start, staffId: person.id, professional: firstName(person.name) })
  }
  return times
}
