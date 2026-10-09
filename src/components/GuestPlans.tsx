import { useId } from 'react'
import { Check, Info, Layers } from 'lucide-react'
import type { GuestView } from '../domain/guest'
import type { GuestPlan } from '../domain/guestPlans'
import './guestPlans.css'

/** A plan's day, as "14 March", with the year when it is not the visit's year. */
function planDay(date: string, locale: string, visitDate: string) {
  return new Intl.DateTimeFormat(locale, {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'long',
    ...(date.slice(0, 4) === visitDate.slice(0, 4) ? {} : { year: 'numeric' }),
  }).format(new Date(`${date}T12:00:00Z`))
}

const visitsWord = (n: number) => (n === 1 ? 'visit' : 'visits')

/**
 * What the guest reads about one plan: a heading, where it stands and what it can mean for this
 * visit. Every line says what the studio can do, never what it has done.
 */
function guestPlanWords(plan: GuestPlan, view: GuestView) {
  const day = (date: string) => planDay(date, view.organisation.locale, view.visit.date)
  const noun = plan.kind === 'package' ? 'package' : 'membership'
  const percent = plan.discountPercent ?? 0
  const standing: string[] = []
  if (plan.state === 'unpaid')
    standing.push('This month is not paid yet. When you are ready, please speak to the studio.')
  else if (plan.kind === 'package') {
    if (plan.visits !== undefined && plan.visitsLeft !== undefined && plan.endsOn)
      standing.push(
        `${plan.visitsLeft} of ${plan.visits} ${visitsWord(plan.visits)} left, until ${day(plan.endsOn)}.`,
      )
  } else {
    if (plan.visits)
      standing.push(
        plan.visitsLeft
          ? `${plan.visitsLeft} of ${plan.visits} ${visitsWord(plan.visits)} left this month.`
          : 'No visits left this month.',
      )
    if (percent) standing.push(`Your member discount is ${percent}%.`)
    if (plan.nextMonthOn) standing.push(`Your next month starts on ${day(plan.nextMonthOn)}.`)
    // How the membership is paid each month ("Paid by card each month.") goes here, once the
    // view carries it beside nextMonthOn (see guestPlanSchema).
  }
  const later = (then: string) =>
    plan.state === 'unpaid' || !plan.thisVisit?.monthOn
      ? `Once your membership is paid up, ${then}`
      : `This visit falls in your membership month from ${day(plan.thisVisit.monthOn)}, which is not paid yet. Once it is, ${then}`
  const discount = `your ${percent}% member discount applies to this treatment.`
  const visit: { text: string; yes: boolean } | null = (() => {
    switch (plan.thisVisit?.outcome) {
      case 'covers':
        // Checkout takes no plan for a visit with a deposit, so a deposit still asked for above
        // would stop the plan paying.
        return {
          text: view.payment?.depositDueMinor
            ? `This visit can come off your ${noun}. A visit with a deposit cannot, so please ask the studio before you pay the deposit.`
            : `This visit can come off your ${noun}. The studio will take it off at checkout.`,
          yes: true,
        }
      case 'discount':
        return percent
          ? {
              text: `Your ${percent}% member discount applies to this treatment. The studio will take it off at checkout.`,
              yes: true,
            }
          : null
      case 'deposit':
        return {
          text: `This visit has a deposit. If you would rather it came off your ${noun}, please ask the studio.`,
          yes: false,
        }
      case 'ends_before':
        return {
          text: 'This visit is after your package ends, so it cannot come off it.',
          yes: false,
        }
      case 'covers_once_paid':
        return {
          text: later(
            plan.state === 'unpaid'
              ? 'this visit can come off it.'
              : 'the visit can come off your membership.',
          ),
          yes: false,
        }
      case 'discount_once_paid':
        return percent ? { text: later(discount), yes: false } : null
      default:
        return null
    }
  })()
  return { heading: `Your ${noun}`, standing, visit }
}

/**
 * Stage 1: each package or membership the guest holds, on their visit page: what is left, until
 * when, and whether it can pay for this visit. The desk decides at checkout, so nothing here
 * promises a payment.
 */
export function GuestPlans({ view }: { view: GuestView }) {
  if (!view.plans?.length) return null
  return (
    <>
      {view.plans.map((plan, index) => (
        <GuestPlanCard key={index} plan={plan} view={view} />
      ))}
    </>
  )
}

function GuestPlanCard({ plan, view }: { plan: GuestPlan; view: GuestView }) {
  const id = useId()
  const words = guestPlanWords(plan, view)
  const Icon = words.visit?.yes ? Check : Info
  return (
    <section className="guest-plan" aria-labelledby={`${id}-heading ${id}-name`}>
      <h2 id={`${id}-heading`}>
        <Layers size={18} aria-hidden="true" />
        {words.heading}
      </h2>
      <p id={`${id}-name`} className="guest-plan-name">
        {plan.name}
      </p>
      {words.standing.length > 0 && <p>{words.standing.join(' ')}</p>}
      {words.visit && (
        <p className="guest-plan-visit">
          <Icon size={17} aria-hidden="true" />
          <span>{words.visit.text}</span>
        </p>
      )}
    </section>
  )
}
