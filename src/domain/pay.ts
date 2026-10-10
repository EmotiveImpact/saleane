import type { BusinessState, Staff } from './model'
import { operations } from './operations'
import type { PayRules } from './operations'
import { addDays } from './format'
import { mondayOf } from './timeOff'
import { retailRevenue } from './retail'
import { rentalOn, serviceRevenue } from './takings'
import { recordDay } from './tillCount'
import type { SaleRetail } from './retailSchema'
import {
  atRate,
  percent,
  productRate,
  reachedStep,
  rentingIn,
  stepCommission,
  stepParts,
  stepsOn,
  targetFor,
  treatmentRate,
} from './commission'
import type { ActiveSteps, CommissionPart, Resolved } from './commission'
import { csvCell } from './csv'
import { decimalHours, shifts } from './hours'
import type { HoursSummary } from './hours'

/**
 * V2: commission and tips per person for a pay period. SALEANE works out what each person has
 * earned; it does not pay anyone. Treatments and products are counted without tax and after any
 * discount. By default tips go in full to the person who did the visit and money given back comes
 * off the commission; the owner can change both (see `rulesFor`). People renting a chair or room
 * are self-employed: their visits on rental days earn no commission here.
 *
 * Stage 3: each part of a receipt earns the rate `commission.ts` finds for it (a rate of its own,
 * steps by takings or the usual rate). Rounding: fixed rates are rounded once per receipt for each
 * rate on it, as before; steps are rounded once on the month's takings so far, and each receipt
 * earns the difference it makes, so the receipts and the parts in words add up to the penny.
 */

/** What applies when the owner has not changed anything. */
export const DEFAULT_PAY_RULES = {
  refunds: 'commission',
  tips: 'person',
  pool: 'week',
} as const satisfies Pick<PayRules, 'refunds' | 'tips' | 'pool'>

/** The pay settings for a day: the latest change starting on or before it, or the defaults. */
export function rulesFor(
  s: BusinessState,
  date: string,
): Pick<PayRules, 'refunds' | 'tips' | 'pool'> {
  let found: PayRules | undefined
  for (const rules of operations(s).payRules ?? [])
    if (rules.from <= date && (!found || rules.from >= found.from)) found = rules
  return found ?? DEFAULT_PAY_RULES
}

export function rulesHistory(s: BusinessState) {
  return (operations(s).payRules ?? [])
    .map((rules, order) => ({ rules, order }))
    .sort((a, b) => b.rules.from.localeCompare(a.rules.from) || b.order - a.order)
    .map(({ rules }) => rules)
}

/** The first and last day of the shared tip pot a day falls in. */
export function poolRange(date: string, pool: PayRules['pool']) {
  if (pool === 'day') return { from: date, to: date }
  if (pool === 'week') {
    const from = mondayOf(date)
    return { from, to: addDays(from, 6) }
  }
  const from = `${date.slice(0, 7)}-01`
  return { from, to: addDays(`${addDays(from, 31).slice(0, 7)}-01`, -1) }
}

export { rateFor, rateHistory } from './commission'

export type PayLine = {
  kind: 'visit' | 'counter' | 'refund' | 'tips'
  date: string
  receipt: string
  label: string
  servicesMinor: number
  productsMinor: number
  commissionMinor: number
  tipMinor: number
}

/** How far someone is through their monthly target, counted the same way as their pay. */
export type TargetProgress = {
  month: string
  targetMinor: number
  treatmentsTargetMinor?: number
  productsTargetMinor?: number
  /** Treatments and products, less money given back that comes off their commission. */
  takenMinor: number
  treatmentsMinor: number
  productsMinor: number
}

export type PaySummary = {
  staff: Staff
  visits: number
  servicesMinor: number
  productsMinor: number
  givenBackMinor: number
  commissionMinor: number
  tipsMinor: number
  owedMinor: number
  lines: PayLine[]
  /** Stage 3: how the commission was worked out, in plain words; it adds up to `commissionMinor`. */
  parts: CommissionPart[]
  /** Stage 3: their target for the month, when the period is part of one month and they have one. */
  target?: TargetProgress
}

