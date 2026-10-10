import type { BusinessState } from './model'
import { addDays } from './format'
import { operations } from './operations'
import { retailRevenue } from './retail'
import { renterCounterSale, renterPartOfReceipt, renterVisit, serviceRevenue } from './takings'
import { recordDay } from './tillCount'
import { csvAmount, csvRows } from './csv'
import { ACCOUNTING_EXPORT_LIMIT } from './accountsSchema'
import { otherTillSales, renterTillPart, tillDay, tillParts } from './otherTill'
import type { AccountCodes, AccountingProvider } from './accountsSchema'

/**
 * V2: what the accountant needs for a period. Every figure comes from records SALEANE already
 * keeps; nothing here moves money. Days are the studio's own days, by when money was taken.
 *
 * Stage 3: a renter's own takings pass through the studio's till but are not the studio's income.
 * Money in and out and the sales list keep every receipt (the sales list says how much of each is
 * a renter's); the day summary, the journal and the tax summary keep a renter's takings apart, as
 * money held for renters, and count their rent as the studio's income.
 *
 * Stage 5: a sale from a chain's own till is money the studio took on that till. It is in money in
 * and out under its own kind and payment words (so it never reads as a payment SALEANE took), in
 * the sales list as a receipt from that till, and in the tax summary and day summary like any
 * other receipt. A refund from that till is money given back on it.
 */

export const METHOD_WORDS: Record<string, string> = {
  demo_card: 'Demo card',
  demo_cash: 'Demo cash',
  cash: 'Cash',
  external_card: 'Own card terminal',
  card: 'Card through SALEANE',
  previous_system: 'Paid before switching',
  bank_transfer: 'Bank transfer',
  // Stage 5: taken or given back on a chain's own till, never by SALEANE.
  other_till_cash: 'Cash on another till',
  other_till_card: 'Card on another till',
  other_till_other: 'Other, on another till',
  other_till_split: 'Split, on another till',
}

/** Stage 5: the payment words for a sale from another till. */
export const tillMethod = (payments: { method: string }[]) =>
  payments.length === 1 ? `other_till_${payments[0].method}` : 'other_till_split'

export type MoneyRow = {
  date: string
  kind: string
  reference: string
  client: string
  method: string
  /** Money in is positive, money given back negative. */
  amountMinor: number
  /** A card payment taken in the provider's test mode moved no real money. */
  test: boolean
}

function between(from: string, to: string) {
  return (date: string) => date >= from && date <= to
}

