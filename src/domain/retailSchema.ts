import { z } from 'zod'

const id = z.string().min(1).max(150)
const minor = z.number().int().nonnegative().max(100_000_000)

/** V2: the most different products one receipt carries, and of any one product. */
export const RETAIL_LINE_LIMIT = 20
export const RETAIL_QUANTITY_LIMIT = 99

/** What the desk adds to a checkout: products by ID and how many of each. */
export const retailItemsSchema = z
  .array(
    z.object({
      productId: id,
      quantity: z.number().int().min(1).max(RETAIL_QUANTITY_LIMIT),
    }),
  )
  .max(RETAIL_LINE_LIMIT)
  .refine(
    (items) => new Set(items.map((item) => item.productId)).size === items.length,
    'Each product appears once.',
  )
export type RetailItems = z.infer<typeof retailItemsSchema>

/**
 * The products on one receipt. Names and prices are copied at the moment of sale so a later price
 * change never rewrites a receipt. Tax follows the studio's setting at the time of sale, which can
 * differ from the setting the visit was booked under.
 */
export const saleRetailSchema = z.object({
  lines: z
    .array(
      z.object({
        productId: id,
        name: z.string().min(1).max(100),
        quantity: z.number().int().min(1).max(RETAIL_QUANTITY_LIMIT),
        unitMinor: minor,
      }),
    )
    .min(1)
    .max(RETAIL_LINE_LIMIT),
  subtotalMinor: minor,
  taxMinor: minor,
  taxRateBps: z.number().int().min(0).max(10000),
  taxInclusive: z.boolean(),
  taxLabel: z.string().max(40),
})
export type SaleRetail = z.infer<typeof saleRetailSchema>
