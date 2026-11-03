import { slots } from './commands'
import { addDays } from './format'
import type { Appointment, BusinessState } from './model'
import { operations, stock } from './operations'
import { availableMinutes, clientStats, dayAppointments, usualWeeks } from './selectors'
import { renterVisit, serviceRevenue } from './takings'
import { pastKeepingPeriod } from './retentionDue'

/**
 * V3 Smart insights. Every insight is worked out from the studio's own records and says what it
 * is based on, so a person can check it. Nothing here changes the record or contacts anyone:
 * a suggestion becomes a change only when a person acts on it.
 */

const DAY = 86_400_000
const live = (a: Appointment) => a.status !== 'cancelled' && a.status !== 'no_show'
const bookedMinutes = (s: BusinessState, date: string) =>
  dayAppointments(s, date).reduce((sum, a) => sum + a.bookedDurationMinutes, 0)

/** The same weekday in each of the previous four weeks that the studio was open. */
function sameWeekdays(s: BusinessState, date: string) {
  return [1, 2, 3, 4].map((w) => addDays(date, -7 * w)).filter((d) => availableMinutes(s, d) > 0)
}

/** An average over earlier days, or null when the studio has too little history to compare. */
function usual(values: number[]) {
  if (values.length < 2 || values.every((v) => v === 0)) return null
  return values.reduce((sum, v) => sum + v, 0) / values.length
}

/**
 * Stage 3: everyone renting a chair or room at any point in the five weeks to a day. Comparisons
 * leave them out of every day compared, like for like, so someone starting or stopping renting is
 * not read as takings or visits falling or rising.
 */
function rentingAround(s: BusinessState, date: string) {
  const from = addDays(date, -34)
  return new Set(
    (operations(s).rentals ?? [])
      .filter((r) => r.from <= date && (!r.to || r.to >= from))
      .map((r) => r.staffId),
  )
}

/**
 * The studio's treatment takings between two days. Stage 3: a renter's own takings are theirs, not
 * the studio's, and people in `leftOut` (see `rentingAround`) are left out altogether.
 */
function takingsBetween(
  s: BusinessState,
  from: string,
  to: string,
  leftOut: ReadonlySet<string> = new Set(),
) {
  const visits = new Map(
    s.appointments
      .filter(
        (a) =>
          a.status === 'completed' &&
          a.date >= from &&
          a.date <= to &&
          !leftOut.has(a.staffId) &&
          !renterVisit(s, a),
      )
      .map((a) => [a.id, a]),
  )
  return s.sales
    .filter((sale) => visits.has(sale.appointmentId))
    .reduce((sum, sale) => sum + serviceRevenue(sale), 0)
}

const hasHistoryBefore = (s: BusinessState, date: string) =>
  s.appointments.some((a) => a.status === 'completed' && a.date <= date)

export type MorningBrief = {
  date: string
  visits: number
  guests: number
  firstVisits: number
  bookedMinutes: number
  /** Booked minutes on this weekday over the last four weeks, when there is enough history. */
  usualBookedMinutes: number | null
  /** Open minutes across the team not yet booked. */
  openMinutes: number
  yesterday: { date: string; takingsMinor: number; usualTakingsMinor: number | null }
}

export function morningBrief(s: BusinessState, today: string): MorningBrief {
  const day = dayAppointments(s, today)
  const guests = new Set(day.map((a) => a.clientId))
  const firstVisits = [...guests].filter(
    (id) =>
      !s.appointments.some((a) => a.clientId === id && a.status === 'completed' && a.date < today),
  ).length
  const booked = bookedMinutes(s, today)
  const yesterday = addDays(today, -1)
  const renting = rentingAround(s, yesterday)
  return {
    date: today,
    visits: day.length,
    guests: guests.size,
    firstVisits,
    bookedMinutes: booked,
    usualBookedMinutes: usual(sameWeekdays(s, today).map((d) => bookedMinutes(s, d))),
    openMinutes: Math.max(0, availableMinutes(s, today) - booked),
    yesterday: {
      date: yesterday,
      takingsMinor: takingsBetween(s, yesterday, yesterday, renting),
      usualTakingsMinor: usual(
        sameWeekdays(s, yesterday).map((d) => takingsBetween(s, d, d, renting)),
      ),
    },
  }
}

