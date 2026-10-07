import { describe, expect, it } from 'vitest'
import { dispatch, execute } from './commands'
import type { Command } from './commands'
import type { BusinessState } from './model'
import { parseState } from './model'
import { can } from './operations'
import { createWorkspace } from './workspace'
import { seed } from './seed'
import { findGiftCard, giftCards, giftCode, giftStanding, normaliseCode } from './giftCards'
import { giftCodeSchema } from './giftCardsSchema'
import { cashForDay } from './tillCount'
import { clientExport } from './privacy'

// V1.5: gift cards and vouchers.
const now = '2026-10-06T08:00:00.000Z'
let sequence = 0
function local(region: 'UK' | 'US' = 'UK'): BusinessState {
  const s = createWorkspace({ name: 'Gift test studio', region })
  const sample = seed(region)
  for (const key of ['clients', 'services', 'staff', 'resources'] as const)
    Object.assign(s, {
      [key]: sample[key].map((row) => ({ ...row, organisationId: s.organisation.id })),
    })
  return s
}
function run(s: BusinessState, command: Command, at = now) {
  return execute(s, command, at, () => `gift-${++sequence}`)
}
function apply(s: BusinessState, command: Command, at = now) {
  const result = run(s, command, at)
  if (!result.ok) throw new Error(result.error)
  return result.state
}
const sellMoney = (valueMinor: number, extra: Partial<Command> = {}): Command =>
  ({
    type: 'gift-card-sell',
    input: {
      kind: 'money',
      valueMinor,
      purchaserName: 'Ada Lovelace',
      recipientName: 'Grace',
      message: 'Happy birthday',
    },
    method: 'cash',
    ...extra,
  }) as Command