/** Splits an amount across weights so the pieces add up exactly, the odd pennies to the largest. */
export function splitBy(totalMinor: number, weights: number[]) {
  const sum = weights.reduce((a, b) => a + b, 0)
  if (sum <= 0 || !totalMinor) return weights.map((_, i) => (i === 0 ? totalMinor : 0))
  const exact = weights.map((w) => (totalMinor * w) / sum)
  const pieces = exact.map(Math.floor)
  let left = totalMinor - pieces.reduce((a, b) => a + b, 0)
  const order = exact
    .map((x, i) => ({ i, rest: x - Math.floor(x) }))
    .sort((a, b) => b.rest - a.rest || a.i - b.i)
  for (const { i } of order) {
    if (left <= 0) break
    pieces[i] += 1
    left -= 1
  }
  return pieces
}

/** One part of a receipt and the rate it earns. */
type Portion = { kind: 'treatments' | 'products'; amountMinor: number; resolved: Resolved }

/** A receipt's treatments and each product on it, with the rate each earns for one person. */
function portionsOf(
  s: BusinessState,
  staffId: string,
  date: string,
  treatmentsMinor: number,
  serviceId: string | undefined,
  productsMinor: number,
  retail: SaleRetail | undefined,
): Portion[] {
  const list: Portion[] = []
  if (serviceId && treatmentsMinor)
    list.push({
      kind: 'treatments',
      amountMinor: treatmentsMinor,
      resolved: treatmentRate(s, staffId, date, serviceId),
    })
  if (retail && productsMinor) {
    const pieces = splitBy(
      productsMinor,
      retail.lines.map((line) => line.quantity * line.unitMinor),
    )
    retail.lines.forEach((line, i) => {
      if (pieces[i])
        list.push({
          kind: 'products',
          amountMinor: pieces[i],
          resolved: productRate(s, staffId, date, line.productId),
        })
    })
  }
  return list
}

/** Commission on one receipt at fixed rates: one rounding for each rate on it. */
type Fixed = { label: string; amountMinor: number; commissionMinor: number }
function fixedParts(groups: Map<string, { bps: number; amountMinor: number }>, sign = 1): Fixed[] {
  return [...groups].map(([label, { bps, amountMinor }]) => ({
    label,
    amountMinor: sign * amountMinor,
    commissionMinor: sign * atRate(amountMinor, bps),
  }))
}
function addTo(
  groups: Map<string, { bps: number; amountMinor: number }>,
  label: string,
  bps: number,
  amountMinor: number,
) {
  const found = groups.get(label)
  if (found) found.amountMinor += amountMinor
  else groups.set(label, { bps, amountMinor })
}

/** A receipt, or money given back, as it counts for one person's pay. */
type Entry = {
  staffId: string
  date: string
  kind: 'visit' | 'counter' | 'refund'
  receipt: string
  label: string
  servicesMinor: number
  productsMinor: number
  tipMinor: number
  /** Parts earning a rate of their own or the usual rate. */
  fixed: Fixed[]
  /** What goes into (or, given back, comes out of) this month's takings for steps. */
  stepMinor: number
  /** Given back on step takings from an earlier month whose steps no longer apply. */
  earlier: { kind: Portion['kind']; amountMinor: number; month: string; steps: ActiveSteps }[]
}

const KIND_ORDER = { visit: 0, counter: 1, refund: 2 } as const
const byOrder = (a: Entry, b: Entry) =>
  a.date.localeCompare(b.date) ||
  a.receipt.localeCompare(b.receipt) ||
  KIND_ORDER[a.kind] - KIND_ORDER[b.kind]

const monthEnd = (month: string) => addDays(`${addDays(`${month}-01`, 31).slice(0, 7)}-01`, -1)

/**
 * Every receipt and every amount given back between two days, both included, as it counts for pay.
 * Visits by people renting on the day are left out: their takings are their own.
 */
