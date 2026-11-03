import type { Command } from './commandSchema'
import type { BusinessState, Client, RelationshipEvent } from './model'
import type { CardAgreement, Holding } from './plansSchema'
import type { MessageChannel } from './reminders'
import { reminderSettings, textNumber } from './reminders'
import { addMonths, holdings, lastCardAgreement, openCardAgreement, periodStartFor } from './plans'
import { businessDate, businessMinutes, instantFor, operations } from './operations'
import { addDays, dateLabel, money } from './format'

/**
 * Stage 1: a membership paid each month from a saved card. Staff record the client's agreement
 * on the membership (which card, the exact words, when and who); the server then reminds the
 * client three days before each payment, takes it on its due date from 09:00 studio time through
 * the payment provider, and tries a declined card again 1, 3 and 7 days after the first try.
 * Money enters the record only when the provider confirms it, as a `plan-renew` by card.
 *
 * This module decides what is due and what each message says; it never moves money.
 */
type PlanCardCommand = Extract<Command, { type: 'plan-card' | 'plan-card-try' }>
type AddEvent = (
  event: Omit<RelationshipEvent, 'id' | 'organisationId' | 'occurredAt' | 'actor'>,
) => void

/** The client is reminded this many days before each payment. */
export const REMINDER_DAYS = 3
/** A declined card is tried again this many days after the first try, then no more that month. */
export const RETRY_DAYS = [1, 3, 7] as const
export const MAX_TRIES = RETRY_DAYS.length + 1
/** Payments are taken, and reminders queued, from 09:00 on the studio's clock. */
export const CARD_FROM_MINUTES = 9 * 60
/** Reminders are queued in the daytime only, never late in the evening. */
const REMINDER_UNTIL_MINUTES = 19 * 60

export const planCardKinds = ['plan_reminder', 'plan_declined'] as const
export type PlanCardKind = (typeof planCardKinds)[number]
export const isPlanCardKind = (kind: string): kind is PlanCardKind =>
  (planCardKinds as readonly string[]).includes(kind)

/** "9th", "22nd", "31st". */
export function ordinal(day: number) {
  const teen = day % 100 >= 11 && day % 100 <= 13
  const suffix = teen ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[day % 10]
  return `${day}${suffix ?? 'th'}`
}

/** The day each month a membership's payment falls due, in words. */
export function dueDayWords(holding: Pick<Holding, 'startedOn'>) {
  const day = Number(holding.startedOn.slice(8, 10))
  return day > 28
    ? `the ${ordinal(day)} of each month (or the last day of a shorter month)`
    : `the ${ordinal(day)} of each month`
}

/** A payment day without its weekday: "9 November" here, "November 9" in the US. */
export function dayMonth(date: string, locale = 'en-GB') {
  return new Intl.DateTimeFormat(locale, {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'long',
  }).format(new Date(`${date}T12:00:00Z`))
}

/** The exact words a client agrees to before their membership is paid from a saved card. */
export function cardAgreementWording(
  s: BusinessState,
  holding: Pick<Holding, 'clientId' | 'name' | 'priceMinor' | 'startedOn'>,
  card: { brand: string; last4: string },
) {
  const org = s.organisation
  const client = s.clients.find((c) => c.id === holding.clientId)?.name ?? 'The client'
  return `${client} agrees that ${org.name} may take ${money(holding.priceMinor, org, true)} from their ${card.brand} card ending ${card.last4} on ${dueDayWords(holding)} for ${holding.name}, until they cancel. They will get a reminder three days before each payment.`
}

/**
 * The first month a new agreement pays for: the first due date at least three days away, so the
 * client is always reminded before the card is charged. Earlier months are paid by hand.
 */
export function firstCardMonth(holding: Pick<Holding, 'startedOn'>, today: string) {
  const earliest = addDays(today, REMINDER_DAYS)
  for (let k = 0; ; k += 1) {
    const date = addMonths(holding.startedOn, k)
    if (date >= earliest) return date
  }
}

/**
 * The next month the saved card is set to pay for, or null when card payments are off. The date
 * is that month's first day, which is also its due date. On or before today, it is due now (or
 * being tried); later, it is the payment the client is reminded about.
 */