export type Notice = {
  id: string
  kind: 'quiet-day' | 'cancellations' | 'takings-down' | 'missed-visits' | 'low-stock'
  title: string
  detail: string
  /** Money notices are for owners and managers only. */
  managersOnly: boolean
  clientId?: string
  appointmentId?: string
}

/**
 * Things that look unusual against the studio's own recent weeks. Each rule needs enough history
 * to compare with, so a new studio sees nothing rather than a false alarm.
 */
export function unusual(s: BusinessState, today: string): Notice[] {
  const notices: Notice[] = []
  const hours = (minutes: number) => {
    const h = Math.round(minutes / 30) / 2
    return `${h} ${h === 1 ? 'hour' : 'hours'}`
  }

  const tomorrow = addDays(today, 1)
  const usualTomorrow = usual(sameWeekdays(s, tomorrow).map((d) => bookedMinutes(s, d)))
  const bookedTomorrow = bookedMinutes(s, tomorrow)
  if (
    availableMinutes(s, tomorrow) > 0 &&
    usualTomorrow !== null &&
    usualTomorrow >= 120 &&
    bookedTomorrow < usualTomorrow * 0.5
  )
    notices.push({
      id: `quiet-${tomorrow}`,
      kind: 'quiet-day',
      title: 'Tomorrow is quieter than usual',
      detail: `${bookedTomorrow ? `${hours(bookedTomorrow)} booked so far` : 'Nothing booked so far'}. This day of the week usually has about ${hours(usualTomorrow)}.`,
      managersOnly: false,
    })

  const weekFrom = addDays(today, -6)
  const lost = (from: string, to: string) =>
    s.appointments.filter((a) => !live(a) && a.date >= from && a.date <= to).length
  const lostThisWeek = lost(weekFrom, today)
  const earlierWeeks = [1, 2, 3, 4].map((w) =>
    lost(addDays(weekFrom, -7 * w), addDays(today, -7 * w)),
  )
  const usualLost = hasHistoryBefore(s, addDays(today, -21))
    ? earlierWeeks.reduce((sum, n) => sum + n, 0) / 4
    : null
  if (usualLost !== null && lostThisWeek >= 3 && lostThisWeek >= Math.max(1, usualLost) * 2)
    notices.push({
      id: `cancellations-${today}`,
      kind: 'cancellations',
      title: 'More cancellations than usual',
      detail: `${lostThisWeek} visits were cancelled or missed in the last 7 days, against about ${Math.round(usualLost)} a week before that.`,
      managersOnly: false,
    })

  const renting = rentingAround(s, today)
  const takingsWeek = takingsBetween(s, weekFrom, today, renting)
  const earlierTakings = [1, 2, 3, 4].map((w) =>
    takingsBetween(s, addDays(weekFrom, -7 * w), addDays(today, -7 * w), renting),
  )
  const usualTakings = hasHistoryBefore(s, addDays(today, -21))
    ? earlierTakings.reduce((sum, n) => sum + n, 0) / 4
    : 0
  if (usualTakings > 0 && takingsWeek < usualTakings * 0.75)
    notices.push({
      id: `takings-${today}`,
      kind: 'takings-down',
      title: 'Takings are down this week',
      detail: `The last 7 days took ${Math.round((1 - takingsWeek / usualTakings) * 100)}% less than an average week over the month before.`,
      managersOnly: true,
    })

  const since = addDays(today, -180)
  for (const visit of s.appointments
    .filter((a) => a.status === 'confirmed' && (a.date === today || a.date === tomorrow))
    .sort((a, b) => a.date.localeCompare(b.date) || a.startMinutes - b.startMinutes)) {
    const missed = s.appointments.filter(
      (a) => a.clientId === visit.clientId && a.status === 'no_show' && a.date >= since,
    ).length
    if (missed < 2 || notices.some((n) => n.clientId === visit.clientId)) continue
    const name = s.clients.find((c) => c.id === visit.clientId)?.name ?? 'A client'
    notices.push({
      id: `missed-${visit.id}`,
      kind: 'missed-visits',
      title: `${name} has missed ${missed} visits`,
      detail: `Booked ${visit.date === today ? 'today' : 'tomorrow'}. A reminder call or a deposit may help.`,
      managersOnly: false,
      clientId: visit.clientId,
      appointmentId: visit.id,
    })
  }

  const low = operations(s).products.filter((p) => !p.archived && stock(s, p.id) <= p.reorderAt)
  if (low.length)
    notices.push({
      id: `stock-${today}`,
      kind: 'low-stock',
      title:
        low.length === 1
          ? `${low[0].name} is running low`
          : `${low.length} products are running low`,
      detail: 'At or below the level where you reorder.',
      managersOnly: true,
    })
  return notices
}

