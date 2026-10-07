import { describe, expect, it } from 'vitest'
import { dispatch, execute } from './commands'
import type { Command } from './commands'
import type { BusinessState } from './model'
import { parseState } from './model'
import { can, permissionFor } from './operations'
import { createWorkspace } from './workspace'
import { seed } from './seed'
import { addMonths, holdings, memberDiscountPercent, planStanding, plansForVisit } from './plans'
import { cashForDay } from './tillCount'
import type { OfferInput } from './plansSchema'
import { clientExport } from './privacy'
import { serviceRevenue } from './selectors'

// V1.5: packages and memberships.
const now = '2026-10-06T08:00:00.000Z'
let sequence = 0
function local(): BusinessState {
  const s = createWorkspace({ name: 'Plans test studio', region: 'UK' })
  const sample = seed('UK')
  for (const key of ['clients', 'services', 'staff', 'resources'] as const)
    Object.assign(s, {
      [key]: sample[key].map((row) => ({ ...row, organisationId: s.organisation.id })),
    })
  return s
}
function run(s: BusinessState, command: Command, at = now) {
  return execute(s, command, at, () => `plan-${++sequence}`)
}
function apply(s: BusinessState, command: Command, at = now) {
  const result = run(s, command, at)
  if (!result.ok) throw new Error(result.error)
  return result.state
}
const pkg = {
  kind: 'package' as const,
  name: 'Five facials',
  serviceIds: ['service-facial'],
  visits: 5,
  priceMinor: 40000,
  discountPercent: 0,
  validMonths: 6,
  archived: false,
}
const club = {
  kind: 'membership' as const,
  name: 'Facial club',
  serviceIds: ['service-facial'],
  visits: 1,
  priceMinor: 7500,
  discountPercent: 10,
  validMonths: 1,
  archived: false,
}
/** A facial today at `start`, booked with no deposit, already welcomed. */
function visitToday(s: BusinessState, start: number, at = now) {
  const date = at.slice(0, 10)
  s = apply(
    s,
    {
      type: 'import-appointments',
      source: 'Test',
      reviewed: true,
      appointments: [
        {
          clientId: 'client-1',
          serviceId: 'service-facial',
          staffId: 'staff-maya',
          date,
          startMinutes: start,
          priceMinor: 9500,
          depositPaidMinor: 0,
        },
      ],
    },
    at,
  )
  const a = s.appointments.filter((x) => x.source === 'import').at(-1)!
  return { s: apply(s, { type: 'arrive', appointmentId: a.id }, at), a }
}
function withPlan(input: OfferInput = pkg) {
  let s = apply(local(), { type: 'offer', input })
  const offerId = s.offers![0].id
  s = apply(s, { type: 'plan-sell', offerId, clientId: 'client-1', method: 'cash' })
  return { s, holding: holdings(s)[0] }
}

describe('months', () => {
  it('keeps the day of the month, or the last day when the month is shorter', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonths('2026-01-31', 2)).toBe('2026-03-31')
    expect(addMonths('2026-10-06', 6)).toBe('2027-04-06')
  })
})

describe('offers', () => {
  it('refuses a package with no visits, or a membership with nothing in it', () => {
    expect(run(local(), { type: 'offer', input: { ...pkg, visits: 0 } }).ok).toBe(false)
    expect(run(local(), { type: 'offer', input: { ...pkg, discountPercent: 10 } }).ok).toBe(false)
    expect(
      run(local(), { type: 'offer', input: { ...club, visits: 0, discountPercent: 0 } }).ok,
    ).toBe(false)
    expect(
      run(local(), { type: 'offer', input: { ...pkg, serviceIds: ['service-nowhere'] } }).ok,
    ).toBe(false)
  })

  it('changes future sales only: a client keeps the terms they bought', () => {
    const { s, holding } = withPlan()
    const next = apply(s, {
      type: 'offer',
      id: holding.offerId,
      input: { ...pkg, priceMinor: 45000, visits: 4 },
    })
    expect(holdings(next)[0]).toMatchObject({ priceMinor: 40000, visits: 5 })
    expect(next.offers![0]).toMatchObject({ priceMinor: 45000, visits: 4 })
  })

  it('is set up by owners and managers, sold and renewed by the desk, ended by managers', () => {
    expect(permissionFor({ type: 'offer' })).toBe('catalogue')
    expect(can('reception', 'catalogue')).toBe(false)
    expect(can('reception', 'plan-sell')).toBe(true)
    expect(can('reception', 'plan-renew')).toBe(true)
    expect(can('reception', 'plan-cancel')).toBe(false)
    expect(can('manager', 'plan-cancel')).toBe(true)
    expect(can('practitioner', 'plan-sell')).toBe(false)
  })
})

