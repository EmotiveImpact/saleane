import type { BusinessState } from './model'
import type { Command } from './commandSchema'
import { addDays, dateLabel, fullDateLabel } from './format'
import {
  businessDate,
  hoursFor,
  operations,
  SCHEDULE_HISTORY_LIMIT,
  usualHoursFor,
} from './operations'
import type { Operations } from './operations'
import { offeredAt, placeOf, places } from './locations'
import { affectedVisits, scheduleSnapshot } from './schedule'
import type { AffectedVisit } from './schedule'
import { describeKept, usualDay } from './rota'
import type { RotaChange } from './rotaSchema'
import { STAFF_MOVE_AHEAD_DAYS, STAFF_MOVE_KEPT_LIMIT, STAFF_MOVE_LIMIT } from './staffMovesSchema'
import type { StaffMove, StaffMoveInput } from './staffMovesSchema'

/**
 * Stage 4: moving someone to another location from a date. Their usual days and hours stay the
 * same and happen at the new location from that date. Days before it stay where they were, so
 * pay, hours worked, reports and the rota for those days are unchanged.
 *
 * How it is kept: the person's weekly hours say where they work from their latest move on, and
 * each move keeps where each weekday it moved was before. `usualHoursFor` in operations.ts reads
 * both, so every place that asks where someone works on a date (booking at the desk, the guest
 * booking page, the AI receptionist, Book with Google, moving a visit, waitlist offers, cover
 * plans, Today, the rota, a general manager's team and a practitioner's own day) gives the old
 * location before the date and the new one from it.
 *
 * A move never moves, cancels or messages a booked visit. When it would leave visits at the old
 * location from that date it is refused, naming them, unless the person saving chooses to keep
 * them booked; the rota then warns on those days until they are moved. Days already changed on
 * the rota for dates from the move stay exactly as they were, and are named on the move.
 */
