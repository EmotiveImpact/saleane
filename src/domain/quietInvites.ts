import type { Command } from './commandSchema'
import type { BusinessState, RelationshipEvent } from './model'
import { addDays, dateLabel, timeLabel } from './format'
import { businessDate, operations } from './operations'
import { hasLocations, placeOf } from './locations'
import { agreedEverywhere } from './dueBack'
import {
  FREED_DAYS_AHEAD,
  bookingLine,
  invitationsFor,
  minutesUntil,
  timeStillFree,
} from './cancelledTimes'
import {
  offerCheck,
  offerEnds,
  offerMatches,
  offerParagraph,
  offerPlace,
  offerPrices,
  quietOffer,
} from './quietOffers'
import type { OfferTime } from './quietOffers'
import type { MessageOffer } from './quietOffersSchema'

/**
 * Stage 5: invitations to a quiet time at a lower price, and whether a guest can still book one.
 * An invitation to one of Today's open times is written here; one to a time a cancellation freed
 * is written in cancelledTimes.ts with the same price. Either way it is a draft until approved.
 */

type OfferInviteCommand = Extract<Command, { type: 'offer-invite' }>
type AddEvent = (
  event: Omit<RelationshipEvent, 'id' | 'organisationId' | 'occurredAt' | 'actor'>,
) => void
type Message = ReturnType<typeof operations>['messages'][number]

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name

/** "today at 14:00", "tomorrow at 09:30", or "Thursday 8 October at 11:00". */
function dayAndTime(s: BusinessState, time: OfferTime, now: string) {
  const today = businessDate(s, now)
  const locale = s.organisation.locale
  const day =
    time.date === today
      ? 'today'
      : time.date === addDays(today, 1)
        ? 'tomorrow'
        : dateLabel(time.date, locale)
  return { day, when: `${day} at ${timeLabel(time.startMinutes, locale)}` }
}

/**
 * The invitation to a quiet time a guest would receive, with the lower price the owner's setting
 * gives it now, or null when it gives none. The same words are shown before it is saved.
 */
export function quietInvitation(
  s: BusinessState,
  input: Omit<OfferInviteCommand, 'type'>,
  now: string,
) {
  const client = s.clients.find((c) => c.id === input.clientId)
  const service = s.services.find((item) => item.id === input.serviceId)
  const person = s.staff.find((p) => p.id === input.staffId)
  if (!client || !service || !person) return null
  const time = { ...input, locationId: offerPlace(s, input) }
  const offer = quietOffer(s, time, now)
  if (!offer) return null
  const { day, when } = dayAndTime(s, time, now)
  const where = hasLocations(s) ? ` at ${placeOf(s, time.locationId)?.name}` : ''
  const opening = {
    date: time.date,
    startMinutes: time.startMinutes,
    staffId: time.staffId,
    serviceId: time.serviceId,
    ...(hasLocations(s) ? { locationId: time.locationId } : {}),
  }
  return {
    subject: `A time for you ${day}, ${firstName(client.name)}, at a lower price`,
    body: [
      `Hello ${firstName(client.name)},`,
      '',
      `It has been a little while. ${firstName(person.name)} has ${when} free for ${service.name}${where}, and we thought of you.`,
      '',
      offerParagraph(s, offer, now),
      '',
      `${bookingLine(s, time, true)} It is not held for you, so the first to book it gets it.`,
      '',
      'You are hearing this because you said we could keep in touch. To stop these, reply to this email or tell us at your next visit.',
      '',
      s.organisation.name,
    ].join('\n'),
    offer,
    opening,
  }
}

/** An invitation already written to this guest for this time, so writing it again changes nothing. */
export function offerInviteUnchanged(s: BusinessState, command: OfferInviteCommand) {
  return invitationsFor(s, command).find(
    (m) => m.clientId === command.clientId && m.status !== 'suppressed',
  )?.id
}

