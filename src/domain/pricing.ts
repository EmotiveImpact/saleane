/**
 * PILOT-04: SALEANE's one published price. Everything a studio uses is included at this price;
 * there are no tiers to unlock, no commission on its clients and no fee to leave. The amount is
 * the owner's decision and lives only here, so the page and its tests change together.
 */
export const PRICE = {
  UK: { currency: 'GBP', locale: 'en-GB', monthlyMinor: 4900, tax: 'plus VAT' },
  US: { currency: 'USD', locale: 'en-US', monthlyMinor: 5900, tax: 'plus any sales tax' },
} as const
export type PriceRegion = keyof typeof PRICE

/** Whole currency units, as the page shows them: "£49". */
export function priceLabel(region: PriceRegion) {
  const price = PRICE[region]
  return new Intl.NumberFormat(price.locale, {
    style: 'currency',
    currency: price.currency,
    maximumFractionDigits: 0,
  }).format(price.monthlyMinor / 100)
}

/** Everything a studio gets for that price. Nothing here sits behind a higher tier. */
export const INCLUDED = [
  'Your own booking page, with Google and Instagram links',
  'Calendar, rooms and chairs, opening hours and time away',
  'Every client remembered: notes, visits, family and referrals',
  'Booking confirmations and reminders by email and text',
  'Deposits, saved cards, card readers and missed visit fees',
  'Money, receipts, refunds and the end-of-day till count',
  'Help moving across from your old system',
  'Your whole team, with the right access for each role',
  'Client data exports and privacy tools',
] as const

/** The promises the price page makes, each one something SALEANE's design already keeps. */
export const PROMISES = [
  {
    title: 'No commission on your clients',
    body: 'Clients who book through your page, Google or Instagram are yours. We never take a cut of a booking, and there is no marketplace sending them elsewhere.',
  },
  {
    title: 'No locked tiers',
    body: 'Every studio has every feature. Growing your team or your client list does not move you to a dearer plan.',
  },
  {
    title: 'No fee to leave',
    body: 'Pay month to month and stop whenever you like. Your clients, visits and money records can be exported first.',
  },
] as const
