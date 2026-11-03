import { z } from 'zod'

const id = z.string().min(1).max(150)
const money = z.number().int().nonnegative().max(100_000_000)

/**
 * Stage 5: a lower price for a quiet time. The owner chooses whether an invitation to a quiet time
 * (Today's open times) or to a time a cancellation freed carries a lower price: none, a percentage
 * off or an amount off, with treatments left out, how long each offer stays open and a price no
 * offer goes below. The price is fixed on the invitation when it is written; changing the setting
 * never changes an invitation already written. Each offer is for its exact time and is used once,
 * through a private link only the server can read (see quietOffers.ts and server/offers.ts).
 */
export const OFFER_HOURS = [12, 24, 48, 72] as const
export const OFFER_PERCENT_MIN = 5
export const OFFER_PERCENT_MAX = 75
export const offerDiscounts = ['none', 'percent', 'amount'] as const
export type OfferDiscount = (typeof offerDiscounts)[number]

/** Where the private offer token goes in an invitation: straight after its booking link. */
export const OFFER_LINK = '{{offer_link}}'

const unique = (ids: string[]) => new Set(ids).size === ids.length

export const quietOfferSettingsSchema = z
  .object({
    /** None (the default), a percentage off, or an amount off. */
    discount: z.enum(offerDiscounts),
    offPercent: z.number().int().min(OFFER_PERCENT_MIN).max(OFFER_PERCENT_MAX),
    offMinor: money.refine((value) => value > 0, 'Enter an amount off above zero.'),
    /** No offer goes below this price (before any tax added on top). Zero means only never below free. */
    floorMinor: money,
    /** How long an offer stays open once written, and never past the time itself. */
    openHours: z.union([z.literal(12), z.literal(24), z.literal(48), z.literal(72)]),
    /** Treatments that never carry a lower price. */
    leftOutIds: z.array(id).max(500).refine(unique, 'Choose each treatment once.'),
  })
  .strict()
export type QuietOfferSettings = z.infer<typeof quietOfferSettingsSchema>
export const defaultQuietOffers: QuietOfferSettings = {
  discount: 'none',
  offPercent: 20,
  offMinor: 1000,
  floorMinor: 0,
  openHours: 24,
  leftOutIds: [],
}

/**
 * The lower price an invitation carries, fixed when it was written: the price, the usual price it
 * is below (both as booked, before any tax added on top) and when it ends.
 */
export const messageOfferSchema = z
  .object({
    priceMinor: money,
    usualPriceMinor: money,
    endsAt: z.iso.datetime(),
  })
  .strict()
  .refine((offer) => offer.priceMinor < offer.usualPriceMinor, 'An offer is below the usual price.')
export type MessageOffer = z.infer<typeof messageOfferSchema>

/** On a visit booked with an offer: which invitation it came from and the usual price then. */
export const bookedOfferSchema = z.object({ messageId: id, usualPriceMinor: money }).strict()
export type BookedOffer = z.infer<typeof bookedOfferSchema>

export const quietOfferCommandSchemas = [
  /** The owner's setting. */
  z.object({ type: z.literal('quiet-offers'), settings: quietOfferSettingsSchema }).strict(),
  /** An invitation to one of Today's open times, carrying the lower price the setting gives it. */
  z
    .object({
      type: z.literal('offer-invite'),
      clientId: id,
      serviceId: id,
      staffId: id,
      date: z.iso.date(),
      startMinutes: z.number().int().min(0).max(1439),
      /** Absent means wherever the professional works that day. */
      locationId: id.optional(),
    })
    .strict(),
] as const
