import type { BusinessState } from './model'
import { operations } from './operations'
import { giftHome, placeOf } from './locations'
import { PRINTER_PORT, printerHost, printerHostProblem, printerPortProblem } from './lanAddress'
import { TAX_NUMBER } from './tillSchema'
import type { TillPrinter, TillPrinterInput } from './tillSchema'
import type { ReceiptKind } from './receipt'

/**
 * Stage 2: the till. Each location prints receipts one way (see tillSchema). A cash drawer is
 * plugged into a receipt printer's drawer port, so SALEANE can open it only through a network
 * printer, or pretend to through the test printer. The server opens it when cash is recorded and
 * keeps every opening; this file holds the rules both sides share.
 */

/** Until a location chooses otherwise: the computer's print window, on 80 mm paper. */
export const DEFAULT_PRINTER: TillPrinterInput = { mode: 'browser', paper: '80', drawer: false }

/** How a location's receipts print. */
export function tillPrinter(s: BusinessState, locationId?: string | null): TillPrinter {
  const main = s.organisation.locationId
  const where = locationId ?? main
  return (
    (operations(s).till?.printers ?? []).find((p) => (p.locationId ?? main) === where) ?? {
      ...DEFAULT_PRINTER,
    }
  )
}

/** Whether SALEANE opens this location's cash drawer by itself when cash is recorded. */
export const drawerConnected = (printer: Pick<TillPrinterInput, 'mode' | 'drawer'>) =>
  printer.mode !== 'browser' && printer.drawer

export const BROWSER_DRAWER =
  'The computer’s print window cannot open a cash drawer. To open the drawer automatically, connect a network receipt printer.'

/** Why a printer setting cannot be kept, or null. */
export function printerProblem(printer: TillPrinterInput): string | null {
  if (printer.mode === 'network') {
    const host = printerHostProblem(printer.host ?? '')
    if (host) return host
    return printerPortProblem(printer.port ?? PRINTER_PORT)
  }
  if (printer.host !== undefined || printer.port !== undefined)
    return 'Only a network printer has an address.'
  if (printer.mode === 'browser' && printer.drawer) return BROWSER_DRAWER
  return null
}

/** Why a VAT number or tax ID cannot be printed, or null. */
export function taxNumberProblem(value: string, region: 'UK' | 'US') {
  return TAX_NUMBER.test(value)
    ? null
    : region === 'UK'
      ? 'Enter the VAT number as it appears on your registration, such as GB 123 4567 89.'
      : 'Enter the tax ID as it appears on your registration, such as 12-3456789.'
}

/** Applies the till-settings command to `next`, the working copy inside `execute`. */
export function runTillCommand(
  next: BusinessState,
  command: {
    locationId?: string
    printer: TillPrinterInput
    taxNumber?: string
  },
) {
  const main = next.organisation.locationId
  const site = placeOf(next, command.locationId)
  if (!site || site.archived) throw new Error('Choose an open location.')
  const input = command.printer
  const printer: TillPrinterInput = {
    mode: input.mode,
    paper: input.paper,
    // A browser cannot reach a drawer, so the choice is kept off rather than refused.
    drawer: input.mode !== 'browser' && input.drawer,
    ...(input.mode === 'network'
      ? { host: printerHost(input.host ?? ''), port: input.port ?? PRINTER_PORT }
      : {}),
  }
  const problem = printerProblem(printer)
  if (problem) throw new Error(problem)
  next.operations ??= operations(next)
  const till = next.operations.till ?? { printers: [] }
  const taxNumber =
    command.taxNumber === undefined ? till.taxNumber : command.taxNumber.trim() || undefined
  if (taxNumber) {
    const refused = taxNumberProblem(taxNumber, next.organisation.region)
    if (refused) throw new Error(refused)
  }
  next.operations.till = {
    printers: [
      ...till.printers.filter((p) => (p.locationId ?? main) !== site.id),
      { ...printer, ...(site.id !== main ? { locationId: site.id } : {}) },
    ],
    ...(taxNumber ? { taxNumber } : {}),
  }
  return site.id
}

/** Validation for parseState: one printer per location, each one usable. */
export function tillProblem(s: BusinessState): string | null {
  const till = operations(s).till
  if (!till) return null
  const main = s.organisation.locationId
  const seen = new Set<string>()
  for (const printer of till.printers) {
    // The main location stays unnamed, as everywhere else.
    if (printer.locationId === main || !placeOf(s, printer.locationId))
      return 'A receipt printer belongs to a location that does not exist.'
    const where = printer.locationId ?? main
    if (seen.has(where)) return 'A location has two receipt printers.'
    seen.add(where)
    const problem = printerProblem(printer)
    if (problem) return problem
  }
  if (till.taxNumber !== undefined && taxNumberProblem(till.taxNumber, s.organisation.region))
    return 'Invalid VAT number or tax ID.'
  return null
}

