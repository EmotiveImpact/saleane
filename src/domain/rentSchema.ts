import { z } from 'zod'

/** V2: chair and room rental records. Kept apart so the operations schema can use them. */
const id = z.string().min(1).max(150)
const minor = z.number().int().nonnegative().max(100_000_000)
export const RENT_LIMIT = 500
export const RENT_PAYMENT_LIMIT = 5000
export const rentMethods = ['cash', 'bank_transfer', 'external_card'] as const

/**
 * The terms of a rental. Stage 3: rent is a fixed amount each week or month, a share of the
 * renter's takings on the days they rent, or both. `amountMinor` is the fixed part (0 when there is
 * none) and `percentBps` the share, in basis points (1000 is 10%).
 */
const rentalTerms = {
  staffId: id,
  space: z.enum(['chair', 'room']),
  resourceId: id.optional(),
  amountMinor: minor,
  /** Stage 3: the share of their takings, when the rent has one. */
  percentBps: z.number().int().min(1).max(10000).optional(),
  /**
   * Stage 3: the products they sell are their own takings (and count towards the share). Absent or
   * false: products come off the studio's shelf and stay the studio's sales.
   */
  products: z.boolean().optional(),
  every: z.enum(['week', 'month']),
  from: z.iso.date(),
}
export const rentalInputSchema = z
  .object(rentalTerms)
  .refine((r) => r.amountMinor > 0 || !!r.percentBps, 'Enter the rent.')
export const rentalSchema = z.object({
  ...rentalTerms,
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
