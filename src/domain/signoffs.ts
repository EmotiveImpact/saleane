import type { BusinessState } from './model'
import type { Command } from './commandSchema'
import { businessDate, hoursFor, operations, plannedHoursFor } from './operations'
import type { Role } from './operations'
import { addDays, dateLabel, money, timeLabel } from './format'
import { offeredAt, placeOf, places, serviceAt } from './locations'
import { refundableOnReceipt } from './giftCards'
import { serviceRuleRefusal } from './brandRules'
import { changeKind, runRotaCommand, weekCopy } from './rota'
import { scheduleSnapshot } from './schedule'
import { ROTA_COMMANDS } from './rotaSchema'
import { PRICE_AHEAD_DAYS, REFUND_APPROVAL_DAYS } from './approvalsSchema'
import type { ApprovalRequest, RefundTarget, RequestInput, RotaAsk } from './approvalsSchema'

/**
 * Stage 4: sign-offs for refunds, prices and the rota. The owner sets how much a general manager
 * (and, if they choose, a manager) may give back on one receipt; anything more waits as a request
 * for that receipt and amount, routed as every request is (approvals.ts). Approving moves no
 * money: it lets that refund be given back once, from the receipt, within REFUND_APPROVAL_DAYS of
 * the studio's days, while the receipt stays as it was. A new price for a treatment at one
 * location starts on its day by itself; a day on the rota changes as soon as it is approved.
 *
 * The server checks every rule here (server/routes/workspace.ts and payments.ts). The screens use
 * the same functions to say what will happen before anyone presses a button.
 */

const allRequests = (s: BusinessState): ApprovalRequest[] => operations(s).requests ?? []
const firstName = (name: string) => name.trim().split(/\s+/)[0]

/** The most this role may give back on one receipt without a sign-off; null means no limit. */
export function refundLimitFor(s: BusinessState, role: Role): number | null {
  const settings = operations(s).approvals
  if (role === 'general') return settings?.generalRefundLimitMinor ?? null
  if (role === 'manager') return settings?.managerRefundLimitMinor ?? null
  return null
}

/** Which rota changes by a general manager need a sign-off: none, extra days, or every change. */
export const rotaSignOff = (s: BusinessState) => operations(s).approvals?.rotaSignOff ?? null

/** The receipt a refund command or request is for, as one of its three kinds. */
export function refundTarget(command: {
  saleId?: string
  paymentId?: string
  counterSaleId?: string
}): RefundTarget {
  if (command.counterSaleId) return { counterSaleId: command.counterSaleId }
  if (command.saleId) return { saleId: command.saleId }
  return { paymentId: command.paymentId }
}
const sameTarget = (a: RefundTarget, b: RefundTarget) =>
  (a.saleId ?? '') === (b.saleId ?? '') &&
  (a.paymentId ?? '') === (b.paymentId ?? '') &&
  (a.counterSaleId ?? '') === (b.counterSaleId ?? '')

/** Money already given back on a receipt. */
export function refundedOn(s: BusinessState, target: RefundTarget) {
  return operations(s)
    .refunds.filter((r) =>
      target.counterSaleId
        ? r.counterSaleId === target.counterSaleId
        : target.saleId
          ? r.saleId === target.saleId
          : r.paymentId === target.paymentId,
    )
    .reduce((sum, r) => sum + r.amountMinor, 0)
}

/**
 * A receipt as a refund request describes it: where it was, what it can give back in all and
 * what has gone back already, its number and what was sold. `clientId` stays here, never in the
 * request, so the reason can be checked for the client's name and details.
 */