export function nextCardPayment(holding: Holding, today: string) {
  const agreement = openCardAgreement(holding)
  if (!agreement || holding.status !== 'active' || holding.kind !== 'membership') return null
  const paid = new Set(holding.payments.map((p) => p.periodStart))
  const current = periodStartFor(holding, today)
  const from = current > agreement.startsOn ? current : agreement.startsOn
  for (let k = 0; k < 1200; k += 1) {
    const date = addMonths(holding.startedOn, k)
    if (date >= from && !paid.has(date)) return date
  }
  return null
}

/**
 * The first unpaid month on or after `from` that the saved card is set to pay for, or null. The
 * reminder is about the one after today; the client's page shows the one from today.
 */
export function upcomingCardPayment(holding: Holding, from: string) {
  const agreement = openCardAgreement(holding)
  if (!agreement || holding.status !== 'active' || holding.kind !== 'membership') return null
  const paid = new Set(holding.payments.map((p) => p.periodStart))
  for (let k = 0; k < 1200; k += 1) {
    const date = addMonths(holding.startedOn, k)
    if (date >= from && date >= agreement.startsOn && !paid.has(date)) return date
  }
  return null
}

/** The month whose first try at the card is due now: its due date has come, from 09:00. */
export function cardMonthDue(s: BusinessState, holding: Holding, nowIso: string) {
  const today = businessDate(s, nowIso)
  const date = nextCardPayment(holding, today)
  if (!date || date !== periodStartFor(holding, today)) return null
  return Date.parse(nowIso) >= Date.parse(instantFor(s, date, CARD_FROM_MINUTES)) ? date : null
}

/** When a declined card is tried again: 09:00 on the studio's clock, days after the first try. */
export function nextTryAt(s: BusinessState, firstTryIso: string, tryNumber: number) {
  if (tryNumber >= MAX_TRIES) return null
  const day = addDays(businessDate(s, firstTryIso), RETRY_DAYS[tryNumber - 1])
  return { day, at: Date.parse(instantFor(s, day, CARD_FROM_MINUTES)) }
}

/**
 * Why the saved card must not be charged for this month now, or null when it may. Checked before
 * every try: the membership is still running and set to this card, and the month is still the
 * current one and still unpaid. Paying by hand, ending the plan or turning card payments off
 * therefore stops any further tries.
 */
export function cardChargeProblem(
  s: BusinessState,
  holdingId: string,
  periodStart: string,
  cardId: string,
  nowIso: string,
) {
  if (operations(s).mode !== 'local') return 'Sample studios never take card payments.'
  const holding = holdings(s).find((h) => h.id === holdingId)
  if (!holding) return 'The membership is no longer in the studio record.'
  if (holding.status !== 'active') return 'The membership has ended.'
  const agreement = openCardAgreement(holding)
  if (!agreement) return 'Card payments were turned off.'
  if (agreement.cardId !== cardId) return 'Card payments were set to another card.'
  if (holding.payments.some((p) => p.periodStart === periodStart))
    return 'This month has been paid another way.'
  if (periodStart < agreement.startsOn) return 'Card payments start with a later month.'
  if (periodStartFor(holding, businessDate(s, nowIso)) !== periodStart)
    return 'The month ended before the card could be tried again.'
  return null
}

/** The outbox slot of a membership payment message: the membership and the month. */
export const planCardSlot = (holdingId: string, periodStart: string) =>
  `${holdingId}:${periodStart}`
export function readPlanCardSlot(slot: string) {
  const at = slot.lastIndexOf(':')
  return { holdingId: slot.slice(0, at), periodStart: slot.slice(at + 1) }
}

/**
 * A message about money the client agreed to pay goes by email whenever they have an email
 * address, and by text only when the studio sends texts and the client allows them.
 */
export function planCardChannels(s: BusinessState, client: Client): MessageChannel[] {
  const channels: MessageChannel[] = []
  if (client.email.trim()) channels.push('email')
  if (reminderSettings(s).sms && !client.noTextReminders && textNumber(client.phone))
    channels.push('sms')
  return channels
}

