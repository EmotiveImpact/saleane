import { describe, expect, it } from 'vitest'
import { execute } from './commands'
import type { Command } from './commands'
import type { BusinessState } from './model'
import { createWorkspace } from './workspace'
import { seed } from './seed'
import {
  otherReceipts,
  paidWith,
  parseReceiptKey,
  receiptEmail,
  receiptFor,
  receiptKey,
  receiptRows,
  receiptText,
} from './receipt'
import type { Receipt } from './receipt'

// Stage 2: one receipt model for every kind of sale, built from the record alone.
const now = '2026-10-06T13:05:00.000Z'
let sequence = 0
function local(region: 'UK' | 'US' = 'UK'): BusinessState {
  const s = createWorkspace({
    name: 'Lumen Studio',
    region,
    address: '12 Upper Street, London N1',
  })
  const sample = seed(region)
  for (const key of ['clients', 'services', 'staff', 'resources'] as const)
    Object.assign(s, {
      [key]: sample[key].map((row) => ({ ...row, organisationId: s.organisation.id })),
    })
  return s
}
function apply(s: BusinessState, command: Command, at = now) {
  const result = execute(s, command, at, () => `r-${++sequence}`)
  if (!result.ok) throw new Error(result.error)
  return result.state
}
/** A facial today at 15:00, already welcomed; `tax` is the basis it was booked under. */
function visit(
  s: BusinessState,
  options: {
    depositMinor?: number
    tax?: { label: string; rateBps: number; inclusive: boolean } | null
  } = {},
) {
  s = apply(s, {
    type: 'import-appointments',
    source: 'Old diary',
    reviewed: true,
    appointments: [
      {
        clientId: 'client-1',
        serviceId: 'service-facial',
        staffId: 'staff-maya',
        date: '2026-10-06',
        startMinutes: 900,
        priceMinor: 9500,
        depositPaidMinor: options.depositMinor ?? 0,
        ...(options.depositMinor ? { reference: 'OLD-7' } : {}),
      },
    ],
  })
  const a = s.appointments.at(-1)!
  if (options.tax !== undefined) {
    s = structuredClone(s)
    s.appointments.at(-1)!.bookedTax = options.tax
  }
  return { s: apply(s, { type: 'arrive', appointmentId: a.id }), a }
}
const balm = {
  name: 'Cleansing Balm',
  sku: 'BALM',
  priceMinor: 3200,
  reorderAt: 1,
  archived: false,
}
function withBalm(s: BusinessState) {
  s = apply(s, { type: 'product', input: balm })
  const productId = s.operations!.products.at(-1)!.id
  s = apply(s, { type: 'stock', productId, quantity: 10, reason: 'received', note: 'Delivery' })
  return { s, productId }
}
const total = (r: Receipt) =>
  r.lines.reduce((sum, line) => sum + (line.minus ? -line.amountMinor : line.amountMinor), 0)
const settledTo = (r: Receipt) =>
  r.totalMinor -
  r.settled.reduce((sum, line) => sum + line.amountMinor, 0) -
  (r.paid?.amountMinor ?? 0)

