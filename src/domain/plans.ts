import type { Command } from './commandSchema'
import type { Appointment, BusinessState, RelationshipEvent, Sale } from './model'
import type { Holding, Offer } from './plansSchema'
import { assertMethod } from './operatingCommands'
import { businessDate, operations } from './operations'
import { dateLabel, money } from './format'
import { referenceTaken, refundReferenceTaken } from './references'
import { salePlace } from './locations'

/**
 * V1.5: packages and memberships. A package is a number of visits bought at one price and used
 * within a set time. A membership is paid month by month and can include visits each month, a
 * discount on other visits, or both. Money paid for a plan is held until visits use it, so reports
 * count a covered visit's share as that day's takings and the rest stays as unused value. Nothing
 * is deleted: plans end by being cancelled or by running out.
 */
type PlanCommand = Extract<Command, { type: 'offer' | 'plan-sell' | 'plan-renew' | 'plan-cancel' }>
type AddEvent = (
  event: Omit<RelationshipEvent, 'id' | 'organisationId' | 'occurredAt' | 'actor'>,
) => void

/** The same day `months` later, or the month's last day when it is shorter ("31 Jan" → "28 Feb"). */
export function addMonths(date: string, months: number) {
  const [y, m, d] = date.split('-').map(Number)
  const first = new Date(Date.UTC(y, m - 1 + months, 1))
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate()
  first.setUTCDate(Math.min(d, last))
  return first.toISOString().slice(0, 10)
}

/** The start of the membership month that contains `today`. */
export function periodStartFor(holding: Pick<Holding, 'startedOn'>, today: string) {
  if (today < holding.startedOn) return holding.startedOn
  let k = 0
  while (addMonths(holding.startedOn, k + 1) <= today) k += 1
  return addMonths(holding.startedOn, k)
}

export const offers = (s: BusinessState) => s.offers ?? []
export const holdings = (s: BusinessState) => s.holdings ?? []
export const clientHoldings = (s: BusinessState, clientId: string) =>
  holdings(s).filter((h) => h.clientId === clientId)

const sum = (rows: { amountMinor?: number; valueMinor?: number }[]) =>
  rows.reduce((total, row) => total + (row.amountMinor ?? row.valueMinor ?? 0), 0)

/** Where a plan stands today: what is left, whether it can cover a visit, and the money in it. */
export function planStanding(holding: Holding, today: string) {
  const paidMinor = sum(holding.payments)
  const usedMinor = sum(holding.uses)
  const refundedMinor = sum(holding.refunds)
  const periodStart =
    holding.kind === 'membership' ? periodStartFor(holding, today) : holding.startedOn
  const usesNow =
    holding.kind === 'membership'
      ? holding.uses.filter((u) => u.periodStart === periodStart)
      : holding.uses
  const visitsLeft = Math.max(0, holding.visits - usesNow.length)
  const expired = holding.kind === 'package' && !!holding.endsOn && today > holding.endsOn
  const paidUp = holding.kind === 'package' || (!!holding.paidUntil && today < holding.paidUntil)
  const live = holding.status === 'active' && !expired && paidUp && today >= holding.startedOn
  const state: 'active' | 'used' | 'expired' | 'unpaid' | 'cancelled' =
    holding.status === 'cancelled'
      ? 'cancelled'
      : expired
        ? 'expired'
        : !paidUp
          ? 'unpaid'
          : holding.kind === 'package' && visitsLeft === 0
            ? 'used'
            : 'active'
  return {
    state,
    paidMinor,
    usedMinor,
    refundedMinor,
    /**
     * What a client could still use, or have back. A membership's past months are not owed and
     * unused visits do not roll over, so only the current and any prepaid months count.
     */
    unusedMinor:
      holding.kind === 'package'
        ? Math.max(0, paidMinor - usedMinor - refundedMinor)
        : Math.max(
            0,
            sum(holding.payments.filter((p) => (p.periodStart ?? '') >= periodStart)) -
              sum(holding.uses.filter((u) => (u.periodStart ?? '') >= periodStart)) -
              refundedMinor,
          ),
    visitsLeft,
    periodStart,
    canCover: live && visitsLeft > 0,
    discountPercent: live ? holding.discountPercent : 0,
  }
}

/** The share of the plan's price one covered visit uses; the last visit takes what is left. */
function visitValue(holding: Holding, today: string) {
  const standing = planStanding(holding, today)
  const perVisit = Math.floor(holding.priceMinor / holding.visits)
  if (standing.visitsLeft > 1) return perVisit
  const usedNow =
    holding.kind === 'membership'
      ? sum(holding.uses.filter((u) => u.periodStart === standing.periodStart))
      : standing.usedMinor
  return Math.max(0, holding.priceMinor - usedNow)
}