/** Every payment taken and every refund given in the period, oldest first. */
export function moneyInAndOut(s: BusinessState, from: string, to: string): MoneyRow[] {
  const inPeriod = between(from, to)
  const o = operations(s)
  const clientName = (id?: string) => s.clients.find((c) => c.id === id)?.name ?? ''
  const visitClient = (appointmentId: string) =>
    clientName(s.appointments.find((a) => a.id === appointmentId)?.clientId)
  const receiptOf = (saleId?: string) => s.sales.find((x) => x.id === saleId)?.receiptNumber
  const rows: MoneyRow[] = []
  const push = (row: Omit<MoneyRow, 'date'> & { at: string }) => {
    const date = recordDay(s, row.at)
    if (!inPeriod(date)) return
    const { at: _at, ...rest } = row
    void _at
    rows.push({ date, ...rest })
  }
  const KIND = { deposit: 'Deposit', settlement: 'Visit payment', fee: 'No-show or late fee' }
  for (const p of s.payments)
    push({
      at: p.recordedAt,
      kind: KIND[p.kind],
      reference: receiptOf(p.saleId) ?? p.reference ?? '',
      client: visitClient(p.appointmentId),
      method: p.method,
      amountMinor: p.amountMinor,
      test: p.method.startsWith('demo_') || p.processor?.live === false,
    })
  for (const h of s.holdings ?? []) {
    for (const p of h.payments)
      push({
        at: p.recordedAt,
        kind: h.kind === 'membership' ? 'Membership' : 'Package',
        reference: p.reference ?? h.name,
        client: clientName(h.clientId),
        method: p.method,
        amountMinor: p.amountMinor,
        // Stage 1: a membership month the provider took from the card in its test mode.
        test: p.method.startsWith('demo_') || p.processor?.live === false,
      })
    for (const r of h.refunds)
      push({
        at: r.createdAt,
        kind: h.kind === 'membership' ? 'Membership refund' : 'Package refund',
        reference: r.reference,
        client: clientName(h.clientId),
        method: r.method,
        amountMinor: -r.amountMinor,
        test: r.method.startsWith('demo_') || r.processor?.live === false,
      })
  }
  for (const sale of s.counterSales ?? [])
    push({
      at: sale.paidAt,
      kind: 'Products without a visit',
      reference: sale.receiptNumber,
      client: clientName(sale.clientId),
      method: sale.method,
      amountMinor: sale.totalMinor,
      test: sale.method.startsWith('demo_'),
    })
  for (const r of o.refunds) {
    const sale = s.sales.find((x) => x.id === r.saleId)
    const counter = (s.counterSales ?? []).find((x) => x.id === r.counterSaleId)
    const payment = s.payments.find((x) => x.id === r.paymentId)
    const method = r.method ?? sale?.method ?? counter?.method ?? payment?.method ?? 'cash'
    push({
      at: r.createdAt,
      kind: 'Refund',
      reference: sale?.receiptNumber ?? counter?.receiptNumber ?? r.reference,
      client: sale
        ? visitClient(sale.appointmentId)
        : counter
          ? clientName(counter.clientId)
          : payment
            ? visitClient(payment.appointmentId)
            : '',
      method,
      amountMinor: -r.amountMinor,
      test: method.startsWith('demo_') || r.processor?.live === false,
    })
  }
  // Stage 5: each payment on another till, and each amount given back on it, as its own row.
  for (const sale of otherTillSales(s))
    for (const p of sale.payments)
      push({
        at: sale.occurredAt,
        kind: sale.kind === 'sale' ? 'Sale on another till' : 'Given back on another till',
        reference: `${sale.receipt} (${sale.till.name})`,
        client: '',
        method: `other_till_${p.method}`,
        amountMinor: sale.kind === 'sale' ? p.amountMinor : -p.amountMinor,
        test: false,
      })
  const renter = (rentalId: string) =>
    s.staff.find((p) => p.id === o.rentals?.find((r) => r.id === rentalId)?.staffId)?.name ?? ''
  for (const p of o.rentPayments ?? [])
    push({
      at: p.paidAt,
      kind: 'Chair or room rent',
      reference: p.reference ?? '',
      client: renter(p.rentalId),
      method: p.method,
      amountMinor: p.amountMinor,
      test: false,
    })
  return rows.sort((a, b) => a.date.localeCompare(b.date))
}

export type SaleRow = {
  date: string
  receipt: string
  client: string
  servicesMinor: number
  discountMinor: number
  productsMinor: number
  taxMinor: number
  tipMinor: number
  totalMinor: number
  depositAppliedMinor: number
  planCoveredMinor: number
  method: string
  /** Stage 3: the part of the receipt that is a renter's own takings, with its tax. */
  renter?: { name: string; servicesMinor: number; productsMinor: number; taxMinor: number }
  /** Stage 5: the software whose till took it, for a sale sent in from another till. */
  source?: string
}

const renterName = (s: BusinessState, staffId: string) =>
  s.staff.find((p) => p.id === staffId)?.name ?? 'A renter'

