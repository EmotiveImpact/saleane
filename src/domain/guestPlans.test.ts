import { describe, expect, it } from 'vitest'
import { execute } from './commands'
import type { Command } from './commands'
import type { BusinessState } from './model'
import { createWorkspace } from './workspace'
import { seed } from './seed'
import { guestView, guestViewSchema } from './guest'
import { guestPlans, nextMonthStart } from './guestPlans'
import { holdings } from './plans'
import type { OfferInput } from './plansSchema'

// Stage 1: a guest sees the packages and memberships they hold on their own visit page.
const now = '2026-10-06T08:00:00.000Z'
let sequence = 0
function local(): BusinessState {
  const s = createWorkspace({ name: 'Guest plans studio', region: 'UK' })
  const sample = seed('UK')
  for (const key of ['clients', 'services', 'staff', 'resources'] as const)
    Object.assign(s, {
      [key]: sample[key].map((row) => ({ ...row, organisationId: s.organisation.id })),
    })
  return s
}
function apply(s: BusinessState, command: Command, at = now) {
  const result = execute(s, command, at, () => `guest-plan-${++sequence}`)
  if (!result.ok) throw new Error(result.error)
  return result.state
}
const pkg: OfferInput = {
  kind: 'package',
  name: 'Six facials',
  serviceIds: ['service-facial'],
  visits: 6,
  priceMinor: 48000,
  discountPercent: 0,
  validMonths: 6,
  archived: false,
}
const club: OfferInput = {
  kind: 'membership',
  name: 'Facial club',
  serviceIds: ['service-facial'],
  visits: 1,
  priceMinor: 7500,
  discountPercent: 10,
  validMonths: 1,
  archived: false,
}
/** Puts the plan on sale and sells it to the client on the day `at`. */
function sell(s: BusinessState, input: OfferInput, clientId = 'client-1', at = now) {
  s = apply(s, { type: 'offer', input }, at)
  const offerId = s.offers!.find((o) => o.name === input.name)!.id
  s = apply(s, { type: 'plan-sell', offerId, clientId, method: 'cash' }, at)
  return { s, holding: holdings(s).at(-1)! }
}
/** A visit for the client on `date`, booked with no deposit unless one is given. */
function visit(
  s: BusinessState,
  date: string,
  options: { start?: number; clientId?: string; serviceId?: string; depositMinor?: number } = {},
  at = now,
) {
  s = apply(
    s,
    {
      type: 'import-appointments',
      source: 'Test',
      reviewed: true,
      appointments: [
        {
          clientId: options.clientId ?? 'client-1',
          serviceId: options.serviceId ?? 'service-facial',
          staffId: 'staff-maya',
          date,
          startMinutes: options.start ?? 600,
          priceMinor: 9500,
          depositPaidMinor: options.depositMinor ?? 0,
        },
      ],
    },
    at,
  )
  return { s, a: s.appointments.filter((x) => x.source === 'import').at(-1)! }
}
/** Welcomes and checks out a visit today, paid by the plan. */
function useVisit(s: BusinessState, holdingId: string, start: number, at = now) {
  const v = visit(s, at.slice(0, 10), { start }, at)
  s = apply(v.s, { type: 'arrive', appointmentId: v.a.id }, at)
  return apply(
    s,
    { type: 'checkout', appointmentId: v.a.id, tipMinor: 0, method: 'cash', holdingId },
    at,
  )
}
const plansFor = (s: BusinessState, appointmentId: string, at = now) =>
  guestPlans(s, appointmentId, Date.parse(at))

