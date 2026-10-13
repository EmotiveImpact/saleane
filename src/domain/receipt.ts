import type { BusinessState, Sale } from './model'
import { operations } from './operations'
import { placeOf, places } from './locations'
import { fullDateLabel, money } from './format'
import { recordDay } from './tillCount'
import { bookedOfferLine } from './quietOffers'

/**
 * Stage 2: one receipt, whatever was sold. Built by a pure function from a visit's receipt, a
 * walk-in sale, a gift card or a plan payment, so the screen, the paper roll, the network printer
 * and the email all say exactly the same thing. It reads the record only: nothing here records,
 * charges or sends anything, and every way of paying is named for what it was ("Card, test
 * payment, no money moved", never just "Card").
 */

export const receiptKinds = ['visit', 'walk-in', 'gift-card', 'plan'] as const
export type ReceiptKind = (typeof receiptKinds)[number]
/** Which receipt: a plan names the payment as well, since each month has its own. */
export type ReceiptRef = { kind: ReceiptKind; id: string; payment?: string }

/** "visit:sale-1", "plan:holding-1:payment-2". */
export const receiptKey = (ref: ReceiptRef) =>
  [ref.kind, ref.id, ...(ref.payment ? [ref.payment] : [])].join(':')
const part = /^[A-Za-z0-9_.-]{1,150}$/
export function parseReceiptKey(key: string): ReceiptRef | null {
  const [kind, id, payment, ...rest] = key.split(':')
  if (rest.length || !(receiptKinds as readonly string[]).includes(kind) || !part.test(id ?? ''))
    return null
  if ((kind === 'plan') !== (payment !== undefined)) return null
  if (payment !== undefined && !part.test(payment)) return null
  return { kind: kind as ReceiptKind, id, ...(payment ? { payment } : {}) }
}

export type ReceiptLine = {
  label: string
  /** A quieter second line: how many and at what price, a code's last characters. */
  detail?: string
  amountMinor: number
  /** Taken off: a discount, a deposit paid before, a plan's or gift card's share, a refund. */
  minus?: boolean
}
export type Receipt = {
  ref: ReceiptRef
  key: string
  kind: ReceiptKind
  /** "Receipt", or what the money was for when it was not a visit or products. */
  title: string
  number: string
  /** The location it was sold at, for its printer and for who may print it. */
  locationId: string
  studio: {
    name: string
    /** Named only when the studio has more than one location. */
    location?: string
    address?: string
    phone?: string
    taxNumber?: { label: string; value: string }
  }
  issuedAt: string
  /** In the studio's own time zone. */
  date: string
  time: string
  servedBy?: string
  clientId?: string
  clientName?: string
  /** Where "Email receipt" would send it; absent when the client has no email address. */
  email?: string
  /** What was bought, any discount, tax added on top and a tip, adding up to the total. */
  lines: ReceiptLine[]
  totalMinor: number
  /** Tax already inside the prices ("Includes VAT 20%"). */
  included: ReceiptLine[]
  /** Paid before or by something other than money today: a deposit, a plan, a gift card. */
  settled: ReceiptLine[]
  /** What was paid now, and how. Absent when nothing was left to pay. */
  paid?: { label: string; amountMinor: number }
  refunds: ReceiptLine[]
  notes: string[]
  thanks: string
  sample: boolean
  money: { locale: 'en-GB' | 'en-US'; currency: 'GBP' | 'USD' }
}

type Processor = { live: boolean } | undefined
/** Forward compatible: a payment record may carry the provider that took it. */
const processorOf = (record: object): Processor =>
  (record as { processor?: { live: boolean } }).processor

/** How the money was paid, in words that never claim more than happened. */
export function paidWith(method: string, processor?: Processor) {
  switch (method) {
    case 'cash':
      return 'Cash'
    case 'external_card':
      return 'Card at the studio’s own terminal'
    case 'card':
      return processor?.live ? 'Card' : 'Card, test payment, no money moved'
    case 'demo_cash':
      return 'Cash, sample studio, no real money'
    case 'demo_card':
      return 'Card, sample studio, no real money'
    case 'previous_system':
      return 'Paid to the studio’s previous system'
    default:
      return 'Paid'
  }
}
function refundedWith(method: string | undefined, processor?: Processor) {
  switch (method) {
    case 'cash':
      return 'Refunded in cash'
    case 'external_card':
      return 'Refunded on the studio’s own terminal'
    case 'card':
      return processor?.live
        ? 'Refunded to the card'
        : 'Refunded to the card, test refund, no money moved'
    case 'demo_cash':
    case 'demo_card':
      return 'Refunded, sample studio, no real money'
    default:
      return 'Refunded'
  }
}

