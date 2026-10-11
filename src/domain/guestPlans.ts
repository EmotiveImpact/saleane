import { z } from 'zod'
import type { Appointment, BusinessState } from './model'
import type { Holding } from './plansSchema'
import {
  addMonths,
  clientHoldings,
  memberDiscountPercent,
  openCardAgreement,
  planStanding,
  plansForVisit,
} from './plans'
import { businessDate } from './operations'

/**
 * Stage 1: the packages and memberships a guest holds, as their own visit page shows them.
 *
 * Only the link's visit and its client are read. A plan shows while it is active, or while a
 * membership waits for this month's payment; cancelled, used up and expired plans are left out.
 * The guest sees the plan's name, what is left and until when, and what it can mean for this
 * visit, worked out with the rules checkout uses. Never what was paid, its price, its payments,
 * its uses, other visits or any record ID.
 */
export const guestPlanOutcomes = [
  /** A plan can pay for this visit: the one checkout offers first. */
  'covers',
  /** No plan pays for it, and this membership's discount applies to the treatment. */
  'discount',
  /** A plan could pay, but the visit has a deposit, and checkout takes no plan then. */
  'deposit',
  /** A package that covers the treatment ends before the day of the visit. */
  'ends_before',
  /** A membership that would pay for this visit once the visit's month is paid. */
  'covers_once_paid',
  /** A membership whose discount would apply once the visit's month is paid. */
  'discount_once_paid',
] as const
export type GuestPlanOutcome = (typeof guestPlanOutcomes)[number]

const civilDate = z.iso.date()
const count = z.number().int().min(0).max(100)

export const guestPlanSchema = z
  .object({
    kind: z.enum(['package', 'membership']),
    name: z.string().min(1).max(100),
    /** `unpaid`: a membership whose month is not paid yet. A package shown is always `active`. */
    state: z.enum(['active', 'unpaid']),
    /** While active. A package: its visits in all. A membership: the visits included each month. */
    visits: count.optional(),
    /** While active. A package: visits left. A membership: visits left this month. */
    visitsLeft: count.optional(),
    /** A package's last day. */
    endsOn: civilDate.optional(),
    /** A membership's discount in per cent, when it gives one. */
    discountPercent: z.number().int().min(1).max(50).optional(),
    /** While a membership is active: the day its next month starts. */
    nextMonthOn: civilDate.optional(),
    /**
     * A membership the studio takes from the guest's saved card each month: that card's brand and
     * last four digits, which the visit page already shows the guest when the card is saved.
     */
    paidByCard: z
      .object({ brand: z.string().min(1).max(40), last4: z.string().regex(/^\d{4}$/) })
      .strict()
      .optional(),
    /**
     * What the plan can mean for this visit, while the visit is still to be paid for. Absent when
     * there is nothing to say: another plan pays, or it does not cover this treatment.
     */
    thisVisit: z
      .object({
        outcome: z.enum(guestPlanOutcomes),
        /** A `_once_paid` outcome: the day the membership month this visit falls in starts. */
        monthOn: civilDate.optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
export type GuestPlan = z.infer<typeof guestPlanSchema>

/** The day a membership's next month starts, counting months from its first day as plans.ts does. */
export function nextMonthStart(holding: Pick<Holding, 'startedOn'>, today: string) {
  let k = 1
  while (addMonths(holding.startedOn, k) <= today) k += 1
  return addMonths(holding.startedOn, k)
}

/** The deposit recorded for this visit, as checkout counts it. */
function depositOn(s: BusinessState, appointmentId: string) {
  return s.payments
    .filter((p) => p.appointmentId === appointmentId && p.kind === 'deposit')
    .reduce((sum, p) => sum + p.amountMinor, 0)
}

/**
 * What each of the client's plans can mean for this visit, using checkout's own rules: the first
 * plan that can pay is the one checkout offers, none can pay once a deposit is recorded, and a
 * member discount is offered only when no plan pays. Checkout happens on the day of the visit, so
 * plans are judged as they will stand then; a visit already paid for, cancelled or missed gets
 * nothing.
 */
function visitOutcomes(s: BusinessState, a: Appointment, today: string) {
  const result = new Map<string, NonNullable<GuestPlan['thisVisit']>>()
  if (
    (a.status !== 'confirmed' && a.status !== 'arrived') ||
    s.sales.some((sale) => sale.appointmentId === a.id)
  )
    return result
  const day = a.date > today ? a.date : today
  const deposit = depositOn(s, a.id) > 0
  const own = clientHoldings(s, a.clientId).filter((h) => h.serviceIds.includes(a.serviceId))
  const first = plansForVisit(s, a, day)[0]
  if (first) result.set(first.holding.id, { outcome: deposit ? 'deposit' : 'covers' })
  const paidByPlan = !!first && !deposit
  if (!paidByPlan) {
    const percent = memberDiscountPercent(s, a, day)
    const giving = percent
      ? own.find((h) => planStanding(h, day).discountPercent === percent)
      : undefined
    if (giving && !result.has(giving.id)) result.set(giving.id, { outcome: 'discount' })
  }
  for (const holding of own) {
    if (result.has(holding.id)) continue
    const then = planStanding(holding, day)
    if (holding.kind === 'package' && then.state === 'expired')
      result.set(holding.id, { outcome: 'ends_before' })
    if (holding.kind === 'membership' && then.state === 'unpaid' && !paidByPlan) {
      // The same rules, as the plan would stand with the visit's month paid.
      const paid = planStanding({ ...holding, paidUntil: addMonths(day, 1) }, day)
      if (paid.canCover && !deposit)
        result.set(holding.id, { outcome: 'covers_once_paid', monthOn: then.periodStart })
      else if (paid.discountPercent)
        result.set(holding.id, { outcome: 'discount_once_paid', monthOn: then.periodStart })
    }
  }
  return result
}

/** The plans this visit's client holds, as the guest's page shows them. The server is the caller. */
export function guestPlans(s: BusinessState, appointmentId: string, now: number): GuestPlan[] {
  const a = s.appointments.find((item) => item.id === appointmentId)
  if (!a) throw new Error('This visit is not in the studio record.')
  const today = businessDate(s, new Date(now).toISOString())
  const shown = clientHoldings(s, a.clientId)
    .map((holding) => ({ holding, standing: planStanding(holding, today) }))
    .filter(({ standing }) => standing.state === 'active' || standing.state === 'unpaid')
  if (!shown.length) return []
  const outcomes = visitOutcomes(s, a, today)
  return shown.map(({ holding, standing }) => {
    const thisVisit = outcomes.get(holding.id)
    const active = standing.state === 'active'
    const card = openCardAgreement(holding)
    return guestPlanSchema.parse({
      kind: holding.kind,
      name: holding.name,
      state: active ? 'active' : 'unpaid',
      ...(active ? { visits: holding.visits, visitsLeft: standing.visitsLeft } : {}),
      ...(holding.kind === 'package' ? { endsOn: holding.endsOn } : {}),
      ...(holding.kind === 'membership' && holding.discountPercent
        ? { discountPercent: holding.discountPercent }
        : {}),
      ...(holding.kind === 'membership' && active
        ? { nextMonthOn: nextMonthStart(holding, today) }
        : {}),
      ...(holding.kind === 'membership' && card
        ? { paidByCard: { brand: card.brand, last4: card.last4 } }
        : {}),
      ...(thisVisit ? { thisVisit } : {}),
    })
  })
}
