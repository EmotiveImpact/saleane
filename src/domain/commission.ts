import type { BusinessState } from './model'
import { operations } from './operations'
import type { PayRate } from './operations'
import { money } from './format'
import type { Command } from './commandSchema'
import {
  COMMISSION_RATE_LIMIT,
  COMMISSION_STEPS_LIMIT,
  STAFF_TARGET_LIMIT,
} from './commissionSchema'
import type { CommissionRate, CommissionSteps, RateItem, StaffTarget } from './commissionSchema'

/**
 * Stage 3: which rate each part of a receipt earns, steps by takings, and monthly targets.
 * SALEANE works out what people earned; it never pays anyone. Only the owner sets rates and steps;
 * owners and managers set targets.
 *
 * Which rate a treatment or product earns, most specific first:
 * 1. a rate of its own for this person and this treatment (or this product);
 * 2. a rate of its own for everyone and this treatment (or this product);
 * 3. this person's rate for the kind of treatment (or for products in general);
 * 4. everyone's rate for the kind of treatment (or for products in general);
 * 5. steps by takings: this person's, otherwise everyone's (products only when the steps cover
 *    products), which take the place of the usual rate;
 * 6. this person's usual rate;
 * 7. nothing, when no rate is set.
 * A rate set for a treatment or product always wins over steps, and its takings do not count
 * towards the steps: steps count exactly the takings they pay on.
 */

export const commissionRates = (s: BusinessState): CommissionRate[] =>
  operations(s).commissionRates ?? []
export const commissionSteps = (s: BusinessState): CommissionSteps[] =>
  operations(s).commissionSteps ?? []
export const staffTargets = (s: BusinessState): StaffTarget[] => operations(s).staffTargets ?? []

/** "40%", or "12.5%". */
export const percent = (bps: number) =>
  `${(bps / 100).toLocaleString('en-GB', { maximumFractionDigits: 2 })}%`

/** "40" or "12.5" (a % sign is fine) as basis points; NaN when it is not from 0 to 100. */
export function parsePercent(value: string) {
  const trimmed = value.trim().replace(/%$/, '')
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(trimmed)) return NaN
  const bps = Math.round(Number(trimmed) * 100)
  return bps <= 10000 ? bps : NaN
}

/** A numerator in basis points as whole minor units, rounded half away from zero. */
const roundBps = (numerator: number) =>
  numerator < 0 ? -Math.floor((-numerator + 5000) / 10000) : Math.floor((numerator + 5000) / 10000)
/** An amount at a rate, in whole minor units, rounded half away from zero. */
export const atRate = (amountMinor: number, bps = 0) => roundBps(amountMinor * bps)

/** The latest of some dated records starting on or before a day; a later entry wins a tie. */
function latest<T extends { from: string }>(rows: readonly T[], date: string) {
  let found: T | undefined
  for (const row of rows) if (row.from <= date && (!found || row.from >= found.from)) found = row
  return found
}

/** The usual rate one person is on for a day: the latest change starting on or before it. */
export function rateFor(s: BusinessState, staffId: string, date: string): PayRate | undefined {
  return latest(
    (operations(s).payRates ?? []).filter((rate) => rate.staffId === staffId),
    date,
  )
}

export function rateHistory(s: BusinessState, staffId: string) {
  return (operations(s).payRates ?? [])
    .filter((rate) => rate.staffId === staffId)
    .map((rate, order) => ({ rate, order }))
    .sort((a, b) => b.rate.from.localeCompare(a.rate.from) || b.order - a.order)
    .map(({ rate }) => rate)
}

/** One key per item, so a later change to the same item replaces an earlier one. */
export function itemKey(item: RateItem) {
  if (item.kind === 'treatment') return `treatment:${item.serviceId}`
  if (item.kind === 'category') return `category:${item.category}`
  if (item.kind === 'product') return `product:${item.productId}`
  return 'products'
}
const sameStaff = (a?: string, b?: string) => (a ?? '') === (b ?? '')

/** The record for one person (or everyone, without one) and one item in force on a day. */
export function ownRateRecord(
  s: BusinessState,
  staffId: string | undefined,
  item: RateItem,
  date: string,
) {
  const key = itemKey(item)
  return latest(
    commissionRates(s).filter((r) => sameStaff(r.staffId, staffId) && itemKey(r.item) === key),
    date,
  )
}
/** A rate of its own in force on a day, or nothing once it has been ended. */
export function ownRateOn(
  s: BusinessState,
  staffId: string | undefined,
  item: RateItem,
  date: string,
) {
  const found = ownRateRecord(s, staffId, item, date)
  return found && found.bps !== null ? (found as CommissionRate & { bps: number }) : undefined
}

