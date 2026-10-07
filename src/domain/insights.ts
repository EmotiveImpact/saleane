import { slots } from './commands'
import { addDays } from './format'
import type { Appointment, BusinessState } from './model'
import { operations, stock } from './operations'
import {
  availableMinutes,
  clientStats,
  dayAppointments,
  serviceRevenue,
  usualWeeks,
} from './selectors'

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

function takingsBetween(s: BusinessState, from: string, to: string) {
  const visits = new Map(
    s.appointments
      .filter((a) => a.status === 'completed' && a.date >= from && a.date <= to)
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
      takingsMinor: takingsBetween(s, yesterday, yesterday),
      usualTakingsMinor: usual(sameWeekdays(s, yesterday).map((d) => takingsBetween(s, d, d))),
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

  const takingsWeek = takingsBetween(s, weekFrom, today)
  const earlierTakings = [1, 2, 3, 4].map((w) =>
    takingsBetween(s, addDays(weekFrom, -7 * w), addDays(today, -7 * w)),
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
      const threshold = weeks ? Math.max(weeks * 7 * 1.5, weeks * 7 + 14) : 35
      if (days < threshold) return null
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