describe('the plans a guest sees on their visit page', () => {
  it('shows a package with visits left, its last day and that it can pay for this visit', () => {
    const sold = sell(local(), pkg)
    const { holding } = sold
    let { s } = sold
    s = useVisit(s, holding.id, 540)
    const v = visit(s, '2026-10-20')
    expect(plansFor(v.s, v.a.id)).toEqual([
      {
        kind: 'package',
        name: 'Six facials',
        state: 'active',
        visits: 6,
        visitsLeft: 5,
        endsOn: '2027-04-05',
        thisVisit: { outcome: 'covers' },
      },
    ])
  })

  it('shows a membership with visits left this month, its discount and when the next month starts', () => {
    const { s } = sell(local(), club)
    const v = visit(s, '2026-10-20')
    expect(plansFor(v.s, v.a.id)).toEqual([
      {
        kind: 'membership',
        name: 'Facial club',
        state: 'active',
        visits: 1,
        visitsLeft: 1,
        discountPercent: 10,
        nextMonthOn: '2026-11-06',
        thisVisit: { outcome: 'covers' },
      },
    ])
  })

  it('offers the member discount once this month’s visits are used, as checkout does', () => {
    const sold = sell(local(), club)
    const { holding } = sold
    let { s } = sold
    s = useVisit(s, holding.id, 540)
    const v = visit(s, '2026-10-20')
    const [plan] = plansFor(v.s, v.a.id)
    expect(plan).toMatchObject({ visitsLeft: 0, thisVisit: { outcome: 'discount' } })
  })

  it('says a visit in a later, unpaid month can come off the membership once that month is paid', () => {
    const { s } = sell(local(), club)
    const v = visit(s, '2026-11-10')
    const [plan] = plansFor(v.s, v.a.id)
    expect(plan).toMatchObject({
      state: 'active',
      nextMonthOn: '2026-11-06',
      thisVisit: { outcome: 'covers_once_paid', monthOn: '2026-11-06' },
    })
    // A membership with only a discount says the discount applies once the month is paid.
    const discountOnly = sell(local(), { ...club, name: 'Glow club', visits: 0 })
    const w = visit(discountOnly.s, '2026-11-10')
    expect(plansFor(w.s, w.a.id)[0]).toMatchObject({
      visits: 0,
      visitsLeft: 0,
      thisVisit: { outcome: 'discount_once_paid', monthOn: '2026-11-06' },
    })
  })

  it('shows an unpaid membership without what it includes, and what this visit needs', () => {
    const { s } = sell(local(), club)
    const at = '2026-11-10T10:00:00.000Z'
    const v = visit(s, '2026-11-20', {}, at)
    expect(plansFor(v.s, v.a.id, at)).toEqual([
      {
        kind: 'membership',
        name: 'Facial club',
        state: 'unpaid',
        discountPercent: 10,
        thisVisit: { outcome: 'covers_once_paid', monthOn: '2026-11-06' },
      },
    ])
    // Paying the month brings it back with this month's visits.
    const paid = apply(
      v.s,
      { type: 'plan-renew', holdingId: holdings(v.s)[0].id, method: 'cash' },
      at,
    )
    expect(plansFor(paid, v.a.id, at)[0]).toMatchObject({
      state: 'active',
      visitsLeft: 1,
      nextMonthOn: '2026-12-06',
      thisVisit: { outcome: 'covers' },
    })
  })

  it('judges the studio’s own day, not the UTC day', () => {
    // Sold on 7 September; paid until 7 October. At 23:30 UTC on 6 October it is already
    // 7 October in London, so this month is not paid yet.
    const { s } = sell(local(), club, 'client-1', '2026-09-07T10:00:00.000Z')
    const v = visit(s, '2026-10-20')
    expect(plansFor(v.s, v.a.id, '2026-10-06T22:30:00.000Z')[0].state).toBe('active')
    expect(plansFor(v.s, v.a.id, '2026-10-06T23:30:00.000Z')[0].state).toBe('unpaid')
  })

  it('leaves out cancelled, used up and expired plans', () => {
    const sold = sell(local(), pkg)
    const { holding } = sold
    let { s } = sold
    s = apply(s, { type: 'plan-cancel', holdingId: holding.id, reason: 'Moving away' })
    let v = visit(s, '2026-10-20')
    expect(plansFor(v.s, v.a.id)).toEqual([])
    expect(guestView(v.s, v.a.id, Date.parse(now)).plans).toBeUndefined()

    const used = sell(local(), { ...pkg, name: 'One facial', visits: 1 })
    s = useVisit(used.s, used.holding.id, 540)
    v = visit(s, '2026-10-20')
    expect(plansFor(v.s, v.a.id)).toEqual([])

    const short = sell(local(), { ...pkg, validMonths: 1 })
    expect(short.holding.endsOn).toBe('2026-11-05')
    v = visit(short.s, '2026-11-10')
    expect(plansFor(v.s, v.a.id, '2026-11-06T10:00:00.000Z')).toEqual([])
  })

  it('says when a package ends before the visit, so it cannot come off it', () => {
    const short = sell(local(), { ...pkg, validMonths: 1 })
    const v = visit(short.s, '2026-11-10')
    expect(plansFor(v.s, v.a.id)[0]).toMatchObject({
      endsOn: '2026-11-05',
      thisVisit: { outcome: 'ends_before' },
    })
  })

  it('with two plans, says only the one checkout offers first can pay for the visit', () => {
    let s = sell(local(), pkg).s
    s = sell(s, club).s
    const v = visit(s, '2026-10-20')
    const [first, second] = plansFor(v.s, v.a.id)
    expect(first).toMatchObject({ kind: 'package', thisVisit: { outcome: 'covers' } })
    expect(second).toMatchObject({ kind: 'membership', visitsLeft: 1 })
    expect(second.thisVisit).toBeUndefined()
  })

  it('never offers a plan for a visit with a deposit, as checkout does, but the discount still applies', () => {
    let s = sell(local(), pkg).s
    s = sell(s, club).s
    const v = visit(s, '2026-10-20', { depositMinor: 2000 })
    const [first, second] = plansFor(v.s, v.a.id)
    expect(first.thisVisit).toEqual({ outcome: 'deposit' })
    expect(second.thisVisit).toEqual({ outcome: 'discount' })
  })

  it('says nothing about a treatment the plan does not cover, or a visit that is over', () => {
    const sold = sell(local(), pkg)
    const { holding } = sold
    let { s } = sold
    const massage = visit(s, '2026-10-20', { serviceId: 'service-restore' })
    expect(plansFor(massage.s, massage.a.id)[0]).toMatchObject({ visitsLeft: 6 })
    expect(plansFor(massage.s, massage.a.id)[0].thisVisit).toBeUndefined()

    s = apply(massage.s, {
      type: 'cancel',
      appointmentId: massage.a.id,
      reason: 'Guest asked',
    })
    const cancelled = visit(s, '2026-10-21')
    s = apply(cancelled.s, { type: 'cancel', appointmentId: cancelled.a.id, reason: 'Unwell' })
    expect(plansFor(s, cancelled.a.id)[0].thisVisit).toBeUndefined()

    // Paid for today by the package: the plan still shows, with nothing more to say.
    s = useVisit(s, holding.id, 540)
    const done = s.appointments.filter((a) => a.source === 'import').at(-1)!
    expect(done.status).toBe('completed')
    expect(plansFor(s, done.id)[0]).toMatchObject({ visitsLeft: 5 })
    expect(plansFor(s, done.id)[0].thisVisit).toBeUndefined()
  })

  it('shows a guest only their own plans', () => {
    const { s } = sell(local(), pkg, 'client-1')
    const theirs = visit(s, '2026-10-20', { clientId: 'client-2' })
    expect(plansFor(theirs.s, theirs.a.id)).toEqual([])
    const view = guestView(theirs.s, theirs.a.id, Date.parse(now))
    expect(view.plans).toBeUndefined()
    expect(JSON.stringify(view)).not.toContain('Six facials')
  })

  it('says a membership is paid from the saved card each month, until card payments end', () => {
    const { s, holding } = sell(local(), club)
    const agreed = {
      id: 'agreement-1',
      cardId: 'card-1',
      brand: 'Visa',
      last4: '4242',
      wording: 'Fictional agreement words, as read to the client at the desk.',
      agreedAt: now,
      recordedBy: 'owner',
      startsOn: '2026-11-06',
    }
    const withCard = (ended?: string) => {
      const next = structuredClone(s)
      next.holdings!.find((h) => h.id === holding.id)!.cardAgreements = [
        ended ? { ...agreed, endedAt: ended, endReason: 'turned_off' as const } : agreed,
      ]
      return next
    }
    const v = visit(withCard(), '2026-10-20')
    const [plan] = plansFor(v.s, v.a.id)
    expect(plan).toMatchObject({ state: 'active', paidByCard: { brand: 'Visa', last4: '4242' } })
    // Only the brand and last four digits, never the card's or the agreement's record.
    const text = JSON.stringify(plan)
    for (const secret of ['card-1', 'agreement-1', 'Fictional agreement'])
      expect(text).not.toContain(secret)
    // A month the card has not paid yet still says which card it is due from.
    const at = '2026-11-10T10:00:00.000Z'
    const later = visit(withCard(), '2026-11-20', {}, at)
    expect(plansFor(later.s, later.a.id, at)[0]).toMatchObject({
      state: 'unpaid',
      paidByCard: { last4: '4242' },
    })
    // Once card payments are turned off, nothing is said about a card.
    const off = visit(withCard('2026-10-07T09:00:00.000Z'), '2026-10-20')
    expect(plansFor(off.s, off.a.id)[0].paidByCard).toBeUndefined()
    expect(guestViewSchema.safeParse(guestView(v.s, v.a.id, Date.parse(now))).success).toBe(true)
  })

  it('carries nothing about money, payments or record IDs', () => {
    const { s, holding } = sell(local(), club)
    const v = visit(s, '2026-10-20')
    const view = guestView(v.s, v.a.id, Date.parse(now))
    expect(view.plans).toHaveLength(1)
    const text = JSON.stringify(view.plans)
    for (const secret of [holding.id, holding.offerId, 'client-1', '7500', 'cash', 'Minor', 'pay'])
      expect(text).not.toContain(secret)
    expect(guestViewSchema.safeParse(view).success).toBe(true)
    // The strict schema refuses anything more.
    const extra = { ...view, plans: [{ ...view.plans![0], priceMinor: 7500 }] }
    expect(guestViewSchema.safeParse(extra).success).toBe(false)
  })

  it('counts a membership’s months from its first day, at month ends too', () => {
    expect(nextMonthStart({ startedOn: '2026-01-31' }, '2026-02-27')).toBe('2026-02-28')
    expect(nextMonthStart({ startedOn: '2026-01-31' }, '2026-02-28')).toBe('2026-03-31')
    expect(nextMonthStart({ startedOn: '2026-10-06' }, '2026-10-06')).toBe('2026-11-06')
    expect(nextMonthStart({ startedOn: '2026-10-06' }, '2026-11-05')).toBe('2026-11-06')
  })

  it('keeps every visit in the sample studios valid, with plans sold', () => {
    for (const region of ['UK', 'US'] as const) {
      let s = seed(region)
      s = apply(s, { type: 'offer', input: { ...pkg, name: 'Course of five', visits: 5 } })
      s = apply(s, { type: 'offer', input: { ...club, serviceIds: ['service-facial'] } })
      const clientIds = [...new Set(s.appointments.map((a) => a.clientId))].slice(0, 2)
      for (const [index, offer] of s.offers!.entries())
        s = apply(s, {
          type: 'plan-sell',
          offerId: offer.id,
          clientId: clientIds[index],
          method: 'demo_cash',
        })
      let shown = 0
      for (const a of s.appointments) {
        const view = guestViewSchema.parse(guestView(s, a.id, Date.parse(now)))
        if (view.plans) shown += 1
      }
      expect(shown).toBeGreaterThan(0)
    }
  })
})
