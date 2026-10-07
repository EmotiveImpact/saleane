import type { BusinessState } from './model'

export function money(
  amountMinor: number,
  organisation: Pick<BusinessState['organisation'], 'locale' | 'currency'>,
  decimals = false,
) {
  return new Intl.NumberFormat(organisation.locale, {
    style: 'currency',
    currency: organisation.currency,
    // Whole amounts may drop pence/cents, but a part amount always shows two digits (£85.50).
    minimumFractionDigits: decimals || amountMinor % 100 !== 0 ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(amountMinor / 100)
}
export function dateLabel(date: string, locale = 'en-GB', short = false) {
  return new Intl.DateTimeFormat(locale, {
    timeZone: 'UTC',
    weekday: short ? 'short' : 'long',
    month: short ? 'short' : 'long',
    day: 'numeric',
  }).format(new Date(`${date}T12:00:00Z`))
}
/** A date with its year, for dates that may be more than a year away ("5 October 2028"). */
export function fullDateLabel(date: string, locale = 'en-GB') {
  return new Intl.DateTimeFormat(locale, {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(`${date}T12:00:00Z`))
}
export function timeLabel(minutes: number, locale = 'en-GB') {
  return new Intl.DateTimeFormat(locale, {
    timeZone: 'UTC',
    hour: '2-digit',
    minute: '2-digit',
    hour12: locale === 'en-US',
  }).format(new Date(Date.UTC(2026, 0, 1, 0, minutes)))
}
export function addDays(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}
export function initials(name: string) {
  return name
    .split(' ')
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
}
