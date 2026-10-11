import { z } from 'zod'
import { paymentMethodSchema, processorSchema } from './paymentMethods'

/**
 * V1.5: packages and memberships. A studio offers them (an offer), and a client holds one once
 * bought (a holding). Each holding keeps a copy of the terms it was sold under, its own payments,
 * the visits it covered and any refund, so later changes to the offer never rewrite what a client
 * bought. Nothing is ever deleted: a holding ends by being cancelled or by expiring.
 */
const id = z.string().min(1).max(150)
const minor = z.number().int().nonnegative().max(100_000_000)
const civilDate = z.iso.date()

export const offerInputSchema = z
  .object({
    kind: z.enum(['package', 'membership']),
    name: z.string().trim().min(2).max(100),
    /** The services it covers. */
    serviceIds: z.array(id).min(1).max(100),
    /** A package: visits in total. A membership: visits included each month (0 for none). */
    visits: z.number().int().min(0).max(100),
    /** A package: its one price. A membership: its monthly price. Tax, if any, is inside it. */
    priceMinor: minor.refine((n) => n > 0, 'Enter a price above zero.'),
    /** A membership's discount on other visits; a package has none. */
    discountPercent: z.number().int().min(0).max(50),
    /** How long a package lasts from the day it is bought. */
    validMonths: z.number().int().min(1).max(36),
    archived: z.boolean(),
  })
  .refine((o) => o.kind === 'membership' || o.visits >= 1, 'A package includes at least one visit.')
  .refine(
    (o) => o.kind === 'membership' || o.discountPercent === 0,
    'Only a membership gives a discount.',
  )
  .refine(
    (o) => o.kind === 'package' || o.visits > 0 || o.discountPercent > 0,
    'A membership includes visits each month, a discount, or both.',
  )
export type OfferInput = z.infer<typeof offerInputSchema>
export const offerSchema = z
  .object({ id, organisationId: id, createdAt: z.iso.datetime() })
  .and(offerInputSchema)
export type Offer = z.infer<typeof offerSchema>

const planPaymentSchema = z.object({
  id,
  amountMinor: minor,
  method: paymentMethodSchema,
  reference: z.string().max(150).optional(),
  recordedAt: z.iso.datetime(),
  /** A membership payment pays for the month starting on this date. */
  periodStart: civilDate.optional(),
  /** Stage 1: set only when the payment provider took it from the client's saved card. */
  processor: processorSchema.optional(),
})
const planUseSchema = z.object({
  id,
  appointmentId: id,
  saleId: id,
  /** The part of the plan's price this visit used. */
  valueMinor: minor,
  usedAt: z.iso.datetime(),
  periodStart: civilDate.optional(),
})
const planRefundSchema = z.object({
  id,
  amountMinor: minor.refine((n) => n > 0),
  method: paymentMethodSchema,
  reference: z.string().trim().min(1).max(150),
  reason: z.string().trim().min(2).max(300),
  createdAt: z.iso.datetime(),
  actor: z.string(),
  /** Stage 1: set only when the payment provider returned it to the card it came from. */
  processor: processorSchema.optional(),
})

/**
 * Stage 1: the client's agreement that a membership is paid each month from one saved card. It
 * keeps which card (the provider's own references stay on the server), the exact words the client
 * agreed to, when and who recorded it, and the first month the card pays. It is never removed:
 * turning card payments off, removing the card or ending the plan closes it.
 */
export const cardAgreementSchema = z.object({
  id,
  cardId: id,
  brand: z.string().trim().min(1).max(40),
  last4: z.string().regex(/^\d{4}$/),
  wording: z.string().trim().min(20).max(1000),
  agreedAt: z.iso.datetime(),
  recordedBy: z.string(),
  /** The first month the card pays: the first due date at least three days after agreeing. */
  startsOn: civilDate,
  endedAt: z.iso.datetime().optional(),
  endedBy: z.string().optional(),
  /** Turned off by staff, the card removed, the plan ended, or another card agreed instead. */
  endReason: z.enum(['turned_off', 'card_removed', 'plan_ended', 'replaced']).optional(),
})
export type CardAgreement = z.infer<typeof cardAgreementSchema>

export const holdingSchema = z.object({
  id,
  organisationId: id,
  clientId: id,
  offerId: id,
  kind: z.enum(['package', 'membership']),
  /** The terms when it was bought. */
  name: z.string().min(2).max(100),
  serviceIds: z.array(id).min(1),
  visits: z.number().int().min(0).max(100),
  priceMinor: minor,
  discountPercent: z.number().int().min(0).max(50),
  startedOn: civilDate,
  /** A package's last day. */
  endsOn: civilDate.optional(),
  /** A membership's next unpaid month starts on this date. */
  paidUntil: civilDate.optional(),
  status: z.enum(['active', 'cancelled']),
  cancelled: z
    .object({ at: z.iso.datetime(), actor: z.string(), reason: z.string().min(2).max(300) })
    .optional(),
  soldAt: z.iso.datetime(),
  actor: z.string(),
  /** V2: the location that sold it, when not the main one. Older plans have none. */
  locationId: id.optional(),
  payments: z.array(planPaymentSchema),
  uses: z.array(planUseSchema),
  refunds: z.array(planRefundSchema),
  /** Stage 1: a membership paid each month from a saved card; the last one may still be open. */
  cardAgreements: z.array(cardAgreementSchema).optional(),
})
export type Holding = z.infer<typeof holdingSchema>
