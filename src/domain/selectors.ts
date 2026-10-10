import { businessDate, hoursFor, operations, staffHoursFor } from './operations'
import type { Appointment, BusinessState, Client } from './model'
import { addDays } from './format'
import { dueBackOn, lastCompletedVisit } from './dueBack'
import { pastKeepingPeriod } from './retentionDue'
import { retailByProduct, retailRevenue } from './retail'
import { recordDay } from './tillCount'
import { atPlace, staffLocationOn } from './locations'
import { otherTillSales, renterTillPart, tillDay, tillParts } from './otherTill'
import {
  renterCounterSale,
  renterPartOfReceipt,
  renterVisit,
  serviceRevenue,
  studioProducts,
} from './takings'
import { rentalPlace, rentReceived } from './rent'

export function dayAppointments(s: BusinessState, date = businessDate(s)) {
  return s.appointments
    .filter((a) => a.date === date && a.status !== 'cancelled' && a.status !== 'no_show')
    .sort((a, b) => a.startMinutes - b.startMinutes)
}
export function clientStats(s: BusinessState, clientId: string) {
  const visits = s.appointments.filter((a) => a.clientId === clientId && a.status === 'completed')
  const next = s.appointments
    .filter((a) => a.clientId === clientId && a.date >= businessDate(s) && a.status === 'confirmed')
    .sort((a, b) => a.date.localeCompare(b.date) || a.startMinutes - b.startMinutes)[0]
  const last = [...visits].sort((a, b) => b.date.localeCompare(a.date))[0]
  const spend = s.sales
    .filter((sale) => visits.some((a) => a.id === sale.appointmentId))
    .reduce((sum, sale) => sum + serviceRevenue(sale), 0)
  return { visits: visits.length, spend, next, last }
}
export function dueClients(s: BusinessState): Client[] {
  return s.clients.filter((c) => {
    const stats = clientStats(s, c.id)
    // V1.5: a treatment can set its own "usually back after"; otherwise four weeks.
    const last = lastCompletedVisit(s, c.id)
    return (
      last &&
      dueBackOn(s, last) <= businessDate(s) &&
      !stats.next &&
      !s.appointments.some((a) => a.clientId === c.id && a.status === 'arrived') &&
      // Stage 6: nobody past their keeping period, or whose details are gone, is asked back.
      !pastKeepingPeriod(s, c.id, businessDate(s))
    )
  })
}
/**
 * Figures for the last `days` days, for the whole studio or one location (V2).
 *
 * Stage 3: a renter's own takings on the days they rent are theirs, not the studio's, so takings,
 * the average, the days, treatments and people, tips, products and tax leave them out
 * (`takings.ts`); the rent recorded is the studio's income instead. Time booked and rebooking
 * still count every visit, since they are about the diary rather than income.
 */
