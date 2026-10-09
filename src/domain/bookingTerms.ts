import { dateLabel, timeLabel } from './format'
import { instantIn } from './operations'

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

export function cancellationTerms(input: CancellationInput) {
  const { cutoffHours: hours, feePercent: fee, depositMinor: deposit } = input
  let start: number
  try {
    start = Date.parse(instantIn(input.timeZone, input.date, input.startMinutes))
  } catch {
    start = NaN
  }
  const cutoffAt = Number.isNaN(start) ? null : start - hours * 60 * 60000
  const at = cutoffAt === null ? null : civilTime(cutoffAt, input.timeZone)
  const cutoff = at ? whenLabel(at.date, at.minutes, input.locale) : ''
  const passed = cutoffAt === null || input.now >= cutoffAt
  const share = `up to ${fee}% of the price`
  let rule: string
  if (!deposit && !fee) rule = 'Free to cancel online any time before your visit.'
  else if (passed)
    rule = `Your visit is less than ${hours} hours away, so if you cancel or miss it, the studio ${
      deposit
        ? `keeps your deposit${fee ? ` and may charge ${share}, less the deposit` : ''}`
        : `may charge ${share}`
    }.`
  else if (deposit)
    rule = `Free to cancel until ${cutoff}, and the studio refunds your deposit. After that it keeps the deposit${
      fee
        ? `, and for a late cancellation or a missed visit it may charge ${share}, less the deposit`
        : ''
    }.`
  else
    rule = `Free to cancel until ${cutoff}. After that, or if you miss your visit, the studio may charge ${share}.`
  return { cutoffAt, cutoff, passed, rule }
}