/** Names that mark who did it as the system, not a person, so they are not printed. */
const NOT_A_PERSON = new Set(['Local operator', 'Card payment', 'Guest (card payment)', 'SALEANE'])
function person(name: string | undefined) {
  const clean = name?.split(' · ')[0].trim()
  return clean && !NOT_A_PERSON.has(clean) ? clean : undefined
}

const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)
const percent = (bps: number) => `${Number((bps / 100).toFixed(2))}%`
/** Tax shown as the studio shows it: added on top as a line, or noted as already included. */
function taxInto(
  r: Pick<Receipt, 'lines' | 'included'>,
  taxMinor: number | undefined,
  label: string | undefined,
  rateBps: number | undefined,
  inclusive: boolean | undefined,
) {
  if (!taxMinor) return
  const name = `${label?.trim() || 'Tax'} ${percent(rateBps ?? 0)}`
  const list = inclusive ? r.included : r.lines
  const words = inclusive ? `Includes ${name}` : name
  const same = list.find((line) => line.label === words)
  if (same) same.amountMinor += taxMinor
  else list.push({ label: words, amountMinor: taxMinor })
}

function studioOf(s: BusinessState, locationId: string) {
  const org = s.organisation
  const site = placeOf(s, locationId) ?? places(s)[0]
  const phone = site.phone ?? org.phone
  const taxNumber = operations(s).till?.taxNumber
  return {
    name: org.name,
    ...(places(s, true).length > 1 ? { location: site.name } : {}),
    ...(site.address.trim() ? { address: site.address.trim() } : {}),
    ...(phone ? { phone } : {}),
    ...(taxNumber
      ? { taxNumber: { label: org.region === 'UK' ? 'VAT number' : 'Tax ID', value: taxNumber } }
      : {}),
  }
}