function entries(s: BusinessState, from: string, to: string): Entry[] {
  const inRange = (date: string) => date >= from && date <= to
  const visits = new Map(s.appointments.map((a) => [a.id, a]))
  const services = new Map(s.services.map((service) => [service.id, service.name]))
  const list: Entry[] = []
  const priced = (portions: Portion[], sign: 1 | -1) => {
    const groups = new Map<string, { bps: number; amountMinor: number }>()
    let stepMinor = 0
    for (const p of portions) {
      if (p.resolved.by === 'steps') stepMinor += sign * p.amountMinor
      else
        addTo(
          groups,
          p.resolved.label,
          p.resolved.by === 'none' ? 0 : p.resolved.bps,
          p.amountMinor,
        )
    }
    return { fixed: fixedParts(groups, sign), stepMinor }
  }

  for (const sale of s.sales) {
    const visit = visits.get(sale.appointmentId)
    if (!visit || visit.status !== 'completed' || !inRange(visit.date)) continue
    // Someone renting a chair or room is self-employed and keeps their own takings.
    if (rentalOn(s, visit.staffId, visit.date)) continue
    const servicesMinor = serviceRevenue(sale)
    const productsMinor = retailRevenue(sale)
    list.push({
      staffId: visit.staffId,
      date: visit.date,
      kind: 'visit',
      receipt: sale.receiptNumber ?? '',
      label: visit.bookedServiceName ?? services.get(visit.serviceId) ?? 'Visit',
      servicesMinor,
      productsMinor,
      tipMinor: sale.tipMinor,
      ...priced(
        portionsOf(
          s,
          visit.staffId,
          visit.date,
          servicesMinor,
          visit.serviceId,
          productsMinor,
          sale.retail,
        ),
        1,
      ),
      earlier: [],
    })
  }

  for (const sale of s.counterSales ?? []) {
    const date = recordDay(s, sale.paidAt)
    if (!sale.staffId || !inRange(date) || rentalOn(s, sale.staffId, date)) continue
    const productsMinor = retailRevenue(sale)
    list.push({
      staffId: sale.staffId,
      date,
      kind: 'counter',
      receipt: sale.receiptNumber,
      label: 'Products without a visit',
      servicesMinor: 0,
      productsMinor,
      tipMinor: 0,
      ...priced(portionsOf(s, sale.staffId, date, 0, undefined, productsMinor, sale.retail), 1),
      earlier: [],
    })
  }

  // Unless the studio absorbs it, money given back comes off in the period it is given back, in
  // proportion to what the receipt was for and at the rate the receipt earned. Tips are left with
  // the person. Given back on takings that earned steps, it comes off this month's takings for
  // steps when steps still apply, otherwise at the rate their steps reached in the receipt's month.
  for (const refund of operations(s).refunds) {
    const date = recordDay(s, refund.createdAt)
    if (!inRange(date) || rulesFor(s, date).refunds === 'studio') continue
    let staffId: string | undefined
    let earnedOn = date
    let servicesMinor = 0
    let productsMinor = 0
    let total = 0
    let receipt = ''
    let serviceId: string | undefined
    let retail: SaleRetail | undefined
    if (refund.saleId) {
      const sale = s.sales.find((x) => x.id === refund.saleId)
      const visit = sale && visits.get(sale.appointmentId)
      if (!sale || !visit) continue
      staffId = visit.staffId
      earnedOn = visit.date
      serviceId = visit.serviceId
      servicesMinor = serviceRevenue(sale)
      productsMinor = retailRevenue(sale)
      retail = sale.retail
      total = sale.totalMinor
      receipt = sale.receiptNumber ?? ''
    } else if (refund.counterSaleId) {
      const sale = (s.counterSales ?? []).find((x) => x.id === refund.counterSaleId)
      if (!sale?.staffId) continue
      staffId = sale.staffId
      earnedOn = recordDay(s, sale.paidAt)
      productsMinor = retailRevenue(sale)
      retail = sale.retail
      total = sale.totalMinor
      receipt = sale.receiptNumber
    }
    if (!staffId || total <= 0 || rentalOn(s, staffId, earnedOn)) continue
    const backServices = Math.round((refund.amountMinor * servicesMinor) / total)
    const backProducts = Math.round((refund.amountMinor * productsMinor) / total)
    const portions = portionsOf(s, staffId, earnedOn, backServices, serviceId, backProducts, retail)
    const now = stepsOn(s, staffId, date)
    const intoSteps = (p: Portion) => !!now && (p.kind === 'treatments' || now.on === 'all')
    const earlier: Entry['earlier'] = []
    const rest: Portion[] = []
    for (const p of portions)
      if (p.resolved.by === 'steps' && !intoSteps(p))
        earlier.push({
          kind: p.kind,
          amountMinor: p.amountMinor,
          month: earnedOn.slice(0, 7),
          steps: p.resolved.steps,
        })
      else rest.push(p)
    list.push({
      staffId,
      date,
      kind: 'refund',
      receipt,
      label: 'Money given back',
      servicesMinor: -backServices,
      productsMinor: -backProducts,
      tipMinor: 0,
      ...priced(rest, -1),
      earlier,
    })
  }
  return list.sort(byOrder)
}

