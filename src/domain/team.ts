import type { BusinessState, Staff } from './model'
import type { Command } from './commandSchema'
import type { RotaChange } from './rotaSchema'
import type { TimeOff } from './operations'
import { addDays, dateLabel } from './format'
import { TIME_OFF_DAYS, hoursFor, operations, rotaChangeOn, usualHoursFor } from './operations'
import { placeOf, resourceLocation } from './locations'
import { daysBetween, mondayOf } from './timeOff'

/**
 * Stage 4: a location's own team, and what a general manager may change for it.
 *
 * Someone is on a location's team when their usual weekly hours have them working there on a day
 * of the week in question, or, for one date only, when the rota sends them there on that date.
 *
 * A person's day belongs to a location when the change on the rota for that day has them there
 * (a day off belongs where they usually work that day), or, with no change, when they usually work
 * there that day or do not usually work that day at all. A general manager changes a day only when
 * it belongs to their location before and after the change, so they never send someone elsewhere
 * and never touch a day at another location. Time off is theirs to add, change or cancel when the
 * person is on their team on every day it covers and none of those days is another location's.
 * Rooms and chairs are theirs when they are at their location and stay there.
 *
 * The same rules decide what a general manager sees (`teamView`), what their screens offer, and
 * what the server lets them change (`branchRefusal` before a change and `branchChangeRefusal`
 * after it, in branch.ts), so the screen and the server always agree.
 */

const firstName = (s: BusinessState, staffId: string) =>
  s.staff
    .find((p) => p.id === staffId)
    ?.name.trim()
    .split(/\s+/)[0] ?? 'They'
const placeName = (s: BusinessState, locationId: string) =>
  placeOf(s, locationId)?.name ?? 'another location'
const ELSEWHERE_ROOM = 'That room or chair is at another location.'

/**
 * Where a person usually works on a date, and whether they do: their weekly hours that weekday,
 * within the opening hours of the location those hours name.
 */
export function usualWork(s: BusinessState, staffId: string, date: string) {
  const own = usualHoursFor(s, staffId, date)
  const place = own.locationId ?? s.organisation.locationId
  const venue = hoursFor(s, date, place)
  const working =
    !own.closed &&
    !venue.closed &&
    Math.min(own.close, venue.close) > Math.max(own.open, venue.open)
  return { working, place }
}

/** The location a change on the rota belongs to: where it has them work, or, for a day off, where they usually work that day. */
export function changePlace(
  s: BusinessState,
  change: Pick<RotaChange, 'staffId' | 'date' | 'working' | 'locationId'>,
) {
  return change.working
    ? (change.locationId ?? s.organisation.locationId)
    : usualWork(s, change.staffId, change.date).place
}

/** Whether the rota sends someone to a location on a date, to work there. */
export function sentTo(s: BusinessState, staffId: string, date: string, locationId: string) {
  const change = rotaChangeOn(s, staffId, date)
  return (
    !!change && change.working && (change.locationId ?? s.organisation.locationId) === locationId
  )
}

/** Whether someone usually works at a location on a day of the week (Monday to Sunday) that holds `date`. */
export function usuallyAt(s: BusinessState, staffId: string, locationId: string, date: string) {
  const monday = mondayOf(date)
  for (let i = 0; i < 7; i += 1) {
    const usual = usualWork(s, staffId, addDays(monday, i))
    if (usual.working && usual.place === locationId) return true
  }
  return false
}

/** Whether someone is on a location's team on a date. Nobody archived is. */
export function onTeam(s: BusinessState, locationId: string, staffId: string, date: string) {
  const person = s.staff.find((p) => p.id === staffId)
  if (!person || person.archived) return false
  return usuallyAt(s, staffId, locationId, date) || sentTo(s, staffId, date, locationId)
}

/** A location's team for the week starting on `monday`, in the studio's own order. */
export function weekTeam(s: BusinessState, locationId: string, monday: string): Staff[] {
  const dates = Array.from({ length: 7 }, (_, i) => addDays(monday, i))
  return s.staff.filter(
    (p) =>
      !p.archived &&
      (usuallyAt(s, p.id, locationId, monday) ||
        dates.some((date) => sentTo(s, p.id, date, locationId))),
  )
}

