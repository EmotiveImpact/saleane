import { describe, expect, it } from 'vitest'
import { seed } from './seed'
import { DEMO_DATE } from './model'
import type { BusinessState } from './model'
import { addDays } from './format'
import { visitUid } from './calendarFile'
import { diaryFile, diaryName, diaryVisits, diaryWho } from './diary'
import type { DiaryScope } from './diary'

// NEXT-10: a team diary for Google Calendar or Apple Calendar, read through a private link.
const maya: DiaryScope = { kind: 'person', staffId: 'staff-maya' }
const studio: DiaryScope = { kind: 'studio' }
const stamp = Date.parse('2026-10-06T07:00:00.000Z')
const window = { from: DEMO_DATE, to: addDays(DEMO_DATE, 7), now: stamp }
const unfold = (file: string) => file.replace(/\r\n /g, '')
const events = (file: string) =>
  unfold(file)
    .split('BEGIN:VEVENT\r\n')
    .slice(1)
    .map((block) =>
      Object.fromEntries(
        block
          .split('END:VEVENT')[0]
          .split('\r\n')
          .filter(Boolean)
          .map((line) => [line.slice(0, line.indexOf(':')), line.slice(line.indexOf(':') + 1)]),
      ),
    )
/** The sample studio with one of Maya's visits cancelled and Sophia's first a no-show. */
function studioWithChanges(): BusinessState {
  const s = structuredClone(seed('UK'))
  s.appointments.find((a) => a.id === 'visit-zoe')!.status = 'cancelled'
  s.appointments.find((a) => a.id === 'visit-ava')!.status = 'no_show'
  return s
}

