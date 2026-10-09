import type { BusinessState, Sale } from './model'
import type { Operations, Tax } from './operations'
import { hasLocations, placeField, placeOf } from './locations'
import { operations, stock } from './operations'
import type { CounterSale, RetailItems, SaleRetail } from './retailSchema'

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
  /** V2: the location whose shelf it comes off. Absent means the main location. */
  locationId = s.organisation.locationId,
): SaleRetail | undefined {
  if (!items?.length) return undefined
  const config = operations(s)
  const lines = items.map((item) => {
    const product = config.products.find((p) => p.id === item.productId)
    if (!product || !sellable(product)) throw new Error('Choose products that are on sale here.')
    const left = stock(s, product.id, locationId)
    const where = hasLocations(s) ? ` at ${placeOf(s, locationId)?.name ?? 'this location'}` : ''
    if (left < item.quantity)
      throw new Error(
        left > 0
          ? `Only ${left} ${product.name} left in stock${where}.`
          : `${product.name} is out of stock${where}. Record the delivery in Stock first.`,
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
  // Products sold with a visit come off the shelf where the visit is.
  const place = next.appointments.find((a) => a.id === sale.appointmentId)?.locationId
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
      ...placeField(next, place),
    })
}

/** Checks every receipt's products against its prices, tax, stock movements and returns. */
export function retailProblem(s: BusinessState): string | null {
  const config = operations(s)
  const counters = s.counterSales ?? []
  const receipts = new Map<string, { appointmentId?: string; retail?: SaleRetail }>([
    ...s.sales.map((sale) => [sale.id, sale] as const),
    ...counters.map((sale) => [sale.id, sale] as const),
  ])
  const refunds = new Map(config.refunds.map((refund) => [refund.id, refund]))
  const sold = new Map<string, Map<string, number>>()
  const returned = new Map<string, Map<string, number>>()
  const add = (
    rows: Map<string, Map<string, number>>,
    receipt: string,
    product: string,
    n: number,
  ) => {
    const byProduct = rows.get(receipt) ?? new Map<string, number>()
    byProduct.set(product, (byProduct.get(product) ?? 0) + n)
    rows.set(receipt, byProduct)
  }
  for (const movement of config.movements) {
    if (movement.saleId && movement.counterSaleId) return 'A stock movement names two receipts.'
    const receiptId = movement.saleId ?? movement.counterSaleId
    if (!receiptId) {
      if (movement.reason === 'returned' || movement.refundId)
        return 'A returned product must come back with its receipt.'
      continue
    }
    const receipt = receipts.get(receiptId)
    if (
      !receipt ||
      (movement.saleId && !s.sales.some((x) => x.id === movement.saleId)) ||
      (movement.counterSaleId && !counters.some((x) => x.id === movement.counterSaleId)) ||
      (movement.saleId && movement.appointmentId !== receipt.appointmentId)
    )
      return 'A stock sale does not match its receipt.'
    if (movement.reason === 'retail' && !movement.refundId)
      add(sold, receiptId, movement.productId, -movement.quantity)
    else if (movement.reason === 'returned') {
      const refund = movement.refundId ? refunds.get(movement.refundId) : undefined
      if (!refund || (refund.saleId ?? refund.counterSaleId) !== receiptId)
        return 'A returned product must come back with its refund.'
      add(returned, receiptId, movement.productId, movement.quantity)
    } else return 'A stock sale does not match its receipt.'
  }
  for (const [receiptId, receipt] of receipts) {
    const retail = receipt.retail
    const bySale = sold.get(receiptId)
    if (!retail) {
      if (bySale || returned.has(receiptId)) return 'A stock sale does not match its receipt.'
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
    for (const [productId, quantity] of returned.get(receiptId) ?? [])
      if (quantity > (bySale.get(productId) ?? 0)) return 'More products came back than were sold.'
  }
  const sandbox = config.mode === 'sandbox'
  for (const sale of counters)
    if (
      sale.organisationId !== s.organisation.id ||
      sale.currency !== s.organisation.currency ||
      (sale.clientId && !s.clients.some((c) => c.id === sale.clientId)) ||
      (sale.staffId && !s.staff.some((p) => p.id === sale.staffId)) ||
      sale.totalMinor !== retailCharge(sale.retail) ||
      sandbox !== sale.method.startsWith('demo_') ||
      (sale.method === 'external_card' && !sale.reference?.trim()) ||
      config.refunds
        .filter((r) => r.counterSaleId === sale.id)
        .reduce((sum, r) => sum + r.amountMinor, 0) > sale.totalMinor
    )
      return 'Invalid walk-in sale.'
  return null
}

/** How many of each product on a receipt could still come back. */
export function returnable(s: BusinessState, receiptId: string) {
  const config = operations(s)
  const receipt =
    s.sales.find((sale) => sale.id === receiptId) ??
    (s.counterSales ?? []).find((sale) => sale.id === receiptId)
  return (receipt?.retail?.lines ?? []).map((line) => ({
    ...line,
    left:
      line.quantity -
      config.movements
        .filter(
          (m) =>
            m.reason === 'returned' &&
            m.productId === line.productId &&
            (m.saleId ?? m.counterSaleId) === receiptId,
        )
        .reduce((sum, m) => sum + m.quantity, 0),
  }))
}

/**
 * Puts products a guest brought back on the shelf, against the refund that paid them back.
 * `next` is the working copy.
 */
export function restockReturn(
  next: BusinessState,
  receiptId: string,
  refundId: string,
  items: RetailItems,
  now: string,
  makeId: () => string,
) {
  const lines = returnable(next, receiptId)
  next.operations ??= operations(next)
  const kind = next.sales.some((sale) => sale.id === receiptId) ? 'saleId' : 'counterSaleId'
  const appointmentId = next.sales.find((sale) => sale.id === receiptId)?.appointmentId
  for (const item of items) {
    const line = lines.find((l) => l.productId === item.productId)
    if (!line) throw new Error('Only products on this receipt can come back.')
    if (item.quantity > line.left)
      throw new Error(`Only ${line.left} ${line.name} can come back from this receipt.`)
    // It goes back on the shelf it was sold from.
    const sold = next.operations.movements.find(
      (m) =>
        m.reason === 'retail' &&
        m.productId === item.productId &&
        (m.saleId ?? m.counterSaleId) === receiptId,
    )
    next.operations.movements.push({
      id: makeId(),
      productId: item.productId,
      quantity: item.quantity,
      reason: 'returned',
      note: 'Brought back by the guest',
      createdAt: now,
      actor: 'Local operator',
      [kind]: receiptId,
      refundId,
      ...(appointmentId ? { appointmentId } : {}),
      ...placeField(next, sold?.locationId),
    })
  }
}

/** Records products sold without a visit. `next` is the working copy. */
export function sellAtCounter(
  next: BusinessState,
  command: {
    clientId?: string
    staffId?: string
    locationId?: string
    products: RetailItems
    method: CounterSale['method']
    reference?: string
  },
  now: string,
  makeId: () => string,
) {
  if (command.clientId && !next.clients.some((c) => c.id === command.clientId))
    throw new Error('Client does not belong to this studio.')
  if (command.staffId && !next.staff.some((p) => p.id === command.staffId && !p.archived))
    throw new Error('Choose someone on the team.')
  if (command.method === 'external_card' && !command.reference?.trim())
    throw new Error('Enter the card terminal reference.')
  const place = command.locationId ?? next.organisation.locationId
  const site = placeOf(next, place)
  if (!site || site.archived) throw new Error('Choose an open location.')
  const retail = priceRetail(next, command.products, place)!
  next.counterSales ??= []
  const sale: CounterSale = {
    id: makeId(),
    organisationId: next.organisation.id,
    ...(command.clientId ? { clientId: command.clientId } : {}),
    ...(command.staffId ? { staffId: command.staffId } : {}),
    ...placeField(next, place),
    receiptNumber: `SC-${next.counterSales.length + 1}`,
    currency: next.organisation.currency,
    retail,
    totalMinor: retailCharge(retail),
    paidAt: now,
    method: command.method,
    ...(command.reference?.trim() ? { reference: command.reference.trim() } : {}),
    actor: 'Local operator',
  }
  next.counterSales.push(sale)
  next.operations ??= operations(next)
  for (const line of retail.lines)
    next.operations.movements.push({
      id: makeId(),
      productId: line.productId,
      quantity: -line.quantity,
      reason: 'retail',
      note: `Sold without a visit on receipt ${sale.receiptNumber}`,
      createdAt: now,
      actor: 'Local operator',
      counterSaleId: sale.id,
      ...placeField(next, place),
    })
  return sale
}

/**
 * Each product with what is on the shelf, whether to reorder, and its value at cost: at one
 * location when given (V2), otherwise across the studio.
 */
export function stockSummary(s: BusinessState, locationId?: string) {
  return products(s).map((product) => {
    const onHand = stock(s, product.id, locationId)
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
