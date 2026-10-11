import { z } from 'zod'

/**
 * Stage 5: sales from another till. A chain that runs its own tills at a location sends each sale
 * and each refund into SALEANE through an access key. Each is recorded at that location as money
 * taken outside SALEANE, marked with the software that sent it: SALEANE never took the payment.
 * It counts in takings and Money for its location and day, takes the products it sold off the
 * shelf, earns commission for the team member it names, and cannot be recorded twice.
 */

const id = z.string().min(1).max(150)
const minor = z.number().int().nonnegative().max(100_000_000)

/** How the other till was paid. Gift cards and plans are sold in SALEANE, never sent in. */
export const otherTillMethods = ['cash', 'card', 'other'] as const
export type OtherTillMethod = (typeof otherTillMethods)[number]
export const OTHER_TILL_LINE_LIMIT = 50
export const OTHER_TILL_PAYMENT_LIMIT = 5
export const OTHER_TILL_QUANTITY_LIMIT = 999
/** How many sales and refunds one studio record keeps from other tills. */
export const OTHER_TILL_LIMIT = 100_000
/** A sale can be sent in up to this many days after it happened. */
export const OTHER_TILL_DAYS_BACK = 92
/** A till's clock may run a little ahead of the server's. */
export const OTHER_TILL_CLOCK_MS = 5 * 60000

const quantity = z.number().int().min(1).max(OTHER_TILL_QUANTITY_LIMIT)
const rate = z.number().int().min(0).max(10000)

/** One line as the other till sends it: a treatment or a product, known to SALEANE or not. */
export const otherTillLineInputSchema = z
  .object({
    kind: z.enum(['treatment', 'product']),
    /** A SALEANE treatment, when the till knows it. */
    serviceId: id.optional(),
    /** A SALEANE product, by its id, barcode or SKU, when the till knows it. */
    productId: id.optional(),
    barcode: z.string().trim().min(1).max(60).optional(),
    sku: z.string().trim().min(1).max(50).optional(),
    /** What the till calls it. Needed when SALEANE does not know it. */
    name: z.string().trim().min(1).max(100).optional(),
    quantity,
    /** What was paid for the line, tax included. */
    totalMinor: minor,
    /** The tax inside `totalMinor`. */
    taxMinor: minor,
    /** The tax rate in basis points: 2000 is 20%. */
    taxRateBps: rate,
  })
  .strict()
export type OtherTillLineInput = z.infer<typeof otherTillLineInputSchema>

export const otherTillPaymentSchema = z
  .object({ method: z.enum(otherTillMethods), amountMinor: minor.refine((n) => n > 0) })
  .strict()

const receipt = z.string().trim().min(1).max(60)
export const otherTillSaleInputSchema = z
  .object({
    locationId: id,
    /** The other till's own receipt number. */
    receipt,
    /** When it happened on the other till. */
    occurredAt: z.iso.datetime({ offset: true }),
    /** The team member who made the sale, for their commission. */
    staffId: id.optional(),
    lines: z.array(otherTillLineInputSchema).min(1).max(OTHER_TILL_LINE_LIMIT),
    payments: z.array(otherTillPaymentSchema).min(1).max(OTHER_TILL_PAYMENT_LIMIT),
  })
  .strict()
export type OtherTillSaleInput = z.infer<typeof otherTillSaleInputSchema>
export const otherTillRefundInputSchema = otherTillSaleInputSchema
  .extend({
    /** The receipt number of the sale this gives money back on, from the same location. */
    refundOf: receipt,
    reason: z.string().trim().min(2).max(300),
  })
  .strict()
export type OtherTillRefundInput = z.infer<typeof otherTillRefundInputSchema>

export const otherTillCommandSchemas = [
  /** Only the server sends these, for an access key that may send in till sales. */
  z.object({ type: z.literal('other-till-sale'), sale: otherTillSaleInputSchema }).strict(),
  z.object({ type: z.literal('other-till-refund'), refund: otherTillRefundInputSchema }).strict(),
] as const
export const OTHER_TILL_COMMANDS = ['other-till-sale', 'other-till-refund'] as const

/** One line as kept: linked to a SALEANE treatment or product when it was known. */
export const otherTillLineSchema = z
  .object({
    kind: z.enum(['treatment', 'product']),
    name: z.string().min(1).max(100),
    serviceId: id.optional(),
    productId: id.optional(),
    quantity,
    totalMinor: minor,
    taxMinor: minor,
    taxRateBps: rate,
    /**
     * How many came off the shelf (a sale) or went back on it (a refund). Fewer than the quantity
     * when SALEANE's count at the location was lower, so someone should count the stock.
     */
    shelf: z.number().int().min(0).max(OTHER_TILL_QUANTITY_LIMIT).optional(),
  })
  .strict()
export type OtherTillLine = z.infer<typeof otherTillLineSchema>

export const otherTillSaleSchema = z
  .object({
    id,
    organisationId: id,
    kind: z.enum(['sale', 'refund']),
    locationId: id,
    receipt: z.string().min(1).max(60),
    /** For a refund: the sale it gives money back on. */
    refundOf: id.optional(),
    /** The software that sent it: its access key, and the key's name at the time. */
    till: z.object({ keyId: id, name: z.string().min(1).max(60) }).strict(),
    staffId: id.optional(),
    occurredAt: z.iso.datetime(),
    recordedAt: z.iso.datetime(),
    currency: z.enum(['GBP', 'USD']),
    lines: z.array(otherTillLineSchema).min(1).max(OTHER_TILL_LINE_LIMIT),
    totalMinor: minor,
    taxMinor: minor,
    payments: z.array(otherTillPaymentSchema).min(1).max(OTHER_TILL_PAYMENT_LIMIT),
    reason: z.string().max(300).optional(),
    actor: z.string().max(200),
  })
  .strict()
export type OtherTillSale = z.infer<typeof otherTillSaleSchema>