const CASH = new Set(['cash', 'demo_cash'])

/** Cash that went into or out of the drawer with one saved change. */
export type CashMovement = {
  /** `cash` for money taken, `refund` for money handed back. */
  cause: 'cash' | 'refund'
  /** The receipt it belongs to ("visit:…"), or a deposit or fee payment ("payment:…"). */
  receipt: string
  kind: ReceiptKind | 'payment'
  number?: string
  locationId: string
  amountMinor: number
}

/**
 * The cash recorded by one change: checkouts, walk-in sales, gift cards, plan payments, deposits
 * and fees taken in cash, and refunds handed back in cash. Pure, so the server can compare the
 * record before and after each save and open the drawer exactly when cash was recorded.
 */
export function cashTaken(before: BusinessState, after: BusinessState): CashMovement[] {
  const main = after.organisation.locationId
  const out: CashMovement[] = []
  const had = <T extends { id: string }>(rows: T[] | undefined) =>
    new Set((rows ?? []).map((r) => r.id))
  const visitPlace = (appointmentId: string) =>
    after.appointments.find((a) => a.id === appointmentId)?.locationId ?? main
  const sales = had(before.sales)
  for (const sale of after.sales)
    if (!sales.has(sale.id) && CASH.has(sale.method) && sale.balanceMinor > 0)
      out.push({
        cause: 'cash',
        receipt: `visit:${sale.id}`,
        kind: 'visit',
        ...(sale.receiptNumber ? { number: sale.receiptNumber } : {}),
        locationId: visitPlace(sale.appointmentId),
        amountMinor: sale.balanceMinor,
      })
  const counter = had(before.counterSales)
  for (const sale of after.counterSales ?? [])
    if (!counter.has(sale.id) && CASH.has(sale.method) && sale.totalMinor > 0)
      out.push({
        cause: 'cash',
        receipt: `walk-in:${sale.id}`,
        kind: 'walk-in',
        number: sale.receiptNumber,
        locationId: sale.locationId ?? main,
        amountMinor: sale.totalMinor,
      })
  const cards = new Map((before.giftCards ?? []).map((c) => [c.id, c]))
  for (const [index, card] of (after.giftCards ?? []).entries()) {
    const old = cards.get(card.id)
    if (!old && CASH.has(card.payment.method) && card.payment.amountMinor > 0)
      out.push({
        cause: 'cash',
        receipt: `gift-card:${card.id}`,
        kind: 'gift-card',
        number: `GC-${index + 1}`,
        locationId: card.locationId ?? main,
        amountMinor: card.payment.amountMinor,
      })
    // Stage 4: money returned leaves the drawer where the card belongs now.
    const refunded = new Set((old?.refunds ?? []).map((r) => r.id))
    for (const refund of card.refunds)
      if (!refunded.has(refund.id) && CASH.has(refund.method))
        out.push({
          cause: 'refund',
          receipt: `gift-card:${card.id}`,
          kind: 'gift-card',
          number: `GC-${index + 1}`,
          locationId: giftHome(after, card),
          amountMinor: refund.amountMinor,
        })
  }
  const plans = new Map((before.holdings ?? []).map((h) => [h.id, h]))
  for (const [index, holding] of (after.holdings ?? []).entries()) {
    const old = plans.get(holding.id)
    const paid = new Set((old?.payments ?? []).map((p) => p.id))
    for (const [n, payment] of holding.payments.entries())
      if (!paid.has(payment.id) && CASH.has(payment.method) && payment.amountMinor > 0)
        out.push({
          cause: 'cash',
          receipt: `plan:${holding.id}:${payment.id}`,
          kind: 'plan',
          number: n === 0 ? `PL-${index + 1}` : `PL-${index + 1}-${n + 1}`,
          locationId: holding.locationId ?? main,
          amountMinor: payment.amountMinor,
        })
    const refunded = new Set((old?.refunds ?? []).map((r) => r.id))
    for (const refund of holding.refunds)
      if (!refunded.has(refund.id) && CASH.has(refund.method))
        out.push({
          cause: 'refund',
          receipt: `plan:${holding.id}:${holding.payments[0]?.id ?? ''}`,
          kind: 'plan',
          number: `PL-${index + 1}`,
          locationId: holding.locationId ?? main,
          amountMinor: refund.amountMinor,
        })
  }
  const payments = had(before.payments)
  for (const payment of after.payments)
    if (
      !payments.has(payment.id) &&
      payment.kind !== 'settlement' &&
      CASH.has(payment.method) &&
      payment.amountMinor > 0
    )
      out.push({
        cause: 'cash',
        receipt: `payment:${payment.id}`,
        kind: 'payment',
        locationId: visitPlace(payment.appointmentId),
        amountMinor: payment.amountMinor,
      })
  const refunds = had(before.operations?.refunds)
  for (const refund of after.operations?.refunds ?? []) {
    if (refunds.has(refund.id)) continue
    const sale = refund.saleId ? after.sales.find((x) => x.id === refund.saleId) : undefined
    const walkIn = refund.counterSaleId
      ? (after.counterSales ?? []).find((x) => x.id === refund.counterSaleId)
      : undefined
    const paid = refund.paymentId
      ? after.payments.find((x) => x.id === refund.paymentId)
      : undefined
    // An older refund without a method follows its receipt.
    const method = refund.method ?? sale?.method ?? walkIn?.method ?? paid?.method
    if (!method || !CASH.has(method)) continue
    out.push({
      cause: 'refund',
      ...(sale
        ? {
            receipt: `visit:${sale.id}`,
            kind: 'visit' as const,
            ...(sale.receiptNumber ? { number: sale.receiptNumber } : {}),
            locationId: visitPlace(sale.appointmentId),
          }
        : walkIn
          ? {
              receipt: `walk-in:${walkIn.id}`,
              kind: 'walk-in' as const,
              number: walkIn.receiptNumber,
              locationId: walkIn.locationId ?? main,
            }
          : {
              receipt: `payment:${refund.paymentId}`,
              kind: 'payment' as const,
              locationId: visitPlace(paid?.appointmentId ?? ''),
            }),
      amountMinor: refund.amountMinor,
    })
  }
  return out
}