export type StaffMoveCommand = Extract<Command, { type: 'staff-move' | 'staff-move-cancel' }>
type WeeklyHours = Operations['hours']

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
/** Monday first, as the rota and Settings show a week. */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]
const firstName = (name: string) => name.trim().split(/\s+/)[0]
const list = (items: string[]) =>
  items.length < 2 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`
const placeName = (s: BusinessState, id: string) => placeOf(s, id)?.name ?? 'a closed location'
const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000)

/** Every move, cancelled ones too, oldest first. */
export const staffMoves = (s: BusinessState) => operations(s).staffMoves ?? []

/** One person's moves still standing, oldest first. */
export function movesFor(s: BusinessState, staffId: string) {
  return staffMoves(s)
    .filter((m) => m.staffId === staffId && !m.cancelled)
    .sort((a, b) => a.date.localeCompare(b.date))
}

/** Their next move, when one is still to come. */
export const comingMove = (s: BusinessState, staffId: string, today: string) =>
  movesFor(s, staffId).find((m) => m.date > today)

/** Their latest move that has happened, if any. */
export const lastMove = (s: BusinessState, staffId: string, today: string) =>
  movesFor(s, staffId)
    .filter((m) => m.date <= today)
    .at(-1)

/** Weekdays in words, Monday first, with runs joined: "Monday to Friday and Sunday". */
export function weekdaysWords(days: number[]) {
  const order = [...new Set(days)].sort((a, b) => WEEK_ORDER.indexOf(a) - WEEK_ORDER.indexOf(b))
  const runs: number[][] = []
  for (const day of order) {
    const run = runs.at(-1)
    if (run && WEEK_ORDER.indexOf(day) === WEEK_ORDER.indexOf(run.at(-1)!) + 1) run.push(day)
    else runs.push([day])
  }
  return list(
    runs.flatMap((run) =>
      run.length > 2
        ? [`${WEEKDAYS[run[0]]} to ${WEEKDAYS[run.at(-1)!]}`]
        : run.map((day) => WEEKDAYS[day]),
    ),
  )
}

/** The locations a move came from, in the order of the week. */
export function moveFrom(move: Pick<StaffMove, 'days'>) {
  return [...new Set(move.days.map((d) => d.from))]
}

/**
 * A move in words for the rota and Settings: "Moves from Marylebone to Shoreditch on Monday 20
 * October" or, once it has happened, "Moved from Marylebone to Shoreditch on ...".
 */
export function moveWords(s: BusinessState, move: StaffMove, today: string) {
  const verb = move.date > today ? 'Moves' : 'Moved'
  const from = list(moveFrom(move).map((id) => placeName(s, id)))
  return `${verb} from ${from} to ${placeName(s, move.to)} on ${dateLabel(move.date, s.organisation.locale)}`
}

/** Their weekly hours as they stand: their own, or the studio's opening hours they follow. */
function weekOf(s: BusinessState, staffId: string): WeeklyHours {
  const person = s.staff.find((p) => p.id === staffId)
  return (person?.hours ?? operations(s).hours).map((h) => ({ ...h }))
}

/** One weekday of the weekly hours, at a location; the main one stays unnamed. */
function at(s: BusinessState, day: WeeklyHours[number], locationId: string) {
  const { locationId: _was, ...rest } = day
  void _was
  return locationId === s.organisation.locationId ? rest : { ...rest, locationId }
}

/** The treatments someone does that a location does not offer, by name. */
export function notOfferedAt(s: BusinessState, staffId: string, locationId: string) {
  const person = s.staff.find((p) => p.id === staffId)
  return (person?.serviceIds ?? [])
    .map((id) => s.services.find((service) => service.id === id))
    .filter((service) => !!service && !service.archived && !offeredAt(service, locationId))
    .map((service) => service!.name)
}

function checkDate(date: string, today: string) {
  if (date < today) throw new Error('That day has passed. Days before a move stay where they were.')
  if (date > addDays(today, STAFF_MOVE_AHEAD_DAYS))
    throw new Error('Move someone up to a year ahead.')
}

/**
 * What a move would be, checked: someone on the team, a day from today to a year ahead after any
 * move of theirs already planned, an open location that offers at least one of their treatments,
 * and at least one working day to move. Throws the reason in plain words otherwise.
 */
function planMove(s: BusinessState, input: StaffMoveInput, today: string) {
  const person = s.staff.find((p) => p.id === input.staffId && !p.archived)
  if (!person) throw new Error('Choose someone on the team.')
  const first = firstName(person.name)
  checkDate(input.date, today)
  const site = placeOf(s, input.to)
  if (!site || site.archived) throw new Error('Choose an open location.')
  const already = movesFor(s, person.id).find((m) => m.date >= input.date)
  if (already)
    throw new Error(
      `${first} already moves to ${placeName(s, already.to)} on ${dateLabel(already.date, s.organisation.locale)}. Choose a day after that, or cancel that move first.`,
    )
  const main = s.organisation.locationId
  const week = weekOf(s, person.id)
  const where = (day: WeeklyHours[number]) => day.locationId ?? main
  if (input.from !== undefined) {
    const old = placeOf(s, input.from)
    if (!old) throw new Error('Choose where their days are now.')
    if (old.id === site.id) throw new Error('Choose a different location to move them to.')
    if (!week.some((day) => !day.closed && where(day) === old.id))
      throw new Error(`${first} does not work at ${old.name} in their usual week.`)
  }
  const moving = week.filter((day) =>
    input.from !== undefined ? where(day) === input.from : where(day) !== site.id,
  )
  if (!moving.some((day) => !day.closed))
    throw new Error(`${first} already works at ${site.name} every day of their usual week.`)
  const live = person.serviceIds
    .map((id) => s.services.find((service) => service.id === id))
    .filter((service) => service && !service.archived)
  if (live.length && !live.some((service) => offeredAt(service!, site.id)))
    throw new Error(
      `${site.name} does not offer any of ${first}'s treatments. Choose another location.`,
    )
  const days = moving.map((day) => ({ day: day.day, from: where(day) }))
  const moved = new Set(days.map((d) => d.day))
  return {
    person,
    site,
    days,
    hours: week.map((day) => (moved.has(day.day) ? at(s, day, site.id) : day)),
  }
}

/** Days changed on the rota from `date` that still send someone to one of these locations. */
function rotaDaysAt(s: BusinessState, staffId: string, date: string, locations: string[]) {
  const main = s.organisation.locationId
  return (operations(s).rotaChanges ?? [])
    .filter(
      (c) =>
        !c.ended &&
        c.working &&
        c.staffId === staffId &&
        c.date >= date &&
        locations.includes(c.locationId ?? main),
    )
    .sort((a, b) => a.date.localeCompare(b.date))
}

