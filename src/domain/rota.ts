import type { Appointment, BusinessState } from './model'
import type { Command } from './commandSchema'
import { addDays, dateLabel, timeLabel } from './format'
import {
  businessDate,
  hoursFor,
  operations,
  plannedHoursFor,
  rotaChangeOn,
  staffHoursFor,
  timeOffOn,
  usualHoursFor,
} from './operations'
import type { TimeOff } from './operations'
import { hasLocations, offeredAt, placeField, placeOf, places, staffLocationOn } from './locations'
import { affectedVisits, isUpcoming, scheduleSnapshot } from './schedule'
import type { AffectedVisit } from './schedule'
import { TIME_OFF_LABEL, mondayOf } from './timeOff'
import { dayAppointments } from './selectors'
import { ROTA_AHEAD_DAYS, ROTA_CHANGE_LIMIT, ROTA_KEPT_LIMIT } from './rotaSchema'
import type { RotaChange, RotaDayInput } from './rotaSchema'

/**
 * Stage 3: the rota week by week. Each person's week starts from their usual weekly hours; an owner
 * or manager can change one day (other hours, another location, or not working) or add a day they
 * do not usually work, for that date only. `plannedHoursFor` in operations.ts is the one place that
 * reads a changed day, so booking at the desk, the guest booking page, the receptionist, Book with
 * Google, moving a visit, waitlist offers, gaps, cover plans, Today's team and a practitioner's own
 * day all follow it. Payroll keeps what people clocked; the rota is the plan.
 *
 * A change never moves, cancels or messages a booked visit. When it would leave visits outside the
 * new hours it is refused, naming them, unless the person saving chooses to keep them booked; the
 * rota then shows a warning on that day until the visits are moved.
 */
export type RotaCommand = Extract<
  Command,
  { type: 'rota-day' | 'rota-day-usual' | 'rota-week-copy' | 'rota-week-clear' }
>
/** What a changed day is, beside the person's usual week. */
export type RotaKind = 'hours' | 'extra' | 'off'
export const ROTA_LABEL: Record<RotaKind, string> = {
  hours: 'Different hours',
  extra: 'Extra day',
  off: 'Not working',
}
type Plan = { working: false } | { working: true; open: number; close: number; locationId?: string }

const firstName = (name: string) => name.trim().split(/\s+/)[0]
const clock = (minutes: number, locale: string) =>
  minutes >= 1440 ? 'midnight' : timeLabel(minutes, locale)
/** "09:00 to 18:00", on the studio's own clock. */
export function span(open: number, close: number, locale: string) {
  return `${clock(open, locale)} to ${clock(close, locale)}`
}

/** Every change still in force, oldest first. */
export function rotaChanges(s: BusinessState) {
  return (operations(s).rotaChanges ?? []).filter((c) => !c.ended)
}

/**
 * A person's usual day, as their weekly hours and the opening hours of where they work make it:
 * when they work and where, or not at all.
 */
export function usualDay(s: BusinessState, staffId: string, date: string) {
  const own = usualHoursFor(s, staffId, date)
  const locationId = own.locationId ?? s.organisation.locationId
  const venue = hoursFor(s, date, locationId)
  const open = Math.max(venue.open, own.open)
  const close = Math.min(venue.close, own.close)
  return !venue.closed && !own.closed && close > open
    ? { working: true as const, open, close, locationId }
    : { working: false as const, locationId }
}

/** What kind of change a day carries: other hours, an extra day, or a day not working. */
export function changeKind(
  s: BusinessState,
  change: Pick<RotaChange, 'staffId' | 'date' | 'working'>,
): RotaKind {
  if (!change.working) return 'off'
  return usualDay(s, change.staffId, change.date).working ? 'hours' : 'extra'
}

/**
 * Whether a booked visit sits outside its professional's hours that day: a day they are not
 * working or are away, another location, or before they start or after they finish.
 */
export function outsideHours(s: BusinessState, a: Appointment) {
  const own = staffHoursFor(s, a.staffId, a.date)
  const venue = hoursFor(s, a.date, a.locationId)
  if (own.closed || venue.closed || staffLocationOn(s, a.staffId, a.date) !== a.locationId)
    return true
  const end = a.startMinutes + a.bookedDurationMinutes + a.bookedBufferMinutes
  return a.startMinutes < Math.max(venue.open, own.open) || end > Math.min(venue.close, own.close)
}

