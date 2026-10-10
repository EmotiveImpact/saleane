import type { BusinessState } from './model'
import type { Command } from './commandSchema'
import { operations, stock } from './operations'
import { placeField, placeOf, places } from './locations'
import { productWithBarcode } from './barcode'
import { recordDay } from './tillCount'
import { rentalOn } from './takings'
import {
  OTHER_TILL_CLOCK_MS,
  OTHER_TILL_DAYS_BACK,
  OTHER_TILL_LIMIT,
  otherTillSaleSchema,
} from './otherTillSchema'
import type {
  OtherTillLine,
  OtherTillLineInput,
  OtherTillSale,
  OtherTillSaleInput,
} from './otherTillSchema'

/**
 * Stage 5: sales from another till (see otherTillSchema.ts for the record). This module records
 * them, checks them whenever the studio record is read, and says what each one adds to takings.
 *
 * Money: a sale from another till is money the studio took outside SALEANE, on that till. It is
 * kept apart from SALEANE's own receipts and payments, so it never reads as a payment SALEANE
 * took, never opens SALEANE's cash drawer and is not part of SALEANE's till count. Its lines are
 * treatments or products, so it counts in takings exactly as a receipt does: the amount without
 * its tax, the tax kept apart, on the studio's own day it happened.
 *
 * Stock: a product SALEANE knows comes off the shelf at that location. The sale has already
 * happened, so it is never refused for stock: when SALEANE's count is lower, what is there comes
 * off, the line says how many, and someone should count the shelf. A refund puts back no more
 * than its sale took off.
 */

/** Who sent it: set by the server from the access key, never from a request body. */
export type OtherTillSource = { keyId: string; name: string }

type OtherTillCommand = Extract<Command, { type: 'other-till-sale' | 'other-till-refund' }>

export const otherTillSales = (s: BusinessState) => s.otherTillSales ?? []

/** A line's takings: what was paid for it, without its tax. */
export const lineNet = (line: Pick<OtherTillLine, 'totalMinor' | 'taxMinor'>) =>
  line.totalMinor - line.taxMinor

/** What one sale or refund holds: treatments and products without tax, and the tax. */
export function tillParts(sale: Pick<OtherTillSale, 'lines'>) {
  let treatmentsMinor = 0,
    productsMinor = 0,
    taxMinor = 0
  for (const line of sale.lines) {
    if (line.kind === 'treatment') treatmentsMinor += lineNet(line)
    else productsMinor += lineNet(line)
    taxMinor += line.taxMinor
  }
  return { treatmentsMinor, productsMinor, taxMinor }
}

/** The tax inside an amount that includes it, at a rate in basis points. */
export const taxInside = (totalMinor: number, rateBps: number) =>
  Math.round((totalMinor * rateBps) / (10000 + rateBps))

/** How much has been given back on a sale so far. */
export function refundedOn(s: BusinessState, saleId: string) {
  return otherTillSales(s)
    .filter((x) => x.kind === 'refund' && x.refundOf === saleId)
    .reduce((sum, x) => sum + x.totalMinor, 0)
}

/** The day a sale or refund belongs to: the studio's own day it happened on the other till. */
export const tillDay = (s: BusinessState, sale: Pick<OtherTillSale, 'occurredAt'>) =>
  recordDay(s, sale.occurredAt)

/**
 * Stage 3: whose takings these are. A team member renting a chair or room that day keeps their
 * own treatments, and their products when their rental says so, exactly as at SALEANE's till.
 */
export function renterTillPart(s: BusinessState, sale: OtherTillSale) {
  const rental = sale.staffId ? rentalOn(s, sale.staffId, tillDay(s, sale)) : undefined
  if (!rental) return undefined
  const theirs = sale.lines.filter((line) => line.kind === 'treatment' || rental.products)
  return {
    rental,
    servicesMinor: theirs
      .filter((line) => line.kind === 'treatment')
      .reduce((n, line) => n + lineNet(line), 0),
    productsMinor: theirs
      .filter((line) => line.kind === 'product')
      .reduce((n, line) => n + lineNet(line), 0),
    taxMinor: theirs.reduce((n, line) => n + line.taxMinor, 0),
  }
}

/** The same receipt number already sent in from that location, if any. */
export function sentBefore(
  s: BusinessState,
  locationId: string,
  kind: OtherTillSale['kind'],
  receipt: string,
) {
  return otherTillSales(s).find(
    (x) => x.locationId === locationId && x.kind === kind && x.receipt === receipt.trim(),
  )
}