describe('packages', () => {
  it('records the sale, its payment in the till and an end date', () => {
    const { s, holding } = withPlan()
    expect(holding).toMatchObject({ startedOn: '2026-10-06', endsOn: '2027-04-05' })
    expect(holding.payments[0]).toMatchObject({ amountMinor: 40000, method: 'cash' })
    expect(cashForDay(s, '2026-10-06').cashIn).toBe(40000)
    expect(s.events.at(-1)).toMatchObject({ type: 'plan', title: 'Package bought' })
  })

  it('pays for a visit with its share; the guest pays only the tip', () => {
    const plan = withPlan()
    const { s, a } = visitToday(plan.s, 600)
    expect(plansForVisit(s, a, '2026-10-06')).toHaveLength(1)
    const after = apply(s, {
      type: 'checkout',
      appointmentId: a.id,
      tipMinor: 1000,
      method: 'cash',
      holdingId: plan.holding.id,
    })
    const sale = after.sales.find((x) => x.appointmentId === a.id)!
    expect(sale).toMatchObject({
      serviceMinor: 9500,
      discountMinor: 1500,
      coveredMinor: 8000,
      tipMinor: 1000,
      totalMinor: 9000,
      balanceMinor: 1000,
      holdingId: plan.holding.id,
    })
    expect(after.payments.find((p) => p.saleId === sale.id)!.amountMinor).toBe(1000)
    expect(cashForDay(after, '2026-10-06').cashIn).toBe(41000)
    const standing = planStanding(holdings(after)[0], '2026-10-06')
    expect(standing).toMatchObject({ visitsLeft: 4, usedMinor: 8000, unusedMinor: 32000 })
    // Takings count the visit's share of the plan, not the full list price.
    expect(serviceRevenue(sale)).toBe(8000)
    expect(after.events.at(-1)!.detail).toContain('4 visits left')
  })

  it('uses exactly its price over all its visits', () => {
    let s = apply(local(), { type: 'offer', input: { ...pkg, visits: 3, priceMinor: 25000 } })
    s = apply(s, {
      type: 'plan-sell',
      offerId: s.offers![0].id,
      clientId: 'client-1',
      method: 'cash',
    })
    const holdingId = holdings(s)[0].id
    for (const start of [540, 660, 780]) {
      const v = visitToday(s, start)
      s = apply(v.s, {
        type: 'checkout',
        appointmentId: v.a.id,
        tipMinor: 0,
        method: 'cash',
        holdingId,
      })
    }
    expect(holdings(s)[0].uses.map((u) => u.valueMinor)).toEqual([8333, 8333, 8334])
    expect(planStanding(holdings(s)[0], '2026-10-06')).toMatchObject({
      state: 'used',
      unusedMinor: 0,
    })
    const v = visitToday(s, 900)
    expect(
      run(v.s, { type: 'checkout', appointmentId: v.a.id, tipMinor: 0, method: 'cash', holdingId })
        .ok,
    ).toBe(false)
  })

  it('refuses another client, another service, an extra discount, a deposit or an expired package', () => {
    const plan = withPlan()
    const { s, a } = visitToday(plan.s, 600)
    const base = {
      type: 'checkout' as const,
      appointmentId: a.id,
      tipMinor: 0,
      method: 'cash' as const,
    }
    expect(run(s, { ...base, holdingId: plan.holding.id, discountMinor: 500 }).ok).toBe(false)
    const other = structuredClone(s)
    other.holdings![0].clientId = 'client-2'
    expect(run(other, { ...base, holdingId: plan.holding.id }).ok).toBe(false)
    const brow = structuredClone(s)
    brow.holdings![0].serviceIds = ['service-cut']
    expect(run(brow, { ...base, holdingId: plan.holding.id }).ok).toBe(false)
    const late = '2027-04-06T08:00:00.000Z'
    const expired = visitToday(plan.s, 600, late)
    expect(
      run(expired.s, { ...base, appointmentId: expired.a.id, holdingId: plan.holding.id }, late).ok,
    ).toBe(false)
    expect(planStanding(holdings(expired.s)[0], '2027-04-06').state).toBe('expired')
  })

  it('ends with a refund capped at the unused part, recorded and never processed', () => {
    const plan = withPlan()
    const v = visitToday(plan.s, 600)
    const s = apply(v.s, {
      type: 'checkout',
      appointmentId: v.a.id,
      tipMinor: 0,
      method: 'cash',
      holdingId: plan.holding.id,
    })
    const end = { type: 'plan-cancel' as const, holdingId: plan.holding.id, reason: 'Moving away' }
    expect(run(s, { ...end, refundMinor: 32001, method: 'cash', reference: 'R1' }).ok).toBe(false)
    expect(run(s, { ...end, refundMinor: 1000 }).ok).toBe(false)
    const after = apply(s, { ...end, refundMinor: 32000, method: 'cash', reference: 'R1' })
    expect(holdings(after)[0]).toMatchObject({ status: 'cancelled' })
    expect(cashForDay(after, '2026-10-06').cashRefunded).toBe(32000)
    expect(after.events.at(-1)!.detail).toContain('SALEANE did not process a refund')
    expect(run(after, end).ok).toBe(false)
  })

  it('refunds no more than the tip on a receipt the plan paid for', () => {
    const plan = withPlan()
    const v = visitToday(plan.s, 600)
    const s = apply(v.s, {
      type: 'checkout',
      appointmentId: v.a.id,
      tipMinor: 1000,
      method: 'cash',
      holdingId: plan.holding.id,
    })
    const saleId = s.sales.at(-1)!.id
    const refund = {
      type: 'refund' as const,
      saleId,
      reason: 'Tip returned',
      method: 'cash' as const,
    }
    expect(run(s, { ...refund, amountMinor: 1001, reference: 'T1' }).ok).toBe(false)
    expect(run(s, { ...refund, amountMinor: 1000, reference: 'T1' }).ok).toBe(true)
  })
})