/** Every rate of its own in force on a day, for one person or everyone (`staffId` undefined). */
export function ownRatesOn(s: BusinessState, date: string) {
  const seen = new Map<string, CommissionRate>()
  for (const rate of commissionRates(s)) {
    const key = `${rate.staffId ?? ''}|${itemKey(rate.item)}`
    if (seen.has(key)) continue
    const found = ownRateRecord(s, rate.staffId, rate.item, date)
    if (found) seen.set(key, found)
  }
  return [...seen.values()].filter((r) => r.bps !== null)
}

/** Steps record for one person (or everyone) in force on a day, stopped or not. */
export function stepsRecord(s: BusinessState, staffId: string | undefined, date: string) {
  return latest(
    commissionSteps(s).filter((x) => sameStaff(x.staffId, staffId)),
    date,
  )
}
/**
 * The steps someone is on for a day: their own, otherwise everyone's. Stopping someone's own
 * steps puts them on everyone's steps if there are any, otherwise on their usual rate.
 */
export function stepsOn(s: BusinessState, staffId: string, date: string) {
  const own = stepsRecord(s, staffId, date)
  if (own?.steps) return own as CommissionSteps & { steps: NonNullable<CommissionSteps['steps']> }
  const all = stepsRecord(s, undefined, date)
  return all?.steps
    ? (all as CommissionSteps & { steps: NonNullable<CommissionSteps['steps']> })
    : undefined
}
export type ActiveSteps = NonNullable<ReturnType<typeof stepsOn>>

/** How a part of a receipt earns commission. */
export type Resolved =
  | { by: 'own'; bps: number; label: string }
  | { by: 'steps'; steps: ActiveSteps }
  | { by: 'usual'; bps: number; label: string }
  | { by: 'none'; label: string }

const serviceName = (s: BusinessState, id: string) =>
  s.services.find((x) => x.id === id)?.name ?? 'A treatment'
const productName = (s: BusinessState, id: string) =>
  operations(s).products.find((x) => x.id === id)?.name ?? 'A product'

/** What a rate of its own is for, in words: "Lymphatic Drainage", "Hair treatments". */
export function itemName(s: BusinessState, item: RateItem) {
  if (item.kind === 'treatment') return serviceName(s, item.serviceId)
  if (item.kind === 'category') return `${item.category} treatments`
  if (item.kind === 'product') return productName(s, item.productId)
  return 'Products'
}
function ownLabel(s: BusinessState, item: RateItem, bps: number) {
  if (item.kind === 'category') return `${itemName(s, item)} at ${percent(bps)}, their own rate`
  if (item.kind === 'products') return `Products at ${percent(bps)}, the rate for products`
  return `${itemName(s, item)} at ${percent(bps)}, its own rate`
}

function firstOwn(s: BusinessState, staffId: string, date: string, items: RateItem[]) {
  for (const item of items)
    for (const who of [staffId, undefined]) {
      const own = ownRateOn(s, who, item, date)
      if (own) return { by: 'own' as const, bps: own.bps, label: ownLabel(s, item, own.bps) }
    }
  return undefined
}

/** The rate a treatment earns for one person on a day, by the order at the top of this file. */
export function treatmentRate(
  s: BusinessState,
  staffId: string,
  date: string,
  serviceId: string,
): Resolved {
  const category = s.services.find((x) => x.id === serviceId)?.category
  const own = firstOwn(s, staffId, date, [
    { kind: 'treatment', serviceId },
    ...(category ? [{ kind: 'category' as const, category }] : []),
  ])
  if (own) return own
  const steps = stepsOn(s, staffId, date)
  if (steps) return { by: 'steps', steps }
  const usual = rateFor(s, staffId, date)
  if (usual)
    return {
      by: 'usual',
      bps: usual.serviceBps,
      label: `Treatments at ${percent(usual.serviceBps)}`,
    }
  return { by: 'none', label: 'Treatments with no rate set' }
}