describe('a visit receipt', () => {
  it('lists the treatment, products, tip and deposit, and adds up to what was paid', () => {
    const { s: stocked, productId } = withBalm(local())
    const { s, a } = visit(stocked, { depositMinor: 2000 })
    const after = apply(s, {
      type: 'checkout',
      appointmentId: a.id,
      tipMinor: 500,
      method: 'cash',
      products: [{ productId, quantity: 2 }],
    })
    const sale = after.sales.at(-1)!
    const r = receiptFor(after, { kind: 'visit', id: sale.id })!
    expect(r).toMatchObject({
      kind: 'visit',
      number: sale.receiptNumber,
      title: 'Receipt',
      servedBy: 'Maya Lewis',
      clientName: after.clients.find((c) => c.id === 'client-1')!.name,
      studio: { name: 'Lumen Studio', address: '12 Upper Street, London N1' },
      date: expect.stringMatching(/^Tuesday,? 6 October 2026$/),
      time: '14:05',
      totalMinor: sale.totalMinor,
      paid: { label: 'Cash', amountMinor: sale.balanceMinor },
    })
    // One location: it is not named.
    expect(r.studio.location).toBeUndefined()
    expect(r.lines).toEqual([
      { label: 'Skin Renewal Facial', amountMinor: 9500 },
      { label: 'Cleansing Balm', detail: '2 × £32.00', amountMinor: 6400 },
      { label: 'Tip', amountMinor: 500 },
    ])
    expect(r.settled).toEqual([
      { label: 'Deposit paid before the visit', amountMinor: 2000, minus: true },
    ])
    expect(total(r)).toBe(r.totalMinor)
    expect(settledTo(r)).toBe(0)
    expect(r.notes).toEqual([])
    expect(r.email).toBe(after.clients.find((c) => c.id === 'client-1')!.email)
  })

  it('adds tax on top when the studio adds it, as its own line before the total', () => {
    const { s, a } = visit(local(), { tax: { label: 'VAT', rateBps: 2000, inclusive: false } })
    const after = apply(s, {
      type: 'checkout',
      appointmentId: a.id,
      tipMinor: 0,
      discountMinor: 500,
      method: 'external_card',
      reference: 'T-55',
    })
    const sale = after.sales.at(-1)!
    const r = receiptFor(after, { kind: 'visit', id: sale.id })!
    expect(r.lines).toEqual([
      { label: 'Skin Renewal Facial', amountMinor: 9500 },
      { label: 'Discount', amountMinor: 500, minus: true },
      { label: 'VAT 20%', amountMinor: 1800 },
    ])
    expect(r.included).toEqual([])
    expect(r.totalMinor).toBe(10800)
    expect(total(r)).toBe(10800)
    expect(r.paid).toEqual({ label: 'Card at the studio’s own terminal', amountMinor: 10800 })
  })

  it('notes tax already inside the price when the studio shows prices with tax', () => {
    const { s, a } = visit(local(), { tax: { label: 'VAT', rateBps: 2000, inclusive: true } })
    const after = apply(s, { type: 'checkout', appointmentId: a.id, tipMinor: 0, method: 'cash' })
    const r = receiptFor(after, { kind: 'visit', id: after.sales.at(-1)!.id })!
    expect(r.lines).toEqual([{ label: 'Skin Renewal Facial', amountMinor: 9500 }])
    expect(r.included).toEqual([{ label: 'Includes VAT 20%', amountMinor: 1583 }])
    expect(r.totalMinor).toBe(9500)
    const rows = receiptRows(r)
    expect(rows.map((row) => row.kind)).toEqual(['item', 'total', 'included', 'paid'])
    expect(rows[2]).toEqual({ kind: 'included', label: 'Includes VAT 20%', amount: '£15.83' })
  })

  it('names a member discount, a plan’s share and a gift card by its last characters only', () => {
    let s = local()
    s = apply(s, {
      type: 'offer',
      input: {
        kind: 'membership',
        name: 'Glow Club',
        serviceIds: ['service-facial'],
        visits: 0,
        priceMinor: 4000,
        discountPercent: 10,
        validMonths: 1,
        archived: false,
      },
    })
    s = apply(s, {
      type: 'plan-sell',
      offerId: s.offers![0].id,
      clientId: 'client-1',
      method: 'cash',
    })
    s = apply(s, {
      type: 'gift-card-sell',
      input: {
        kind: 'money',
        valueMinor: 5000,
        purchaserName: 'Ada',
        recipientName: '',
        message: '',
      },
      method: 'cash',
    })
    const card = s.giftCards![0]
    const { s: ready, a } = visit(s)
    const after = apply(ready, {
      type: 'checkout',
      appointmentId: a.id,
      tipMinor: 0,
      discountMinor: 950,
      method: 'cash',
      giftCardId: card.id,
      giftCardMinor: 3000,
    })
    const r = receiptFor(after, { kind: 'visit', id: after.sales.at(-1)!.id })!
    expect(r.lines[1]).toEqual({ label: 'Member discount (10%)', amountMinor: 950, minus: true })
    expect(r.settled).toEqual([
      {
        label: 'Gift card',
        detail: `Code ending ${card.code.slice(-4)}`,
        amountMinor: 3000,
        minus: true,
      },
    ])
    expect(r.paid).toEqual({ label: 'Cash', amountMinor: 9500 - 950 - 3000 })
    expect(settledTo(r)).toBe(0)
    // The whole code spends the card, so it never appears on a receipt.
    expect(receiptText(r)).not.toContain(card.code)
    expect(receiptText(r)).toContain(card.code.slice(-4))
  })

  it('shows the part a package paid and that nothing was left to pay', () => {
    let s = local()
    s = apply(s, {
      type: 'offer',
      input: {
        kind: 'package',
        name: 'Five facials',
        serviceIds: ['service-facial'],
        visits: 5,
        priceMinor: 40000,
        discountPercent: 0,
        validMonths: 12,
        archived: false,
      },
    })
    s = apply(s, {
      type: 'plan-sell',
      offerId: s.offers![0].id,
      clientId: 'client-1',
      method: 'cash',
    })
    const holding = s.holdings![0]
    const { s: ready, a } = visit(s)
    const after = apply(ready, {
      type: 'checkout',
      appointmentId: a.id,
      tipMinor: 0,
      method: 'cash',
      holdingId: holding.id,
    })
    const r = receiptFor(after, { kind: 'visit', id: after.sales.at(-1)!.id })!
    expect(r.lines).toEqual([
      { label: 'Skin Renewal Facial', amountMinor: 9500 },
      { label: 'Plan saving', amountMinor: 1500, minus: true },
    ])
    expect(r.settled).toEqual([{ label: 'Paid by Five facials', amountMinor: 8000, minus: true }])
    expect(r.paid).toBeUndefined()
    expect(receiptRows(r).at(-1)).toEqual({
      kind: 'paid',
      label: 'Nothing left to pay',
      amount: '£0.00',
    })
  })

  it('says a test card payment moved no money, and lists refunds with how they went back', () => {
    const { s, a } = visit(local())
    let after = apply(s, {
      type: 'checkout',
      appointmentId: a.id,
      tipMinor: 0,
      method: 'card',
      reference: 'pi_test_1',
      processor: { provider: 'test', live: false },
    })
    const sale = after.sales.at(-1)!
    after = apply(after, {
      type: 'refund',
      saleId: sale.id,
      amountMinor: 1000,
      reason: 'Goodwill',
      reference: 're_test_1',
      method: 'card',
      processor: { provider: 'test', live: false },
    })
    const r = receiptFor(after, { kind: 'visit', id: sale.id })!
    expect(r.paid).toEqual({ label: 'Card, test payment, no money moved', amountMinor: 9500 })
    expect(r.refunds).toEqual([
      {
        label: 'Refunded to the card, test refund, no money moved',
        detail: '6 October 2026',
        amountMinor: 1000,
        minus: true,
      },
    ])
    expect(paidWith('card', { live: true })).toBe('Card')
    expect(paidWith('card')).toBe('Card, test payment, no money moved')
  })

  it('uses the studio’s own clock and names the location when there are several', () => {
    let s = local('US')
    s = apply(s, {
      type: 'location',
      input: { name: 'Uptown', address: '9 Main Street', phone: '+1 212 555 0100' },
    })
    const { s: ready, a } = visit(s)
    // Late in the evening in New York is already the next day in London.
    const after = apply(
      ready,
      { type: 'checkout', appointmentId: a.id, tipMinor: 0, method: 'cash' },
      '2026-10-07T01:30:00.000Z',
    )
    const r = receiptFor(after, { kind: 'visit', id: after.sales.at(-1)!.id })!
    expect(r.date).toBe('Tuesday, October 6, 2026')
    expect(r.time).toBe('09:30 PM')
    expect(r.studio.location).toBe('Lumen Studio')
    expect(r.studio.address).toBe('12 Upper Street, London N1')
    expect(receiptRows(r)[0].amount).toBe('$95.00')
  })
})