export function report(whole: BusinessState, days: number, locationId?: string) {
  const s = locationId ? atPlace(whole, locationId) : whole
  const today = businessDate(s)
  const from = addDays(today, 1 - days)
  const appointments = s.appointments.filter(
    (a) => a.date >= from && a.date <= today && a.status !== 'cancelled' && a.status !== 'no_show',
  )
  const completed = appointments.filter((a) => a.status === 'completed')
  const visitOf = new Map(completed.map((a) => [a.id, a]))
  const renterIds = new Set(completed.filter((a) => renterVisit(whole, a)).map((a) => a.id))
  const own = completed.filter((a) => !renterIds.has(a.id))
  const sales = s.sales.filter((sale) => visitOf.has(sale.appointmentId))
  const ownSales = sales.filter((sale) => !renterIds.has(sale.appointmentId))
  const revenue = ownSales.reduce((sum, sale) => sum + serviceRevenue(sale), 0)
  const tips = ownSales.reduce((sum, sale) => sum + sale.tipMinor, 0)
  // V2: products sold with these visits or without one, without tax, kept apart from service revenue.
  const counter = (s.counterSales ?? []).filter((sale) => {
    const day = recordDay(s, sale.paidAt)
    return day >= from && day <= today
  })
  const ownCounter = counter.filter((sale) => !renterCounterSale(whole, sale))
  const retail =
    sales.reduce(
      (sum, sale) => sum + studioProducts(whole, sale, visitOf.get(sale.appointmentId)),
      0,
    ) + ownCounter.reduce((sum, sale) => sum + retailRevenue(sale), 0)
  // A renter's own takings, kept apart: their treatments, and their products when theirs.
  const renters =
    sales.reduce((sum, sale) => {
      const part = renterPartOfReceipt(whole, sale, visitOf.get(sale.appointmentId))
      return sum + part.servicesMinor + part.productsMinor
    }, 0) +
    counter
      .filter((sale) => renterCounterSale(whole, sale))
      .reduce((sum, sale) => sum + retailRevenue(sale), 0)
  // V2: money taken for gift cards, packages and memberships, at the location that sold them.
  const inPeriod = (at: string) => {
    const day = recordDay(s, at)
    return day >= from && day <= today
  }
  const giftCardsSold = (s.giftCards ?? [])
    .filter((card) => inPeriod(card.payment.recordedAt))
    .reduce((sum, card) => sum + card.payment.amountMinor, 0)
  const plansSold = (s.holdings ?? [])
    .flatMap((h) => h.payments)
    .filter((p) => inPeriod(p.recordedAt))
    .reduce((sum, p) => sum + p.amountMinor, 0)
  // Stage 5: the studio's own takings on a chain's other tills, before tax, kept apart from
  // SALEANE's visits. A renter's own lines are theirs; money given back is shown in Money.
  const tillSold = otherTillSales(s).filter((x) => {
    const day = tillDay(s, x)
    return x.kind === 'sale' && day >= from && day <= today
  })
  const otherTill = tillSold.reduce((sum, sale) => {
    const parts = tillParts(sale)
    const theirs = renterTillPart(whole, sale)
    return (
      sum +
      parts.treatmentsMinor +
      parts.productsMinor -
      (theirs ? theirs.servicesMinor + theirs.productsMinor : 0)
    )
  }, 0)
  const tills = [...new Set(tillSold.map((sale) => sale.till.name))]
  const booked = appointments.reduce((sum, a) => sum + a.bookedPriceMinor, 0)
  const minutes = appointments.reduce((sum, a) => sum + a.bookedDurationMinutes, 0)
  const wasRebooked = (a: (typeof completed)[number]) =>
    s.appointments.some(
      (next) =>
        next.rebookedFromId === a.id && next.status !== 'cancelled' && next.status !== 'no_show',
    )
  const rebooked = completed.filter(wasRebooked).length
  const byDay = Array.from({ length: days }, (_, i) => {
    const date = addDays(from, i)
    return {
      date,
      revenue: ownSales
        .filter((sale) => visitOf.get(sale.appointmentId)?.date === date)
        .reduce((sum, sale) => sum + serviceRevenue(sale), 0),
    }
  })
  const byService = s.services.map((service) => ({
    service,
    revenue: ownSales
      .filter((sale) => visitOf.get(sale.appointmentId)?.serviceId === service.id)
      .reduce((sum, sale) => sum + serviceRevenue(sale), 0),
    visits: own.filter((a) => a.serviceId === service.id).length,
  }))
  const byStaff = s.staff.map((staff) => ({
    staff,
    revenue: ownSales
      .filter((sale) => visitOf.get(sale.appointmentId)?.staffId === staff.id)
      .reduce((sum, sale) => sum + serviceRevenue(sale), 0),
    visits: completed.filter((a) => a.staffId === staff.id).length,
    /** Stage 3: visits on days they rented, whose takings are their own. */
    renting: completed.filter((a) => a.staffId === staff.id && renterIds.has(a.id)).length,
    rebooked: completed.filter((a) => a.staffId === staff.id && wasRebooked(a)).length,
  }))
  const capacity = byDay.reduce(
    (sum, day) => sum + availableMinutes(whole, day.date, locationId),
    0,
  )
  const ownSaleIds = new Set(ownSales.map((sale) => sale.id))
  return {
    from,
    revenue,
    tips,
    retail,
    retailByProduct: retailByProduct([...sales, ...counter]),
    giftCardsSold,
    plansSold,
    /** Stage 5: sold on a chain's other tills in the period, before tax, and which tills. */
    otherTill,
    tills,
    booked,
    completed: completed.length,
    /** Stage 3: the studio's own completed visits, which its takings and average come from. */
    ownCompleted: own.length,
    utilisation: capacity ? minutes / capacity : 0,
    tax:
      sales.reduce(
        (sum, sale) =>
          sum +
          (sale.taxMinor ?? 0) +
          (sale.retail?.taxMinor ?? 0) -
          renterPartOfReceipt(whole, sale, visitOf.get(sale.appointmentId)).taxMinor,
        0,
      ) + ownCounter.reduce((sum, sale) => sum + sale.retail.taxMinor, 0),
    refunds: operations(s)
      .refunds.filter((refund) => refund.saleId && ownSaleIds.has(refund.saleId))
      .reduce((sum, refund) => sum + refund.amountMinor, 0),
    rebookRate: completed.length ? rebooked / completed.length : null,
    /** Stage 3: renters' own takings in the period, kept out of every figure above. */
    renters,
    /** Stage 3: rent recorded as paid in the period, which is the studio's income. */
    rent: rentReceived(
      whole,
      from,
      today,
      locationId ? (rental) => rentalPlace(whole, rental) === locationId : undefined,
    ),
    byDay,
    byService,
    byStaff,
  }
}

