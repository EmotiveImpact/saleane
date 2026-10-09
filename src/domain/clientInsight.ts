import type { Appointment, BusinessState, Client } from './model'
import { addDays } from './format'
import { serviceRevenue, usualWeeks } from './selectors'
import { driftDays } from './insights'
import { dueBackOn } from './dueBack'
import { retailRevenue } from './retail'
import { recordDay } from './tillCount'
import { clientHoldings, offers, openCardAgreement, planStanding } from './plans'
import type { PatchTestState } from './patchTests'
import { patchTestStanding, serviceNeedsPatchTest, visitPatchTest } from './patchTests'
import { GUEST_CANCEL_CUTOFF_HOURS } from './guest'
import { instantFor, operations } from './operations'

/**
 * "At a glance" on the client page: what this client is like and what to do next, worked out
 * from the studio record. It reuses the rules the rest of SALEANE already uses, so the client page
 * never disagrees with Today or the Business page:
 *
 * - the usual gap is `usualWeeks` (the same as the page heading and Today's drifting list);
 * - drifting away is `driftDays` from insights.ts, as in Today's "Drifting away";
 * - due back is `dueBackOn` from dueBack.ts, as in Today's "Ready to return";
 * - money counts as the Business page counts takings (see `spend`);
 * - a missed visit is a no-show, and a late cancellation is one cancelled less than
 *   GUEST_CANCEL_CUTOFF_HOURS before it started, as for the studio's fee (fees.ts);
 * - rebooking is an explicit link made at checkout, as in the Business page's rebooking figure.
 *
 * Every fact is left out, rather than guessed, when the history is too thin. Nothing here changes
 * the record or contacts anyone: the suggested next step only opens an existing screen, or a draft
 * that staff read and approve.
 *
 * The work is one pass over each collection to find this client's own visits and receipts, so it
 * stays quick in a studio with thousands of visits.
 */

const DAY = 86_400_000
/** "In the last 12 months": the same year as the page's "A year with the studio" track. */
const YEAR_DAYS = 364
/** Fewer completed visits than this and the client is new: nothing about habits is said. */
const SETTLED_VISITS = 2
/** A favourite needs at least this many visits in the year to choose from. */
const FAVOURITE_FROM = 3
/** A day or time of day counts as a habit from this many visits, two thirds of them alike. */
const PATTERN_FROM = 4
/** Rebooking is described from this many visits in the year. */
const REBOOKING_FROM = 3
/** A clean record is mentioned only once the client has kept this many visits in the year. */
const RELIABLE_FROM = 3
/** "Comes every month": a usual gap of this many weeks or fewer. */
const MONTHLY_WEEKS = 5
/** The months looked at to compare a client's spending with a membership. */
const MEMBERSHIP_MONTHS = 3
/** At least this many covered visits in those months. */
const MEMBERSHIP_VISITS = 3
/** Morning ends at 12:00 and evening starts at 17:00, as the time pickers group them. */
const AFTERNOON = 12 * 60
const EVENING = 17 * 60

export type PartOfDay = 'morning' | 'afternoon' | 'evening'

/** What the booking dialog opens with for a suggested booking. */
export type BookingSuggestion = {
  serviceId?: string
  staffId?: string
  date: string
  startMinutes?: number
  /** The treatment is their clear favourite, so "their usual" is true. */
  usual: boolean
}

export type NextStep =
  | {
      kind: 'membership-unpaid'
      holdingId: string
      name: string
      paidUntil: string
      /** The saved card it is taken from each month, when the client agreed to that. */
      cardLast4?: string
    }
  | {
      kind: 'invite-back'
      weeksSince: number
      usualWeeks: number | null
      /** They agreed to email news, so an invitation may be drafted. */
      consent: boolean
      /**
       * An invitation written since their last visit, still a draft or approved: a second one is
       * not offered. Approved says nothing about whether it was sent.
       */
      invited?: 'draft' | 'approved'
      booking: BookingSuggestion
    }
  | { kind: 'book-usual'; dueOn: string; booking: BookingSuggestion }
  | {
      kind: 'patch-test'
      appointmentId: string
      date: string
      startMinutes: number
      state: PatchTestState
      label: string
      /** A test was recorded before, though it no longer counts for this visit. */
      earlier: boolean
    }
  | {
      kind: 'mention-membership'
      offerId: string
      name: string
      priceMinor: number
      /** Their average monthly spend on treatments it covers, over the last three months. */
      monthlyMinor: number
    }

