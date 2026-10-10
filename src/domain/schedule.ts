import type { Appointment, BusinessState } from './model'
import type { OperatingCommand } from './commandSchema'
import { dateLabel, timeLabel } from './format'
import {
  businessDate,
  hoursFor,
  instantFor,
  operations,
  staffHoursFor,
  timeOffOn,
} from './operations'
import { TIME_OFF_LABEL } from './timeOff'
import { placeOf, resourceLocation, staffLocationOn } from './locations'
import type { Operations } from './operations'

/**
 * LOCAL-04: schedule administration continuity.
 *
 * A change to opening hours, a professional's hours, closures, or archiving a professional or room
 * never moves or cancels a booked visit. Instead it is refused while it would newly strand an
 * upcoming visit, and `scheduleImpact` lets the screen name those visits before anyone saves.
 * Accepted changes leave a plain-language record with their structured before and after.
 */
export type ScheduleChange = NonNullable<Operations['scheduleHistory']>[number]
export type AffectedVisit = {
  appointmentId: string
  date: string
  startMinutes: number
  clientFirstName: string
  staffName: string
  serviceName: string
  reason: string
}
type WeeklyHours = Operations['hours']
type Closure = Operations['closures'][number]

const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const weekOrder = [1, 2, 3, 4, 5, 6, 0]

/**
 * A visit still to happen: confirmed or arrived, and not yet over in venue time. Past days never
 * count. In the fictional sample the clock is fixed, so the whole sample day counts.
 */
export function isUpcoming(s: BusinessState, a: Appointment, now: string) {
  if (!['confirmed', 'arrived'].includes(a.status)) return false
  const today = businessDate(s, now)
  if (a.date !== today) return a.date > today
  if (operations(s).mode === 'sandbox') return true
  try {
    const end =
      Date.parse(instantFor(s, a.date, a.startMinutes)) +
      (a.bookedDurationMinutes + a.bookedBufferMinutes) * 60000
    return end > Date.parse(now)
  } catch {
    // A time the clocks skipped or repeated cannot be placed exactly; keep protecting it.
    return true
  }
}

/** Why a booked visit no longer fits the schedule in `s`, or null when it still fits. */
export function scheduleConflict(s: BusinessState, a: Appointment): string | null {
  const person = s.staff.find((p) => p.id === a.staffId)
  const resource = s.resources.find((r) => r.id === a.resourceId)
  const serviceName =
    a.bookedServiceName ?? s.services.find((x) => x.id === a.serviceId)?.name ?? 'this treatment'
  const staffName = person?.name ?? 'The professional'
  const roomName = resource?.name ?? 'The room'
  if (!person || person.archived) return `${staffName} would be archived`
  if (!resource || resource.archived) return `${roomName} would be archived`
  if (!person.serviceIds.includes(a.serviceId))
    return `${staffName} would no longer offer ${serviceName}`
  if (a.bookedResourceType && resource.type !== a.bookedResourceType)
    return `${roomName} would no longer suit ${serviceName}`
  // V2: the visit's location must stay open, with the room there and the person working there.
  const place = placeOf(s, a.locationId)
  if (!place || place.archived) return `${place?.name ?? 'The location'} would be closed`
  if (resourceLocation(s, resource) !== a.locationId)
    return `${roomName} would be at another location`
  const venue = hoursFor(s, a.date, a.locationId),
    own = staffHoursFor(s, a.staffId, a.date)
  if (venue.closed) return 'The venue would be closed that day'
  const away = timeOffOn(s, a.staffId, a.date)
  if (away) return `${staffName} would be away (${TIME_OFF_LABEL[away.kind].toLowerCase()})`
  if (own.closed) return `${staffName} would not be working that day`
  if (staffLocationOn(s, a.staffId, a.date) !== a.locationId)
    return `${staffName} would be working at another location that day`
  const treatmentEnd = a.startMinutes + a.bookedDurationMinutes
  const end = treatmentEnd + a.bookedBufferMinutes
  // NEXT-08: visits booked together share a room only while it is a room for two.
  if (
    a.together &&
    !resource.forTwo &&
    s.appointments.some(
      (x) =>
        x.id !== a.id &&
        x.resourceId === a.resourceId &&
        x.date === a.date &&
        x.status !== 'cancelled' &&
        x.status !== 'no_show' &&
        x.startMinutes < end &&
        a.startMinutes < x.startMinutes + x.bookedDurationMinutes + x.bookedBufferMinutes,
    )
  )
    return `${roomName} would no longer take two at once`
  if (a.startMinutes < venue.open) return 'It would start before opening'
  if (a.startMinutes < own.open) return `It would start before ${staffName} begins`
  const close = Math.min(venue.close, own.close)
  const closer = venue.close <= own.close ? 'closing' : `${staffName} finishes`
  if (treatmentEnd > close) return `It would end after ${closer}`
  if (end > close) return `Its turnaround would run past ${closer}`
  const closure = operations(s).closures.find(
    (c) =>
      c.date === a.date &&
      (!c.staffId || c.staffId === a.staffId) &&
      a.startMinutes < c.endMinutes &&
      end > c.startMinutes,
  )
  if (closure)
    return closure.staffId
      ? `It would overlap ${staffName}'s time away (${closure.reason})`
      : `It would overlap a venue closure (${closure.reason})`
  return null
}

