import type { MorningBrief } from '../domain/insights'

type Day = Pick<MorningBrief, 'visits' | 'bookedMinutes' | 'usualBookedMinutes'>

/**
 * A length of time as a person would say it: "40 minutes", "an hour", "an hour and a half",
 * "two and a half hours", "13 hours". A long day is rounded to the hour, so never "12.5 hours".
 */
export function roughHours(minutes: number) {
  if (minutes <= 0) return 'no time'
  if (minutes < 45) return `${Math.max(5, Math.round(minutes / 5) * 5)} minutes`
  if (minutes >= 165) return `${Math.round(minutes / 60)} hours`
  const half = Math.round(minutes / 30)
  if (half === 2) return 'an hour'
  if (half === 3) return 'an hour and a half'
  if (half === 4) return '2 hours'
  return 'two and a half hours'
}

/** The day of the week, in the studio's language ("Tuesday"). */
export function weekdayName(date: string, locale: string) {
  return new Intl.DateTimeFormat(locale, { timeZone: 'UTC', weekday: 'long' }).format(
    new Date(`${date}T12:00:00Z`),
  )
}

/**
 * The heading over what SALEANE noticed: what the figures beneath it actually say. A quiet day
 * tomorrow comes first, as the one thing there is still time to change.
 */
export function dayHeadline(day: Day, quietTomorrow: boolean) {
  if (quietTomorrow) return 'Tomorrow has room to fill.'
  if (!day.visits) return 'A quiet day so far.'
  const usual = day.usualBookedMinutes
  if (usual === null) return 'Today at a glance.'
  if (day.bookedMinutes > usual * 1.25) return 'A fuller day than usual.'
  if (day.bookedMinutes < usual * 0.75) return 'A quieter day than usual.'
  return 'A steady day, much as usual.'
}

/** "Today has 12 visits, about 13 hours of treatment. A usual Tuesday has about 2 hours." */
export function daySentence(day: Day, weekday: string) {
  if (!day.visits) return 'Nothing is booked today yet.'
  const visits = `${day.visits} ${day.visits === 1 ? 'visit' : 'visits'}`
  const usual = day.usualBookedMinutes
  const compared =
    usual === null
      ? ''
      : Math.abs(day.bookedMinutes - usual) <= usual * 0.25
        ? ` About the same as a usual ${weekday}.`
        : ` A usual ${weekday} has about ${roughHours(usual)}.`
  return `Today has ${visits}, about ${roughHours(day.bookedMinutes)} of treatment.${compared}`
}