/** The rate a product earns for one person on a day, by the order at the top of this file. */
export function productRate(
  s: BusinessState,
  staffId: string,
  date: string,
  productId: string,
): Resolved {
  const own = firstOwn(s, staffId, date, [{ kind: 'product', productId }, { kind: 'products' }])
  if (own) return own
  const steps = stepsOn(s, staffId, date)
  if (steps?.on === 'all') return { by: 'steps', steps }
  const usual = rateFor(s, staffId, date)
  if (usual)
    return {
      by: 'usual',
      bps: usual.productBps,
      label: `Products at ${percent(usual.productBps)}`,
    }
  return { by: 'none', label: 'Products with no rate set' }
}

type Step = NonNullable<CommissionSteps['steps']>[number]
/** The rate of the highest step a month's takings reached. */
export function reachedStep(steps: readonly Step[], totalMinor: number) {
  let index = 0
  steps.forEach((step, i) => {
    if (totalMinor >= step.fromMinor) index = i
  })
  return index
}

/**
 * Commission on a month's takings so far, `x`, under steps, worked out exactly and rounded once.
 * Marginal steps pay each step's rate only on the takings within it. With steps for the whole
 * month, every pound so far earns the rate of the highest step reached so far, so the month that
 * reaches a step catches up the earlier takings at the new rate. Either way each receipt earns the
 * difference it makes to this figure, so a month's receipts add up exactly to it, and a month
 * already paid never changes when later takings come in.
 */
export function stepCommission(steps: Pick<ActiveSteps, 'kind' | 'steps'>, x: number) {
  const list = steps.steps
  if (steps.kind === 'whole') return atRate(x, list[reachedStep(list, x)].bps)
  if (x <= 0) return atRate(x, list[0].bps)
  let numerator = 0
  list.forEach((step, i) => {
    const top = list[i + 1]?.fromMinor ?? Infinity
    const within = Math.min(x, top) - step.fromMinor
    if (within > 0) numerator += within * step.bps
  })
  return roundBps(numerator)
}

export type CommissionPart = { label: string; takingsMinor: number; commissionMinor: number }

const scopeWord = (steps: Pick<ActiveSteps, 'on'>) =>
  steps.on === 'all' ? 'Treatments and products' : 'Treatments'

/**
 * A month's step takings from `start` to `end` (the month's takings so far before and after a pay
 * period), step by step, in words. Each part earns the difference of the rounded figures at its
 * edges, so the parts add up exactly to what the receipts in the period earned.
 */
export function stepParts(
  s: BusinessState,
  steps: ActiveSteps,
  start: number,
  end: number,
): CommissionPart[] {
  const org = s.organisation
  const list = steps.steps
  const scope = scopeWord(steps)
  const at = (x: number) => stepCommission(steps, x)
  if (steps.kind === 'whole') {
    const i = reachedStep(list, end)
    const why =
      i > 0 ? `past ${money(list[i].fromMinor, org)}` : `below ${money(list[1].fromMinor, org)}`
    return [
      {
        label: `${scope} at ${percent(list[i].bps)} on the whole month, ${why}`,
        takingsMinor: end - start,
        commissionMinor: at(end) - at(start),
      },
    ]
  }
  const parts: CommissionPart[] = []
  list.forEach((step, i) => {
    const low = i === 0 ? -Infinity : step.fromMinor
    const high = list[i + 1]?.fromMinor ?? Infinity
    const clamp = (x: number) => Math.min(high, Math.max(low, x))
    const takingsMinor = clamp(end) - clamp(start)
    const commissionMinor = at(clamp(end)) - at(clamp(start))
    if (!takingsMinor && !commissionMinor) return
    const label =
      i === 0
        ? `${scope} at ${percent(step.bps)} up to ${money(high, org)}`
        : high === Infinity
          ? `${scope} at ${percent(step.bps)} above ${money(step.fromMinor, org)}`
          : `${scope} at ${percent(step.bps)} from ${money(step.fromMinor, org)} to ${money(high, org)}`
    parts.push({ label, takingsMinor, commissionMinor })
  })
  return parts
}

