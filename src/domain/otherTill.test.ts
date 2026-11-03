import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { dispatch } from './commands'
import type { Command, SoftwareSource } from './commands'
import type { BusinessState } from './model'
import { parseState } from './model'
import { seed } from './seed'
import { can, operations, roleNames, stock } from './operations'
import type { Role } from './operations'
import { branchRefusal } from './branch'
import { dailySummary, moneyInAndOut, salesByReceipt, salesCsv } from './accounts'
import { payPeriod } from './pay'
import { report } from './selectors'
import { atPlace } from './locations'
import { changeWords, describeChange, recordNames } from './changeRecord'
import { previewStudioExport, studioExport } from './privacy'
import { otherTillSales, refundedOn, shelfShort, taxInside, tillLabel } from './otherTill'
import type { OtherTillRefundInput, OtherTillSaleInput } from './otherTillSchema'
import { keySummary, LOCATION_SCOPES, scopeWords, writeScopes } from './accessKeys'

// Stage 5: sales and refunds a chain's own till sends in through an access key.
const now = '2026-10-06T12:00:00.000Z'
// The records here sit on 6 October 2026, so the clock stays on that day: figures for "the last
// seven days" keep counting them whatever day the tests run.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(now))
})
afterEach(() => {
  vi.useRealTimers()
})
const till: SoftwareSource = { keyId: 'key-1', name: 'Shop till' }
/** The sample studio as a real one: its made-up payments recorded as cash. */
const local = () => {
  const s = structuredClone(seed('UK'))
  s.operations = { ...s.operations!, mode: 'local' }
  const walk = (value: unknown) => {
    if (Array.isArray(value)) value.forEach(walk)
    else if (value && typeof value === 'object')
      for (const [key, item] of Object.entries(value)) {
        if (key === 'method' && typeof item === 'string' && item.startsWith('demo_'))
          (value as Record<string, unknown>)[key] = 'cash'
        else walk(item)
      }
  }
  walk(s)
  return parseState(s, s.organisation.region)
}
const run = (s: BusinessState, command: Command, source: SoftwareSource | null = till) =>
  dispatch(s, command, 'Shop till (access key)', now, source ? { software: source } : {})
const done = (s: BusinessState, command: Command, source?: SoftwareSource) => {
  const result = run(s, command, source)
  if (!result.ok) throw new Error(result.error)
  return result
}
const line = (totalMinor: number, extra: Record<string, unknown> = {}) => ({
  kind: 'product' as const,
  quantity: 1,
  totalMinor,
  taxMinor: taxInside(totalMinor, 2000),
  taxRateBps: 2000,
  ...extra,
})
const sale = (
  s: BusinessState,
  receipt: string,
  lines: ReturnType<typeof line>[],
  extra: Record<string, unknown> = {},
): Command => ({
  type: 'other-till-sale',
  sale: {
    locationId: s.organisation.locationId,
    receipt,
    occurredAt: '2026-10-06T10:30:00Z',
    lines,
    payments: [{ method: 'card', amountMinor: lines.reduce((n, l) => n + l.totalMinor, 0) }],
    ...extra,
  },
})

