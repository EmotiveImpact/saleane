import { z } from 'zod'
import { paymentMethodSchema } from './paymentMethods'

/**
 * V1.5: gift cards and vouchers. A gift card holds an amount of money; a voucher is bought for a
 * named treatment and holds that treatment's price on the day it was sold. Both are spent at the
 * desk against any visit until they run out or expire. Money paid for one is held for the person
 * who will spend it, so it counts as takings only when it pays for a visit. Nothing is deleted: a
 * card ends by being used up, expiring or being cancelled, and its history stays.
 */
const id = z.string().min(1).max(150)
const minor = z.number().int().nonnegative().max(100_000_000)
const civilDate = z.iso.date()

/** Twelve letters and numbers in three groups. Letters that look alike (O and 0, I and 1) are left out. */
export const GIFT_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export const giftCodeSchema = z
  .string()
  .regex(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/, 'Enter the 12-character code.')
/**
 * A card carried over from the studio's old system keeps the code already printed on it, so cards
 * in guests' purses still work. It is kept as the desk would type it: capitals and numbers, with
 * twelve characters grouped in fours like SALEANE's own.
 */
export const CARRIED_CODE = /^(?:[A-Z0-9]{4,40}|[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4})$/
const carriedCodeSchema = z.string().regex(CARRIED_CODE)
/** A carried-over card with no last day in the old system is kept for this long, and can be given more. */
export const CARRIED_NO_EXPIRY_MONTHS = 120

/** What the desk enters to sell one. */
export const giftCardInputSchema = z
  .object({
    kind: z.enum(['money', 'service']),
    /** A voucher's treatment; its price on the day becomes the card's value. */
    serviceId: id.optional(),
    /** A money card's value; a voucher takes the treatment's price instead. */
    valueMinor: minor.optional(),
    /** Who bought it. When they are a client here, their record links to it. */
    clientId: id.optional(),
    purchaserName: z.string().trim().min(2).max(100),
    recipientName: z.string().trim().max(100),
    message: z.string().trim().max(300),
  })
  .refine(
    (input) => (input.kind === 'service') === !!input.serviceId,
    'A voucher names one treatment; a gift card names none.',
  )
  .refine(
    (input) => input.kind === 'service' || (input.valueMinor ?? 0) > 0,
    'Enter an amount above zero.',
  )
export type GiftCardInput = z.infer<typeof giftCardInputSchema>

const redemptionSchema = z.object({
  id,
  saleId: id,
  appointmentId: id,
  amountMinor: minor.refine((n) => n > 0),
  at: z.iso.datetime(),
})
const giftRefundSchema = z.object({
  id,
  amountMinor: minor.refine((n) => n > 0),
  method: paymentMethodSchema,
  reference: z.string().trim().min(1).max(150),
  reason: z.string().trim().min(2).max(300),
  createdAt: z.iso.datetime(),
  actor: z.string(),
})

/**
 * Stage 4: a card moved to another location, with why and who moved it. The card belongs to the
 * last move's location from then on; where it was sold never changes, so money already taken and
 * spent stays where it happened. Moves are only ever added.
 */
export const GIFT_MOVE_LIMIT = 50
export const GIFT_MOVE_REASON_LIMIT = 300
const giftMoveSchema = z
  .object({
    id,
    /** Where it belonged before, and where it belongs now, both named in full. */
    from: id,
    to: id,
    reason: z.string().trim().min(2).max(GIFT_MOVE_REASON_LIMIT),
    at: z.iso.datetime(),
    actor: z.string(),
  })
  .strict()
export const giftCardMoveCommandSchema = z
  .object({
    type: z.literal('gift-card-move'),
    giftCardId: id,
    /** The location it moves to. */
    locationId: id,
    reason: z.string().trim().min(2).max(GIFT_MOVE_REASON_LIMIT),
  })
  .strict()

/**
 * Moving in, stage 3: a card the studio sold in its old system, brought across with what was left
 * to spend on it. Its value is that balance, recorded as paid to the old system, so it is money the
 * studio holds for the guest and never counted as a sale here.
 */
const carriedGiftSchema = z
  .object({
    /** The import that brought it across, with the old system's name. */
    importId: id,
    /** What it was bought for in the old system, when the file says. */
    valueBeforeMinor: minor.optional(),
    /** The old system gave it no last day; SALEANE keeps it for ten years, and can give more. */
    noExpiry: z.literal(true).optional(),
    /** What the old system showed of a code SALEANE could not keep, such as "ending 4821". */
    codeBefore: z.string().min(1).max(40).optional(),
  })
  .strict()

export const giftCardSchema = z.object({
  id,
  organisationId: id,
  code: z.union([giftCodeSchema, carriedCodeSchema]),
  kind: z.enum(['money', 'service']),
  serviceId: id.optional(),
  /** The treatment's name when it was sold, kept even if the service is renamed or archived. */
  serviceName: z.string().max(100).optional(),
  valueMinor: minor.refine((n) => n > 0),
  clientId: id.optional(),
  purchaserName: z.string().min(2).max(100),
  recipientName: z.string().max(100),
  message: z.string().max(300),
  issuedOn: civilDate,
  /** The last day it can be spent. */
  expiresOn: civilDate,
  soldAt: z.iso.datetime(),
  actor: z.string(),
  /** V2: the location that sold it, when not the main one. Older cards have none. */
  locationId: id.optional(),
  payment: z.object({
    id,
    amountMinor: minor,
    method: paymentMethodSchema,
    reference: z.string().max(150).optional(),
    recordedAt: z.iso.datetime(),
  }),
  redemptions: z.array(redemptionSchema),
  /** Earlier expiry dates, kept when a manager gives more time. */
  extensions: z.array(
    z.object({ from: civilDate, to: civilDate, at: z.iso.datetime(), actor: z.string() }),
  ),
  status: z.enum(['active', 'cancelled']),
  cancelled: z
    .object({ at: z.iso.datetime(), actor: z.string(), reason: z.string().min(2).max(300) })
    .optional(),
  refunds: z.array(giftRefundSchema),
  /** Stage 4: each move to another location, oldest first. */
  moves: z.array(giftMoveSchema).max(GIFT_MOVE_LIMIT).optional(),
  /** Moving in, stage 3: brought across from the old system rather than sold here. */
  carried: carriedGiftSchema.optional(),
})
export type GiftCard = z.infer<typeof giftCardSchema>
