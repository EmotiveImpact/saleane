import { describe, expect, it } from 'vitest'
import { dispatch, execute } from './commands'
import type { Command } from './commands'
import type { BusinessState } from './model'
import { parseState } from './model'
import { can, permissionFor } from './operations'
import { createWorkspace } from './workspace'
import { seed } from './seed'
import { payCsv, payPeriod, rateFor, rateHistory, withoutPayRates } from './pay'

// V2: commission and tips per person.
const now = '2026-10-06T08:00:00.000Z'
const day = now.slice(0, 10)
let sequence = 0
function local(): BusinessState {
  const s = createWorkspace({ name: 'Pay test studio', region: 'UK' })
  const sample = seed('UK')
  for (const key of ['clients', 'services', 'staff', 'resources'] as const)
    Object.assign(s, {
      [key]: sample[key].map((row) => ({ ...row, organisationId: s.organisation.id })),
    })
  return s
}
function run(s: BusinessState, command: Command, at = now) {
  return execute(s, command, at, () => `pay-${++sequence}`)
}
function apply(s: BusinessState, command: Command, at = now) {
  const result = run(s, command, at)
  if (!result.ok) throw new Error(result.error)
  return result.state
}
const rate = (staffId: string, serviceBps: number, productBps: number, from = '2026-01-01') =>
  ({ type: 'pay-rate', staffId, serviceBps, productBps, from }) as Command

/** A studio with a £32 balm in stock and Maya on 40% services and 10% products. */
function studio() {
  let s = apply(local(), {
    type: 'product',
    input: { name: 'Cleansing Balm', sku: 'BALM', priceMinor: 3200, reorderAt: 1, archived: false },
  })
  const balmId = s.operations!.products[0].id
  s = apply(s, { type: 'stock', productId: balmId, quantity: 5, reason: 'received', note: 'In' })
  s = apply(s, rate('staff-maya', 4000, 1000))
  return { s, balmId }
}
/** A £95 facial with Maya today, welcomed and paid with a tip and products. */
function paidVisit(s: BusinessState, balmId: string, tipMinor = 1000) {
  s = apply(s, {
    type: 'import-appointments',
    source: 'Test',
    reviewed: true,
    appointments: [
      {
        clientId: 'client-1',
        serviceId: 'service-facial',
        staffId: 'staff-maya',
        date: day,
        startMinutes: 600,
        priceMinor: 9500,
        depositPaidMinor: 0,
      },
    ],
  })
  const a = s.appointments.filter((x) => x.source === 'import').at(-1)!
  s = apply(s, { type: 'arrive', appointmentId: a.id })
  s = apply(s, {
    type: 'checkout',
    appointmentId: a.id,
    tipMinor,
    method: 'cash',
    products: [{ productId: balmId, quantity: 1 }],
  } as Command)
  return { s, sale: s.sales.find((x) => x.appointmentId === a.id)! }
}
const maya = (s: BusinessState, from = '2026-10-01', to = day) =>
  payPeriod(s, from, to).find((row) => row.staff.id === 'staff-maya')!