describe('sales from another till', () => {
  it('comes only through an access key, and never into a sample studio', () => {
    const s = local()
    const command = sale(s, 'T-1', [line(1200, { name: 'Hand cream' })])
    expect(run(s, command, null)).toMatchObject({
      ok: false,
      error: 'Only another till sends these, through its access key.',
    })
    expect(run(seed('UK'), command)).toMatchObject({
      ok: false,
      error: 'A sample studio takes no sales from another till.',
    })
    // No role may send one from the app.
    for (const role of Object.keys(roleNames) as Role[]) {
      expect(can(role, 'other-till-sale')).toBe(false)
      expect(can(role, 'other-till-refund')).toBe(false)
    }
  })

  it('links what SALEANE knows by id, barcode or SKU, and keeps the rest by name', () => {
    const s = local()
    const [balm, serum, spf] = operations(s).products
    const service = s.services[0]
    const before = stock(s, balm.id, s.organisation.locationId)
    const { state, recordId } = done(
      s,
      sale(s, 'T-1', [
        line(service.priceMinor, { kind: 'treatment', serviceId: service.id }),
        line(3200, { productId: balm.id }),
        line(4800, { barcode: serum.barcode }),
        line(2800, { sku: spf.sku.toLowerCase() }),
        line(500, { name: 'Gift bag' }),
        line(700, { kind: 'treatment', name: 'Express brow tidy' }),
      ]),
    )
    const kept = otherTillSales(state).find((x) => x.id === recordId)!
    expect(kept.lines.map((l) => [l.name, l.serviceId ?? l.productId ?? null])).toEqual([
      [service.name, service.id],
      [balm.name, balm.id],
      [serum.name, serum.id],
      [spf.name, spf.id],
      ['Gift bag', null],
      ['Express brow tidy', null],
    ])
    expect(kept).toMatchObject({ kind: 'sale', till: { keyId: 'key-1', name: 'Shop till' } })
    expect(stock(state, balm.id, s.organisation.locationId)).toBe(before - 1)
    // Each movement names the sale, so the stock record says where it went.
    expect(operations(state).movements.filter((m) => m.otherTillSaleId === recordId)).toHaveLength(
      3,
    )
    expect(tillLabel(kept)).toBe('Receipt T-1 from Shop till')
  })

  it('checks every amount, the time, the team member and that a receipt comes once', () => {
    const s = local()
    const refused = (command: Command, words: string) => {
      const result = run(s, command)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toContain(words)
    }
    refused(sale(s, 'T-1', [line(1200)]), 'send its name')
    refused(sale(s, 'T-1', [{ ...line(1200, { name: 'Cream' }), taxMinor: 5 }]), 'tax inside')
    refused(sale(s, 'T-1', [line(1200, { name: 'Cream', productId: 'nope' })]), 'not in SALEANE')
    refused(
      sale(s, 'T-1', [line(1200, { kind: 'treatment', name: 'Tidy', sku: 'X' })]),
      'a treatment has no product',
    )
    refused(
      sale(s, 'T-1', [line(1200, { name: 'Cream' })], {
        payments: [{ method: 'cash', amountMinor: 1000 }],
      }),
      'payments add up to 1000',
    )
    refused(
      sale(s, 'T-1', [line(1200, { name: 'Cream' })], { occurredAt: '2026-10-06T12:10:00Z' }),
      'later than now',
    )
    refused(
      sale(s, 'T-1', [line(1200, { name: 'Cream' })], { occurredAt: '2026-06-01T12:00:00Z' }),
      'within 92 days',
    )
    refused(sale(s, 'T-1', [line(1200, { name: 'Cream' })], { staffId: 'nobody' }), 'team member')
    refused(
      sale(s, 'T-1', [line(1200, { name: 'Cream' })], { locationId: 'nowhere' }),
      'open location',
    )
    // A till's clock a few minutes ahead is fine.
    const first = done(
      s,
      sale(s, 'T-1', [line(1200, { name: 'Cream' })], { occurredAt: '2026-10-06T12:03:00Z' }),
    )
    const again = run(first.state, sale(s, 'T-1', [line(1200, { name: 'Cream' })]))
    expect(again).toMatchObject({
      ok: false,
      error: 'Receipt T-1 from this location is already in SALEANE, so it was not added again.',
    })
    // A refund may share its number with a sale: they are different kinds of receipt.
    expect(
      run(first.state, {
        type: 'other-till-refund',
        refund: {
          ...(sale(s, 'T-1', [line(200, { name: 'Cream' })]) as { sale: OtherTillSaleInput }).sale,
          refundOf: 'T-1',
          reason: 'Damaged',
        },
      }).ok,
    ).toBe(true)
  })

  it('never refuses a sale for stock, and says when the shelf was short', () => {
    const s = local()
    const peel = operations(s).products.find((p) => p.id === 'product-hydrating-serum')!
    const here = s.organisation.locationId
    const on = stock(s, peel.id, here)
    const { state, recordId } = done(
      s,
      sale(s, 'T-1', [line(4800 * (on + 2), { productId: peel.id, quantity: on + 2 })]),
    )
    const kept = otherTillSales(state).find((x) => x.id === recordId)!
    expect(stock(state, peel.id, here)).toBe(0)
    expect(shelfShort(kept)).toEqual([{ productId: peel.id, name: peel.name, short: 2 }])
  })

  it('gives money back on a sale from the same location, never more than it took', () => {
    let s = local()
    const balm = operations(s).products[0]
    const here = s.organisation.locationId
    const before = stock(s, balm.id, here)
    s = done(s, sale(s, 'T-1', [line(6400, { productId: balm.id, quantity: 2 })])).state
    const refund = (receipt: string, total: number, quantity = 1, refundOf = 'T-1'): Command => ({
      type: 'other-till-refund',
      refund: {
        locationId: here,
        receipt,
        refundOf,
        reason: 'Changed their mind',
        occurredAt: '2026-10-06T11:00:00Z',
        lines: [line(total, { productId: balm.id, quantity })],
        payments: [{ method: 'card', amountMinor: total }],
      },
    })
    expect(run(s, refund('R-0', 3200, 1, 'T-9'))).toMatchObject({ ok: false })
    const one = done(s, refund('R-1', 3200))
    s = one.state
    expect(stock(s, balm.id, here)).toBe(before - 1)
    const original = otherTillSales(s).find((x) => x.receipt === 'T-1')!
    expect(refundedOn(s, original.id)).toBe(3200)
    expect(run(s, refund('R-2', 6400, 2))).toMatchObject({
      ok: false,
      error: 'Only 3200 is left to give back on receipt T-1.',
    })
    // Two lines of the same product never put back more than the sale took off.
    const two = done(s, {
      type: 'other-till-refund',
      refund: {
        ...(refund('R-2', 3200) as { refund: OtherTillRefundInput }).refund,
        lines: [
          line(1600, { productId: balm.id, quantity: 1 }),
          line(1600, { productId: balm.id, quantity: 1 }),
        ],
        payments: [{ method: 'card', amountMinor: 3200 }],
      },
    })
    expect(stock(two.state, balm.id, here)).toBe(before)
    const kept = otherTillSales(two.state).find((x) => x.id === two.recordId)!
    expect(kept.lines.map((l) => l.shelf)).toEqual([1, 0])
    expect(run(two.state, refund('R-3', 100))).toMatchObject({
      ok: false,
      error: 'Everything on receipt T-1 has already been given back.',
    })
  })

  it('is checked whenever the studio record is read', () => {
    const s = done(
      local(),
      sale(local(), 'T-1', [line(3200, { productId: 'product-cleansing-balm' })]),
    ).state
    const broken = (change: (x: BusinessState) => void, words: string) => {
      const copy = structuredClone(s)
      change(copy)
      expect(() => parseState(copy, copy.organisation.region)).toThrow(words)
    }
    broken((x) => {
      x.otherTillSales![0].totalMinor = 1
    }, 'does not add up')
    broken((x) => {
      x.otherTillSales!.push({ ...x.otherTillSales![0], id: 'copy' })
    }, 'recorded twice')
    broken((x) => {
      x.otherTillSales![0].lines[0].shelf = 0
    }, 'Stock from another till')
    broken((x) => {
      x.operations!.movements.find((m) => m.otherTillSaleId)!.saleId = 'sale-x'
    }, 'two receipts')
    broken((x) => {
      x.otherTillSales![0].organisationId = 'other'
    }, 'another studio')
  })

  it('counts in takings, Money and the business figures for its location and day', () => {
    let s = local()
    const service = s.services[0]
    const before = dailySummary(s, '2026-10-06', '2026-10-06')[0]
    s = done(
      s,
      sale(s, 'T-1', [
        line(9600, { kind: 'treatment', serviceId: service.id }),
        line(2400, { name: 'Gift bag' }),
      ]),
    ).state
    const after = dailySummary(s, '2026-10-06', '2026-10-06')[0]
    expect(after.servicesMinor - before.servicesMinor).toBe(8000)
    expect(after.productsMinor - before.productsMinor).toBe(2000)
    expect(after.taxMinor - before.taxMinor).toBe(2000)
    const row = salesByReceipt(s, '2026-10-06', '2026-10-06').find((r) => r.receipt === 'T-1')!
    expect(row).toMatchObject({ source: 'Shop till', method: 'other_till_card', client: '' })
    expect(salesCsv([row], 'GBP')).toContain('Shop till')
    expect(salesCsv([row], 'GBP')).toContain('Card on another till')
    const money = moneyInAndOut(s, '2026-10-06', '2026-10-06').filter((r) =>
      r.method.startsWith('other_till'),
    )
    expect(money).toEqual([
      {
        date: '2026-10-06',
        kind: 'Sale on another till',
        reference: 'T-1 (Shop till)',
        client: '',
        method: 'other_till_card',
        amountMinor: 12000,
        test: false,
      },
    ])
    const figures = report(s, 7)
    expect(figures.otherTill).toBe(10000)
    expect(figures.tills).toEqual(['Shop till'])
    // Kept apart from the visit figures: the treatment takings are SALEANE's visits only.
    expect(figures.revenue).toBe(report(local(), 7).revenue)
    // A location's own figures hold only its own sales.
    const elsewhere = s.operations!.locations?.[0]?.id
    if (elsewhere) {
      expect(atPlace(s, elsewhere).otherTillSales).toEqual([])
      expect(report(s, 7, elsewhere).otherTill).toBe(0)
    }
  })

  it('keeps a renter’s own takings apart and pays commission to the team member it names', () => {
    let s = local()
    const service = s.services.find((x) =>
      s.staff.find((p) => p.id === 'staff-theo')!.serviceIds.includes(x.id),
    )!
    const other = s.staff.find((p) => p.id !== 'staff-theo' && !p.archived)!
    s = done(
      s,
      sale(
        s,
        'T-THEO',
        [
          line(6000, { kind: 'treatment', serviceId: service.id }),
          line(3200, { productId: 'product-cleansing-balm' }),
        ],
        { staffId: 'staff-theo' },
      ),
    ).state
    s = done(
      s,
      sale(s, 'T-OTHER', [line(6000, { kind: 'treatment', serviceId: service.id })], {
        staffId: other.id,
      }),
    ).state
    const day = dailySummary(s, '2026-10-06', '2026-10-06')[0]
    const without = dailySummary(local(), '2026-10-06', '2026-10-06')[0]
    // Theo's treatment is his own; the product stays the studio's sale.
    expect(day.rentersMinor - without.rentersMinor).toBe(6000)
    const pay = payPeriod(s, '2026-10-01', '2026-10-31')
    const theo = pay.find((p) => p.staff.id === 'staff-theo')!
    expect(theo.lines.some((l) => l.receipt === 'T-THEO')).toBe(false)
    const theirs = pay.find((p) => p.staff.id === other.id)!
    const line1 = theirs.lines.find((l) => l.receipt === 'T-OTHER')!
    expect(line1).toMatchObject({
      kind: 'counter',
      label: 'Sold on Shop till',
      servicesMinor: 5000,
    })
    // Under a studio that absorbs money given back, a refund leaves commission alone.
    const refunded = done(s, {
      type: 'other-till-refund',
      refund: {
        locationId: s.organisation.locationId,
        receipt: 'R-1',
        refundOf: 'T-OTHER',
        reason: 'Unhappy with it',
        occurredAt: '2026-10-06T11:00:00Z',
        staffId: other.id,
        lines: [line(6000, { kind: 'treatment', serviceId: service.id })],
        payments: [{ method: 'card', amountMinor: 6000 }],
      },
    }).state
    const back = payPeriod(refunded, '2026-10-01', '2026-10-31').find(
      (p) => p.staff.id === other.id,
    )!
    expect(back.lines.find((l) => l.receipt === 'R-1')).toMatchObject({
      kind: 'refund',
      label: 'Given back on Shop till',
      servicesMinor: -5000,
      commissionMinor: -line1.commissionMinor,
    })
    const absorbed = structuredClone(refunded)
    absorbed.operations!.payRules = [
      ...(absorbed.operations!.payRules ?? []),
      {
        id: 'rules-studio',
        refunds: 'studio',
        tips: 'person',
        pool: 'week',
        from: '2026-10-01',
        createdAt: now,
        actor: 'Owner',
      } as never,
    ]
    const kept = payPeriod(absorbed, '2026-10-01', '2026-10-31').find(
      (p) => p.staff.id === other.id,
    )!
    expect(kept.lines.some((l) => l.receipt === 'R-1')).toBe(false)
  })

  it('has words in the change record, a place in the studio export and the branch rules', () => {
    expect(changeWords['other-till-sale']).toEqual(['money', 'Recorded a sale from another till'])
    expect(changeWords['other-till-refund'][0]).toBe('money')
    const s = done(local(), sale(local(), 'T-1', [line(1200, { name: 'Cream' })]))
    const names = recordNames(s.state)
    const entry = describeChange(s.state, names, {
      id: 'audit-1',
      action: 'other-till-sale',
      recordId: s.recordId,
      occurredAt: Date.parse(now),
      actor: null,
      account: null,
      detail: null,
      keyName: 'Shop till',
    })
    expect(entry).toMatchObject({
      who: 'Shop till, through its access key',
      person: false,
      group: 'money',
      what: 'Recorded a sale from another till',
      about: 'Receipt T-1 from Shop till',
    })
    const preview = previewStudioExport(
      studioExport(s.state, { generatedAt: now, generatedBy: 'Ada Owner' }),
    )
    expect(preview.sections).toContainEqual({
      label: 'Sales and refunds from other tills',
      count: 1,
    })
    const command = sale(s.state, 'T-2', [line(1200, { name: 'Cream' })])
    expect(branchRefusal(s.state, s.state.organisation.locationId, command)).toBeNull()
    expect(branchRefusal(s.state, 'elsewhere', command)).toBe('That is at another location.')
  })

  it('describes each scope in plain words and keeps location keys to their own things', () => {
    for (const scope of writeScopes) {
      expect(scopeWords[scope].label.length).toBeGreaterThan(5)
      expect(scopeWords[scope].detail).not.toMatch(/[—!]/)
    }
    expect(LOCATION_SCOPES).not.toContain('clients:write')
    expect(keySummary(['appointments:read', 'appointments:write'])).toBe(
      'May read visits, and add and change visits',
    )
    expect(keySummary(['sales:write'])).toBe('May send in till sales')
  })
})