describe('team diaries in Google or Apple Calendar', () => {
  it('shows one person’s visits with the treatment and the client’s first name, in UTC', () => {
    const s = studioWithChanges()
    const file = diaryFile(s, maya, { detail: 'names', ...window })
    expect(file.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true)
    expect(file.endsWith('END:VCALENDAR\r\n')).toBe(true)
    expect(unfold(file)).toContain('X-WR-CALNAME:Maya Lewis at Atelier House\r\n')
    expect(unfold(file)).toContain('REFRESH-INTERVAL;VALUE=DURATION:PT1H\r\n')
    const shown = events(file)
    // Amelia, Noor and Ruby; Zoe's visit was cancelled.
    expect(shown.map((e) => e.SUMMARY)).toEqual([
      'Amelia\\, Skin Renewal Facial',
      'Noor\\, Skin Renewal Facial',
      'Ruby\\, Deep Restore Massage',
    ])
    // 09:30 in London in October is 08:30 in UTC.
    expect(shown[0]).toMatchObject({
      DTSTAMP: '20261006T070000Z',
      DTSTART: '20261006T083000Z',
      LOCATION: 'Treatment room 1',
      STATUS: 'CONFIRMED',
    })
    expect(
      Date.parse(
        shown[0].DTEND.replace(/(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)Z/, '$1-$2-$3T$4:$5:$6Z'),
      ),
    ).toBeGreaterThan(Date.parse('2026-10-06T08:30:00Z'))
    expect(shown[0].DESCRIPTION).toBe('Booked in SALEANE. Open SALEANE for the client’s details.')
  })

  it('never shows a surname, email, phone number, note or price', () => {
    const s = studioWithChanges()
    const file = unfold(diaryFile(s, studio, { detail: 'names', ...window }))
    for (const a of diaryVisits(s, studio, window.from, window.to)) {
      const client = s.clients.find((c) => c.id === a.clientId)!
      expect(file).not.toContain(client.name)
      expect(file).not.toContain(client.email)
      expect(file).not.toContain(client.phone)
      if (client.preferences) expect(file).not.toContain(client.preferences)
      for (const note of s.events.filter((e) => e.clientId === client.id && e.type === 'note'))
        expect(file).not.toContain(note.detail)
    }
    expect(file).not.toMatch(/£|\bprice\b|deposit/i)
  })

  it('shows the treatment only, when the studio chooses', () => {
    const file = diaryFile(studioWithChanges(), maya, { detail: 'treatment', ...window })
    expect(events(file).map((e) => e.SUMMARY)).toEqual([
      'Skin Renewal Facial',
      'Skin Renewal Facial',
      'Deep Restore Massage',
    ])
    expect(file).not.toContain('Amelia')
  })

  it('says who does each visit in a diary for a location or the whole studio', () => {
    const s = studioWithChanges()
    const all = events(diaryFile(s, studio, { detail: 'names', ...window }))
    const expected = diaryVisits(s, studio, window.from, window.to)
    expect(all).toHaveLength(expected.length)
    expect(expected.some((a) => a.status === 'cancelled' || a.status === 'no_show')).toBe(false)
    expect(all[0].SUMMARY).toBe('Olivia\\, Lymphatic Massage with Sophia')
    expect(all.map((e) => e.SUMMARY)).not.toContain('Ava\\, Lymphatic Massage with Sophia')
    // With one location, its diary is the studio's.
    const main = s.organisation.locationId
    expect(diaryVisits(s, { kind: 'location', locationId: main }, window.from, window.to)).toEqual(
      expected,
    )
    expect(diaryName(s, studio)).toBe('Atelier House')
    expect(diaryName(s, maya)).toBe('Maya Lewis at Atelier House')
    expect(diaryWho(s, maya)).toBe('Maya Lewis')
    expect(diaryWho(s, studio)).toBe('Everyone at the studio')
  })

  it('keeps a location’s diary to its own visits, naming the place with the room', () => {
    const s = studioWithChanges()
    s.operations = {
      ...s.operations!,
      locations: [{ id: 'loc-islington', name: 'Islington', address: '1 Upper Street' }],
    } as BusinessState['operations']
    s.appointments.find((a) => a.id === 'visit-noor')!.locationId = 'loc-islington'
    const islington: DiaryScope = { kind: 'location', locationId: 'loc-islington' }
    const shown = events(diaryFile(s, islington, { detail: 'names', ...window }))
    expect(shown.map((e) => e.SUMMARY)).toEqual(['Noor\\, Skin Renewal Facial with Maya'])
    expect(shown[0].LOCATION).toBe('Treatment room 1\\, Islington')
    expect(diaryWho(s, islington)).toBe('Everyone at Islington')
    expect(diaryName(s, islington)).toBe('Atelier House in Islington')
  })

  it('shows time off as Time off, never why, and leaves out time off that was cancelled', () => {
    const s = studioWithChanges()
    s.operations = {
      ...s.operations!,
      timeOff: [
        {
          id: 'away-maya',
          staffId: 'staff-maya',
          from: '2026-10-08',
          to: '2026-10-09',
          kind: 'sick',
          note: 'Flu, back Monday',
          createdAt: '2026-10-06T07:00:00.000Z',
          actor: 'Owner',
        },
        {
          id: 'away-theo',
          staffId: 'staff-theo',
          from: '2026-10-07',
          to: '2026-10-07',
          kind: 'holiday',
          createdAt: '2026-10-06T07:00:00.000Z',
          actor: 'Owner',
          cancelledAt: '2026-10-06T07:30:00.000Z',
          cancelledBy: 'Owner',
        },
      ],
    }
    const own = unfold(diaryFile(s, maya, { detail: 'names', ...window }))
    expect(own).toContain('SUMMARY:Time off\r\nTRANSP:OPAQUE\r\nEND:VEVENT')
    expect(own).toContain('DTSTART;VALUE=DATE:20261008\r\nDTEND;VALUE=DATE:20261010\r\n')
    expect(own).not.toMatch(/Flu|sick/i)
    const everyone = unfold(diaryFile(s, studio, { detail: 'names', ...window }))
    expect(everyone).toContain('SUMMARY:Maya Lewis: time off\r\n')
    expect(everyone).not.toContain('Theo Bennett: time off')
  })

  it('shows a location only the days off someone was due to work there', () => {
    const s = studioWithChanges()
    // Maya works Monday to Wednesday at the main location and Thursday and Friday in Islington.
    const maya = s.staff.find((p) => p.id === 'staff-maya')!
    maya.hours = [0, 1, 2, 3, 4, 5, 6].map((day) => ({
      day,
      open: 540,
      close: 1020,
      closed: day === 0 || day === 6,
      ...(day === 4 || day === 5 ? { locationId: 'loc-islington' } : {}),
    }))
    s.operations = {
      ...s.operations!,
      locations: [{ id: 'loc-islington', name: 'Islington', address: '1 Upper Street' }],
      timeOff: [
        {
          id: 'away-week',
          staffId: 'staff-maya',
          from: '2026-10-05',
          to: '2026-10-11',
          kind: 'holiday',
          createdAt: '2026-10-01T07:00:00.000Z',
          actor: 'Owner',
        },
        {
          id: 'away-tuesday',
          staffId: 'staff-maya',
          from: '2026-10-13',
          to: '2026-10-13',
          kind: 'sick',
          createdAt: '2026-10-06T07:00:00.000Z',
          actor: 'Owner',
        },
      ],
    } as BusinessState['operations']
    const away = (scope: DiaryScope) =>
      events(diaryFile(s, scope, { detail: 'names', ...window }))
        .filter((e) => e.SUMMARY === 'Maya Lewis: time off')
        .map((e) => `${e['DTSTART;VALUE=DATE']} to ${e['DTEND;VALUE=DATE']}`)
    // Thursday and Friday of the holiday week only, as one event, and not the Tuesday after.
    expect(away({ kind: 'location', locationId: 'loc-islington' })).toEqual([
      '20261008 to 20261010',
    ])
    // The main location: the holiday's Tuesday and Wednesday inside the window, then that Tuesday.
    expect(away({ kind: 'location', locationId: s.organisation.locationId })).toEqual([
      '20261006 to 20261008',
      '20261013 to 20261014',
    ])
    // The studio's diary and her own keep each block whole.
    expect(away(studio)).toEqual(['20261005 to 20261012', '20261013 to 20261014'])
  })

  it('keeps one UID per visit, different from the guest’s own calendar, without the record ID', () => {
    const s = studioWithChanges()
    const first = events(diaryFile(s, maya, { detail: 'names', ...window }))
    const later = events(
      diaryFile(s, maya, { detail: 'treatment', ...window, now: stamp + 3600000 }),
    )
    expect(later.map((e) => e.UID)).toEqual(first.map((e) => e.UID))
    expect(first[0].UID).toMatch(/^diary-[0-9a-f]{16}@saleane$/)
    expect(first[0].UID).not.toBe(visitUid('visit-amelia'))
    expect(first.map((e) => e.UID).join(' ')).not.toContain('visit-')
  })

  it('stays within the window and folds every line to 75 octets', () => {
    const s = studioWithChanges()
    const none = diaryFile(s, maya, { detail: 'names', from: '2026-11-01', to: '2026-11-07' })
    expect(events(none)).toEqual([])
    s.organisation.name = 'An Unusually Long Studio Name For Testing How Lines Fold In Calendars'
    for (const line of diaryFile(s, studio, { detail: 'names', ...window }).split('\r\n'))
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75)
  })
})
