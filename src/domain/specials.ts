import { addDays } from './format'
import type { Appointment, BusinessState } from './model'
import { localSignals } from './localSignals'
import type { Category, LocalSignal, LocalSource } from './localSignals'
import { businessDate } from './operations'
import { availableMinutes, dayAppointments } from './selectors'
import { SPECIAL_MAX_DAYS, specialsList } from './specialsSchema'
import type { Special, SpecialInput } from './specialsSchema'
export {
  SPECIAL_MAX_DAYS,
  specialInputSchema,
  specialSchema,
  specialsProblem,
} from './specialsSchema'
export type { Special, SpecialInput } from './specialsSchema'
export { specialsList }

/**
 * V3 specials: the assistant manager. From the time of year, holidays, the weather and local
 * events it suggests a special with its reason and how much room the studio has for it. A manager
 * plans it; planning only records it. Nothing is sent and no price changes: telling clients goes
 * through the Inbox, and any discount is given at checkout as today. Once it has run, the studio
 * sees how those days compared with its usual weeks.
 */

const days = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000) + 1

/** Records a planned special. `next` is the working copy inside `execute`. */
export function planSpecial(
  next: BusinessState,
  input: SpecialInput,
  now: string,
  makeId: () => string,
) {
  if (input.endDate < input.startDate) throw new Error('A special cannot end before it starts.')
  if (days(input.startDate, input.endDate) > SPECIAL_MAX_DAYS)
    throw new Error('Keep a special to three months or less, so its result can be measured.')
  const today = businessDate(next, now)
  if (input.endDate < today) throw new Error('This special has already finished.')
  if (specialsList(next).some((x) => x.signalId === input.signalId && !x.stoppedOn))
    throw new Error('This special is already planned.')
  const special: Special = {
    ...input,
    id: makeId(),
    organisationId: next.organisation.id,
    createdAt: now,
  }
  next.specials = [...specialsList(next), special]
  return special.id
}

/** Stops a special early; its result is then read up to the day it stopped. */
export function stopSpecial(next: BusinessState, specialId: string, today: string) {
  const special = specialsList(next).find((x) => x.id === specialId)
  if (!special) throw new Error('Special not found.')
  if (special.stoppedOn) throw new Error('This special has already stopped.')
  special.stoppedOn = today < special.startDate ? special.startDate : today
  return special.id
}

const live = (a: Appointment) => a.status !== 'cancelled' && a.status !== 'no_show'

function visitsFor(s: BusinessState, kinds: Category[], from: string, to: string) {
  const services = new Set(s.services.filter((x) => kinds.includes(x.category)).map((x) => x.id))
  return s.appointments.filter(
    (a) => live(a) && services.has(a.serviceId) && a.date >= from && a.date <= to,
  )
}

/** Visits of these kinds a week over the eight weeks before `today`, or null with no history. */
export function usualPerWeek(s: BusinessState, kinds: Category[], today: string) {
  const count = visitsFor(s, kinds, addDays(today, -56), addDays(today, -1)).length
  return count ? count / 8 : null
}

/** About how many more visits of these kinds fit in the days given, from open team time. */
export function roomFor(s: BusinessState, kinds: Category[], from: string, to: string) {
  const services = s.services.filter((x) => !x.archived && kinds.includes(x.category))
  const team = s.staff.filter((p) => !p.archived)
  if (!services.length || !team.length) return 0
  const able = team.filter((p) => services.some((x) => p.serviceIds.includes(x.id))).length
  const length =
    services.reduce((sum, x) => sum + x.durationMinutes + x.bufferMinutes, 0) / services.length
  let open = 0
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const booked = dayAppointments(s, d).reduce((sum, a) => sum + a.bookedDurationMinutes, 0)
    open += Math.max(0, availableMinutes(s, d) - booked)
  }
  return Math.floor((((open * able) / team.length) * 0.5) / length)
}

export type SpecialSuggestion = {
  signal: LocalSignal
  title: string
  reason: string
  offer: string
  startDate: string
  endDate: string
  categories: Category[]
  /** About how many more visits fit, counting half the open time, as other bookings still come. */
  room: number
  usualPerWeek: number | null
  /** Visits of these kinds on the same dates last year, when the studio has that history. */
  lastYear: number | null
}

/**
 * Specials worth considering now: things coming up soon enough to plan for, that suit the
 * studio's treatments, not already planned or passed. Soonest first.
 */
export function suggestSpecials(
  s: BusinessState,
  today: string,
  options: { limit?: number; sources?: LocalSource[] } = {},
): SpecialSuggestion[] {
  const { limit = 3, sources } = options
  const offered = new Set(
    s.services
      .filter((x) => !x.archived && s.staff.some((p) => !p.archived && p.serviceIds.includes(x.id)))
      .map((x) => x.category),
  )
  const planned = new Set(specialsList(s).map((x) => x.signalId))
  return localSignals(s, today, addDays(today, 120), sources)
    .filter((signal) => addDays(signal.startDate, -signal.leadDays) <= today)
    .filter((signal) => signal.endDate >= addDays(today, 2) && !planned.has(signal.id))
    .map((signal) => ({ ...signal, categories: signal.categories.filter((c) => offered.has(c)) }))
    .filter((signal) => signal.categories.length > 0)
    .slice(0, limit)
    .map((signal) => {
      const startDate = signal.startDate < today ? today : signal.startDate
      const back = (d: string) => addDays(d, -364)
      const before = visitsFor(s, signal.categories, back(startDate), back(signal.endDate)).length
      const hasLastYear = s.appointments.some((a) => a.date <= back(startDate))
      return {
        signal,
        title: signal.title,
        reason: signal.why,
        offer: signal.idea,
        startDate,
        endDate: signal.endDate,
        categories: signal.categories,
        room: roomFor(s, signal.categories, startDate, signal.endDate),
        usualPerWeek: usualPerWeek(s, signal.categories, today),
        lastYear: hasLastYear ? before : null,
      }
    })
}