export type Drifter = {
  clientId: string
  name: string
  lastVisit: string
  weeksSince: number
  /** Their own usual gap, in weeks, when they have enough visits to tell. */
  usualWeeks: number | null
  visits: number
  spendMinor: number
  staffId: string
  serviceId: string
  marketingConsent: boolean
  /** How far past the point of being missed: 1 is just past it, 2 is twice as long. */
  overdue: number
}

const mostCommon = (ids: string[]) =>
  [...ids.reduce((m, id) => m.set(id, (m.get(id) ?? 0) + 1), new Map<string, number>())].sort(
    (a, b) => b[1] - a[1],
  )[0]?.[0]

/**
 * Days without a visit after which a client with nothing booked counts as drifting away: half as
 * long again as their usual gap (and at least two weeks more), or five weeks when there are too
 * few visits to tell. The client page's "At a glance" uses the same rule (clientInsight.ts).
 */
export function driftDays(usual: number | null) {
  return usual ? Math.max(usual * 7 * 1.5, usual * 7 + 14) : 35
}

/**
 * Clients who have gone longer than their own usual gap without booking. A client who comes
 * every three weeks is noticed sooner than one who comes every ten; when there are too few visits
 * to tell, five weeks without a booking counts.
 */
export function drifting(s: BusinessState, today: string): Drifter[] {
  return s.clients
    .map((client) => {
      const visits = s.appointments.filter(
        (a) => a.clientId === client.id && a.status === 'completed' && a.date <= today,
      )
      const booked = s.appointments.some(
        (a) =>
          a.clientId === client.id &&
          (a.status === 'arrived' || (a.status === 'confirmed' && a.date >= today)),
      )
      if (!visits.length || booked) return null
      const weeks = usualWeeks(visits.map((a) => a.date))
      const last = visits
        .map((a) => a.date)
        .sort()
        .at(-1)!
      const days = (Date.parse(today) - Date.parse(last)) / DAY
      const threshold = driftDays(weeks)
      if (days < threshold) return null
      // Stage 6: nobody past their keeping period, or whose details are gone, is asked back.
      if (pastKeepingPeriod(s, client.id, today)) return null
      const recent = [...visits].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5)
      return {
        clientId: client.id,
        name: client.name,
        lastVisit: last,
        weeksSince: Math.floor(days / 7),
        usualWeeks: weeks,
        visits: visits.length,
        spendMinor: clientStats(s, client.id).spend,
        staffId: mostCommon(recent.map((a) => a.staffId))!,
        serviceId: mostCommon(recent.map((a) => a.serviceId))!,
        marketingConsent: client.marketingConsent,
        overdue: days / threshold,
      }
    })
    .filter((d) => d !== null)
    .sort((a, b) => b.overdue - a.overdue || b.spendMinor - a.spendMinor)
}

export type GapSuggestion = {
  clientId: string
  name: string
  staffId: string
  serviceId: string
  date: string
  startMinutes: number
  marketingConsent: boolean
}

/**
 * Open times today and tomorrow matched with drifting regulars, with the person and treatment
 * they usually have. A suggestion only opens a booking for the desk to review.
 */
export function gapSuggestions(
  s: BusinessState,
  today: string,
  now?: string,
  limit = 3,
): GapSuggestion[] {
  const suggestions: GapSuggestion[] = []
  const taken: { staffId: string; date: string; from: number; to: number }[] = []
  const active = (id: string, kind: 'staff' | 'services') =>
    s[kind].some((item) => item.id === id && !item.archived)
  for (const drifter of drifting(s, today)) {
    if (suggestions.length >= limit) break
    if (!active(drifter.staffId, 'staff') || !active(drifter.serviceId, 'services')) continue
    const length =
      s.services.find((service) => service.id === drifter.serviceId)?.durationMinutes ?? 60
    for (const date of [today, addDays(today, 1)]) {
      // Never offer two clients the same person at overlapping times.
      const open = slots(s, drifter.serviceId, drifter.staffId, date, now).filter(
        (start) =>
          !taken.some(
            (t) =>
              t.staffId === drifter.staffId &&
              t.date === date &&
              start < t.to &&
              start + length > t.from,
          ),
      )
      if (!open.length) continue
      taken.push({ staffId: drifter.staffId, date, from: open[0], to: open[0] + length })
      suggestions.push({
        clientId: drifter.clientId,
        name: drifter.name,
        staffId: drifter.staffId,
        serviceId: drifter.serviceId,
        date,
        startMinutes: open[0],
        marketingConsent: drifter.marketingConsent,
      })
      break
    }
  }
  return suggestions
}