/** A facial today at `start`, booked with no deposit, already welcomed. */
function visitToday(s: BusinessState, start: number) {
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

describe('gift cards and vouchers', () => {
  it('pays for products bought with the visit as well as the visit', () => {
    let s = apply(local(), sellMoney(15000))
    s = apply(s, {
      type: 'product',
      input: {
        name: 'Cleansing Balm',
        sku: 'BALM',
        priceMinor: 3200,
        reorderAt: 1,
        archived: false,
      },
    })
    const balmId = s.operations!.products[0].id
    s = apply(s, { type: 'stock', productId: balmId, quantity: 3, reason: 'received', note: 'In' })
    const visit = visitToday(s, 600)
    const card = giftCards(visit.s)[0]
    const checkout = (giftCardMinor: number) =>
      ({
        type: 'checkout',
        appointmentId: visit.a.id,
        tipMinor: 0,
        method: 'cash',
        products: [{ productId: balmId, quantity: 1 }],
        giftCardId: card.id,
        giftCardMinor,
      }) as Command
    // £95 facial and a £32 balm: the card can pay all £127, but not a penny more.
    expect(run(visit.s, checkout(12701)).ok).toBe(false)
    const paid = apply(visit.s, checkout(12700))
    const sale = paid.sales.at(-1)!
    expect(sale).toMatchObject({ totalMinor: 12700, giftCardMinor: 12700, balanceMinor: 0 })
    expect(giftStanding(giftCards(paid)[0], now.slice(0, 10)).balanceMinor).toBe(2300)
    expect(() => parseState(paid, 'UK')).not.toThrow()
  })

  it('sells a gift card with a readable code that lasts two years in the UK', () => {
    const s = apply(local(), sellMoney(5000))
    const card = giftCards(s)[0]
    expect(giftCodeSchema.safeParse(card.code).success).toBe(true)
    expect(card.valueMinor).toBe(5000)
    expect(card.issuedOn).toBe('2026-10-06')
    expect(card.expiresOn).toBe('2028-10-06')
    expect(card.payment).toMatchObject({ amountMinor: 5000, method: 'cash' })
    expect(giftStanding(card, '2026-10-06')).toMatchObject({ state: 'active', balanceMinor: 5000 })
  })

  it('lasts five years in the US, the shortest federal rules allow', () => {
    const s = apply(local('US'), sellMoney(5000))
    expect(giftCards(s)[0].expiresOn).toBe('2031-10-06')
  })

  it('makes a voucher worth the treatment’s price on the day it is sold', () => {
    const s0 = local()
    const facial = s0.services.find((x) => x.id === 'service-facial')!
    const s = apply(s0, {
      type: 'gift-card-sell',
      input: {
        kind: 'service',
        serviceId: facial.id,
        purchaserName: 'Ada Lovelace',
        recipientName: '',
        message: '',
      },
      method: 'cash',
    })
    const card = giftCards(s)[0]
    expect(card).toMatchObject({
      kind: 'service',
      valueMinor: facial.priceMinor,
      serviceName: facial.name,
    })
  })

  it('refuses a voucher without a treatment and a gift card without an amount', () => {
    expect(
      run(local(), {
        type: 'gift-card-sell',
        input: { kind: 'service', purchaserName: 'Ada', recipientName: '', message: '' },
        method: 'cash',
      }).ok,
    ).toBe(false)
    expect(run(local(), sellMoney(0)).ok).toBe(false)
  })

  it('makes codes that differ and accepts them typed loosely', () => {
    expect(giftCode('a')).not.toBe(giftCode('b'))
    const s = apply(local(), sellMoney(5000))
    const code = giftCards(s)[0].code
    expect(normaliseCode(code.toLowerCase().replace(/-/g, ' '))).toBe(code)
    expect(findGiftCard(s, code.replace(/-/g, ''))?.id).toBe(giftCards(s)[0].id)
  })

  it('pays part of a visit and keeps the rest on the card', () => {
    let s = apply(local(), sellMoney(5000))
    const card = giftCards(s)[0]
    const v = visitToday(s, 600)
    s = apply(v.s, {
      type: 'checkout',
      appointmentId: v.a.id,
      tipMinor: 500,
      method: 'cash',
      giftCardId: card.id,
      giftCardMinor: 5000,
    })
    const sale = s.sales.at(-1)!
    expect(sale).toMatchObject({ giftCardId: card.id, giftCardMinor: 5000 })
    expect(sale.balanceMinor).toBe(sale.totalMinor - 5000)
    expect(s.payments.at(-1)!.amountMinor).toBe(sale.balanceMinor)
    expect(giftStanding(giftCards(s)[0], '2026-10-06')).toMatchObject({
      state: 'used',
      balanceMinor: 0,
    })
    expect(s.events.at(-1)!.detail).toContain(`paid by gift card ${card.code}`)
  })

  it('never takes more than the card holds or more than is due', () => {
    let s = apply(local(), sellMoney(20000))
    const card = giftCards(s)[0]
    const v = visitToday(s, 600)
    const over = run(v.s, {
      type: 'checkout',
      appointmentId: v.a.id,
      tipMinor: 0,
      method: 'cash',
      giftCardId: card.id,
      giftCardMinor: 9600,
    })
    expect(over.ok).toBe(false)
    s = apply(local(), sellMoney(3000))
    const small = visitToday(s, 600)
    expect(
      run(small.s, {
        type: 'checkout',
        appointmentId: small.a.id,
        tipMinor: 0,
        method: 'cash',
        giftCardId: giftCards(s)[0].id,
        giftCardMinor: 3001,
      }).ok,
    ).toBe(false)
  })

  it('cannot be spent once expired, until a manager gives more time', () => {
    let s = apply(local(), sellMoney(5000))
    const card = giftCards(s)[0]
    s.giftCards![0].issuedOn = '2024-10-06'
    s.giftCards![0].expiresOn = '2026-10-05'
    s = parseState(s, 'UK')
    const v = visitToday(s, 600)
    const spend: Command = {
      type: 'checkout',
      appointmentId: v.a.id,
      tipMinor: 0,
      method: 'cash',
      giftCardId: card.id,
      giftCardMinor: 1000,
    }
    const refused = run(v.s, spend)
    expect(refused.ok).toBe(false)
    if (!refused.ok) expect(refused.error).toContain('expired')
    // A card payment that held the card's share on its last day still lands after midnight.
    expect(
      execute(v.s, spend, now, () => `gift-${++sequence}`, { giftCardAsOf: '2026-10-05' }).ok,
    ).toBe(true)
    const extended = apply(v.s, {
      type: 'gift-card-extend',
      giftCardId: card.id,
      expiresOn: '2027-04-05',
    })
    expect(giftCards(extended)[0].extensions).toEqual([
      expect.objectContaining({ from: '2026-10-05', to: '2027-04-05' }),
    ])
    expect(run(extended, spend).ok).toBe(true)
  })

  it('cancels with a recorded refund no larger than what is left', () => {
    let s = apply(local(), sellMoney(5000))
    const card = giftCards(s)[0]
    const tooMuch = run(s, {
      type: 'gift-card-cancel',
      giftCardId: card.id,
      reason: 'Bought by mistake',
      refundMinor: 5001,
      method: 'cash',
      reference: 'R-1',
    })
    expect(tooMuch.ok).toBe(false)
    s = apply(s, {
      type: 'gift-card-cancel',
      giftCardId: card.id,
      reason: 'Bought by mistake',
      refundMinor: 5000,
      method: 'cash',
      reference: 'R-1',
    })
    expect(giftStanding(giftCards(s)[0], '2026-10-06').state).toBe('cancelled')
    expect(giftCards(s)[0].refunds[0].amountMinor).toBe(5000)
  })

  it('gives a refund in the sample workspace a demo reference', () => {
    const s = apply(seed('UK'), {
      type: 'gift-card-cancel',
      giftCardId: 'gift-1',
      reason: 'Bought twice',
      refundMinor: 7500,
      method: 'demo_card',
    })
    expect(giftCards(s)[0].refunds[0].reference).toMatch(/^DEMO-/)
  })

  it('shares payment and refund references with visit payments and receipts', () => {
    let s = apply(local(), sellMoney(5000, { method: 'external_card', reference: 'T-100' }))
    const v = visitToday(s, 600)
    const checkout: Command = {
      type: 'checkout',
      appointmentId: v.a.id,
      tipMinor: 0,
      method: 'external_card',
      reference: 'T-100',
    }
    expect(run(v.s, checkout).ok).toBe(false)
    s = apply(v.s, { ...checkout, reference: 'T-101' })
    s = apply(s, {
      type: 'gift-card-cancel',
      giftCardId: giftCards(s)[0].id,
      reason: 'Changed mind',
      refundMinor: 1000,
      method: 'cash',
      reference: 'R-9',
    })
    const refund: Command = {
      type: 'refund',
      saleId: s.sales.at(-1)!.id,
      amountMinor: 500,
      reason: 'Unhappy',
      reference: 'R-9',
      method: 'cash',
    }
    expect(run(s, refund).ok).toBe(false)
    expect(run(s, { ...refund, reference: 'R-10' }).ok).toBe(true)
  })

  it('counts cash taken and returned for cards in the till', () => {
    const s0 = local()
    const before = cashForDay(s0, '2026-10-06')
    let s = apply(s0, sellMoney(5000))
    s = apply(s, {
      type: 'gift-card-cancel',
      giftCardId: giftCards(s)[0].id,
      reason: 'Changed mind',
      refundMinor: 2000,
      method: 'cash',
      reference: 'R-2',
    })
    const after = cashForDay(s, '2026-10-06')
    expect(after.cashIn - before.cashIn).toBe(5000)
    expect(after.cashRefunded - before.cashRefunded).toBe(2000)
  })

  it('does not let a receipt refund return the part a gift card paid', () => {
    let s = apply(local(), sellMoney(5000))
    const v = visitToday(s, 600)
    s = apply(v.s, {
      type: 'checkout',
      appointmentId: v.a.id,
      tipMinor: 0,
      method: 'cash',
      giftCardId: giftCards(s)[0].id,
      giftCardMinor: 5000,
    })
    const sale = s.sales.at(-1)!
    const refund = (amountMinor: number): Command => ({
      type: 'refund',
      saleId: sale.id,
      amountMinor,
      reason: 'Unhappy',
      reference: `RF-${amountMinor}`,
      method: 'cash',
    })
    expect(run(s, refund(sale.totalMinor)).ok).toBe(false)
    expect(run(s, refund(sale.totalMinor - 5000)).ok).toBe(true)
  })

  it('lets the front desk sell but only managers extend or cancel', () => {
    expect(can('reception', 'gift-card-sell')).toBe(true)
    expect(can('reception', 'gift-card-cancel')).toBe(false)
    expect(can('reception', 'gift-card-extend')).toBe(false)
    expect(can('manager', 'gift-card-cancel')).toBe(true)
    expect(can('practitioner', 'gift-card-sell')).toBe(false)
  })

  it('puts the seller’s name on the card', () => {
    const result = dispatch(local(), sellMoney(5000), 'Rosa at the desk', now)
    expect(result.ok && giftCards(result.state)[0].actor).toBe('Rosa at the desk')
  })

  it('rejects a ledger where a card and its receipt disagree', () => {
    let s = apply(local(), sellMoney(5000))
    const v = visitToday(s, 600)
    s = apply(v.s, {
      type: 'checkout',
      appointmentId: v.a.id,
      tipMinor: 0,
      method: 'cash',
      giftCardId: giftCards(s)[0].id,
      giftCardMinor: 2000,
    })
    const broken = structuredClone(s)
    broken.giftCards![0].redemptions[0].amountMinor = 1000
    expect(() => parseState(broken, 'UK')).toThrow()
    const orphan = structuredClone(s)
    orphan.giftCards![0].redemptions = []
    expect(() => parseState(orphan, 'UK')).toThrow()
  })

  it('shows cards a client bought in their own data export', () => {
    const s = apply(local(), sellMoney(5000, {}))
    const withClient = apply(local(), {
      type: 'gift-card-sell',
      input: {
        kind: 'money',
        valueMinor: 2500,
        clientId: 'client-1',
        purchaserName: 'Ada',
        recipientName: 'Grace',
        message: '',
      },
      method: 'cash',
    })
    expect(
      clientExport(s, 'client-1', { generatedAt: now, generatedBy: 'Test' }).giftCards,
    ).toEqual([])
    const exported = clientExport(withClient, 'client-1', {
      generatedAt: now,
      generatedBy: 'Test',
    }).giftCards
    expect(exported).toHaveLength(1)
    expect(exported[0]).toMatchObject({ valueMinor: 2500, recipientName: 'Grace' })
  })
})
