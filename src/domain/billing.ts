import { PEOPLE_PER_LOCATION, PRICE, bookingPeople, extraPeople, type PriceRegion } from './pricing'
import type { Role } from './operations'
import type { BusinessState, Staff } from './model'
import { fullDateLabel, money } from './format'
import { venueDate } from './tillCount'

/**
 * NEXT-02: what a studio pays SALEANE. A new studio has a free trial; then each month is billed
 * in advance for every open location, with Plus if the owner chose it. A failed payment is tried
 * again and the studio keeps working through a grace period; after it, or when the trial ends
 * without a card, or when the owner stops, the studio becomes read only. Nothing is ever deleted.
 * These pure parts are shared by the server, which keeps the plan, and the screens that show it.
 */
export type PlanStatus = 'trial' | 'active' | 'overdue' | 'stopped'
export type StopReason = 'trial_ended' | 'unpaid' | 'cancelled'
export type BillLine = { text: string; quantity: number; unitMinor: number; amountMinor: number }
export type Bill = {
  lines: BillLine[]
  subtotalMinor: number
  taxMinor: number
  /** "VAT at 20%", or null where tax is not worked out here (US sales tax). */
  taxLabel: string | null
  totalMinor: number
}
export type InvoiceStatus = 'open' | 'charging' | 'paid' | 'void' | 'unknown'
/** NEXT-17: what a location can add to its price, each billed for the part of a month left. */
export type AddOn = 'plus' | 'phone'
export const ADD_ON_NAMES: Record<AddOn, string> = { plus: 'Plus', phone: 'Phone receptionist' }
export type InvoiceView = Bill & {
  id: string
  number: string
  kind: 'month' | AddOn
  periodStart: number
  periodEnd: number
  currency: 'GBP' | 'USD'
  status: InvoiceStatus
  /** Made while card payments were in test mode: nothing was charged. */
  test: boolean
  detail: string | null
  createdAt: number
  paidAt: number | null
}
export type SavedCard = { brand: string; last4: string; expMonth: number; expYear: number }
type Meter = { used: number; of: number }
/** The owner's whole plan, for Settings, Plan and billing. */
export type BillingView = {
  status: PlanStatus
  stopReason: StopReason | null
  region: PriceRegion
  /** The card payment service is in test mode, so nothing is charged. */
  test: boolean
  trialEndsAt: number
  periodStart: number | null
  periodEnd: number | null
  plus: boolean
  plusNext: boolean
  /** NEXT-17: the phone receptionist, paid for now and chosen for the next bill. */
  phone: boolean
  phoneNext: boolean
  /** Calls can reach the AI on this SALEANE: a phone line, a voice and Claude are all set up. */
  phoneConnected: boolean
  cancelAtPeriodEnd: boolean
  card: SavedCard | null
  locations: number
  /** People who take bookings now, across the studio; the next bill counts them again. */
  people: number
  /** What the next bill will be if nothing changes, and when it is taken. */
  nextBill: { at: number; bill: Bill } | null
  overdue: { since: number; graceEndsAt: number; nextAttemptAt: number | null } | null
  /** A payment whose outcome is not known yet; nothing more is taken until it is. */
  checking: boolean
  /** SALEANE was restored from a backup: nothing is charged by itself until payments are checked. */
  held: boolean
  /** When a read-only studio locks (or locked), and whether it has. */
  lockAt: number | null
  locked: boolean
  /** The newest bills; `moreBills` is where the older ones start, or null when there are none. */
  invoices: InvoiceView[]
  moreBills: string | null
  ai: { typed: Meter; guestChats: Meter; talkSeconds: Meter; phoneSeconds: Meter }
}
/** What every role's studio record carries: enough for a banner, and dates only for the owner. */
export type BillingSummary = {
  readOnly: boolean
  /** A read-only studio locks on `lockAt`: only the owner can open it, and booking closes. */
  locked?: boolean
  lockAt?: number | null
  status?: PlanStatus
  stopReason?: StopReason | null
  trialEndsAt?: number
  graceEndsAt?: number
  nextAttemptAt?: number | null
  hasCard?: boolean
}

export const DAY_MS = 86400000