/** Earnings for every person, active or not, who earned something or is on the team. */
export function payPeriod(s: BusinessState, from: string, to: string): PaySummary[] {
  const org = s.organisation
  const inPeriod = (date: string) => date >= from && date <= to
  // Steps count a calendar month's takings, so the month's earlier days are read too.
  const all = entries(s, `${from.slice(0, 7)}-01`, to)
  const lines = new Map<string, PayLine[]>()
  const parts = new Map<string, Map<string, CommissionPart>>()
  const push = (staffId: string, line: PayLine) =>
    lines.set(staffId, [...(lines.get(staffId) ?? []), line])
  const addPart = (staffId: string, part: CommissionPart) => {
    const own = parts.get(staffId) ?? new Map<string, CommissionPart>()
    const found = own.get(part.label)
    if (found) {
      found.takingsMinor += part.takingsMinor
      found.commissionMinor += part.commissionMinor
    } else own.set(part.label, { ...part })
    parts.set(staffId, own)
  }
  const visitCount = new Map<string, number>()

  // The takings for steps so far in each person's month, and where each period starts and ends.
  const pots = new Map<string, { steps: ActiveSteps; x: number; start: number; end: number }>()
  const stepEarned = new Map<Entry, number>()
  for (const entry of all) {
    if (!entry.stepMinor) continue
    const month = entry.date.slice(0, 7)
    const key = `${entry.staffId}|${month}`
    const steps = stepsOn(s, entry.staffId, `${month}-01`)
    if (!steps) continue
    const pot = pots.get(key) ?? { steps, x: 0, start: 0, end: 0 }
    const before = pot.x
    pot.x += entry.stepMinor
    if (!inPeriod(entry.date)) pot.start = pot.end = pot.x
    else {
      pot.end = pot.x
      stepEarned.set(entry, stepCommission(steps, pot.x) - stepCommission(steps, before))
    }
    pots.set(key, pot)
  }

  // A month's whole takings for steps, for money given back after its steps stopped applying.
  const reached = new Map<string, number>()
  const monthTakings = (staffId: string, month: string) => {
    const key = `${staffId}|${month}`
    if (!reached.has(key))
      reached.set(
        key,
        entries(s, `${month}-01`, monthEnd(month))
          .filter((e) => e.staffId === staffId)
          .reduce((sum, e) => sum + e.stepMinor, 0),
      )
    return reached.get(key)!
  }

  // Shared tip pots, by their first day, and who worked in each.
  const tipPots = new Map<
    string,
    { pool: PayRules['pool']; range: { from: string; to: string }; tipMinor: number }
  >()
  const workedOn = (from: string, to: string) => {
    const people = new Set<string>()
    for (const sale of s.sales) {
      const appointment = s.appointments.find((a) => a.id === sale.appointmentId)
      if (
        appointment?.status === 'completed' &&
        appointment.date >= from &&
        appointment.date <= to &&
        !rentalOn(s, appointment.staffId, appointment.date)
      )
        people.add(appointment.staffId)
    }
    return s.staff.filter((person) => people.has(person.id))
  }

  for (const entry of all) {
    if (!inPeriod(entry.date)) continue
    let tipMinor = entry.tipMinor
    if (entry.kind === 'visit') {
      visitCount.set(entry.staffId, (visitCount.get(entry.staffId) ?? 0) + 1)
      const rules = rulesFor(s, entry.date)
      if (rules.tips === 'pool' && tipMinor) {
        const range = poolRange(entry.date, rules.pool)
        const key = `${rules.pool}:${range.from}`
        const pot = tipPots.get(key) ?? { pool: rules.pool, range, tipMinor: 0 }
        pot.tipMinor += tipMinor
        tipPots.set(key, pot)
        tipMinor = 0
      }
    }
    let commissionMinor = stepEarned.get(entry) ?? 0
    for (const part of entry.fixed) {
      commissionMinor += part.commissionMinor
      addPart(entry.staffId, {
        label: part.label,
        takingsMinor: part.amountMinor,
        commissionMinor: part.commissionMinor,
      })
    }
    for (const back of entry.earlier) {
      const list = back.steps.steps
      const bps = list[reachedStep(list, monthTakings(entry.staffId, back.month))].bps
      const minor = -atRate(back.amountMinor, bps)
      commissionMinor += minor
      addPart(entry.staffId, {
        label: `${back.kind === 'treatments' ? 'Treatments' : 'Products'} given back at ${percent(bps)}, the step reached in ${monthName(back.month, org.locale)}`,
        takingsMinor: -back.amountMinor,
        commissionMinor: minor,
      })
    }
    push(entry.staffId, {
      kind: entry.kind,
      date: entry.date,
      receipt: entry.receipt,
      label: entry.label,
      servicesMinor: entry.servicesMinor,
      productsMinor: entry.productsMinor,
      commissionMinor,
      tipMinor,
    })
  }

  // Each pot is split equally between everyone who did a visit in it. Odd pennies go to the first
  // people in team order, so the shares add up to exactly what was tipped.
  for (const { pool, range, tipMinor } of tipPots.values()) {
    const people = workedOn(range.from, range.to)
    const each = Math.floor(tipMinor / people.length)
    const odd = tipMinor - each * people.length
    people.forEach((person, i) =>
      push(person.id, {
        kind: 'tips',
        date: range.from < from ? from : range.from,
        receipt: '',
        label: `Shared tips for the ${pool}, split ${people.length} ${people.length === 1 ? 'way' : 'ways'}`,
        servicesMinor: 0,
        productsMinor: 0,
        commissionMinor: 0,
        tipMinor: each + (i < odd ? 1 : 0),
      }),
    )
  }

  // NEXT-07: someone who has left still appears for the hours they worked in the period.
  const worked = new Set(
    shifts(s)
      .filter((x) => inPeriod(x.date))
      .map((x) => x.staffId),
  )
  const oneMonth = from.endsWith('-01') && to.slice(0, 7) === from.slice(0, 7)
  return s.staff
    .filter((person) => !person.archived || lines.has(person.id) || worked.has(person.id))
    .map((staff) => {
      const rows = (lines.get(staff.id) ?? []).sort(
        (a, b) => a.date.localeCompare(b.date) || a.receipt.localeCompare(b.receipt),
      )
      const sum = (pick: (line: PayLine) => number, back = false) =>
        rows
          .filter((line) => (line.kind === 'refund') === back)
          .reduce((total, line) => total + pick(line), 0)
      const commissionMinor = rows.reduce((total, line) => total + line.commissionMinor, 0)
      const tipsMinor = rows.reduce((total, line) => total + line.tipMinor, 0)
      // Steps first, step by step, then each rate of its own and the usual rates.
      const stepped = [...pots]
        .filter(([key]) => key.startsWith(`${staff.id}|`))
        .flatMap(([, pot]) => stepParts(s, pot.steps, pot.start, pot.end))
      const howParts = [...stepped, ...(parts.get(staff.id)?.values() ?? [])].filter(
        (part) => part.takingsMinor || part.commissionMinor,
      )
      const servicesMinor = sum((line) => line.servicesMinor)
      const productsMinor = sum((line) => line.productsMinor)
      const givenBackMinor = 0 - sum((line) => line.servicesMinor + line.productsMinor, true)
      // A target carries on each month, but not into a month they rent: their takings are theirs.
      const month = from.slice(0, 7)
      const target =
        oneMonth && !rentingIn(s, staff.id, month) ? targetFor(s, staff.id, month) : undefined
      const net = (pick: (line: PayLine) => number) => rows.reduce((t, line) => t + pick(line), 0)
      return {
        staff,
        visits: visitCount.get(staff.id) ?? 0,
        servicesMinor,
        productsMinor,
        givenBackMinor,
        commissionMinor,
        tipsMinor,
        owedMinor: commissionMinor + tipsMinor,
        lines: rows,
        parts: howParts,
        ...(target
          ? {
              target: {
                month: from.slice(0, 7),
                targetMinor: target.takingsMinor,
                ...(target.treatmentsMinor
                  ? { treatmentsTargetMinor: target.treatmentsMinor }
                  : {}),
                ...(target.productsMinor ? { productsTargetMinor: target.productsMinor } : {}),
                takenMinor: servicesMinor + productsMinor - givenBackMinor,
                treatmentsMinor: net((line) => line.servicesMinor),
                productsMinor: net((line) => line.productsMinor),
              },
            }
          : {}),
      }
    })
}