describe('a walk-in sale receipt', () => {
  it('lists products with their tax and any refund', () => {
    const balm = withBalm(local())
    const { productId } = balm
    let { s } = balm
    s = apply(s, { type: 'tax', label: 'VAT', rateBps: 2000, inclusive: false })
    s = apply(s, {
      type: 'counter-sale',
      staffId: 'staff-maya',
      products: [{ productId, quantity: 3 }],
      method: 'cash',
    })
    const sale = s.counterSales!.at(-1)!
    s = apply(s, {
      type: 'refund',
      counterSaleId: sale.id,
      amountMinor: 3840,
      reason: 'Changed their mind',
      reference: 'CASH-1',
      method: 'cash',
      restock: [{ productId, quantity: 1 }],
    })
    const r = receiptFor(s, { kind: 'walk-in', id: sale.id })!
    expect(r).toMatchObject({
      kind: 'walk-in',
      number: sale.receiptNumber,
      servedBy: 'Maya Lewis',
      totalMinor: 11520,
      paid: { label: 'Cash', amountMinor: 11520 },
    })
    expect(r.clientId).toBeUndefined()
    expect(r.email).toBeUndefined()
    expect(r.lines).toEqual([
      { label: 'Cleansing Balm', detail: '3 × £32.00', amountMinor: 9600 },
      { label: 'VAT 20%', amountMinor: 1920 },
    ])
    expect(total(r)).toBe(r.totalMinor)
    expect(r.refunds).toEqual([
      { label: 'Refunded in cash', detail: '6 October 2026', amountMinor: 3840, minus: true },
    ])
  })
})