/** What happened when SALEANE asked a printer to print or open its drawer. */
export const tillStatuses = ['pending', 'sending', 'sent', 'test', 'failed', 'skipped'] as const
export type TillStatus = (typeof tillStatuses)[number]

/** One time the cash drawer was asked to open. */
export type DrawerOpening = {
  cause: 'cash' | 'refund' | 'no_sale'
  status: TillStatus
  actorName: string
  reason?: string | null
}

const times = (n: number) => (n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`)
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
/** "Change for a £20" reads "change for a £20" inside a sentence; "ATM run" stays as it is. */
const inSentence = (text?: string | null) =>
  !text ? '' : /^[A-Z][a-z]/.test(text) ? text[0].toLowerCase() + text.slice(1) : text
function reasons(openings: DrawerOpening[]) {
  const parts: string[] = []
  const cash = openings.filter((o) => o.cause === 'cash').length
  const refunds = openings.filter((o) => o.cause === 'refund').length
  const noSale = openings.filter((o) => o.cause === 'no_sale')
  if (cash) parts.push(count(cash, 'cash payment', 'cash payments'))
  if (refunds) parts.push(count(refunds, 'cash refund', 'cash refunds'))
  if (noSale.length === 1)
    parts.push(`1 no sale by ${noSale[0].actorName}: ${inSentence(noSale[0].reason)}`)
  else if (noSale.length)
    parts.push(
      `${noSale.length} no sales (${noSale.map((o) => `${o.actorName}: ${inSentence(o.reason)}`).join('; ')})`,
    )
  return parts.join(', ')
}

/**
 * The till count's sentence about the drawer for one day, such as "The drawer opened 4 times: 3
 * cash payments, 1 no sale by Maya: change for a £20." Openings sent to a test printer are told
 * apart, since no drawer opened, and so are any the printer did not answer.
 */
export function drawerSummary(openings: DrawerOpening[]) {
  const real = openings.filter((o) => o.status === 'sent')
  const test = openings.filter((o) => o.status === 'test')
  const missed = openings.filter((o) => o.status === 'failed' || o.status === 'sending')
  const sentences: string[] = []
  if (real.length) sentences.push(`The drawer opened ${times(real.length)}: ${reasons(real)}.`)
  if (test.length)
    sentences.push(
      `${real.length ? 'The test drawer would also have opened' : 'The test drawer would have opened'} ${times(test.length)}: ${reasons(test)}.`,
    )
  if (missed.length)
    sentences.push(
      `${missed.length === 1 ? 'Once' : `${missed.length} times`} the printer did not answer, so the drawer may not have opened.`,
    )
  return sentences.length ? sentences.join(' ') : 'The drawer has not been opened through SALEANE.'
}

/** A no-sale reason: short, and about the cash, such as "Change for a £20". */
export function noSaleProblem(reason: string) {
  const text = reason.trim()
  if (text.length < 3) return 'Say briefly why the drawer is opening, such as “Change for a £20”.'
  if (text.length > 80) return 'Keep the reason short, up to 80 characters.'
  return null
}
