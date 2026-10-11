import type { BusinessState } from './model'
import { addDays, money } from './format'
import { businessDate, operations } from './operations'
import { recordDay } from './tillCount'
import { staffLocationOn } from './locations'
import { retailRevenue } from './retail'
import { rentalOn, serviceRevenue } from './takings'
import type { Rental, RentPayment } from './rentSchema'

export { rentalOn } from './takings'

/**
 * V2: chair and room rental. A self-employed stylist or therapist pays the studio rent for a chair
 * or room each week or month and keeps their own takings. SALEANE works out what is due and
 * records what was paid; it does not collect the money.
 *
 * Stage 3: rent can also be a share of the renter's own takings on the days they rent, or a fixed
 * amount plus a share. Their takings are their treatments, after any discount and without tax,
 * and their products too when the rental says the products they sell are theirs; money given back
 * on their receipts comes off in the period it is given back. Tips never count. The share is
 * worked out on each period's takings and rounded once, to the penny, and never goes below
 * nothing. The fixed part is due at the start of each period; the share once the period has
 * ended, and while it runs it shows what is due so far.
 */
export const RENT_METHOD_LABEL: Record<RentPayment['method'], string> = {
  cash: 'Cash',
  bank_transfer: 'Bank transfer',
  external_card: 'Own card terminal',
}

/** The same day a number of months later, kept within shorter months (31 January, 28 February). */
export function addMonths(date: string, months: number, day = Number(date.slice(8, 10))) {
  const [y, m] = date.split('-').map(Number)
  const index = y * 12 + (m - 1) + months
  const year = Math.floor(index / 12)
  const month = (index % 12) + 1
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return `${year}-${String(month).padStart(2, '0')}-${String(Math.min(day, last)).padStart(2, '0')}`
}

/** Whether a day is the start of one of a rental's periods. */
export function isPeriodStart(rental: Rental, date: string) {
  if (date < rental.from || (rental.to && date > rental.to)) return false
  if (rental.every === 'week') {
    const days = Math.round(
      (Date.parse(`${date}T12:00:00Z`) - Date.parse(`${rental.from}T12:00:00Z`)) / 86400000,
    )
    return days % 7 === 0
  }
  const months =
    (Number(date.slice(0, 4)) - Number(rental.from.slice(0, 4))) * 12 +
    Number(date.slice(5, 7)) -
    Number(rental.from.slice(5, 7))
  return addMonths(rental.from, months, Number(rental.from.slice(8, 10))) === date
}

/** Every rent period that has started by `until`, oldest first. */
export function rentPeriods(rental: Rental, until: string) {
  const end = rental.to && rental.to < until ? rental.to : until
  const periods: { start: string; end: string }[] = []
  const day = Number(rental.from.slice(8, 10))
  for (let i = 0; periods.length < 400; i++) {
    const start =
      rental.every === 'week' ? addDays(rental.from, 7 * i) : addMonths(rental.from, i, day)
    if (start > end) break
    const next =
      rental.every === 'week'
        ? addDays(rental.from, 7 * (i + 1))
        : addMonths(rental.from, i + 1, day)
    periods.push({ start, end: addDays(next, -1) })
  }
  return periods
}

export type RenterTakings = {
  /** Completed visits on the rental's days in the range. */
  visits: number
  treatmentsMinor: number
  /** Products they sold, only when the rental says the products they sell are theirs. */
  productsMinor: number
  /** Money given back in the range on their own receipts, as a positive amount. */
  givenBackMinor: number
  /** What the share is worked out on: their takings less money given back, never below nothing. */
  baseMinor: number
}