describe('a gift card receipt', () => {
  it('numbers it, keeps the code to its last characters and carries no tax', () => {
    let s = local()
    s = apply(s, { type: 'tax', label: 'VAT', rateBps: 2000, inclusive: true })
    s = apply(s, {
      type: 'gift-card-sell',
      input: {
        kind: 'money',
        valueMinor: 7500,
        clientId: 'client-2',
        purchaserName: 'Ada Lovelace',
        recipientName: 'Grace',
        message: 'Happy birthday',
      },
      method: 'external_card',
      reference: 'T-9',
    })
    const card = s.giftCards![0]
    const r = receiptFor(s, { kind: 'gift-card', id: card.id })!
    expect(r).toMatchObject({
      title: 'Gift card receipt',
      number: 'GC-1',
      totalMinor: 7500,
      paid: { label: 'Card at the studio’s own terminal', amountMinor: 7500 },
      clientId: 'client-2',
    })
    expect(r.lines).toEqual([
      {
        label: 'Gift card',
        detail: `For Grace, code ending ${card.code.slice(-4)}, use by ${new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(`${card.expiresOn}T12:00:00Z`))}`,
        amountMinor: 7500,
      },
    ])
    expect(r.included).toEqual([])
    expect(JSON.stringify(r)).not.toContain(card.code)
    expect(otherReceipts(s)[0]).toMatchObject({ key: `gift-card:${card.id}`, number: 'GC-1' })
  })
})

