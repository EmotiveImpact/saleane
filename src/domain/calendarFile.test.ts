import { describe, expect, it } from 'vitest'
import {
  calendarFile,
  calendarFileName,
  escapeText,
  foldLine,
  visitInstants,
  visitUid,
} from './calendarFile'
import type { CalendarVisit } from './calendarFile'

const visit: CalendarVisit = {
  uid: visitUid('appointment-1'),
  serviceName: 'Signature Facial',
  studioName: 'Atelier House',
  date: '2026-10-07',
  startMinutes: 600,
  durationMinutes: 60,
  timeZone: 'Europe/London',
  location: '12 Example Mews, London',
}
const stamp = Date.parse('2026-10-06T08:00:00.000Z')
const lines = (file: string) => file.split('\r\n')
const field = (file: string, name: string) =>
  lines(file.replace(/\r\n /g, ''))
    .find((line) => line.startsWith(`${name}:`))
    ?.slice(name.length + 1)

describe('add to calendar file', () => {
  it('writes a complete event with CRLF line endings', () => {
    const file = calendarFile(visit, stamp)
    expect(file.endsWith('\r\n')).toBe(true)
    expect(file.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/)
    expect(lines(file).slice(0, 6)).toEqual([
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//SALEANE//Guest visit//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'BEGIN:VEVENT',
    ])
    expect(field(file, 'DTSTAMP')).toBe('20261006T080000Z')
    expect(field(file, 'DTSTART')).toBe('20261007T090000Z')
    expect(field(file, 'DTEND')).toBe('20261007T100000Z')
    expect(field(file, 'SUMMARY')).toBe('Signature Facial at Atelier House')
    expect(field(file, 'LOCATION')).toBe('12 Example Mews\\, London')
    expect(field(file, 'STATUS')).toBe('CONFIRMED')
    expect(file).toContain('END:VEVENT\r\nEND:VCALENDAR\r\n')
  })

  it('keeps one UID per visit, without exposing the record ID', () => {
    expect(visitUid('appointment-1')).toBe(visitUid('appointment-1'))
    expect(visitUid('appointment-1')).not.toBe(visitUid('appointment-2'))
    expect(visitUid('appointment-1')).toMatch(/^visit-[0-9a-f]{16}@saleane$/)
    expect(visitUid('appointment-1')).not.toContain('appointment')
    expect(field(calendarFile(visit, stamp), 'UID')).toBe(visit.uid)
  })

  it('escapes commas, semicolons, backslashes and new lines', () => {
    expect(escapeText('Room 2, upstairs; ring\\knock\nthen wait\r\nplease')).toBe(
      'Room 2\\, upstairs\\; ring\\\\knock\\nthen wait\\nplease',
    )
    const file = calendarFile(
      { ...visit, description: 'Parking: bay 3, level 1.\nCome with clean skin; no make-up.' },
      stamp,
    )
    expect(field(file, 'DESCRIPTION')).toBe(
      'Parking: bay 3\\, level 1.\\nCome with clean skin\\; no make-up.',
    )
  })

  it('folds long lines at 75 octets without splitting a character', () => {
    const long = `DESCRIPTION:${'Allow ten minutes to settle in. '.repeat(6)}Café ☕ é`
    const folded = foldLine(long)
    const physical = folded.split('\r\n')
    expect(physical.length).toBeGreaterThan(1)
    for (const line of physical)
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75)
    for (const line of physical.slice(1)) expect(line.startsWith(' ')).toBe(true)
    expect(folded.replace(/\r\n /g, '')).toBe(long)
    const multibyte = foldLine(`SUMMARY:${'é'.repeat(80)}`)
    for (const line of multibyte.split('\r\n'))
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75)
    expect(multibyte.replace(/\r\n /g, '')).toBe(`SUMMARY:${'é'.repeat(80)}`)
    for (const line of lines(calendarFile({ ...visit, description: long }, stamp)))
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75)
  })

  it('converts studio time to UTC across the UK clock change', () => {
    const london = { ...visit, timeZone: 'Europe/London', durationMinutes: 60 }
    // British Summer Time ends at 02:00 on Sunday 25 October 2026.
    expect(field(calendarFile({ ...london, date: '2026-10-24' }, stamp), 'DTSTART')).toBe(
      '20261024T090000Z',
    )
    expect(field(calendarFile({ ...london, date: '2026-10-26' }, stamp), 'DTSTART')).toBe(
      '20261026T100000Z',
    )
    // And begins at 01:00 on Sunday 29 March 2026.
    expect(field(calendarFile({ ...london, date: '2026-03-28' }, stamp), 'DTSTART')).toBe(
      '20260328T100000Z',
    )
    expect(field(calendarFile({ ...london, date: '2026-03-30' }, stamp), 'DTSTART')).toBe(
      '20260330T090000Z',
    )
  })

  it('converts studio time to UTC across the US clock change', () => {
    const newYork = { ...visit, timeZone: 'America/New_York' }
    // Eastern daylight time ends at 02:00 on Sunday 1 November 2026.
    expect(field(calendarFile({ ...newYork, date: '2026-10-31' }, stamp), 'DTSTART')).toBe(
      '20261031T140000Z',
    )
    expect(field(calendarFile({ ...newYork, date: '2026-11-02' }, stamp), 'DTSTART')).toBe(
      '20261102T150000Z',
    )
    // A visit that runs through the change lasts its real length, not its wall-clock length.
    const overnight = { ...newYork, date: '2026-10-31', startMinutes: 23 * 60 + 30 }
    const file = calendarFile({ ...overnight, durationMinutes: 180 }, stamp)
    expect(field(file, 'DTSTART')).toBe('20261101T033000Z')
    expect(field(file, 'DTEND')).toBe('20261101T063000Z')
    // A time the clocks skip has no instant, so no file is made for it.
    expect(() =>
      visitInstants({ ...newYork, date: '2026-03-08', startMinutes: 150, durationMinutes: 60 }),
    ).toThrow(/clocks change/)
  })

  it('marks a cancelled visit and names the file after the visit', () => {
    expect(field(calendarFile({ ...visit, status: 'cancelled' }, stamp), 'STATUS')).toBe(
      'CANCELLED',
    )
    expect(calendarFileName(visit)).toBe('signature-facial-2026-10-07.ics')
    expect(calendarFileName({ serviceName: '✨', date: '2026-10-07' })).toBe('visit-2026-10-07.ics')
  })

  it('leaves out an empty location and description', () => {
    const file = calendarFile({ ...visit, location: '  ', description: '' }, stamp)
    expect(file).not.toContain('LOCATION')
    expect(file).not.toContain('DESCRIPTION')
  })
})