/** A renter's own takings on the days of one rental, between two days, both included. */
export function renterTakings(
  s: BusinessState,
  rental: Rental,
  from: string,
  to: string,
): RenterTakings {
  const theirs = (date: string) =>
    date >= rental.from &&
    (!rental.to || date <= rental.to) &&
    rentalOn(s, rental.staffId, date)?.id === rental.id
  const inRange = (date: string) => date >= from && date <= to
  const visits = new Map(
    s.appointments
      .filter(
        (a) =>
          a.staffId === rental.staffId &&
          a.status === 'completed' &&
          inRange(a.date) &&
          theirs(a.date),
      )
      .map((a) => [a.id, a]),
  )
  let treatmentsMinor = 0
  let productsMinor = 0
  let count = 0
  for (const sale of s.sales) {
    if (!visits.has(sale.appointmentId)) continue
    count += 1
    treatmentsMinor += serviceRevenue(sale)
    if (rental.products) productsMinor += retailRevenue(sale)
  }
  if (rental.products)
    for (const sale of s.counterSales ?? []) {
      const day = recordDay(s, sale.paidAt)
      if (sale.staffId === rental.staffId && inRange(day) && theirs(day))
        productsMinor += retailRevenue(sale)
    }
  // Money given back in the range on any of their receipts from this rental, in proportion to
  // what the receipt was for; tips and the studio's own products are left out.
  let givenBackMinor = 0
  for (const refund of operations(s).refunds) {
    if (!inRange(recordDay(s, refund.createdAt))) continue
    if (refund.saleId) {
      const sale = s.sales.find((x) => x.id === refund.saleId)
      const visit = sale && s.appointments.find((a) => a.id === sale.appointmentId)
      if (!sale || !visit || visit.staffId !== rental.staffId || !theirs(visit.date)) continue
      if (sale.totalMinor <= 0) continue
      const own = serviceRevenue(sale) + (rental.products ? retailRevenue(sale) : 0)
      givenBackMinor += Math.round((refund.amountMinor * own) / sale.totalMinor)
    } else if (refund.counterSaleId && rental.products) {
      const sale = (s.counterSales ?? []).find((x) => x.id === refund.counterSaleId)
      if (!sale || sale.staffId !== rental.staffId || !theirs(recordDay(s, sale.paidAt))) continue
      if (sale.totalMinor <= 0) continue
      givenBackMinor += Math.round((refund.amountMinor * retailRevenue(sale)) / sale.totalMinor)
    }
  }
  return {
    visits: count,
    treatmentsMinor,
    productsMinor,
    givenBackMinor,
    baseMinor: Math.max(0, treatmentsMinor + productsMinor - givenBackMinor),
  }
}

/** A share of an amount in basis points, rounded to the penny (half up). */
const shareOf = (amountMinor: number, bps: number) => Math.floor((amountMinor * bps + 5000) / 10000)

export type RentPeriod = {
  start: string
  end: string
  /** The period has not finished yet, so its share is what is due so far. */
  open: boolean
  fixedMinor: number
  /** The renter's takings the share is worked out on, when the rent has a share. */
  takings: RenterTakings | null
  shareMinor: number
  /** The fixed part and the share so far. */
  dueMinor: number
  paidMinor: number
  /** Owed now: everything still unpaid once a period has ended; the fixed part while it runs. */
  owedMinor: number
  /** While a period runs: its share of takings so far, still unpaid, due once it ends. */
  runningMinor: number
  /** Paid beyond what is now due, when money given back later lowered the share. */
  overMinor: number
}

/** What one period of a rental is due: the fixed part and the share of takings so far. */
export function periodDue(
  s: BusinessState,
  rental: Rental,
  period: { start: string; end: string },
  until: string,
) {
  const last = [period.end, until, rental.to ?? period.end].sort()[0]
  const takings = rental.percentBps ? renterTakings(s, rental, period.start, last) : null
  const shareMinor = takings ? shareOf(takings.baseMinor, rental.percentBps!) : 0
  return {
    open: period.end > until,
    fixedMinor: rental.amountMinor,
    takings,
    shareMinor,
    dueMinor: rental.amountMinor + shareMinor,
  }
}

/** What each period was due, what was paid against it and what is still owed. */
export function rentStatement(s: BusinessState, rental: Rental, until = businessDate(s)) {
  const payments = (operations(s).rentPayments ?? []).filter((p) => p.rentalId === rental.id)
  return rentPeriods(rental, until).map((period): RentPeriod => {
    const paidMinor = payments
      .filter((p) => p.periodStart === period.start)
      .reduce((sum, p) => sum + p.amountMinor, 0)
    const due = periodDue(s, rental, period, until)
    const unpaid = Math.max(0, due.dueMinor - paidMinor)
    const owedMinor = due.open ? Math.min(unpaid, Math.max(0, due.fixedMinor - paidMinor)) : unpaid
    return {
      ...period,
      ...due,
      paidMinor,
      owedMinor,
      runningMinor: unpaid - owedMinor,
      overMinor: Math.max(0, paidMinor - due.dueMinor),
    }
  })
}

