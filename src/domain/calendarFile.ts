import { instantIn } from './operations'

/**
 * "Add to calendar": an RFC 5545 iCalendar file for one visit, built in the guest's browser.
 *
 * It holds only what the guest already sees on their confirmation or manage page. It never holds
 * the private manage link, contact details or the studio's internal record ID.
 */
export type CalendarVisit = {
  /** From visitUid, so the same visit always replaces itself in a calendar. */
  uid: string
  serviceName: string
  studioName: string
  /** Civil date and start minute in the studio's time zone. */
  date: string
  startMinutes: number
  durationMinutes: number
  timeZone: string
  location?: string
  description?: string
  status?: 'confirmed' | 'cancelled'
}

/**
 * A stable calendar UID for a visit. It is derived from the record ID with a one-way hash so the
 * ID itself never leaves the studio, yet the confirmation page and the manage page agree.
 */
export function visitUid(appointmentId: string) {
  return stableUid('visit', appointmentId)
}

/**
 * A calendar UID for a record of one kind, such as "visit" or "diary", from a one-way hash of its
 * ID. Different kinds never share a UID, so the same visit in a guest's calendar and a team diary
 * are two events.
 */
export function stableUid(kind: string, id: string) {
  // 64-bit FNV-1a. Stable, dependency free and synchronous; this is an identifier, not a secret.
  let hash = 0xcbf29ce484222325n
  for (const byte of new TextEncoder().encode(`saleane-${kind}:${id}`)) {
    hash ^= BigInt(byte)
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn
  }
  return `${kind}-${hash.toString(16).padStart(16, '0')}@saleane`
}

/** Escapes a TEXT value: backslash, semicolon, comma and line breaks (RFC 5545 3.3.11). */
export function escapeText(value: string) {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n')
}

/**
 * Folds a content line so no physical line exceeds 75 octets (RFC 5545 3.1). Continuation lines
 * begin with one space, and a multi-byte character is never split.
 */
export function foldLine(line: string) {
  const encoder = new TextEncoder()
  const lines: string[] = []
  let current = '',
    size = 0
  for (const char of line) {
    const octets = encoder.encode(char).length
    const limit = lines.length ? 74 : 75
    if (size + octets > limit) {
      lines.push(current)
      current = ''
      size = 0
    }
    current += char
    size += octets
  }
  lines.push(current)
  return lines.join('\r\n ')
}

/** 20261007T080000Z */
export function utcStamp(instant: number) {
  return new Date(instant)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '')
}

/** The visit's start and end as UTC instants, computed from the studio's own time zone. */
export function visitInstants(
  visit: Pick<CalendarVisit, 'date' | 'startMinutes' | 'durationMinutes' | 'timeZone'>,
) {
  const start = Date.parse(instantIn(visit.timeZone, visit.date, visit.startMinutes))
  return { start, end: start + visit.durationMinutes * 60000 }
}

export function calendarFile(visit: CalendarVisit, now = Date.now()) {
  const { start, end } = visitInstants(visit)
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//SALEANE//Guest visit//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${visit.uid}`,
    `DTSTAMP:${utcStamp(now)}`,
    `DTSTART:${utcStamp(start)}`,
    `DTEND:${utcStamp(end)}`,
    `SUMMARY:${escapeText(`${visit.serviceName} at ${visit.studioName}`)}`,
    ...(visit.location?.trim() ? [`LOCATION:${escapeText(visit.location.trim())}`] : []),
    ...(visit.description?.trim() ? [`DESCRIPTION:${escapeText(visit.description.trim())}`] : []),
    `STATUS:${visit.status === 'cancelled' ? 'CANCELLED' : 'CONFIRMED'}`,
    'TRANSP:OPAQUE',
    'END:VEVENT',
    'END:VCALENDAR',
  ]
  return lines.map(foldLine).join('\r\n') + '\r\n'
}

/** A readable file name, such as "signature-facial-2026-10-07.ics". */
export function calendarFileName(visit: Pick<CalendarVisit, 'serviceName' | 'date'>) {
  const slug = visit.serviceName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
  return `${slug || 'visit'}-${visit.date}.ics`
}