/**
 * A short invitation for a gap suggestion, for the desk to read and approve. It is saved as an
 * unsent draft; only someone sending it from the Inbox can send it.
 */
export function gapInvitation(
  s: BusinessState,
  offer: GapSuggestion,
  today: string,
  timeLabel: (minutes: number) => string,
) {
  const first = offer.name.split(' ')[0]
  const person = s.staff.find((p) => p.id === offer.staffId)?.name.split(' ')[0] ?? 'We'
  const service = s.services.find((x) => x.id === offer.serviceId)?.name ?? 'a visit'
  const when = `${offer.date === today ? 'today' : 'tomorrow'} at ${timeLabel(offer.startMinutes)}`
  return {
    subject: `A time for you ${offer.date === today ? 'today' : 'tomorrow'}, ${first}`,
    body: `Hello ${first}, it has been a little while. ${person} has ${when} free for your ${service}. If you would like it, reply to this message and we will book you in.`,
  }
}

export type DayRecap = {
  date: string
  completed: number
  takingsMinor: number
  /** Takings on the same weekday over the previous four weeks, when there is enough history. */
  usualTakingsMinor: number | null
  rebooked: number
  /** Guests seen today with nothing booked next, and whether they agreed to marketing. */
  notRebooked: { clientId: string; name: string; marketingConsent: boolean }[]
  cancelled: number
  missed: number
  tomorrow: {
    date: string
    visits: number
    firstStart: number | null
    firstVisitClient: string | null
    /** The longest open stretch per professional of 90 minutes or more. */
    gaps: { staffId: string; name: string; startMinutes: number; minutes: number }[]
  }
}

/** Closing the day: what was taken against usual, rebooking, and a first look at tomorrow. */
export function dayRecap(s: BusinessState, date: string): DayRecap {
  const renting = rentingAround(s, date)
  const done = s.appointments.filter(
    (a) => a.date === date && a.status === 'completed' && !renting.has(a.staffId),
  )
  const rebookedIds = new Set(
    s.appointments.filter((a) => a.rebookedFromId && live(a)).map((a) => a.rebookedFromId!),
  )
  const hasNext = (clientId: string) =>
    s.appointments.some((a) => a.clientId === clientId && a.date > date && live(a))
  const notRebooked = [...new Set(done.map((a) => a.clientId))]
    .filter((id) => !hasNext(id))
    .map((id) => {
      const c = s.clients.find((x) => x.id === id)
      return { clientId: id, name: c?.name ?? 'A guest', marketingConsent: !!c?.marketingConsent }
    })
  const tomorrow = addDays(date, 1)
  const next = dayAppointments(s, tomorrow).filter(live)
  const firstOf = [...next].sort((a, b) => a.startMinutes - b.startMinutes)[0]
  const firstVisitClient =
    firstOf && clientStats(s, firstOf.clientId).visits === 0
      ? (s.clients.find((c) => c.id === firstOf.clientId)?.name ?? null)
      : null
  const gaps = s.staff
    .filter((p) => !p.archived)
    .flatMap((p) => {
      const own = next
        .filter((a) => a.staffId === p.id)
        .sort((a, b) => a.startMinutes - b.startMinutes)
      if (own.length < 2) return []
      let best = { startMinutes: 0, minutes: 0 }
      for (let i = 1; i < own.length; i++) {
        const prev = own[i - 1]
        const end = prev.startMinutes + prev.bookedDurationMinutes + prev.bookedBufferMinutes
        const gap = own[i].startMinutes - end
        if (gap > best.minutes) best = { startMinutes: end, minutes: gap }
      }
      return best.minutes >= 90 ? [{ staffId: p.id, name: p.name, ...best }] : []
    })
  return {
    date,
    completed: done.length,
    takingsMinor: takingsBetween(s, date, date, renting),
    usualTakingsMinor: usual(sameWeekdays(s, date).map((d) => takingsBetween(s, d, d, renting))),
    rebooked: done.filter((a) => rebookedIds.has(a.id)).length,
    notRebooked,
    cancelled: s.appointments.filter((a) => a.date === date && a.status === 'cancelled').length,
    missed: s.appointments.filter((a) => a.date === date && a.status === 'no_show').length,
    tomorrow: {
      date: tomorrow,
      visits: next.length,
      firstStart: firstOf?.startMinutes ?? null,
      firstVisitClient,
      gaps,
    },
  }
}

