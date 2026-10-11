import type { Allowance } from '../../lumane'
import type { BusinessState } from './model'
import { ASK_NAME } from '../assistant/name'

/**
 * PILOT-04: SALEANE's one published price, for each location. Everything a studio uses is
 * included at this price; there are no tiers to unlock, no commission on its clients and no fee
 * to leave. Plus adds more AI time and the phone receptionist answers calls, each also per
 * location. Each location's price includes five people who take bookings; each person beyond
 * that is `personMinor` a month. Anyone who gives no treatments, such as reception or a manager,
 * is free; a manager who also gives treatments counts. The amounts are the owner's decisions (9
 * and 10 October 2026; £59 and $69 from 10 October, up from £49 and $59) and live only here, so
 * the page, the bills and their tests change together. The US amounts for the two add-ons are
 * placeholders until the owner sets them.
 */
export const PRICE = {
  UK: {
    currency: 'GBP',
    locale: 'en-GB',
    monthlyMinor: 5900,
    personMinor: 900,
    plusMinor: 3900,
    phoneMinor: 7900,
    tax: 'plus VAT',
    /** VAT on every bill, in hundredths of a percent. */
    taxRateBps: 2000,
  },
  US: {
    currency: 'USD',
    locale: 'en-US',
    monthlyMinor: 6900,
    personMinor: 1200,
    plusMinor: 4900,
    phoneMinor: 9900,
    tax: 'plus any sales tax',
    /** Sales tax depends on the state, so it is left to the payment provider's tax service. */
    taxRateBps: null,
  },
} as const
export type PriceRegion = keyof typeof PRICE

/** People who take bookings that each location's price includes. */
export const PEOPLE_PER_LOCATION = 5

/**
 * The people a studio pays for: everyone in its calendar who takes bookings, which is every
 * professional not archived with at least one treatment still offered. Reception, managers and the
 * owner are free unless they take bookings themselves. Counted across the whole studio, so a
 * group's included places are shared between its locations.
 */
export function bookingPeople(s: {
  staff: Pick<BusinessState['staff'][number], 'archived' | 'serviceIds'>[]
  services: Pick<BusinessState['services'][number], 'id' | 'archived'>[]
}) {
  const offered = new Set(s.services.filter((item) => !item.archived).map((item) => item.id))
  return s.staff.filter(
    (person) => !person.archived && person.serviceIds.some((id) => offered.has(id)),
  ).length
}

/** How many people a studio pays for beyond those its locations include. */
export function extraPeople(people: number, locations: number) {
  return Math.max(0, people - PEOPLE_PER_LOCATION * Math.max(1, Math.floor(locations)))
}

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
    monthly: { typed: 300, talkSeconds: 30 * 60, guestChats: 200, phoneSeconds: 0 },
    dailySpendCeilingMinor: 150,
    monthlySpendCeilingMinor: 2000,
    perPersonHourly: 30,
    maxTalkSessionSeconds: 10 * 60,
  },
  plus: {
    monthly: { typed: 800, talkSeconds: 150 * 60, guestChats: 500, phoneSeconds: 0 },
    dailySpendCeilingMinor: 400,
    monthlySpendCeilingMinor: 6000,
    perPersonHourly: 30,
    maxTalkSessionSeconds: 10 * 60,
  },
} satisfies Record<string, Allowance>

/**
 * What the phone receptionist adds to each location's spending limits. Its 300 minutes cost about
 * $15 of voice at 5 cents a minute, and the AI's answers about $8 more at roughly a cent a
 * question, two or three questions a minute: about $23 of a £79 add-on. The daily limit lets a
 * busy day of about an hour and a half of calls through.
 */
export const PHONE_SPEND = { dailyMinor: 600, monthlyMinor: 2500 } as const

/**
 * A studio's AI allowance: each location's amounts times its open locations, so a group with three
 * locations has three times the questions and chats. A studio that has stopped paying has none.
 * The limits on one person and one talk stay the same however big the studio is. Minutes of phone
 * calls come only with the phone receptionist.
 */
export function allowanceFor(plan: {
  locations: number
  plus: boolean
  phone?: boolean
  paused?: boolean
}): Allowance {
  const base = plan.plus ? ALLOWANCES.plus : ALLOWANCES.included
  const times = plan.paused ? 0 : Math.max(1, Math.floor(plan.locations))
  const phone = plan.phone ? times : 0
  return {
    monthly: {
      typed: base.monthly.typed * times,
      talkSeconds: base.monthly.talkSeconds * times,
      guestChats: base.monthly.guestChats * times,
      phoneSeconds: PHONE_MINUTES * 60 * phone,
    },
    dailySpendCeilingMinor: base.dailySpendCeilingMinor * times + PHONE_SPEND.dailyMinor * phone,
    monthlySpendCeilingMinor:
      base.monthlySpendCeilingMinor * times + PHONE_SPEND.monthlyMinor * phone,
    perPersonHourly: base.perPersonHourly,
    maxTalkSessionSeconds: base.maxTalkSessionSeconds,
  }
}

/**
 * NEXT-14: marketing emails each location's price includes every month (campaigns, and the
 * automatic due-back, birthday and miss-you emails), and what Plus gives instead. The owner's
 * decision, 10 October 2026. Sending costs SALEANE roughly £1 to £1.50 for every 1,000, so even
 * Plus stays well inside what a location pays. Emails about a visit (confirmations, reminders,
 * aftercare) never count.
 */
export const MARKETING_EMAILS = { included: 2000, plus: 10000 } as const

