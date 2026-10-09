import { describe, expect, it } from 'vitest'
import { checkoutTotals, minorInput, parseMinor } from './money'
import { money, wholeMoney } from './format'
import { seed } from './seed'

describe('money input and display', () => {
  it('parses typed amounts to exact minor units', () => {
    expect(parseMinor('85')).toBe(8500)
    expect(parseMinor('85.5')).toBe(8550)
    expect(parseMinor(' 85.50 ')).toBe(8550)
    expect(parseMinor('0.29')).toBe(29)
    expect(parseMinor('1.15')).toBe(115)
    expect(parseMinor('4.35')).toBe(435)
  })
  it('rejects amounts it would otherwise round or misread', () => {
    for (const value of ['12.555', '-1', '1e2', 'abc', '.5', '5.', '1,000'])
      expect(parseMinor(value)).toBeNaN()
    expect(parseMinor('')).toBeNaN()
    expect(parseMinor('', 0)).toBe(0)
    expect(parseMinor(null)).toBeNaN()
  })
  it('formats minor units as a two-decimal input value', () => {
    expect(minorInput(1283)).toBe('12.83')
    expect(minorInput(0)).toBe('0.00')
  })
  it('keeps both decimal digits when an amount has pence or cents', () => {
    const uk = seed('UK').organisation,
      us = seed('US').organisation
    expect(money(8550, uk)).toBe('£85.50')
    expect(money(8500, uk)).toBe('£85')
    expect(money(1205, us)).toBe('$12.05')
    expect(money(8500, uk, true)).toBe('£85.00')
  })
  it('rounds headline figures to whole pounds and dollars', () => {
    const uk = seed('UK').organisation,
      us = seed('US').organisation
    expect(wholeMoney(36940, uk)).toBe('£369')
    expect(wholeMoney(119960, uk)).toBe('£1,200')
    expect(wholeMoney(9231, uk)).toBe('£92')
    expect(wholeMoney(0, uk)).toBe('£0')
    expect(wholeMoney(1250, us)).toBe('$13')
  })
})

describe('the shared checkout calculation', () => {
  const base = { priceMinor: 8550, discountMinor: 550, tipMinor: 1200, depositMinor: 2000 }
  it('adds exclusive tax to the discounted service, not the tip', () => {
    expect(
      checkoutTotals({ ...base, tax: { rateBps: 2000, inclusive: false, label: 'VAT' } }),
    ).toEqual({ netMinor: 8000, taxMinor: 1600, totalMinor: 10800, balanceMinor: 8800 })
  })
  it('extracts inclusive tax without changing the total', () => {
    expect(
      checkoutTotals({ ...base, tax: { rateBps: 2000, inclusive: true, label: 'VAT' } }),
    ).toEqual({ netMinor: 8000, taxMinor: 1333, totalMinor: 9200, balanceMinor: 7200 })
  })
  it('records no tax when none is configured', () => {
    expect(checkoutTotals({ ...base, tax: undefined })).toEqual({
      netMinor: 8000,
      taxMinor: 0,
      totalMinor: 9200,
      balanceMinor: 7200,
    })
  })
})