export type WeekDay = {
  date: string
  visits: number
  takingsMinor: number
  cancelled: number
  missed: number
  usualVisits: number | null
  usualCancelled: number | null
}
export type WeekReview = {
  from: string
  to: string
  visits: number
  takingsMinor: number
  /** The four weeks before, averaged, when there is enough history. */
  usualVisits: number | null
  usualTakingsMinor: number | null
  days: WeekDay[]
  /** The day furthest below its usual, with what the record shows about why. */
  quietest: (WeekDay & { reasons: string[] }) | null
  ideas: string[]
}

/** The last seven days against the four weeks before, with the reasons a quiet day shows. */
export function weekReview(s: BusinessState, today: string): WeekReview {
  const from = addDays(today, -6)
  const renting = rentingAround(s, today)
  const visitsOn = (d: string) =>
    s.appointments.filter(
      (a) => a.date === d && a.status === 'completed' && !renting.has(a.staffId),
    ).length
  const count = (d: string, status: Appointment['status']) =>
    s.appointments.filter((a) => a.date === d && a.status === status).length
  const open = (d: string) => availableMinutes(s, d) > 0
  const days: WeekDay[] = Array.from({ length: 7 }, (_, i) => addDays(from, i))
    .filter(open)
    .map((date) => {
      const before = sameWeekdays(s, date)
      return {
        date,
        visits: visitsOn(date),
        takingsMinor: takingsBetween(s, date, date, renting),
        cancelled: count(date, 'cancelled'),
        missed: count(date, 'no_show'),
        usualVisits: usual(before.map(visitsOn)),
        usualCancelled:
          before.length >= 2
            ? before.map((d) => count(d, 'cancelled')).reduce((a, b) => a + b, 0) / before.length
            : null,
      }
    })
  const weeks = [1, 2, 3, 4].map((w) => addDays(from, -7 * w))
  const weekTotal = (start: string, f: (d: string) => number) =>
    Array.from({ length: 7 }, (_, i) => f(addDays(start, i))).reduce((a, b) => a + b, 0)
  const usualVisits = usual(weeks.map((w) => weekTotal(w, visitsOn)))
  const usualTakingsMinor = usual(weeks.map((w) => takingsBetween(s, w, addDays(w, 6), renting)))
  const below = days
    .filter((d) => d.usualVisits !== null && d.visits < d.usualVisits * 0.75)
    .sort((a, b) => a.visits / a.usualVisits! - b.visits / b.usualVisits!)[0]
  let quietest: WeekReview['quietest'] = null
  const ideas: string[] = []
  if (below) {
    const reasons: string[] = []
    const weekday = new Intl.DateTimeFormat('en-GB', { weekday: 'long', timeZone: 'UTC' }).format(
      new Date(`${below.date}T12:00:00Z`),
    )
    if (below.usualCancelled !== null && below.cancelled >= Math.max(2, below.usualCancelled * 2)) {
      reasons.push(
        `${below.cancelled} cancellations, against about ${Math.round(below.usualCancelled)} usually`,
      )
      ideas.push(
        `Offer ${weekday} cancellations to the waitlist, and consider reminders two days ahead.`,
      )
    }
    if (below.missed >= 2) reasons.push(`${below.missed} missed visits`)
    const booked = s.appointments.filter((a) => a.date === below.date).length
    if (!reasons.length && booked < (below.usualVisits ?? 0))
      reasons.push('fewer bookings were made for it than usual')
    if (!reasons.length) reasons.push('nothing in the record explains it')
    if (booked < (below.usualVisits ?? 0))
      ideas.push(`Open ${weekday} times to drifting clients a few days ahead.`)
    quietest = { ...below, reasons }
  }
  return {
    from,
    to: today,
    visits: days.reduce((sum, d) => sum + d.visits, 0),
    takingsMinor: takingsBetween(s, from, today, renting),
    usualVisits,
    usualTakingsMinor,
    days,
    quietest,
    ideas,
  }
}