/** Each line checked and linked to what SALEANE knows, or kept as the till named it. */
function linesFor(s: BusinessState, lines: OtherTillLineInput[]) {
  const products = operations(s).products
  return lines.map((line, i): OtherTillLine => {
    const where = `Line ${i + 1}`
    if (line.taxMinor > line.totalMinor)
      throw new Error(`${where}: the tax is more than the line’s total.`)
    // A till works its tax out per receipt, so each line may be a penny either way.
    const expected = taxInside(line.totalMinor, line.taxRateBps)
    if (Math.abs(expected - line.taxMinor) > 1)
      throw new Error(
        `${where}: at ${line.taxRateBps / 100}% the tax inside ${line.totalMinor} is ${expected}, not ${line.taxMinor}. Amounts are in minor units, tax included.`,
      )
    const own = {
      quantity: line.quantity,
      totalMinor: line.totalMinor,
      taxMinor: line.taxMinor,
      taxRateBps: line.taxRateBps,
    }
    if (line.kind === 'treatment') {
      if (line.productId || line.barcode || line.sku)
        throw new Error(`${where}: a treatment has no product, barcode or SKU.`)
      if (line.serviceId) {
        const service = s.services.find((x) => x.id === line.serviceId)
        if (!service) throw new Error(`${where}: that treatment is not in SALEANE.`)
        return { kind: 'treatment', name: service.name, serviceId: service.id, ...own }
      }
      if (!line.name) throw new Error(`${where}: name the treatment.`)
      return { kind: 'treatment', name: line.name, ...own }
    }
    if (line.serviceId) throw new Error(`${where}: a product has no treatment.`)
    let product = line.productId ? products.find((p) => p.id === line.productId) : undefined
    if (line.productId && !product) throw new Error(`${where}: that product is not in SALEANE.`)
    product ??= line.barcode ? productWithBarcode(products, line.barcode) : undefined
    if (!product && line.sku) {
      // An SKU links only when exactly one product has it.
      const sku = line.sku.toLowerCase()
      const found = products.filter((p) => p.sku.trim().toLowerCase() === sku)
      if (found.length === 1) product = found[0]
    }
    if (product) return { kind: 'product', name: product.name, productId: product.id, ...own }
    if (!line.name)
      throw new Error(`${where}: SALEANE does not know this product, so send its name too.`)
    return { kind: 'product', name: line.name, ...own }
  })
}

/** Checks what is common to a sale and a refund, and returns the lines as kept. */
function prepare(s: BusinessState, input: OtherTillSaleInput, now: string) {
  if (operations(s).mode === 'sandbox')
    throw new Error('A sample studio takes no sales from another till.')
  const site = placeOf(s, input.locationId)
  if (!site || site.archived) throw new Error('Choose an open location.')
  if (input.staffId && !s.staff.some((p) => p.id === input.staffId))
    throw new Error('That team member is not in SALEANE.')
  const at = Date.parse(input.occurredAt)
  if (at > Date.parse(now) + OTHER_TILL_CLOCK_MS)
    throw new Error('It cannot have happened later than now. Check the till’s clock.')
  if (at < Date.parse(now) - OTHER_TILL_DAYS_BACK * 86400000)
    throw new Error(`Send sales in within ${OTHER_TILL_DAYS_BACK} days of when they happened.`)
  const lines = linesFor(s, input.lines)
  const totalMinor = lines.reduce((n, line) => n + line.totalMinor, 0)
  const paid = input.payments.reduce((n, p) => n + p.amountMinor, 0)
  if (totalMinor <= 0) throw new Error('Nothing was paid on this receipt.')
  if (paid !== totalMinor)
    throw new Error(
      `The payments add up to ${paid}, but the lines add up to ${totalMinor}. Send them in minor units, tax included.`,
    )
  if (otherTillSales(s).length >= OTHER_TILL_LIMIT)
    throw new Error(
      'This studio cannot keep more sales from other tills. Write to the SALEANE team from Help.',
    )
  return { lines, totalMinor, occurredAt: new Date(at).toISOString() }
}

/** How many of a product a sale took off the shelf, less what its refunds put back. */
function onShelfFrom(s: BusinessState, sale: OtherTillSale, productId: string, also = '') {
  const ids = new Set([
    sale.id,
    also,
    ...otherTillSales(s)
      .filter((x) => x.refundOf === sale.id)
      .map((x) => x.id),
  ])
  return -operations(s)
    .movements.filter((m) => m.productId === productId && ids.has(m.otherTillSaleId ?? ''))
    .reduce((n, m) => n + m.quantity, 0)
}