/** Whether a reminder for this month may be queued now: three days or fewer ahead, in the daytime. */
export function reminderWindow(s: BusinessState, periodStart: string, nowIso: string) {
  const today = businessDate(s, nowIso)
  const minutes = businessMinutes(s, nowIso)
  return (
    today >= addDays(periodStart, -REMINDER_DAYS) &&
    today < periodStart &&
    minutes >= CARD_FROM_MINUTES &&
    minutes < REMINDER_UNTIL_MINUTES
  )
}

function contactUs(s: BusinessState, channel: MessageChannel) {
  const { phone, email } = s.organisation
  const ways = [
    phone?.trim() ? `call us on ${phone.trim()}` : '',
    email?.trim() ? `email ${email.trim()}` : '',
  ].filter(Boolean)
  if (ways.length) return ways.join(' or ')
  return channel === 'email' ? 'reply to this email' : 'call or reply to us'
}
const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name

/**
 * The words of the reminder before a membership's card payment, or of the note after the last
 * decline. Null when it should not go now: the membership ended or changed, the month was paid,
 * the client no longer wants that channel, or (for a reminder) the date is too near or too far.
 * Checked when the message is queued and again just before it goes.
 */
export function planCardMessage(
  s: BusinessState,
  kind: PlanCardKind,
  holdingId: string,
  periodStart: string,
  channel: MessageChannel,
  nowIso: string,
) {
  if (operations(s).mode !== 'local') return null
  const holding = holdings(s).find((h) => h.id === holdingId)
  const client = s.clients.find((c) => c.id === holding?.clientId)
  if (!holding || !client || holding.status !== 'active') return null
  if (holding.payments.some((p) => p.periodStart === periodStart)) return null
  if (!planCardChannels(s, client).includes(channel)) return null
  const org = s.organisation
  const amount = money(holding.priceMinor, org, true)
  const contact = contactUs(s, channel)
  if (kind === 'plan_reminder') {
    const card = openCardAgreement(holding)
    const today = businessDate(s, nowIso)
    if (!card || upcomingCardPayment(holding, addDays(today, 1)) !== periodStart) return null
    if (today >= periodStart || today < addDays(periodStart, -REMINDER_DAYS)) return null
    if (channel === 'sms')
      return {
        subject: '',
        body: `${org.name}: on ${dayMonth(periodStart, org.locale)} we will take ${amount} from your ${card.brand} ending ${card.last4} for ${holding.name}. To stop this, please contact us before then.`,
      }
    return {
      subject: `Your ${holding.name} payment on ${dayMonth(periodStart, org.locale)}`,
      body: [
        `Hello ${firstName(client.name)},`,
        '',
        `On ${dateLabel(periodStart, org.locale)}, ${org.name} will take ${amount} from your ${card.brand} card ending ${card.last4} for ${holding.name}, as you agreed.`,
        '',
        `There is nothing you need to do. To stop these payments or to use another card, please contact us before then: ${contact}.`,
        '',
        org.name,
      ].join('\n'),
    }
  }
  const card = lastCardAgreement(holding)
  if (!card) return null
  if (channel === 'sms')
    return {
      subject: '',
      body: `${org.name}: your ${amount} payment for ${holding.name} did not go through, so we have stopped trying. Please contact us to pay or to use another card.`,
    }
  return {
    subject: `Your ${holding.name} payment did not go through`,
    body: [
      `Hello ${firstName(client.name)},`,
      '',
      `We tried to take ${amount} from your ${card.brand} card ending ${card.last4} for ${holding.name}, for the month from ${dateLabel(periodStart, org.locale)}, but the payment did not go through, so we have stopped trying.`,
      '',
      `Please contact us to pay for this month or to use another card: ${contact}.`,
      '',
      org.name,
    ].join('\n'),
  }
}

const TIMES = ['once', 'twice', 'three times', 'four times'] as const

/**
 * The record's id when a set-up or turn-off would change nothing: the same card is already set
 * with the same words, or card payments are already off. The record then stays as it is.
 */
export function planCardUnchanged(s: BusinessState, command: PlanCardCommand) {
  if (command.type !== 'plan-card') return null
  const holding = holdings(s).find((h) => h.id === command.holdingId)
  if (!holding || holding.kind !== 'membership' || holding.status !== 'active') return null
  const open = openCardAgreement(holding)
  if (!command.card) return open ? null : holding.id
  return open?.cardId === command.card.id &&
    command.wording === cardAgreementWording(s, holding, command.card)
    ? open.id
    : null
}