function moment(s: BusinessState, instant: string) {
  const org = s.organisation
  return {
    issuedAt: instant,
    // A sample studio's clock stands on its sample day, as its till count does.
    date: new Intl.DateTimeFormat(org.locale, {
      timeZone: 'UTC',
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(new Date(`${recordDay(s, instant)}T12:00:00Z`)),
    time: new Intl.DateTimeFormat(org.locale, {
      timeZone: org.timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: org.locale === 'en-US',
    }).format(new Date(instant)),
  }
}

function clientOf(s: BusinessState, clientId: string | undefined) {
  const client = clientId ? s.clients.find((c) => c.id === clientId) : undefined
  if (!client) return {}
  return {
    clientId: client.id,
    clientName: client.name,
    ...(client.email?.trim() ? { email: client.email.trim() } : {}),
  }
}

/** The plain parts every receipt shares. */
function shell(
  s: BusinessState,
  ref: ReceiptRef,
  fields: { number: string; locationId: string; at: string; title?: string; thanks?: string },
) {
  const org = s.organisation
  const sample = operations(s).mode === 'sandbox'
  return {
    ref,
    key: receiptKey(ref),
    kind: ref.kind,
    title: fields.title ?? 'Receipt',
    number: fields.number,
    locationId: fields.locationId,
    studio: studioOf(s, fields.locationId),
    ...moment(s, fields.at),
    lines: [] as ReceiptLine[],
    included: [] as ReceiptLine[],
    settled: [] as ReceiptLine[],
    refunds: [] as ReceiptLine[],
    notes: sample ? ['Sample studio: no real money was taken.'] : [],
    thanks: fields.thanks ?? `Thank you for choosing ${org.name}.`,
    sample,
    money: { locale: org.locale, currency: org.currency },
  }
}

/** A membership discount is not marked on a receipt, so it is recognised by its amount. */
function memberPercent(s: BusinessState, sale: Sale, clientId: string, serviceId: string) {
  if (!sale.discountMinor) return 0
  for (const holding of s.holdings ?? [])
    if (
      holding.kind === 'membership' &&
      holding.clientId === clientId &&
      holding.discountPercent > 0 &&
      holding.serviceIds.includes(serviceId) &&
      holding.soldAt <= sale.paidAt &&
      (!holding.cancelled || holding.cancelled.at > sale.paidAt) &&
      Math.round((sale.serviceMinor * holding.discountPercent) / 100) === sale.discountMinor
    )
      return holding.discountPercent
  return 0
}

/** Products, each with how many and at what price. Their tax is added by the caller. */
function productLines(
  r: Pick<Receipt, 'lines'>,
  retail: Sale['retail'],
  format: (n: number) => string,
) {
  for (const line of retail?.lines ?? [])
    r.lines.push({
      label: line.name,
      ...(line.quantity > 1 ? { detail: `${line.quantity} × ${format(line.unitMinor)}` } : {}),
      amountMinor: line.quantity * line.unitMinor,
    })
}
const retailTax = (r: Pick<Receipt, 'lines' | 'included'>, retail: Sale['retail']) =>
  retail && taxInto(r, retail.taxMinor, retail.taxLabel, retail.taxRateBps, retail.taxInclusive)

function visitReceipt(s: BusinessState, ref: ReceiptRef): Receipt | null {
  const sale = s.sales.find((x) => x.id === ref.id)
  const a = sale && s.appointments.find((x) => x.id === sale.appointmentId)
  if (!sale || !a) return null
  const format = (n: number) => money(n, s.organisation, true)
  const r: Receipt = {
    ...shell(s, ref, {
      number: sale.receiptNumber ?? sale.id.slice(0, 8).toUpperCase(),
      locationId: a.locationId,
      at: sale.paidAt,
      thanks: 'Thank you for your visit. We hope to see you again soon.',
    }),
    ...clientOf(s, a.clientId),
    ...(person(s.staff.find((p) => p.id === a.staffId)?.name)
      ? { servedBy: person(s.staff.find((p) => p.id === a.staffId)?.name) }
      : {}),
    totalMinor: sale.totalMinor,
  }
  // Stage 5: a visit booked at a quiet-time price says so under the treatment, with the usual price.
  const offer = bookedOfferLine(s, a)
  r.lines.push({
    label: a.bookedServiceName ?? s.services.find((x) => x.id === a.serviceId)?.name ?? 'Treatment',
    amountMinor: sale.serviceMinor,
    ...(offer ? { detail: offer } : {}),
  })
  const plan = sale.holdingId ? (s.holdings ?? []).find((h) => h.id === sale.holdingId) : undefined
  if (sale.discountMinor) {
    const member = memberPercent(s, sale, a.clientId, a.serviceId)
    r.lines.push({
      label:
        sale.coveredMinor !== undefined
          ? 'Plan saving'
          : member
            ? `Member discount (${member}%)`
            : 'Discount',
      amountMinor: sale.discountMinor,
      minus: true,
    })
  }
  productLines(r, sale.retail, format)
  // Tax added on top comes after everything it was added to, then the tip.
  taxInto(r, sale.taxMinor, sale.taxLabel, sale.taxRateBps, sale.taxInclusive)
  retailTax(r, sale.retail)
  if (sale.tipMinor) r.lines.push({ label: 'Tip', amountMinor: sale.tipMinor })
  if (sale.depositAppliedMinor)
    r.settled.push({
      label: 'Deposit paid before the visit',
      amountMinor: sale.depositAppliedMinor,
      minus: true,
    })
  if (sale.coveredMinor)
    r.settled.push({
      label: `Paid by ${plan?.name ?? 'a package or membership'}`,
      amountMinor: sale.coveredMinor,
      minus: true,
    })
  if (sale.giftCardMinor) {
    const card = (s.giftCards ?? []).find((c) => c.id === sale.giftCardId)
    r.settled.push({
      label: 'Gift card',
      ...(card ? { detail: `Code ending ${card.code.slice(-4)}` } : {}),
      amountMinor: sale.giftCardMinor,
      minus: true,
    })
  }
  if (sale.balanceMinor)
    r.paid = { label: paidWith(sale.method, sale.processor), amountMinor: sale.balanceMinor }
  for (const refund of operations(s).refunds.filter((x) => x.saleId === sale.id))
    r.refunds.push({
      label: refundedWith(refund.method ?? sale.method, refund.processor ?? sale.processor),
      detail: fullDateLabel(recordDay(s, refund.createdAt), s.organisation.locale),
      amountMinor: refund.amountMinor,
      minus: true,
    })
  return r
}

function walkInReceipt(s: BusinessState, ref: ReceiptRef): Receipt | null {
  const sale = (s.counterSales ?? []).find((x) => x.id === ref.id)
  if (!sale) return null
  const main = s.organisation.locationId
  const format = (n: number) => money(n, s.organisation, true)
  const staff = sale.staffId ? s.staff.find((p) => p.id === sale.staffId)?.name : undefined
  const servedBy = person(staff) ?? person(sale.actor)
  const r: Receipt = {
    ...shell(s, ref, {
      number: sale.receiptNumber,
      locationId: sale.locationId ?? main,
      at: sale.paidAt,
    }),
    ...clientOf(s, sale.clientId),
    ...(servedBy ? { servedBy } : {}),
    totalMinor: sale.totalMinor,
    paid: { label: paidWith(sale.method), amountMinor: sale.totalMinor },
  }
  productLines(r, sale.retail, format)
  retailTax(r, sale.retail)
  for (const refund of operations(s).refunds.filter((x) => x.counterSaleId === sale.id))
    r.refunds.push({
      label: refundedWith(refund.method ?? sale.method),
      detail: fullDateLabel(recordDay(s, refund.createdAt), s.organisation.locale),
      amountMinor: refund.amountMinor,
      minus: true,
    })
  return r
}

function giftCardReceipt(s: BusinessState, ref: ReceiptRef): Receipt | null {
  const cards = s.giftCards ?? []
  const index = cards.findIndex((c) => c.id === ref.id)
  if (index < 0) return null
  const card = cards[index]
  const locale = s.organisation.locale
  const servedBy = person(card.actor)
  const r: Receipt = {
    ...shell(s, ref, {
      number: `GC-${index + 1}`,
      locationId: card.locationId ?? s.organisation.locationId,
      at: card.payment.recordedAt,
      title: card.kind === 'service' ? 'Voucher receipt' : 'Gift card receipt',
    }),
    ...clientOf(s, card.clientId),
    ...(servedBy ? { servedBy } : {}),
    totalMinor: card.payment.amountMinor,
    ...(card.payment.amountMinor
      ? {
          paid: {
            label: paidWith(card.payment.method, processorOf(card.payment)),
            amountMinor: card.payment.amountMinor,
          },
        }
      : {}),
  }
  // Only the code's last characters: the full code spends the card, so it stays on the card.
  r.lines.push({
    label:
      card.kind === 'service' ? `Voucher for ${card.serviceName ?? 'a treatment'}` : 'Gift card',
    detail: sentence(
      [
        card.recipientName ? `for ${card.recipientName}` : '',
        `code ending ${card.code.slice(-4)}`,
        `use by ${fullDateLabel(card.expiresOn, locale)}`,
      ]
        .filter(Boolean)
        .join(', '),
    ),
    amountMinor: card.payment.amountMinor,
  })
  for (const refund of card.refunds)
    r.refunds.push({
      label: refundedWith(refund.method),
      detail: fullDateLabel(recordDay(s, refund.createdAt), locale),
      amountMinor: refund.amountMinor,
      minus: true,
    })
  return r
}

function planReceipt(s: BusinessState, ref: ReceiptRef): Receipt | null {
  const plans = s.holdings ?? []
  const index = plans.findIndex((h) => h.id === ref.id)
  if (index < 0) return null
  const holding = plans[index]
  const n = holding.payments.findIndex((p) => p.id === ref.payment)
  if (n < 0) return null
  const payment = holding.payments[n]
  const locale = s.organisation.locale
  // Renewals do not record who took them; the first payment is the sale.
  const servedBy = n === 0 ? person(holding.actor) : undefined
  const r: Receipt = {
    ...shell(s, ref, {
      number: n === 0 ? `PL-${index + 1}` : `PL-${index + 1}-${n + 1}`,
      locationId: holding.locationId ?? s.organisation.locationId,
      at: payment.recordedAt,
      title: holding.kind === 'package' ? 'Package receipt' : 'Membership receipt',
    }),
    ...clientOf(s, holding.clientId),
    ...(servedBy ? { servedBy } : {}),
    totalMinor: payment.amountMinor,
    ...(payment.amountMinor
      ? {
          paid: {
            label: paidWith(payment.method, processorOf(payment)),
            amountMinor: payment.amountMinor,
          },
        }
      : {}),
  }
  const visits = `${holding.visits} ${holding.visits === 1 ? 'visit' : 'visits'}`
  r.lines.push({
    label: holding.name,
    detail:
      holding.kind === 'package'
        ? `Package of ${visits}${holding.endsOn ? `, use by ${fullDateLabel(holding.endsOn, locale)}` : ''}`
        : `Membership for the month from ${fullDateLabel(payment.periodStart ?? holding.startedOn, locale)}`,
    amountMinor: payment.amountMinor,
  })
  // A plan's price has any tax inside it. Plans do not keep the rate they were sold under, so
  // this uses the studio's tax setting now.
  const tax = operations(s).tax
  if (tax && tax.rateBps > 0)
    taxInto(
      r,
      Math.round((payment.amountMinor * tax.rateBps) / (10000 + tax.rateBps)),
      tax.label,
      tax.rateBps,
      true,
    )
  return r
}

/** The receipt for a sale, or null when it is not in this studio's record. */
export function receiptFor(s: BusinessState, ref: ReceiptRef): Receipt | null {
  if (ref.kind === 'visit') return visitReceipt(s, ref)
  if (ref.kind === 'walk-in') return walkInReceipt(s, ref)
  if (ref.kind === 'gift-card') return giftCardReceipt(s, ref)
  return planReceipt(s, ref)
}

/** One printed row: a label on the left and its amount on the right. */
export type ReceiptRow = {
  kind: 'item' | 'total' | 'included' | 'settled' | 'paid' | 'refund'
  label: string
  detail?: string
  amount: string
}

/**
 * The rows of a receipt in printing order, with amounts written out. Shared by the slip on
 * screen, the paper from a receipt printer and the email, so all three agree.
 */
export function receiptRows(r: Receipt): ReceiptRow[] {
  const format = (n: number, minus = false) => `${minus ? '−' : ''}${money(n, r.money, true)}`
  const row = (kind: ReceiptRow['kind'], line: ReceiptLine): ReceiptRow => ({
    kind,
    label: line.label,
    ...(line.detail ? { detail: line.detail } : {}),
    amount: format(line.amountMinor, line.minus),
  })
  return [
    ...r.lines.map((line) => row('item', line)),
    { kind: 'total', label: 'Total', amount: format(r.totalMinor) },
    ...r.included.map((line) => row('included', line)),
    ...r.settled.map((line) => row('settled', line)),
    r.paid
      ? { kind: 'paid', label: `Paid: ${r.paid.label}`, amount: format(r.paid.amountMinor) }
      : { kind: 'paid', label: 'Nothing left to pay', amount: format(0) },
    ...r.refunds.map((line) => row('refund', line)),
  ]
}

/** The receipt as plain text, for an email. */
export function receiptText(r: Receipt) {
  const head = [
    r.studio.name,
    r.studio.location,
    r.studio.address,
    r.studio.phone,
    '',
    `${r.title} ${r.number}`,
    `${r.date} at ${r.time}`,
    r.servedBy ? `Served by ${r.servedBy}` : undefined,
    '',
  ].filter((line): line is string => line !== undefined)
  const rows = receiptRows(r).flatMap((row) => [
    `${row.label}: ${row.amount}`,
    ...(row.detail ? [`  ${row.detail}`] : []),
  ])
  return [
    ...head,
    ...rows,
    '',
    ...r.notes,
    r.thanks,
    ...(r.studio.taxNumber ? [`${r.studio.taxNumber.label}: ${r.studio.taxNumber.value}`] : []),
  ]
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
}

/** The email that carries a receipt. */
export function receiptEmail(r: Receipt) {
  return {
    subject: `Your receipt from ${r.studio.name} (${r.number})`,
    body: `${r.clientName ? `Dear ${r.clientName.split(' ')[0]},\n\n` : ''}Here is your receipt.\n\n${receiptText(r)}`,
  }
}

/** Gift cards and plan payments, which have no receipt of their own in the record. */
export function otherReceipts(s: BusinessState) {
  const client = (id: string | undefined) => s.clients.find((c) => c.id === id)?.name
  // Moving in, stage 3: cards and packages carried over were sold in the old system, not here.
  const soldHere = (p: { method: string }) => p.method !== 'previous_system'
  return [
    ...(s.giftCards ?? [])
      .flatMap((card, index) => (soldHere(card.payment) ? [{ card, index }] : []))
      .map(({ card, index }) => ({
        key: receiptKey({ kind: 'gift-card', id: card.id }),
        kind: 'gift-card' as const,
        number: `GC-${index + 1}`,
        title: card.kind === 'service' ? 'Voucher sold' : 'Gift card sold',
        name: client(card.clientId) ?? card.purchaserName,
        method: card.payment.method,
        amountMinor: card.payment.amountMinor,
        at: card.payment.recordedAt,
        locationId: card.locationId ?? s.organisation.locationId,
      })),
    ...(s.holdings ?? []).flatMap((holding, index) =>
      holding.payments
        .flatMap((payment, n) => (soldHere(payment) ? [{ payment, n }] : []))
        .map(({ payment, n }) => ({
          key: receiptKey({ kind: 'plan', id: holding.id, payment: payment.id }),
          kind: 'plan' as const,
          number: n === 0 ? `PL-${index + 1}` : `PL-${index + 1}-${n + 1}`,
          title: n === 0 ? `${holding.name} sold` : `${holding.name}, monthly payment`,
          name: client(holding.clientId) ?? 'Client',
          method: payment.method,
          amountMinor: payment.amountMinor,
          at: payment.recordedAt,
          locationId: holding.locationId ?? s.organisation.locationId,
        })),
    ),
  ]
}