/** Visits still to come on a day that sit outside the person's hours, earliest first. */
export function outsideVisits(
  s: BusinessState,
  staffId: string,
  date: string,
  now = new Date().toISOString(),
) {
  return s.appointments
    .filter(
      (a) =>
        a.staffId === staffId && a.date === date && isUpcoming(s, a, now) && outsideHours(s, a),
    )
    .sort((a, b) => a.startMinutes - b.startMinutes)
}

export type RotaDay =
  | {
      date: string
      state: 'working'
      open: number
      close: number
      locationId: string
      visits: number
      change?: RotaChange
      kind?: RotaKind
      outside: Appointment[]
    }
  | { date: string; state: 'off'; change?: RotaChange; kind?: RotaKind; outside: Appointment[] }
  | { date: string; state: 'away'; away: TimeOff }
  | { date: string; state: 'closed' }

/** One person's week as planned: hours and where, days off, days away, changes and visits. */
export function rotaWeek(s: BusinessState, monday: string, now = new Date().toISOString()) {
  const dates = Array.from({ length: 7 }, (_, i) => addDays(monday, i))
  const visitsOn = new Map(dates.map((date) => [date, dayAppointments(s, date)]))
  // The week's booked visits by person and day, read once rather than for every cell.
  const booked = new Map<string, Appointment[]>()
  for (const a of s.appointments)
    if (a.date >= dates[0] && a.date <= dates[6]) {
      const key = `${a.staffId} ${a.date}`
      const list = booked.get(key)
      if (list) list.push(a)
      else booked.set(key, [a])
    }
  const outsideOn = (staffId: string, date: string) =>
    (booked.get(`${staffId} ${date}`) ?? [])
      .filter((a) => isUpcoming(s, a, now) && outsideHours(s, a))
      .sort((a, b) => a.startMinutes - b.startMinutes)
  return s.staff
    .filter((person) => !person.archived)
    .map((person) => ({
      person,
      days: dates.map((date): RotaDay => {
        const away = timeOffOn(s, person.id, date)
        if (away) return { date, state: 'away', away }
        const planned = plannedHoursFor(s, person.id, date)
        const locationId = planned.locationId ?? s.organisation.locationId
        const venue = hoursFor(s, date, locationId)
        const change = rotaChangeOn(s, person.id, date)
        if (venue.closed && !change) return { date, state: 'closed' }
        const marked = change ? { change, kind: changeKind(s, change) } : {}
        const outside = outsideOn(person.id, date)
        const open = Math.max(venue.open, planned.open)
        const close = Math.min(venue.close, planned.close)
        if (venue.closed || planned.closed || close <= open)
          return { date, state: 'off', ...marked, outside }
        return {
          date,
          state: 'working',
          open,
          close,
          locationId,
          visits: visitsOn.get(date)!.filter((a) => a.staffId === person.id).length,
          ...marked,
          outside,
        }
      }),
    }))
}

/** Whether a person can work at a location: it offers one of their treatments, if they have any. */
function mayWorkAt(s: BusinessState, treatments: string[], locationId: string) {
  const live = treatments
    .map((id) => s.services.find((service) => service.id === id))
    .filter((service) => service && !service.archived)
  return !live.length || live.some((service) => offeredAt(service!, locationId))
}

/**
 * The plan a day would have, checked: someone on the team, a day from today to a year ahead, not
 * while they are away, times within the opening hours of an open location they can work at, and
 * different from their usual day. Throws the reason in plain words otherwise.
 */
function planDay(s: BusinessState, input: RotaDayInput, today: string) {
  const person = s.staff.find((p) => p.id === input.staffId && !p.archived)
  if (!person) throw new Error('Choose someone on the team.')
  checkDate(input.date, today)
  const first = firstName(person.name)
  const away = timeOffOn(s, person.id, input.date)
  if (away)
    throw new Error(
      `${first} is away that day (${TIME_OFF_LABEL[away.kind].toLowerCase()}). Cancel the time off first if they are working.`,
    )
  const usual = usualDay(s, person.id, input.date)
  const locale = s.organisation.locale
  let plan: Plan
  if (!input.working) {
    if (input.open !== undefined || input.close !== undefined || input.locationId)
      throw new Error('A day off has no hours or location.')
    if (!usual.working)
      throw new Error(`${first} does not usually work that day, so there is nothing to take off.`)
    plan = { working: false }
  } else {
    if (input.open === undefined || input.close === undefined)
      throw new Error('Choose when they start and finish.')
    if (input.close <= input.open) throw new Error('Choose a finish time after the start.')
    const place = input.locationId ?? usualHoursFor(s, person.id, input.date).locationId
    const site = placeOf(s, place)
    if (!site || site.archived) throw new Error('Choose an open location.')
    if (!mayWorkAt(s, person.serviceIds, site.id))
      throw new Error(
        `${site.name} does not offer any of ${first}'s treatments. Choose another location.`,
      )
    const venue = hoursFor(s, input.date, site.id)
    const where = hasLocations(s) ? site.name : 'The studio'
    if (venue.closed)
      throw new Error(`${where} is closed that day. Change the opening hours in Settings first.`)
    if (input.open < venue.open || input.close > venue.close)
      throw new Error(
        `${where} is open ${span(venue.open, venue.close, locale)} that day. Choose times within those hours.`,
      )
    plan = { working: true, open: input.open, close: input.close, ...placeField(s, site.id) }
  }
  const main = s.organisation.locationId
  const same = plan.working
    ? usual.working &&
      usual.open === plan.open &&
      usual.close === plan.close &&
      usual.locationId === (plan.locationId ?? main)
    : !usual.working
  if (same)
    throw new Error(
      'Those are their usual hours for that day. Choose As usual to put the day back instead.',
    )
  return { person, plan }
}