/** Sets up or turns off a membership's card payments, and notes a declined try. */
export function runPlanCardCommand(
  next: BusinessState,
  command: PlanCardCommand,
  now: string,
  makeId: () => string,
  addEvent: AddEvent,
) {
  const org = next.organisation
  const holding = holdings(next).find((h) => h.id === command.holdingId)
  if (!holding) throw new Error('This plan does not belong to this studio.')
  if (holding.kind !== 'membership') throw new Error('Only a membership is paid month by month.')
  const amount = money(holding.priceMinor, org, true)
  if (command.type === 'plan-card-try') {
    const card = lastCardAgreement(holding)
    const from = card ? `the ${card.brand} card ending ${card.last4}` : 'the saved card'
    addEvent({
      clientId: holding.clientId,
      type: 'plan',
      ...(command.missedReminder
        ? {
            title: 'Membership card payment not taken',
            detail: `${holding.name}: ${amount} for the month from ${dateLabel(command.periodStart, org.locale)} was not taken from ${from}, because no reminder went out three days before. The month stays unpaid until it is paid by hand.`,
          }
        : command.nextTryOn
          ? {
              title: 'Membership card payment declined',
              detail: `${holding.name}: ${amount} for the month from ${dateLabel(command.periodStart, org.locale)} was declined on ${from}. SALEANE will try again on ${dateLabel(command.nextTryOn, org.locale)}.`,
            }
          : {
              title: 'Membership card payments stopped for the month',
              detail: `${holding.name}: ${amount} for the month from ${dateLabel(command.periodStart, org.locale)} was declined ${TIMES[command.try - 1]} on ${from}, so SALEANE stopped trying. The month stays unpaid until it is paid by hand.`,
            }),
    })
    return holding.id
  }
  const open = openCardAgreement(holding)
  if (command.card) {
    if (holding.status !== 'active') throw new Error('This plan has already ended.')
    if (operations(next).mode !== 'local')
      throw new Error('Sample studios never take card payments.')
    // The words promise a reminder before each payment, so there must be a way to send one.
    const client = next.clients.find((c) => c.id === holding.clientId)
    if (!client || !planCardChannels(next, client).length)
      throw new Error(
        'Add the client’s email address, or a mobile number they allow texts on, so they can be reminded before each payment.',
      )
    // The words are worked out again here, so what the client agreed to is exactly what is kept.
    const wording = cardAgreementWording(next, holding, command.card)
    if (command.wording !== wording)
      throw new Error('The wording to agree has changed. Read it to the client again.')
    if (open) Object.assign(open, { endedAt: now, endedBy: '', endReason: 'replaced' })
    const agreement: CardAgreement = {
      id: makeId(),
      cardId: command.card.id,
      brand: command.card.brand,
      last4: command.card.last4,
      wording,
      agreedAt: now,
      recordedBy: '',
      startsOn: firstCardMonth(holding, businessDate(next, now)),
    }
    holding.cardAgreements = [...(holding.cardAgreements ?? []), agreement]
    addEvent({
      clientId: holding.clientId,
      type: 'plan',
      title: 'Card payments set up',
      detail: `${holding.name}: ${amount} from the ${agreement.brand} card ending ${agreement.last4} on ${dueDayWords(holding)}, starting ${dateLabel(agreement.startsOn, org.locale)}. The client agreed to the words shown.`,
    })
    return agreement.id
  }
  if (!open) throw new Error('Card payments are already off for this membership.')
  const reason = command.reason ?? 'turned_off'
  Object.assign(open, { endedAt: now, endedBy: '', endReason: reason })
  addEvent({
    clientId: holding.clientId,
    type: 'plan',
    title: 'Card payments turned off',
    detail:
      reason === 'card_removed'
        ? `${holding.name}: the ${open.brand} card ending ${open.last4} was removed, so it will not be charged again. Each month is paid by hand until another card is set up.`
        : `${holding.name}: the ${open.brand} card ending ${open.last4} will not be charged again. Each month is paid by hand until another card is set up.`,
  })
  return open.id
}