/** Upcoming visits that fit before the change and would not fit after it. */
export function affectedVisits(before: BusinessState, after: BusinessState, now: string) {
  const affected: AffectedVisit[] = []
  for (const a of after.appointments) {
    if (!isUpcoming(after, a, now)) continue
    const reason = scheduleConflict(after, a)
    // A visit that already did not fit is not this change's doing, so it does not block it.
    if (!reason || scheduleConflict(before, a)) continue
    affected.push({
      appointmentId: a.id,
      date: a.date,
      startMinutes: a.startMinutes,
      clientFirstName:
        after.clients
          .find((c) => c.id === a.clientId)
          ?.name.trim()
          .split(/\s+/)[0] ?? 'A client',
      staffName: after.staff.find((p) => p.id === a.staffId)?.name ?? 'a professional',
      serviceName:
        a.bookedServiceName ?? after.services.find((x) => x.id === a.serviceId)?.name ?? '',
      reason,
    })
  }
  return affected.sort((x, y) => x.date.localeCompare(y.date) || x.startMinutes - y.startMinutes)
}

/** Copies only what a schedule edit changes, leaving visits and money shared with `s`. */
export function scheduleSnapshot(s: BusinessState): BusinessState {
  return {
    ...s,
    operations: structuredClone(operations(s)),
    staff: s.staff.map((p) => ({ ...p })),
    resources: s.resources.map((r) => ({ ...r })),
  }
}

/** The schedule as it would be after `command`, or null for a command that does not touch it. */
function proposed(s: BusinessState, command: OperatingCommand) {
  const next = scheduleSnapshot(s)
  const o = next.operations!
  if (command.type === 'hours') o.hours = command.hours
  else if (command.type === 'closure') o.closures.push({ ...command.input, id: 'proposed' })
  else if (command.type === 'time-off')
    o.timeOff = [
      ...(o.timeOff ?? []),
      { ...command.input, id: 'proposed', createdAt: new Date(0).toISOString(), actor: '' },
    ]
  else if (command.type === 'location') {
    const list = (o.locations ??= [])
    const old = command.id ? list.find((l) => l.id === command.id) : undefined
    if (!old) return null
    Object.assign(old, command.input)
    if (!command.input.hours) delete old.hours
  } else if (command.type === 'staff' || command.type === 'resource') {
    const rows: { id: string }[] = command.type === 'staff' ? next.staff : next.resources
    const old = command.id ? rows.find((r) => r.id === command.id) : undefined
    if (!old) return null
    Object.assign(old, command.input)
    if (command.type === 'staff' && !command.input.hours) delete (old as { hours?: unknown }).hours
    if (command.type === 'resource' && !command.input.locationId)
      delete (old as { locationId?: unknown }).locationId
    if (command.type === 'resource' && !command.input.forTwo)
      delete (old as { forTwo?: unknown }).forTwo
  } else return null
  return next
}

/**
 * Pure preview for the screen: which upcoming visits a proposed hours, closure, professional or
 * room change would strand. The server makes the same check again inside the save.
 */
export function scheduleImpact(s: BusinessState, command: OperatingCommand, now: string) {
  try {
    const next = proposed(s, command)
    return next ? affectedVisits(s, next, now) : []
  } catch {
    // An incomplete form (for example a closing time before opening) has no impact to show yet.
    return []
  }
}

/** One visit described the same way on screen and in a refusal. */
export function describeVisit(v: AffectedVisit, locale: string) {
  return `${dateLabel(v.date, locale, true)} ${timeLabel(v.startMinutes, locale)}, ${v.clientFirstName} with ${v.staffName}`
}

/** Refuses a change that would strand upcoming visits, naming each of them. */
export function assertSchedulePreserved(before: BusinessState, after: BusinessState, now: string) {
  const affected = affectedVisits(before, after, now)
  if (!affected.length) return
  const locale = after.organisation.locale
  const shown = affected.slice(0, 5).map((v) => `${describeVisit(v, locale)} (${v.reason})`)
  const more = affected.length - shown.length
  const one = affected.length === 1
  throw new Error(
    `This change would affect ${affected.length} upcoming ${one ? 'visit' : 'visits'}: ${shown.join('; ')}${
      more ? `; and ${more} more` : ''
    }. Move or cancel ${one ? 'it' : 'them'} first, then save again.`,
  )
}