/** A studio's marketing emails this month: each location's amount, and none once it has stopped. */
export function marketingEmailsFor(plan: { locations: number; plus: boolean; paused?: boolean }) {
  if (plan.paused) return 0
  const each = plan.plus ? MARKETING_EMAILS.plus : MARKETING_EMAILS.included
  return each * Math.max(1, Math.floor(plan.locations))
}

/** Whole currency units, as the page shows them: "£59", "£9" for a person or "£39" for Plus. */
export function priceLabel(
  region: PriceRegion,
  amount: 'monthlyMinor' | 'personMinor' | 'plusMinor' | 'phoneMinor' = 'monthlyMinor',
) {
  const price = PRICE[region]
  return new Intl.NumberFormat(price.locale, {
    style: 'currency',
    currency: price.currency,
    maximumFractionDigits: 0,
  }).format(price[amount] / 100)
}

/**
 * Every feature a studio gets for that price, from the first day. Nothing here sits behind a
 * higher tier: the price limits amounts, never features. A line with `connect` works once the
 * studio connects its own card or text account, or once talking to Ask SALEANE is switched on,
 * none of which SALEANE can do yet, so the page says so beside that line rather than claiming it
 * works today.
 */
const included = ALLOWANCES.included.monthly
export const INCLUDED: readonly { text: string; connect?: 'card' | 'text' | 'voice' }[] = [
  { text: 'Your own booking page, with Google and Instagram links' },
  { text: 'Calendar, rooms and chairs, opening hours and time away' },
  { text: 'Every client remembered: notes, visits, family and referrals' },
  { text: 'Booking confirmations, reminders and aftercare by email, as many as you need' },
  { text: 'Reminders by text', connect: 'text' },
  { text: 'Marketing: newsletters, automatic messages and what they brought in' },
  { text: `${ASK_NAME}, your AI assistant, by typing` },
  { text: `Talking to ${ASK_NAME} out loud`, connect: 'voice' },
  { text: 'An AI receptionist on your booking page' },
  { text: 'Deposits and missed visit fees, kept with every visit' },
  { text: 'Saved cards, card readers and deposits paid online', connect: 'card' },
  { text: 'Money, receipts, refunds and the end-of-day till count' },
  { text: 'Your team, with the right access for each role' },
  { text: 'Help moving across from your old system' },
  { text: 'Client data exports and privacy tools' },
]
export const CONNECT_NOTES = {
  card: 'Arrives when you connect your card account',
  text: 'Arrives when you connect your text account',
  voice: `Arrives when talking to ${ASK_NAME} is switched on`,
} as const

/**
 * What each location starts with every month: the parts that cost SALEANE to run, and the people
 * included. The AI amounts come from `ALLOWANCES`, so the page and the meters cannot disagree.
 */
const thousands = (n: number) => n.toLocaleString('en-GB')
export const STARTING_AMOUNTS: readonly { amount: string; text: string }[] = [
  { amount: String(PEOPLE_PER_LOCATION), text: 'people taking bookings' },
  { amount: thousands(included.typed), text: `${ASK_NAME} questions` },
  { amount: String(included.talkSeconds / 60), text: `minutes talking to ${ASK_NAME}` },
  { amount: thousands(included.guestChats), text: 'guest chats with the AI receptionist' },
  { amount: thousands(MARKETING_EMAILS.included), text: 'marketing emails' },
]

/**
 * NEXT-02: how a location grows. None unlocks a feature; each adds more of something the studio
 * already has. `amount` names the price, and `unit` what it is charged for.
 */
const plus = ALLOWANCES.plus.monthly
export const ADD_ONS = [
  {
    id: 'plus',
    title: 'Plus',
    amount: 'plusMinor',
    unit: 'a month for each location',
    body: `More of everything that runs on AI and email: ${thousands(plus.typed)} questions, ${plus.talkSeconds / 60} minutes of talking, ${thousands(plus.guestChats)} guest chats and ${thousands(MARKETING_EMAILS.plus)} marketing emails a month.`,
  },
  {
    id: 'people',
    title: 'More people',
    amount: 'personMinor',
    unit: 'a month for each person',
    body: `For each person taking bookings beyond the ${PEOPLE_PER_LOCATION} each location includes. Anyone who gives no treatments, such as reception or a manager, is free.`,
  },
  {
    id: 'phone',
    title: 'Phone receptionist',
    amount: 'phoneMinor',
    unit: 'a month for each location',
    body: `Answers the calls your desk misses. It says it is an AI, answers questions about your treatments, prices and free times, texts callers a link to book and takes messages for the team, with ${PHONE_MINUTES} minutes of calls a month.`,
    note: 'Arrives when phone calls are connected',
  },
] as const
/** The add-ons a studio switches on for its locations in Plan and billing; extra people are counted. */
export const LOCATION_ADD_ONS = ADD_ONS.filter(
  (a): a is Extract<(typeof ADD_ONS)[number], { id: 'plus' | 'phone' }> => a.id !== 'people',
)

/** The promises the price page makes, each one something SALEANE's design already keeps. */
export const PROMISES = [
  {
    title: 'No commission on your clients',
    body: 'Clients who book through your page, Google or Instagram are yours. We never take a cut of a booking, and there is no marketplace sending them elsewhere.',
  },
  {
    title: 'Amounts, never features',
    body: 'Every studio has every feature from the first day. Growing your client list never moves you to a dearer plan; you only ever add more of what you already use.',
  },
  {
    title: 'No fee to leave',
    body: 'Pay month to month and stop whenever you like. Your clients, visits and money records can be exported first.',
  },
] as const
