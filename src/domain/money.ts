import type { Operations } from './operations'

/**
 * Converts a typed major-unit amount ("85", "85.5", "85.50") to integer minor units without
 * floating-point multiplication. Anything else, including more than two decimals, is NaN so the
 * command schema rejects it rather than silently rounding.
 */
export function parseMinor(value: unknown, empty = Number.NaN): number {
  const text = String(value ?? '').trim()
  if (!text) return empty
  const match = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(text)
  if (!match) return Number.NaN
  return Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'))
}

/** Formats integer minor units as a plain major-unit input value, such as "12.83". */
export function minorInput(amountMinor: number) {
  return (amountMinor / 100).toFixed(2)
}

export type CheckoutTotals = {
  netMinor: number
  taxMinor: number
  totalMinor: number
  balanceMinor: number
}

/**
 * The single checkout calculation shared by the checkout preview and the recorded receipt.
 * Tips are outside the configured service tax. Inclusive tax is extracted from the net price.
 */
export function checkoutTotals(input: {
  priceMinor: number
  discountMinor: number
  tipMinor: number
  depositMinor: number
  tax: Operations['tax']
}): CheckoutTotals {
  const netMinor = input.priceMinor - input.discountMinor
  const tax = input.tax
  const taxMinor = tax
    ? Math.round(
        tax.inclusive
          ? (netMinor * tax.rateBps) / (10000 + tax.rateBps)
          : (netMinor * tax.rateBps) / 10000,
      )
    : 0
  const totalMinor = netMinor + input.tipMinor + (tax?.inclusive ? 0 : taxMinor)
  return { netMinor, taxMinor, totalMinor, balanceMinor: totalMinor - input.depositMinor }
}