describe('memberships', () => {
  it('covers its visits each month, offers its discount, and needs each month paid', () => {
    const plan = withPlan(club)
    expect(plan.holding.paidUntil).toBe('2026-11-06')
    const first = visitToday(plan.s, 600)
    const a = first.a
    let s = first.s
    s = apply(s, {
      type: 'checkout',
      appointmentId: a.id,
      tipMinor: 0,
      method: 'cash',
      holdingId: plan.holding.id,
    })
    expect(s.sales.at(-1)).toMatchObject({
      coveredMinor: 7500,
      discountMinor: 2000,
      balanceMinor: 0,
    })
    // The month's visit is used, so the next facial takes the member discount instead.
    const second = visitToday(s, 720)
    expect(plansForVisit(second.s, second.a, '2026-10-06')).toHaveLength(0)
    expect(memberDiscountPercent(second.s, second.a, '2026-10-06')).toBe(10)
    // Next month, unpaid: no cover, no discount, until it is paid.
    const later = '2026-11-10T08:00:00.000Z'
    const unpaid = visitToday(s, 600, later)
    expect(planStanding(holdings(unpaid.s)[0], '2026-11-10').state).toBe('unpaid')
    expect(memberDiscountPercent(unpaid.s, unpaid.a, '2026-11-10')).toBe(0)
    const paid = apply(
      unpaid.s,
      { type: 'plan-renew', holdingId: plan.holding.id, method: 'cash' },
      later,
    )
    expect(holdings(paid)[0]).toMatchObject({ paidUntil: '2026-12-06' })
    expect(holdings(paid)[0].payments.at(-1)).toMatchObject({ periodStart: '2026-11-06' })
    expect(plansForVisit(paid, unpaid.a, '2026-11-10')).toHaveLength(1)
  })

  it('restarts a lapsed membership from the current month and never charges a month twice', () => {
    const plan = withPlan(club)
    const later = '2027-01-20T08:00:00.000Z'
    const s = apply(
      plan.s,
      { type: 'plan-renew', holdingId: plan.holding.id, method: 'cash' },
      later,
    )
    expect(holdings(s)[0].payments.at(-1)).toMatchObject({ periodStart: '2027-01-06' })
    expect(holdings(s)[0].paidUntil).toBe('2027-02-06')
    const again = apply(
      s,
      { type: 'plan-renew', holdingId: plan.holding.id, method: 'cash' },
      later,
    )
    expect(holdings(again)[0].payments).toHaveLength(3)
    expect(
      run(again, { type: 'plan-renew', holdingId: plan.holding.id, method: 'cash' }, later).ok,
    ).toBe(false)
  })

  it('refuses a second active copy of the same membership', () => {
    const plan = withPlan(club)
    expect(
      run(plan.s, {
        type: 'plan-sell',
        offerId: plan.holding.offerId,
        clientId: 'client-1',
        method: 'cash',
      }).ok,
    ).toBe(false)
  })
})