function checkDate(date: string, today: string) {
  if (date < today) throw new Error('That day has passed. The rota keeps what was planned for it.')
  if (date > addDays(today, ROTA_AHEAD_DAYS)) throw new Error('Change days up to a year ahead.')
}
function checkMonday(monday: string) {
  if (mondayOf(monday) !== monday) throw new Error('Choose the Monday the week starts on.')
}

const samePlan = (change: RotaChange, plan: Plan) =>
  change.working === plan.working &&
  (!plan.working ||
    (change.open === plan.open &&
      change.close === plan.close &&
      change.locationId === plan.locationId))

export type WeekCopy = {
  copies: { from: RotaChange; date: string; plan: Plan }[]
  skipped: { from: RotaChange; date: string; reason: string }[]
}
/**
 * What copying last week's changes into the week starting `monday` would do: each change still in
 * force last week lands on the same weekday, checked as if it were made by hand. Days that have
 * passed, days someone is away and days already the same are left out, with the reason.
 */
export function weekCopy(s: BusinessState, monday: string, today: string): WeekCopy {
  const result: WeekCopy = { copies: [], skipped: [] }
  const from = addDays(monday, -7)
  const sources = rotaChanges(s)
    .filter((c) => c.date >= from && c.date < monday)
    .sort((a, b) => a.date.localeCompare(b.date) || a.staffId.localeCompare(b.staffId))
  for (const source of sources) {
    const date = addDays(source.date, 7)
    try {
      const { plan } = planDay(
        s,
        {
          staffId: source.staffId,
          date,
          working: source.working,
          ...(source.working
            ? {
                open: source.open,
                close: source.close,
                locationId: source.locationId ?? s.organisation.locationId,
              }
            : {}),
        },
        today,
      )
      const there = rotaChangeOn(s, source.staffId, date)
      if (there && samePlan(there, plan)) throw new Error('That day already has these hours.')
      result.copies.push({ from: source, date, plan })
    } catch (error) {
      result.skipped.push({
        from: source,
        date,
        reason: error instanceof Error ? error.message : 'It cannot be copied.',
      })
    }
  }
  return result
}

/** Changes still to come in the week starting `monday`, from today on. */
export function weekStillToCome(s: BusinessState, monday: string, today: string) {
  const from = monday > today ? monday : today
  const to = addDays(monday, 6)
  return rotaChanges(s).filter((c) => c.date >= from && c.date <= to)
}

/** One visit as the rota names it: day and time, the client's first name and the treatment. */
export function describeKept(v: AffectedVisit, locale: string) {
  return `${dateLabel(v.date, locale, true)} ${timeLabel(v.startMinutes, locale)}, ${v.clientFirstName}${v.serviceName ? `, ${v.serviceName}` : ''}`
}

function strandedMessage(affected: AffectedVisit[], locale: string) {
  const one = affected.length === 1
  const shown = affected.slice(0, 5).map((v) => describeKept(v, locale))
  const more = affected.length - shown.length
  return `${one ? 'A booked visit' : `${affected.length} booked visits`} would be outside the new hours: ${shown.join('; ')}${more ? `; and ${more} more` : ''}. Move ${one ? 'it' : 'them'} first, or choose to keep ${one ? 'it' : 'them'} booked as ${one ? 'it is' : 'they are'}.`
}

/**
 * Runs a rota command on `next`, a copy of the studio about to be saved, and returns the id of the
 * record it made or changed (a week's Monday for a whole week).
 */