function strandedMessage(s: BusinessState, affected: AffectedVisit[], name: string) {
  const one = affected.length === 1
  const shown = affected.slice(0, 5).map((v) => describeKept(v, s.organisation.locale))
  const more = affected.length - shown.length
  return `${one ? 'A booked visit' : `${affected.length} booked visits`} with ${name} would be at a location where they no longer work: ${shown.join('; ')}${more ? `; and ${more} more` : ''}. Move ${one ? 'it' : 'them'} first, or choose to keep ${one ? 'it' : 'them'} booked as ${one ? 'it is' : 'they are'}.`
}

const sameHours = (a: WeeklyHours, b: WeeklyHours) =>
  WEEK_ORDER.every((weekday) => {
    const x = a.find((h) => h.day === weekday)
    const y = b.find((h) => h.day === weekday)
    return (
      !!x &&
      !!y &&
      x.closed === y.closed &&
      x.open === y.open &&
      x.close === y.close &&
      x.locationId === y.locationId
    )
  })

/**
 * Runs a move or a cancelled move on `next`, a copy of the studio about to be saved, and returns
 * the move's id.
 */
export function runStaffMoveCommand(
  next: BusinessState,
  command: StaffMoveCommand,
  now: string,
  makeId: () => string,
) {
  const today = businessDate(next, now)
  const before = scheduleSnapshot(next)
  next.operations = structuredClone(operations(next))
  const o = next.operations
  const locale = next.organisation.locale
  const moves = [...(o.staffMoves ?? [])]
  let move: StaffMove
  let summary: string
  const person = (id: string) => next.staff.find((p) => p.id === id)

  if (command.type === 'staff-move') {
    const plan = planMove(next, command.input, today)
    const note = command.input.note?.trim()
    const from = [...new Set(plan.days.map((d) => d.from))]
    const kept = rotaDaysAt(next, plan.person.id, command.input.date, from).map((c) => c.id)
    move = {
      id: makeId(),
      staffId: plan.person.id,
      date: command.input.date,
      to: plan.site.id,
      days: plan.days,
      ...(note ? { note } : {}),
      ...(plan.person.hours ? {} : { madeOwnHours: true as const }),
      ...(kept.length ? { rotaKept: kept.slice(0, STAFF_MOVE_KEPT_LIMIT) } : {}),
      createdAt: now,
      actor: 'Local operator',
    }
    if (moves.length >= STAFF_MOVE_LIMIT)
      throw new Error('Too many moves to keep. Ask SALEANE support to look at the record.')
    moves.push(move)
    summary = `${plan.person.name} moves from ${list(from.map((id) => placeName(next, id)))} to ${plan.site.name} on ${fullDateLabel(move.date, locale)}: ${weekdaysWords(plan.days.filter((d) => plan.hours.find((h) => h.day === d.day && !h.closed)).map((d) => d.day))}.`
    next.staff = next.staff.map((p) => (p.id === plan.person.id ? { ...p, hours: plan.hours } : p))
  } else {
    const index = moves.findIndex((m) => m.id === command.moveId)
    const found = moves[index]
    if (!found) throw new Error('That move is not on record.')
    if (found.cancelled) throw new Error('That move has already been cancelled.')
    const who = person(found.staffId)
    if (!who) throw new Error('That move is not on record.')

    if (found.date <= today)
      throw new Error(
        `${firstName(who.name)} has already moved. To bring them back, move them again from a day still to come.`,
      )
    if (movesFor(next, found.staffId).at(-1)?.id !== found.id)
      throw new Error(`${firstName(who.name)} moves again later. Cancel that move first.`)
    // Each weekday that moved and is still at the new location goes back to where it was.
    const main = next.organisation.locationId
    const back = new Map(found.days.map((d) => [d.day, d.from]))
    let hours: WeeklyHours | undefined = weekOf(next, who.id).map((day) =>
      back.has(day.day) && (day.locationId ?? main) === found.to
        ? at(next, day, back.get(day.day)!)
        : day,
    )
    // Someone who followed the studio's opening hours does again, if nothing else has changed.
    if (found.madeOwnHours && sameHours(hours, operations(next).hours)) hours = undefined
    next.staff = next.staff.map((p) => {
      if (p.id !== who.id) return p
      const { hours: _old, ...rest } = p
      void _old
      return hours ? { ...rest, hours } : rest
    })
    move = { ...found, cancelled: { at: now, actor: 'Local operator' } }
    moves[index] = move
    summary = `${who.name}'s move to ${placeName(next, found.to)} on ${fullDateLabel(found.date, locale)} was cancelled. Their days stay where they were.`
  }
  // A new list each time, so the look-up by person is never out of date.
  o.staffMoves = moves

  const affected = affectedVisits(before, next, now)
  if (affected.length) {
    if (!command.keepBooked)
      throw new Error(strandedMessage(next, affected, firstName(person(move.staffId)?.name ?? '')))
    const kept = affected.map((v) => v.appointmentId).slice(0, STAFF_MOVE_KEPT_LIMIT)
    if (move.cancelled) move.cancelled.kept = kept
    else move.kept = kept
  }
  // The schedule history in Settings keeps the weekly hours before and after, as for any change.
  o.scheduleHistory = [
    ...(o.scheduleHistory ?? []),
    {
      id: makeId(),
      occurredAt: now,
      actor: 'Local operator',
      kind: 'staff-hours' as const,
      subjectId: move.staffId,
      summary,
      before: before.staff.find((p) => p.id === move.staffId)?.hours ?? null,
      after: person(move.staffId)?.hours ?? null,
    },
  ].slice(-SCHEDULE_HISTORY_LIMIT)
  return move.id
}