/** Whether a person's day belongs to a location (see above). */
export function dayHere(s: BusinessState, staffId: string, date: string, locationId: string) {
  const change = rotaChangeOn(s, staffId, date)
  if (change) return changePlace(s, change) === locationId
  const usual = usualWork(s, staffId, date)
  return !usual.working || usual.place === locationId
}

/** The location a person's day belongs to on the rota: where a change has it, or where they usually work. */
export function dayPlace(s: BusinessState, staffId: string, date: string) {
  const change = rotaChangeOn(s, staffId, date)
  return change ? changePlace(s, change) : usualWork(s, staffId, date).place
}

/** Whether a general manager may open a person's day on the rota at all. */
export function mayPlanDay(s: BusinessState, locationId: string, staffId: string, date: string) {
  return onTeam(s, locationId, staffId, date) && dayHere(s, staffId, date, locationId)
}

type DayCommand = Extract<Command, { type: 'rota-day' | 'rota-day-usual' }>

/**
 * Why a general manager at `locationId` may not make this change to a day on the rota, in plain
 * words, or null when they may. The change itself is then checked as anyone's would be.
 */
export function rotaDayRefusal(
  s: BusinessState,
  locationId: string,
  command: DayCommand,
): string | null {
  const staffId = command.type === 'rota-day' ? command.input.staffId : command.staffId
  const date = command.type === 'rota-day' ? command.input.date : command.date
  // Someone unknown is the change's own refusal: "Choose someone on the team."
  if (!s.staff.some((p) => p.id === staffId)) return null
  const who = firstName(s, staffId)
  const here = placeName(s, locationId)
  if (!onTeam(s, locationId, staffId, date))
    return `${who} is not on the team at ${here}. Ask the owner or a manager to change their day.`
  if (!dayHere(s, staffId, date, locationId))
    return `${who} works at another location that day, so only the owner or a manager can change it.`
  const usual = usualWork(s, staffId, date)
  const usuallyElsewhere = usual.working && usual.place !== locationId
  if (command.type === 'rota-day') {
    const { input } = command
    if (input.working) {
      const target =
        input.locationId ?? usualHoursFor(s, staffId, date).locationId ?? s.organisation.locationId
      if (target !== locationId)
        return `You plan days at ${here} only. Ask the owner or a manager to send ${who} to another location.`
    } else if (usuallyElsewhere)
      return `${who} usually works at another location that day, so only the owner or a manager can give them the day off.`
  } else if (usuallyElsewhere)
    return `Back to usual would have ${who} working at another location that day, so only the owner or a manager can put it back.`
  return null
}

/**
 * Whether a day of someone's is another location's: the rota plans them elsewhere that day, or
 * they usually work elsewhere that day (so time off on it would take them from there).
 */
export function dayElsewhere(s: BusinessState, staffId: string, date: string, locationId: string) {
  if (!dayHere(s, staffId, date, locationId)) return true
  const usual = usualWork(s, staffId, date)
  return usual.working && usual.place !== locationId
}

/**
 * Why a general manager at `locationId` may not add, change or cancel this time off, or null when
 * they may: the person is on their team on every day it covers, and none of those days is another
 * location's. For someone the rota sends from elsewhere, that means the days they are sent here.
 */
export function timeOffRefusal(
  s: BusinessState,
  locationId: string,
  away: Pick<TimeOff, 'staffId' | 'from' | 'to'>,
): string | null {
  if (!s.staff.some((p) => p.id === away.staffId)) return null
  // Longer than any time off can be is the change's own refusal.
  if (away.to < away.from || daysBetween(away.from, away.to) >= TIME_OFF_DAYS) return null
  const who = firstName(s, away.staffId)
  for (let date = away.from; date <= away.to; date = addDays(date, 1)) {
    const day = dateLabel(date, s.organisation.locale)
    if (!onTeam(s, locationId, away.staffId, date))
      return `${who} is not on the team at ${placeName(s, locationId)} on ${day}. Ask the owner or a manager.`
    if (dayElsewhere(s, away.staffId, date, locationId))
      return `${who} works at another location on ${day}. Time off that covers a day at another location is for the owner or a manager.`
  }
  return null
}

