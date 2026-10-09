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

/**
 * Everything a studio gets for that price. Nothing here sits behind a higher tier. A line with
 * `connect` works once the studio connects its own card or text account, which SALEANE cannot do
 * for it yet, so the page says so beside that line rather than claiming it works today.
 */
export const INCLUDED: readonly { text: string; connect?: 'card' | 'text' }[] = [
  { text: 'Your own booking page, with Google and Instagram links' },
  { text: 'Calendar, rooms and chairs, opening hours and time away' },
  { text: 'Every client remembered: notes, visits, family and referrals' },
  { text: 'Booking confirmations and reminders by email' },
  { text: 'Reminders by text', connect: 'text' },
  { text: 'Deposits and missed visit fees, kept with every visit' },
  { text: 'Saved cards, card readers and deposits paid online', connect: 'card' },
  { text: 'Money, receipts, refunds and the end-of-day till count' },
  { text: 'Help moving across from your old system' },
  { text: 'Your whole team, with the right access for each role' },
  { text: 'Client data exports and privacy tools' },
]
export const CONNECT_NOTES = {
  card: 'Arrives when you connect your card account',
  text: 'Arrives when you connect your text account',
} as const

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