describe('review fixes', () => {
  it('lets a membership return only the current paid month, never past ones', () => {
    const plan = withPlan({ ...club, visits: 0 })
    const later = '2026-12-10T08:00:00.000Z'
    let s = apply(plan.s, { type: 'plan-renew', holdingId: plan.holding.id, method: 'cash' }, later)
    expect(planStanding(holdings(s)[0], '2026-12-10').unusedMinor).toBe(7500)
    const end = { type: 'plan-cancel' as const, holdingId: plan.holding.id, reason: 'Moving' }
    expect(run(s, { ...end, refundMinor: 7501, method: 'cash', reference: 'M1' }, later).ok).toBe(
      false,
    )
    s = apply(s, { ...end, refundMinor: 7500, method: 'cash', reference: 'M1' }, later)
    expect(holdings(s)[0].refunds[0].amountMinor).toBe(7500)
    // A lapsed membership has nothing left to return.
    const lapsed = withPlan(club)
    expect(planStanding(lapsed.holding, '2027-03-01').unusedMinor).toBe(0)
  })

  it('refuses a payment or refund reference that is already recorded', () => {
    const s = apply(local(), { type: 'offer', input: pkg })
    const offerId = s.offers![0].id
    const sell = {
      type: 'plan-sell' as const,
      offerId,
      clientId: 'client-1',
      method: 'external_card' as const,
      reference: 'T-100',
    }
    const once = apply(s, sell)
    expect(run(once, { ...sell, clientId: 'client-2' }).ok).toBe(false)
    const twice = apply(once, { ...sell, clientId: 'client-2', reference: 'T-101' })
    const end = (holdingId: string) => ({
      type: 'plan-cancel' as const,
      holdingId,
      reason: 'Changed mind',
      refundMinor: 100,
      method: 'cash' as const,
      reference: 'R-1',
    })
    const ended = apply(twice, end(holdings(twice)[0].id))
    expect(run(ended, end(holdings(ended)[1].id)).ok).toBe(false)
  })

  it('keeps names unique when a plan is renamed or put back on sale', () => {
    let s = apply(local(), { type: 'offer', input: pkg })
    s = apply(s, { type: 'offer', input: { ...pkg, name: 'Three facials', visits: 3 } })
    const second = s.offers![1].id
    expect(run(s, { type: 'offer', id: second, input: { ...pkg, visits: 3 } }).ok).toBe(false)
    s = apply(s, { type: 'offer', id: second, input: { ...pkg, visits: 3, archived: true } })
    expect(
      run(s, { type: 'offer', id: second, input: { ...pkg, visits: 3, archived: false } }).ok,
    ).toBe(false)
    expect(
      run(s, { type: 'offer', id: s.offers![0].id, input: { ...pkg, priceMinor: 41000 } }).ok,
    ).toBe(true)
  })
})

describe('records', () => {
  it('names who sold and ended a plan, and refuses money from nowhere', () => {
    let s = apply(local(), { type: 'offer', input: pkg })
    const sold = dispatch(
      s,
      { type: 'plan-sell', offerId: s.offers![0].id, clientId: 'client-1', method: 'cash' },
      'Ada Desk',
      now,
    )
    if (!sold.ok) throw new Error(sold.error)
    s = sold.state
    expect(holdings(s)[0].actor).toBe('Ada Desk')
    expect(
      run(s, {
        type: 'plan-sell',
        offerId: s.offers![0].id,
        clientId: 'client-1',
        method: 'demo_cash',
      }).ok,
    ).toBe(false)
    const broken = structuredClone(s)
    broken.holdings![0].uses.push({
      id: 'ghost',
      appointmentId: 'nowhere',
      saleId: 'nowhere',
      valueMinor: 100,
      usedAt: now,
    })
    expect(() => parseState(broken, 'UK')).toThrow()
    const forged = structuredClone(s)
    forged.holdings![0].payments[0].method = 'card'
    expect(() => parseState(forged, 'UK')).toThrow()
  })

  it('puts plans in the client’s own export', () => {
    const { s } = withPlan()
    const file = clientExport(s, 'client-1', {} as never)
    expect(file.plans).toEqual([
      expect.objectContaining({ name: 'Five facials', kind: 'package', status: 'active' }),
    ])
  })
})