/** Steps in a short phrase: "Treatments 30% to £3,000, then 35%". */
export function stepsPhrase(s: BusinessState, steps: Pick<ActiveSteps, 'on' | 'kind' | 'steps'>) {
  const org = s.organisation
  const list = steps.steps
  const scope = steps.on === 'all' ? 'Treatments and products' : 'Treatments'
  if (steps.kind === 'marginal')
    return `${scope} ${list
      .map((step, i) =>
        i === list.length - 1
          ? `then ${percent(step.bps)}`
          : `${percent(step.bps)} to ${money(list[i + 1].fromMinor, org)}`,
      )
      .join(', ')}`
  return `${scope} ${list
    .map((step, i) =>
      i === 0
        ? percent(step.bps)
        : `${percent(step.bps)} on everything once past ${money(step.fromMinor, org)}`,
    )
    .join(joinWith(list.length))}`
}
/** "30%, or 35% on everything once past £3,000" reads better with "or" for two steps. */
const joinWith = (count: number) => (count === 2 ? ', or ' : ', ')

/** The two kinds of steps, each in one plain sentence. */
export const STEP_KIND_SENTENCE = {
  marginal:
    'Each step’s rate is paid only on the takings above it, so the first part always earns the first rate.',
  whole: 'Once the month’s takings reach a step, the whole month is paid at that step’s rate.',
} as const

/**
 * How someone's commission is worked out on a day, in a short line for the owner: their steps or
 * usual rates, then the rates set for a treatment or product that apply to them ("Treatments 35%
 * to £3,000, then 40% · Products 10% · Lymphatic Massage 45%").
 */
export function commissionBasis(s: BusinessState, staffId: string, date: string) {
  const steps = stepsOn(s, staffId, date)
  const usual = rateFor(s, staffId, date)
  const parts: string[] = []
  if (steps) {
    parts.push(stepsPhrase(s, steps))
    if (steps.on === 'treatments')
      parts.push(usual ? `Products ${percent(usual.productBps)}` : 'No rate for products')
  } else if (usual) {
    parts.push(`Treatments ${percent(usual.serviceBps)}`, `Products ${percent(usual.productBps)}`)
  } else parts.push('No commission rate set')
  // Their own rate for an item wins over everyone's for the same item.
  const own = new Map<string, CommissionRate & { bps: number }>()
  for (const rate of ownRatesOn(s, date))
    if (rate.staffId === staffId || (!rate.staffId && !own.has(itemKey(rate.item))))
      own.set(itemKey(rate.item), rate as CommissionRate & { bps: number })
  const named = [...own.values()].map((r) => `${itemName(s, r.item)} ${percent(r.bps)}`)
  parts.push(...named.slice(0, 3))
  if (named.length > 3) parts.push(`${named.length - 3} more rates for treatments or products`)
  return parts.join(' · ')
}

/** The target in force for someone in a month ("2026-10"), if any. */
export function targetFor(s: BusinessState, staffId: string, month: string) {
  let found: StaffTarget | undefined
  for (const target of staffTargets(s))
    if (target.staffId === staffId && target.from <= month && (!found || target.from >= found.from))
      found = target
  return found && found.takingsMinor !== null
    ? (found as StaffTarget & { takingsMinor: number })
    : undefined
}

export function targetHistory(s: BusinessState, staffId: string) {
  return staffTargets(s)
    .map((target, order) => ({ target, order }))
    .filter(({ target }) => target.staffId === staffId)
    .sort((a, b) => b.target.from.localeCompare(a.target.from) || b.order - a.order)
    .map(({ target }) => target)
}

/** How far through a target someone is, from 0, as a whole percentage for the screen. */
export const progressPercent = (takenMinor: number, targetMinor: number) =>
  targetMinor > 0 ? Math.max(0, Math.floor((takenMinor / targetMinor) * 100)) : 0

type CommissionCommand = Extract<
  Command,
  { type: 'commission-rate' | 'commission-steps' | 'staff-target' }
>
export const COMMISSION_COMMANDS = ['commission-rate', 'commission-steps', 'staff-target'] as const

/** Someone renting a chair or room on any day of a month ("2026-10") works for themselves. */
export const rentingIn = (s: BusinessState, staffId: string, month: string) =>
  (operations(s).rentals ?? []).some(
    (r) => r.staffId === staffId && r.from <= `${month}-31` && (!r.to || r.to >= `${month}-01`),
  )

/**
 * Saves a rate of its own, steps by takings or a monthly target. The route has already checked
 * who may: only the owner changes rates and steps; owners and managers set targets. Every change
 * is kept with its date, so earlier pay is never rewritten.
 */