/** What this visit would take from the plan, for the checkout preview. */
export function coverPreview(holding: Holding, bookedPriceMinor: number, today: string) {
  return Math.min(visitValue(holding, today), bookedPriceMinor)
}

/** The plans that could pay for this visit today, for the checkout screen. */
export function plansForVisit(s: BusinessState, appointment: Appointment, today: string) {
  return clientHoldings(s, appointment.clientId)
    .filter((h) => h.serviceIds.includes(appointment.serviceId))
    .map((holding) => ({ holding, standing: planStanding(holding, today) }))
    .filter(({ standing }) => standing.canCover)
}

/** A membership discount the desk may offer on a visit that no plan covers. */
export function memberDiscountPercent(s: BusinessState, appointment: Appointment, today: string) {
  return Math.max(
    0,
    ...clientHoldings(s, appointment.clientId)
      .filter((h) => h.serviceIds.includes(appointment.serviceId))
      .map((h) => planStanding(h, today).discountPercent),
  )
}

/**
 * Checks a plan can pay for this visit and records the visit against it. Returns the value the
 * visit uses, which the receipt shows as paid by the plan. `next` is the working copy.
 */
export function coverVisit(
  next: BusinessState,
  appointment: Appointment,
  holdingId: string,
  depositMinor: number,
  saleId: string,
  now: string,
  makeId: () => string,
) {
  const holding = holdings(next).find((h) => h.id === holdingId)
  if (!holding || holding.clientId !== appointment.clientId)
    throw new Error('This plan does not belong to this client.')
  if (!holding.serviceIds.includes(appointment.serviceId))
    throw new Error(`${holding.name} does not cover this treatment.`)
  if (depositMinor > 0)
    throw new Error('This visit already has a deposit. Take the visit off the plan or refund it.')
  const today = businessDate(next, now)
  const standing = planStanding(holding, today)
  if (!standing.canCover)
    throw new Error(
      standing.state === 'unpaid'
        ? `${holding.name} needs this month’s payment first.`
        : standing.state === 'expired'
          ? `${holding.name} has expired.`
          : `${holding.name} has no visits left${holding.kind === 'membership' ? ' this month' : ''}.`,
    )
  const valueMinor = coverPreview(holding, appointment.bookedPriceMinor, today)
  holding.uses.push({
    id: makeId(),
    appointmentId: appointment.id,
    saleId,
    valueMinor,
    usedAt: now,
    ...(holding.kind === 'membership' ? { periodStart: standing.periodStart } : {}),
  })
  return { holding, valueMinor, visitsLeft: standing.visitsLeft - 1 }
}