export type PlanFact = {
  holdingId: string
  kind: 'package' | 'membership'
  name: string
  state: 'active' | 'unpaid'
  visitsLeft: number
  /** A membership's monthly visits; zero when it gives a discount only. */
  visits: number
  paidUntil?: string
  endsOn?: string
}

export type ClientInsight = {
  clientId: string
  /** The day of their first completed visit. */
  since?: string
  completedVisits: number
  /** Fewer than two completed visits: only plain facts are given, no habits. */
  isNew: boolean
  usualWeeks: number | null
  lastVisit?: Appointment
  /** Their next confirmed visit from today, as in the page heading. */
  nextVisit?: Appointment
  /** Something booked or in the studio now, by the same test as Today's lists. */
  booked: boolean
  /** When they are due back after their last visit (dueBack.ts). */
  dueOn?: string
  /** Due back with nothing booked: the same as Today's "Ready to return". */
  due: boolean
  /** Longer than their usual gap with nothing booked: the same as Today's "Drifting away". */
  drifting?: { weeksSince: number; usualWeeks: number | null }
  /**
   * Money over the last 12 months, counted as the Business page counts takings: the treatment on
   * each receipt after discounts and without included tax, plus products without tax, by the
   * visit's date; products bought without a visit by the studio's own day. Tips are left out and
   * refunds are not taken off. Absent when nothing was spent in the year.
   */
  spend?: {
    totalMinor: number
    treatmentsMinor: number
    productsMinor: number
    /** Treatments and products per visit with a receipt, from two such visits. */
    perVisitMinor?: number
    visitsWithReceipts: number
  }
  favouriteTreatment?: { serviceId: string; name: string; visits: number; of: number }
  favouriteProfessional?: { staffId: string; name: string; visits: number; of: number }
  /** When they like to come, only when the pattern is strong. */
  timing?: { weekday?: number; partOfDay?: PartOfDay; visits: number }
  /** No-shows and late cancellations in the last 12 months. */
  reliability?: { noShows: number; lateCancellations: number; kept: number }
  /** How often they booked the next visit at checkout, in the last 12 months. */
  rebooking?: { rebooked: number; of: number }
  /** Packages and memberships that are running or waiting for a payment. */
  plans: PlanFact[]
  /** A patch test that stands in the way of their next visit, or one that is out of date. */
  patchTest?: {
    state: PatchTestState
    label: string
    /** A test was recorded before, though it does not count now. */
    earlier: boolean
    /** Set when it is about their next booked visit. */
    appointmentId?: string
    date?: string
    startMinutes?: number
  }
  next: NextStep | null
}

const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(to) - Date.parse(from)) / DAY)
const weekdayOf = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay()
const partOf = (minutes: number): PartOfDay =>
  minutes < AFTERNOON ? 'morning' : minutes < EVENING ? 'afternoon' : 'evening'
const later = (a: Appointment, b: Appointment) =>
  a.date > b.date || (a.date === b.date && a.startMinutes > b.startMinutes)

/** The most common value and how often, only when it clearly leads: no tie, at least half. */
function clearFavourite(ids: string[]) {
  const counts = new Map<string, number>()
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1)
  const ranked = [...counts].sort((a, b) => b[1] - a[1])
  const [top, second] = ranked
  if (!top || ids.length < FAVOURITE_FROM || top[1] < 2) return undefined
  if (second && second[1] === top[1]) return undefined
  if (top[1] * 2 < ids.length) return undefined
  return { id: top[0], visits: top[1], of: ids.length }
}

/** The most common value when at least two thirds of `values` share it. */
function strongPattern<T>(values: T[]) {
  if (values.length < PATTERN_FROM) return undefined
  const counts = new Map<T, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  const [top] = [...counts].sort((a, b) => b[1] - a[1])
  return top && top[1] * 3 >= values.length * 2 ? top[0] : undefined
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor((sorted.length - 1) / 2)]
}