/** The end of a month that starts at `start`, on the plan's day of the month or the month's last. */
export function monthAfter(start: number, anchorDay: number) {
  const from = new Date(start)
  const year = from.getUTCFullYear(),
    month = from.getUTCMonth() + 1
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  return Date.UTC(
    year,
    month,
    Math.min(anchorDay, last),
    from.getUTCHours(),
    from.getUTCMinutes(),
    from.getUTCSeconds(),
    from.getUTCMilliseconds(),
  )
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** Adds tax to a bill's lines: VAT at 20% in the UK; US sales tax is left to the provider. */
export function taxed(region: PriceRegion, lines: BillLine[]): Bill {
  const subtotalMinor = lines.reduce((sum, line) => sum + line.amountMinor, 0)
  const rate = PRICE[region].taxRateBps
  const taxMinor = rate === null ? 0 : Math.round((subtotalMinor * rate) / 10000)
  return {
    lines,
    subtotalMinor,
    taxMinor,
    taxLabel: rate === null ? null : `VAT at ${rate / 100}%`,
    totalMinor: subtotalMinor + taxMinor,
  }
}

/**
 * One month in advance: every open location, each person taking bookings beyond the five each
 * location includes, and Plus and the phone receptionist for each location if chosen. People are
 * counted when the bill is made, so someone added part way through a month is first paid for on
 * the next bill.
 */
export function monthBill(
  region: PriceRegion,
  locations: number,
  plus: boolean,
  people: number,
  phone = false,
): Bill {
  const count = Math.max(1, locations)
  const price = PRICE[region]
  const where = plural(count, 'location', 'locations')
  const extra = extraPeople(people, count)
  return taxed(region, [
    {
      text: `SALEANE, ${where}`,
      quantity: count,
      unitMinor: price.monthlyMinor,
      amountMinor: price.monthlyMinor * count,
    },
    ...(extra
      ? [
          {
            text: `${plural(extra, 'more person', 'more people')} taking bookings, beyond the ${PEOPLE_PER_LOCATION * count} included`,
            quantity: extra,
            unitMinor: price.personMinor,
            amountMinor: price.personMinor * extra,
          },
        ]
      : []),
    ...(plus
      ? [
          {
            text: `Plus, ${where}`,
            quantity: count,
            unitMinor: price.plusMinor,
            amountMinor: price.plusMinor * count,
          },
        ]
      : []),
    ...(phone
      ? [
          {
            text: `Phone receptionist, ${where}`,
            quantity: count,
            unitMinor: price.phoneMinor,
            amountMinor: price.phoneMinor * count,
          },
        ]
      : []),
  ])
}

/**
 * What saving one professional does to the studio's monthly bill, in words for the team editor,
 * or '' when it stays the same. `person` is the record as it would be saved (a new one has no id
 * yet); `locations` is how many the studio has open.
 */
export function peopleChange(
  s: Pick<BusinessState, 'staff' | 'services' | 'organisation'>,
  locations: number,
  person: Pick<Staff, 'serviceIds'> & { id?: string; archived?: boolean },
) {
  const others = s.staff.filter((item) => item.id !== person.id)
  return billMoves(s, locations, {
    services: s.services,
    staff: [...others, { serviceIds: person.serviceIds, archived: person.archived ?? false }],
  })
}

/**
 * The same for saving a treatment: archiving the only treatment some people give stops them
 * counting, and bringing it back counts them again. A new treatment has no one giving it yet.
 */
export function treatmentChange(
  s: Pick<BusinessState, 'staff' | 'services' | 'organisation'>,
  locations: number,
  service: { id?: string; archived?: boolean },
) {
  if (!service.id) return ''
  return billMoves(s, locations, {
    staff: s.staff,
    services: s.services.map((item) =>
      item.id === service.id ? { ...item, archived: service.archived ?? false } : item,
    ),
  })
}

function billMoves(
  s: Pick<BusinessState, 'staff' | 'services' | 'organisation'>,
  locations: number,
  next: Parameters<typeof bookingPeople>[0],
) {
  const before = bookingPeople(s)
  const after = bookingPeople(next)
  const change = extraPeople(after, locations) - extraPeople(before, locations)
  if (!change) return ''
  const region = s.organisation.region
  const amount = money(Math.abs(change) * PRICE[region].personMinor, s.organisation)
  const where = locations === 1 ? 'your location includes' : `your ${locations} locations include`
  const included = PEOPLE_PER_LOCATION * Math.max(1, locations)
  return change > 0
    ? `Saving makes ${plural(after, 'person', 'people')} taking bookings, and ${where} ${included}, so the monthly bill goes up by ${amount}, ${PRICE[region].tax}, from the next bill.`
    : `Saving brings the people taking bookings to ${after}, so the monthly bill goes down by ${amount}, ${PRICE[region].tax}, from the next bill.`
}

/** Plus added part way through a paid month: only the part of the month that is left. */
export const plusBill = (
  region: PriceRegion,
  locations: number,
  from: number,
  periodStart: number,
  periodEnd: number,
) => addOnBill('plus', region, locations, from, periodStart, periodEnd)

/** An add-on chosen part way through a paid month: only the part of the month that is left. */
export function addOnBill(
  addOn: AddOn,
  region: PriceRegion,
  locations: number,
  from: number,
  periodStart: number,
  periodEnd: number,
): Bill {
  const count = Math.max(1, locations)
  const unit = PRICE[region][addOn === 'plus' ? 'plusMinor' : 'phoneMinor']
  const share = Math.min(1, Math.max(0, (periodEnd - from) / (periodEnd - periodStart)))
  const days = Math.max(1, Math.ceil((periodEnd - from) / DAY_MS))
  const all = Math.round((periodEnd - periodStart) / DAY_MS)
  return taxed(region, [
    {
      text: `${ADD_ON_NAMES[addOn]}, ${plural(count, 'location', 'locations')}, for the ${plural(days, 'day', 'days')} left of ${all}`,
      quantity: count,
      unitMinor: unit,
      amountMinor: Math.round(unit * count * share),
    },
  ])
}

/** The next retry after a payment first failed at `since`, or null when none are left. */
export function nextRetry(since: number, now: number, retryDays: readonly number[]) {
  const next = retryDays.map((d) => since + d * DAY_MS).find((at) => at > now)
  return next ?? null
}

/** The one message a refused change shows while a studio is read only. */
export function readOnlyMessage(role: Role) {
  return role === 'owner'
    ? 'This studio is read only until its SALEANE bill is paid. Nothing has been lost, and guests can still book. Pay in Settings, Plan and billing.'
    : 'This studio is read only until the owner pays its SALEANE bill. Nothing has been lost, and guests can still book.'
}

/** What everyone but the owner is told, and the owner on anything but paying, once a studio locks. */
export function lockedMessage(role: Role) {
  return role === 'owner'
    ? 'This studio is locked until its SALEANE bill is paid. Nothing has been deleted. Pay in Plan and billing to open it again for everyone.'
    : 'This studio is locked until the owner pays its SALEANE bill. Nothing has been deleted.'
}

/** A day in the studio's own calendar, as words: "20 October 2026". */
export function planDate(org: BusinessState['organisation'], at: number) {
  return fullDateLabel(venueDate(org.timeZone, new Date(at).toISOString()), org.locale)
}

/** How many days of a trial are left, counting part of a day as a day. */
export const trialDaysLeft = (trialEndsAt: number, now: number) =>
  Math.max(0, Math.ceil((trialEndsAt - now) / DAY_MS))

export type BillingNotice = {
  tone: 'stopped' | 'due' | 'soon'
  text: string
  /** What the owner's button does; nobody else gets one. */
  action?: 'Add a card' | 'Pay now' | 'Start again'
}
/**
 * NEXT-02: the line across the top of the studio about its plan, or nothing. Everyone sees that a
 * read-only studio is read only; only the owner hears about a trial ending or a payment failing.
 */
export function billingNotice(
  billing: BillingSummary | null | undefined,
  role: Role,
  org: BusinessState['organisation'],
  now: number,
): BillingNotice | null {
  if (!billing) return null
  const kept = 'Nothing has been lost, and guests can still book.'
  if (billing.readOnly) {
    const lock =
      billing.lockAt && !billing.locked
        ? role === 'owner'
          ? ` On ${planDate(org, billing.lockAt)} it locks: only you will be able to open it, and online booking closes.`
          : ` On ${planDate(org, billing.lockAt)} it locks, and only the owner will be able to open it.`
        : ''
    if (role !== 'owner')
      return {
        tone: 'stopped',
        text: `This studio is read only until the owner pays its SALEANE bill. You can still see everything. ${kept}${lock}`,
      }
    if (billing.stopReason === 'trial_ended')
      return {
        tone: 'stopped',
        text: `Your free trial has ended, so the studio is read only. ${kept}${lock}`,
        action: billing.hasCard ? 'Pay now' : 'Add a card',
      }
    if (billing.stopReason === 'cancelled')
      return {
        tone: 'stopped',
        text: `Your SALEANE plan has stopped, so the studio is read only. ${kept}${lock}`,
        action: 'Start again',
      }
    return {
      tone: 'stopped',
      text: `The SALEANE bill is unpaid, so the studio is read only. ${kept}${lock}`,
      action: 'Pay now',
    }
  }
  if (role !== 'owner') return null
  if (billing.status === 'overdue' && billing.graceEndsAt)
    return {
      tone: 'due',
      text: `We could not take this month’s SALEANE payment. Pay, or use another card, by ${planDate(org, billing.graceEndsAt)} to keep everything working.`,
      action: 'Pay now',
    }
  if (billing.status === 'trial' && billing.trialEndsAt && !billing.hasCard) {
    const left = trialDaysLeft(billing.trialEndsAt, now)
    if (left <= 7)
      return {
        tone: 'soon',
        text: `Your free trial ends on ${planDate(org, billing.trialEndsAt)}. Add a card to carry on without a break.`,
        action: 'Add a card',
      }
  }
  return null
}