/** Treatment takings on a receipt: after any discount and without tax included in the price. */
export { serviceRevenue } from './takings'
/** Share of open professional time taken by booked service minutes on one day. */
export function bookedTimeShare(s: BusinessState, date: string, locationId?: string) {
  const capacity = availableMinutes(s, date, locationId)
  const minutes = dayAppointments(s, date)
    .filter((a) => !locationId || a.locationId === locationId)
    .reduce((sum, a) => sum + a.bookedDurationMinutes, 0)
  return capacity ? minutes / capacity : 0
}
/**
 * Open professional minutes on a day. With a location (V2), only the people working there that
 * day, within its hours; otherwise everyone, each within the hours of where they work.
 */
export function availableMinutes(s: BusinessState, date: string, locationId?: string) {
  return s.staff
    .filter((person) => !person.archived)
    .reduce((sum, person) => {
      const place = staffLocationOn(s, person.id, date)
      if (locationId && place !== locationId) return sum
      const h = hoursFor(s, date, place)
      if (!h || h.closed) return sum
      const ph = staffHoursFor(s, person.id, date)
      const start = Math.max(h.open, ph.open),
        end = Math.min(h.close, ph.close)
      if (ph.closed || end <= start) return sum
      const intervals = operations(s)
        .closures.filter(
          (c) =>
            c.date === date &&
            (!c.staffId || c.staffId === person.id) &&
            c.startMinutes < end &&
            c.endMinutes > start,
        )
        .map((c) => [Math.max(start, c.startMinutes), Math.min(end, c.endMinutes)])
        .sort((a, b) => a[0] - b[0])
      let unavailable = 0,
        through = start
      for (const [from, to] of intervals) {
        unavailable += Math.max(0, to - Math.max(from, through))
        through = Math.max(through, to)
      }
      return sum + end - start - unavailable
    }, 0)
}

export type DaySegment =
  | { kind: 'visit'; from: number; to: number; appointment: BusinessState['appointments'][number] }
  | { kind: 'free'; from: number; to: number }
  | { kind: 'closed'; from: number; to: number; reason: string }

/**
 * One professional's working day as an ordered run of visits, closures and
 * free time, so a narrow screen can show who is free without a time grid.
 * A visit's span includes its turnaround. Free gaps shorter than
 * `minimumFree` minutes are left out because nothing can be booked there.
 */
export function staffDay(s: BusinessState, staffId: string, date: string, minimumFree = 15) {
  // The opening hours of where they work that day, which the rota may change (Stage 3).
  const h = hoursFor(s, date, staffLocationOn(s, staffId, date))
  const ph = staffHoursFor(s, staffId, date)
  const visits = dayAppointments(s, date).filter((a) => a.staffId === staffId)
  const start = Math.max(h.open, ph.open)
  const end = Math.min(h.close, ph.close)
  const working = !h.closed && !ph.closed && end > start
  const busy: DaySegment[] = [
    ...visits.map((appointment) => ({
      kind: 'visit' as const,
      from: appointment.startMinutes,
      to:
        appointment.startMinutes +
        appointment.bookedDurationMinutes +
        appointment.bookedBufferMinutes,
      appointment,
    })),
    ...operations(s)
      .closures.filter(
        (c) =>
          working &&
          c.date === date &&
          (!c.staffId || c.staffId === staffId) &&
          c.startMinutes < end &&
          c.endMinutes > start,
      )
      .map((c) => ({
        kind: 'closed' as const,
        from: Math.max(start, c.startMinutes),
        to: Math.min(end, c.endMinutes),
        reason: c.reason,
      })),
  ].sort((a, b) => a.from - b.from || a.to - b.to)
  const segments: DaySegment[] = []
  let through = working ? start : Infinity
  for (const segment of busy) {
    if (working && segment.from - through >= minimumFree)
      segments.push({ kind: 'free', from: through, to: segment.from })
    segments.push(segment)
    through = Math.max(through === Infinity ? segment.to : through, segment.to)
  }
  if (working && end - through >= minimumFree)
    segments.push({ kind: 'free', from: through, to: end })
  const freeMinutes = segments
    .filter((segment) => segment.kind === 'free')
    .reduce((sum, segment) => sum + segment.to - segment.from, 0)
  return { working, start, end, segments, visits: visits.length, freeMinutes }
}

/** The client's usual gap between visits, in whole weeks, when there is enough history. */
export function usualWeeks(dates: string[]) {
  const sorted = [...new Set(dates)].sort()
  if (sorted.length < 2) return null
  const gaps = sorted
    .slice(1)
    .map((d, i) => (Date.parse(d) - Date.parse(sorted[i])) / 86_400_000)
    .sort((a, b) => a - b)
  const weeks = Math.round(gaps[Math.floor(gaps.length / 2)] / 7)
  return weeks >= 2 && weeks <= 12 ? weeks : null
}

/** The status to show for a visit: "here" once the guest has tapped "I've arrived" (V1.5). */
export function shownStatus(a: Pick<Appointment, 'status' | 'guestHereAt'>) {
  return a.status === 'confirmed' && a.guestHereAt ? 'here' : a.status
}
