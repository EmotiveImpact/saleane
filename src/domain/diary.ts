import type { Appointment, BusinessState } from './model'
import { escapeText, foldLine, stableUid, utcStamp } from './calendarFile'
import { addDays } from './format'
import { instantFor, operations, usualHoursFor } from './operations'
import { places, roomWithPlace, staffLocationOn } from './locations'
import { PRACTITIONER_DAYS_AFTER, PRACTITIONER_DAYS_BEFORE } from './practitioner'

/**
 * NEXT-10: a team diary in Google Calendar or Apple Calendar. A private link to a read-only
 * calendar of visits that the calendar app checks every so often, so visits appear, move and go
 * as they do in SALEANE. It never changes anything here.
 *
 * It holds only what a diary needs: the treatment, the time and the room, and the client's first
 * name when the studio chooses. Never a surname, email, phone, note, form, price or payment. Time
 * off shows as the words "Time off", never why.
 */
export type DiaryScope =
  | { kind: 'person'; staffId: string }
  | { kind: 'location'; locationId: string }
  | { kind: 'studio' }
export type DiaryDetail = 'names' | 'treatment'

/** From two weeks back, and how far ahead: a practitioner's own reach, or half a year for others. */
export const DIARY_DAYS_BEFORE = PRACTITIONER_DAYS_BEFORE
export const DIARY_DAYS_AFTER = 182
export const DIARY_PRACTITIONER_DAYS_AFTER = PRACTITIONER_DAYS_AFTER

export const diaryDetailLabel: Record<DiaryDetail, string> = {
  names: 'The treatment and the client’s first name',
  treatment: 'The treatment only',
}

/**
 * The diary's name, as the calendar app shows it: "Maya Lewis at Linden Studio" or "Linden Studio
 * in Islington". Written without commas, which some calendar apps show escaped in a name.
 */
export function diaryName(s: BusinessState, scope: DiaryScope) {
  const studio = s.organisation.name
  if (scope.kind === 'person')
    return `${s.staff.find((p) => p.id === scope.staffId)?.name ?? 'Someone who has left'} at ${studio}`
  if (scope.kind === 'location')
    return `${studio} in ${places(s, true).find((p) => p.id === scope.locationId)?.name ?? 'a closed location'}`
  return studio
}

/** Whose visits it shows, in a few words, such as "Maya Lewis" or "Everyone at Marylebone". */
export function diaryWho(s: BusinessState, scope: DiaryScope) {
  if (scope.kind === 'person')
    return s.staff.find((p) => p.id === scope.staffId)?.name ?? 'Someone who has left'
  if (scope.kind === 'location')
    return `Everyone at ${places(s, true).find((p) => p.id === scope.locationId)?.name ?? 'a closed location'}`
  return 'Everyone at the studio'
}

const shown = (a: Appointment) => a.status !== 'cancelled' && a.status !== 'no_show'

/** The visits a diary shows between two dates, both included, earliest first. */
export function diaryVisits(s: BusinessState, scope: DiaryScope, from: string, to: string) {
  return s.appointments
    .filter(
      (a) =>
        shown(a) &&
        a.date >= from &&
        a.date <= to &&
        (scope.kind === 'studio' ||
          (scope.kind === 'person' && a.staffId === scope.staffId) ||
          (scope.kind === 'location' && a.locationId === scope.locationId)),
    )
    .sort((a, b) => a.date.localeCompare(b.date) || a.startMinutes - b.startMinutes)
}

type Away = { id: string; staffId: string; from: string; to: string }

/**
 * Time off that touches the window, for the person or for the whole studio. A location's diary
 * shows only the days the person was due to work there, as one event for each run of such days,
 * so someone who works at two locations is not shown away from the one they were not due at.
 */