/** "September 2026". */
function monthName(month: string, locale: string) {
  return new Date(`${month}-01T12:00:00Z`).toLocaleDateString(locale, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

/**
 * Someone's progress towards their target for a month, up to a day: the same takings their pay
 * counts. For their own page; owners and managers see it on Pay.
 */
export function targetProgress(s: BusinessState, staffId: string, month: string, until: string) {
  if (!targetFor(s, staffId, month)) return undefined
  const end = [until, monthEnd(month)].sort()[0]
  if (end < `${month}-01`) return undefined
  return payPeriod(s, `${month}-01`, end).find((row) => row.staff.id === staffId)?.target
}

/**
 * A plain spreadsheet for payroll or the accountant. Stage 3: each person's commission is worked
 * out in words beside the figures, with their target for the month when the period has one.
 */
export function payCsv(
  rows: PaySummary[],
  from: string,
  to: string,
  currency: string,
  /** NEXT-07: hours worked in the period, for anyone paid by the hour. */
  hours?: Map<string, HoursSummary>,
) {
  const amount = (minor: number) => (minor / 100).toFixed(2)
  const cell = csvCell
  const targets = rows.some((row) => row.target)
  const header = [
    'Person',
    'From',
    'To',
    'Visits',
    `Treatments (${currency}, before tax)`,
    `Products (${currency}, before tax)`,
    `Given back (${currency})`,
    `Commission (${currency})`,
    `Tips (${currency})`,
    `Owed (${currency})`,
    'How commission was worked out',
    ...(targets ? [`Monthly target (${currency})`, `Towards target (${currency})`] : []),
    ...(hours ? ['Hours worked', 'Shifts', 'Shifts with no finish time'] : []),
  ]
  const body = rows.map((row) =>
    [
      cell(row.staff.name),
      from,
      to,
      String(row.visits),
      amount(row.servicesMinor),
      amount(row.productsMinor),
      amount(row.givenBackMinor),
      amount(row.commissionMinor),
      amount(row.tipsMinor),
      amount(row.owedMinor),
      cell(
        row.parts
          .map(
            (part) =>
              `${part.label}: ${amount(part.takingsMinor)} earns ${amount(part.commissionMinor)}`,
          )
          .join('; '),
      ),
      ...(targets
        ? row.target
          ? [amount(row.target.targetMinor), amount(row.target.takenMinor)]
          : ['', '']
        : []),
      ...(hours ? hoursCells(hours.get(row.staff.id)) : []),
    ].join(','),
  )
  return [header.join(','), ...body].join('\n') + '\n'
}
const hoursCells = (row?: HoursSummary) => [
  decimalHours(row?.minutes ?? 0),
  String(row?.shifts.length ?? 0),
  String(row?.open ?? 0),
]

/**
 * Commission, targets and chair rent are for owners and managers. Reception and a general manager
 * read the studio without them. Rentals stay, with their terms taken out, so the studio's figures
 * still leave a renter's own takings out for everyone who reads them.
 */
export function withoutPayRates(s: BusinessState): BusinessState {
  const o = s.operations
  if (
    !o?.payRates &&
    !o?.rentals &&
    !o?.rentPayments &&
    !o?.commissionRates &&
    !o?.commissionSteps &&
    !o?.staffTargets
  )
    return s
  const {
    payRates: _rates,
    rentPayments: _paid,
    commissionRates: _own,
    commissionSteps: _steps,
    staffTargets: _targets,
    ...operations
  } = o
  void [_rates, _paid, _own, _steps, _targets]
  if (o.rentals)
    operations.rentals = o.rentals.map(({ percentBps: _share, ...rental }) => {
      void _share
      return { ...rental, amountMinor: 0 }
    })
  return { ...s, operations }
}
