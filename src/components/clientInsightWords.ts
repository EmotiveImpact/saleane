import type { BusinessState, Client } from '../domain/model'
import type { ClientInsight, NextStep, PartOfDay } from '../domain/clientInsight'
import { addDays, dateLabel, money, wholeMoney } from '../domain/format'
import { GUEST_CANCEL_CUTOFF_HOURS } from '../domain/guest'
import { patchTestSettings } from '../domain/patchTests'

/**
 * The words for "At a glance" on the client page (ClientInsight). Plain and warm, built only from
 * the facts clientInsight found; a fact it left out is never filled in here.
 */
export type InsightLine = {
  id: string
  label: string
  value: string
  detail?: string
  /** How the figure is worked out, behind a small "i" beside the label. */
  definition?: string
}
export type StepWords = { title: string; detail: string }

/** At most this many facts sit under the summary, so the section stays calm. */
export const MOST_LINES = 6

const PARTS: Record<PartOfDay, string> = {
  morning: 'mornings',
  afternoon: 'afternoons',
  evening: 'evenings',
}
const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const firstName = (name: string) => name.split(' ')[0]

/** The day of the week in the studio's language; 4 October 2026 was a Sunday. */
export function weekdayWord(weekday: number, locale: string) {
  return new Intl.DateTimeFormat(locale, { timeZone: 'UTC', weekday: 'long' }).format(
    new Date(`${addDays('2026-10-04', weekday)}T12:00:00Z`),
  )
}

/** "12 Oct", with the year when it is not this year's. */
function dayMonth(date: string, today: string, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
    ...(date.slice(0, 4) === today.slice(0, 4) ? {} : { year: 'numeric' }),
  }).format(new Date(`${date}T12:00:00Z`))
}

/** "on Saturday mornings", "on Saturdays" or "in the mornings". */
export function whenTheyCome(timing: NonNullable<ClientInsight['timing']>, locale: string) {
  const day = timing.weekday !== undefined ? weekdayWord(timing.weekday, locale) : ''
  if (day && timing.partOfDay) return `on ${day} ${PARTS[timing.partOfDay]}`
  if (day) return `on ${day}s`
  return timing.partOfDay ? `in the ${PARTS[timing.partOfDay]}` : ''
}

/** One sentence about the client. A new client gets a short welcome and nothing more. */
/**
 * One sentence that adds to the client's heading, or none. The heading already says how often they
 * come ("usually every 4 weeks"), so the sentence names only what it does not: when in the week they
 * like to come, or that there is no rhythm yet.
 */
export function insightSummary(insight: ClientInsight, locale: string) {
  const visits = insight.completedVisits
  if (insight.isNew) return visits ? 'New client. 1 visit so far.' : 'New client. No visits yet.'
  const when = insight.timing ? whenTheyCome(insight.timing, locale) : ''
  if (when) return `Usually comes ${when}.`
  if (insight.usualWeeks) return ''
  return `${count(visits, 'visit')} so far, with no set rhythm yet.`
}

const SPEND_DEFINITION =
  'Treatments and products on their receipts over the last 12 months, after discounts and without included tax, counted as the Business page counts takings. Tips are left out and refunds are not taken off. A visit counts on the day it happened.'
const KEEPING_DEFINITION = `A missed visit is one marked as a no-show. A late cancellation was cancelled less than ${GUEST_CANCEL_CUTOFF_HOURS} hours before it started, as for the studio's fee. Counted over the last 12 months.`

/**
 * Up to six facts, most useful first: anything that stands in the way of a visit, their plan, when
 * they are due back, their favourites, their spending, then their habits. `money` is false for
 * anyone who should not see what a client spends.
 */