/** Why a general manager may not add or change this room or chair, or null when they may. */
export function roomRefusal(
  s: BusinessState,
  locationId: string,
  command: Extract<Command, { type: 'resource' }>,
): string | null {
  const old = command.id ? s.resources.find((r) => r.id === command.id) : undefined
  if (old && resourceLocation(s, old) !== locationId) return ELSEWHERE_ROOM
  if ((command.input.locationId ?? s.organisation.locationId) !== locationId)
    return old
      ? 'Rooms and chairs stay at their location. Ask the owner or a manager to move one.'
      : `Add rooms and chairs at ${placeName(s, locationId)} only.`
  return null
}

/**
 * Checked after a general manager's change is made: every day on the rota, stretch of time off and
 * room it touched was theirs before and is theirs after. This catches anything the checks before
 * the change did not foresee.
 */
export function teamChangeRefusal(
  before: BusinessState,
  after: BusinessState,
  locationId: string,
): string | null {
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
  const was = new Map((operations(before).rotaChanges ?? []).map((c) => [c.id, c]))
  const days = new Map<string, { staffId: string; date: string }>()
  for (const change of operations(after).rotaChanges ?? []) {
    const old = was.get(change.id)
    if (!old || !!old.ended !== !!change.ended) days.set(`${change.staffId} ${change.date}`, change)
  }
  for (const { staffId, date } of days.values())
    if (
      !onTeam(before, locationId, staffId, date) ||
      !dayHere(before, staffId, date, locationId) ||
      !dayHere(after, staffId, date, locationId)
    )
      return 'That would change a day on the rota at another location.'
  const away = new Map((operations(before).timeOff ?? []).map((t) => [t.id, t]))
  for (const t of operations(after).timeOff ?? []) {
    const old = away.get(t.id)
    if (old && same(old, t)) continue
    if (timeOffRefusal(before, locationId, t) || (old && timeOffRefusal(before, locationId, old)))
      return 'That would change time off at another location.'
  }
  const rooms = new Map(before.resources.map((r) => [r.id, r]))
  for (const room of after.resources) {
    const old = rooms.get(room.id)
    if (old && same(old, room)) continue
    if (
      resourceLocation(after, room) !== locationId ||
      (old && resourceLocation(before, old) !== locationId)
    )
      return 'That would change a room at another location.'
  }
  return null
}

type Hours = NonNullable<Staff['hours']>[number]
/** A weekday at another location: where, and whether they work, but not the times. */
const whereOnly = (h: Hours): Hours => ({
  day: h.day,
  open: 0,
  close: 1440,
  closed: h.closed,
  ...(h.locationId ? { locationId: h.locationId } : {}),
})
const NEVER: Hours[] = Array.from({ length: 7 }, (_, day) => ({
  day,
  open: 0,
  close: 1440,
  closed: true,
}))

/**
 * What a general manager reads of the team and the rooms (Stage 4).
 *
 * Their own team (people whose usual week has them working at the location) is kept with its
 * time off and holiday allowance, which belong to the person. A team member's days at another
 * location show where they are, never the times or notes there: those weekdays carry the place
 * only, and a change on the rota at another location is kept only as where it sends them on a day
 * that would otherwise be this location's or a day off.
 *
 * Someone the rota sends here from elsewhere is kept for those days: their changes here, any time
 * off that touches them, and which weekdays they usually work elsewhere, without the times.
 *
 * Everyone else, and every room at another location, is kept only as the name on the visits and
 * records that mention them, marked archived so no screen offers them, with no hours, changed
 * days, time off, allowance or room settings. The studio's own record is never changed by this.
 * Every rule in this file reads the same on this view as on the whole record, so the screens
 * offer exactly what the server allows.
 */
