import { z } from 'zod'

/** V2: suppliers and the orders a studio places with them. Kept apart for the operations schema. */
const id = z.string().min(1).max(150)
export const SUPPLIER_LIMIT = 200
export const ORDER_LIMIT = 2000
export const ORDER_LINE_LIMIT = 50

export const supplierInputSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().max(200).optional(),
  phone: z.string().trim().max(40).optional(),
  note: z.string().trim().max(300).optional(),
  archived: z.boolean().optional(),
})
export const supplierSchema = supplierInputSchema.extend({ id })
export type Supplier = z.infer<typeof supplierSchema>

export const orderLinesSchema = z
  .array(z.object({ productId: id, quantity: z.number().int().min(1).max(10000) }))
  .min(1)
  .max(ORDER_LINE_LIMIT)
  .refine(
    (lines) => new Set(lines.map((l) => l.productId)).size === lines.length,
    'Each product appears once.',
  )

/**
 * An order placed with a supplier. SALEANE never sends it: the studio orders by email, phone or
 * the supplier's own site and records it here. Receiving it puts the delivered stock on the shelf.
 */
export const purchaseOrderSchema = z.object({
  id,
  number: z.string().min(1).max(40),
  supplierId: id,
  lines: orderLinesSchema,
  note: z.string().max(300).optional(),
  status: z.enum(['ordered', 'received', 'cancelled']),
  createdAt: z.iso.datetime(),
  actor: z.string(),
  /** What actually arrived, which can differ from what was ordered. */
  received: z
    .array(z.object({ productId: id, quantity: z.number().int().min(0).max(10000) }))
    .max(ORDER_LINE_LIMIT)
    .optional(),
  closedAt: z.iso.datetime().optional(),
  closedBy: z.string().optional(),
})
export type PurchaseOrder = z.infer<typeof purchaseOrderSchema>
