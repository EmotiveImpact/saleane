import type { Appointment, BusinessState, Sale } from './model'
import type { CounterSale } from './retailSchema'
import type { Rental } from './rentSchema'
import { operations } from './operations'
import { retailRevenue } from './retail'
import { recordDay } from './tillCount'

/**
 * Takings: what counts as money the studio earned, and what is a renter's own.
 *
 * A treatment's takings are its price after any discount and without tax included in it; products
 * are counted the same way (`retailRevenue`). Tips are never takings.
 *
 * Stage 3: someone renting a chair or room is self-employed. On the days they rent, their
 * treatments are their own takings, not the studio's, and so are the products they sell when
 * their rental says so (`rental.products`); otherwise products come off the studio's shelf and
 * stay the studio's sales. Money still passes through the studio's till, so receipts and the till
 * count keep every receipt; the studio's figures leave a renter's own takings out and count their
 * rent instead.
 */

/** Treatment takings on a receipt: after any discount and without tax included in the price. */
export function serviceRevenue(sale: BusinessState['sales'][number]) {
  return (
    sale.serviceMinor - (sale.discountMinor ?? 0) - (sale.taxInclusive ? (sale.taxMinor ?? 0) : 0)
  )
}

/** The rental a person is on for a day, if any. */
export function rentalOn(s: BusinessState, staffId: string, date: string): Rental | undefined {
  return (operations(s).rentals ?? []).find(
    (r) => r.staffId === staffId && r.from <= date && (!r.to || r.to >= date),
  )
}

/** The rental that makes a visit a renter's own: the person was renting on the day of the visit. */
export const renterVisit = (s: BusinessState, visit: Pick<Appointment, 'staffId' | 'date'>) =>
  rentalOn(s, visit.staffId, visit.date)

/** A walk-in sale whose products are a renter's own: sold by them on a rental day that says so. */
export function renterCounterSale(s: BusinessState, sale: Pick<CounterSale, 'staffId' | 'paidAt'>) {
  if (!sale.staffId) return undefined
  const rental = rentalOn(s, sale.staffId, recordDay(s, sale.paidAt))
  return rental?.products ? rental : undefined
}

/** The studio's own treatment takings on a visit's receipt: none when a renter did the visit. */
export const studioServices = (
  s: BusinessState,
  sale: Sale,
  visit: Pick<Appointment, 'staffId' | 'date'> | undefined,
) => (visit && renterVisit(s, visit) ? 0 : serviceRevenue(sale))

/** The studio's own product takings on a visit's receipt. */
export const studioProducts = (
  s: BusinessState,
  sale: Sale,
  visit: Pick<Appointment, 'staffId' | 'date'> | undefined,
) => (visit && renterVisit(s, visit)?.products ? 0 : retailRevenue(sale))

/** The studio's own product takings on a walk-in sale. */
export const studioCounter = (s: BusinessState, sale: CounterSale) =>
  renterCounterSale(s, sale) ? 0 : retailRevenue(sale)

/**
 * How much of a visit's receipt is a renter's own, before tax is taken out: their treatments and
 * the tax on them, and their products with their tax when products are theirs. Tips are kept
 * apart everywhere and are not part of it. For the accounts, which keep money held for a renter
 * apart from the studio's own income.
 */
export function renterPartOfReceipt(s: BusinessState, sale: Sale, visit: Appointment | undefined) {
  const rental = visit && renterVisit(s, visit)
  if (!rental) return { servicesMinor: 0, productsMinor: 0, taxMinor: 0 }
  const products = rental.products ? retailRevenue(sale) : 0
  return {
    servicesMinor: serviceRevenue(sale),
    productsMinor: products,
    taxMinor: (sale.taxMinor ?? 0) + (rental.products ? (sale.retail?.taxMinor ?? 0) : 0),
  }
}