/** Records a sale or a refund from another till. `next` is the working copy. */
export function runOtherTillCommand(
  next: BusinessState,
  command: OtherTillCommand,
  now: string,
  makeId: () => string,
  source: OtherTillSource | undefined,
): string {
  if (!source) throw new Error('Only another till sends these, through its access key.')
  const input = command.type === 'other-till-sale' ? command.sale : command.refund
  const kind = command.type === 'other-till-sale' ? 'sale' : 'refund'
  const { lines, totalMinor, occurredAt } = prepare(next, input, now)
  if (sentBefore(next, input.locationId, kind, input.receipt))
    throw new Error(
      `Receipt ${input.receipt.trim()} from this location is already in SALEANE, so it was not added again.`,
    )
  const o = (next.operations ??= operations(next))
  const id = makeId()
  let refundOf: string | undefined
  if (command.type === 'other-till-refund') {
    const original = sentBefore(next, input.locationId, 'sale', command.refund.refundOf)
    if (!original)
      throw new Error(
        `There is no sale with receipt ${command.refund.refundOf.trim()} from this location to give money back on.`,
      )
    const left = original.totalMinor - refundedOn(next, original.id)
    if (totalMinor > left)
      throw new Error(
        left > 0
          ? `Only ${left} is left to give back on receipt ${original.receipt}.`
          : `Everything on receipt ${original.receipt} has already been given back.`,
      )
    refundOf = original.id
    // Products go back on the shelf they came off, never more than the sale took off.
    for (const line of lines) {
      if (!line.productId) continue
      const back = Math.max(
        0,
        Math.min(line.quantity, onShelfFrom(next, original, line.productId, id)),
      )
      line.shelf = back
      if (back > 0)
        o.movements.push({
          id: makeId(),
          productId: line.productId,
          quantity: back,
          reason: 'returned',
          note: `Given back on ${source.name}, receipt ${input.receipt.trim()}`,
          createdAt: now,
          actor: source.name,
          otherTillSaleId: id,
          ...placeField(next, input.locationId),
        })
    }
  } else {
    for (const line of lines) {
      if (!line.productId) continue
      // The sale happened on the other till, so it is never refused for stock.
      const taken = Math.max(
        0,
        Math.min(line.quantity, stock(next, line.productId, input.locationId)),
      )
      line.shelf = taken
      if (taken > 0)
        o.movements.push({
          id: makeId(),
          productId: line.productId,
          quantity: -taken,
          reason: 'retail',
          note: `Sold on ${source.name}, receipt ${input.receipt.trim()}`,
          createdAt: now,
          actor: source.name,
          otherTillSaleId: id,
          ...placeField(next, input.locationId),
        })
    }
  }
  const sale: OtherTillSale = otherTillSaleSchema.parse({
    id,
    organisationId: next.organisation.id,
    kind,
    locationId: input.locationId,
    receipt: input.receipt.trim(),
    ...(refundOf ? { refundOf } : {}),
    till: { keyId: source.keyId, name: source.name },
    ...(input.staffId ? { staffId: input.staffId } : {}),
    occurredAt,
    recordedAt: now,
    currency: next.organisation.currency,
    lines,
    totalMinor,
    taxMinor: lines.reduce((n, line) => n + line.taxMinor, 0),
    payments: input.payments,
    ...(command.type === 'other-till-refund' ? { reason: command.refund.reason } : {}),
    actor: source.name,
  })
  next.otherTillSales = [...otherTillSales(next), sale]
  return id
}

/** Products the shelf was short of when a sale came in, so someone can count them. */
export function shelfShort(sale: OtherTillSale) {
  return sale.kind === 'sale'
    ? sale.lines
        .filter((line) => line.productId && (line.shelf ?? 0) < line.quantity)
        .map((line) => ({
          productId: line.productId!,
          name: line.name,
          short: line.quantity - (line.shelf ?? 0),
        }))
    : []
}