/** The command input that plans a suggestion as it stands. */
export const suggestionInput = (g: SpecialSuggestion): SpecialInput => ({
  signalId: g.signal.id,
  title: g.title,
  reason: g.reason,
  offer: g.offer,
  categories: g.categories,
  startDate: g.startDate,
  endDate: g.endDate,
})

export type SpecialResult = {
  special: Special
  state: 'upcoming' | 'running' | 'finished'
  /** The last day counted: the end, the day it stopped, or today while it runs. */
  until: string
  visits: number
  /** The same number of days, averaged over the four periods before it started. */
  usual: number | null
  newClients: number
  verdict: 'more' | 'same' | 'fewer' | null
}

/**
 * How a special went: visits of its kinds on its days against the same length of time before it,
 * and how many of those guests were new. It cannot tell which guests came because of the special.
 */
export function specialResult(s: BusinessState, special: Special, today: string): SpecialResult {
  const end =
    special.stoppedOn && special.stoppedOn < special.endDate ? special.stoppedOn : special.endDate
  const state = today < special.startDate ? 'upcoming' : today <= end ? 'running' : 'finished'
  const until = state === 'running' ? today : end
  const length = days(special.startDate, until)
  const visits =
    state === 'upcoming' ? [] : visitsFor(s, special.categories, special.startDate, until)
  const earlier = [1, 2, 3, 4].map((k) => {
    const from = addDays(special.startDate, -length * k)
    return visitsFor(s, special.categories, from, addDays(from, length - 1)).length
  })
  const usual = earlier.some((n) => n > 0) ? earlier.reduce((a, b) => a + b, 0) / 4 : null
  const firstVisit = new Map<string, string>()
  for (const a of s.appointments.filter(live).sort((x, y) => x.date.localeCompare(y.date)))
    if (!firstVisit.has(a.clientId)) firstVisit.set(a.clientId, a.id)
  const newClients = new Set(
    visits.filter((a) => firstVisit.get(a.clientId) === a.id).map((a) => a.clientId),
  ).size
  const verdict =
    state !== 'finished' || usual === null
      ? null
      : visits.length >= usual * 1.15
        ? 'more'
        : visits.length <= usual * 0.85
          ? 'fewer'
          : 'same'
  return { special, state, until, visits: visits.length, usual, newClients, verdict }
}

const kindsLabel = (c: Category[]) => c.map((x) => x.toLowerCase()).join(' and ')
const about = (n: number) => (n < 1 ? 'fewer than one' : `about ${Math.round(n)}`)

/** How much room a suggestion has, in one sentence. */
export function roomSentence(g: SpecialSuggestion) {
  const kinds = kindsLabel(g.categories)
  const room =
    g.room >= 60
      ? `Plenty of open time for ${kinds} visits on those days`
      : g.room > 0
        ? `Room for about ${g.room} more ${kinds} ${g.room === 1 ? 'visit' : 'visits'} on those days`
        : `Those days are already nearly full for ${kinds}`
  const usual = g.usualPerWeek ? `; you usually do ${about(g.usualPerWeek)} a week` : ''
  const last = g.lastYear !== null ? `. The same dates last year had ${g.lastYear}` : ''
  return `${room}${usual}${last}.`
}

/** Where a planned special stands, in one sentence. */
export function resultSentence(r: SpecialResult, day: (date: string) => string) {
  const kinds = kindsLabel(r.special.categories)
  const visits = `${r.visits} ${kinds} ${r.visits === 1 ? 'visit' : 'visits'}`
  const usual = r.usual === null ? '' : `, against ${about(r.usual)} usually`
  const newer = r.newClients
    ? `, including ${r.newClients} new ${r.newClients === 1 ? 'client' : 'clients'}`
    : ''
  if (r.state === 'upcoming')
    return `Starts ${day(r.special.startDate)}. Nothing has been sent; tell clients from the Inbox when you are ready.`
  if (r.state === 'running')
    return `So far: ${visits} since ${day(r.special.startDate)}${usual}${newer}.`
  if (r.verdict === 'more') return `It worked: ${visits}${usual}${newer}.`
  if (r.verdict === 'fewer') return `Fewer than usual: ${visits}${usual}${newer}.`
  if (r.verdict === 'same') return `About the same as usual: ${visits}${usual}${newer}.`
  return `${visits}${newer}. There was not enough history to compare.`
}

/** Planned specials still worth showing: upcoming, running, or finished in the last 30 days. */
export function currentSpecials(s: BusinessState, today: string) {
  return specialsList(s)
    .map((x) => specialResult(s, x, today))
    .filter((r) => r.state !== 'finished' || r.until >= addDays(today, -30))
    .sort((a, b) => a.special.startDate.localeCompare(b.special.startDate))
}