describe('commission and tips', () => {
  it('pays commission on services and products and the tip in full', () => {
    const { s: start, balmId } = studio()
    const { s } = paidVisit(start, balmId)
    expect(maya(s)).toMatchObject({
      visits: 1,
      servicesMinor: 9500,
      productsMinor: 3200,
      commissionMinor: 3800 + 320,
      tipsMinor: 1000,
      owedMinor: 3800 + 320 + 1000,
    })
    // Nobody else earned anything, and someone with no rate earns no commission.
    const sophia = payPeriod(s, '2026-10-01', day).find((r) => r.staff.id === 'staff-sophia')!
    expect(sophia.owedMinor).toBe(0)
  })

  it('uses the rate in force on the day of the visit and keeps the history', () => {
    const { s: start, balmId } = studio()
    let { s } = paidVisit(start, balmId, 0)
    s = apply(s, rate('staff-maya', 5000, 1000, '2026-10-07'))
    expect(maya(s).commissionMinor).toBe(3800 + 320)
    expect(rateFor(s, 'staff-maya', '2026-10-07')?.serviceBps).toBe(5000)
    expect(rateHistory(s, 'staff-maya').map((r) => r.serviceBps)).toEqual([5000, 4000])
    // Reaching back to the visit's day changes what it earns.
    s = apply(s, rate('staff-maya', 5000, 1000, day))
    expect(maya(s).commissionMinor).toBe(4750 + 320)
  })

  it('credits the seller with a walk-in sale', () => {
    const { s: start, balmId } = studio()
    const s = apply(start, {
      type: 'counter-sale',
      staffId: 'staff-maya',
      products: [{ productId: balmId, quantity: 2 }],
      method: 'cash',
    } as Command)
    expect(s.counterSales!.at(-1)!.staffId).toBe('staff-maya')
    expect(maya(s)).toMatchObject({ productsMinor: 6400, commissionMinor: 640, visits: 0 })
    // A seller who is not on the team is refused.
    expect(
      run(start, {
        type: 'counter-sale',
        staffId: 'someone-else',
        products: [{ productId: balmId, quantity: 1 }],
        method: 'cash',
      } as Command).ok,
    ).toBe(false)
  })

  it('takes money given back off in proportion, leaving the tip', () => {
    const { s: start, balmId } = studio()
    const { s: paid, sale } = paidVisit(start, balmId)
    // Receipt £137 (95 + 32 + 10 tip); give back the £32 balm's worth.
    const s = apply(paid, {
      type: 'refund',
      saleId: sale.id,
      amountMinor: 3200,
      reason: 'Did not suit',
      reference: 'R-1',
      method: 'cash',
    } as Command)
    const back = maya(s)
    const services = Math.round((3200 * 9500) / 13700)
    const products = Math.round((3200 * 3200) / 13700)
    expect(back.givenBackMinor).toBe(services + products)
    expect(back.commissionMinor).toBe(
      3800 + 320 - Math.round(services * 0.4) - Math.round(products * 0.1),
    )
    expect(back.tipsMinor).toBe(1000)
    // Given back next month, it comes off next month instead.
    const later = apply(
      paid,
      {
        type: 'refund',
        saleId: sale.id,
        amountMinor: 3200,
        reason: 'Did not suit',
        reference: 'R-2',
        method: 'cash',
      } as Command,
      '2026-11-03T10:00:00.000Z',
    )
    expect(maya(later).commissionMinor).toBe(3800 + 320)
    expect(maya(later, '2026-11-01', '2026-11-30').commissionMinor).toBeLessThan(0)
  })

  it('lets only the owner change rates and records who did', () => {
    expect(can('owner', permissionFor({ type: 'pay-rate' }))).toBe(true)
    for (const role of ['manager', 'reception', 'practitioner'] as const)
      expect(can(role, permissionFor({ type: 'pay-rate' }))).toBe(false)
    const result = dispatch(local(), rate('staff-maya', 4000, 1000), 'Ava · owner', now)
    expect(result.ok && result.state.operations!.payRates!.at(-1)!.actor).toBe('Ava · owner')
    expect(run(local(), rate('nobody', 4000, 1000)).ok).toBe(false)
    expect(run(local(), rate('staff-maya', 10001, 0)).ok).toBe(false)
  })

  it('leaves the rates out of what reception reads', () => {
    const s = apply(local(), rate('staff-maya', 4000, 1000))
    const hidden = withoutPayRates(s)
    expect(hidden.operations!.payRates).toBeUndefined()
    expect(() => parseState(hidden, 'UK')).not.toThrow()
    expect(s.operations!.payRates).toHaveLength(1)
  })

  it('rejects a rate for someone not on the team in the ledger', () => {
    const s = apply(local(), rate('staff-maya', 4000, 1000))
    const tampered = structuredClone(s)
    tampered.operations!.payRates![0].staffId = 'missing'
    expect(() => parseState(tampered, 'UK')).toThrow('pay rate')
  })

  it('gives both demo studios a team with rates and last month to show', () => {
    for (const region of ['UK', 'US'] as const) {
      const s = seed(region)
      const rows = payPeriod(s, '2026-09-01', '2026-09-30')
      expect(rows.every((row) => rateFor(s, row.staff.id, '2026-09-30'))).toBe(true)
      expect(rows.reduce((sum, row) => sum + row.commissionMinor, 0)).toBeGreaterThan(0)
    }
  })

  it('writes a payroll spreadsheet that cannot run formulas', () => {
    const { s: start, balmId } = studio()
    const { s } = paidVisit(start, balmId)
    const rows = payPeriod(s, '2026-10-01', day)
    rows[0].staff = { ...rows[0].staff, name: '=HYPERLINK("x")' }
    const csv = payCsv(rows, '2026-10-01', day, 'GBP')
    const lines = csv.trim().split('\n')
    expect(lines[0]).toContain('Owed (GBP)')
    expect(lines[1].startsWith('"\'=HYPERLINK(""x"")"')).toBe(true)
    expect(lines[1]).toContain(',2026-10-01,2026-10-06,1,95.00,32.00,0.00,41.20,10.00,51.20')
  })
})