export function runPlanCommand(
  next: BusinessState,
  command: PlanCommand,
  now: string,
  makeId: () => string,
  addEvent: AddEvent,
) {
  const org = next.organisation
  const today = businessDate(next, now)
  if (command.type === 'offer') {
    const input = command.input
    if (input.serviceIds.some((id) => !next.services.some((service) => service.id === id)))
      throw new Error('Choose treatments offered here.')
    next.offers ??= []
    if (command.id) {
      const offer = next.offers.find((o) => o.id === command.id)
      if (!offer) throw new Error('This plan is not offered here.')
      if (offer.kind !== input.kind)
        throw new Error('A package cannot become a membership. Add a new plan instead.')
      assertNameFree(next.offers, input, offer.id)
      // Clients keep the terms they bought; only future sales change.
      Object.assign(offer, input)
      return offer.id
    }
    assertNameFree(next.offers, input)
    const offer: Offer = { id: makeId(), organisationId: org.id, createdAt: now, ...input }
    next.offers.push(offer)
    return offer.id
  }
  if (command.type === 'plan-sell') {
    const offer = offers(next).find((o) => o.id === command.offerId)
    const client = next.clients.find((c) => c.id === command.clientId)
    if (!offer || offer.archived) throw new Error('This plan is not on sale.')
    if (!client) throw new Error('Client does not belong to this studio.')
    assertMethod(next, command.method, command.reference)
    assertReferenceFree(next, command.reference)
    const place = salePlace(next, command.locationId)
    next.holdings ??= []
    if (
      offer.kind === 'membership' &&
      next.holdings.some(
        (h) => h.clientId === client.id && h.offerId === offer.id && h.status === 'active',
      )
    )
      throw new Error(`${client.name} already has ${offer.name}.`)
    const holding: Holding = {
      id: makeId(),
      organisationId: org.id,
      clientId: client.id,
      offerId: offer.id,
      kind: offer.kind,
      name: offer.name,
      serviceIds: [...offer.serviceIds],
      visits: offer.visits,
      priceMinor: offer.priceMinor,
      discountPercent: offer.discountPercent,
      startedOn: today,
      ...(offer.kind === 'package'
        ? { endsOn: addDaysBefore(addMonths(today, offer.validMonths)) }
        : { paidUntil: addMonths(today, 1) }),
      status: 'active',
      soldAt: now,
      actor: '',
      ...place,
      payments: [
        {
          id: makeId(),
          amountMinor: offer.priceMinor,
          method: command.method,
          ...(command.reference ? { reference: command.reference } : {}),
          recordedAt: now,
          ...(offer.kind === 'membership' ? { periodStart: today } : {}),
        },
      ],
      uses: [],
      refunds: [],
    }
    next.holdings.push(holding)
    addEvent({
      clientId: client.id,
      type: 'plan',
      title: offer.kind === 'package' ? 'Package bought' : 'Membership started',
      detail: `${offer.name}: ${money(offer.priceMinor, org, true)}${offer.kind === 'membership' ? ' for the first month' : `, ${offer.visits} visits until ${dateLabel(holding.endsOn!, org.locale)}`}. ${paidWith(command.method, operations(next).mode)}`,
    })
    return holding.id
  }
  const holding = holdings(next).find((h) => h.id === command.holdingId)
  if (!holding) throw new Error('This plan does not belong to this studio.')
  if (holding.status === 'cancelled') throw new Error('This plan has already ended.')
  if (command.type === 'plan-renew') {
    if (holding.kind !== 'membership') throw new Error('Only a membership is paid monthly.')
    assertMethod(next, command.method, command.reference)
    // A lapsed membership restarts from the month it is in now; missed months stay unpaid.
    const periodStart =
      holding.paidUntil! > today ? holding.paidUntil! : periodStartFor(holding, today)
    if (periodStart > addMonths(today, 1))
      throw new Error('This membership is already paid for the coming month.')
    if (holding.payments.some((p) => p.periodStart === periodStart))
      return holding.payments.find((p) => p.periodStart === periodStart)!.id
    assertReferenceFree(next, command.reference)
    const payment = {
      id: makeId(),
      amountMinor: holding.priceMinor,
      method: command.method,
      ...(command.reference ? { reference: command.reference } : {}),
      recordedAt: now,
      periodStart,
    }
    holding.payments.push(payment)
    holding.paidUntil = addMonths(
      holding.startedOn,
      monthsBetween(holding.startedOn, periodStart) + 1,
    )
    addEvent({
      clientId: holding.clientId,
      type: 'plan',
      title: 'Membership paid',
      detail: `${holding.name}: ${money(holding.priceMinor, org, true)} for the month from ${dateLabel(periodStart, org.locale)}. ${paidWith(command.method, operations(next).mode)}`,
    })
    return payment.id
  }
  // plan-cancel: ends the plan; any money returned is capped at what is paid and not yet used.
  const standing = planStanding(holding, today)
  const refundMinor = command.refundMinor ?? 0
  if (refundMinor > standing.unusedMinor)
    throw new Error(`Refund up to ${money(standing.unusedMinor, org, true)}, the unused part.`)
  if (refundMinor > 0) {
    // The sample workspace asks for no reference, so a demo refund is given one.
    const refundId = makeId()
    const reference =
      command.reference?.trim() ||
      (operations(next).mode === 'sandbox' ? `DEMO-${refundId.slice(0, 8)}` : '')
    if (!command.method || !reference)
      throw new Error('Say how the money was returned and give its reference.')
    assertMethod(next, command.method, reference)
    if (refundReferenceTaken(next, reference))
      throw new Error('This refund reference is already recorded. Review the existing record.')
    holding.refunds.push({
      id: refundId,
      amountMinor: refundMinor,
      method: command.method,
      reference,
      reason: command.reason,
      createdAt: now,
      actor: '',
    })
  }
  holding.status = 'cancelled'
  holding.cancelled = { at: now, actor: '', reason: command.reason }
  addEvent({
    clientId: holding.clientId,
    type: 'plan',
    title: holding.kind === 'package' ? 'Package ended' : 'Membership ended',
    detail: `${holding.name}: ${command.reason}. ${refundMinor ? `${money(refundMinor, org, true)} recorded as returned. SALEANE did not process a refund.` : 'No money returned.'}`,
  })
  return holding.id
}

