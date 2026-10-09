import { describe, expect, it } from 'vitest'
import { addMonths, sideBySide, weekSpan, weekStart } from './calendarDays'

const open = { open: 540, close: 1080, closed: false }
const visit = (id: string, startMinutes: number, bookedDurationMinutes = 60) => ({
  id,
  startMinutes,
  bookedDurationMinutes,
})

describe('calendar days', () => {
  it('finds the Monday of a week and the first of another month', () => {
    expect(weekStart('2026-10-06')).toBe('2026-10-05')
    expect(weekStart('2026-10-05')).toBe('2026-10-05')
    expect(weekStart('2026-10-11')).toBe('2026-10-05')
    expect(addMonths('2026-10-06', 1)).toBe('2026-11-01')
    expect(addMonths('2026-01-31', -1)).toBe('2025-12-01')
  })

  it('runs the week’s timeline across its opening hours, on the hour, and around any visit', () => {
    expect(weekSpan([{ hours: open, visits: [] }])).toEqual({ start: 540, end: 1080 })
    // An early visit and a late one widen it; a closed day does not count.
    expect(
      weekSpan([
        { hours: open, visits: [visit('early', 495)] },
        { hours: { open: 420, close: 1320, closed: true }, visits: [] },
        { hours: open, visits: [visit('late', 1050)] },
      ]),
    ).toEqual({ start: 480, end: 1140 })
    expect(weekSpan([{ hours: { ...open, closed: true }, visits: [] }])).toEqual({
      start: 540,
      end: 1080,
    })
  })

  it('sets visits at the same time side by side, and a visit on its own at full width', () => {
    const placed = sideBySide([
      visit('olivia', 540, 75),
      visit('ellie', 540),
      visit('amelia', 570),
      visit('ruby', 660),
      visit('isabel', 720),
      visit('sophie', 720, 30),
      visit('later', 750),
    ])
    expect(Object.fromEntries(placed)).toEqual({
      olivia: { column: 0, columns: 3 },
      ellie: { column: 1, columns: 3 },
      amelia: { column: 2, columns: 3 },
      // Starts after the others end, so it takes the full width.
      ruby: { column: 0, columns: 1 },
      isabel: { column: 0, columns: 2 },
      sophie: { column: 1, columns: 2 },
      // Takes the column Sophie has finished with.
      later: { column: 1, columns: 2 },
    })
  })
})
