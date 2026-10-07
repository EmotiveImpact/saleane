import { z } from 'zod'

/** V2: chair and room rental records. Kept apart so the operations schema can use them. */
const id = z.string().min(1).max(150)
const minor = z.number().int().nonnegative().max(100_000_000)
export const RENT_LIMIT = 500
export const RENT_PAYMENT_LIMIT = 5000
export const rentMethods = ['cash', 'bank_transfer', 'external_card'] as const

export const rentalInputSchema = z.object({
  staffId: id,
  space: z.enum(['chair', 'room']),
  resourceId: id.optional(),
  amountMinor: minor.refine((n) => n > 0, 'Enter the rent.'),
  every: z.enum(['week', 'month']),
  from: z.iso.date(),
})
export const rentalSchema = rentalInputSchema.extend({
  id,
  /** The last day of the agreement once it has ended. */
  to: z.iso.date().optional(),
  createdAt: z.iso.datetime(),
  actor: z.string(),
})
export type Rental = z.infer<typeof rentalSchema>

export const rentPaymentSchema = z.object({
  id,
  rentalId: id,
  periodStart: z.iso.date(),
  amountMinor: minor.refine((n) => n > 0),
  method: z.enum(rentMethods),
  reference: z.string().max(150).optional(),
  paidAt: z.iso.datetime(),
  actor: z.string(),
})
export type RentPayment = z.infer<typeof rentPaymentSchema>