function assertNameFree(list: Offer[], input: { name: string; archived: boolean }, id?: string) {
  const name = input.name.trim().toLowerCase()
  if (
    !input.archived &&
    list.some((o) => o.id !== id && !o.archived && o.name.trim().toLowerCase() === name)
  )
    throw new Error('A plan with this name is already offered.')
}
/** A payment reference names one payment, as at checkout and for deposits. */
function assertReferenceFree(s: BusinessState, reference?: string) {
  const ref = reference?.trim()
  if (ref && referenceTaken(s, ref))
    throw new Error('This payment reference is already recorded. Review the existing payment.')
}
function addDaysBefore(date: string) {
  const value = new Date(`${date}T12:00:00Z`)
  value.setUTCDate(value.getUTCDate() - 1)
  return value.toISOString().slice(0, 10)
}
function monthsBetween(from: string, to: string) {
  let k = 0
  while (addMonths(from, k) < to) k += 1
  return k
}
function paidWith(method: string, mode: string) {
  if (mode === 'sandbox') return 'Demo payment recorded. No real money was collected.'
  return method === 'cash'
    ? 'Recorded as cash received.'
    : 'Recorded as paid at an external terminal. SALEANE did not process a payment.'
}

/** Puts the person's name on plans, payments, refunds and endings this command created. */
export function stampPlanActors(before: BusinessState, after: BusinessState, actor: string) {
  const old = new Map(holdings(before).map((h) => [h.id, h]))
  for (const holding of holdings(after)) {
    const previous = old.get(holding.id)
    if (!previous) holding.actor = actor
    if (holding.cancelled && !previous?.cancelled) holding.cancelled.actor = actor
    const refunds = new Set(previous?.refunds.map((r) => r.id))
    for (const refund of holding.refunds) if (!refunds.has(refund.id)) refund.actor = actor
  }
}

/** Ledger checks for parseState: every plan, its use and the receipts it paid must agree. */
export function plansProblem(s: BusinessState) {
  const org = s.organisation
  const list = [offers(s), holdings(s)]
  for (const rows of list) {
    if (new Set(rows.map((r) => r.id)).size !== rows.length) return 'Duplicate plan IDs.'
    if (rows.some((r) => r.organisationId !== org.id)) return 'Foreign workspace record.'
  }
  const sandbox = operations(s).mode === 'sandbox'
  const salesById = new Map(s.sales.map((sale) => [sale.id, sale]))
  const covered = new Map<string, string>()
  for (const holding of holdings(s)) {
    if (
      !s.clients.some((c) => c.id === holding.clientId) ||
      !offers(s).some((o) => o.id === holding.offerId) ||
      (holding.status === 'cancelled') !== !!holding.cancelled ||
      (holding.kind === 'package') !== !!holding.endsOn ||
      (holding.kind === 'membership') !== !!holding.paidUntil ||
      holding.payments.length === 0
    )
      return 'Invalid plan.'
    for (const record of [...holding.payments, ...holding.refunds])
      if (
        ['card', 'previous_system'].includes(record.method) ||
        sandbox !== record.method.startsWith('demo_') ||
        (record.method === 'external_card' && !record.reference?.trim())
      )
        return 'A plan payment record is not valid for this studio.'
    if (sum(holding.refunds) + sum(holding.uses) > sum(holding.payments))
      return 'A plan cannot use or return more than was paid.'
    for (const use of holding.uses) {
      const sale = salesById.get(use.saleId)
      if (
        !sale ||
        sale.holdingId !== holding.id ||
        sale.appointmentId !== use.appointmentId ||
        sale.coveredMinor !== use.valueMinor ||
        covered.has(sale.id)
      )
        return 'Plan use does not match its receipt.'
      covered.set(sale.id, holding.id)
    }
  }
  for (const sale of s.sales)
    if ((sale.holdingId || sale.coveredMinor !== undefined) && !covered.has(sale.id))
      return 'A receipt names a plan that did not pay for it.'
  return null
}

/** What the guest pays at the desk once a plan has paid for the visit. */
export function coveredSaleProblem(sale: Sale) {
  if (sale.coveredMinor === undefined) return null
  return sale.taxInclusive &&
    sale.depositAppliedMinor === 0 &&
    sale.coveredMinor === sale.serviceMinor - (sale.discountMinor ?? 0)
    ? null
    : 'Invalid plan receipt.'
}
