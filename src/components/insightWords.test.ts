import { describe, expect, it } from 'vitest'
import { dayHeadline, daySentence, roughHours, weekdayName } from './insightWords'

describe('the words over what SALEANE noticed', () => {
  it('says a length of time as a person would, never as a decimal', () => {
    expect(roughHours(0)).toBe('no time')
    expect(roughHours(20)).toBe('20 minutes')
    expect(roughHours(60)).toBe('an hour')
    expect(roughHours(90)).toBe('an hour and a half')
    expect(roughHours(120)).toBe('2 hours')
    expect(roughHours(150)).toBe('two and a half hours')
    expect(roughHours(180)).toBe('3 hours')
    expect(roughHours(750)).toBe('13 hours')
    expect(roughHours(735)).toBe('12 hours')
  })

  it('heads the panel with what its figures say', () => {
    const day = (visits: number, booked: number, usual: number | null) => ({
      visits,
      bookedMinutes: booked,
      usualBookedMinutes: usual,
    })
    expect(dayHeadline(day(12, 750, 120), false)).toBe('A fuller day than usual.')
    expect(dayHeadline(day(3, 120, 300), false)).toBe('A quieter day than usual.')
    expect(dayHeadline(day(6, 330, 300), false)).toBe('A steady day, much as usual.')
    expect(dayHeadline(day(6, 330, null), false)).toBe('Today at a glance.')
    expect(dayHeadline(day(0, 0, 300), false)).toBe('A quiet day so far.')
    expect(dayHeadline(day(12, 750, 120), true)).toBe('Tomorrow has room to fill.')
  })

  it('compares today with a usual day of the week in plain words', () => {
    expect(
      daySentence({ visits: 12, bookedMinutes: 750, usualBookedMinutes: 120 }, 'Tuesday'),
    ).toBe('Today has 12 visits, about 13 hours of treatment. A usual Tuesday has about 2 hours.')
    expect(daySentence({ visits: 1, bookedMinutes: 60, usualBookedMinutes: 70 }, 'Monday')).toBe(
      'Today has 1 visit, about an hour of treatment. About the same as a usual Monday.',
    )
    expect(daySentence({ visits: 4, bookedMinutes: 240, usualBookedMinutes: null }, 'Friday')).toBe(
      'Today has 4 visits, about 4 hours of treatment.',
    )
    expect(daySentence({ visits: 0, bookedMinutes: 0, usualBookedMinutes: 120 }, 'Friday')).toBe(
      'Nothing is booked today yet.',
    )
  })

  it('names the day of the week in the studio’s language', () => {
    expect(weekdayName('2026-10-06', 'en-GB')).toBe('Tuesday')
    expect(weekdayName('2026-10-06', 'en-US')).toBe('Tuesday')
  })
})
