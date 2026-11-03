import { describe, expect, it } from 'vitest'
import { execute } from './commands'
import type { Command } from './commands'
import { parseState } from './model'
import type { BusinessState } from './model'
import { can, operations } from './operations'
import { createWorkspace } from './workspace'
import { seed } from './seed'
import { importStanding } from './switching'
import { findGiftCard, giftCards, giftStanding } from './giftCards'
import { holdings, planStanding } from './plans'
import { report } from './selectors'
import { otherReceipts } from './receipt'
import { cashForDay } from './tillCount'
import { dailySummary } from './accounts'

// Moving in, stage 3: gift cards and packages the old system sold, with what is left on each.
const now = '2026-10-06T08:00:00.000Z'
let sequence = 0
function local(): BusinessState {
  const s = createWorkspace({ name: 'Moving in test studio', region: 'UK' })
  const sample = seed('UK', { regulars: false })
  for (const key of ['clients', 'services', 'staff', 'resources'] as const)
    Object.assign(s, {
      [key]: sample[key].map((row) => ({ ...row, organisationId: s.organisation.id })),
    })
  return s
}
function run(s: BusinessState, command: Command, at = now) {
  return execute(s, command, at, () => `carry-${++sequence}`)
}
function apply(s: BusinessState, command: Command, at = now) {
  const result = run(s, command, at)
  if (!result.ok) throw new Error(result.error)
  return result.state
}
const card = {
  code: 'GV-58214',
  balanceMinor: 3000,
  valueBeforeMinor: 5000,
  clientId: 'client-2',
  purchaserName: 'Olivia James',
  recipientName: 'Hannah James',
  issuedOn: '2026-03-31',
  expiresOn: '2027-03-31',
}
const course = {
  clientId: 'client-8',
  name: 'Course of 6 Skin Renewal Facials',
  serviceIds: ['service-facial'],
  visitsLeft: 4,
  visitsBefore: 6,
  valueMinor: 32000,
  startedOn: '2026-07-01',
  endsOn: '2027-06-30',
}
function bookAndArrive(s: BusinessState, clientId: string, serviceId = 'service-facial') {
  s = apply(s, {
    type: 'book',
    input: {
      clientId,
      serviceId,
      staffId: 'staff-maya',
      date: '2026-10-06',
      startMinutes: 900,
      source: 'desk',
    },
  })
  const visit = s.appointments.at(-1)!
  return { s: apply(s, { type: 'arrive', appointmentId: visit.id }), visit }
}