describe('a plan receipt', () => {
  it('has one receipt for the sale and one for each month paid, with tax inside the price', () => {
    let s = local()
    s = apply(s, { type: 'tax', label: 'VAT', rateBps: 2000, inclusive: false })
    s = apply(s, {
      type: 'offer',
      input: {
        kind: 'membership',
        name: 'Glow Club',
        serviceIds: ['service-facial'],
        visits: 1,
        priceMinor: 6000,
        discountPercent: 0,
        validMonths: 1,
        archived: false,
      },
    })
    s = apply(s, {
      type: 'plan-sell',
      offerId: s.offers![0].id,
      clientId: 'client-1',
      method: 'cash',
    })
    s = apply(s, { type: 'plan-renew', holdingId: s.holdings![0].id, method: 'cash' })
    const holding = s.holdings![0]
    const first = receiptFor(s, { kind: 'plan', id: holding.id, payment: holding.payments[0].id })!
    const second = receiptFor(s, { kind: 'plan', id: holding.id, payment: holding.payments[1].id })!
    expect(first).toMatchObject({ number: 'PL-1', title: 'Membership receipt', totalMinor: 6000 })
    expect(first.lines).toEqual([
      {
        label: 'Glow Club',
        detail: 'Membership for the month from 6 October 2026',
        amountMinor: 6000,
      },
    ])
    expect(first.included).toEqual([{ label: 'Includes VAT 20%', amountMinor: 1000 }])
    expect(second).toMatchObject({ number: 'PL-1-2' })
    expect(second.lines[0].detail).toBe('Membership for the month from 6 November 2026')
    // Renewals do not record who took them, so none is printed.
    expect(second.servedBy).toBeUndefined()
    expect(receiptFor(s, { kind: 'plan', id: holding.id, payment: 'nope' })).toBeNull()
    expect(otherReceipts(s).map((x) => x.number)).toEqual(['PL-1', 'PL-1-2'])
  })
})

describe('a sample studio receipt', () => {
  it('says no real money was taken, in the sample’s own words', () => {
    const s = seed('UK')
    const sale = s.sales[0]
    const r = receiptFor(s, { kind: 'visit', id: sale.id })!
    expect(r.sample).toBe(true)
    expect(r.notes).toEqual(['Sample studio: no real money was taken.'])
    expect(r.paid?.label).toMatch(/sample studio, no real money/)
  })
})

describe('receipt keys', () => {
  it('round-trips and refuses anything else', () => {
    for (const ref of [
      { kind: 'visit', id: 'sale-1' },
      { kind: 'walk-in', id: 'c-1' },
      { kind: 'gift-card', id: 'g-1' },
      { kind: 'plan', id: 'h-1', payment: 'p-1' },
    ] as const)
      expect(parseReceiptKey(receiptKey(ref))).toEqual(ref)
    for (const bad of [
      '',
      'visit',
      'visit:',
      'plan:h-1',
      'visit:a:b',
      'sale:1',
      'visit:a b',
      'gift-card:g:p:q',
      `visit:${'x'.repeat(151)}`,
    ])
      expect(parseReceiptKey(bad), bad).toBeNull()
  })

  it('is null for a receipt that is not in the record', () => {
    const s = local()
    expect(receiptFor(s, { kind: 'visit', id: 'nope' })).toBeNull()
    expect(receiptFor(s, { kind: 'walk-in', id: 'nope' })).toBeNull()
    expect(receiptFor(s, { kind: 'gift-card', id: 'nope' })).toBeNull()
  })
})

describe('the receipt in words', () => {
  it('prints the VAT number and an email names the receipt', () => {
    const booked = visit(local())
    const { a } = booked
    let { s } = booked
    s = apply(s, {
      type: 'till-settings',
      printer: { mode: 'browser', paper: '80', drawer: false },
      taxNumber: 'GB 123 4567 89',
    })
    s = apply(s, { type: 'checkout', appointmentId: a.id, tipMinor: 0, method: 'cash' })
    const r = receiptFor(s, { kind: 'visit', id: s.sales.at(-1)!.id })!
    expect(r.studio.taxNumber).toEqual({ label: 'VAT number', value: 'GB 123 4567 89' })
    const text = receiptText(r)
    expect(text).toContain('Skin Renewal Facial: £95.00')
    expect(text).toContain('Paid: Cash: £95.00')
    expect(text).toContain('VAT number: GB 123 4567 89')
    expect(text).not.toMatch(/[\u2013\u2014]/)
    const email = receiptEmail(r)
    expect(email.subject).toBe(`Your receipt from Lumen Studio (${r.number})`)
    expect(email.body).toMatch(/^Dear \w+,\n\nHere is your receipt\./)
  })
})
