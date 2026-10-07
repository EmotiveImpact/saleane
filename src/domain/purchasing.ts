import type { BusinessState } from './model'
import { operations } from './operations'
import { hasLocations, placeField, placeOf } from './locations'
import { ORDER_LIMIT, SUPPLIER_LIMIT } from './purchasingSchema'
import type { PurchaseOrder } from './purchasingSchema'
import { products, stockSummary } from './retail'

/**
 * V2: reordering from suppliers. SALEANE suggests what to order when stock runs low, keeps the
 * orders the studio places and puts a delivery on the shelf when it arrives. It never sends an
 * order to a supplier.
 */

export function suppliers(s: BusinessState) {
  return operations(s).suppliers ?? []
}

/** How many to order of a product that is running low. */
export function suggestedQuantity(
  product: { reorderAt: number; reorderQuantity?: number },
  onHand: number,
) {
  return product.reorderQuantity ?? Math.max(1, product.reorderAt * 2 - onHand)
}

/** Products on order and not yet received, by product. */
export function onOrder(s: BusinessState) {
  const rows = new Map<string, number>()
  for (const order of operations(s).purchaseOrders ?? [])
    if (order.status === 'ordered')
      for (const line of order.lines)
        rows.set(line.productId, (rows.get(line.productId) ?? 0) + line.quantity)
  return rows
}

/** Low products not already on order, grouped by supplier; products without one come last. */
export function suggestedOrders(s: BusinessState) {
  const ordered = onOrder(s)
  const groups = new Map<
    string,
    { productId: string; name: string; onHand: number; quantity: number }[]
  >()
  for (const row of stockSummary(s)) {
    if (!row.low || ordered.has(row.product.id)) continue
    const key = row.product.supplierId ?? ''
    groups.set(key, [
      ...(groups.get(key) ?? []),
      {
        productId: row.product.id,
        name: row.product.name,
        onHand: row.onHand,
        quantity: suggestedQuantity(row.product, row.onHand),
      },
    ])
  }
  return [...groups.entries()]
    .map(([supplierId, lines]) => ({
      supplier: suppliers(s).find((x) => x.id === supplierId && !x.archived),
      lines,
    }))
    .sort((a, b) => Number(!a.supplier) - Number(!b.supplier))
}

/** Plain words to paste into an email or read out on the phone. */
export function orderText(
  s: BusinessState,
  order: Pick<PurchaseOrder, 'number' | 'supplierId' | 'lines' | 'note' | 'locationId'>,
) {
  // V2: with several locations the supplier needs to know where to deliver.
  const site = hasLocations(s) || order.locationId ? placeOf(s, order.locationId) : undefined
  const supplier = suppliers(s).find((x) => x.id === order.supplierId)
  const name = (id: string) => products(s).find((p) => p.id === id)
  return [
    `Order ${order.number} from ${s.organisation.name}`,
    supplier ? `For ${supplier.name}` : '',
    '',
    ...order.lines.map((line) => {
      const product = name(line.productId)
      return `${line.quantity} × ${product?.name ?? 'Product'}${product?.sku ? ` (${product.sku})` : ''}`
    }),
    ...(site ? ['', `Please deliver to ${site.name}, ${site.address}`] : []),
    ...(order.note ? ['', order.note] : []),
  ]
    .filter((line, i, all) => line || (i > 0 && all[i - 1]))
    .join('\n')
}

export function saveSupplier(
  next: BusinessState,
  command: { id?: string; input: Omit<NonNullable<ReturnType<typeof suppliers>>[number], 'id'> },
  makeId: () => string,
) {
  const o = (next.operations ??= operations(next))
  o.suppliers ??= []
  const old = command.id ? o.suppliers.find((x) => x.id === command.id) : undefined
  if (command.id && !old) throw new Error('Supplier not found.')
  if (
    o.suppliers.some(
      (x) => x.id !== command.id && x.name.toLowerCase() === command.input.name.toLowerCase(),
    )
  )
    throw new Error('A supplier with this name already exists.')
  if (!old && o.suppliers.length >= SUPPLIER_LIMIT) throw new Error('Too many suppliers to keep.')
  const clean = Object.fromEntries(
    Object.entries(command.input).filter(([, value]) => value !== undefined && value !== ''),
  ) as typeof command.input
  const supplier = { ...clean, id: old?.id ?? makeId() }
  if (old) o.suppliers[o.suppliers.indexOf(old)] = supplier
  else o.suppliers.push(supplier)
  return supplier.id
}

