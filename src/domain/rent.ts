import type { BusinessState } from './model'
import { addDays } from './format'
import { businessDate, operations } from './operations'
import type { Rental, RentPayment } from './rentSchema'

/**
 * V2: chair and room rental. A self-employed stylist or therapist pays the studio rent for a chair
 * or room each week or month and keeps their own takings. SALEANE works out what is due and
 * records what was paid; it does not collect the money.
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

export type RentPeriod = {
  start: string
  end: string
  dueMinor: number
  paidMinor: number
  owedMinor: number
}

/** What each period was due, what was paid against it and what is still owed. */
export function rentStatement(s: BusinessState, rental: Rental, until = businessDate(s)) {
  const payments = (operations(s).rentPayments ?? []).filter((p) => p.rentalId === rental.id)
  return rentPeriods(rental, until).map((period): RentPeriod => {
    const paidMinor = payments
      .filter((p) => p.periodStart === period.start)
      .reduce((sum, p) => sum + p.amountMinor, 0)
    return {
      ...period,
      dueMinor: rental.amountMinor,
      paidMinor,
      owedMinor: Math.max(0, rental.amountMinor - paidMinor),
    }
  })
}

/** Rent recorded as paid in a date range, by the day it was paid. */
export function rentReceived(s: BusinessState, from: string, to: string) {
  return (operations(s).rentPayments ?? [])
    .filter((p) => {
      const day = p.paidAt.slice(0, 10)
      return day >= from && day <= to
    })
    .reduce((sum, p) => sum + p.amountMinor, 0)
}

/** The rental a person is on for a day, if any. */
export function rentalOn(s: BusinessState, staffId: string, date: string) {
  return (operations(s).rentals ?? []).find(
    (r) => r.staffId === staffId && r.from <= date && (!r.to || r.to >= date),
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
    if (paid.get(key)! > rental.amountMinor) return 'More rent was recorded than was due.'
  }
  return null
}
