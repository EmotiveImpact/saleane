import type { PractitionerView } from './practitioner'

/**
 * Pocket view: small, pure helpers for a practitioner's phone between treatments. They read
 * only the PractitionerView the server already scoped (LOCAL-01) and never widen it.
 */
type Visit = PractitionerView['appointments'][number]
type Client = PractitionerView['clients'][number]

const clock = new Map<string, Intl.DateTimeFormat>()
/** Minutes past midnight on the venue's wall clock, so a phone abroad still reads studio time. */
export function venueMinutes(timeZone: string, now: number) {
  let format = clock.get(timeZone)
  if (!format) {
    format = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
    clock.set(timeZone, format)
  }
  const parts = format.formatToParts(new Date(now))
  const n = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0)
  return n('hour') * 60 + n('minute')
}

/** The visit still to come or under way: welcomed or expected, and not yet over. */
export function nextUp(visits: Visit[], minutes: number) {
  return visits
    .filter(
      (a) =>
        (a.status === 'confirmed' || a.status === 'arrived') &&
        a.startMinutes + a.durationMinutes > minutes,
    )
    .sort((a, b) => a.startMinutes - b.startMinutes)[0]
}

/** "In 25 min", "In 1 hr 40 min" or "Now" once the start time has come. */
export function untilLabel(startMinutes: number, minutes: number) {
  const gap = startMinutes - minutes
  if (gap <= 0) return 'Now'
  const hours = Math.floor(gap / 60)
  const rest = gap % 60
  if (!hours) return `In ${rest} min`
  return rest ? `In ${hours} hr ${rest} min` : `In ${hours} hr`
}

export type PreviousVisit = { date: string; serviceName: string }
/**
 * The client's last completed visit with this practitioner before the chosen visit. Completed
 * visits inside the window are exact; the server's `previousVisit` covers anything older.
 * `undefined` means the answer lies before the window for an earlier day and is not known here.
 */
export function previousWithYou(
  record: PractitionerView,
  visit: Visit,
  client: Client,
): PreviousVisit | null | undefined {
  const before = (a: Visit) =>
    a.date < visit.date || (a.date === visit.date && a.startMinutes < visit.startMinutes)
  const inWindow = record.appointments
    .filter((a) => a.clientId === client.id && a.status === 'completed' && before(a))
    .sort((a, b) => b.date.localeCompare(a.date) || b.startMinutes - a.startMinutes)[0]
  if (inWindow) return { date: inWindow.date, serviceName: inWindow.serviceName }
  const earlier = client.previousVisit
  if (earlier && earlier.date < visit.date) return earlier
  if (!earlier || visit.date >= record.today) return null
  return undefined
}

/** The first word of a name, for a glance at a phone. */
export function firstName(name: string) {
  return name.trim().split(/\s+/)[0] || name
}