describe('email news from other software', () => {
  const contact = {
    name: 'Lena Park',
    email: 'lena@example.invalid',
    phone: '+44 7700 900126',
    marketingConsent: true,
  }
  it('is recorded only when the software says who agreed, when and how', () => {
    const s = local()
    const add: Command = { type: 'client', contact }
    expect(run(s, add, { keyId: 'k', name: 'App' })).toMatchObject({
      ok: false,
      error: 'Email news is recorded only when the software says who agreed, when and how.',
    })
    expect(
      run(s, add, { keyId: 'k', name: 'App', consent: { at: now, how: 'Ticked the box' } }),
    ).toMatchObject({ ok: false, error: expect.stringContaining('Say which version') })
    const ok = done(s, add, {
      keyId: 'k',
      name: 'App',
      consent: { at: '2026-10-06T09:00:00.000Z', how: 'Ticked the box', wordingVersion: 1 },
    })
    expect(ok.state.consentRecords!.at(-1)).toMatchObject({
      source: 'other software',
      given: true,
      saidAt: '2026-10-06T09:00:00.000Z',
      how: 'Ticked the box',
      actor: 'Shop till (access key)',
    })
    // Without news, nothing is recorded and nothing is needed.
    expect(
      run(s, { type: 'client', contact: { ...contact, marketingConsent: false } }, till).ok,
    ).toBe(true)
  })
})
