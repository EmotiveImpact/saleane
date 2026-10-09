import { timeLabel } from '../../domain/format'

/** Calendar arithmetic on ISO dates (YYYY-MM-DD), done at noon UTC so no clock change can move a day. */
export const isDate = (value: string | undefined): value is string =>
  !!value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T12:00:00Z`))
export const noon = (date: string) => new Date(`${date}T12:00:00Z`)
export const monthOf = (date: string) => date.slice(0, 7)
export function daysIn(month: string) {
  const [year, number] = month.split('-').map(Number)
  return new Date(Date.UTC(year, number, 0)).getUTCDate()
}
/** The same day a number of months away, kept inside a shorter month (31 January to 28 February). */
export function addMonths(date: string, months: number) {
  const [year, month, day] = date.split('-').map(Number)
  const first = new Date(Date.UTC(year, month - 1 + months, 1, 12)).toISOString().slice(0, 10)
  return `${first.slice(0, 8)}${String(Math.min(day, daysIn(monthOf(first)))).padStart(2, '0')}`
}
/** The weekday a week starts on (0 Sunday, 1 Monday): Monday in the UK, Sunday in the US. */
export function firstWeekday(locale: string) {
  try {
    const place = new Intl.Locale(locale) as Intl.Locale & {
      weekInfo?: { firstDay: number }
      getWeekInfo?: () => { firstDay: number }
    }
    const first = place.getWeekInfo?.().firstDay ?? place.weekInfo?.firstDay
    if (first) return first % 7
  } catch {
    // An unknown locale falls through to the region rule below.
  }
  return /-(US|CA|MX|BR|JP|PH|IL)$/i.test(locale) ? 0 : 1
}
/**
 * A date written out for the studio's locale, with its year. British dates read
 * "Tue 3 Nov 2026", without the comma the international default puts after the day name;
 * American ones keep their own order ("Tue, Nov 3, 2026").
 */
export function writtenDate(date: string, locale: string, length: 'short' | 'long' = 'short') {
  const parts = dateFormat(locale, length).formatToParts(noon(date))
  const british = !/-US$/i.test(locale)
  return parts
    .map((part, i) =>
      british && part.type === 'literal' && parts[i - 1]?.type === 'weekday' ? ' ' : part.value,
    )
    .join('')
}
// Formats are costly to make and a month holds thirty days, so each is made once per locale.
const dateFormats = new Map<string, Intl.DateTimeFormat>()
function dateFormat(locale: string, length: 'short' | 'long') {
  const key = `${locale} ${length}`
  let format = dateFormats.get(key)
  if (!format) {
    format = new Intl.DateTimeFormat(locale, {
      weekday: length,
      day: 'numeric',
      month: length,
      year: 'numeric',
      timeZone: 'UTC',
    })
    dateFormats.set(key, format)
  }
  return format
}
/** "HH:MM" to minutes past midnight, and back. */
export const clockMinutes = (time: string) => {
  const [hours, minutes] = time.split(':').map(Number)
  return hours * 60 + minutes
}
export const clockTime = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`

/** A time of day written the studio's way ("18:00" in the UK, "06:00 PM" in the US), kept once made. */
const clockLabels = new Map<string, string>()
export function clockLabel(time: string, locale: string) {
  const key = `${locale} ${time}`
  let label = clockLabels.get(key)
  if (label === undefined) {
    label = timeLabel(clockMinutes(time), locale)
    clockLabels.set(key, label)
  }
  return label
}
