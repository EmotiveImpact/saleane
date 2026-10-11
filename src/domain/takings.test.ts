import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { execute } from './commands'
import type { Command } from './commands'
import type { BusinessState } from './model'
import { parseState } from './model'
import { createWorkspace } from './workspace'
import { seed } from './seed'
import { rentalInputSchema } from './rentSchema'
import { periodWorking, rentOwed, rentStatement, rentTerms } from './rent'
import { report } from './selectors'
import { takings } from './group'
import { dailySummary, dayJournal, dayTakings, salesByReceipt, taxSummary } from './accounts'
import { cashForDay } from './tillCount'
import { payPeriod } from './pay'

// Stage 3: rent as a share of a renter's takings, and their takings kept out of the studio's own.
const now = '2026-10-06T08:00:00.000Z'
const day = now.slice(0, 10)
let sequence = 0
function local(): BusinessState {
  const s = createWorkspace({ name: 'Takings test studio', region: 'UK' })
  const sample = seed('UK')
  for (const key of ['clients', 'services', 'staff', 'resources'] as const)
    Object.assign(s, {
      [key]: sample[key].map((row) => ({ ...row, organisationId: s.organisation.id })),
    })
  return s
}
const run = (s: BusinessState, command: Command, at = now) =>
  execute(s, command, at, () => `takings-${++sequence}`)
function apply(s: BusinessState, command: Command, at = now) {
  const result = run(s, command, at)
  if (!result.ok) throw new Error(result.error)
  return result.state
}

/** A studio with a £32 balm in stock, Maya on her usual 40% and 10%, and Theo renting from 29 September. */
function studio(terms: { amountMinor?: number; percentBps?: number; products?: boolean } = {}) {
  let s = apply(local(), {
    type: 'product',
    input: { name: 'Cleansing Balm', sku: 'BALM', priceMinor: 3200, reorderAt: 1, archived: false },
  })
  const balm = s.operations!.products[0].id
  s = apply(s, { type: 'stock', productId: balm, quantity: 20, reason: 'received', note: 'In' })
  s = apply(s, {
    type: 'pay-rate',
    staffId: 'staff-maya',
    serviceBps: 4000,
    productBps: 1000,
    from: '2026-01-01',
  })
  s = apply(s, {
    type: 'rental',
    input: {
      staffId: 'staff-theo',
      space: 'chair',
      resourceId: 'chair-one',
      amountMinor: terms.amountMinor ?? 0,
      ...(terms.percentBps === 0 ? {} : { percentBps: terms.percentBps ?? 1000 }),
      ...(terms.products ? { products: true } : {}),
      every: 'week',
      from: '2026-09-29',
    },
  } as Command)
  return { s, balm, rental: () => s.operations!.rentals![0] }
}

let start = 570
/** A completed visit paid in cash: Theo's cut by default, with any products and a tip. */
function visit(
  s: BusinessState,
  options: {
    date?: string
    staffId?: string
    serviceId?: string
    priceMinor?: number
    products?: { productId: string; quantity: number }[]
    tipMinor?: number
  } = {},
) {
  const date = options.date ?? day
  start = start >= 900 ? 570 : start + 120
  const theo = (options.staffId ?? 'staff-theo') === 'staff-theo'
  s = apply(
    s,
    {
      type: 'import-appointments',
      source: 'Test',
      reviewed: true,
      appointments: [
        {
          clientId: 'client-1',
          serviceId: options.serviceId ?? (theo ? 'service-cut' : 'service-facial'),
          staffId: options.staffId ?? 'staff-theo',
          date,
          startMinutes: start,
          priceMinor: options.priceMinor ?? (theo ? 7500 : 9500),
          depositPaidMinor: 0,
        },
      ],
    },
    // Booked on the morning of the visit, so a day already gone can still be added and paid.
    date < day ? `${date}T07:00:00.000Z` : now,
  )
  const a = s.appointments.filter((x) => x.source === 'import').at(-1)!
  const at = `${date}T16:00:00.000Z`
  s = apply(s, { type: 'arrive', appointmentId: a.id }, at)
  s = apply(
    s,
    {
      type: 'checkout',
      appointmentId: a.id,
      tipMinor: options.tipMinor ?? 0,
      method: 'cash',
      ...(options.products ? { products: options.products } : {}),
    } as Command,
    at,
  )
  return { s, sale: s.sales.find((x) => x.appointmentId === a.id)! }
}
const pay = (rentalId: string, periodStart: string, amountMinor: number) =>
  ({ type: 'rent-payment', rentalId, periodStart, amountMinor, method: 'cash' }) as Command

