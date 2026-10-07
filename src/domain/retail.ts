import type { BusinessState, Sale } from './model'
import type { Operations, Tax } from './operations'
import { operations, stock } from './operations'
import type { RetailItems, SaleRetail } from './retailSchema'

/**
 * V2: stock and retail at the till. Products live in the studio's operating record with a running
 * ledger of movements (deliveries, use in treatments, sales and count corrections). Products sold
 * with a visit appear on that visit's receipt, and each sale takes its own movement out of stock
 * with the receipt's ID, so the stock ledger and the money ledger can be checked against each other.
 */
export type Product = Operations['products'][number]
export type Movement = Operations['movements'][number]

export const products = (s: BusinessState) => operations(s).products
/** Can be sold at the till: still stocked, and not kept only for treatments. */
export const sellable = (product: Product) => !product.archived && product.forSale !== false

/** Tax on a product total, worked out the same way as on a service. */
export function retailTaxMinor(subtotalMinor: number, tax: Tax | null | undefined) {
  if (!tax) return 0
  return Math.round(
    tax.inclusive
      ? (subtotalMinor * tax.rateBps) / (10000 + tax.rateBps)
      : (subtotalMinor * tax.rateBps) / 10000,
  )
}

/** What the products add to the receipt total: their price plus any tax added on top. */
export function retailCharge(retail: SaleRetail | undefined) {
  return retail ? retail.subtotalMinor + (retail.taxInclusive ? 0 : retail.taxMinor) : 0
}

/** Product takings without tax, the retail counterpart of service revenue. */
export function retailRevenue(sale: Pick<Sale, 'retail'>) {
  const retail = sale.retail
  return retail ? retail.subtotalMinor - (retail.taxInclusive ? retail.taxMinor : 0) : 0
}

/**
 * Prices the products the desk added, at today's catalogue prices and tax, after checking each one
 * is on sale and in stock. Returns nothing when no products were added.
 */
export function priceRetail(
  s: BusinessState,
  items: RetailItems | undefined,
): SaleRetail | undefined {
  if (!items?.length) return undefined
  const config = operations(s)
  const lines = items.map((item) => {
    const product = config.products.find((p) => p.id === item.productId)
    if (!product || !sellable(product)) throw new Error('Choose products that are on sale here.')
    const left = stock(s, product.id)
    if (left < item.quantity)
      throw new Error(
        left > 0
          ? `Only ${left} ${product.name} left in stock.`
          : `${product.name} is out of stock. Record the delivery in Stock first.`,
      )
    return {
      productId: product.id,
      name: product.name,
      quantity: item.quantity,
      unitMinor: product.priceMinor,
    }
  })
  const subtotalMinor = lines.reduce((sum, line) => sum + line.quantity * line.unitMinor, 0)
  const tax = config.tax
  return {
    lines,
    subtotalMinor,
    taxMinor: retailTaxMinor(subtotalMinor, tax),
    taxRateBps: tax?.rateBps ?? 0,
    taxInclusive: tax?.inclusive ?? false,
    taxLabel: tax?.label ?? '',
  }
}

/** Takes each sold product out of stock against the receipt. `next` is the working copy. */
export function recordRetailMovements(
  next: BusinessState,
  sale: Pick<Sale, 'id' | 'appointmentId' | 'receiptNumber'>,
  retail: SaleRetail,
  now: string,
  makeId: () => string,
  actor = 'Local operator',
) {
  next.operations ??= operations(next)
  for (const line of retail.lines)
    next.operations.movements.push({
      id: makeId(),
      productId: line.productId,
      quantity: -line.quantity,
      reason: 'retail',
      note: `Sold on receipt ${sale.receiptNumber ?? ''}`.trim(),
      createdAt: now,
      actor,
      appointmentId: sale.appointmentId,
      saleId: sale.id,
    })
}

/** Checks every receipt's products against its prices, tax and stock movements. */
export function retailProblem(s: BusinessState): string | null {
  const config = operations(s)
  const salesById = new Map(s.sales.map((sale) => [sale.id, sale]))
  const moved = new Map<string, Map<string, number>>()
  for (const movement of config.movements) {
    if (!movement.saleId) continue
    const sale = salesById.get(movement.saleId)
    if (!sale || movement.reason !== 'retail' || movement.appointmentId !== sale.appointmentId)
      return 'A stock sale does not match its receipt.'
    const bySale = moved.get(sale.id) ?? new Map<string, number>()
    bySale.set(movement.productId, (bySale.get(movement.productId) ?? 0) - movement.quantity)
    moved.set(sale.id, bySale)
  }
  for (const sale of s.sales) {
    const retail = sale.retail
    const bySale = moved.get(sale.id)
    if (!retail) {
      if (bySale) return 'A stock sale does not match its receipt.'
      continue
    }
    const tax = { rateBps: retail.taxRateBps, inclusive: retail.taxInclusive, label: '' }
    if (
      new Set(retail.lines.map((line) => line.productId)).size !== retail.lines.length ||
      retail.subtotalMinor !==
        retail.lines.reduce((sum, line) => sum + line.quantity * line.unitMinor, 0) ||
      retail.taxMinor !== retailTaxMinor(retail.subtotalMinor, tax) ||
      retail.lines.some((line) => !config.products.some((p) => p.id === line.productId))
    )
      return 'Invalid product receipt.'
    if (
      !bySale ||
      bySale.size !== retail.lines.length ||
      retail.lines.some((line) => bySale.get(line.productId) !== line.quantity)
    )
      return 'Products on a receipt must match the stock that left.'
  }
  return null
}

/** Each product with what is on the shelf, whether to reorder, and its value at cost. */
export function stockSummary(s: BusinessState) {
  return products(s).map((product) => {
    const onHand = stock(s, product.id)
    return {
      product,
      onHand,
      low: !product.archived && onHand <= product.reorderAt,
      valueMinor: product.costMinor === undefined ? undefined : onHand * product.costMinor,
    }
  })
}

/** Units and takings for each product sold on the given receipts. */
export function retailByProduct(sales: Pick<Sale, 'retail'>[]) {
  const rows = new Map<string, { productId: string; name: string; units: number; minor: number }>()
  for (const sale of sales)
    for (const line of sale.retail?.lines ?? []) {
      const row = rows.get(line.productId) ?? {
        productId: line.productId,
        name: line.name,
        units: 0,
        minor: 0,
      }
      row.units += line.quantity
      row.minor += line.quantity * line.unitMinor
      rows.set(line.productId, row)
    }
  return [...rows.values()].sort((a, b) => b.minor - a.minor)
}