function clock(minutes: number, locale: string) {
  return minutes >= 1440 ? 'midnight' : timeLabel(minutes, locale)
}
function dayText(h: WeeklyHours[number], locale: string) {
  return h.closed ? 'closed' : `${clock(h.open, locale)} to ${clock(h.close, locale)}`
}
function weekDifference(before: WeeklyHours, after: WeeklyHours, locale: string) {
  return weekOrder
    .map((day) => {
      const a = before.find((h) => h.day === day),
        b = after.find((h) => h.day === day)
      if (!a || !b) return ''
      const from = dayText(a, locale),
        to = dayText(b, locale)
      return from === to ? '' : `${weekdays[day]} ${from} became ${to}`
    })
    .filter(Boolean)
}
/** Days a person's location changed (V2), as "Thursday at Islington, was Marylebone". */
function placeDifference(s: BusinessState, before: WeeklyHours, after: WeeklyHours) {
  const main = s.organisation.locationId
  return weekOrder
    .map((day) => {
      const a = before.find((h) => h.day === day)?.locationId ?? main,
        b = after.find((h) => h.day === day)?.locationId ?? main
      return a === b ? '' : `${weekdays[day]} at ${placeOf(s, b)?.name}, was ${placeOf(s, a)?.name}`
    })
    .filter(Boolean)
}
function closureText(s: BusinessState, c: Closure) {
  const locale = s.organisation.locale
  const who = c.staffId
    ? `${s.staff.find((p) => p.id === c.staffId)?.name ?? 'A professional'} away`
    : 'Venue closed'
  return `${who} ${dateLabel(c.date, locale)}, ${clock(c.startMinutes, locale)} to ${clock(c.endMinutes, locale)} (${c.reason})`
}

/**
 * The history entries an accepted change leaves, in plain words with structured data. Changes
 * that do not alter the schedule (a renamed room, a new professional) leave none.
 */
export function scheduleChanges(
  before: BusinessState,
  after: BusinessState,
  command: OperatingCommand,
  subjectId: string,
): Omit<ScheduleChange, 'id' | 'occurredAt' | 'actor'>[] {
  const locale = after.organisation.locale
  const was = operations(before),
    now = operations(after)
  if (command.type === 'hours') {
    const changed = weekDifference(was.hours, now.hours, locale)
    if (!changed.length) return []
    return [
      {
        kind: 'hours',
        summary: `Opening hours changed: ${changed.join('; ')}.`,
        before: was.hours,
        after: now.hours,
      },
    ]
  }
  if (command.type === 'closure') {
    const closure = now.closures.find((c) => c.id === subjectId)
    if (!closure) return []
    return [
      {
        kind: 'closure-added',
        subjectId,
        summary: `Time away added: ${closureText(after, closure)}.`,
        before: null,
        after: closure,
      },
    ]
  }
  if (command.type === 'remove-closure') {
    const closure = was.closures.find((c) => c.id === subjectId)
    if (!closure) return []
    return [
      {
        kind: 'closure-removed',
        subjectId,
        summary: `Time away removed: ${closureText(before, closure)}.`,
        before: closure,
        after: null,
      },
    ]
  }
  const entries: Omit<ScheduleChange, 'id' | 'occurredAt' | 'actor'>[] = []
  if (command.type === 'staff') {
    const old = before.staff.find((p) => p.id === subjectId),
      next = after.staff.find((p) => p.id === subjectId)
    if (!old || !next) return []
    if (JSON.stringify(old.hours ?? null) !== JSON.stringify(next.hours ?? null)) {
      const changed = [
        ...weekDifference(old.hours ?? was.hours, next.hours ?? now.hours, locale),
        ...placeDifference(after, old.hours ?? was.hours, next.hours ?? now.hours),
      ]
      const basis = !next.hours
        ? ' They now follow the venue opening hours.'
        : !old.hours
          ? ' They previously followed the venue opening hours.'
          : ''
      entries.push({
        kind: 'staff-hours',
        subjectId,
        summary: `${next.name}'s working hours changed${changed.length ? `: ${changed.join('; ')}` : ''}.${basis}`,
        before: old.hours ?? null,
        after: next.hours ?? null,
      })
    }
    if (!!old.archived !== !!next.archived)
      entries.push({
        kind: next.archived ? 'staff-archived' : 'staff-restored',
        subjectId,
        summary: next.archived
          ? `${next.name} archived for future bookings. Their history is kept.`
          : `${next.name} restored for future bookings.`,
        before: { archived: !!old.archived },
        after: { archived: !!next.archived },
      })
  }
  if (command.type === 'resource') {
    const old = before.resources.find((r) => r.id === subjectId),
      next = after.resources.find((r) => r.id === subjectId)
    const main = after.organisation.locationId
    if (old && next && (old.locationId ?? main) !== (next.locationId ?? main))
      entries.push({
        kind: 'resource-moved',
        subjectId,
        summary: `${next.name} moved from ${placeOf(after, old.locationId)?.name} to ${placeOf(after, next.locationId)?.name}.`,
        before: { locationId: old.locationId ?? main },
        after: { locationId: next.locationId ?? main },
      })
    if (old && next && !!old.archived !== !!next.archived)
      entries.push({
        kind: next.archived ? 'resource-archived' : 'resource-restored',
        subjectId,
        summary: next.archived
          ? `${next.name} archived for future bookings. Its history is kept.`
          : `${next.name} restored for future bookings.`,
        before: { archived: !!old.archived },
        after: { archived: !!next.archived },
      })
  }
  return entries
}