export function runOfferInvite(
  next: BusinessState,
  command: OfferInviteCommand,
  now: string,
  makeId: () => string,
  addEvent: AddEvent,
) {
  const client = next.clients.find((c) => c.id === command.clientId)
  if (!client) throw new Error('Client does not belong to this studio.')
  if (!client.email.trim())
    throw new Error(`${client.name} has no email address, so they cannot be invited by email.`)
  if (!agreedEverywhere(next, client.id))
    throw new Error(`${client.name} has not agreed to hear from you, so they cannot be invited.`)
  const service = next.services.find((item) => item.id === command.serviceId)
  if (!service || service.archived) throw new Error('Choose a treatment the studio offers.')
  const person = next.staff.find((p) => p.id === command.staffId && !p.archived)
  if (!person || !person.serviceIds.includes(service.id))
    throw new Error('Choose a professional who does this treatment.')
  const time = { ...command, locationId: offerPlace(next, command) }
  if (
    minutesUntil(next, time.date, time.startMinutes, now) <= 0 ||
    time.date > addDays(businessDate(next, now), FREED_DAYS_AHEAD)
  )
    throw new Error('Choose a time still to come in the next two weeks.')
  if (!timeStillFree(next, time, now))
    throw new Error('That time is no longer free. Look again for an open time.')
  const draft = quietInvitation(next, command, now)
  if (!draft)
    throw new Error(
      'The lower price for quiet times is off, or does not apply to this treatment, so there is nothing to offer. Write an ordinary invitation instead.',
    )
  next.operations = structuredClone(operations(next))
  const message: Message = {
    id: makeId(),
    clientId: client.id,
    purpose: 'marketing',
    channel: 'email',
    subject: draft.subject,
    body: draft.body,
    status: 'draft',
    createdAt: now,
    actor: 'Local operator',
    opening: draft.opening,
    offer: draft.offer,
  }
  next.operations.messages.push(message)
  const { when } = dayAndTime(next, time, now)
  const where = hasLocations(next) ? ` at ${placeOf(next, time.locationId)?.name}` : ''
  addEvent({
    clientId: client.id,
    type: 'message',
    title: 'Invitation written',
    detail: `${service.name} with ${person.name}${where}, ${when}, a quiet time, at a quiet-time price of ${offerPrices(next, draft.offer)}. Waiting in the Inbox for approval; delivery is unconfigured.`,
  })
  return message.id
}

export type OfferStanding =
  | { ok: true; messageId: string; offer: MessageOffer; opening: OfferTime; writtenAt: string }
  | { ok: false; problem: string }

/** What a guest is told when an offer cannot be found or is no longer open. */
export const OFFER_GONE = 'This quiet-time price is no longer open.'
export const OFFER_USED = 'This quiet-time price has already been used to book.'

/**
 * Whether a guest can still book this invitation's lower price, in words the booking page shows.
 * It must have been approved and not withdrawn, not used, not ended, at the same usual price,
 * and its time still free (the booking itself checks that again as it is made).
 */
export function offerStanding(s: BusinessState, messageId: string, now: string): OfferStanding {
  const message = operations(s).messages.find((m) => m.id === messageId)
  if (!message?.offer || !message.opening || message.status !== 'queued' || !message.approvedAt)
    return { ok: false, problem: OFFER_GONE }
  if (s.appointments.some((a) => a.bookedOffer?.messageId === messageId))
    return { ok: false, problem: OFFER_USED }
  const check = offerCheck(s, message, now)
  if (check === 'ended')
    return {
      ok: false,
      problem: `This quiet-time price ended on ${offerEnds(s, message.offer, message.createdAt)}.`,
    }
  if (check === 'not-offered') return { ok: false, problem: OFFER_GONE }
  if (check === 'changed')
    return {
      ok: false,
      problem:
        'The treatment’s usual price has changed since this quiet-time price was offered, so it no longer applies.',
    }
  if (!timeStillFree(s, message.opening, now))
    return {
      ok: false,
      problem: 'The time this quiet-time price was for has been booked or has passed.',
    }
  return {
    ok: true,
    messageId,
    offer: message.offer,
    opening: message.opening,
    writtenAt: message.createdAt,
  }
}

/** The time an offer is for, in the words a guest reads: "Saturday 10 October at 10:00 with Maya". */
export function offerTimeWords(s: BusinessState, opening: OfferTime) {
  const locale = s.organisation.locale
  const person = s.staff.find((p) => p.id === opening.staffId)
  return `${dateLabel(opening.date, locale)} at ${timeLabel(opening.startMinutes, locale)}${person ? ` with ${firstName(person.name)}` : ''}`
}

/**
 * The lower price an online booking takes from an invitation, checked as the visit is made: the
 * offer still stands and the booking is for exactly its time. Throws in words for the guest.
 */
export function offerToBook(s: BusinessState, messageId: string, booking: OfferTime, now: string) {
  const standing = offerStanding(s, messageId, now)
  if (!standing.ok)
    throw new Error(`${standing.problem} You can still book this time at the usual price.`)
  if (!offerMatches(s, standing.opening, booking))
    throw new Error(
      `This quiet-time price is for ${offerTimeWords(s, standing.opening)} only. You can still book this time at the usual price.`,
    )
  return { messageId, ...standing.offer }
}
