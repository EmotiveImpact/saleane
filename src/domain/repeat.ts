import type { Appointment, BusinessState } from './model'
import { addDays, dateLabel, timeLabel } from './format'

/**
 * NEXT-09: repeat visits. A client who comes every few weeks can have the next several visits
 * booked in one go, each a visit of its own: it can move, be cancelled or be checked out alone,
 * and the later ones can be cancelled together.
 */

/** How often a visit can repeat, in weeks. */
export const REPEAT_EVERY = [1, 2, 3, 4, 5, 6, 8, 10, 12] as const
/** How many visits the desk can choose, the first included. */
export const REPEAT_COUNTS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const
/** The most visits one repeat can hold, the first included. */
export const REPEAT_MOST = REPEAT_COUNTS.at(-1)!
/** Repeat visits go no further ahead than a booking can. */
export const REPEAT_AHEAD_DAYS = 365

export const everyLabel = (weeks: number) => (weeks === 1 ? 'every week' : `every ${weeks} weeks`)

/** The dates a repeat falls on, the first included. */
export function repeatDates(first: string, everyWeeks: number, count: number) {
  return Array.from({ length: count }, (_, i) => addDays(first, i * everyWeeks * 7))
}

export const visitOrder = (a: Pick<Appointment, 'date' | 'startMinutes'>) =>
  `${a.date}:${String(a.startMinutes).padStart(4, '0')}`

/** Every visit of the repeat this visit belongs to, soonest first, cancelled ones included. */
export function repeatVisits(s: BusinessState, a: Appointment) {
  const id = a.repeat?.id
  if (!id) return []
  return s.appointments
    .filter((x) => x.repeat?.id === id)
    .sort((x, y) => visitOrder(x).localeCompare(visitOrder(y)))
}

/** The visits of its repeat still to come after this one. */
export function laterInRepeat(s: BusinessState, a: Appointment) {
  return repeatVisits(s, a).filter(
    (x) => x.id !== a.id && x.status === 'confirmed' && visitOrder(x) > visitOrder(a),
  )
}

/** "Visit 2 of 6, repeating every 4 weeks", counting the visits not cancelled. */
export function repeatLabel(s: BusinessState, a: Appointment) {
  if (!a.repeat) return ''
  const kept = repeatVisits(s, a).filter((x) => x.status !== 'cancelled')
  const place = kept.findIndex((x) => x.id === a.id)
  const rhythm = everyLabel(a.repeat.everyWeeks)
  return place < 0
    ? `One of the visits repeating ${rhythm}`
    : `Visit ${place + 1} of ${kept.length}, repeating ${rhythm}`
}

/** The later visits of a repeat in words, for the first visit's confirmation. */
export function alsoBookedLine(s: BusinessState, a: Appointment) {
  const later = laterInRepeat(s, a)
  if (!later.length || !a.repeat) return ''
  const { locale } = s.organisation
  const sameTime = later.every((x) => x.startMinutes === a.startMinutes)
  const days = later.map((x) =>
    sameTime
      ? dateLabel(x.date, locale)
      : `${dateLabel(x.date, locale)} at ${timeLabel(x.startMinutes, locale)}`,
  )
  const list = days.length === 1 ? days[0] : `${days.slice(0, -1).join(', ')} and ${days.at(-1)}`
  return `Also booked, ${everyLabel(a.repeat.everyWeeks)}: ${list}${sameTime ? `, each at ${timeLabel(a.startMinutes, locale)}` : ''}.`
}

const cancelledAt = (s: BusinessState, id: string) =>
  s.events.filter((e) => e.appointmentId === id && e.type === 'cancelled').at(-1)?.occurredAt

/** The other visits of its repeat that were cancelled at the same moment as this one. */
export function cancelledTogether(s: BusinessState, a: Appointment) {
  const at = a.repeat && a.status === 'cancelled' ? cancelledAt(s, a.id) : undefined
  if (!at) return []
  return repeatVisits(s, a).filter(
    (x) => x.id !== a.id && x.status === 'cancelled' && cancelledAt(s, x.id) === at,
  )
}

/** The later visits cancelled with this one, in words, for its cancellation message. */
export function cancelledTooLine(s: BusinessState, a: Appointment) {
  const later = cancelledTogether(s, a).filter((x) => visitOrder(x) > visitOrder(a))
  if (!later.length) return ''
  const days = later.map((x) => dateLabel(x.date, s.organisation.locale))
  const list = days.length === 1 ? days[0] : `${days.slice(0, -1).join(', ')} and ${days.at(-1)}`
  return `Your ${later.length === 1 ? 'visit' : 'visits'} on ${list} ${later.length === 1 ? 'is' : 'are'} cancelled too.`
}