/** Every receipt in the period, with and without a visit, by the day it was paid. */
export function salesByReceipt(s: BusinessState, from: string, to: string): SaleRow[] {
  const inPeriod = between(from, to)
  const clientName = (id?: string) => s.clients.find((c) => c.id === id)?.name ?? ''
  const rows: SaleRow[] = []
  for (const sale of s.sales) {
    const date = recordDay(s, sale.paidAt)
    if (!inPeriod(date)) continue
    const visit = s.appointments.find((a) => a.id === sale.appointmentId)
    const part = visit && renterVisit(s, visit) ? renterPartOfReceipt(s, sale, visit) : undefined
    rows.push({
      date,
      receipt: sale.receiptNumber ?? '',
      client: clientName(visit?.clientId),
      servicesMinor: serviceRevenue(sale),
      discountMinor: sale.discountMinor ?? 0,
      productsMinor: retailRevenue(sale),
      taxMinor: (sale.taxMinor ?? 0) + (sale.retail?.taxMinor ?? 0),
      tipMinor: sale.tipMinor,
      totalMinor: sale.totalMinor,
      depositAppliedMinor: sale.depositAppliedMinor,
      planCoveredMinor: sale.coveredMinor ?? 0,
      method: sale.method,
      ...(part && visit ? { renter: { name: renterName(s, visit.staffId), ...part } } : {}),
    })
  }
  for (const sale of s.counterSales ?? []) {
    const date = recordDay(s, sale.paidAt)
    if (!inPeriod(date)) continue
    const theirs = renterCounterSale(s, sale)
    rows.push({
      date,
      receipt: sale.receiptNumber,
      client: clientName(sale.clientId),
      servicesMinor: 0,
      discountMinor: 0,
      productsMinor: retailRevenue(sale),
      taxMinor: sale.retail.taxMinor,
      tipMinor: 0,
      totalMinor: sale.totalMinor,
      depositAppliedMinor: 0,
      planCoveredMinor: 0,
      method: sale.method,
      ...(theirs
        ? {
            renter: {
              name: renterName(s, theirs.staffId),
              servicesMinor: 0,
              productsMinor: retailRevenue(sale),
              taxMinor: sale.retail.taxMinor,
            },
          }
        : {}),
    })
  }
  for (const sale of otherTillSales(s)) {
    if (sale.kind !== 'sale') continue
    const date = tillDay(s, sale)
    if (!inPeriod(date)) continue
    const parts = tillParts(sale)
    const theirs = renterTillPart(s, sale)
    rows.push({
      date,
      receipt: sale.receipt,
      client: '',
      servicesMinor: parts.treatmentsMinor,
      discountMinor: 0,
      productsMinor: parts.productsMinor,
      taxMinor: parts.taxMinor,
      tipMinor: 0,
      totalMinor: sale.totalMinor,
      depositAppliedMinor: 0,
      planCoveredMinor: 0,
      method: tillMethod(sale.payments),
      source: sale.till.name,
      ...(theirs
        ? {
            renter: {
              name: renterName(s, sale.staffId!),
              servicesMinor: theirs.servicesMinor,
              productsMinor: theirs.productsMinor,
              taxMinor: theirs.taxMinor,
            },
          }
        : {}),
    })
  }
  return rows.sort((a, b) => a.date.localeCompare(b.date) || a.receipt.localeCompare(b.receipt))
}

export type TaxRow = {
  label: string
  rateBps: number
  inclusive: boolean
  netMinor: number
  taxMinor: number
}

/**
 * The studio's takings before tax and the tax on them, by tax rate. Receipts without tax show as
 * no tax. Stage 3: a renter's own takings, and the tax on them, are theirs and left out.
 */
export function taxSummary(s: BusinessState, from: string, to: string): TaxRow[] {
  const inPeriod = between(from, to)
  const rows = new Map<string, TaxRow>()
  const add = (label: string, rateBps: number, inclusive: boolean, net: number, tax: number) => {
    const key = `${label}|${rateBps}|${inclusive}`
    const row = rows.get(key) ?? {
      label: label || 'No tax',
      rateBps,
      inclusive,
      netMinor: 0,
      taxMinor: 0,
    }
    row.netMinor += net
    row.taxMinor += tax
    rows.set(key, row)
  }
  for (const sale of s.sales) {
    if (!inPeriod(recordDay(s, sale.paidAt))) continue
    const visit = s.appointments.find((a) => a.id === sale.appointmentId)
    const rental = visit && renterVisit(s, visit)
    if (!rental)
      add(
        sale.taxLabel ?? '',
        sale.taxRateBps ?? 0,
        !!sale.taxInclusive,
        serviceRevenue(sale),
        sale.taxMinor ?? 0,
      )
    if (sale.retail && !rental?.products)
      add(
        sale.retail.taxLabel,
        sale.retail.taxRateBps,
        sale.retail.taxInclusive,
        retailRevenue(sale),
        sale.retail.taxMinor,
      )
  }
  for (const sale of s.counterSales ?? [])
    if (inPeriod(recordDay(s, sale.paidAt)) && !renterCounterSale(s, sale))
      add(
        sale.retail.taxLabel,
        sale.retail.taxRateBps,
        sale.retail.taxInclusive,
        retailRevenue(sale),
        sale.retail.taxMinor,
      )
  // Stage 5: each line from another till at the rate that till charged, tax included in its
  // prices. A renter's own lines are theirs, as at SALEANE's till.
  const label = operations(s).tax?.label || 'Tax'
  for (const sale of otherTillSales(s)) {
    if (sale.kind !== 'sale' || !inPeriod(tillDay(s, sale))) continue
    const rental = renterTillPart(s, sale)?.rental
    for (const line of sale.lines) {
      if (rental && (line.kind === 'treatment' || rental.products)) continue
      add(
        line.taxRateBps ? `${label}, from another till` : '',
        line.taxRateBps,
        true,
        line.totalMinor - line.taxMinor,
        line.taxMinor,
      )
    }
  }
  return [...rows.values()].sort((a, b) => b.rateBps - a.rateBps)
}