export type StaffMovePreview = {
  /** Why it cannot be saved, if it cannot. */
  error: string | null
  /** Booked visits it would leave where they no longer work. */
  affected: AffectedVisit[]
  /** Days already changed on the rota that keep them at the old location. */
  rotaDays: RotaChange[]
  /** Their treatments the new location does not offer. */
  notOffered: string[]
  /** Their usual week from the move: each day's hours at the new location, or why there are none. */
  week: {
    day: number
    working: boolean
    open?: number
    close?: number
    locationId: string
    /** They usually work this day, but the location is closed. */
    closed?: true
  }[]
}

/**
 * What a move (or cancelling one) would do before it is saved: the reason it cannot be, the booked
 * visits it would leave behind, days already changed on the rota, treatments the new location does
 * not offer, and their week there. The server checks the same again.
 */
export function staffMovePreview(
  s: BusinessState,
  command: StaffMoveCommand,
  now = new Date().toISOString(),
): StaffMovePreview {
  const next = scheduleSnapshot(s)
  try {
    const id = runStaffMoveCommand(next, { ...command, keepBooked: true }, now, () => 'preview')
    const move = staffMoves(next).find((m) => m.id === id)!
    const from = moveFrom(move)
    const moving = command.type === 'staff-move'
    // Their week from the day of the move: at the new location, or back where it was.
    const week = WEEK_ORDER.map((weekday) => {
      const date = Array.from({ length: 7 }, (_, i) => addDays(move.date, i)).find(
        (d) => new Date(`${d}T12:00:00Z`).getUTCDay() === weekday,
      )!
      const day = usualDay(next, move.staffId, date)
      const own = (
        next.staff.find((p) => p.id === move.staffId)?.hours ?? operations(next).hours
      ).find((h) => h.day === weekday)
      const venueClosed = hoursFor(next, date, day.locationId).closed
      return day.working
        ? {
            day: weekday,
            working: true,
            open: day.open,
            close: day.close,
            locationId: day.locationId,
          }
        : {
            day: weekday,
            working: false,
            locationId: day.locationId,
            ...(own && !own.closed && venueClosed ? { closed: true as const } : {}),
          }
    })
    return {
      error: null,
      affected: affectedVisits(s, next, now),
      rotaDays: moving ? rotaDaysAt(s, move.staffId, move.date, from) : [],
      notOffered: moving ? notOfferedAt(s, move.staffId, move.to) : [],
      week,
    }
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'This cannot be saved.',
      affected: [],
      rotaDays: [],
      notOffered: [],
      week: [],
    }
  }
}

/** Puts the signed-in person's name on the moves they made and cancelled. */
export function stampStaffMoveActors(before: BusinessState, after: BusinessState, actor: string) {
  const old = new Map(staffMoves(before).map((m) => [m.id, m]))
  for (const move of operations(after).staffMoves ?? []) {
    const was = old.get(move.id)
    if (!was) move.actor = actor
    if (move.cancelled && !was?.cancelled) move.cancelled.actor = actor
  }
}

/**
 * Ledger checks for parseState: every move is about someone on the team, goes somewhere other than
 * where each of its days was, and one person's standing moves fall on different days.
 */