export function runRotaCommand(
  next: BusinessState,
  command: RotaCommand,
  now: string,
  makeId: () => string,
) {
  const today = businessDate(next, now)
  const before = scheduleSnapshot(next)
  next.operations = structuredClone(operations(next))
  const o = next.operations
  // A new list each time, so the look-up by person and day is never out of date.
  const list = [...(o.rotaChanges ?? [])]
  const active = (staffId: string, date: string) =>
    list.find((c) => !c.ended && c.staffId === staffId && c.date === date)
  const end = (change: RotaChange, how: 'usual' | 'replaced' | 'cleared') => {
    change.ended = { at: now, actor: 'Local operator', how }
  }
  const made: RotaChange[] = []
  const ended: RotaChange[] = []
  const add = (staffId: string, date: string, plan: Plan, note?: string) => {
    const existing = active(staffId, date)
    if (existing) end(existing, 'replaced')
    const change: RotaChange = {
      id: makeId(),
      staffId,
      date,
      ...plan,
      ...(note ? { note } : {}),
      createdAt: now,
      actor: 'Local operator',
    }
    list.push(change)
    made.push(change)
    return change
  }
  let recordId: string

  if (command.type === 'rota-day') {
    const { input } = command
    const { plan } = planDay(next, input, today)
    const note = input.note?.trim()
    const existing = active(input.staffId, input.date)
    if (existing && samePlan(existing, plan) && (existing.note ?? '') === (note ?? ''))
      throw new Error('That day already has these hours.')
    recordId = add(input.staffId, input.date, plan, note).id
  } else if (command.type === 'rota-day-usual') {
    const person = next.staff.find((p) => p.id === command.staffId && !p.archived)
    if (!person) throw new Error('Choose someone on the team.')
    checkDate(command.date, today)
    const existing = active(command.staffId, command.date)
    if (!existing) throw new Error('That day already follows their usual hours.')
    end(existing, 'usual')
    ended.push(existing)
    recordId = existing.id
  } else if (command.type === 'rota-week-copy') {
    checkMonday(command.monday)
    const { copies, skipped } = weekCopy(next, command.monday, today)
    if (!copies.length)
      throw new Error(
        skipped.length
          ? `Nothing from last week can be copied: ${skipped[0].reason}`
          : 'Last week has no changed days to copy.',
      )
    for (const copy of copies) add(copy.from.staffId, copy.date, copy.plan, copy.from.note)
    recordId = command.monday
  } else {
    checkMonday(command.monday)
    const clearing = weekStillToCome(next, command.monday, today).map((c) =>
      list.find((x) => x.id === c.id)!,
    )
    if (!clearing.length) throw new Error('This week has no changed days still to come.')
    for (const change of clearing) {
      end(change, 'cleared')
      ended.push(change)
    }
    recordId = command.monday
  }

  // Ended changes are kept for the record, the oldest let go first once there are very many.
  while (list.length > ROTA_CHANGE_LIMIT) {
    const oldest = list.findIndex((c) => c.ended)
    if (oldest < 0) throw new Error('Too many changed days to keep. Put some back to usual first.')
    list.splice(oldest, 1)
  }
  o.rotaChanges = list

  const affected = affectedVisits(before, next, now)
  if (affected.length) {
    if (!command.keepBooked) throw new Error(strandedMessage(affected, next.organisation.locale))
    // Each change names the visits it kept outside its hours, for the record.
    const staffOf = (appointmentId: string) =>
      next.appointments.find((a) => a.id === appointmentId)?.staffId
    const keptOn = (staffId: string, date: string) =>
      affected
        .filter((v) => v.date === date && staffOf(v.appointmentId) === staffId)
        .map((v) => v.appointmentId)
        .slice(0, ROTA_KEPT_LIMIT)
    for (const change of made) {
      const kept = keptOn(change.staffId, change.date)
      if (kept.length) change.kept = kept
    }
    for (const change of ended) {
      const kept = keptOn(change.staffId, change.date)
      if (kept.length && change.ended) change.ended.kept = kept
    }
  }
  return recordId
}

/**
 * What a rota command would do before it is saved: the reason it cannot be saved, if any, and the
 * booked visits it would leave outside the new hours. The server checks the same again.
 */
export function rotaPreview(
  s: BusinessState,
  command: RotaCommand,
  now = new Date().toISOString(),
): { error: string | null; affected: AffectedVisit[] } {
  const next = scheduleSnapshot(s)
  try {
    runRotaCommand(next, { ...command, keepBooked: true }, now, () => 'preview')
    return { error: null, affected: affectedVisits(s, next, now) }
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'This cannot be saved.', affected: [] }
  }
}