export function placeOrder(
  next: BusinessState,
  command: {
    supplierId: string
    lines: { productId: string; quantity: number }[]
    note?: string
    locationId?: string
  },
  now: string,
  makeId: () => string,
) {
  const o = (next.operations ??= operations(next))
  if (!suppliers(next).some((x) => x.id === command.supplierId && !x.archived))
    throw new Error('Choose a supplier.')
  for (const line of command.lines)
    if (!o.products.some((p) => p.id === line.productId && !p.archived))
      throw new Error('Choose products that are still stocked.')
  if (command.locationId) {
    const site = placeOf(next, command.locationId)
    if (!site || site.archived) throw new Error('Choose an open location for the delivery.')
  }
  o.purchaseOrders ??= []
  if (o.purchaseOrders.length >= ORDER_LIMIT) throw new Error('Too many orders to keep.')
  const order: PurchaseOrder = {
    id: makeId(),
    number: `PO-${o.purchaseOrders.length + 1}`,
    supplierId: command.supplierId,
    lines: command.lines,
    ...(command.note ? { note: command.note } : {}),
    ...placeField(next, command.locationId),
    status: 'ordered',
    createdAt: now,
    actor: 'Local operator',
  }
  o.purchaseOrders.push(order)
  return order
}

export function receiveOrder(
  next: BusinessState,
  command: { orderId: string; received: { productId: string; quantity: number }[] },
  now: string,
  makeId: () => string,
) {
  const o = (next.operations ??= operations(next))
  const order = o.purchaseOrders?.find((x) => x.id === command.orderId)
  if (!order) throw new Error('Order not found.')
  if (order.status !== 'ordered') throw new Error('This order is already closed.')
  const ordered = new Set(order.lines.map((l) => l.productId))
  if (
    command.received.length !== ordered.size ||
    command.received.some((r) => !ordered.has(r.productId))
  )
    throw new Error('Say how many of each ordered product arrived.')
  if (!command.received.some((r) => r.quantity > 0))
    throw new Error('Nothing arrived. Cancel the order instead.')
  for (const line of command.received)
    if (line.quantity > 0)
      o.movements.push({
        id: makeId(),
        productId: line.productId,
        quantity: line.quantity,
        reason: 'received',
        note: `Delivery on order ${order.number}`,
        createdAt: now,
        actor: 'Local operator',
        purchaseOrderId: order.id,
        ...placeField(next, order.locationId),
      })
  order.status = 'received'
  order.received = command.received
  order.closedAt = now
  order.closedBy = 'Local operator'
  return order.id
}

export function cancelOrder(next: BusinessState, orderId: string, now: string) {
  const order = operations(next).purchaseOrders?.find((x) => x.id === orderId)
  if (!order) throw new Error('Order not found.')
  if (order.status !== 'ordered') throw new Error('This order is already closed.')
  order.status = 'cancelled'
  order.closedAt = now
  order.closedBy = 'Local operator'
  return order.id
}

/** Checks suppliers, orders and their deliveries; returns a problem or null. */
export function purchasingProblem(s: BusinessState): string | null {
  const o = operations(s)
  const orders = o.purchaseOrders ?? []
  const supplierIds = new Set(suppliers(s).map((x) => x.id))
  const productIds = new Set(o.products.map((p) => p.id))
  for (const product of o.products)
    if (product.supplierId && !supplierIds.has(product.supplierId))
      return 'A product names a missing supplier.'
  if (new Set(orders.map((x) => x.number)).size !== orders.length)
    return 'Two orders share a number.'
  for (const order of orders) {
    if (!supplierIds.has(order.supplierId)) return 'An order names a missing supplier.'
    if (order.lines.some((l) => !productIds.has(l.productId)))
      return 'An order names a missing product.'
    if ((order.status === 'ordered') !== !order.closedAt)
      return 'An order is open and closed at once.'
    if ((order.status === 'received') !== !!order.received)
      return 'A received order must say what arrived.'
    const delivered = new Map<string, number>()
    for (const m of o.movements)
      if (m.purchaseOrderId === order.id) {
        if (m.reason !== 'received' || m.quantity <= 0) return 'An order delivery must add stock.'
        delivered.set(m.productId, (delivered.get(m.productId) ?? 0) + m.quantity)
      }
    for (const line of order.received ?? [])
      if ((delivered.get(line.productId) ?? 0) !== line.quantity)
        return 'An order delivery does not match the stock that arrived.'
    if (order.status !== 'received' && delivered.size)
      return 'Stock arrived on an order not received.'
  }
  if (o.movements.some((m) => m.purchaseOrderId && !orders.some((x) => x.id === m.purchaseOrderId)))
    return 'A delivery names a missing order.'
  return null
}