export function teamView(s: BusinessState, locationId: string, today: string): BusinessState {
  const o = s.operations
  if (!o) return s
  const main = s.organisation.locationId
  const at = (h: { locationId?: string }) => (h.locationId ?? main) === locationId
  const home = new Set(
    s.staff.filter((p) => usuallyAt(s, p.id, locationId, today)).map((p) => p.id),
  )
  // The days the rota sends someone from elsewhere to this location.
  const visiting = new Map<string, Set<string>>()
  for (const c of o.rotaChanges ?? [])
    if (!home.has(c.staffId) && !c.ended && c.working && at(c))
      visiting.set(c.staffId, new Set([...(visiting.get(c.staffId) ?? []), c.date]))
  const onVisit = (staffId: string, from: string, to: string) =>
    [...(visiting.get(staffId) ?? [])].some((date) => date >= from && date <= to)
  // A person's week here in full, and the place only on weekdays elsewhere. No weekly hours means
  // the main location's opening hours.
  const week = (p: Staff) => {
    const hours = p.hours ?? o.hours
    if (hours.every(at)) return p.hours
    return hours.map((h) => (at(h) ? h : whereOnly(h)))
  }
  const staff = s.staff.map((p): Staff => {
    if (home.has(p.id) || visiting.has(p.id)) {
      const { hours: _hours, ...rest } = p
      void _hours
      const kept = week(p)
      return kept ? { ...rest, hours: kept } : rest
    }
    return {
      id: p.id,
      organisationId: p.organisationId,
      name: p.name,
      role: p.role,
      tone: p.tone,
      serviceIds: [],
      hours: NEVER,
      archived: true,
    }
  })
  const here = new Set(
    s.resources.filter((r) => resourceLocation(s, r) === locationId).map((r) => r.id),
  )
  const resources = s.resources.map((r) =>
    here.has(r.id)
      ? r
      : {
          id: r.id,
          organisationId: r.organisationId,
          name: r.name,
          type: r.type,
          ...(r.locationId ? { locationId: r.locationId } : {}),
          archived: true,
        },
  )
  const rotaKept = (o.rotaChanges ?? []).flatMap((c): RotaChange[] => {
    if (changePlace(s, c) === locationId) return [c]
    if (c.ended || !home.has(c.staffId)) return []
    const usual = usualWork(s, c.staffId, c.date)
    if (usual.working && usual.place !== locationId) return []
    return [
      {
        id: c.id,
        staffId: c.staffId,
        date: c.date,
        working: c.working,
        ...(c.working
          ? { open: 0, close: 1440, ...(c.locationId ? { locationId: c.locationId } : {}) }
          : {}),
        createdAt: c.createdAt,
        actor: c.actor,
      },
    ]
  })
  const keptClosure = (c: { staffId?: string; date: string }) =>
    !c.staffId || home.has(c.staffId) || !!visiting.get(c.staffId)?.has(c.date)
  const timeOff = (o.timeOff ?? []).flatMap((t) => {
    if (home.has(t.staffId)) return [t]
    if (t.cancelledAt || !onVisit(t.staffId, t.from, t.to)) return []
    const { changedFrom: _from, ...rest } = t
    void _from
    return [rest]
  })
  const allHere = (value: unknown) =>
    value === null ? main === locationId : Array.isArray(value) && value.every(at)
  const history = (o.scheduleHistory ?? []).filter((entry) => {
    if (entry.kind === 'hours') return true
    if (entry.kind === 'closure-added' || entry.kind === 'closure-removed') {
      const closure = (entry.after ?? entry.before) as { staffId?: string; date: string } | null
      return !!closure && keptClosure(closure)
    }
    if (entry.kind === 'staff-hours')
      return (
        !!entry.subjectId &&
        home.has(entry.subjectId) &&
        allHere(entry.before) &&
        allHere(entry.after)
      )
    if (entry.kind.startsWith('staff')) return !!entry.subjectId && home.has(entry.subjectId)
    return !!entry.subjectId && here.has(entry.subjectId)
  })
  return {
    ...s,
    staff,
    resources,
    operations: {
      ...o,
      closures: o.closures.filter(keptClosure),
      ...(o.timeOff ? { timeOff } : {}),
      ...(o.leaveAllowances
        ? { leaveAllowances: o.leaveAllowances.filter((a) => home.has(a.staffId)) }
        : {}),
      ...(o.rotaChanges ? { rotaChanges: rotaKept } : {}),
      ...(o.scheduleHistory ? { scheduleHistory: history } : {}),
    },
  }
}