export function runCommissionCommand(
  next: BusinessState,
  command: CommissionCommand,
  now: string,
  makeId: () => string,
) {
  const o = (next.operations ??= operations(next))
  const person = (staffId: string | undefined, active: boolean) => {
    if (!staffId) return
    if (!next.staff.some((p) => p.id === staffId && (!active || !p.archived)))
      throw new Error('Choose someone on the team.')
  }

  if (command.type === 'commission-rate') {
    const { input } = command
    const starting = input.bps !== null
    person(input.staffId, starting)
    const { item } = input
    if (item.kind === 'treatment') {
      const service = next.services.find((x) => x.id === item.serviceId)
      if (!service || (starting && service.archived)) throw new Error('Choose a treatment.')
    }
    if (item.kind === 'product') {
      const product = o.products.find((x) => x.id === item.productId)
      if (!product || (starting && (product.archived || product.forSale === false)))
        throw new Error('Choose a product that is sold at the till.')
    }
    if (!starting && !ownRateOn(next, input.staffId, item, input.from))
      throw new Error('There is no rate of its own to end on that day.')
    o.commissionRates ??= []
    if (o.commissionRates.length >= COMMISSION_RATE_LIMIT)
      throw new Error('Too many commission changes to keep.')
    const rate: CommissionRate = {
      id: makeId(),
      ...(input.staffId ? { staffId: input.staffId } : {}),
      item,
      bps: input.bps,
      from: input.from,
      createdAt: now,
      actor: 'Local operator',
    }
    o.commissionRates.push(rate)
    return rate.id
  }

  if (command.type === 'commission-steps') {
    const { input } = command
    person(input.staffId, input.steps !== null)
    if (input.steps === null && !stepsRecord(next, input.staffId, input.from)?.steps)
      throw new Error('There are no steps to stop from that month.')
    o.commissionSteps ??= []
    if (o.commissionSteps.length >= COMMISSION_STEPS_LIMIT)
      throw new Error('Too many changes to steps to keep.')
    const steps: CommissionSteps = {
      id: makeId(),
      ...(input.staffId ? { staffId: input.staffId } : {}),
      on: input.on,
      kind: input.kind,
      steps: input.steps,
      from: input.from,
      createdAt: now,
      actor: 'Local operator',
    }
    o.commissionSteps.push(steps)
    return steps.id
  }

  // staff-target
  const { input } = command
  const stopping = input.takingsMinor === null
  person(input.staffId, !stopping)
  if (stopping) {
    if (input.treatmentsMinor || input.productsMinor)
      throw new Error('Leave the treatment and product targets empty to stop the target.')
    if (!targetFor(next, input.staffId, input.from))
      throw new Error('There is no target to stop from that month.')
  } else {
    if (rentingIn(next, input.staffId, input.from))
      throw new Error('They rent a chair or room that month, so their takings are their own.')
    for (const part of [input.treatmentsMinor, input.productsMinor])
      if (part && part > (input.takingsMinor ?? 0))
        throw new Error('A treatment or product target cannot be more than the whole target.')
  }
  o.staffTargets ??= []
  if (o.staffTargets.length >= STAFF_TARGET_LIMIT)
    throw new Error('Too many target changes to keep.')
  const target: StaffTarget = {
    id: makeId(),
    staffId: input.staffId,
    from: input.from,
    takingsMinor: input.takingsMinor,
    ...(input.treatmentsMinor ? { treatmentsMinor: input.treatmentsMinor } : {}),
    ...(input.productsMinor ? { productsMinor: input.productsMinor } : {}),
    createdAt: now,
    actor: 'Local operator',
  }
  o.staffTargets.push(target)
  return target.id
}

/** What is wrong with the commission records, if anything: each must point at someone real. */
export function commissionProblem(s: BusinessState) {
  const rates = commissionRates(s)
  const steps = commissionSteps(s)
  const targets = staffTargets(s)
  for (const rows of [rates, steps, targets])
    if (new Set(rows.map((r) => r.id)).size !== rows.length)
      return 'Duplicate commission record IDs.'
  const known = new Set(s.staff.map((p) => p.id))
  if ([...rates, ...steps].some((r) => r.staffId && !known.has(r.staffId)))
    return 'Missing commission professional.'
  if (targets.some((t) => !known.has(t.staffId))) return 'Missing target professional.'
  return undefined
}
