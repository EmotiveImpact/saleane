import { describe, expect, it } from 'vitest'
import { seed } from './seed'
import { businessDate } from './operations'
import { BENCHMARK_MIN_STUDIOS, compare, measureLabel, studioMeasures } from './benchmark'
import type { Measures } from './benchmark'

// V5: comparing with similar studios.
const m = (averageVisit: number, rebookRate: number, noShowRate: number, returnRate = 0.5) =>
  ({ averageVisit, rebookRate, noShowRate, returnRate }) satisfies Measures

describe('how a studio compares', () => {
  it('reduces a studio to rates and averages, or nothing with too few visits', () => {
    const s = seed('UK')
    const own = studioMeasures(s, businessDate(s))!
    expect(Object.keys(own).sort()).toEqual([
      'averageVisit',
      'noShowRate',
      'rebookRate',
      'returnRate',
    ])
    expect(own.rebookRate).toBeGreaterThanOrEqual(0)
    expect(own.rebookRate).toBeLessThanOrEqual(1)
    expect(
      studioMeasures({ ...s, appointments: s.appointments.slice(0, 5) }, businessDate(s)),
    ).toBe(null)
  })

  it('says nothing until enough other studios share', () => {
    const others = Array.from({ length: BENCHMARK_MIN_STUDIOS - 1 }, () => m(8000, 0.4, 0.05))
    expect(compare(m(8000, 0.4, 0.05), others)).toBeNull()
    expect(compare(null, [...others, m(1, 1, 1)])).toBeNull()
  })

  it('places a studio ahead, typical or behind, with fewer missed visits counted as better', () => {
    const others = [
      m(6000, 0.2, 0.02),
      m(7000, 0.3, 0.04),
      m(8000, 0.4, 0.06),
      m(9000, 0.5, 0.08),
      m(10000, 0.6, 0.1),
    ]
    const view = compare(m(12000, 0.4, 0.01, 0.1), others)!
    const at = (key: string) => view.find((c) => c.key === key)!
    expect(at('averageVisit')).toMatchObject({
      median: 8000,
      low: 7000,
      high: 9000,
      position: 'ahead',
    })
    expect(at('rebookRate').position).toBe('typical')
    expect(at('noShowRate').position).toBe('ahead')
    expect(at('returnRate').position).toBe('behind')
    expect(measureLabel('averageVisit', 8049, { locale: 'en-GB', currency: 'GBP' })).toBe('£80')
    expect(measureLabel('rebookRate', 0.456, { locale: 'en-GB', currency: 'GBP' })).toBe('46%')
  })
})
