import type { Appointment, BusinessState, Sale } from './model'
import { businessDate } from './operations'
import { offeredAt, staffLocationOn } from './locations'
import { addDays, money, timeLabel } from './format'
import { dayAppointments, report, staffDay } from './selectors'
import type { DaySegment } from './selectors'

/**
 * Stage 6: the small signature moments. Each one is worked out here from the record alone, so
 * what a screen celebrates is always true: "recorded", "queued", "sent" and "charged" are
 * different words, and nothing here changes the record.
 */

/** The booking grid, in minutes. A visit starts on a quarter hour. */
const GRID = 15
/** The shortest gap between two visits that reads as a pause rather than a turnaround. */
export const PAUSE_MINUTES = 15

/* ------------------------------------------------------------------ Settled. at checkout */

/**
 * The words under "Settled." once a visit's receipt is recorded. Money recorded by hand reads as
 * recorded, never as charged or paid; only a payment the provider confirmed may say "Paid by
 * card"; a test card and a sample studio say no money moved.
 */
export function settledLine(
  sale: Pick<
    Sale,
    'method' | 'processor' | 'balanceMinor' | 'coveredMinor' | 'giftCardMinor' | 'currency'
  >,
  context: {
    sandbox: boolean
    /** The package or membership that covered the visit, when one did. */
    planName?: string
    organisation: Pick<BusinessState['organisation'], 'locale' | 'currency'>
  },
): string {
  if (context.sandbox) return 'A sample studio, so this checkout is a demo. No money moved.'
  const plan = context.planName ?? 'their plan'
  const gift = sale.giftCardMinor ?? 0
  const covered = sale.coveredMinor !== undefined
  // Nothing was left to collect: the plan or the gift card took care of it.
  if (!sale.balanceMinor) {
    if (gift && covered) return `Covered by ${plan} and a gift card. Nothing left to collect.`
    if (gift) return 'Paid from a gift card. Nothing left to collect.'
    if (covered) return `Covered by ${plan}. Nothing left to collect.`
    return 'Nothing was left to collect at checkout.'
  }
  const how = (() => {
    switch (sale.method) {
      case 'cash':
        return 'Recorded as paid by cash.'
      case 'external_card':
        return 'Recorded as paid by card terminal.'
      case 'card':
        return sale.processor?.live
          ? 'Paid by card. The payment provider confirmed it.'
          : 'A test card payment. No money moved.'
      case 'previous_system':
        return 'Recorded as paid on the previous booking system.'
      default:
        return 'A demo payment. No money moved.'
    }
  })()
  const parts = [
    covered ? `${plan} covered the treatment` : '',
    gift ? `${money(gift, context.organisation, true)} came from a gift card` : '',
  ].filter(Boolean)
  return parts.length ? `${how} ${capital(parts.join(' and '))}.` : how
}

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

/* ------------------------------------------------------------------ Fully booked */

/**
 * The shortest stretch, in minutes with its turnaround, that this person could take a guest for
 * at this location: their shortest treatment on its menu there. Null when they do none.
 */
export function shortestTreatment(s: BusinessState, staffId: string, locationId: string) {
  const person = s.staff.find((p) => p.id === staffId)
  if (!person) return null
  const lengths = s.services
    .filter((x) => person.serviceIds.includes(x.id) && !x.archived && offeredAt(x, locationId))
    .map((x) => x.durationMinutes + x.bufferMinutes)
  return lengths.length ? Math.min(...lengths) : null
}

/** Whether a free stretch can still start a treatment of this length on the booking grid. */
function fits(segment: { from: number; to: number }, length: number) {
  const start = Math.ceil(segment.from / GRID) * GRID
  return segment.to - start >= length
}

/**
 * "Fully booked. Beautifully done." Only for today or a day to come, with visits booked and people
 * working, and no free stretch left in anyone's working hours long enough for the shortest
 * treatment that person does. With a location (a general manager, or a chosen location), only the
 * visits and people there count. A whole day counts, so time left empty this morning is not
 * forgotten by the afternoon.
 */
export function fullyBooked(
  s: BusinessState,
  date: string,
  options: { today?: string; locationId?: string } = {},
) {
  const today = options.today ?? businessDate(s)
  if (date < today) return false
  const here = options.locationId
  const visits = dayAppointments(s, date).filter((a) => !here || a.locationId === here)
  if (!visits.length) return false
  let working = 0
  for (const person of s.staff) {
    if (person.archived) continue
    const place = staffLocationOn(s, person.id, date)
    if (here && place !== here) continue
    const day = staffDay(s, person.id, date)
    if (!day.working) continue
    const shortest = shortestTreatment(s, person.id, place)
    if (shortest === null) continue
    working += 1
    if (day.segments.some((segment) => segment.kind === 'free' && fits(segment, shortest)))
      return false
  }
  return working > 0
}

export const FULLY_BOOKED_LINE = 'Fully booked. Beautifully done.'

/* ------------------------------------------------------------------ A pause */

/**
 * The free stretches in one person's day that sit between two of their visits, by where each
 * starts. Free time before the first visit, after the last, or beside a closure is ordinary free
 * time, not a pause.
 */
export function pauses(segments: readonly DaySegment[]) {
  const found = new Set<number>()
  segments.forEach((segment, i) => {
    if (segment.kind !== 'free' || segment.to - segment.from < PAUSE_MINUTES) return
    if (segments[i - 1]?.kind === 'visit' && segments[i + 1]?.kind === 'visit')
      found.add(segment.from)
  })
  return found
}