/** Puts the signed-in person's name on the changes they made and ended. */
export function stampRotaActors(before: BusinessState, after: BusinessState, actor: string) {
  const old = new Map((operations(before).rotaChanges ?? []).map((c) => [c.id, c]))
  for (const change of operations(after).rotaChanges ?? []) {
    const was = old.get(change.id)
    if (!was) change.actor = actor
    if (change.ended && !was?.ended) change.ended.actor = actor
  }
}

/** Ledger checks: one change in force for a person on a day, about someone and somewhere known. */
export function rotaProblem(s: BusinessState) {
  const list = s.operations?.rotaChanges ?? []
  if (new Set(list.map((c) => c.id)).size !== list.length) return 'Duplicate rota change IDs.'
  const known = new Set(places(s, true).map((p) => p.id))
  const staff = new Set(s.staff.map((p) => p.id))
  const inForce = new Set<string>()
  for (const change of list) {
    if (!staff.has(change.staffId)) return 'A rota change names someone not on the team.'
    if (
      change.locationId &&
      (!known.has(change.locationId) || change.locationId === s.organisation.locationId)
    )
      return 'A rota change names a missing location.'
    if (change.ended) continue
    const key = `${change.staffId} ${change.date}`
    if (inForce.has(key)) return 'Two changes apply to one person on one day.'
    inForce.add(key)
  }
  return null
}

/**
 * A practitioner's own days as planned, for their own page: hours and where, and whether the day
 * is changed from their usual week. Nobody else's days, and no notes.
 */
export function ownPlan(s: BusinessState, staffId: string, from: string, to: string) {
  const days = []
  for (let date = from; date <= to; date = addDays(date, 1)) {
    const away = !!timeOffOn(s, staffId, date)
    const planned = plannedHoursFor(s, staffId, date)
    const locationId = planned.locationId ?? s.organisation.locationId
    const venue = hoursFor(s, date, locationId)
    const change = rotaChangeOn(s, staffId, date)
    const open = Math.max(venue.open, planned.open)
    const close = Math.min(venue.close, planned.close)
    const working = !away && !venue.closed && !planned.closed && close > open
    days.push({
      date,
      working,
      ...(working
        ? {
            open,
            close,
            ...(hasLocations(s) ? { place: placeOf(s, locationId)?.name ?? '' } : {}),
          }
        : {}),
      ...(change && !away ? { change: changeKind(s, change) } : {}),
      ...(away ? { away: true as const } : {}),
    })
  }
  return days
}

/**
 * For who changed what: which day changed and its hours before and after, or which week and how
 * many days. Null for anything else.
 */
export function rotaChangeDetail(
  before: BusinessState,
  after: BusinessState,
  action: string,
  recordId: string,
) {
  const value = (c: RotaChange | undefined) =>
    !c ? 'usual' : c.working ? `${c.open}-${c.close}` : 'off'
  const was = new Map((operations(before).rotaChanges ?? []).map((c) => [c.id, c]))
  const now = operations(after).rotaChanges ?? []
  if (action === 'rota-day') {
    const change = now.find((c) => c.id === recordId)
    if (!change) return null
    const replaced = [...was.values()].find(
      (c) => !c.ended && c.staffId === change.staffId && c.date === change.date,
    )
    return {
      fields: [
        { f: 'date', to: change.date },
        { f: 'shift', from: value(replaced), to: value(change) },
        ...(change.locationId ? [{ f: 'locationId', to: change.locationId }] : []),
        ...(change.kept ? [{ f: 'visitsKept', to: change.kept.length }] : []),
      ],
    }
  }
  if (action === 'rota-day-usual') {
    const change = now.find((c) => c.id === recordId)
    if (!change) return null
    return {
      fields: [
        { f: 'date', to: change.date },
        { f: 'shift', from: value(change), to: 'usual' },
        ...(change.ended?.kept ? [{ f: 'visitsKept', to: change.ended.kept.length }] : []),
      ],
    }
  }
  if (action === 'rota-week-copy' || action === 'rota-week-clear') {
    const touched =
      action === 'rota-week-copy'
        ? now.filter((c) => !was.has(c.id))
        : now.filter((c) => c.ended && !was.get(c.id)?.ended)
    const kept = touched.reduce(
      (sum, c) => sum + (c.kept?.length ?? 0) + (c.ended?.kept?.length ?? 0),
      0,
    )
    return {
      fields: [
        { f: 'weekOf', to: recordId },
        { f: 'daysChanged', to: touched.length },
        ...(kept ? [{ f: 'visitsKept', to: kept }] : []),
      ],
    }
  }
  return null
}
