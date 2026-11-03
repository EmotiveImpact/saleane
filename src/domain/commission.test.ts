import { describe, expect, it } from 'vitest'
import { dispatch, execute } from './commands'
import type { Command } from './commands'
import type { BusinessState } from './model'
import { parseState } from './model'
import { can, permissionFor } from './operations'
import { createWorkspace } from './workspace'
import { seed } from './seed'
import { payCsv, payPeriod, targetProgress, withoutPayRates } from './pay'
import {
  STEP_KIND_SENTENCE,
  atRate,
  commissionBasis,
  parsePercent,
  productRate,
  stepCommission,
  stepsPhrase,
  targetFor,
  treatmentRate,
} from './commission'
import { changeWords } from './changeRecord'

// Stage 3: commission by treatment or product, steps by takings and monthly targets.
const now = '2026-10-06T08:00:00.000Z'
const day = now.slice(0, 10)
let sequence = 0
function local(): BusinessState {
  const s = createWorkspace({ name: 'Commission test studio', region: 'UK' })
  const sample = seed('UK')
  for (const key of ['clients', 'services', 'staff', 'resources'] as const)
    Object.assign(s, {
      [key]: sample[key].map((row) => ({ ...row, organisationId: s.organisation.id })),
    })
  return s
}
const run = (s: BusinessState, command: Command, at = now) =>
  execute(s, command, at, () => `commission-${++sequence}`)
function apply(s: BusinessState, command: Command, at = now) {
  const result = run(s, command, at)
  if (!result.ok) throw new Error(result.error)
  return result.state
}
const usual = (staffId: string, serviceBps: number, productBps: number) =>
  ({ type: 'pay-rate', staffId, serviceBps, productBps, from: '2026-01-01' }) as Command
const ownRate = (
  item: Extract<Command, { type: 'commission-rate' }>['input']['item'],
  bps: number | null,
  staffId?: string,
  from = '2026-09-01',
) =>
  ({
    type: 'commission-rate',
    input: { ...(staffId ? { staffId } : {}), item, bps, from },
  }) as Command
const steps = (
  list: { fromMinor: number; bps: number }[] | null,
  kind: 'marginal' | 'whole' = 'marginal',
  staffId?: string,
  on: 'treatments' | 'all' = 'treatments',
  from = '2026-09-01',
) =>
  ({
    type: 'commission-steps',
    input: { ...(staffId ? { staffId } : {}), on, kind, steps: list, from },
  }) as Command