describe('gift cards carried over from the old system', () => {
  it('keeps the printed code and what is left, held for the guest and never a sale', () => {
    const s = apply(local(), {
      type: 'import-gift-cards',
      source: 'Timely',
      reviewed: true,
      cards: [card, { ...card, code: 'gv33107', clientId: undefined, expiresOn: undefined }],
    })
    const [kept, open] = giftCards(s)
    expect(kept).toMatchObject({
      code: 'GV58214',
      kind: 'money',
      valueMinor: 3000,
      clientId: 'client-2',
      purchaserName: 'Olivia James',
      recipientName: 'Hannah James',
      issuedOn: '2026-03-31',
      expiresOn: '2027-03-31',
      payment: {
        amountMinor: 3000,
        method: 'previous_system',
        reference: 'Paid to Timely before switching · gift card GV58214',
      },
      carried: { valueBeforeMinor: 5000 },
    })
    expect(kept.carried?.noExpiry).toBeUndefined()
    // No last day in the old system: ten years, which a manager can extend.
    expect(open).toMatchObject({ code: 'GV33107', expiresOn: '2036-10-06' })
    expect(open.carried?.noExpiry).toBe(true)
    // However the desk types it.
    expect(findGiftCard(s, 'gv-58214')?.id).toBe(kept.id)
    expect(findGiftCard(s, ' GV 58214 ')?.id).toBe(kept.id)
    expect(s.events.find((e) => e.clientId === 'client-2')).toMatchObject({
      type: 'gift_card',
      title: 'Gift card carried over',
    })
    expect(s.events.find((e) => e.title === 'Gift card carried over')?.detail).toContain(
      'with £30.00 left to spend of £50.00',
    )
    const batch = operations(s).imports!.at(-1)!
    expect(batch).toMatchObject({ kind: 'giftCards', source: 'Timely', totalMinor: 6000 })
    expect(importStanding(s, batch)).toEqual({ upcoming: 2, changed: 0 })
    // Bought in Timely: not a sale, a receipt in the list, or cash in the drawer here.
    expect(report(s, 30).giftCardsSold).toBe(0)
    expect(otherReceipts(s)).toEqual([])
    expect(cashForDay(s, '2026-10-06').cashIn).toBe(0)
  })

  it('pays for a visit at the desk like any other card', () => {
    let s = apply(local(), {
      type: 'import-gift-cards',
      source: 'Timely',
      reviewed: true,
      cards: [card],
    })
    const booked = bookAndArrive(s, 'client-2')
    s = apply(booked.s, {
      type: 'checkout',
      appointmentId: booked.visit.id,
      tipMinor: 0,
      method: 'cash',
      giftCardId: giftCards(s)[0].id,
      giftCardMinor: 3000,
    })
    const sale = s.sales.find((x) => x.appointmentId === booked.visit.id)!
    expect(sale.giftCardMinor).toBe(3000)
    expect(giftStanding(giftCards(s)[0], '2026-10-06')).toMatchObject({
      state: 'used',
      balanceMinor: 0,
    })
    expect(importStanding(s, operations(s).imports!.at(-1)!)).toEqual({ upcoming: 0, changed: 1 })
  })

  it('gives a card without a code a new one, and refuses codes it cannot keep', () => {
    const s = apply(local(), {
      type: 'import-gift-cards',
      source: 'Square',
      reviewed: true,
      cards: [{ ...card, code: undefined }],
    })
    expect(giftCards(s).at(-1)!.code).toMatch(
      /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/,
    )
    const refused = (cards: Extract<Command, { type: 'import-gift-cards' }>['cards']) =>
      run(local(), { type: 'import-gift-cards', source: 'Timely', reviewed: true, cards })
    // Too short to keep safely, already in SALEANE, twice in the file, spent, or over its value.
    expect(refused([{ ...card, code: 'A1' }])).toMatchObject({ ok: false })
    expect(
      run(s, {
        type: 'import-gift-cards',
        source: 'Square',
        reviewed: true,
        cards: [{ ...card, code: giftCards(s).at(-1)!.code.toLowerCase() }],
      }),
    ).toMatchObject({ ok: false, error: expect.stringContaining('already in SALEANE') })
    expect(refused([card, { ...card, code: 'gv 58214' }])).toMatchObject({ ok: false })
    expect(refused([{ ...card, expiresOn: '2026-10-05' }])).toMatchObject({
      ok: false,
      error: 'Gift card GV58214 has already expired, so it stays in Timely.',
    })
    expect(refused([{ ...card, valueBeforeMinor: 2000 }])).toMatchObject({ ok: false })
    expect(refused([{ ...card, clientId: 'client-elsewhere' }])).toMatchObject({ ok: false })
  })

  it('names the buyer even when the file does not', () => {
    const s = apply(local(), {
      type: 'import-gift-cards',
      source: 'Phorest',
      reviewed: true,
      cards: [{ ...card, clientId: undefined, purchaserName: '', recipientName: '' }],
    })
    expect(giftCards(s).at(-1)!.purchaserName).toBe('A Phorest customer')
  })

  it('can be cancelled with money returned, like a card sold here', () => {
    let s = apply(local(), {
      type: 'import-gift-cards',
      source: 'Timely',
      reviewed: true,
      cards: [card],
    })
    s = apply(s, {
      type: 'gift-card-cancel',
      giftCardId: giftCards(s)[0].id,
      reason: 'Guest moved away',
      refundMinor: 3000,
      method: 'cash',
      reference: 'REF-1',
    })
    expect(giftStanding(giftCards(s)[0], '2026-10-06').state).toBe('cancelled')
    expect(cashForDay(s, '2026-10-06').cashRefunded).toBe(3000)
  })

  it('works in the sample studio, where every other payment is a demo one', () => {
    const s = apply(seed('UK', { regulars: false }), {
      type: 'import-gift-cards',
      source: 'Timely',
      reviewed: true,
      cards: [card],
    })
    expect(giftCards(s).at(-1)!.payment.method).toBe('previous_system')
  })

  it('refuses a record that says it was carried over without the import, or paid here', () => {
    const s = apply(local(), {
      type: 'import-gift-cards',
      source: 'Timely',
      reviewed: true,
      cards: [card],
    })
    const broken = (change: (state: BusinessState) => void) => {
      const copy = structuredClone(s)
      change(copy)
      return () => parseState(copy, 'UK')
    }
    expect(broken((x) => (operations(x).imports = []))).toThrow()
    expect(broken((x) => (giftCards(x)[0].payment.method = 'cash'))).toThrow()
    expect(broken((x) => delete giftCards(x)[0].carried)).toThrow()
    expect(broken((x) => (giftCards(x)[0].carried!.valueBeforeMinor = 100))).toThrow()
    expect(broken(() => undefined)).not.toThrow()
  })
})

