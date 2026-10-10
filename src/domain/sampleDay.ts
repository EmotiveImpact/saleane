import { addDays } from './format'
import { DEMO_DATE } from './model'
import type { Appointment, BusinessState } from './model'
import { businessDate, businessMinutes, instantIn } from './operations'

const DAY = 86_400_000
/** Guests settle up and leave a little after their treatment ends. */
const SETTLING_MINUTES = 20

/**
 * Where a visit stands at a time on its own day: still to come, under way (or settling up), or
 * done. A sample studio's day follows this, at 10:45 or on the real clock.
 */
export function visitStatusAt(
  a: Pick<Appointment, 'startMinutes' | 'bookedDurationMinutes'>,
  minutes: number,
) {
  const leaves = a.startMinutes + a.bookedDurationMinutes + SETTLING_MINUTES
  return leaves <= minutes ? 'completed' : a.startMinutes <= minutes ? 'arrived' : 'confirmed'
}

/**
 * Moves a sample studio so its sample day falls on another date, as the browser demo moves its
 * London studio onto today. Every date and moment moves by the same number of days on the studio's
 * own clock, so 09:26 stays 09:26 when the clocks change between them. The weekly hours turn with
 * the days, so each moved day keeps the opening hours and rota it had.
 */
export function moveSampleDay(s: BusinessState, to: string): BusinessState {
  const days = Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${DEMO_DATE}T00:00:00Z`)) / DAY,
  )
  const zone = s.organisation.timeZone
  const clock = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
  const moveInstant = (value: string) => {
    const at = Date.parse(value)
    const part = Object.fromEntries(clock.formatToParts(at).map((p) => [p.type, p.value]))
    const date = addDays(`${part.year}-${part.month}-${part.day}`, days)
    try {
      const minute = Number(part.hour) * 60 + Number(part.minute)
      return new Date(Date.parse(instantIn(zone, date, minute)) + (at % 60_000)).toISOString()
    } catch {
      // A time the clocks skip or repeat on the new day moves by whole days instead.
      return new Date(at + days * DAY).toISOString()
    }
  }
  const move = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(move)
    if (value && typeof value === 'object')
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, move(item)]))
    if (typeof value !== 'string') return value
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return addDays(value, days)
    return /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(value) ? moveInstant(value) : value
  }
  const moved = move(s) as BusinessState
  const turn = ((days % 7) + 7) % 7
  for (const week of [moved.operations?.hours, ...moved.staff.map((person) => person.hours)]) {
    if (!week) continue
    for (const hours of week) hours.day = (hours.day + turn) % 7
    week.sort((a, b) => a.day - b.day)
  }
  return moved
}

/**
 * A sample studio moved onto the real calendar still holds its sample day as it stood at 10:45.
 * This lets the studio's own clock decide instead: guests who have been and gone are done, anyone
 * under way is in the studio and later visits are still to come, and nothing is recorded later
 * than now. Run it on a studio that follows the real clock, once its sample receipts and payments
 * have gone.
 */
export function catchUpSampleDay(s: BusinessState, now: number) {
  const iso = new Date(now).toISOString()
  const today = businessDate(s, iso)
  const minutes = businessMinutes(s, iso)
  const later = (at: string | undefined) => !!at && Date.parse(at) > now
  // Visits booked later this morning were booked the morning before instead, so the diary keeps them.
  const dayBefore = (at: string) => new Date(Date.parse(at) - DAY).toISOString()
  // Today's visits still to come, with when the guest said they were here, if they have.
  const toCome = new Map<string, string | undefined>()
  for (const a of s.appointments) {
    if (later(a.createdAt)) a.createdAt = dayBefore(a.createdAt)
    if (later(a.guestHereAt)) delete a.guestHereAt
    if (a.date !== today || a.status === 'cancelled' || a.status === 'no_show') continue
    a.status = visitStatusAt(a, minutes)
    if (a.status === 'confirmed') toCome.set(a.id, a.guestHereAt)
  }
  for (const client of s.clients)
    if (later(client.createdAt)) client.createdAt = dayBefore(client.createdAt)
  s.events = s.events.flatMap((event) => {
    // The desk has welcomed no one still to come, though a guest may have said they are here.
    const visit = event.appointmentId
    if (
      event.type === 'arrived' &&
      visit &&
      toCome.has(visit) &&
      event.occurredAt !== toCome.get(visit)
    )
      return []
    if (!later(event.occurredAt)) return [event]
    return event.type === 'booked' ? [{ ...event, occurredAt: dayBefore(event.occurredAt) }] : []
  })
  const o = s.operations
  if (o?.missedCalls)
    o.missedCalls = o.missedCalls.flatMap((call) =>
      later(call.at) ? [] : later(call.lastAt) ? [{ ...call, lastAt: call.at, calls: 1 }] : [call],
    )
  // Stage 4: a request asked for later this morning was asked the morning before instead, and a
  // refund request goes with the sample receipt it was for.
  if (o?.requests)
    o.requests = o.requests.flatMap((r) => {
      const gone =
        (r.refund?.saleId && !s.sales.some((x) => x.id === r.refund!.saleId)) ||
        (r.refund?.paymentId && !s.payments.some((x) => x.id === r.refund!.paymentId)) ||
        (r.refund?.counterSaleId &&
          !(s.counterSales ?? []).some((x) => x.id === r.refund!.counterSaleId))
      if (gone) return []
      return [later(r.raisedAt) ? { ...r, raisedAt: dayBefore(r.raisedAt) } : r]
    })
  if (s.replies) s.replies = s.replies.filter((reply) => !later(reply.receivedAt))
  if (s.feedback) s.feedback = s.feedback.filter((answer) => !later(answer.createdAt))
  if (s.consentRecords) s.consentRecords = s.consentRecords.filter((r) => !later(r.recordedAt))
  if (s.formResponses) s.formResponses = s.formResponses.filter((r) => !later(r.submittedAt))
  return s
}
