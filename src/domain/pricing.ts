import type { Allowance } from '../../lumane'

/**
 * PILOT-04: SALEANE's one published price, for each location. Everything a studio uses is
 * included at this price; there are no tiers to unlock, no commission on its clients and no fee
 * to leave. Plus adds more AI time and the phone receptionist answers calls, each also per
 * location. The amounts are the owner's decision (9 October 2026) and live only here, so the page,
 * the bills and their tests change together. The US amounts for the two add-ons are placeholders
 * until the owner sets them.
 */
export const PRICE = {
  UK: {
    currency: 'GBP',
    locale: 'en-GB',
    monthlyMinor: 4900,
    plusMinor: 3900,
    phoneMinor: 7900,
    tax: 'plus VAT',
    /** VAT on every bill, in hundredths of a percent. */
    taxRateBps: 2000,
  },
  US: {
    currency: 'USD',
    locale: 'en-US',
    monthlyMinor: 5900,
    plusMinor: 4900,
    phoneMinor: 9900,
    tax: 'plus any sales tax',
    /** Sales tax depends on the state, so it is left to the payment provider's tax service. */
    taxRateBps: null,
  },
} as const
export type PriceRegion = keyof typeof PRICE

/** NEXT-02: a new studio's free days, before any card is asked for. */
export const TRIAL_DAYS = 14
/** Days after a failed payment before the studio becomes read only. */
export const GRACE_DAYS = 14
/**
 * Days after the last day paid for (a missed payment, or the end of a trial or plan) before a
 * read-only studio locks: only the owner can open it, to pay or download its records, and online
 * booking closes. The owner's decision, 9 October 2026.
 */
export const LOCK_DAYS = 30
/** Days after the first failed payment on which the card is tried again. */
export const RETRY_DAYS = [1, 3, 7] as const
/** Minutes of calls the phone receptionist includes each month, for each location. */
export const PHONE_MINUTES = 300

/**
 * The AI each location's price includes, and what Plus gives instead. Every amount here costs the
 * business at most about half what it earns, so heavy use never loses money. The monthly spend
 * ceiling (about $20, or $60 with Plus) is nearly twice what a busy location's included use costs,
 * so normal use never meets it, and keeps a location that reached the daily ceiling every day
 * from costing more than it pays (10 October 2026).
 */
export const ALLOWANCES = {
  included: {
    monthly: { typed: 300, talkSeconds: 30 * 60, guestChats: 200 },
    dailySpendCeilingMinor: 150,
    monthlySpendCeilingMinor: 2000,
    perPersonHourly: 30,
    maxTalkSessionSeconds: 10 * 60,
  },
  plus: {
    monthly: { typed: 800, talkSeconds: 150 * 60, guestChats: 500 },
    dailySpendCeilingMinor: 400,
    monthlySpendCeilingMinor: 6000,
    perPersonHourly: 30,
    maxTalkSessionSeconds: 10 * 60,
  },
} satisfies Record<string, Allowance>

/**
 * A studio's AI allowance: each location's amounts times its open locations, so a group with three
 * locations has three times the questions and chats. A studio that has stopped paying has none.
 * The limits on one person and one talk stay the same however big the studio is.
 */
export function allowanceFor(plan: {
  locations: number
  plus: boolean
  paused?: boolean
}): Allowance {
  const base = plan.plus ? ALLOWANCES.plus : ALLOWANCES.included
  const times = plan.paused ? 0 : Math.max(1, Math.floor(plan.locations))
  return {
    monthly: {
      typed: base.monthly.typed * times,
      talkSeconds: base.monthly.talkSeconds * times,
      guestChats: base.monthly.guestChats * times,
    },
    dailySpendCeilingMinor: base.dailySpendCeilingMinor * times,
    monthlySpendCeilingMinor: base.monthlySpendCeilingMinor * times,
    perPersonHourly: base.perPersonHourly,
    maxTalkSessionSeconds: base.maxTalkSessionSeconds,
  }
}

/** Whole currency units, as the page shows them: "£49", or "£39" for Plus. */
export function priceLabel(
  region: PriceRegion,
  amount: 'monthlyMinor' | 'plusMinor' | 'phoneMinor' = 'monthlyMinor',
) {
  const price = PRICE[region]
  return new Intl.NumberFormat(price.locale, {
    style: 'currency',
    currency: price.currency,
    maximumFractionDigits: 0,
  }).format(price[amount] / 100)
}

/**
 * Everything a studio gets for that price. Nothing here sits behind a higher tier. A line with
 * `connect` works once the studio connects its own card or text account, or once talking to Ask
 * Saleane is switched on, none of which SALEANE can do yet, so the page says so beside that line
 * rather than claiming it works today. The AI amounts come from `ALLOWANCES`.
 */
const included = ALLOWANCES.included.monthly
export const INCLUDED: readonly { text: string; connect?: 'card' | 'text' | 'voice' }[] = [
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
  { text: `Ask Saleane, your AI assistant: ${included.typed} typed questions a month` },
  {
    text: `Talking to Ask Saleane: ${included.talkSeconds / 60} minutes a month`,
    connect: 'voice',
  },
  {
    text: `An AI receptionist on your booking page: ${included.guestChats} guest chats a month`,
  },
]
export const CONNECT_NOTES = {
  card: 'Arrives when you connect your card account',
  text: 'Arrives when you connect your text account',
  voice: 'Arrives when talking to Ask Saleane is switched on',
} as const

/** NEXT-02: what a location can add to its price. Neither unlocks a feature; each adds capacity. */
const plus = ALLOWANCES.plus.monthly
export const ADD_ONS = [
  {
    id: 'plus',
    title: 'Plus',
    amount: 'plusMinor',
    body: `For busy studios: ${plus.typed} typed questions, ${plus.talkSeconds / 60} minutes of talking and ${plus.guestChats} guest chats a month, instead of ${included.typed}, ${included.talkSeconds / 60} and ${included.guestChats}.`,
  },
  {
    id: 'phone',
    title: 'Phone receptionist',
    amount: 'phoneMinor',
    body: `Answers calls to your studio and books visits, with ${PHONE_MINUTES} minutes of calls a month.`,
    note: 'Arrives when phone calls are connected',
  },
] as const

/** The promises the price page makes, each one something SALEANE's design already keeps. */
export const PROMISES = [
  {
    title: 'No commission on your clients',
    body: 'Clients who book through your page, Google or Instagram are yours. We never take a cut of a booking, and there is no marketplace sending them elsewhere.',
  },
  {
    title: 'No locked tiers',
    body: 'Every studio has every feature. Growing your team or your client list does not move you to a dearer plan; you pay for each location, and only Plus adds more AI time.',
  },
  {
    title: 'No fee to leave',
    body: 'Pay month to month and stop whenever you like. Your clients, visits and money records can be exported first.',
  },
] as const
