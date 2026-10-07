import { describe, expect, it } from 'vitest'
import { dispatch, execute } from './commands'
import type { Command } from './commands'
import type { BusinessState } from './model'
import { parseState } from './model'
import { can, permissionFor, stock } from './operations'
import { createWorkspace } from './workspace'
import { seed } from './seed'
import { holdings } from './plans'
import { cashForDay } from './tillCount'
import { retailByProduct, retailRevenue, stockSummary } from './retail'
import { clientExport } from './privacy'
import { report, serviceRevenue } from './selectors'

// V2: stock and retail at the till.
const now = '2026-10-06T08:00:00.000Z'
let sequence = 0
function local(region: 'UK' | 'US' = 'UK'): BusinessState {
  const s = createWorkspace({ name: 'Retail test studio', region })
  const sample = seed(region)
  for (const key of ['clients', 'services', 'staff', 'resources'] as const)
    Object.assign(s, {
      [key]: sample[key].map((row) => ({ ...row, organisationId: s.organisation.id })),
    })
  return s
}
function run(s: BusinessState, command: Command, at = now) {
  return execute(s, command, at, () => `retail-${++sequence}`)
}
function apply(s: BusinessState, command: Command, at = now) {
  const result = run(s, command, at)
  if (!result.ok) throw new Error(result.error)
  return result.state
}
const balm = {
  name: 'Cleansing Balm',
  sku: 'BALM',
  priceMinor: 3200,
  reorderAt: 2,
  archived: false,
  costMinor: 1200,
}
/** A studio with a balm (5 in stock) and a massage oil kept for treatments (3 in stock). */
function stocked(region: 'UK' | 'US' = 'UK') {
  let s = apply(local(region), { type: 'product', input: balm })
  s = apply(s, {
    type: 'product',
    input: { ...balm, name: 'Massage Oil', sku: 'OIL', priceMinor: 0, forSale: false },
  })
  const [balmId, oilId] = s.operations!.products.map((p) => p.id)
  for (const [productId, quantity] of [
    [balmId, 5],
    [oilId, 3],
  ] as const)
    s = apply(s, { type: 'stock', productId, quantity, reason: 'received', note: 'Delivery' })
  return { s, balmId, oilId }
}
/** A facial today, booked with no deposit, already welcomed. */
function visitToday(s: BusinessState, start = 600) {
  s = apply(s, {
    type: 'import-appointments',
    source: 'Test',
    reviewed: true,
    appointments: [
      {
        clientId: 'client-1',
        serviceId: 'service-facial',
        staffId: 'staff-maya',
        date: now.slice(0, 10),
        startMinutes: start,
        priceMinor: 9500,
        depositPaidMinor: 0,
      },
    ],
  })
  const a = s.appointments.filter((x) => x.source === 'import').at(-1)!
  return { s: apply(s, { type: 'arrive', appointmentId: a.id }), a }
}
const checkout = (appointmentId: string, products: { productId: string; quantity: number }[]) =>
  ({
    type: 'checkout',
    appointmentId,
    tipMinor: 0,
    method: 'cash',
    products,
  }) as Command