/**
 * The pauses between one person's own visits on a day, for a list rather than a grid: after
 * which visit each falls, and how long it is. Cancelled and missed visits leave their time free.
 */
export function visitPauses<
  V extends {
    id: string
    startMinutes: number
    durationMinutes: number
    bufferMinutes: number
    status: Appointment['status']
  },
>(visits: readonly V[]) {
  const live = visits
    .filter((v) => v.status !== 'cancelled' && v.status !== 'no_show')
    .sort((a, b) => a.startMinutes - b.startMinutes)
  const found: { afterId: string; from: number; to: number }[] = []
  let through = -1
  live.forEach((v, i) => {
    const end = v.startMinutes + v.durationMinutes + v.bufferMinutes
    through = Math.max(through, end)
    const next = live[i + 1]
    if (next && next.startMinutes - through >= PAUSE_MINUTES)
      found.push({ afterId: v.id, from: through, to: next.startMinutes })
  })
  return found
}

/* ------------------------------------------------------------------ All in hand */

/**
 * "All in hand": nothing waits in Needs you, and everyone due so far today has been welcomed or
 * checked out. A guest whose time has come but who has not been welcomed (late, or waiting at the
 * desk after tapping "I've arrived") keeps it away, and so does any call, patch test or reminder.
 * It is earned: at least one guest must have been due already.
 */
export function allInHand(input: {
  /** Calls to return, patch tests to sort and reminders due, added together. */
  waiting: number
  /** Today's visits at this location. */
  visits: readonly Pick<Appointment, 'startMinutes' | 'status' | 'guestHereAt'>[]
  /** The studio's clock, in minutes past midnight. */
  nowMinutes: number
}) {
  if (input.waiting > 0) return false
  const live = input.visits.filter((a) => a.status !== 'cancelled' && a.status !== 'no_show')
  // Someone already told the desk they are here, and is waiting to be welcomed.
  if (live.some((a) => a.status === 'confirmed' && a.guestHereAt)) return false
  const due = live.filter((a) => a.startMinutes <= input.nowMinutes)
  return due.length > 0 && due.every((a) => a.status === 'arrived' || a.status === 'completed')
}

/* ------------------------------------------------------------------ The closing ledger */

/**
 * The end of the day as a printed ledger, once every visit today is checked out: guests seen,
 * first-time guests, rebooked, treatment takings and tips recorded (the Business page's own rules:
 * money recorded by hand is "recorded", renters' own takings are left out), products, and one
 * human note from the records. Before then, only what is still open.
 */
export function closingLedger(whole: BusinessState, locationId?: string) {
  const today = businessDate(whole)
  const tomorrow = addDays(today, 1)
  const live = (a: Appointment) => a.status !== 'cancelled' && a.status !== 'no_show'
  const here = (a: Appointment) => !locationId || a.locationId === locationId
  const todays = whole.appointments.filter((a) => a.date === today && live(a) && here(a))
  const done = todays.filter((a) => a.status === 'completed')
  const settled = todays.length > 0 && done.length === todays.length
  const firstOf = whole.appointments
    .filter((a) => a.date === tomorrow && live(a) && here(a))
    .sort((a, b) => a.startMinutes - b.startMinutes)[0]
  const nameOf = (clientId: string) =>
    whole.clients.find((c) => c.id === clientId)?.name.split(' ')[0] ?? 'A guest'
  const locale = whole.organisation.locale
  const tomorrowLine = firstOf
    ? `Tomorrow starts with ${nameOf(firstOf.clientId)} at ${timeLabel(firstOf.startMinutes, locale)}.`
    : 'Nothing is booked for tomorrow yet.'
  const base = {
    settled,
    total: todays.length,
    open: todays.length - done.length,
    tomorrowLine,
  }
  if (!settled) return { ...base, ledger: null }

  const guests = [...new Set(done.map((a) => a.clientId))]
  const firstTime = guests.filter(
    (id) =>
      !whole.appointments.some(
        (a) => a.clientId === id && a.status === 'completed' && a.date < today,
      ),
  ).length
  const rebooked = done.filter((a) =>
    whole.appointments.some((next) => next.rebookedFromId === a.id && live(next)),
  ).length
  const figures = report(whole, 1, locationId)
  // One human note: a birthday tomorrow first, then who the studio sees first tomorrow.
  const birthday = tomorrow.slice(5)
  const isBirthday = (clientId: string) =>
    whole.clients.find((c) => c.id === clientId)?.birthday === birthday
  const bookedBirthday = whole.appointments
    .filter((a) => a.date === tomorrow && live(a) && here(a) && isBirthday(a.clientId))
    .sort((a, b) => a.startMinutes - b.startMinutes)[0]
  const seenBirthday = guests.find(isBirthday)
  const note = bookedBirthday
    ? `${nameOf(bookedBirthday.clientId)} comes in tomorrow at ${timeLabel(bookedBirthday.startMinutes, locale)}, on their birthday.`
    : seenBirthday
      ? `${nameOf(seenBirthday)}, seen today, has a birthday tomorrow.`
      : tomorrowLine
  return {
    ...base,
    ledger: {
      guestsSeen: guests.length,
      firstTime,
      rebooked,
      visits: done.length,
      takingsMinor: figures.revenue,
      tipsMinor: figures.tips,
      productsMinor: figures.retail,
      /** Renters' own takings today, kept out of the figures above. */
      rentersMinor: figures.renters,
      note,
    },
  }
}

export const CLOSING_LINE = 'Studio closed. See you tomorrow.'

/** The figures of a settled day, as `closingLedger` reads them. */
export type ClosingFigures = NonNullable<ReturnType<typeof closingLedger>['ledger']>
