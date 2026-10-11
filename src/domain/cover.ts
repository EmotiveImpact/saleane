import { rescheduleResource } from './commands'
import type { Command } from './commands'
import { dateLabel, timeLabel } from './format'
import type { Appointment, BusinessState } from './model'
import { businessDate, businessMinutes, hoursFor, staffHoursFor } from './operations'
import { staffLocationOn } from './locations'

/**
 * Someone is off: a plan for their day. Each upcoming visit goes to another professional who does
 * the treatment and is free at the same time; a visit nobody can take keeps its place and the
 * guest is asked to choose a new time. Their remaining time is closed so nobody books them, and a
 * short note to each guest is drafted unsent. The plan only proposes: it changes nothing until a
 * person approves it, and then as one change.
 */

export type CoverMove = { appointment: Appointment; toStaffId: string; resourceId: string }
export type CoverPlan = {
  staffId: string
  date: string
  moves: CoverMove[]
  /** Visits nobody else can take at that time. They stay booked until the guest picks a new time. */
  unplaced: Appointment[]
  /** The commands that carry the plan out, in order, for one approval. */
  commands: BatchPart[]
}
type BatchPart = Extract<Command, { type: 'batch' }>['commands'][number]

const first = (name: string) => name.split(' ')[0]

export function coverPlan(
  s: BusinessState,
  staffId: string,
  date: string,
  now = new Date().toISOString(),
): CoverPlan {
  const person = s.staff.find((p) => p.id === staffId)
  if (!person) throw new Error('There is no professional with that id.')
  // The studio's own clock: today's visits count from now on, a later day counts in full.
  const today = businessDate(s, now)
  const from = date > today ? 0 : date === today ? businessMinutes(s, now) : 1440
  const upcoming = s.appointments
    .filter(
      (a) =>
        a.staffId === staffId &&
        a.date === date &&
        a.status === 'confirmed' &&
        a.startMinutes > from,
    )
    .sort((a, b) => a.startMinutes - b.startMinutes)

  // Moves are planned one after another on a working copy, so two visits never land on the
  // same person at the same time.
  let working = structuredClone(s)
  const moves: CoverMove[] = []
  const unplaced: Appointment[] = []
  for (const a of upcoming) {
    const others = s.staff.filter(
      (p) => p.id !== staffId && !p.archived && p.serviceIds.includes(a.serviceId),
    )
    let placed: CoverMove | undefined
    for (const other of others) {
      const resourceId = rescheduleResource(working, a.id, other.id, date, a.startMinutes, now)
      if (resourceId) {
        placed = { appointment: a, toStaffId: other.id, resourceId }
        break
      }
    }
    if (!placed) {
      unplaced.push(a)
      continue
    }
    moves.push(placed)
    working = structuredClone(working)
    const moved = working.appointments.find((x) => x.id === a.id)!
    moved.staffId = placed.toStaffId
    moved.resourceId = placed.resourceId
  }

  const locale = s.organisation.locale
  const day = dateLabel(date, locale)
  // Neutral wording: the reason someone is off is theirs to share, and the plan may be for a later day.
  const when = date === today ? 'today' : `on ${day}`
  const name = (id: string) => s.staff.find((p) => p.id === id)?.name ?? 'another professional'
  const client = (a: Appointment) => s.clients.find((c) => c.id === a.clientId)
  const service = (a: Appointment) =>
    a.bookedServiceName ?? s.services.find((x) => x.id === a.serviceId)?.name ?? 'visit'
  const commands: BatchPart[] = []
  for (const m of moves)
    commands.push({
      type: 'reschedule',
      appointmentId: m.appointment.id,
      date,
      startMinutes: m.appointment.startMinutes,
      staffId: m.toStaffId,
      resourceId: m.resourceId,
    })
  for (const m of moves) {
    const guest = client(m.appointment)
    if (!guest) continue
    commands.push({
      type: 'message',
      input: {
        clientId: guest.id,
        appointmentId: m.appointment.id,
        purpose: 'appointment',
        subject: `Your ${service(m.appointment)} on ${day}`,
        body: `Hello ${first(guest.name)}, ${first(person.name)} is not in ${when}, so ${first(name(m.toStaffId))} will look after you instead, at the same time: ${timeLabel(m.appointment.startMinutes, locale)}. If you would rather wait for ${first(person.name)}, reply and we will find you another day.`,
      },
    })
  }
  for (const a of unplaced) {
    const guest = client(a)
    if (!guest) continue
    commands.push({
      type: 'message',
      input: {
        clientId: guest.id,
        appointmentId: a.id,
        purpose: 'appointment',
        subject: `Your ${service(a)} on ${day}`,
        body: `Hello ${first(guest.name)}, ${first(person.name)} is not in ${when} and nobody else is free to do your ${service(a)} at ${timeLabel(a.startMinutes, locale)}. We are sorry. Reply with a day that suits you and we will move it for you.`,
      },
    })
  }

  // Close what is left of their day, around any visit still waiting for a new time.
  const venue = hoursFor(s, date, staffLocationOn(s, staffId, date))
  const own = staffHoursFor(s, staffId, date)
  if (venue && !venue.closed && !own.closed) {
    let start = Math.max(venue.open, own.open, Math.ceil(from / 15) * 15)
    const end = Math.min(venue.close, own.close)
    const kept = [...unplaced].sort((a, b) => a.startMinutes - b.startMinutes)
    for (const a of [...kept, null]) {
      const until = a ? a.startMinutes : end
      if (until > start)
        commands.push({
          type: 'closure',
          input: {
            date,
            staffId,
            startMinutes: start,
            endMinutes: until,
            reason: `${first(person.name)} is off`,
          },
        })
      if (a)
        start = Math.max(start, a.startMinutes + a.bookedDurationMinutes + a.bookedBufferMinutes)
    }
  }
  return { staffId, date, moves, unplaced, commands }
}