/** parseState checks: every sale adds up, names what exists, and matches the stock that moved. */
export function otherTillProblem(s: BusinessState): string | null {
  const rows = otherTillSales(s)
  if (!rows.length && !operations(s).movements.some((m) => m.otherTillSaleId)) return null
  if (rows.length > OTHER_TILL_LIMIT) return 'Too many sales from other tills.'
  const known = new Set(places(s, true).map((p) => p.id))
  const byId = new Map(rows.map((x) => [x.id, x]))
  const receipts = new Set<string>()
  const products = new Set(operations(s).products.map((p) => p.id))
  const staff = new Set(s.staff.map((p) => p.id))
  const services = new Set(s.services.map((x) => x.id))
  for (const x of rows) {
    if (x.organisationId !== s.organisation.id) return 'Foreign workspace record.'
    if (x.currency !== s.organisation.currency) return 'A sale from another till is not valid.'
    if (!known.has(x.locationId)) return 'A sale from another till names a missing location.'
    const key = `${x.locationId}|${x.kind}|${x.receipt}`
    if (receipts.has(key)) return 'A receipt from another till was recorded twice.'
    receipts.add(key)
    if (
      x.totalMinor !== x.lines.reduce((n, line) => n + line.totalMinor, 0) ||
      x.taxMinor !== x.lines.reduce((n, line) => n + line.taxMinor, 0) ||
      x.totalMinor !== x.payments.reduce((n, p) => n + p.amountMinor, 0) ||
      x.lines.some((line) => line.taxMinor > line.totalMinor) ||
      (x.staffId && !staff.has(x.staffId)) ||
      x.lines.some(
        (line) =>
          (line.serviceId && (line.kind !== 'treatment' || !services.has(line.serviceId))) ||
          (line.productId && (line.kind !== 'product' || !products.has(line.productId))) ||
          (line.shelf !== undefined && (!line.productId || line.shelf > line.quantity)),
      )
    )
      return 'A sale from another till does not add up.'
    if ((x.kind === 'refund') !== !!x.refundOf) return 'A refund from another till names no sale.'
    if (x.refundOf) {
      const original = byId.get(x.refundOf)
      if (!original || original.kind !== 'sale' || original.locationId !== x.locationId)
        return 'A refund from another till names no sale.'
    }
  }
  for (const x of rows)
    if (x.kind === 'sale' && refundedOn(s, x.id) > x.totalMinor)
      return 'More was given back than the other till took.'
  // Each line's shelf count is exactly the stock that moved for it, in the right direction.
  const moved = new Map<string, number>()
  for (const m of operations(s).movements) {
    if (!m.otherTillSaleId) continue
    const x = byId.get(m.otherTillSaleId)
    if (
      !x ||
      m.saleId ||
      m.counterSaleId ||
      m.refundId ||
      m.reason !== (x.kind === 'sale' ? 'retail' : 'returned') ||
      (x.kind === 'sale' ? m.quantity >= 0 : m.quantity <= 0) ||
      (m.locationId ?? s.organisation.locationId) !== x.locationId
    )
      return 'Stock from another till does not match its sale.'
    const key = `${x.id}|${m.productId}`
    moved.set(key, (moved.get(key) ?? 0) + Math.abs(m.quantity))
  }
  const counted = new Map<string, number>()
  for (const x of rows)
    for (const line of x.lines)
      if (line.productId && line.shelf) {
        const key = `${x.id}|${line.productId}`
        counted.set(key, (counted.get(key) ?? 0) + line.shelf)
      }
  if (moved.size !== counted.size || [...moved].some(([key, n]) => counted.get(key) !== n))
    return 'Stock from another till does not match its sale.'
  // A refund never puts back more of a product than its sale took off.
  for (const x of rows) {
    if (x.kind !== 'sale') continue
    const back = new Map<string, number>()
    for (const r of rows)
      if (r.refundOf === x.id)
        for (const line of r.lines)
          if (line.productId)
            back.set(line.productId, (back.get(line.productId) ?? 0) + (line.shelf ?? 0))
    for (const [productId, n] of back) {
      const took = x.lines
        .filter((line) => line.productId === productId)
        .reduce((sum, line) => sum + (line.shelf ?? 0), 0)
      if (n > took) return 'More went back on the shelf than the other till’s sale took off.'
    }
  }
  return null
}

/** The till's sales and refunds as the change record and Money name them. */
export function tillLabel(sale: Pick<OtherTillSale, 'kind' | 'receipt' | 'till'>) {
  return `${sale.kind === 'refund' ? 'Refund' : 'Receipt'} ${sale.receipt} from ${sale.till.name}`
}

/** The studio's own clock time it happened, in minutes after midnight. */
export function tillMinutes(s: BusinessState, sale: Pick<OtherTillSale, 'occurredAt'>) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: s.organisation.timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(sale.occurredAt))
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0)
  return part('hour') * 60 + part('minute')
}