describe('rent as a share of takings', () => {
  it('needs a fixed amount, a share or both', () => {
    const terms = {
      staffId: 'staff-theo',
      space: 'chair',
      resourceId: 'chair-one',
      every: 'week',
      from: '2026-09-29',
    }
    const parse = (extra: object) => rentalInputSchema.safeParse({ ...terms, ...extra })
    expect(parse({ amountMinor: 0 }).error?.issues[0].message).toBe('Enter the rent.')
    expect(parse({ amountMinor: 0, percentBps: 0 }).success).toBe(false)
    expect(parse({ amountMinor: 0, percentBps: 10001 }).success).toBe(false)
    expect(parse({ amountMinor: 0, percentBps: 1000 }).success).toBe(true)
    expect(parse({ amountMinor: 5000, percentBps: 1000, products: true }).success).toBe(true)
    // Only what was asked for is kept: no share, no products flag.
    const { s } = studio({ amountMinor: 5000, percentBps: 0 })
    expect(s.operations!.rentals![0]).not.toHaveProperty('percentBps')
    expect(s.operations!.rentals![0]).not.toHaveProperty('products')
  })

  it('works out a share of treatments on rental days, leaving products and tips out', () => {
    const { s: base, balm, rental } = studio()
    let s = visit(base, {
      date: '2026-09-30',
      products: [{ productId: balm, quantity: 1 }],
      tipMinor: 500,
    }).s
    s = visit(s, { date: '2026-10-01', priceMinor: 8005 }).s
    // Before the rental started, Theo's takings were the studio's, so they are not in the share.
    s = visit(s, { date: '2026-09-26' }).s
    s = visit(s, { date: day }).s
    expect(rentTerms(s, rental())).toBe('10% of treatments, worked out each week')
    const [first, second] = rentStatement(s, s.operations!.rentals![0], day)
    // 10% of £155.05 is £15.505, rounded once for the period to £15.51.
    expect(first).toMatchObject({
      start: '2026-09-29',
      open: false,
      shareMinor: 1551,
      dueMinor: 1551,
      owedMinor: 1551,
      runningMinor: 0,
    })
    expect(first.takings).toMatchObject({ visits: 2, treatmentsMinor: 15505, productsMinor: 0 })
    expect(periodWorking(s, s.operations!.rentals![0], first)).toBe(
      '10% of £155.05 in treatments is £15.51.',
    )
    // The week still running shows its share so far, due once it ends.
    expect(second).toMatchObject({ open: true, shareMinor: 750, owedMinor: 0, runningMinor: 750 })
    expect(periodWorking(s, s.operations!.rentals![0], second)).toBe(
      '10% of £75.00 in treatments is £7.50 so far.',
    )
    expect(rentOwed(s, day)).toBe(1551)
  })

  it('owes the fixed part from the start of a period and the share once it ends', () => {
    const { s: base, rental } = studio({ amountMinor: 5000 })
    let s = visit(base, { date: '2026-09-30' }).s
    s = visit(s, { date: day }).s
    expect(rentTerms(s, rental())).toBe('£50.00 a week plus 10% of treatments')
    const id = rental().id
    const [first, second] = rentStatement(s, s.operations!.rentals![0], day)
    expect(first).toMatchObject({ dueMinor: 5750, owedMinor: 5750, runningMinor: 0 })
    expect(periodWorking(s, s.operations!.rentals![0], first)).toBe(
      '£50.00 fixed plus 10% of £75.00 in treatments is £7.50: £57.50.',
    )
    expect(second).toMatchObject({ open: true, dueMinor: 5750, owedMinor: 5000, runningMinor: 750 })
    expect(rentOwed(s, day)).toBe(10750)
    // Rent can be paid up to what is due so far, and no more.
    const over = run(s, pay(id, day, 5751))
    expect(!over.ok && over.error).toBe('Only £57.50 more is due for that period so far.')
    const paid = apply(s, pay(id, '2026-09-29', 5750))
    const again = run(paid, pay(id, '2026-09-29', 1))
    expect(!again.ok && again.error).toBe('Nothing more is due for that period.')
    expect(rentStatement(paid, paid.operations!.rentals![0], day)[0].owedMinor).toBe(0)
  })

  it('counts products when they are the renter’s own, and takes money given back off', () => {
    const { s: base, balm, rental } = studio({ percentBps: 2000, products: true })
    expect(rentTerms(base, rental())).toBe('20% of treatments and products, worked out each week')
    const paid = visit(base, {
      date: '2026-09-30',
      products: [{ productId: balm, quantity: 1 }],
      tipMinor: 500,
    })
    let s = apply(
      paid.s,
      {
        type: 'counter-sale',
        staffId: 'staff-theo',
        products: [{ productId: balm, quantity: 1 }],
        method: 'cash',
      } as Command,
      '2026-10-01T12:00:00.000Z',
    )
    const [first] = rentStatement(s, s.operations!.rentals![0], day)
    expect(first.takings).toMatchObject({ treatmentsMinor: 7500, productsMinor: 6400 })
    expect(first.shareMinor).toBe(2780)
    expect(periodWorking(s, s.operations!.rentals![0], first)).toBe(
      '20% of £75.00 in treatments and £64.00 in products is £27.80.',
    )
    // Money given back today comes off this week's takings, in proportion to what was theirs on
    // the receipt (the tip is left out), and the share never goes below nothing.
    s = apply(s, {
      type: 'refund',
      saleId: paid.sale.id,
      amountMinor: 3200,
      reason: 'Did not suit',
      reference: 'R-1',
      method: 'cash',
    } as Command)
    const [before, now] = rentStatement(s, s.operations!.rentals![0], day)
    expect(before.shareMinor).toBe(2780)
    expect(now.takings).toMatchObject({ givenBackMinor: Math.round((3200 * 10700) / 11200) })
    expect(now).toMatchObject({ shareMinor: 0, dueMinor: 0 })
  })

  it('keeps the sample studio’s rent at a fixed amount plus a share, with payments in the ledger', () => {
    const s = seed('UK')
    const theo = s.operations!.rentals!.find((r) => r.staffId === 'staff-theo')!
    expect(rentTerms(s, theo)).toBe('£50.00 a week plus 10% of treatments')
    const statement = rentStatement(s, theo, day)
    expect(statement.every((p) => p.paidMinor <= p.dueMinor)).toBe(true)
    expect(statement.at(-1)).toMatchObject({ open: true })
    expect(() => parseState(s, 'UK')).not.toThrow()
  })
})