function diaryTimeOff(s: BusinessState, scope: DiaryScope, from: string, to: string): Away[] {
  const blocks = (operations(s).timeOff ?? []).filter(
    (t) =>
      !t.cancelledAt &&
      t.from <= to &&
      t.to >= from &&
      (scope.kind !== 'person' || t.staffId === scope.staffId),
  )
  if (scope.kind !== 'location') return blocks
  const dueHere = (staffId: string, date: string) =>
    !usualHoursFor(s, staffId, date).closed &&
    staffLocationOn(s, staffId, date) === scope.locationId
  return blocks.flatMap((t) => {
    const runs: Away[] = []
    const last = t.to < to ? t.to : to
    for (let date = t.from > from ? t.from : from; date <= last; date = addDays(date, 1)) {
      if (!dueHere(t.staffId, date)) continue
      const run = runs.at(-1)
      if (run && addDays(run.to, 1) === date) run.to = date
      else runs.push({ id: `${t.id}:${date}`, staffId: t.staffId, from: date, to: date })
    }
    return runs
  })
}

const allDay = (date: string) => date.replace(/-/g, '')

/**
 * The diary as an iCalendar file (RFC 5545). Times are in UTC, worked out from the studio's own
 * time zone, so every calendar app places them correctly without a time zone table.
 */
export function diaryFile(
  s: BusinessState,
  scope: DiaryScope,
  options: { detail: DiaryDetail; from: string; to: string; now?: number },
) {
  const { detail, from, to, now = Date.now() } = options
  const everyone = scope.kind !== 'person'
  const firstName = (id: string) =>
    s.clients
      .find((c) => c.id === id)
      ?.name.trim()
      .split(/\s+/)[0]
  const staffFirst = (id: string) => s.staff.find((p) => p.id === id)?.name.split(' ')[0]
  const events = diaryVisits(s, scope, from, to).flatMap((a) => {
    let start: number
    try {
      start = Date.parse(instantFor(s, a.date, a.startMinutes))
    } catch {
      // A time the clocks skip cannot be placed; the visit stays in SALEANE.
      return []
    }
    const service =
      a.bookedServiceName ?? s.services.find((item) => item.id === a.serviceId)?.name ?? 'Visit'
    const who = detail === 'names' ? firstName(a.clientId) : undefined
    const with_ = everyone ? staffFirst(a.staffId) : undefined
    const summary = `${who ? `${who}, ` : ''}${service}${with_ ? ` with ${with_}` : ''}`
    const room = roomWithPlace(s, a)
    return [
      'BEGIN:VEVENT',
      `UID:${stableUid('diary', a.id)}`,
      `DTSTAMP:${utcStamp(now)}`,
      `DTSTART:${utcStamp(start)}`,
      `DTEND:${utcStamp(start + a.bookedDurationMinutes * 60000)}`,
      `SUMMARY:${escapeText(summary)}`,
      ...(room ? [`LOCATION:${escapeText(room)}`] : []),
      `DESCRIPTION:${escapeText('Booked in SALEANE. Open SALEANE for the client’s details.')}`,
      'STATUS:CONFIRMED',
      'TRANSP:OPAQUE',
      'END:VEVENT',
    ]
  })
  const away = diaryTimeOff(s, scope, from, to).flatMap((t) => [
    'BEGIN:VEVENT',
    `UID:${stableUid('away', t.id)}`,
    `DTSTAMP:${utcStamp(now)}`,
    `DTSTART;VALUE=DATE:${allDay(t.from)}`,
    `DTEND;VALUE=DATE:${allDay(addDays(t.to, 1))}`,
    `SUMMARY:${escapeText(everyone ? `${s.staff.find((p) => p.id === t.staffId)?.name ?? 'Someone'}: time off` : 'Time off')}`,
    'TRANSP:OPAQUE',
    'END:VEVENT',
  ])
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//SALEANE//Team diary//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(diaryName(s, scope))}`,
    `X-WR-CALDESC:${escapeText('Visits booked in SALEANE. Read only: make changes in SALEANE.')}`,
    `X-WR-TIMEZONE:${s.organisation.timeZone}`,
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
    ...events,
    ...away,
    'END:VCALENDAR',
  ]
  return lines.map(foldLine).join('\r\n') + '\r\n'
}