describe('selling products with a visit', () => {
  it('adds them to the receipt and takes them out of stock against it', () => {
    const { s: start, balmId } = stocked()
    const { s, a } = visitToday(start)
    const after = apply(s, checkout(a.id, [{ productId: balmId, quantity: 2 }]))
    const sale = after.sales.find((x) => x.appointmentId === a.id)!
    expect(sale.retail).toMatchObject({
      lines: [{ productId: balmId, name: 'Cleansing Balm', quantity: 2, unitMinor: 3200 }],
      subtotalMinor: 6400,
      taxMinor: 0,
    })
    expect(sale.totalMinor).toBe(9500 + 6400)
    expect(sale.balanceMinor).toBe(9500 + 6400)
    expect(stock(after, balmId)).toBe(3)
    expect(after.operations!.movements.at(-1)).toMatchObject({
      productId: balmId,
      quantity: -2,
      reason: 'retail',
      saleId: sale.id,
      appointmentId: a.id,
    })
    // Service revenue stays the service; products are counted separately.
    expect(serviceRevenue(sale)).toBe(9500)
    expect(retailRevenue(sale)).toBe(6400)
    expect(cashForDay(after, '2026-10-06').cashIn).toBe(15900)
    expect(after.events.at(-1)!.detail).toContain('Bought 2 × Cleansing Balm')
  })

  it('takes stock once when the same checkout arrives twice', () => {
    const { s: start, balmId } = stocked()
    const { s, a } = visitToday(start)
    const once = apply(s, checkout(a.id, [{ productId: balmId, quantity: 1 }]))
    const twice = run(once, checkout(a.id, [{ productId: balmId, quantity: 1 }]))
    expect(twice.ok && twice.state).toBe(once)
    expect(stock(once, balmId)).toBe(4)
  })

  it('keeps the price on the receipt when the catalogue price changes later', () => {
    const { s: start, balmId } = stocked()
    const { s, a } = visitToday(start)
    let after = apply(s, checkout(a.id, [{ productId: balmId, quantity: 1 }]))
    after = apply(after, { type: 'product', id: balmId, input: { ...balm, priceMinor: 4000 } })
    expect(after.sales.at(-1)!.retail!.lines[0].unitMinor).toBe(3200)
  })

  it('refuses more than is in stock, products kept for treatments and archived products', () => {
    const { s: start, balmId, oilId } = stocked()
    const { s, a } = visitToday(start)
    expect(run(s, checkout(a.id, [{ productId: balmId, quantity: 6 }]))).toEqual({
      ok: false,
      error: 'Only 5 Cleansing Balm left in stock.',
    })
    expect(run(s, checkout(a.id, [{ productId: oilId, quantity: 1 }])).ok).toBe(false)
    const archived = apply(s, {
      type: 'product',
      id: balmId,
      input: { ...balm, archived: true },
    })
    expect(run(archived, checkout(a.id, [{ productId: balmId, quantity: 1 }])).ok).toBe(false)
    expect(
      run(
        s,
        checkout(a.id, [
          { productId: balmId, quantity: 1 },
          { productId: balmId, quantity: 1 },
        ]),
      ).ok,
    ).toBe(false)
    // Nothing changed: the visit is still open and stock untouched.
    expect(s.sales.some((x) => x.appointmentId === a.id)).toBe(false)
    expect(stock(s, balmId)).toBe(5)
  })

  it('works out included VAT on products from today’s tax setting', () => {
    let { s: start } = stocked()
    start = apply(start, { type: 'tax', label: 'VAT', rateBps: 2000, inclusive: true })
    const balmId = start.operations!.products[0].id
    const { s, a } = visitToday(start)
    const after = apply(s, checkout(a.id, [{ productId: balmId, quantity: 1 }]))
    const sale = after.sales.at(-1)!
    expect(sale.retail).toMatchObject({ taxMinor: 533, taxInclusive: true, taxLabel: 'VAT' })
    expect(sale.totalMinor).toBe(9500 + 3200)
    expect(retailRevenue(sale)).toBe(3200 - 533)
  })

  it('adds sales tax on top of US product prices when the studio charges it that way', () => {
    let { s: start } = stocked('US')
    start = apply(start, { type: 'tax', label: 'Sales tax', rateBps: 887, inclusive: false })
    const balmId = start.operations!.products[0].id
    const { s, a } = visitToday(start)
    const after = apply(s, checkout(a.id, [{ productId: balmId, quantity: 1 }]))
    const sale = after.sales.at(-1)!
    expect(sale.retail!.taxMinor).toBe(284)
    // The imported visit's price already includes its tax; the product's tax is added on top.
    expect(sale.totalMinor).toBe(9500 + 3200 + 284)
  })

  it('lets a plan pay for the visit while the guest pays for the products', () => {
    let { s } = stocked()
    const balmId = s.operations!.products[0].id
    s = apply(s, {
      type: 'offer',
      input: {
        kind: 'package',
        name: 'Five facials',
        serviceIds: ['service-facial'],
        visits: 5,
        priceMinor: 40000,
        discountPercent: 0,
        validMonths: 6,
        archived: false,
      },
    })
    s = apply(s, {
      type: 'plan-sell',
      offerId: s.offers![0].id,
      clientId: 'client-1',
      method: 'cash',
    })
    const visit = visitToday(s)
    const after = apply(visit.s, {
      ...checkout(visit.a.id, [{ productId: balmId, quantity: 1 }]),
      holdingId: holdings(visit.s)[0].id,
    } as Command)
    const sale = after.sales.at(-1)!
    expect(sale.coveredMinor).toBe(8000)
    expect(sale.balanceMinor).toBe(3200)
  })
})