export function refundReceipt(s: BusinessState, target: RefundTarget) {
  const main = s.organisation.locationId
  const serviceName = (appointmentId: string) => {
    const visit = s.appointments.find((a) => a.id === appointmentId)
    return {
      visit,
      name:
        visit?.bookedServiceName ??
        s.services.find((x) => x.id === visit?.serviceId)?.name ??
        'A visit',
    }
  }
  if (target.counterSaleId) {
    const sale = (s.counterSales ?? []).find((x) => x.id === target.counterSaleId)
    if (!sale) return null
    const names = sale.retail.lines.map((line) => line.name)
    return {
      locationId: sale.locationId ?? main,
      paidMinor: sale.totalMinor,
      refundedMinor: refundedOn(s, target),
      receipt: sale.receiptNumber,
      what:
        (names.length > 2 ? `${names.slice(0, 2).join(', ')} and more` : names.join(' and ')).slice(
          0,
          200,
        ) || 'Products',
      clientId: sale.clientId,
      canReturn: true,
    }
  }
  if (target.saleId) {
    const sale = s.sales.find((x) => x.id === target.saleId)
    if (!sale) return null
    const { visit, name } = serviceName(sale.appointmentId)
    const products = sale.retail?.lines.length ?? 0
    return {
      locationId: visit?.locationId ?? main,
      paidMinor: refundableOnReceipt(sale),
      refundedMinor: refundedOn(s, target),
      receipt: sale.receiptNumber ?? 'Visit receipt',
      what: `${name}${products ? ` and ${products === 1 ? 'a product' : `${products} products`}` : ''}`.slice(
        0,
        200,
      ),
      clientId: visit?.clientId,
      canReturn: true,
    }
  }
  const paid = s.payments.find((x) => x.id === target.paymentId && x.kind !== 'settlement')
  if (!paid) return null
  const { visit, name } = serviceName(paid.appointmentId)
  return {
    locationId: visit?.locationId ?? main,
    paidMinor: paid.amountMinor,
    refundedMinor: refundedOn(s, target),
    receipt: paid.kind === 'deposit' ? 'Deposit' : 'Missed visit fee',
    what: name.slice(0, 200),
    clientId: visit?.clientId,
    // A deposit still counts toward its visit, so it goes back only once the visit is off.
    canReturn: paid.kind !== 'deposit' || visit?.status === 'cancelled',
  }
}

/** The last studio day an approved refund can still be given back. */
export function refundApprovalUntil(s: BusinessState, request: ApprovalRequest) {
  return request.decision
    ? addDays(businessDate(s, request.decision.at), REFUND_APPROVAL_DAYS)
    : null
}

export type RefundApproval =
  | 'waiting'
  | 'declined'
  /** Approved and still ready to give back. */
  | 'ready'
  /** Given back with this approval. */
  | 'used'
  /** Not given back in time. */
  | 'expired'
  /** The receipt had more given back after it was asked for. */
  | 'changed'

/** Where an approved refund stands, as of an instant. */
export function refundApproval(
  s: BusinessState,
  request: ApprovalRequest,
  asOf: string,
): RefundApproval {
  if (!request.decision) return 'waiting'
  if (request.decision.outcome === 'declined') return 'declined'
  if (request.carriedOut) return 'used'
  if (businessDate(s, asOf) > refundApprovalUntil(s, request)!) return 'expired'
  if (!request.refund || refundedOn(s, request.refund) !== request.refund.refundedMinor)
    return 'changed'
  return 'ready'
}

/** Refund requests for one receipt, newest first. */
export function refundRequestsFor(s: BusinessState, target: RefundTarget) {
  return allRequests(s)
    .filter((r) => r.kind === 'refund' && r.refund && sameTarget(r.refund, target))
    .sort((a, b) => b.raisedAt.localeCompare(a.raisedAt))
}

/** The approved request that lets exactly this refund go ahead now, if there is one. */
export function refundApprovalFor(
  s: BusinessState,
  target: RefundTarget,
  amountMinor: number,
  asOf: string,
) {
  return refundRequestsFor(s, target)
    .filter((r) => r.amountMinor === amountMinor && refundApproval(s, r, asOf) === 'ready')
    .sort((a, b) => a.raisedAt.localeCompare(b.raisedAt))[0]
}

/** Whether this refund, on top of what the receipt has given back already, is over the limit. */
export function refundOverLimit(
  s: BusinessState,
  role: Role,
  target: RefundTarget,
  amountMinor: number,
) {
  const limit = refundLimitFor(s, role)
  return limit !== null && refundedOn(s, target) + amountMinor > limit
}

/**
 * Why someone with a refund limit may not give this back yet, or null when they may: it is within
 * their limit, counting what the receipt has given back already, or an approval for this receipt
 * and exactly this amount is ready.
 */