describe('renter takings kept apart', () => {
  // The studio's figures run up to its own today, so the clock is held on the test's day.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(now))
  })
  afterEach(() => vi.useRealTimers())

  /** Maya's facial today, Theo's cut with a balm and a tip today, his cut last week, rent paid. */
  function day1(products = false) {
    const { s: base, balm, rental } = studio({ products })
    let s = visit(base, { date: '2026-09-30' }).s
    s = visit(s, { staffId: 'staff-maya' }).s
    s = visit(s, { products: [{ productId: balm, quantity: 1 }], tipMinor: 500 }).s
    s = apply(s, pay(rental().id, '2026-09-29', 750))
    return s
  }

  it('leaves a renter’s takings out of the studio’s figures and counts their rent', () => {
    const s = day1()
    const r = report(s, 7)
    expect(r).toMatchObject({
      revenue: 9500,
      renters: 15000,
      rent: 750,
      retail: 3200,
      tips: 0,
      completed: 3,
      ownCompleted: 1,
    })
    const theo = r.byStaff.find((x) => x.staff.id === 'staff-theo')!
    expect(theo).toMatchObject({ revenue: 0, visits: 2, renting: 2 })
    expect(r.byDay.find((d) => d.date === day)!.revenue).toBe(9500)
    expect(takings(s, s.organisation.locationId!, '2026-09-30', day).minor).toBe(9500)
    // Their own products, when the rental says so, are theirs too.
    expect(report(day1(true), 7)).toMatchObject({ retail: 0, renters: 15000 + 3200 })
    // They earn no commission on them.
    expect(
      payPeriod(s, '2026-09-29', day).find((x) => x.staff.id === 'staff-theo')!.commissionMinor,
    ).toBe(0)
  })

  it('keeps every receipt in the till and the sales list, saying which part is a renter’s', () => {
    const s = day1()
    // Cash in the till is every cash receipt: Maya's £95 and Theo's £75 + £32 + £5 tip.
    expect(cashForDay(s, day).cashIn).toBe(9500 + 11200)
    const rows = salesByReceipt(s, day, day)
    expect(rows).toHaveLength(2)
    const theo = rows.find((row) => row.renter)!
    expect(theo.renter).toMatchObject({
      name: 'Theo Bennett',
      servicesMinor: 7500,
      productsMinor: 0,
    })
    expect(rows.filter((row) => !row.renter)).toHaveLength(1)
  })

  it('holds a renter’s takings apart in the accounts, in a journal that balances', () => {
    const s = day1()
    const [summary] = dailySummary(s, day, day)
    expect(summary).toMatchObject({
      servicesMinor: 9500,
      productsMinor: 3200,
      tipsMinor: 500,
      rentMinor: 750,
      rentersMinor: 7500,
    })
    // Everything that came in that day: the receipts and the rent.
    expect(dayTakings(summary)).toBe(9500 + 11200 + 750)
    const codes = {
      services: '200',
      products: '201',
      tax: '820',
      tips: '825',
      plans: '830',
      rent: '210',
      fees: '215',
      refunds: '205',
      clearing: '090',
      renters: '835',
    }
    const lines = dayJournal(summary, codes)
    expect(lines.reduce((t, l) => t + l.creditMinor - l.debitMinor, 0)).toBe(0)
    expect(lines.find((l) => l.account === 'Takings held for renters')).toMatchObject({
      code: '835',
      creditMinor: 7500,
    })
    // The tax summary is the studio's own takings only.
    expect(taxSummary(s, day, day).reduce((t, row) => t + row.netMinor, 0)).toBe(9500 + 3200)
  })
})