export type DaySummary = {
  date: string
  servicesMinor: number
  productsMinor: number
  taxMinor: number
  tipsMinor: number
  plansMinor: number
  rentMinor: number
  feesMinor: number
  refundsMinor: number
  /** Stage 3: renters' own takings that came through the till, with their tax; not the studio's. */
  rentersMinor: number
  /** Stage 3: money given back on renters' own takings, out of what is held for them. */
  rentersBackMinor: number
}

/** One line per day of what was earned and given back, for the accounts. */
export function dailySummary(s: BusinessState, from: string, to: string): DaySummary[] {
  const days = new Map<string, DaySummary>()
  const day = (date: string) => {
    const row = days.get(date) ?? {
      date,
      servicesMinor: 0,
      productsMinor: 0,
      taxMinor: 0,
      tipsMinor: 0,
      plansMinor: 0,
      rentMinor: 0,
      feesMinor: 0,
      refundsMinor: 0,
      rentersMinor: 0,
      rentersBackMinor: 0,
    }
    days.set(date, row)
    return row
  }
  for (const sale of salesByReceipt(s, from, to)) {
    const row = day(sale.date)
    // A visit a package or membership paid for was counted when the plan was sold.
    const services = Math.max(0, sale.servicesMinor - sale.planCoveredMinor)
    const renter = sale.renter
    // Stage 3: a renter's own takings are held for them, apart from the studio's income.
    row.servicesMinor += renter?.servicesMinor ? 0 : services
    row.productsMinor += sale.productsMinor - (renter?.productsMinor ?? 0)
    row.taxMinor += sale.taxMinor - (renter?.taxMinor ?? 0)
    row.tipsMinor += sale.tipMinor
    if (renter)
      row.rentersMinor +=
        (renter.servicesMinor ? services : 0) + renter.productsMinor + renter.taxMinor
  }
  for (const money of moneyInAndOut(s, from, to)) {
    const row = day(money.date)
    if (money.kind === 'Package' || money.kind === 'Membership') row.plansMinor += money.amountMinor
    else if (money.kind === 'Chair or room rent') row.rentMinor += money.amountMinor
    else if (money.kind === 'No-show or late fee') row.feesMinor += money.amountMinor
    else if (money.amountMinor < 0) row.refundsMinor += -money.amountMinor
  }
  // Money given back on a renter's receipt comes out of what is held for them, in proportion to
  // how much of the receipt was theirs.
  for (const refund of operations(s).refunds) {
    const date = recordDay(s, refund.createdAt)
    if (date < from || date > to) continue
    const sale = refund.saleId ? s.sales.find((x) => x.id === refund.saleId) : undefined
    const counter = refund.counterSaleId
      ? (s.counterSales ?? []).find((x) => x.id === refund.counterSaleId)
      : undefined
    let theirs = 0
    let total = 0
    if (sale) {
      const visit = s.appointments.find((a) => a.id === sale.appointmentId)
      const part = renterPartOfReceipt(s, sale, visit)
      theirs = part.servicesMinor + part.productsMinor + part.taxMinor
      total = sale.totalMinor
    } else if (counter && renterCounterSale(s, counter)) {
      theirs = counter.totalMinor
      total = counter.totalMinor
    }
    if (!theirs || total <= 0) continue
    const share = Math.min(refund.amountMinor, Math.round((refund.amountMinor * theirs) / total))
    const row = day(date)
    row.refundsMinor -= share
    row.rentersBackMinor += share
  }
  // Stage 5: the same for money given back on another till, on a renter's sale from that till.
  const tillSales = otherTillSales(s)
  for (const refund of tillSales) {
    if (refund.kind !== 'refund') continue
    const date = tillDay(s, refund)
    if (date < from || date > to) continue
    const sale = tillSales.find((x) => x.id === refund.refundOf)
    const part = sale && renterTillPart(s, sale)
    if (!sale || !part || sale.totalMinor <= 0) continue
    const theirs = part.servicesMinor + part.productsMinor + part.taxMinor
    const share = Math.min(
      refund.totalMinor,
      Math.round((refund.totalMinor * theirs) / sale.totalMinor),
    )
    if (!share) continue
    const row = day(date)
    row.refundsMinor -= share
    row.rentersBackMinor += share
  }
  return [...days.values()].sort((a, b) => a.date.localeCompare(b.date))
}