export function refundRefusal(
  s: BusinessState,
  role: Role,
  target: RefundTarget,
  amountMinor: number,
  now: string,
): string | null {
  if (!refundOverLimit(s, role, target, amountMinor)) return null
  if (refundApprovalFor(s, target, amountMinor, now)) return null
  const org = s.organisation
  const asked = refundRequestsFor(s, target)
  const ready = asked.find((r) => refundApproval(s, r, now) === 'ready')
  if (ready && ready.amountMinor !== undefined)
    return `The sign-off for this receipt is for exactly ${money(ready.amountMinor, org, true)}. Give back that amount, or ask again.`
  if (asked.some((r) => !r.decision))
    return 'A refund on this receipt is waiting for a sign-off. It can be given back once it is approved.'
  const lapsed = asked.find(
    (r) =>
      r.amountMinor === amountMinor && ['expired', 'changed'].includes(refundApproval(s, r, now)),
  )
  if (lapsed)
    return refundApproval(s, lapsed, now) === 'expired'
      ? 'The sign-off for this refund has lapsed. Ask for a sign-off again from the receipt.'
      : 'More was given back on this receipt after the sign-off, so it has lapsed. Ask again from the receipt.'
  const limit = refundLimitFor(s, role)!
  const already = refundedOn(s, target)
  return already
    ? `This would take the money given back on this receipt to ${money(already + amountMinor, org, true)}, over the ${money(limit, org, true)} you can give back without a sign-off. Ask for a sign-off from the receipt first.`
    : `This is over the ${money(limit, org, true)} you can give back without a sign-off. Ask for a sign-off from the receipt first.`
}

/**
 * Stage 4 seam for a general manager's rota (Stage 4, item 3): whether this rota change needs a
 * sign-off under the owner's rule, before they save it. Extra days are days the person does not
 * usually work; "all" covers every change.
 */
export function rotaSignOffNeeded(s: BusinessState, command: Command, now: string) {
  const rule = rotaSignOff(s)
  if (!rule || !(ROTA_COMMANDS as readonly string[]).includes(command.type)) return false
  if (rule === 'all') return true
  if (command.type === 'rota-day')
    return (
      command.input.working &&
      changeKind(s, { staffId: command.input.staffId, date: command.input.date, working: true }) ===
        'extra'
    )
  if (command.type === 'rota-week-copy')
    return weekCopy(s, command.monday, businessDate(s, now)).copies.some(
      (copy) =>
        copy.plan.working &&
        changeKind(s, { staffId: copy.from.staffId, date: copy.date, working: true }) === 'extra',
    )
  return false
}

/**
 * Why this change by someone with a limit, or a general manager's rota change, needs a sign-off
 * first, or null when it can go ahead. The server checks it before every change.
 */
export function signOffRefusal(
  s: BusinessState,
  role: Role,
  command: Command,
  now: string,
): string | null {
  if (command.type === 'refund')
    return refundRefusal(s, role, refundTarget(command), command.amountMinor, now)
  if (role === 'general' && rotaSignOffNeeded(s, command, now))
    return command.type === 'rota-day' || command.type === 'rota-day-usual'
      ? 'This change to the rota needs a sign-off. Choose Ask for a sign-off to send it up.'
      : 'Copying or clearing a week takes in days that need a sign-off. Change each day on its own and ask for a sign-off.'
  return null
}

// What a request names, checked and described as it is raised.

/** Whether a reason names a client, so it can be kept from people who do not see clients. */
function namesClient(s: BusinessState, clientId: string | undefined, text: string) {
  const client = s.clients.find((c) => c.id === clientId)
  if (!client) return false
  const lower = text.toLocaleLowerCase()
  const words = client.name
    .split(/\s+/)
    .filter((word) => word.length >= 3)
    .map((word) => word.toLocaleLowerCase())
  const phone = client.phone.replace(/\D/g, '')
  const digits = text.replace(/\D/g, '')
  const escape = (word: string) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return (
    words.some((word) =>
      new RegExp(`(^|[^\\p{L}])${escape(word)}([^\\p{L}]|$)`, 'u').test(lower),
    ) ||
    (!!client.email && lower.includes(client.email.toLocaleLowerCase())) ||
    (phone.length >= 7 && digits.includes(phone.slice(-7)))
  )
}

