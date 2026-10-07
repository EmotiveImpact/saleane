import { z } from 'zod'
import type { BusinessState } from './model'
import { businessDate, operations } from './operations'
import { money } from './format'

/**
 * End-of-day till count (cash-up). Staff count the cash drawer and tell SALEANE what they found;
 * SALEANE compares it with the cash it has on record for that venue day. It never moves, banks or
 * reconciles money. Counts are append-only: a recount adds a new record and the latest one for a
 * day is the one shown, with every earlier count kept as history.
 */
const id = z.string().min(1).max(150)
const minor = z.number().int().nonnegative().max(100_000_000)
/** Expected cash can fall below zero when recorded cash refunds exceed takings and float. */
const signedMinor = z.number().int().min(-200_000_000).max(300_000_000)

export const tillCountSchema = z.object({
  id,
  organisationId: id,
  /** The venue day counted, in the studio's own time zone. */
  date: z.iso.date(),
  openingFloatMinor: minor,
  /** All cash found in the till at the count, before any is taken out for banking. */
  countedMinor: minor,
  /** Cash staff say they took out to bank. Recorded only; SALEANE does not bank it. */
  bankingMinor: minor,
  /** Snapshot of the cash records for the day when the count was made. */
  cashInMinor: minor,
  cashRefundedMinor: minor,
  expectedMinor: signedMinor,
  note: z.string().max(300).optional(),
  recordedAt: z.iso.datetime(),
  actor: z.string(),
})
export type TillCount = z.infer<typeof tillCountSchema>

export const tillCountCommandSchema = z.object({
  type: z.literal('till-count'),
  date: z.iso.date(),
  openingFloatMinor: minor,
  countedMinor: minor,
  bankingMinor: minor,
  note: z.string().trim().max(300).optional(),
})
export type TillCountCommand = z.infer<typeof tillCountCommandSchema>

const formatters = new Map<string, Intl.DateTimeFormat>()
/** The civil date of an instant in a time zone, such as "2026-10-06". */
export function venueDate(timeZone: string, instant: string) {
  let formatter = formatters.get(timeZone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
    formatters.set(timeZone, formatter)
  }
  const parts = formatter.formatToParts(new Date(instant))
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)!.value
  return `${part('year')}-${part('month')}-${part('day')}`
}

const CASH = new Set(['cash', 'demo_cash'])

/**
 * The venue day a payment or refund belongs to. The sample studio's clock stands still on its
 * demo day, so anything recorded during a demo session after that day belongs to the demo day.
 */
function recordDay(s: BusinessState, instant: string) {
  const day = venueDate(s.organisation.timeZone, instant)
  if (operations(s).mode !== 'sandbox') return day
  const demoDay = businessDate(s)
  return day > demoDay ? demoDay : day
}

/**
 * Cash on record for one venue day: cash payments (deposits and settlements, including tips)
 * recorded that day, and cash refunds recorded that day. A refund records how the money went
 * back; an older refund without that counts as cash when its receipt was settled in cash.
 */
export function cashForDay(s: BusinessState, date: string) {
  const cashIn = s.payments
    .filter((p) => CASH.has(p.method) && recordDay(s, p.recordedAt) === date)
    .reduce((sum, p) => sum + p.amountMinor, 0)
  const cashSales = new Set(s.sales.filter((sale) => CASH.has(sale.method)).map((sale) => sale.id))
  const cashRefunded = operations(s)
    .refunds.filter(
      (r) =>
        (r.method ? CASH.has(r.method) : cashSales.has(r.saleId ?? '')) &&
        recordDay(s, r.createdAt) === date,
    )
    .reduce((sum, r) => sum + r.amountMinor, 0)
  return { cashIn, cashRefunded }
}

export function expectedCash(s: BusinessState, date: string, openingFloatMinor: number) {
  const { cashIn, cashRefunded } = cashForDay(s, date)
  return { cashIn, cashRefunded, expected: openingFloatMinor + cashIn - cashRefunded }
}

/** Counts for one day, latest first. The first is the one that stands; the rest are history. */
export function tillCountsFor(s: BusinessState, date: string) {
  return (s.tillCounts ?? [])
    .map((count, index) => ({ count, index }))
    .filter(({ count }) => count.date === date)
    .sort((a, b) => b.count.recordedAt.localeCompare(a.count.recordedAt) || b.index - a.index)
    .map(({ count }) => count)
}

/** Validation shared by the command and parseState. */
export function tillCountProblem(count: Omit<TillCount, 'id' | 'organisationId' | 'actor'>) {
  if (count.bankingMinor > count.countedMinor)
    return 'Cash taken out for banking cannot be more than the cash counted.'
  if (count.expectedMinor !== count.openingFloatMinor + count.cashInMinor - count.cashRefundedMinor)
    return 'Invalid till count.'
  return null
}

/** Applies the till-count command to `next`, the working copy inside `execute`. */
export function recordTillCount(
  next: BusinessState,
  command: TillCountCommand,
  now: string,
  today: string,
  makeId: () => string,
) {
  if (command.date > today)
    throw new Error('A till can only be counted for today or an earlier day.')
  const { cashIn, cashRefunded, expected } = expectedCash(
    next,
    command.date,
    command.openingFloatMinor,
  )
  const note = command.note?.trim()
  const count: TillCount = {
    id: makeId(),
    organisationId: next.organisation.id,
    date: command.date,
    openingFloatMinor: command.openingFloatMinor,
    countedMinor: command.countedMinor,
    bankingMinor: command.bankingMinor,
    cashInMinor: cashIn,
    cashRefundedMinor: cashRefunded,
    expectedMinor: expected,
    ...(note ? { note } : {}),
    recordedAt: now,
    actor: operations(next).mode === 'sandbox' ? 'Maya · demo operator' : 'Local operator',
  }
  const problem = tillCountProblem(count)
  if (problem) throw new Error(problem)
  next.tillCounts = [...(next.tillCounts ?? []), count]
  return count.id
}

/** "£2.50 short", "£1.00 over" or a plain match, comparing counted cash with the cash expected. */
export function tillDifference(
  countedMinor: number,
  expectedMinor: number,
  organisation: Pick<BusinessState['organisation'], 'locale' | 'currency'>,
) {
  const difference = countedMinor - expectedMinor
  if (difference === 0) return 'Matches the expected cash'
  return `${money(Math.abs(difference), organisation, true)} ${difference < 0 ? 'short' : 'over'}`
}
