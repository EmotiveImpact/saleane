import ICAL from 'ical.js'
import { describe, expect, it } from 'vitest'
import { seed } from './seed'
import { DEMO_DATE } from './model'
import type { BusinessState } from './model'
import { addDays } from './format'
import { calendarFile, visitUid } from './calendarFile'
import { diaryFile } from './diary'

// The team diaries and a guest's "Add to calendar" file, read back by ical.js, Mozilla's
// iCalendar reader (the one inside Thunderbird), so a file Google or Apple would misread or drop
// fails here first. It reads what the file says, not what our own tests expect it to say.
const stamp = Date.parse('2026-10-06T07:00:00.000Z')

function read(file: string) {
  const calendar = new ICAL.Component(ICAL.parse(file))
  const events = calendar.getAllSubcomponents('vevent').map((v) => new ICAL.Event(v))
  return { calendar, events }
}
const instant = (time: ICAL.Time) => time.toJSDate().toISOString()

/** The sample studio with Zoe's visit moved to a day, time and treatment name chosen by a test. */
function moved(region: 'UK' | 'US', date: string, startMinutes: number, change = {}) {
  const s: BusinessState = structuredClone(seed(region))
  Object.assign(
    s.appointments.find((a) => a.id === 'visit-zoe')!,
    { date, startMinutes },
    change,
  )
  return s
}

describe('the files as a calendar app reads them', () => {
  it('reads every visit in the whole studio diary, at the time SALEANE meant', () => {
    const s = seed('UK')
    const file = diaryFile(
      s,
      { kind: 'studio' },
      {
        detail: 'names',
        from: DEMO_DATE,
        to: addDays(DEMO_DATE, 7),
        now: stamp,
      },
    )
    const { calendar, events } = read(file)
    expect(calendar.getFirstPropertyValue('x-wr-calname')).toBe('Atelier House')
    expect(events.length).toBeGreaterThan(10)
    expect(new Set(events.map((e) => e.uid)).size).toBe(events.length)
    const amelia = events.find((e) => e.summary.startsWith('Amelia, '))!
    // 09:30 in London on Tuesday 6 October is 08:30 in UTC.
    expect(amelia.summary).toBe('Amelia, Skin Renewal Facial with Maya')
    expect(instant(amelia.startDate)).toBe('2026-10-06T08:30:00.000Z')
    expect(amelia.location).toBe('Treatment room 1')
    expect(amelia.description).toBe('Booked in SALEANE. Open SALEANE for the client’s details.')
    for (const event of events) {
      expect(event.startDate.isDate).toBe(false)
      expect(event.endDate.compare(event.startDate)).toBe(1)
    }
  })

  it('places visits either side of the clocks changing, in London and New York', () => {
    const range = { detail: 'names' as const, from: DEMO_DATE, to: '2026-11-30', now: stamp }
    const zoe = (s: BusinessState) =>
      read(diaryFile(s, { kind: 'studio' }, range)).events.find((e) =>
        e.summary.startsWith('Zoe, '),
      )!
    // London: 09:30 is 08:30 UTC before Sunday 25 October and 09:30 UTC after it.
    expect(instant(zoe(moved('UK', '2026-10-23', 570)).startDate)).toBe('2026-10-23T08:30:00.000Z')
    expect(instant(zoe(moved('UK', '2026-10-26', 570)).startDate)).toBe('2026-10-26T09:30:00.000Z')
    // New York: 10:00 is 14:00 UTC before Sunday 1 November and 15:00 UTC after it.
    expect(instant(zoe(moved('US', '2026-10-30', 600)).startDate)).toBe('2026-10-30T14:00:00.000Z')
    expect(instant(zoe(moved('US', '2026-11-02', 600)).startDate)).toBe('2026-11-02T15:00:00.000Z')
  })

  it('keeps long names, accents, punctuation and line breaks exactly as typed', () => {
    const service =
      'Signature facial; with oils, steam\nand a hot stone finish that runs well past one line 💆'
    const s = moved('UK', DEMO_DATE, 840, { bookedServiceName: service })
    s.clients.find(
      (c) => c.id === s.appointments.find((a) => a.id === 'visit-zoe')!.clientId,
    )!.name = 'Zoë-Élodie Núñez'
    const file = diaryFile(
      s,
      { kind: 'person', staffId: 'staff-maya' },
      {
        detail: 'names',
        from: DEMO_DATE,
        to: DEMO_DATE,
        now: stamp,
      },
    )
    // Long lines are folded, so the reader must join them back without breaking a character.
    expect(file.split('\r\n').some((line) => line.startsWith(' '))).toBe(true)
    const zoe = read(file).events.find((e) => e.summary.startsWith('Zoë'))!
    expect(zoe.summary).toBe(`Zoë-Élodie, ${service}`)
  })

  it('reads time off as whole days, ending the day after the last', () => {
    const s = seed('UK')
    s.operations = {
      ...s.operations!,
      timeOff: [
        {
          id: 'away-maya',
          staffId: 'staff-maya',
          from: '2026-10-08',
          to: '2026-10-09',
          kind: 'holiday',
          createdAt: '2026-10-06T07:00:00.000Z',
          actor: 'Owner',
        },
      ],
    }
    const file = diaryFile(
      s,
      { kind: 'person', staffId: 'staff-maya' },
      {
        detail: 'treatment',
        from: DEMO_DATE,
        to: addDays(DEMO_DATE, 7),
        now: stamp,
      },
    )
    const away = read(file).events.find((e) => e.summary === 'Time off')!
    expect(away.startDate.isDate).toBe(true)
    expect(away.startDate.toString()).toBe('2026-10-08')
    expect(away.endDate.toString()).toBe('2026-10-10')
  })

  it('reads a guest’s own visit, and a cancelled one as cancelled', () => {
    const visit = {
      uid: visitUid('visit-amelia'),
      serviceName: 'Skin Renewal Facial',
      studioName: 'Atelier House',
      date: '2026-10-07',
      startMinutes: 570,
      durationMinutes: 60,
      timeZone: 'Europe/London',
      location: '12 Marylebone Lane, London W1U 2NE',
      description: 'Arrive five minutes early, please.',
    }
    const [event] = read(calendarFile(visit, stamp)).events
    expect(event.uid).toBe(visit.uid)
    expect(event.summary).toBe('Skin Renewal Facial at Atelier House')
    expect(event.location).toBe('12 Marylebone Lane, London W1U 2NE')
    expect(instant(event.startDate)).toBe('2026-10-07T08:30:00.000Z')
    expect(instant(event.endDate)).toBe('2026-10-07T09:30:00.000Z')
    const cancelled = read(calendarFile({ ...visit, status: 'cancelled' }, stamp)).events[0]
    expect(cancelled.component.getFirstPropertyValue('status')).toBe('CANCELLED')
  })
})