/** A request that is still open: waiting for a decision, or approved and not yet carried out. */
function stillOpen(s: BusinessState, r: ApprovalRequest, now: string) {
  if (!r.decision) return true
  if (r.decision.outcome === 'declined' || r.carriedOut || r.notStarted) return false
  return r.kind === 'refund' ? refundApproval(s, r, now) === 'ready' : r.kind === 'price'
}

/** A day as the rota plans it, within the opening hours where it is. */
function plannedDay(s: BusinessState, staffId: string, date: string) {
  const planned = plannedHoursFor(s, staffId, date)
  const locationId = planned.locationId ?? s.organisation.locationId
  const venue = hoursFor(s, date, locationId)
  const open = Math.max(venue.open, planned.open)
  const close = Math.min(venue.close, planned.close)
  return !venue.closed && !planned.closed && close > open
    ? { working: true as const, open, close, locationId }
    : { working: false as const }
}
const dayValue = (day: ReturnType<typeof plannedDay>) =>
  day.working ? `${day.open}-${day.close}` : 'off'

/**
 * What a rota request would do, checked as if it were saved now: the day before and after, and
 * the location it is at. Throws the reason in plain words when it cannot be saved, or when it
 * would touch a day at another location.
 */
export function rotaAskOutcome(
  s: BusinessState,
  command: RotaAsk,
  locationId: string,
  now: string,
) {
  const staffId = command.type === 'rota-day' ? command.input.staffId : command.staffId
  const date = command.type === 'rota-day' ? command.input.date : command.date
  const person = s.staff.find((p) => p.id === staffId && !p.archived)
  if (!person) throw new Error('Choose someone on the team.')
  const trial = scheduleSnapshot(s)
  runRotaCommand(trial, command, now, () => 'proposed')
  const before = plannedDay(s, staffId, date)
  const after = plannedDay(trial, staffId, date)
  const place = placeOf(s, locationId)?.name ?? 'this location'
  if (
    (before.working && before.locationId !== locationId) ||
    (after.working && after.locationId !== locationId) ||
    (!before.working && !after.working)
  )
    throw new Error(
      `${firstName(person.name)} would not be working at ${place} that day, before or after. Ask for days at ${place} only.`,
    )
  return {
    staffId,
    staffName: firstName(person.name),
    date,
    before: dayValue(before),
    after: command.type === 'rota-day-usual' ? 'usual' : dayValue(after),
    change:
      command.type === 'rota-day-usual'
        ? ('usual' as const)
        : changeKind(s, { staffId, date, working: command.input.working }),
  }
}

/** A treatment's prices once one location's price changes, checked against the house rules. */
function pricedAt(
  s: BusinessState,
  service: BusinessState['services'][number],
  locationId: string,
  toMinor: number,
) {
  const main = s.organisation.locationId
  let priceMinor = service.priceMinor
  let rows = [...(service.locationPrices ?? [])]
  if (locationId === main) {
    // The main location's price is the house price. Every other location keeps the price it had.
    for (const place of places(s))
      if (
        !place.main &&
        offeredAt(service, place.id) &&
        !rows.some((r) => r.locationId === place.id)
      )
        rows.push({ locationId: place.id, priceMinor: service.priceMinor })
    priceMinor = toMinor
    rows = rows.filter((r) => r.priceMinor !== toMinor)
  } else {
    rows = rows.filter((r) => r.locationId !== locationId)
    if (toMinor !== service.priceMinor) rows.push({ locationId, priceMinor: toMinor })
  }
  const changed = { ...service, priceMinor, locationPrices: rows.length ? rows : undefined }
  if (service.depositMinor > toMinor)
    throw new Error(
      `The deposit for ${service.name} is ${money(service.depositMinor, s.organisation, true)}, more than the new price. Ask the owner to change the deposit first.`,
    )
  const rule = serviceRuleRefusal(s, changed)
  if (rule) throw new Error(rule)
  return changed
}

/** The treatment a price request is for, still on the menu at that location. */
function pricedService(s: BusinessState, serviceId: string, locationId: string) {
  const service = s.services.find((x) => x.id === serviceId)
  const place = placeOf(s, locationId)
  if (!service || service.archived) throw new Error('Choose a treatment on the menu.')
  if (!place || place.archived) throw new Error('That location is not open.')
  if (!offeredAt(service, locationId))
    throw new Error(`${place.name} does not offer ${service.name}.`)
  return { service, place }
}

