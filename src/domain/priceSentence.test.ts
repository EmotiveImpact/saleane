import { describe, expect, it } from 'vitest'
import { addedTaxMinor, fullPriceMinor, priceSentence } from './priceSentence'

const uk = { locale: 'en-GB', currency: 'GBP' } as const
const us = { locale: 'en-US', currency: 'USD' } as const
const facial = { priceMinor: 8500, depositMinor: 2000, durationMinutes: 60 }

describe('all-in price sentence', () => {
  it('states the full price, the length and the deposit', () => {
    expect(priceSentence(facial, uk)).toBe(
      '£85 for 60 minutes. £20 deposit when you book, the rest at the studio.',
    )
  })

  it('says when everything is paid at the studio', () => {
    expect(priceSentence({ ...facial, depositMinor: 0 }, uk)).toBe(
      '£85 for 60 minutes, paid at the studio.',
    )
  })

  it('formats US studios in dollars', () => {
    expect(priceSentence({ priceMinor: 12050, depositMinor: 2500, durationMinutes: 90 }, us)).toBe(
      '$120.50 for 90 minutes. $25 deposit when you book, the rest at the studio.',
    )
  })

  it('marks a sample studio deposit as simulated', () => {
    expect(priceSentence(facial, uk, { simulated: true })).toBe(
      '£85 for 60 minutes. £20 simulated deposit when you book, the rest at the studio.',
    )
  })

  it('handles a deposit that covers the whole price', () => {
    expect(priceSentence({ ...facial, depositMinor: 8500 }, uk)).toBe(
      '£85 for 60 minutes. Paid in full when you book.',
    )
  })

  it('puts added tax inside the headline price, never on top of it', () => {
    const vat = { label: 'VAT', rateBps: 2000, inclusive: false }
    expect(addedTaxMinor(8500, vat)).toBe(1700)
    expect(fullPriceMinor(facial, vat)).toBe(10200)
    expect(priceSentence(facial, uk, { tax: vat })).toBe(
      '£102 for 60 minutes, including £17 VAT. £20 deposit when you book, the rest at the studio.',
    )
    const sales = { label: 'Sales tax', rateBps: 888, inclusive: false }
    expect(priceSentence({ ...facial, depositMinor: 0 }, us, { tax: sales })).toBe(
      '$92.55 for 60 minutes, including $7.55 sales tax, paid at the studio.',
    )
  })

  it('names tax already included in the price without changing it', () => {
    const vat = { label: 'VAT', rateBps: 2000, inclusive: true }
    expect(fullPriceMinor(facial, vat)).toBe(8500)
    expect(priceSentence({ ...facial, depositMinor: 0 }, uk, { tax: vat })).toBe(
      '£85 for 60 minutes, including VAT, paid at the studio.',
    )
    expect(priceSentence(facial, uk, { tax: { ...vat, rateBps: 0 } })).toBe(
      '£85 for 60 minutes. £20 deposit when you book, the rest at the studio.',
    )
  })

  it('reads naturally for free and very short services', () => {
    expect(priceSentence({ priceMinor: 0, depositMinor: 0, durationMinutes: 15 }, uk)).toBe(
      'No charge for 15 minutes.',
    )
    expect(priceSentence({ priceMinor: 500, depositMinor: 0, durationMinutes: 1 }, uk)).toBe(
      '£5 for 1 minute, paid at the studio.',
    )
  })
})