describe('packages carried over from the old system', () => {
  it('keeps the visits left and what they are worth, held for the client', () => {
    const s = apply(local(), {
      type: 'import-packages',
      source: 'Timely',
      reviewed: true,
      packages: [
        course,
        { ...course, clientId: 'client-3', endsOn: undefined, visitsBefore: undefined },
      ],
    })
    const [kept, open] = holdings(s)
    expect(kept).toMatchObject({
      clientId: 'client-8',
      kind: 'package',
      name: 'Course of 6 Skin Renewal Facials',
      serviceIds: ['service-facial'],
      visits: 4,
      priceMinor: 32000,
      startedOn: '2026-07-01',
      endsOn: '2027-06-30',
      payments: [
        {
          amountMinor: 32000,
          method: 'previous_system',
          reference: 'Paid to Timely before switching · Course of 6 Skin Renewal Facials',
        },
      ],
      carried: { visitsBefore: 6 },
    })
    expect(kept.offerId).toBeUndefined()
    expect(open).toMatchObject({ endsOn: '2036-10-05', carried: { noEnd: true } })
    expect(planStanding(kept, '2026-10-06')).toMatchObject({
      state: 'active',
      visitsLeft: 4,
      unusedMinor: 32000,
    })
    expect(s.events.find((e) => e.title === 'Package carried over')?.detail).toBe(
      'Course of 6 Skin Renewal Facials: 4 visits left of 6, until 30 June 2027, worth £320.00. Bought in Timely; SALEANE took no payment.',
    )
    const batch = operations(s).imports!.at(-1)!
    expect(batch).toMatchObject({ kind: 'packages', totalMinor: 64000 })
    expect(importStanding(s, batch)).toEqual({ upcoming: 2, changed: 0 })
    // Sold, and counted, in Timely: not a sale here, nor takings on the day it came across.
    expect(report(s, 30).plansSold).toBe(0)
    expect(otherReceipts(s)).toEqual([])
    expect(dailySummary(s, '2026-10-06', '2026-10-06').every((d) => d.plansMinor === 0)).toBe(true)
  })

  it('covers a visit at the desk, taking one visit and its share', () => {
    let s = apply(local(), {
      type: 'import-packages',
      source: 'Timely',
      reviewed: true,
      packages: [course],
    })
    const booked = bookAndArrive(s, 'client-8')
    s = apply(booked.s, {
      type: 'checkout',
      appointmentId: booked.visit.id,
      tipMinor: 0,
      method: 'cash',
      holdingId: holdings(s)[0].id,
    })
    const sale = s.sales.find((x) => x.appointmentId === booked.visit.id)!
    expect(sale.coveredMinor).toBe(8000)
    expect(planStanding(holdings(s)[0], '2026-10-06')).toMatchObject({
      visitsLeft: 3,
      unusedMinor: 24000,
    })
  })

  it('covers a visit in full when the old system gave no value', () => {
    let s = apply(local(), {
      type: 'import-packages',
      source: 'Phorest',
      reviewed: true,
      packages: [{ ...course, valueMinor: 0 }],
    })
    const booked = bookAndArrive(s, 'client-8')
    s = apply(booked.s, {
      type: 'checkout',
      appointmentId: booked.visit.id,
      tipMinor: 0,
      method: 'cash',
      holdingId: holdings(s)[0].id,
    })
    const sale = s.sales.find((x) => x.appointmentId === booked.visit.id)!
    expect(sale).toMatchObject({ coveredMinor: 0, totalMinor: 0 })
  })

  it('refuses treatments not offered here, a package already carried over, or one that ended', () => {
    const once = apply(local(), {
      type: 'import-packages',
      source: 'Timely',
      reviewed: true,
      packages: [course],
    })
    const refused = (s: BusinessState, change: Partial<typeof course>) =>
      run(s, {
        type: 'import-packages',
        source: 'Timely',
        reviewed: true,
        packages: [{ ...course, ...change }],
      })
    expect(refused(local(), { serviceIds: ['service-elsewhere'] })).toMatchObject({ ok: false })
    expect(refused(once, {})).toMatchObject({
      ok: false,
      error: 'Nina Patel already has Course of 6 Skin Renewal Facials from Timely.',
    })
    expect(refused(local(), { endsOn: '2026-10-05' })).toMatchObject({ ok: false })
    expect(refused(local(), { visitsBefore: 3 })).toMatchObject({ ok: false })
    expect(refused(local(), { clientId: 'client-elsewhere' })).toMatchObject({ ok: false })
  })

  it('refuses a record that says it was carried over but was sold here', () => {
    const s = apply(local(), {
      type: 'import-packages',
      source: 'Timely',
      reviewed: true,
      packages: [course],
    })
    const broken = (change: (state: BusinessState) => void) => {
      const copy = structuredClone(s)
      change(copy)
      return () => parseState(copy, 'UK')
    }
    expect(broken((x) => (holdings(x)[0].payments[0].method = 'cash'))).toThrow()
    expect(broken((x) => delete holdings(x)[0].carried)).toThrow()
    expect(broken((x) => (holdings(x)[0].offerId = 'offer-1'))).toThrow()
    expect(broken((x) => (holdings(x)[0].priceMinor = 1))).toThrow()
    expect(broken(() => undefined)).not.toThrow()
  })
})

it('leaves carrying gift cards and packages over to owners and managers', () => {
  for (const action of ['import-gift-cards', 'import-packages']) {
    expect(can('owner', action)).toBe(true)
    expect(can('manager', action)).toBe(true)
    expect(can('reception', action)).toBe(false)
    expect(can('practitioner', action)).toBe(false)
    expect(can('general', action)).toBe(false)
  }
})