export function clientInsight(
  s: BusinessState,
  client: Pick<Client, 'id' | 'marketingConsent'>,
  today: string,
): ClientInsight {
  const yearStart = addDays(today, -YEAR_DAYS)
  const inYear = (date: string) => date >= yearStart && date <= today

  // One pass over the studio's visits for this client's own.
  const own: Appointment[] = []
  for (const a of s.appointments) if (a.clientId === client.id) own.push(a)

  const completed: Appointment[] = []
  const year: Appointment[] = []
  const rebookedFrom = new Set<string>()
  let last: Appointment | undefined
  let first: Appointment | undefined
  let nextVisit: Appointment | undefined
  let booked = false
  let noShows = 0
  const cancelledInYear: Appointment[] = []
  for (const a of own) {
    if (a.rebookedFromId && a.status !== 'cancelled' && a.status !== 'no_show')
      rebookedFrom.add(a.rebookedFromId)
    if (a.status === 'arrived' || (a.status === 'confirmed' && a.date >= today)) booked = true
    if (a.status === 'confirmed' && a.date >= today && (!nextVisit || later(nextVisit, a)))
      nextVisit = a
    if (a.status === 'no_show' && inYear(a.date)) noShows++
    if (a.status === 'cancelled' && inYear(a.date)) cancelledInYear.push(a)
    if (a.status !== 'completed' || a.date > today) continue
    completed.push(a)
    if (inYear(a.date)) year.push(a)
    if (!last || later(a, last)) last = a
    if (!first || later(first, a)) first = a
  }

  const usual = usualWeeks(completed.map((a) => a.date))
  const isNew = completed.length < SETTLED_VISITS

  // Due back and drifting away, exactly as Today works them out.
  const dueOn = last ? dueBackOn(s, last) : undefined
  const due = !!dueOn && dueOn <= today && !booked
  let drifting: ClientInsight['drifting']
  if (last && !booked) {
    const days = daysBetween(last.date, today)
    if (days >= driftDays(usual)) drifting = { weeksSince: Math.floor(days / 7), usualWeeks: usual }
  }

  // Receipts for the year's visits: one pass over the receipts and one over counter sales.
  const yearIds = new Set(year.map((a) => a.id))
  const treatmentByVisit = new Map<string, number>()
  let treatmentsMinor = 0
  let productsMinor = 0
  let visitReceiptsMinor = 0
  for (const sale of s.sales) {
    if (!yearIds.has(sale.appointmentId)) continue
    const treatment = serviceRevenue(sale)
    const products = retailRevenue(sale)
    treatmentsMinor += treatment
    productsMinor += products
    visitReceiptsMinor += treatment + products
    treatmentByVisit.set(
      sale.appointmentId,
      (treatmentByVisit.get(sale.appointmentId) ?? 0) + treatment,
    )
  }
  for (const sale of s.counterSales ?? []) {
    if (sale.clientId !== client.id) continue
    if (inYear(recordDay(s, sale.paidAt))) productsMinor += retailRevenue(sale)
  }
  const visitsWithReceipts = treatmentByVisit.size
  const spend =
    treatmentsMinor + productsMinor > 0 || visitsWithReceipts > 0
      ? {
          totalMinor: treatmentsMinor + productsMinor,
          treatmentsMinor,
          productsMinor,
          ...(visitsWithReceipts >= 2
            ? { perVisitMinor: Math.round(visitReceiptsMinor / visitsWithReceipts) }
            : {}),
          visitsWithReceipts,
        }
      : undefined

  // Favourites over the year.
  const treatment = clearFavourite(year.map((a) => a.serviceId))
  const professional = clearFavourite(year.map((a) => a.staffId))
  const service = treatment && s.services.find((x) => x.id === treatment.id)
  const treatmentName =
    service?.name ??
    year
      .filter((a) => a.serviceId === treatment?.id)
      .sort((a, b) => b.date.localeCompare(a.date))[0]?.bookedServiceName
  const person = professional && s.staff.find((x) => x.id === professional.id)
  const favouriteTreatment =
    treatment && treatmentName
      ? { serviceId: treatment.id, name: treatmentName, visits: treatment.visits, of: treatment.of }
      : undefined
  const favouriteProfessional =
    professional && person
      ? {
          staffId: professional.id,
          name: person.name,
          visits: professional.visits,
          of: professional.of,
        }
      : undefined

  // When they like to come.
  const weekday = strongPattern(year.map((a) => weekdayOf(a.date)))
  const partOfDay = strongPattern(year.map((a) => partOf(a.startMinutes)))
  const timing =
    weekday !== undefined || partOfDay !== undefined
      ? {
          ...(weekday !== undefined ? { weekday } : {}),
          ...(partOfDay !== undefined ? { partOfDay } : {}),
          visits: year.length,
        }
      : undefined

  // Reliability: late cancellations use the latest cancellation recorded for the visit.
  let lateCancellations = 0
  if (cancelledInYear.length) {
    const ids = new Set(cancelledInYear.map((a) => a.id))
    const cancelledAt = new Map<string, number>()
    for (const event of s.events) {
      if (event.type !== 'cancelled' || !event.appointmentId || !ids.has(event.appointmentId))
        continue
      const at = Date.parse(event.occurredAt)
      if (at > (cancelledAt.get(event.appointmentId) ?? -Infinity))
        cancelledAt.set(event.appointmentId, at)
    }
    for (const a of cancelledInYear) {
      const at = cancelledAt.get(a.id)
      if (at === undefined) continue
      try {
        const start = Date.parse(instantFor(s, a.date, a.startMinutes))
        if (at >= start - GUEST_CANCEL_CUTOFF_HOURS * 3_600_000) lateCancellations++
      } catch {
        // A time the clocks skip cannot be compared; it is not counted.
      }
    }
  }
  const reliability =
    noShows || lateCancellations || year.length >= RELIABLE_FROM
      ? { noShows, lateCancellations, kept: year.length }
      : undefined

  const rebooking =
    year.length >= REBOOKING_FROM
      ? { rebooked: year.filter((a) => rebookedFrom.has(a.id)).length, of: year.length }
      : undefined

  // Plans, read only: the ones running or waiting for this month's payment.
  const plans: PlanFact[] = []
  for (const holding of clientHoldings(s, client.id)) {
    if (holding.status === 'cancelled') continue
    const standing = planStanding(holding, today)
    if (standing.state !== 'active' && standing.state !== 'unpaid') continue
    plans.push({
      holdingId: holding.id,
      kind: holding.kind,
      name: holding.name,
      state: standing.state,
      visitsLeft: standing.visitsLeft,
      visits: holding.visits,
      ...(holding.paidUntil ? { paidUntil: holding.paidUntil } : {}),
      ...(holding.endsOn ? { endsOn: holding.endsOn } : {}),
    })
  }

  // Patch tests, read only: their next visit first, as the patch test panel shows it.
  let patchTest: ClientInsight['patchTest']
  const upcoming = own
    .filter((a) => a.status === 'confirmed' && a.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date) || a.startMinutes - b.startMinutes)
    .map((a) => ({ a, standing: visitPatchTest(s, a) }))
    .find((row) => row.standing)
  if (upcoming?.standing) {
    if (upcoming.standing.state !== 'clear')
      patchTest = {
        state: upcoming.standing.state,
        label: upcoming.standing.label,
        earlier: !!upcoming.standing.test,
        appointmentId: upcoming.a.id,
        date: upcoming.a.date,
        startMinutes: upcoming.a.startMinutes,
      }
  } else if (year.some((a) => serviceNeedsPatchTest(s, a.serviceId))) {
    // Nothing booked that needs one, though they had such a treatment this year: say so only
    // when their last test has run out or showed a reaction.
    try {
      const standing = patchTestStanding(s, client.id, instantFor(s, today, AFTERNOON))
      if (standing.state === 'reaction' || (standing.state === 'needed' && standing.test))
        patchTest = { state: standing.state, label: standing.label, earlier: true }
    } catch {
      // Noon is never skipped by the clocks; nothing to say if it ever is.
    }
  }

  const booking = suggestBooking(
    s,
    today,
    last,
    favouriteTreatment,
    favouriteProfessional,
    year,
    timing,
  )
  const unpaid = plans.find((p) => p.kind === 'membership' && p.state === 'unpaid')
  let next: NextStep | null = null
  if (unpaid) {
    const card = openCardAgreement(
      clientHoldings(s, client.id).find((h) => h.id === unpaid.holdingId) ?? {},
    )
    next = {
      kind: 'membership-unpaid',
      holdingId: unpaid.holdingId,
      name: unpaid.name,
      paidUntil: unpaid.paidUntil!,
      ...(card ? { cardLast4: card.last4 } : {}),
    }
  } else if (drifting) {
    const invited = invitationSince(s, client.id, last!.date)
    next = {
      kind: 'invite-back',
      weeksSince: drifting.weeksSince,
      usualWeeks: drifting.usualWeeks,
      consent: client.marketingConsent,
      ...(invited ? { invited } : {}),
      booking,
    }
  } else if (due && dueOn) next = { kind: 'book-usual', dueOn, booking }
  else if (patchTest?.appointmentId)
    next = {
      kind: 'patch-test',
      appointmentId: patchTest.appointmentId,
      date: patchTest.date!,
      startMinutes: patchTest.startMinutes!,
      earlier: patchTest.earlier,
      state: patchTest.state,
      label: patchTest.label,
    }
  else if (!plans.some((p) => p.kind === 'membership'))
    next = membershipWorthMentioning(s, today, usual, completed, treatmentByVisit)

  return {
    clientId: client.id,
    ...(first ? { since: first.date } : {}),
    completedVisits: completed.length,
    isNew,
    usualWeeks: usual,
    ...(last ? { lastVisit: last } : {}),
    ...(nextVisit ? { nextVisit } : {}),
    booked,
    ...(dueOn ? { dueOn } : {}),
    due,
    ...(drifting ? { drifting } : {}),
    ...(spend ? { spend } : {}),
    ...(favouriteTreatment ? { favouriteTreatment } : {}),
    ...(favouriteProfessional ? { favouriteProfessional } : {}),
    ...(timing ? { timing } : {}),
    ...(reliability ? { reliability } : {}),
    ...(rebooking ? { rebooking } : {}),
    plans,
    ...(patchTest ? { patchTest } : {}),
    next,
  }
}

