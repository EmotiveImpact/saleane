import { describe, expect, it } from 'vitest'
import { seed } from './seed'
import { businessDate } from './operations'
import {
  BENCHMARK_MIN_STUDIOS,
  coarse,
  compare,
  measureLabel,
  perOwner,
  studioMeasures,
} from './benchmark'
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
    // Ten owners, spread evenly: £60 to £105, 15% to 60% rebooked, 1% to 10% missed.
    const others = Array.from({ length: 10 }, (_, i) =>
      m(6000 + i * 500, 0.15 + i * 0.05, 0.01 + i * 0.01),
    )
    const view = compare(m(12000, 0.4, 0.005, 0.1), others)!
    const at = (key: string) => view.find((c) => c.key === key)!
    expect(at('averageVisit')).toMatchObject({
      low: 7000,
      median: 8500,
      high: 9500,
      position: 'ahead',
    })
    expect(at('rebookRate').position).toBe('typical')
    expect(at('noShowRate').position).toBe('ahead')
    expect(at('returnRate').position).toBe('behind')
    expect(measureLabel('averageVisit', 8049, { locale: 'en-GB', currency: 'GBP' })).toBe('£80')
    expect(measureLabel('rebookRate', 0.456, { locale: 'en-GB', currency: 'GBP' })).toBe('46%')
  })

  it('rounds every spread and counts each owner once', () => {
    expect(coarse('averageVisit', 8249)).toBe(8000)
    expect(coarse('rebookRate', 0.437)).toBe(0.45)
    const [one] = perOwner([[m(6000, 0.2, 0.1), m(8000, 0.4, 0.3)]])
    expect(one).toEqual(m(7000, 0.30000000000000004, 0.2))
    // No reported figure is any single studio's exact value.
    const others = Array.from({ length: 10 }, (_, i) =>
      m(6123 + i * 371, 0.123 + i * 0.037, 0.021, 0.333),
    )
    const view = compare(m(8000, 0.3, 0.02), others)!
    for (const c of view)
      for (const v of [c.low, c.median, c.high])
        expect(others.some((o) => o[c.key] === v)).toBe(false)
  })
})
