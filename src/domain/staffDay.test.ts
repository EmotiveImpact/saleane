import { describe, expect, it } from 'vitest'
import { seed } from './seed'
import { DEMO_DATE } from './model'
import { staffDay } from './selectors'
import { operations } from './operations'

describe('a professional’s day for narrow screens', () => {
  it('interleaves visits with free time that covers the whole working day', () => {
    const state = seed('UK')
    const person = state.appointments.find((a) => a.date === DEMO_DATE)!.staffId
    const day = staffDay(state, person, DEMO_DATE)
    expect(day.working).toBe(true)
    expect(day.visits).toBeGreaterThan(0)
    let through = day.start
    for (const segment of day.segments) {
      expect(segment.from).toBeGreaterThanOrEqual(through)
      through = segment.to
    }
    expect(through).toBeLessThanOrEqual(day.end)
    const free = day.segments.filter((s) => s.kind === 'free')
    expect(free.every((s) => s.to - s.from >= 15)).toBe(true)
    expect(day.freeMinutes).toBe(free.reduce((sum, s) => sum + s.to - s.from, 0))
  })
  it('shows a closure in place of free time', () => {
    const state = seed('UK')
    const person = state.staff[0].id
    const ops = operations(state)
    const empty = staffDay(state, person, '2030-01-08')
    state.operations = {
      ...ops,
      closures: [
        {
          id: 'closure-1',
          date: '2030-01-08',
          staffId: person,
          startMinutes: empty.start + 60,
          endMinutes: empty.start + 120,
          reason: 'Training',
        },
      ],
    }
    const day = staffDay(state, person, '2030-01-08')
    expect(empty.working).toBe(true)
    expect(day.segments.map((s) => s.kind)).toEqual(['free', 'closed', 'free'])
    expect(day.freeMinutes).toBe(empty.freeMinutes - 60)
  })
})