export function moneyCsv(rows: MoneyRow[], currency: string) {
  return csvRows([
    [
      'Date',
      'What',
      'Receipt or reference',
      'Client or renter',
      'Paid by',
      `Amount (${currency})`,
      'Test or demo',
    ],
    ...rows.map((r) => [
      r.date,
      r.kind,
      r.reference,
      r.client,
      METHOD_WORDS[r.method] ?? r.method,
      csvAmount(r.amountMinor),
      r.test ? 'Yes' : 'No',
    ]),
  ])
}

export function salesCsv(rows: SaleRow[], currency: string) {
  return csvRows([
    [
      'Date',
      'Receipt',
      'Client',
      `Services before tax (${currency})`,
      `Discount (${currency})`,
      `Products before tax (${currency})`,
      `Tax (${currency})`,
      `Tips (${currency})`,
      `Total (${currency})`,
      `Deposit used (${currency})`,
      `Covered by a plan (${currency})`,
      'Paid by',
      'Renter',
      `Renter’s own, with tax (${currency})`,
      'Sent in from another till',
    ],
    ...rows.map((r) => [
      r.date,
      r.receipt,
      r.client,
      csvAmount(r.servicesMinor),
      csvAmount(r.discountMinor),
      csvAmount(r.productsMinor),
      csvAmount(r.taxMinor),
      csvAmount(r.tipMinor),
      csvAmount(r.totalMinor),
      csvAmount(r.depositAppliedMinor),
      csvAmount(r.planCoveredMinor),
      METHOD_WORDS[r.method] ?? r.method,
      r.renter?.name ?? '',
      r.renter
        ? csvAmount(r.renter.servicesMinor + r.renter.productsMinor + r.renter.taxMinor)
        : '',
      r.source ?? '',
    ]),
  ])
}

export function taxCsv(rows: TaxRow[], currency: string) {
  return csvRows([
    ['Tax', 'Rate %', 'Included in prices', `Before tax (${currency})`, `Tax (${currency})`],
    ...rows.map((r) => [
      r.label,
      (r.rateBps / 100).toFixed(2),
      r.inclusive ? 'Yes' : 'No',
      csvAmount(r.netMinor),
      csvAmount(r.taxMinor),
    ]),
  ])
}

/** The calendar month a day falls in, and the month before it. */
export function monthOf(date: string, back = 0) {
  let first = `${date.slice(0, 7)}-01`
  for (let i = 0; i < back; i++) first = `${addDays(first, -1).slice(0, 7)}-01`
  const next = `${addDays(first, 32).slice(0, 7)}-01`
  return { from: first, to: addDays(next, -1) }
}

export type JournalLine = {
  account: string
  code: string
  description: string
  debitMinor: number
  creditMinor: number
}

/** What a day added to the takings clearing account: earnings in, less money given back. */
export function dayTakings(day: DaySummary) {
  return (
    day.servicesMinor +
    day.productsMinor +
    day.taxMinor +
    day.tipsMinor +
    day.plansMinor +
    day.rentMinor +
    day.feesMinor +
    day.rentersMinor -
    day.refundsMinor -
    day.rentersBackMinor
  )
}

/**
 * A day as a balanced journal: earnings, tax and tips owed to staff on one side, refunds on the
 * other, balanced against a takings clearing account that the accountant reconciles with the bank.
 */
export function dayJournal(day: DaySummary, codes: AccountCodes): JournalLine[] {
  const credit = (account: string, code: string, description: string, minor: number) =>
    minor ? [{ account, code, description, debitMinor: 0, creditMinor: minor }] : []
  const lines: JournalLine[] = [
    ...credit('Services', codes.services, 'Services before tax', day.servicesMinor),
    ...credit('Products', codes.products, 'Products before tax', day.productsMinor),
    ...credit('Tax', codes.tax, 'Tax on services and products', day.taxMinor),
    ...credit('Tips owed to staff', codes.tips, 'Tips', day.tipsMinor),
    ...credit(
      'Packages and memberships',
      codes.plans,
      'Packages and memberships sold',
      day.plansMinor,
    ),
    ...credit('Chair and room rent', codes.rent, 'Rent from self-employed renters', day.rentMinor),
    ...credit('No-show and late fees', codes.fees, 'Fees', day.feesMinor),
    ...credit(
      'Takings held for renters',
      codes.renters ?? '',
      'Renters’ own takings, held for them',
      day.rentersMinor,
    ),
  ]
  if (day.rentersBackMinor)
    lines.push({
      account: 'Takings held for renters',
      code: codes.renters ?? '',
      description: 'Given back on renters’ own takings',
      debitMinor: day.rentersBackMinor,
      creditMinor: 0,
    })
  if (day.refundsMinor)
    lines.push({
      account: 'Refunds',
      code: codes.refunds,
      description: 'Money given back',
      debitMinor: day.refundsMinor,
      creditMinor: 0,
    })
  const net = lines.reduce((sum, l) => sum + l.creditMinor - l.debitMinor, 0)
  if (net > 0)
    lines.unshift({
      account: 'Takings clearing',
      code: codes.clearing,
      description: 'Takings for the day',
      debitMinor: net,
      creditMinor: 0,
    })
  else if (net < 0)
    lines.unshift({
      account: 'Takings clearing',
      code: codes.clearing,
      description: 'More given back than taken',
      debitMinor: 0,
      creditMinor: -net,
    })
  return lines
}