/** The terms in words: "£50.00 a week plus 10% of treatments". */
export function rentTerms(
  s: BusinessState,
  rental: Pick<Rental, 'amountMinor' | 'percentBps' | 'products' | 'every'>,
) {
  const pct = rental.percentBps
    ? `${(rental.percentBps / 100).toLocaleString('en-GB', { maximumFractionDigits: 2 })}% of ${
        rental.products ? 'treatments and products' : 'treatments'
      }`
    : ''
  if (!rental.amountMinor && !pct) return 'Terms kept with the owner'
  if (!rental.amountMinor) return `${pct}, worked out each ${rental.every}`
  const fixed = `${money(rental.amountMinor, s.organisation, true)} a ${rental.every}`
  return pct ? `${fixed} plus ${pct}` : fixed
}

/** How one period's rent was worked out, in a sentence: "£50.00 plus 10% of £1,805.00 is £230.50." */
export function periodWorking(s: BusinessState, rental: Rental, period: RentPeriod) {
  const org = s.organisation
  const cash = (minor: number) => money(minor, org, true)
  if (!period.takings) return `${cash(period.fixedMinor)} fixed.`
  const pct = `${(rental.percentBps! / 100).toLocaleString('en-GB', { maximumFractionDigits: 2 })}%`
  const t = period.takings
  const back = t.givenBackMinor ? `, less ${cash(t.givenBackMinor)} given back` : ''
  const what = rental.products
    ? `${cash(t.treatmentsMinor)} in treatments and ${cash(t.productsMinor)} in products${back}`
    : `${cash(t.treatmentsMinor)} in treatments${back}`
  const share = `${pct} of ${what} is ${cash(period.shareMinor)}`
  const so = period.open ? ' so far' : ''
  return period.fixedMinor
    ? `${cash(period.fixedMinor)} fixed plus ${share}: ${cash(period.dueMinor)}${so}.`
    : `${share.charAt(0).toUpperCase()}${share.slice(1)}${so}.`
}

/** Where a rental is: the chair or room's location, otherwise where the renter works. */
export function rentalPlace(s: BusinessState, rental: Rental) {
  const resource = rental.resourceId && s.resources.find((r) => r.id === rental.resourceId)
  return resource
    ? (resource.locationId ?? s.organisation.locationId)
    : staffLocationOn(s, rental.staffId, rental.from)
}

/** Rent recorded as paid in a date range, by the studio's own day it was paid. */
export function rentReceived(
  s: BusinessState,
  from: string,
  to: string,
  only?: (rental: Rental) => boolean,
) {
  const rentals = operations(s).rentals ?? []
  return (operations(s).rentPayments ?? [])
    .filter((p) => {
      const day = recordDay(s, p.paidAt)
      const rental = rentals.find((r) => r.id === p.rentalId)
      return day >= from && day <= to && (!only || (rental && only(rental)))
    })
    .reduce((sum, p) => sum + p.amountMinor, 0)
}

/** Rent still owed today across every rental. */
export function rentOwed(s: BusinessState, until = businessDate(s)) {
  return (operations(s).rentals ?? []).reduce(
    (sum, rental) =>
      sum + rentStatement(s, rental, until).reduce((owed, p) => owed + p.owedMinor, 0),
    0,
  )
}

/** Checks rentals and their payments; returns a problem or null. */
export function rentProblem(s: BusinessState): string | null {
  const o = operations(s)
  const rentals = o.rentals ?? []
  for (const rental of rentals) {
    if (!s.staff.some((p) => p.id === rental.staffId))
      return 'A rental names someone not on the team.'
    if (rental.resourceId && !s.resources.some((r) => r.id === rental.resourceId))
      return 'A rental names a missing chair or room.'
    if (rental.to && rental.to < rental.from) return 'A rental ends before it starts.'
  }
  for (const rental of rentals)
    if (
      rentals.some(
        (other) =>
          other.id !== rental.id &&
          other.staffId === rental.staffId &&
          other.from <= (rental.to ?? '9999-12-31') &&
          (other.to ?? '9999-12-31') >= rental.from,
      )
    )
      return 'Two rentals overlap for one person.'
  const paid = new Map<string, number>()
  for (const payment of o.rentPayments ?? []) {
    const rental = rentals.find((r) => r.id === payment.rentalId)
    if (!rental) return 'A rent payment names a missing rental.'
    if (!isPeriodStart(rental, payment.periodStart))
      return 'A rent payment is not for one of its rental periods.'
    const key = `${payment.rentalId}:${payment.periodStart}`
    paid.set(key, (paid.get(key) ?? 0) + payment.amountMinor)
    // A share of takings can fall after it was paid, when money is given back later, so only a
    // fixed rent has a ceiling here; the payment itself was checked against what was due then.
    if (!rental.percentBps && paid.get(key)! > rental.amountMinor)
      return 'More rent was recorded than was due.'
  }
  return null
}