/**
 * An email news message to this client written on or after the day of their last visit, so the
 * page does not offer to write another: 'draft' while it waits for approval, 'approved' once it
 * has been approved for sending. A message that was held back is not counted.
 */
function invitationSince(s: BusinessState, clientId: string, since: string) {
  let found: 'draft' | 'approved' | undefined
  for (const message of operations(s).messages) {
    if (message.clientId !== clientId || message.purpose !== 'marketing') continue
    if (message.status === 'suppressed' || recordDay(s, message.createdAt) < since) continue
    if (message.status === 'draft') return 'draft'
    found = 'approved'
  }
  return found
}

/**
 * What a suggested booking opens with: their favourite treatment and professional, or else what
 * they had last time, when both are still offered and the person still does that treatment; on
 * their usual weekday when they have one, otherwise tomorrow.
 */
function suggestBooking(
  s: BusinessState,
  today: string,
  last: Appointment | undefined,
  treatment: ClientInsight['favouriteTreatment'],
  professional: ClientInsight['favouriteProfessional'],
  year: Appointment[],
  timing: ClientInsight['timing'],
): BookingSuggestion {
  const serviceId = treatment?.serviceId ?? last?.serviceId
  const staffId = professional?.staffId ?? last?.staffId
  const offered = s.services.some((x) => x.id === serviceId && !x.archived)
  const person = s.staff.find((x) => x.id === staffId && !x.archived)
  const qualified = !!person && offered && person.serviceIds.includes(serviceId!)
  let date = addDays(today, 1)
  if (timing?.weekday !== undefined)
    while (weekdayOf(date) !== timing.weekday) date = addDays(date, 1)
  const usualStart =
    timing?.weekday !== undefined && timing.partOfDay
      ? median(
          year
            .filter(
              (a) =>
                weekdayOf(a.date) === timing.weekday && partOf(a.startMinutes) === timing.partOfDay,
            )
            .map((a) => a.startMinutes),
        )
      : undefined
  return {
    ...(offered ? { serviceId } : {}),
    ...(qualified ? { staffId } : {}),
    date,
    ...(usualStart !== undefined ? { startMinutes: usualStart } : {}),
    usual: !!treatment && offered,
  }
}