/**
 * What would be sent to the accounting software, in its own shape. Only test mode exists: the
 * payload is prepared and shown, and nothing leaves SALEANE. A live connection needs the
 * accountant to sign in to Xero or QuickBooks, which comes later.
 */
export function accountingPayload(
  provider: AccountingProvider,
  days: DaySummary[],
  codes: AccountCodes,
  currency: string,
  studio: string,
) {
  const amount = (minor: number) => Number((minor / 100).toFixed(2))
  // A day where everything was covered by a package has nothing to post, and both reject an empty journal.
  days = days.filter((day) => dayJournal(day, codes).length)
  if (provider === 'xero')
    return {
      ManualJournals: days.map((day) => ({
        Narration: `${studio} takings for ${day.date} (from SALEANE)`,
        Date: day.date,
        LineAmountTypes: 'NoTax',
        Status: 'DRAFT',
        JournalLines: dayJournal(day, codes).map((l) => ({
          AccountCode: l.code,
          Description: l.description,
          // Xero journals use positive for debits and negative for credits.
          LineAmount: amount(l.debitMinor - l.creditMinor),
        })),
      })),
    }
  return {
    JournalEntries: days.map((day) => ({
      TxnDate: day.date,
      PrivateNote: `${studio} takings for ${day.date} (from SALEANE)`,
      CurrencyRef: { value: currency },
      Line: dayJournal(day, codes).map((l) => ({
        DetailType: 'JournalEntryLineDetail',
        Amount: amount(l.debitMinor || l.creditMinor),
        Description: l.description,
        JournalEntryLineDetail: {
          PostingType: l.debitMinor ? 'Debit' : 'Credit',
          AccountRef: { name: l.account, value: l.code },
        },
      })),
    })),
  }
}

/** Records a batch prepared for the accounting software. Test mode only: nothing is sent. */
export function prepareAccountingExport(
  next: BusinessState,
  command: { provider: AccountingProvider; from: string; to: string },
  now: string,
  makeId: () => string,
) {
  const o = (next.operations ??= operations(next))
  const settings = o.accounting
  if (!settings || settings.provider !== command.provider)
    throw new Error('Choose the accounting software and its account codes first.')
  if (Object.entries(settings.codes).some(([key, code]) => key !== 'renters' && !code))
    throw new Error('Fill in every account code first. Your accountant can tell you them.')
  if (command.to < command.from) throw new Error('The period must end on or after it starts.')
  if (Date.parse(command.to) - Date.parse(command.from) > 366 * 86400000)
    throw new Error('Prepare up to a year at a time.')
  const days = dailySummary(next, command.from, command.to).filter(
    (day) => dayJournal(day, settings.codes).length,
  )
  if (!settings.codes.renters && days.some((d) => d.rentersMinor || d.rentersBackMinor))
    throw new Error(
      'Fill in the account code for takings held for renters first. Your accountant can tell you it.',
    )
  o.accountingExports ??= []
  if (o.accountingExports.length >= ACCOUNTING_EXPORT_LIMIT)
    throw new Error('Too many batches to keep.')
  const batch = {
    id: makeId(),
    provider: command.provider,
    from: command.from,
    to: command.to,
    days: days.length,
    takingsMinor: days.reduce((sum, d) => sum + dayTakings(d), 0),
    mode: 'test' as const,
    createdAt: now,
    actor: 'Local operator',
  }
  o.accountingExports.push(batch)
  return batch.id
}
