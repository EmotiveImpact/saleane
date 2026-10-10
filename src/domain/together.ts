import type { Appointment, BusinessState } from './model'
import { timeLabel } from './format'
import { visitOrder } from './repeat'

/**
 * NEXT-08: visits booked together for several people on one day, such as a couple side by side or
 * a bridal party. Each person is a client of their own, with their own visit, forms, patch tests
 * and history; the visits are linked so the desk sees them as one booking and can cancel them
 * together. A room for two lets two of them share a room at the same time.
 */

/** The most people booked together, the first included. */
export const TOGETHER_MOST = 8

/** Every visit booked together with this one, soonest first, cancelled ones included. */
export function togetherVisits(s: BusinessState, a: Appointment) {
  const id = a.together?.id
  if (!id) return []
  return s.appointments
    .filter((x) => x.together?.id === id)
    .sort(
      (x, y) =>
        visitOrder(x).localeCompare(visitOrder(y)) ||
        Number(!!y.together?.lead) - Number(!!x.together?.lead),
    )
}

/** The others booked with this visit, leaving out any that were cancelled. */
export function othersTogether(s: BusinessState, a: Appointment) {
  return togetherVisits(s, a).filter((x) => x.id !== a.id && x.status !== 'cancelled')
}

/** The others booked with this visit that are still to come, for cancelling together. */
export function upcomingTogether(s: BusinessState, a: Appointment) {
  return togetherVisits(s, a).filter((x) => x.id !== a.id && x.status === 'confirmed')
}

const nameOf = (s: BusinessState, clientId: string) =>
  s.clients.find((c) => c.id === clientId)?.name ?? 'A guest'
const firstName = (name: string) => name.trim().split(/\s+/)[0]
const list = (items: string[]) =>
  items.length < 2 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`

/** "Booked with Amy Lee and Jo Park", naming the others still booked. */
export function togetherLabel(s: BusinessState, a: Appointment) {
  const others = othersTogether(s, a)
  return others.length ? `Booked with ${list(others.map((x) => nameOf(s, x.clientId)))}` : ''
}

/** One of the others, as the desk sees it: "Amy Lee, Swedish Massage with Theo at 10:00". */
export function togetherLine(s: BusinessState, x: Appointment) {
  const service =
    x.bookedServiceName ?? s.services.find((item) => item.id === x.serviceId)?.name ?? 'a visit'
  const who = s.staff.find((p) => p.id === x.staffId)?.name
  return `${nameOf(s, x.clientId)}, ${service}${who ? ` with ${firstName(who)}` : ''} at ${timeLabel(x.startMinutes, s.organisation.locale)}`
}

/**
 * For the confirmation of the person the booking was made for: who else is booked, and when.
 * Only they are told about the others; each guest has their own confirmation.
 */
export function bookedWithYouLine(s: BusinessState, a: Appointment) {
  if (!a.together?.lead) return ''
  const others = othersTogether(s, a)
  if (!others.length) return ''
  return `Also booked with you: ${list(others.map((x) => togetherLine(s, x)))}.`
}

/** For a guest's own confirmation: who they are booked with. */
export function bookedByLine(s: BusinessState, a: Appointment) {
  if (!a.together || a.together.lead) return ''
  const lead = othersTogether(s, a).find((x) => x.together?.lead)
  return lead ? `Booked together with ${nameOf(s, lead.clientId)}.` : ''
}

const cancelledAt = (s: BusinessState, id: string) =>
  s.events.filter((e) => e.appointmentId === id && e.type === 'cancelled').at(-1)?.occurredAt

/** The others booked with it that were cancelled at the same moment as this one. */
export function cancelledWith(s: BusinessState, a: Appointment) {
  const at = a.together && a.status === 'cancelled' ? cancelledAt(s, a.id) : undefined
  if (!at) return []
  return togetherVisits(s, a).filter(
    (x) => x.id !== a.id && x.status === 'cancelled' && cancelledAt(s, x.id) === at,
  )
}

/** For the cancellation of the person the booking was made for, when the others went too. */
export function cancelledWithLine(s: BusinessState, a: Appointment) {
  if (!a.together?.lead) return ''
  const others = cancelledWith(s, a)
  if (!others.length) return ''
  return `The ${others.length === 1 ? 'visit' : 'visits'} booked with yours for ${list(others.map((x) => firstName(nameOf(s, x.clientId))))} ${others.length === 1 ? 'is' : 'are'} cancelled too.`
}
