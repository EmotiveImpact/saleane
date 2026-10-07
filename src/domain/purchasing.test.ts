import { describe, expect, it } from 'vitest'
import { dispatch, execute } from './commands'
import type { Command } from './commands'
import type { BusinessState } from './model'
import { parseState } from './model'
import { can, permissionFor, stock } from './operations'
import { createWorkspace } from './workspace'
import { seed } from './seed'
import { onOrder, orderText, suggestedOrders } from './purchasing'

// V2: reordering from suppliers.
const now = '2026-10-06T08:00:00.000Z'
let sequence = 0
function run(s: BusinessState, command: Command, at = now) {
  return execute(s, command, at, () => `po-${++sequence}`)
}
function apply(s: BusinessState, command: Command, at = now) {
  const result = run(s, command, at)
  if (!result.ok) throw new Error(result.error)
  return result.state
}
/** A studio with one supplier and a balm down to 1, reordered 6 at a time. */
function studio() {
  let s = createWorkspace({ name: 'Order test studio', region: 'UK' })
  s = apply(s, { type: 'supplier', input: { name: 'Fictional Supply Co' } })
  const supplierId = s.operations!.suppliers![0].id
  s = apply(s, {
    type: 'product',
    input: {
      name: 'Cleansing Balm',
      sku: 'BALM',
      priceMinor: 3200,
      reorderAt: 2,
      archived: false,
      supplierId,
      reorderQuantity: 6,
    },
  })
  const balmId = s.operations!.products[0].id
  s = apply(s, { type: 'stock', productId: balmId, quantity: 1, reason: 'received', note: 'In' })
  return { s, supplierId, balmId }
}
const order = (supplierId: string, productId: string, quantity = 6) =>
  ({ type: 'purchase-order', supplierId, lines: [{ productId, quantity }] }) as Command

describe('orders from suppliers', () => {
  it('suggests low products by supplier, with the usual quantity', () => {
    const { s, supplierId, balmId } = studio()
    const [group] = suggestedOrders(s)
    expect(group.supplier?.id).toBe(supplierId)
    expect(group.lines).toEqual([
      { productId: balmId, name: 'Cleansing Balm', onHand: 1, quantity: 6 },
    ])
  })

  it('records an order, stops suggesting it, and puts what arrived on the shelf once', () => {
    const { s: start, supplierId, balmId } = studio()
    let s = apply(start, order(supplierId, balmId))
    const placed = s.operations!.purchaseOrders![0]
    expect(placed).toMatchObject({ number: 'PO-1', status: 'ordered' })
    expect(onOrder(s).get(balmId)).toBe(6)
    expect(suggestedOrders(s)).toEqual([])
    expect(orderText(s, placed)).toContain('6 × Cleansing Balm (BALM)')
    // Five of six arrived.
    const result = dispatch(
      s,
      { type: 'receive-order', orderId: placed.id, received: [{ productId: balmId, quantity: 5 }] },
      'Ava · owner',
      now,
    )
    if (!result.ok) throw new Error(result.error)
    s = result.state
    expect(stock(s, balmId)).toBe(6)
    expect(s.operations!.purchaseOrders![0]).toMatchObject({
      status: 'received',
      closedBy: 'Ava · owner',
    })
    expect(s.operations!.movements.at(-1)).toMatchObject({
      reason: 'received',
      purchaseOrderId: placed.id,
      actor: 'Ava · owner',
    })
    expect(
      run(s, {
        type: 'receive-order',
        orderId: placed.id,
        received: [{ productId: balmId, quantity: 5 }],
      } as Command).ok,
    ).toBe(false)
  })

  it('cancels an order without touching stock', () => {
    const { s: start, supplierId, balmId } = studio()
    let s = apply(start, order(supplierId, balmId))
    const id = s.operations!.purchaseOrders![0].id
    s = apply(s, { type: 'cancel-order', orderId: id })
    expect(stock(s, balmId)).toBe(1)
    expect(s.operations!.purchaseOrders![0].status).toBe('cancelled')
    expect(suggestedOrders(s)).toHaveLength(1)
    expect(run(s, { type: 'cancel-order', orderId: id }).ok).toBe(false)
  })

  it('refuses an unknown supplier, a duplicate name and a receipt that leaves a product out', () => {
    const { s, supplierId, balmId } = studio()
    expect(run(s, order('nobody', balmId)).ok).toBe(false)
    expect(run(s, { type: 'supplier', input: { name: 'fictional supply co' } }).ok).toBe(false)
    const placed = apply(s, order(supplierId, balmId))
    const id = placed.operations!.purchaseOrders![0].id
    expect(
      run(placed, {
        type: 'receive-order',
        orderId: id,
        received: [{ productId: balmId, quantity: 0 }],
      } as Command).ok,
    ).toBe(false)
    expect(
      run(placed, {
        type: 'receive-order',
        orderId: id,
        received: [{ productId: 'other', quantity: 1 }],
      } as Command).ok,
    ).toBe(false)
  })

  it('lets owners and managers order, not reception', () => {
    for (const type of ['supplier', 'purchase-order', 'receive-order', 'cancel-order']) {
      expect(can('manager', permissionFor({ type }))).toBe(true)
      expect(can('reception', permissionFor({ type }))).toBe(false)
    }
  })

  it('keeps deliveries and orders consistent in the ledger', () => {
    for (const region of ['UK', 'US'] as const) {
      const s = seed(region)
      expect(s.operations!.purchaseOrders![0].status).toBe('ordered')
    }
    const { s: start, supplierId, balmId } = studio()
    const placed = apply(start, order(supplierId, balmId))
    const received = apply(placed, {
      type: 'receive-order',
      orderId: placed.operations!.purchaseOrders![0].id,
      received: [{ productId: balmId, quantity: 6 }],
    } as Command)
    const tampered = structuredClone(received)
    tampered.operations!.movements.at(-1)!.quantity = 7
    expect(() => parseState(tampered, 'UK')).toThrow('does not match')
    const missing = structuredClone(received)
    missing.operations!.products[0].supplierId = 'gone'
    expect(() => parseState(missing, 'UK')).toThrow('missing supplier')
  })
})