/** A studio with a £32 balm and a £40 serum in stock, and Maya on 40% and 10%. */
function studio() {
  let s = local()
  for (const [name, priceMinor] of [
    ['Cleansing Balm', 3200],
    ['Hydrating Serum', 4000],
  ] as const)
    s = apply(s, {
      type: 'product',
      input: {
        name,
        sku: name.slice(0, 4).toUpperCase(),
        priceMinor,
        reorderAt: 1,
        archived: false,
      },
    })
  const [balm, serum] = s.operations!.products.map((p) => p.id)
  for (const id of [balm, serum])
    s = apply(s, { type: 'stock', productId: id, quantity: 20, reason: 'received', note: 'In' })
  s = apply(s, usual('staff-maya', 4000, 1000))
  return { s, balm, serum }
}
let start = 570
/** A completed, paid visit on a day: the treatment's price, any products and a tip. */
function visit(
  s: BusinessState,
  options: {
    date?: string
    serviceId?: string
    priceMinor?: number
    staffId?: string
    products?: { productId: string; quantity: number }[]
    tipMinor?: number
    at?: string
  } = {},
) {
  const date = options.date ?? day
  start = start >= 900 ? 570 : start + 120
  // Booked on the morning of the visit, so a day already gone can still be added and paid.
  const morning = `${date}T07:00:00.000Z`
  s = apply(
    s,
    {
      type: 'import-appointments',
      source: 'Test',
      reviewed: true,
      appointments: [
        {
          clientId: 'client-1',
          serviceId: options.serviceId ?? 'service-facial',
          staffId: options.staffId ?? 'staff-maya',
          date,
          startMinutes: start,
          priceMinor: options.priceMinor ?? 9500,
          depositPaidMinor: 0,
        },
      ],
    },
    date < day ? morning : now,
  )
  const a = s.appointments.filter((x) => x.source === 'import').at(-1)!
  const at = options.at ?? `${date}T16:00:00.000Z`
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
const row = (s: BusinessState, staffId = 'staff-maya', from = '2026-10-01', to = day) =>
  payPeriod(s, from, to).find((r) => r.staff.id === staffId)!
/** Every person's parts add up to their commission, and their receipts do too. */
function addsUp(s: BusinessState, from = '2026-10-01', to = day) {
  for (const r of payPeriod(s, from, to)) {
    expect(r.parts.reduce((t, p) => t + p.commissionMinor, 0)).toBe(r.commissionMinor)
    expect(r.lines.reduce((t, l) => t + l.commissionMinor, 0)).toBe(r.commissionMinor)
  }
}

describe('which rate a treatment or product earns', () => {
  it('takes the most specific rate, and the usual rate once each is ended', () => {
    let { s } = studio()
    const facial = { kind: 'treatment', serviceId: 'service-facial' } as const
    const skin = { kind: 'category', category: 'Skin' } as const
    s = apply(s, ownRate(skin, 4100))
    s = apply(s, ownRate(skin, 4200, 'staff-maya'))
    s = apply(s, ownRate(facial, 4300))
    s = apply(s, ownRate(facial, 4400, 'staff-maya'))
    const at = () => treatmentRate(s, 'staff-maya', day, 'service-facial')
    expect(at()).toMatchObject({ by: 'own', bps: 4400 })
    // Sophia has no rate of her own, so the treatment's rate for everyone applies to her.
    expect(treatmentRate(s, 'staff-sophia', day, 'service-facial')).toMatchObject({ bps: 4300 })
    const order: [Command, number][] = [
      [ownRate(facial, null, 'staff-maya', day), 4300],
      [ownRate(facial, null, undefined, day), 4200],
      [ownRate(skin, null, 'staff-maya', day), 4100],
      [ownRate(skin, null, undefined, day), 4000],
    ]
    for (const [end, next] of order) {
      s = apply(s, end)
      expect(at()).toMatchObject({ bps: next })
    }
    expect(at().by).toBe('usual')
    // Each change keeps its start, so the day before still had the most specific rate.
    expect(treatmentRate(s, 'staff-maya', '2026-10-05', 'service-facial')).toMatchObject({
      bps: 4400,
    })
    // Someone with no usual rate and nothing else earns nothing on it.
    expect(treatmentRate(s, 'staff-theo', day, 'service-cut').by).toBe('none')
  })

  it('pays a product its own rate and the rest of the receipt at the usual rates', () => {
    const { s: base, balm, serum } = studio()
    let s = apply(base, ownRate({ kind: 'product', productId: serum }, 1500))
    s = apply(s, ownRate({ kind: 'treatment', serviceId: 'service-facial' }, 4500))
    s = visit(s, {
      products: [
        { productId: balm, quantity: 1 },
        { productId: serum, quantity: 2 },
      ],
    }).s
    expect(productRate(s, 'staff-maya', day, serum)).toMatchObject({ by: 'own', bps: 1500 })
    expect(row(s)).toMatchObject({
      servicesMinor: 9500,
      productsMinor: 11200,
      commissionMinor: atRate(9500, 4500) + atRate(3200, 1000) + atRate(8000, 1500),
    })
    expect(row(s).parts.map((p) => p.label)).toEqual([
      'Facial at 45%, its own rate'.replace('Facial', s.services[0].name),
      'Products at 10%',
      'Hydrating Serum at 15%, its own rate',
    ])
    addsUp(s)
  })

  it('refuses rates for things that are not there, and ending a rate that is not in force', () => {
    const { s, balm } = studio()
    expect(run(s, ownRate({ kind: 'treatment', serviceId: 'service-nope' }, 4000)).ok).toBe(false)
    expect(run(s, ownRate({ kind: 'product', productId: 'product-nope' }, 4000)).ok).toBe(false)
    expect(run(s, ownRate({ kind: 'products' }, 1000, 'staff-nobody')).ok).toBe(false)
    expect(run(s, ownRate({ kind: 'products' }, null)).ok).toBe(false)
    expect(run(s, ownRate({ kind: 'products' }, 10001)).ok).toBe(false)
    // A product used only in treatments is never sold, so it has no rate.
    const used = apply(s, {
      type: 'product',
      id: balm,
      input: {
        name: 'Cleansing Balm',
        sku: 'CLEA',
        priceMinor: 3200,
        reorderAt: 1,
        archived: false,
        forSale: false,
      },
    } as Command)
    expect(run(used, ownRate({ kind: 'product', productId: balm }, 1000)).ok).toBe(false)
  })
})

describe('steps by takings', () => {
  const twoSteps = [
    { fromMinor: 0, bps: 3000 },
    { fromMinor: 10000, bps: 3500 },
  ]

  it('pays each step only on the takings within it, receipt by receipt', () => {
    let { s } = studio()
    s = apply(s, steps(twoSteps, 'marginal', 'staff-maya'))
    s = visit(s, { date: '2026-10-02' }).s
    s = visit(s, { date: '2026-10-05' }).s
    const r = row(s)
    // £190 of treatments: 30% of the first £100, 35% of the £90 above it.
    expect(r.commissionMinor).toBe(3000 + 3150)
    expect(r.lines.map((l) => l.commissionMinor)).toEqual([2850, 3300])
    expect(r.parts).toEqual([
      { label: 'Treatments at 30% up to £100', takingsMinor: 10000, commissionMinor: 3000 },
      { label: 'Treatments at 35% above £100', takingsMinor: 9000, commissionMinor: 3150 },
    ])
    expect(commissionBasis(s, 'staff-maya', day)).toBe(
      'Treatments 30% to £100, then 35% · Products 10%',
    )
  })

  it('can pay the whole month at the step reached, catching up on the receipt that reaches it', () => {
    let { s } = studio()
    s = apply(s, steps(twoSteps, 'whole', 'staff-maya'))
    s = visit(s, { date: '2026-10-02' }).s
    expect(row(s).commissionMinor).toBe(2850)
    s = visit(s, { date: '2026-10-05' }).s
    const r = row(s)
    expect(r.commissionMinor).toBe(atRate(19000, 3500))
    expect(r.lines.map((l) => l.commissionMinor)).toEqual([2850, 6650 - 2850])
    expect(r.parts).toEqual([
      {
        label: 'Treatments at 35% on the whole month, past £100',
        takingsMinor: 19000,
        commissionMinor: 6650,
      },
    ])
    expect(stepsPhrase(s, { on: 'treatments', kind: 'whole', steps: twoSteps })).toBe(
      'Treatments 30%, or 35% on everything once past £100',
    )
    expect(STEP_KIND_SENTENCE.marginal).toMatch(/\.$/)
    expect(STEP_KIND_SENTENCE.whole).toMatch(/\.$/)
  })

  it('starts each month afresh, and counts the month’s earlier days for a shorter period', () => {
    let { s } = studio()
    s = apply(s, steps(twoSteps, 'marginal', 'staff-maya'))
    s = visit(s, { date: '2026-09-29' }).s
    s = visit(s, { date: '2026-10-02' }).s
    s = visit(s, { date: '2026-10-05' }).s
    expect(row(s, 'staff-maya', '2026-09-01', '2026-09-30').commissionMinor).toBe(2850)
    expect(row(s).commissionMinor).toBe(3000 + 3150)
    // A week from 5 October still knows the month had £95 by then.
    const week = row(s, 'staff-maya', '2026-10-05', day)
    expect(week.commissionMinor).toBe(3300)
    expect(week.parts.reduce((t, p) => t + p.takingsMinor, 0)).toBe(9500)
    addsUp(s, '2026-10-05', day)
  })

  it('lets a rate for a treatment win, and leaves its takings out of the steps', () => {
    let { s } = studio()
    s = apply(s, steps(twoSteps, 'marginal', 'staff-maya'))
    s = apply(s, ownRate({ kind: 'treatment', serviceId: 'service-restore' }, 4500))
    s = visit(s, { date: '2026-10-02', serviceId: 'service-restore', priceMinor: 12000 }).s
    s = visit(s, { date: '2026-10-05' }).s
    const r = row(s)
    expect(r.commissionMinor).toBe(atRate(12000, 4500) + atRate(9500, 3000))
    expect(r.parts.map((p) => p.label)).toEqual([
      'Treatments at 30% up to £100',
      expect.stringMatching(/ at 45%, its own rate$/),
    ])
  })

  it('counts products in the steps only when the steps say so', () => {
    const { s: base, balm } = studio()
    const products = [{ productId: balm, quantity: 1 }]
    let s = apply(base, steps(twoSteps, 'marginal', undefined, 'all'))
    s = visit(s, { products }).s
    expect(productRate(s, 'staff-maya', day, balm).by).toBe('steps')
    // £95 + £32 is £127: 30% of £100 and 35% of £27.
    expect(row(s).commissionMinor).toBe(3000 + 945)
    let t = apply(base, steps(twoSteps, 'marginal', undefined, 'treatments'))
    t = visit(t, { products }).s
    expect(row(t).commissionMinor).toBe(2850 + 320)
  })

  it('stops, putting someone back on everyone’s steps or their usual rate', () => {
    let { s } = studio()
    s = apply(s, steps(twoSteps, 'marginal'))
    s = apply(
      s,
      steps(
        [
          { fromMinor: 0, bps: 2000 },
          { fromMinor: 5000, bps: 2500 },
        ],
        'marginal',
        'staff-maya',
      ),
    )
    expect(treatmentRate(s, 'staff-maya', day, 'service-facial')).toMatchObject({ by: 'steps' })
    s = apply(s, steps(null, 'marginal', 'staff-maya', 'treatments', '2026-10-01'))
    s = visit(s).s
    expect(row(s).commissionMinor).toBe(2850)
    s = apply(s, steps(null, 'marginal', undefined, 'treatments', '2026-10-01'))
    expect(row(s).commissionMinor).toBe(3800)
    expect(run(s, steps(null, 'marginal', undefined, 'treatments', '2026-10-01')).ok).toBe(false)
    // Steps start on the first of a month, and each starts above the one before.
    expect(run(s, steps(twoSteps, 'marginal', undefined, 'treatments', '2026-10-02')).ok).toBe(
      false,
    )
    expect(
      run(
        s,
        steps([
          { fromMinor: 0, bps: 3000 },
          { fromMinor: 0, bps: 3500 },
        ]),
      ).ok,
    ).toBe(false)
  })

  it('takes money given back off the month’s steps, or at the step reached once they stop', () => {
    let { s } = studio()
    s = apply(s, steps(twoSteps, 'marginal', 'staff-maya'))
    const first = visit(s, { date: '2026-10-02' })
    s = visit(first.s, { date: '2026-10-05' }).s
    const refund = {
      type: 'refund',
      saleId: first.sale.id,
      amountMinor: 9500,
      reason: 'Did not suit',
      reference: 'R-1',
      method: 'cash',
    } as Command
    const same = apply(s, refund)
    // £190 less £95 is back to £95, all at 30%.
    expect(row(same).commissionMinor).toBe(2850)
    expect(row(same).givenBackMinor).toBe(9500)
    addsUp(same)
    // Given back in November once the steps have stopped, at the 35% October reached.
    const stopped = apply(s, steps(null, 'marginal', 'staff-maya', 'treatments', '2026-11-01'))
    const later = apply(stopped, refund, '2026-11-03T10:00:00.000Z')
    const november = row(later, 'staff-maya', '2026-11-01', '2026-11-30')
    expect(november.commissionMinor).toBe(-atRate(9500, 3500))
    expect(november.parts[0].label).toBe(
      'Treatments given back at 35%, the step reached in October 2026',
    )
    expect(row(later).commissionMinor).toBe(3000 + 3150)
  })

  it('adds up to the penny for awkward amounts and rates', () => {
    let { s } = studio()
    s = apply(
      s,
      steps(
        [
          { fromMinor: 0, bps: 1250 },
          { fromMinor: 3333, bps: 3333 },
          { fromMinor: 7777, bps: 4567 },
        ],
        'marginal',
        'staff-maya',
      ),
    )
    const prices = [1999, 2501, 3333, 1, 4999]
    const dates = ['2026-10-01', '2026-10-01', '2026-10-02', '2026-10-02', '2026-10-05']
    prices.forEach((priceMinor, i) => {
      s = visit(s, { date: dates[i], priceMinor }).s
    })
    const r = row(s)
    const total = prices.reduce((a, b) => a + b, 0)
    const exact = 3333 * 1250 + (7777 - 3333) * 3333 + (total - 7777) * 4567
    expect(r.commissionMinor).toBe(Math.floor((exact + 5000) / 10000))
    expect(r.commissionMinor).toBe(
      stepCommission({ kind: 'marginal', steps: s.operations!.commissionSteps![0].steps! }, total),
    )
    addsUp(s)
  })

  it('lets only the owner change rates and steps, and records who did in plain words', () => {
    for (const type of ['commission-rate', 'commission-steps'] as const) {
      expect(can('owner', permissionFor({ type }))).toBe(true)
      for (const role of ['manager', 'reception', 'practitioner', 'general', 'regional'] as const)
        expect(can(role, permissionFor({ type }))).toBe(false)
    }
    const { s } = studio()
    const saved = dispatch(s, steps(twoSteps), 'Ava · owner', now)
    expect(saved.ok && saved.state.operations!.commissionSteps!.at(-1)!.actor).toBe('Ava · owner')
    const rate = dispatch(s, ownRate({ kind: 'products' }, 1200), 'Ava · owner', now)
    expect(rate.ok && rate.state.operations!.commissionRates!.at(-1)!.actor).toBe('Ava · owner')
    expect(changeWords['commission-steps']).toEqual(['team', 'Changed commission steps by takings'])
    expect(changeWords['commission-rate']).toEqual([
      'team',
      'Changed a commission rate for a treatment or product',
    ])
  })
})

describe('monthly targets', () => {
  const target = (staffId: string, from: string, takingsMinor: number | null, extra = {}) =>
    ({ type: 'staff-target', input: { staffId, from, takingsMinor, ...extra } }) as Command

  it('counts takings the same way as pay, less money given back', () => {
    const { s: base, balm } = studio()
    let s = apply(base, target('staff-maya', '2026-09', 50000, { productsMinor: 5000 }))
    const paid = visit(s, { products: [{ productId: balm, quantity: 1 }], tipMinor: 1000 })
    s = apply(paid.s, {
      type: 'refund',
      saleId: paid.sale.id,
      amountMinor: 1370,
      reason: 'Goodwill',
      reference: 'R-2',
      method: 'cash',
    } as Command)
    const r = row(s)
    expect(r.target).toEqual({
      month: '2026-10',
      targetMinor: 50000,
      productsTargetMinor: 5000,
      takenMinor: 9500 + 3200 - r.givenBackMinor,
      treatmentsMinor: r.servicesMinor - Math.round((1370 * 9500) / 13700),
      productsMinor: r.productsMinor - Math.round((1370 * 3200) / 13700),
    })
    // The tip never counts, and the same figure is on their own page.
    expect(targetProgress(s, 'staff-maya', '2026-10', day)).toEqual(r.target)
    // A period that is not a month from its first has no target to show.
    expect(row(s, 'staff-maya', '2026-10-02', day).target).toBeUndefined()
  })

  it('carries on each month until changed or stopped, keeping the history', () => {
    let { s } = studio()
    s = apply(s, target('staff-maya', '2026-09', 50000))
    s = apply(s, target('staff-maya', '2026-11', 60000))
    expect(targetFor(s, 'staff-maya', '2026-10')?.takingsMinor).toBe(50000)
    expect(targetFor(s, 'staff-maya', '2027-01')?.takingsMinor).toBe(60000)
    s = apply(s, target('staff-maya', '2027-01', null))
    expect(targetFor(s, 'staff-maya', '2027-01')).toBeUndefined()
    expect(targetFor(s, 'staff-maya', '2026-12')?.takingsMinor).toBe(60000)
    expect(run(s, target('staff-maya', '2027-02', null)).ok).toBe(false)
  })

  it('lets owners and managers set targets, and refuses what does not make sense', () => {
    expect(can('owner', permissionFor({ type: 'staff-target' }))).toBe(true)
    expect(can('manager', permissionFor({ type: 'staff-target' }))).toBe(true)
    for (const role of ['reception', 'practitioner', 'general', 'regional'] as const)
      expect(can(role, permissionFor({ type: 'staff-target' }))).toBe(false)
    const { s } = studio()
    const set = dispatch(s, target('staff-maya', '2026-10', 50000), 'Mo · manager', now)
    expect(set.ok && set.state.operations!.staffTargets!.at(-1)!.actor).toBe('Mo · manager')
    expect(changeWords['staff-target']).toEqual(['team', 'Changed a monthly target'])
    expect(run(s, target('staff-maya', '2026-10', 0)).ok).toBe(false)
    expect(run(s, target('staff-nobody', '2026-10', 50000)).ok).toBe(false)
    expect(run(s, target('staff-maya', '2026-13', 50000)).ok).toBe(false)
    expect(run(s, target('staff-maya', '2026-10', 50000, { treatmentsMinor: 60000 })).ok).toBe(
      false,
    )
    // Someone renting a chair keeps their own takings, so they have no target from the studio.
    const renting = apply(s, {
      type: 'rental',
      input: { staffId: 'staff-theo', space: 'chair', amountMinor: 5000, every: 'week', from: day },
    })
    expect(run(renting, target('staff-theo', '2026-10', 50000)).ok).toBe(false)
    const earlier = apply(renting, target('staff-theo', '2026-09', 50000))
    // A target set before they rent carries on, but not into the months they rent.
    expect(row(earlier, 'staff-theo', '2026-09-01', '2026-09-30').target).toMatchObject({
      targetMinor: 50000,
    })
    expect(row(earlier, 'staff-theo').target).toBeUndefined()
    expect(targetProgress(earlier, 'staff-theo', '2026-10', day)).toBeUndefined()
  })
})

describe('keeping commission to the people who see pay', () => {
  it('leaves rates, steps, targets and rent out of what reception reads', () => {
    const s = seed('UK')
    expect(s.operations!.commissionRates!.length).toBeGreaterThan(0)
    const hidden = withoutPayRates(s)
    for (const key of ['commissionRates', 'commissionSteps', 'staffTargets', 'payRates'] as const)
      expect(hidden.operations![key]).toBeUndefined()
    // Rentals stay, so everyone's figures leave a renter's takings out, but not their terms.
    expect(hidden.operations!.rentals).toEqual([
      expect.objectContaining({ id: 'rental-theo', staffId: 'staff-theo', amountMinor: 0 }),
    ])
    expect(hidden.operations!.rentals![0].percentBps).toBeUndefined()
    expect(hidden.operations!.rentPayments).toBeUndefined()
    expect(() => parseState(hidden, 'UK')).not.toThrow()
  })

  it('rejects a commission record for someone not on the team in the ledger', () => {
    const s = seed('UK')
    const tampered = structuredClone(s)
    tampered.operations!.staffTargets![0].staffId = 'missing'
    expect(() => parseState(tampered, 'UK')).toThrow('target')
    const twice = structuredClone(s)
    twice.operations!.commissionRates![1].id = twice.operations!.commissionRates![0].id
    expect(() => parseState(twice, 'UK')).toThrow('Duplicate')
  })

  it('writes how commission was worked out and the target into the payroll spreadsheet', () => {
    const s = seed('UK')
    const rows = payPeriod(s, '2026-09-01', '2026-09-30')
    const [header, ...lines] = payCsv(rows, '2026-09-01', '2026-09-30', 'GBP').trim().split('\n')
    expect(header).toContain(
      'Owed (GBP),How commission was worked out,Monthly target (GBP),Towards target (GBP)',
    )
    const sophia = lines.find((line) => line.startsWith('Sophia'))!
    expect(sophia).toContain('Treatments at 35% up to £3,000')
    expect(sophia).toContain('Lymphatic Massage at 45%, its own rate')
    expect(sophia).toMatch(/,12000\.00,\d+\.\d{2}$/)
  })
})

describe('the sample studio', () => {
  it('shows a rate for a treatment and a product, steps that are passed, and targets', () => {
    for (const region of ['UK', 'US'] as const) {
      const s = seed(region, { regulars: true })
      const september = payPeriod(s, '2026-09-01', '2026-09-30')
      const sophia = september.find((r) => r.staff.id === 'staff-sophia')!
      expect(sophia.parts.map((p) => p.label)).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/^Treatments at 35% up to /),
          expect.stringMatching(/^Treatments at 40% above /),
          expect.stringMatching(/, its own rate$/),
        ]),
      )
      for (const r of september) {
        expect(r.parts.reduce((t, p) => t + p.commissionMinor, 0)).toBe(r.commissionMinor)
        expect(r.lines.reduce((t, l) => t + l.commissionMinor, 0)).toBe(r.commissionMinor)
      }
      const maya = payPeriod(s, '2026-10-01', '2026-10-06').find(
        (r) => r.staff.id === 'staff-maya',
      )!
      expect(maya.target!.takenMinor).toBeGreaterThan(0)
      expect(maya.target!.takenMinor).toBeLessThan(maya.target!.targetMinor)
    }
  })

  it('reads a percentage the way the screens take it', () => {
    expect(parsePercent('40')).toBe(4000)
    expect(parsePercent('12.5%')).toBe(1250)
    expect(parsePercent('100')).toBe(10000)
    expect(parsePercent('100.01')).toBeNaN()
    expect(parsePercent('ten')).toBeNaN()
  })
})
