import { dateLabel, money, timeLabel } from './format'
import type { BusinessState } from './model'
import { instantIn } from './operations'
import { addedTaxMinor } from './priceSentence'
import type { PriceTax } from './priceSentence'

/** How far ahead a guest can book online, counting the studio's today. */
export const BOOKING_DAYS = 366
/** Days in one run of the booking page's day strip, and in one answer about them. */
export const STRIP_DAYS = 14
/** How far "first available" and "next free" look ahead: about three months. */
export const NEXT_FREE_DAYS = 92

/**
 * The cancellation rule a guest agrees to before confirming a visit, in plain words. It follows
 * the rule the guest's own visit page applies (LOCAL-02, `guestCancellation` in guest.ts): a
 * visit can be cancelled online until it starts; a paid deposit is refunded when the visit is
 * cancelled at least `cutoffHours` before it starts and kept after that. A studio with no-show
 * protection (PILOT-02) may also charge a share of the price, less any deposit, for a late
 * cancellation or a missed visit (`feeAllowed` in fees.ts).
 */
export type CancellationInput = {
  date: string
  startMinutes: number
  timeZone: string
  locale: string
  depositMinor: number
  cutoffHours: number
  feePercent: number
  /** The moment the guest reads the rule. */
  now: number
}

/** A date and time written out on the studio's clock, such as "Tuesday 6 October at 10:00". */
export function whenLabel(date: string, minutes: number, locale: string) {
  return `${dateLabel(date, locale)} at ${timeLabel(minutes, locale)}`
}

/** The civil date and minute of an instant in a time zone. */
export function civilTime(instant: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(instant))
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)!.value
  return {
    date: `${part('year')}-${part('month')}-${part('day')}`,
    minutes: Number(part('hour')) * 60 + Number(part('minute')),
  }
}

/** The rule in words, given when the free cancellation ends, or that it already has. */
function ruleWords(
  input: Pick<CancellationInput, 'cutoffHours' | 'feePercent' | 'depositMinor'>,
  cutoff: string,
  passed: boolean,
) {
  const { cutoffHours: hours, feePercent: fee, depositMinor: deposit } = input
  const share = `up to ${fee}% of the price`
  if (!deposit && !fee) return 'Free to cancel online any time before your visit.'
  if (passed)
    return `Your visit is less than ${hours} hours away, so if you cancel or miss it, the studio ${
      deposit
        ? `keeps your deposit${fee ? ` and may charge ${share}, less the deposit` : ''}`
        : `may charge ${share}`
    }.`
  if (deposit)
    return `Free to cancel until ${cutoff}, and the studio refunds your deposit. After that it keeps the deposit${
      fee
        ? `, and for a late cancellation or a missed visit it may charge ${share}, less the deposit`
        : ''
    }.`
  return `Free to cancel until ${cutoff}. After that, or if you miss your visit, the studio may charge ${share}.`
}

export function cancellationTerms(input: CancellationInput) {
  let start: number
  try {
    start = Date.parse(instantIn(input.timeZone, input.date, input.startMinutes))
  } catch {
    start = NaN
  }
  const cutoffAt = Number.isNaN(start) ? null : start - input.cutoffHours * 60 * 60000
  const at = cutoffAt === null ? null : civilTime(cutoffAt, input.timeZone)
  const cutoff = at ? whenLabel(at.date, at.minutes, input.locale) : ''
  const passed = cutoffAt === null || input.now >= cutoffAt
  return { cutoffAt, cutoff, passed, rule: ruleWords(input, cutoff, passed) }
}

/** The same rule before a time is chosen, counted back from whenever the visit will be. */
export function cancellationRule(
  input: Pick<CancellationInput, 'cutoffHours' | 'feePercent' | 'depositMinor'>,
) {
  return ruleWords(input, `${input.cutoffHours} hours before your visit`, false)
}

/**
 * What a full price already includes, such as "Including VAT" or "Including £3.20 sales tax",
 * worded as the treatment's price sentence words it. Empty when the studio charges no tax.
 */
export function taxIncluded(
  basePriceMinor: number,
  tax: PriceTax,
  organisation: Pick<BusinessState['organisation'], 'locale' | 'currency'>,
) {
  if (!tax || tax.rateBps <= 0 || basePriceMinor <= 0) return ''
  const label = tax.label.trim()
  const name = !label ? 'tax' : label === label.toUpperCase() ? label : label.toLowerCase()
  const added = addedTaxMinor(basePriceMinor, tax)
  if (added) return `Including ${money(added, organisation)} ${name}`
  return tax.inclusive ? `Including ${name}` : ''
}