export function insightLines(
  s: BusinessState,
  insight: ClientInsight,
  today: string,
  options: { money: boolean },
): InsightLine[] {
  const { locale } = s.organisation
  const lines: InsightLine[] = []
  const step = insight.next

  const patch = insight.patchTest
  if (patch && step?.kind !== 'patch-test')
    lines.push({
      id: 'patch-test',
      label: 'Patch test',
      value:
        patch.state === 'reaction'
          ? 'Reaction recorded'
          : patch.state === 'waiting'
            ? 'Result to record'
            : patch.state === 'too-close'
              ? 'Too close to the visit'
              : patch.earlier
                ? 'Out of date'
                : 'Needed',
      detail: patch.date
        ? `For ${dateLabel(patch.date, locale, true)}. ${patch.label}.`
        : `${patch.label}.`,
    })

  const plan = insight.plans.find(
    (p) => !(step?.kind === 'membership-unpaid' && step.holdingId === p.holdingId),
  )
  if (plan)
    lines.push({
      id: 'plan',
      label: plan.kind === 'membership' ? 'Membership' : 'Package',
      value: plan.name,
      detail:
        plan.kind === 'package'
          ? `${count(plan.visitsLeft, 'visit')} left, until ${dayMonth(plan.endsOn!, today, locale)}`
          : plan.state === 'unpaid'
            ? `Unpaid since ${dayMonth(plan.paidUntil!, today, locale)}`
            : `${plan.visits ? `${plan.visitsLeft} of ${plan.visits} visits left this month. ` : ''}Paid to ${dayMonth(plan.paidUntil!, today, locale)}`,
    })

  if (!insight.booked && insight.dueOn)
    lines.push({
      id: 'due',
      label: 'Due back',
      value: insight.dueOn === today ? 'Today' : dayMonth(insight.dueOn, today, locale),
      detail: insight.drifting
        ? `Drifting away: ${count(insight.drifting.weeksSince, 'week')} since their last visit`
        : 'Nothing booked yet',
    })

  const fresh = insight.isNew
  const treatment = insight.favouriteTreatment
  const person = insight.favouriteProfessional
  if (!fresh && treatment)
    lines.push({
      id: 'favourite',
      label: 'Favourite treatment',
      value: treatment.name,
      detail: `${person ? `With ${firstName(person.name)}, ` : ''}${treatment.visits} of ${treatment.of} visits in the last 12 months`,
    })
  else if (!fresh && person)
    lines.push({
      id: 'favourite',
      label: 'Usually sees',
      value: person.name,
      detail: `${person.visits} of ${person.of} visits in the last 12 months`,
    })

  const spend = insight.spend
  if (!fresh && options.money && spend)
    lines.push({
      id: 'spend',
      label: 'Last 12 months',
      value: wholeMoney(spend.totalMinor, s.organisation),
      detail: spend.perVisitMinor
        ? `About ${wholeMoney(spend.perVisitMinor, s.organisation)} a visit`
        : undefined,
      definition: SPEND_DEFINITION,
    })

  const keeping = insight.reliability
  const missed = keeping ? keeping.noShows + keeping.lateCancellations : 0
  if (keeping && missed)
    lines.push({
      id: 'keeping',
      label: 'Keeping visits',
      value: [
        keeping.noShows ? `${keeping.noShows} missed` : '',
        keeping.lateCancellations
          ? `${keeping.lateCancellations} ${keeping.noShows ? 'late' : 'cancelled late'}`
          : '',
      ]
        .filter(Boolean)
        .join(', '),
      detail: `${count(keeping.kept, 'visit')} kept in the last 12 months. A reminder the day before can help.`,
      definition: KEEPING_DEFINITION,
    })

  const rebooking = insight.rebooking
  if (!fresh && rebooking)
    lines.push({
      id: 'rebooking',
      label: 'Booking ahead',
      value: `${rebooking.rebooked} of ${rebooking.of} visits`,
      detail:
        rebooking.rebooked * 3 >= rebooking.of * 2
          ? 'Usually books the next visit before leaving'
          : rebooking.rebooked * 3 <= rebooking.of
            ? 'Usually books later, rather than before leaving'
            : 'Sometimes books the next visit before leaving',
    })

  if (!fresh && keeping && !missed)
    lines.push({
      id: 'keeping',
      label: 'Keeping visits',
      value: 'Every visit kept',
      detail: 'None missed or cancelled late in the last 12 months',
      definition: KEEPING_DEFINITION,
    })

  return lines.slice(0, MOST_LINES)
}

/** The suggested next step in words: what it is and why. */
export function stepWords(
  s: BusinessState,
  step: NextStep,
  today: string,
  options: { money: boolean },
): StepWords {
  const { locale } = s.organisation
  switch (step.kind) {
    case 'membership-unpaid':
      return {
        title: `${step.name} needs this month’s payment`,
        detail: `Unpaid since ${dayMonth(step.paidUntil, today, locale)}. Covered visits and the member discount wait until it is paid.`,
      }
    case 'invite-back': {
      const weeks = count(step.weeksSince, 'week')
      return {
        title: 'Invite them back',
        detail: `${weeks} since their last visit${step.usualWeeks ? `, against their usual ${step.usualWeeks}` : ''}, and nothing booked.${
          step.consent
            ? ''
            : ' They have not agreed to email news, so book them in when they are next in touch.'
        }`,
      }
    }
    case 'book-usual': {
      const service = s.services.find((x) => x.id === step.booking.serviceId)
      const person = s.staff.find((x) => x.id === step.booking.staffId)
      const due =
        step.dueOn === today
          ? 'Due back today'
          : `Due back since ${dayMonth(step.dueOn, today, locale)}`
      return {
        title: step.booking.usual ? 'Book their usual' : 'Book their next visit',
        detail: `${due}, with nothing booked.${
          service
            ? ` The booking is filled in with ${service.name}${person ? ` with ${firstName(person.name)}` : ''} on ${dateLabel(step.booking.date, locale)}; change anything before you save.`
            : ''
        }`,
      }
    }
    case 'patch-test': {
      const hours = patchTestSettings(s).hoursBefore
      const then =
        step.state === 'reaction'
          ? ' Change the treatment, or record a new clear test first.'
          : step.state === 'waiting'
            ? ' Record the result once the skin has been checked.'
            : step.state === 'too-close' || step.earlier
              ? ` Record a new test at least ${hours} hours before the visit.`
              : ''
      return {
        title: `Patch test before ${dateLabel(step.date, locale, true)}`,
        detail: `${step.label}.${then}`,
      }
    }
    case 'mention-membership':
      return {
        title: `Comes every month and spends more than the ${step.name} costs: mention it`,
        detail: options.money
          ? `About ${wholeMoney(step.monthlyMinor, s.organisation)} a month on treatments it covers, over the last three months. ${step.name} is ${money(step.priceMinor, s.organisation)} a month.`
          : `Their visits over the last three months, for treatments it covers, came to more each month than ${step.name}.`,
      }
  }
}

/**
 * The invitation a person may save as an unsent draft for a client drifting away. It names no
 * time or offer, so it stays true whenever it is sent.
 */
export function invitationDraft(
  s: BusinessState,
  client: Pick<Client, 'name'>,
  step: Extract<NextStep, { kind: 'invite-back' }>,
) {
  const first = firstName(client.name)
  const service = s.services.find((x) => x.id === step.booking.serviceId)?.name
  const person = s.staff.find((x) => x.id === step.booking.staffId)?.name
  const glad = person
    ? `${firstName(person)} would be glad to see you`
    : 'We would be glad to see you'
  return {
    subject: `We would love to see you, ${first}`,
    body: `Hello ${first}, it has been a little while since we last saw you. ${glad}${service ? ` for your ${service}` : ''} again. If you would like to come in, reply to this message and we will find a time that suits you.`,
  }
}
