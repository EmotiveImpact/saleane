import { describe, expect, it } from 'vitest'
import { barHeight, chartScale } from './chartScale'
import { money } from './format'

// Stage 6: the Business chart's axis never shows a penny it made up.
const uk = { locale: 'en-GB' as const, currency: 'GBP' as const }
const us = { locale: 'en-US' as const, currency: 'USD' as const }
const labels = (values: number[], org: typeof uk | typeof us) => {
  const scale = chartScale(values)
  return scale.top ? [money(scale.top, org), money(scale.half, org)] : []
}

describe('the money axis of a chart', () => {
  it('says only zero when nothing was taken, in every currency', () => {
    expect(chartScale([])).toEqual({ top: 0, half: 0 })
    expect(chartScale([0, 0, 0, 0, 0, 0, 0])).toEqual({ top: 0, half: 0 })
    expect(labels([0, 0, 0], uk)).toEqual([])
    expect(labels([0, 0, 0], us)).toEqual([])
    expect(barHeight(0, chartScale([0]))).toBe(0)
  })

  it('rounds the top up to a round whole figure that halves to whole pounds', () => {
    expect(labels([1], uk)).toEqual(['£2', '£1'])
    expect(labels([150], uk)).toEqual(['£2', '£1'])
    expect(labels([8_550], uk)).toEqual(['£100', '£50'])
    expect(labels([12_345], uk)).toEqual(['£200', '£100'])
    expect(labels([41_000, 2_000], uk)).toEqual(['£600', '£300'])
    expect(labels([60_000], uk)).toEqual(['£600', '£300'])
    expect(labels([123_456_78], uk)).toEqual(['£200,000', '£100,000'])
    expect(labels([9_999], us)).toEqual(['$100', '$50'])
    expect(labels([30_001], us)).toEqual(['$400', '$200'])
  })

  it('never shows a part of a pound or dollar on the axis', () => {
    for (let v = 1; v < 5_000_000; v = Math.ceil(v * 1.37)) {
      const { top, half } = chartScale([v])
      expect(top % 100, String(v)).toBe(0)
      expect(half % 100, String(v)).toBe(0)
      expect(top).toBeGreaterThanOrEqual(v)
      // Never more than about two and a half times the highest bar, so the bars keep their size.
      expect(top / Math.max(v, 100)).toBeLessThanOrEqual(2.5)
    }
  })

  it('draws each bar as a share of the axis, never past the top', () => {
    const scale = chartScale([5_000, 2_500, 0])
    expect(scale.top).toBe(6_000)
    expect(barHeight(5_000, scale)).toBeCloseTo(83.33, 1)
    expect(barHeight(0, scale)).toBe(0)
    expect(barHeight(-100, scale)).toBe(0)
    expect(barHeight(9_000, scale)).toBe(100)
  })

  it('leaves out anything that is not a number', () => {
    expect(chartScale([Number.NaN, 4_000])).toEqual({ top: 4_000, half: 2_000 })
  })
})