describe('the stock and money ledgers agree', () => {
  it('refuses a receipt whose products do not match the stock that left', () => {
    const { s: start, balmId } = stocked()
    const { s, a } = visitToday(start)
    const after = apply(s, checkout(a.id, [{ productId: balmId, quantity: 1 }]))
    const missing = structuredClone(after)
    missing.operations!.movements.pop()
    expect(() => parseState(missing, 'UK')).toThrow('match the stock')
    const changed = structuredClone(after)
    changed.sales.at(-1)!.retail!.subtotalMinor += 100
    expect(() => parseState(changed, 'UK')).toThrow()
    const stray = structuredClone(after)
    stray.operations!.movements.push({
      ...stray.operations!.movements.at(-1)!,
      id: 'stray',
      saleId: 'no-such-sale',
    })
    expect(() => parseState(stray, 'UK')).toThrow('does not match its receipt')
  })

  it('keeps the demo studios consistent', () => {
    for (const region of ['UK', 'US'] as const) {
      const s = seed(region)
      expect(() => parseState(structuredClone(s), region)).not.toThrow()
      expect(s.sales.filter((x) => x.retail).length).toBe(2)
    }
  })
})

describe('stock figures', () => {
  it('shows what is on the shelf, what needs reordering and its value at cost', () => {
    const { s, balmId, oilId } = stocked()
    const used = apply(s, {
      type: 'stock',
      productId: oilId,
      quantity: -2,
      reason: 'consumed',
      note: 'Used in treatments',
    })
    const rows = stockSummary(used)
    expect(rows.find((r) => r.product.id === balmId)).toMatchObject({
      onHand: 5,
      low: false,
      valueMinor: 6000,
    })
    expect(rows.find((r) => r.product.id === oilId)).toMatchObject({ onHand: 1, low: true })
  })

  it('adds up units and takings for each product sold', () => {
    const rows = retailByProduct(seed('UK').sales)
    expect(rows.map((r) => r.name)).toEqual([
      'Hydrating Serum',
      'Daily Mineral SPF 30',
      'Restorative Hair Mask',
    ])
    expect(rows[0]).toMatchObject({ units: 1, minor: 4800 })
  })

  it('reports product takings beside service revenue', () => {
    const { s: start, balmId } = stocked()
    const { s, a } = visitToday(start)
    const after = apply(s, checkout(a.id, [{ productId: balmId, quantity: 1 }]))
    const figures = report(after, 7)
    expect(figures.retail).toBe(3200)
    expect(figures.revenue).toBe(9500)
  })
})

describe('who can do what', () => {
  it('lets reception sell products at checkout but not change stock', () => {
    expect(can('reception', permissionFor({ type: 'checkout' }))).toBe(true)
    expect(can('reception', permissionFor({ type: 'stock' }))).toBe(false)
    expect(can('reception', permissionFor({ type: 'product' }))).toBe(false)
    expect(can('manager', permissionFor({ type: 'stock' }))).toBe(true)
  })

  it('names the person who sold the product on the stock record', () => {
    const { s: start, balmId } = stocked()
    const { s, a } = visitToday(start)
    const result = dispatch(s, checkout(a.id, [{ productId: balmId, quantity: 1 }]), 'Reena')
    expect(result.ok && result.state.operations!.movements.at(-1)!.actor).toBe('Reena')
  })
})

describe('client exports', () => {
  it('lists the products on each receipt', () => {
    const { s: start, balmId } = stocked()
    const { s, a } = visitToday(start)
    const after = apply(s, checkout(a.id, [{ productId: balmId, quantity: 2 }]))
    const exported = clientExport(after, 'client-1', { generatedAt: now, generatedBy: 'Test' })
    const receipt = exported.receipts.at(-1)!
    expect(receipt.products).toEqual([{ name: 'Cleansing Balm', quantity: 2, unitMinor: 3200 }])
  })
})