/**
 * The details a request keeps from what was asked, checked against the studio now: the receipt
 * and amount of a refund, a treatment's new price, or a day on the rota. Throws a plain reason
 * when it cannot be asked for.
 */
export function prepareRequest(
  s: BusinessState,
  input: RequestInput,
  now: string,
): Pick<ApprovalRequest, 'title'> &
  Partial<Pick<ApprovalRequest, 'amountMinor' | 'note' | 'refund' | 'price' | 'rota'>> {
  const org = s.organisation
  const note = input.note ? { note: input.note } : {}
  if (input.kind === 'refund') {
    const target = input.refund!
    const receipt = refundReceipt(s, target)
    if (!receipt) throw new Error('That receipt is not in this business.')
    if (receipt.locationId !== input.locationId)
      throw new Error('That receipt is from another location.')
    if (!receipt.canReturn) throw new Error('Refund a deposit after the visit is cancelled.')
    const left = receipt.paidMinor - receipt.refundedMinor
    if (input.amountMinor! > left)
      throw new Error(
        left > 0
          ? `This receipt has ${money(left, org, true)} left to give back.`
          : 'Everything on this receipt has been given back already.',
      )
    if (namesClient(s, receipt.clientId, input.note ?? ''))
      throw new Error(
        'Leave the client’s name and details out of the reason. The person deciding sees the receipt, not the client.',
      )
    if (refundRequestsFor(s, target).some((r) => stillOpen(s, r, now)))
      throw new Error('This receipt already has a refund waiting for a sign-off or ready to give.')
    const { clientId: _client, canReturn: _canReturn, locationId: _at, ...shown } = receipt
    void [_client, _canReturn, _at]
    return {
      title: `Refund on ${receipt.receipt}`.slice(0, 80),
      amountMinor: input.amountMinor,
      ...note,
      refund: { ...target, ...shown },
    }
  }
  if (input.kind === 'price') {
    const { serviceId, priceMinor, startsOn } = input.price!
    const { service } = pricedService(s, serviceId, input.locationId)
    const today = businessDate(s, now)
    if (startsOn < today) throw new Error('Choose today or a day still to come.')
    if (startsOn > addDays(today, PRICE_AHEAD_DAYS))
      throw new Error('A new price can start up to a year ahead.')
    const fromMinor = serviceAt(service, input.locationId).priceMinor
    if (priceMinor === fromMinor)
      throw new Error(`${service.name} is ${money(fromMinor, org, true)} there already.`)
    pricedAt(s, service, input.locationId, priceMinor)
    if (
      allRequests(s).some(
        (r) =>
          r.kind === 'price' &&
          r.price?.serviceId === serviceId &&
          r.locationId === input.locationId &&
          stillOpen(s, r, now),
      )
    )
      throw new Error(`A new price for ${service.name} there is already waiting.`)
    return {
      title: `New price for ${service.name}`.slice(0, 80),
      ...note,
      price: { serviceId, serviceName: service.name, fromMinor, toMinor: priceMinor, startsOn },
    }
  }
  if (input.kind === 'rota') {
    const command = input.rota!
    const outcome = rotaAskOutcome(s, command, input.locationId, now)
    if (
      allRequests(s).some(
        (r) =>
          r.kind === 'rota' &&
          !r.decision &&
          r.rota?.staffId === outcome.staffId &&
          r.rota.date === outcome.date,
      )
    )
      throw new Error(`A change to ${outcome.staffName}’s day is already waiting for a sign-off.`)
    return {
      title: `Rota: ${outcome.staffName}, ${dateLabel(outcome.date, org.locale, true)}`.slice(
        0,
        80,
      ),
      ...note,
      rota: { command, ...outcome },
    }
  }
  return {
    title: input.title!,
    ...(input.amountMinor !== undefined ? { amountMinor: input.amountMinor } : {}),
    ...note,
  }
}

/** Writes an approved new price at its location. Throws why it cannot start. */
function startPriceNow(next: BusinessState, request: ApprovalRequest) {
  const ask = request.price!
  const { service, place } = pricedService(next, ask.serviceId, request.locationId)
  const now = serviceAt(service, request.locationId).priceMinor
  if (now !== ask.fromMinor)
    throw new Error(
      `The price of ${service.name} at ${place.name} has changed since this was asked, to ${money(now, next.organisation, true)}.`,
    )
  const changed = pricedAt(next, service, request.locationId, ask.toMinor)
  service.priceMinor = changed.priceMinor
  if (changed.locationPrices) service.locationPrices = changed.locationPrices
  else delete service.locationPrices
  return service.id
}