export function staffMovesProblem(s: BusinessState) {
  const moves = staffMoves(s)
  if (new Set(moves.map((m) => m.id)).size !== moves.length) return 'Duplicate move IDs.'
  const staff = new Set(s.staff.map((p) => p.id))
  const days = new Set<string>()
  for (const move of moves) {
    if (!staff.has(move.staffId)) return 'A move names someone not on the team.'
    if (
      move.days.some((d) => d.from === move.to) ||
      new Set(move.days.map((d) => d.day)).size !== move.days.length
    )
      return 'A move does not change where its days are.'
    if (move.cancelled) continue
    const key = `${move.staffId} ${move.date}`
    if (days.has(key)) return 'Two moves start on one day for one person.'
    days.add(key)
  }
  return null
}

/**
 * For who changed what: the day a move starts, from where to where, how many days of the week
 * moved and any booked visits kept. Null for anything else.
 */
export function staffMoveDetail(after: BusinessState, action: string, recordId: string) {
  if (action !== 'staff-move' && action !== 'staff-move-cancel') return null
  const move = staffMoves(after).find((m) => m.id === recordId)
  if (!move) return null
  const from = moveFrom(move)
  const moving = action === 'staff-move'
  // From one location, the record says where to where; from several, where they went.
  const where =
    from.length === 1
      ? [{ f: 'locationId', from: moving ? from[0] : move.to, to: moving ? move.to : from[0] }]
      : moving
        ? [{ f: 'locationId', to: move.to }]
        : []
  const kept = moving ? move.kept : move.cancelled?.kept
  return {
    fields: [
      { f: 'date', to: move.date },
      ...where,
      ...(moving ? [{ f: 'daysMoved', to: move.days.length }] : []),
      ...(kept?.length ? [{ f: 'visitsKeptAway', to: kept.length }] : []),
    ],
  }
}

/** The weekdays a move took that they work, in their weekly hours as they stand. */
export function movedWorkdays(s: BusinessState, move: StaffMove) {
  const week = weekOf(s, move.staffId)
  return move.days.filter((d) => week.some((h) => h.day === d.day && !h.closed)).map((d) => d.day)
}

/** Whether a move can still be cancelled: still to come, and their latest. */
export function cancellable(s: BusinessState, move: StaffMove, today: string) {
  return !move.cancelled && move.date > today && movesFor(s, move.staffId).at(-1)?.id === move.id
}

/** Every open location someone could move to, for the screen: anywhere but where they all are. */
export function moveDestinations(s: BusinessState, staffId: string) {
  const main = s.organisation.locationId
  const working = weekOf(s, staffId).filter((day) => !day.closed)
  return places(s).filter((place) => working.some((day) => (day.locationId ?? main) !== place.id))
}

/**
 * Where someone works across their usual week: each location and its weekdays. With a date, the
 * week (or as many days as asked) from that date, which a move still to come has not reached yet;
 * without one, their weekly hours as they stand, which already hold every move.
 */
export function usualSites(s: BusinessState, staffId: string, from?: string, days = 7) {
  const main = s.organisation.locationId
  const sites = new Map<string, number[]>()
  const week = from
    ? Array.from({ length: days }, (_, i) => usualHoursFor(s, staffId, addDays(from, i)))
    : weekOf(s, staffId)
  for (const day of week)
    if (!day.closed) {
      const id = day.locationId ?? main
      sites.set(id, [...(sites.get(id) ?? []), day.day])
    }
  return [...sites].map(([locationId, days]) => ({ locationId, days }))
}

/** Where someone works this week and any move still to come, in a few words for Settings. */
export function whereTheyWork(s: BusinessState, staffId: string, today: string) {
  const coming = comingMove(s, staffId, today)
  // The coming week, up to the day before any move, which is named on its own.
  const days = coming ? Math.min(7, daysBetween(today, coming.date)) : 7
  const sites = usualSites(s, staffId, today, days).map((site) => placeName(s, site.locationId))
  const move = coming
    ? `moves to ${placeName(s, coming.to)} on ${dateLabel(coming.date, s.organisation.locale)}`
    : ''
  if (!sites.length) return move ? `M${move.slice(1)}` : 'Not working this week'
  return [`Works at ${list(sites)}`, ...(move ? [move] : [])].join(' · ')
}