/**
 * A membership worth mentioning: they come every month (a usual gap of five weeks or less), had
 * three or more visits for treatments it covers in the last three months, and those visits cost
 * more each month, on average, than the membership. The one that would save them most is chosen.
 */
function membershipWorthMentioning(
  s: BusinessState,
  today: string,
  usual: number | null,
  completed: Appointment[],
  treatmentByVisit: Map<string, number>,
): NextStep | null {
  if (usual === null || usual > MONTHLY_WEEKS) return null
  const from = addDays(today, 1 - MEMBERSHIP_MONTHS * 30)
  const recent = completed.filter((a) => a.date >= from && a.date <= today)
  let best: Extract<NextStep, { kind: 'mention-membership' }> | null = null
  for (const offer of offers(s)) {
    if (offer.kind !== 'membership' || offer.archived) continue
    const covered = recent.filter((a) => offer.serviceIds.includes(a.serviceId))
    if (covered.length < MEMBERSHIP_VISITS) continue
    const spent = covered.reduce((sum, a) => sum + (treatmentByVisit.get(a.id) ?? 0), 0)
    const monthlyMinor = Math.round(spent / MEMBERSHIP_MONTHS)
    if (monthlyMinor <= offer.priceMinor) continue
    if (!best || monthlyMinor - offer.priceMinor > best.monthlyMinor - best.priceMinor)
      best = {
        kind: 'mention-membership',
        offerId: offer.id,
        name: offer.name,
        priceMinor: offer.priceMinor,
        monthlyMinor,
      }
  }
  return best
}