/**
 * Carries out an approved request where approving it is the change: a day on the rota, or a new
 * price whose day has come. A price for a later day waits for `startPrice`. Throws why it cannot
 * be done, so the person deciding can decline it instead.
 */
export function carryOut(
  next: BusinessState,
  requestId: string,
  now: string,
  makeId: () => string,
) {
  const find = () => (next.operations?.requests ?? []).find((r) => r.id === requestId)!
  const request = find()
  if (request.kind === 'rota' && request.rota) {
    // The rota is checked again now, and the change must still be at the request's location.
    rotaAskOutcome(next, request.rota.command, request.locationId, now)
    const recordId = runRotaCommand(next, request.rota.command, now, makeId)
    // Running the rota copies the studio's operations, so the request is looked up again.
    find().carriedOut = { at: now, recordId }
    return
  }
  if (
    request.kind === 'price' &&
    request.price &&
    request.price.startsOn <= businessDate(next, now)
  )
    request.carriedOut = { at: now, recordId: startPriceNow(next, request) }
}

/** Approved new prices whose day has come and that have not started, oldest first. */
export function duePrices(s: BusinessState, now: string) {
  const today = businessDate(s, now)
  return allRequests(s)
    .filter(
      (r) =>
        r.kind === 'price' &&
        r.decision?.outcome === 'approved' &&
        !r.carriedOut &&
        !r.notStarted &&
        r.price &&
        r.price.startsOn <= today,
    )
    .sort((a, b) => a.price!.startsOn.localeCompare(b.price!.startsOn))
}

/**
 * Starts an approved new price on its day: the server sends `request-start` once the day has
 * come. A price that cannot start (the treatment left the menu, the location closed, the price was
 * changed by hand meanwhile, a house rule) is marked with why, for the owner to see.
 */
export function startPrice(next: BusinessState, requestId: string, now: string) {
  const request = (next.operations?.requests ?? []).find((r) => r.id === requestId)
  if (!request || request.kind !== 'price' || !request.price)
    throw new Error('That new price is not in this business.')
  if (request.decision?.outcome !== 'approved') throw new Error('That new price was not approved.')
  if (request.carriedOut || request.notStarted) return request.id
  if (request.price.startsOn > businessDate(next, now))
    throw new Error('That new price starts on a later day.')
  try {
    request.carriedOut = { at: now, by: 'SALEANE', recordId: startPriceNow(next, request) }
  } catch (error) {
    request.notStarted = {
      at: now,
      reason: (error instanceof Error ? error.message : 'It could not start.').slice(0, 300),
    }
  }
  return request.id
}

/**
 * After a refund is recorded, the approval it used is marked as given back, so it is never used
 * again. `before` is the studio before the refund; `asOf` is when the refund was started, which
 * for a card refund is when the desk asked the card company.
 */
export function spendRefundApproval(
  before: BusinessState,
  next: BusinessState,
  command: Extract<Command, { type: 'refund' }>,
  refundId: string,
  now: string,
  asOf = now,
) {
  if (operations(before).refunds.some((r) => r.id === refundId)) return
  const approval = refundApprovalFor(before, refundTarget(command), command.amountMinor, asOf)
  if (!approval) return
  const request = (next.operations?.requests ?? []).find((r) => r.id === approval.id)
  if (request) request.carriedOut = { at: now, recordId: refundId }
}

// In words, for the screens and the change record.

/** "09:00 to 17:00", "not working" or "their usual hours". */
export function dayWords(value: string, locale: string) {
  if (value === 'off') return 'not working'
  if (value === 'usual') return 'their usual hours'
  const [open, close] = value.split('-').map(Number)
  const clock = (m: number) => (m >= 1440 ? 'midnight' : timeLabel(m, locale))
  return `${clock(open)} to ${clock(close)}`
}

const CHANGE_WORDS: Record<NonNullable<ApprovalRequest['rota']>['change'], string> = {
  hours: 'other hours',
  extra: 'an extra day',
  off: 'a day off',
  usual: 'back to their usual day',
}

/**
 * What the screens need to describe a request. A regional manager's area has no studio record,
 * so it is worked out from the request alone there; the studio's own pages pass where an
 * approved refund stands and its last day from `requestContext`.
 */
export type RequestContext = {
  org: Pick<BusinessState['organisation'], 'locale' | 'currency'>
  /** The studio's today. */
  today: string
  /** The location's name. */
  place: string
  standing?: RefundApproval
  until?: string
}

/** The context for a request on the studio's own pages, with the studio record at hand. */
export function requestContext(
  s: BusinessState,
  request: ApprovalRequest,
  now: string,
): RequestContext {
  return {
    org: s.organisation,
    today: businessDate(s, now),
    place: placeOf(s, request.locationId)?.name ?? 'A closed location',
    ...(request.kind === 'refund'
      ? {
          standing: refundApproval(s, request, now),
          until: refundApprovalUntil(s, request) ?? undefined,
        }
      : {}),
  }
}

/** The last day an approved refund can be given back, and where it stands. */
function refundStanding(request: ApprovalRequest, ctx: RequestContext) {
  const until =
    ctx.until ??
    (request.decision ? addDays(request.decision.at.slice(0, 10), REFUND_APPROVAL_DAYS) : '')
  const standing: RefundApproval =
    ctx.standing ??
    (!request.decision
      ? 'waiting'
      : request.decision.outcome === 'declined'
        ? 'declined'
        : request.carriedOut
          ? 'used'
          : ctx.today > until
            ? 'expired'
            : 'ready')
  return { until, standing }
}

/**
 * What is asked, in one line: "R-1042 · Skin Renewal Facial · £60.00 back of £120.00",
 * "£95.00 now, £105.00 from Sun 1 Nov", "Mon 12 Oct · not working now, 10:00 to 16:00 asked".
 */
export function requestSummary(request: ApprovalRequest, ctx: RequestContext) {
  const { org } = ctx
  const cash = (n: number) => money(n, org, true)
  if (request.kind === 'refund' && request.refund && request.amountMinor !== undefined) {
    const r = request.refund
    return `${r.receipt} · ${r.what} · ${cash(request.amountMinor)} back of ${cash(r.paidMinor)} paid`
  }
  if (request.kind === 'price' && request.price) {
    const p = request.price
    return `${cash(p.fromMinor)} now, ${cash(p.toMinor)} from ${dateLabel(p.startsOn, org.locale, true)}`
  }
  if (request.kind === 'rota' && request.rota) {
    const r = request.rota
    return `${r.staffName} · ${dateLabel(r.date, org.locale, true)} · ${dayWords(r.before, org.locale)} now, ${dayWords(r.after, org.locale)} asked`
  }
  return request.amountMinor !== undefined ? money(request.amountMinor, org) : null
}

/** What is asked, line by line, with the money, price or hours before and after. */
export function requestRows(request: ApprovalRequest, ctx: RequestContext) {
  const { org } = ctx
  const cash = (n: number) => money(n, org, true)
  if (request.kind === 'refund' && request.refund && request.amountMinor !== undefined) {
    const r = request.refund
    return [
      { label: 'Receipt', value: r.receipt },
      { label: 'For', value: r.what },
      { label: 'Paid', value: cash(r.paidMinor) },
      { label: 'Given back before', value: cash(r.refundedMinor) },
      { label: 'To give back', value: cash(request.amountMinor) },
    ]
  }
  if (request.kind === 'price' && request.price) {
    const p = request.price
    return [
      { label: 'Treatment', value: `${p.serviceName} at ${ctx.place}` },
      { label: 'Price now', value: cash(p.fromMinor) },
      { label: 'New price', value: cash(p.toMinor) },
      { label: 'Starts', value: dateLabel(p.startsOn, org.locale) },
    ]
  }
  if (request.kind === 'rota' && request.rota) {
    const r = request.rota
    return [
      { label: 'Who', value: r.staffName },
      { label: 'Day', value: dateLabel(r.date, org.locale) },
      { label: 'Now', value: dayWords(r.before, org.locale) },
      { label: 'Asked for', value: `${dayWords(r.after, org.locale)} (${CHANGE_WORDS[r.change]})` },
    ]
  }
  return request.amountMinor !== undefined
    ? [{ label: 'Cost', value: money(request.amountMinor, org) }]
    : []
}

/**
 * What approving a waiting request will do, in one sentence. Never claims money moves: approving
 * a refund only lets it be given back.
 */
export function onApproval(request: ApprovalRequest, ctx: RequestContext, raiser = 'They') {
  const { org, place } = ctx
  if (request.kind === 'refund' && request.amountMinor !== undefined)
    return `Approving moves no money. ${raiser} can then give back ${money(request.amountMinor, org, true)} from this receipt once, within ${REFUND_APPROVAL_DAYS} days.`
  if (request.kind === 'price' && request.price)
    return request.price.startsOn <= ctx.today
      ? `The price at ${place} changes as soon as it is approved. Visits already booked keep their price.`
      : `The price at ${place} changes by itself on ${dateLabel(request.price.startsOn, org.locale)}. Visits already booked keep their price.`
  if (request.kind === 'rota') return 'The rota changes as soon as it is approved.'
  if (request.kind === 'spend')
    return 'Approving records the decision. SALEANE does not pay for anything.'
  return 'Approving records the decision for the location to act on.'
}

/** What became of an approved request, in one sentence, or null when there is nothing to add. */
export function afterApproval(request: ApprovalRequest, ctx: RequestContext) {
  if (request.decision?.outcome !== 'approved') return null
  const locale = ctx.org.locale
  const day = (iso: string) => dateLabel(iso.slice(0, 10), locale)
  if (request.kind === 'refund') {
    const { until, standing } = refundStanding(request, ctx)
    if (standing === 'used') return `Given back on ${day(request.carriedOut!.at)}.`
    if (standing === 'expired')
      return `Lapsed: it was not given back by ${dateLabel(until, locale)}.`
    if (standing === 'changed')
      return 'Lapsed: more was given back on the receipt after it was asked for.'
    return `Can be given back once, from the receipt, until ${dateLabel(until, locale)}.`
  }
  if (request.kind === 'price' && request.price) {
    if (request.carriedOut) return `The new price started on ${day(request.carriedOut.at)}.`
    if (request.notStarted)
      return `It did not start on ${dateLabel(request.price.startsOn, locale)}: ${request.notStarted.reason}`
    return `Starts by itself on ${dateLabel(request.price.startsOn, locale)}.`
  }
  if (request.kind === 'rota' && request.carriedOut) return 'The rota shows the change.'
  return null
}

/**
 * For who changed what: an approved price or rota change keeps the treatment, location and
 * prices, or the person, day and hours, before and after. Null for anything else.
 */
export function signOffChangeDetail(
  before: BusinessState,
  after: BusinessState,
  action: string,
  recordId: string,
) {
  if (action !== 'request-decide' && action !== 'request-start') return null
  const request = (after.operations?.requests ?? []).find((r) => r.id === recordId)
  if (!request) return null
  const was = (before.operations?.requests ?? []).find((r) => r.id === recordId)
  const outcome =
    action === 'request-decide' && request.decision
      ? [{ f: 'outcome', to: request.decision.outcome }]
      : []
  const amount =
    action === 'request-decide' && request.amountMinor !== undefined
      ? [{ f: 'amountMinor', to: request.amountMinor }]
      : []
  const started = request.carriedOut && !was?.carriedOut
  if (request.kind === 'price' && request.price) {
    const p = request.price
    return {
      fields: [
        ...outcome,
        { f: 'serviceId', to: p.serviceId },
        { f: 'locationId', to: request.locationId },
        started
          ? { f: 'priceMinor', from: p.fromMinor, to: p.toMinor }
          : { f: 'newPriceMinor', to: p.toMinor },
        { f: 'startsOn', to: p.startsOn },
        ...(request.notStarted && !was?.notStarted ? [{ f: 'notStarted', to: true }] : []),
      ],
    }
  }
  if (request.kind === 'rota' && request.rota) {
    const r = request.rota
    return {
      fields: [
        ...outcome,
        { f: 'staffId', to: r.staffId },
        { f: 'date', to: r.date },
        ...(started ? [{ f: 'shift', from: r.before, to: r.after }] : []),
      ],
    }
  }
  return outcome.length || amount.length ? { fields: [...outcome, ...amount] } : null
}
