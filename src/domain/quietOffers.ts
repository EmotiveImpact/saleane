import type { Appointment, BusinessState } from './model'
import { DEMO_MINUTES, businessDate, instantFor, operations } from './operations'
import { serviceAt, staffLocationOn } from './locations'
import { dateLabel, money, timeLabel } from './format'
import { fullPriceMinor } from './priceSentence'
import { civilTime } from './bookingTerms'
import { defaultQuietOffers } from './quietOffersSchema'
import type { MessageOffer, QuietOfferSettings } from './quietOffersSchema'

/**
 * Stage 5: a lower price for a quiet time. The owner's setting decides whether an invitation to a
 * quiet time (an open time on Today) or to a time a cancellation freed carries a lower price. The
 * price is worked out once, as the invitation is written, and kept on it with the usual price and
 * when it ends, so changing the setting never changes an invitation already written. A guest books
 * it only through the private link in their email, for that exact time, once; the visit is then
 * booked at the lower price, which is what checkout charges, tax is worked from and commission
 * follows. Everything here reads the record only.
 */

/** The one name an offer goes by on the visit, at checkout, on the receipt and in the figures. */
export const OFFER_NAME = 'Quiet-time price'

export function quietOfferSettings(s: BusinessState): QuietOfferSettings {
  return operations(s).quietOffers ?? defaultQuietOffers
}

/**
 * Minutes from now until a time on the studio's clock. A sample studio's clock stands still at
 * 10:45 on its sample day, as its diary does.
 */
export function minutesUntil(s: BusinessState, date: string, start: number, now: string) {
  if (operations(s).mode === 'sandbox') {
    const days = Math.round(
      (Date.parse(`${date}T12:00:00Z`) - Date.parse(`${businessDate(s, now)}T12:00:00Z`)) /
        86_400_000,
    )
    return days * 1440 + start - DEMO_MINUTES
  }
  try {
    return Math.floor((Date.parse(instantFor(s, date, start)) - Date.parse(now)) / 60000)
  } catch {
    return -1
  }
}

/**
 * The lower price for a usual price under these settings, or null when there is none: the setting
 * is off, or the price a guest would pay is not below the usual one. Never below the floor the
 * owner set, and never below free.
 */
export function offerPriceFor(settings: QuietOfferSettings, usualMinor: number) {
  if (settings.discount === 'none' || usualMinor <= 0) return null
  const off =
    settings.discount === 'percent'
      ? Math.round((usualMinor * settings.offPercent) / 100)
      : settings.offMinor
  const price = Math.max(usualMinor - off, settings.floorMinor, 0)
  return price < usualMinor ? price : null
}

/** A time an offer can be for: the treatment, professional, day, start and, if named, location. */
export type OfferTime = {
  serviceId: string
  staffId: string
  date: string
  startMinutes: number
  locationId?: string
}
/** Where a time is: its location, or wherever the professional works that day. */
export const offerPlace = (s: BusinessState, time: OfferTime) =>
  time.locationId ?? staffLocationOn(s, time.staffId, time.date)

/** Whether a booking is for exactly the time an offer names. */
export function offerMatches(s: BusinessState, offered: OfferTime, booking: OfferTime) {
  return (
    offered.serviceId === booking.serviceId &&
    offered.staffId === booking.staffId &&
    offered.date === booking.date &&
    offered.startMinutes === booking.startMinutes &&
    offerPlace(s, offered) === offerPlace(s, booking)
  )
}

/**
 * The lower price an invitation written now for this time carries, or null. None when the setting
 * is off, online booking is off (an offer is booked only through its link), the treatment is left
 * out or no longer offered, or the floor leaves nothing off. It ends after the hours the owner
 * chose or as the time starts, whichever is first, on the whole minute.
 */
export function quietOffer(s: BusinessState, time: OfferTime, now: string): MessageOffer | null {
  const settings = quietOfferSettings(s)
  if (settings.discount === 'none' || !operations(s).bookingEnabled) return null
  const service = s.services.find((item) => item.id === time.serviceId)
  if (!service || service.archived || settings.leftOutIds.includes(service.id)) return null
  const usual = serviceAt(service, offerPlace(s, time)).priceMinor
  const price = offerPriceFor(settings, usual)
  if (price === null) return null
  const minutes = Math.min(
    settings.openHours * 60,
    minutesUntil(s, time.date, time.startMinutes, now),
  )
  if (minutes <= 0) return null
  const from = Math.floor(Date.parse(now) / 60000) * 60000
  return {
    priceMinor: price,
    usualPriceMinor: usual,
    endsAt: new Date(from + minutes * 60000).toISOString(),
  }
}

/**
 * When an offer ends, as the studio's clock reads it: "Saturday 10 October at 18:00". A sample
 * studio's clock stands at 10:45 on its sample day, so its offers are told from there.
 */
export function offerEnds(
  s: BusinessState,
  offer: Pick<MessageOffer, 'endsAt'>,
  writtenAt: string,
) {
  let instant = Date.parse(offer.endsAt)
  if (operations(s).mode === 'sandbox')
    try {
      const written = Math.floor(Date.parse(writtenAt) / 60000) * 60000
      instant = Date.parse(instantFor(s, businessDate(s), DEMO_MINUTES)) + (instant - written)
    } catch {
      /* Told as the instant it is. */
    }
  const { date, minutes } = civilTime(instant, s.organisation.timeZone)
  const locale = s.organisation.locale
  return `${dateLabel(date, locale)} at ${timeLabel(minutes, locale)}`
}

/** A price as a guest pays it, with any tax the studio adds on top. */
function guestPrice(s: BusinessState, priceMinor: number) {
  return money(fullPriceMinor({ priceMinor }, operations(s).tax), s.organisation)
}

/**
 * The lines an invitation with a lower price carries: the price against the usual one, that it is
 * for that time only, and when it ends. The time itself is named in the line before.
 */
export function offerParagraph(s: BusinessState, offer: MessageOffer, writtenAt: string) {
  return `For that time only, it is ${guestPrice(s, offer.priceMinor)} instead of the usual ${guestPrice(s, offer.usualPriceMinor)}. The lower price is open until ${offerEnds(s, offer, writtenAt)}.`
}

/** "£76 instead of £95", for the record and the team's screens, as the visit is booked. */
export function offerPrices(
  s: BusinessState,
  offer: Pick<MessageOffer, 'priceMinor' | 'usualPriceMinor'>,
) {
  return `${money(offer.priceMinor, s.organisation)} instead of ${money(offer.usualPriceMinor, s.organisation)}`
}

/** "Quiet-time price, £19 off £95", for a visit booked with an offer; null for any other visit. */
export function bookedOfferLine(
  s: BusinessState,
  visit: Pick<Appointment, 'bookedOffer' | 'bookedPriceMinor'>,
) {
  if (!visit.bookedOffer) return null
  const usual = visit.bookedOffer.usualPriceMinor
  return `${OFFER_NAME}, ${money(usual - visit.bookedPriceMinor, s.organisation)} off ${money(usual, s.organisation)}`
}

/**
 * Visits booked at a quiet-time price since an instant, and how far below their usual prices they
 * were booked. A visit cancelled or missed since gave nothing away, so it is left out.
 */
export function offersTaken(s: BusinessState, since: string) {
  const visits = s.appointments.filter(
    (a) =>
      a.bookedOffer && a.createdAt >= since && a.status !== 'cancelled' && a.status !== 'no_show',
  )
  return {
    taken: visits.length,
    givenMinor: visits.reduce(
      (sum, a) => sum + a.bookedOffer!.usualPriceMinor - a.bookedPriceMinor,
      0,
    ),
  }
}

type Message = ReturnType<typeof operations>['messages'][number]
export type OfferCheck = 'ended' | 'changed' | 'not-offered'
/** Whether an invitation's lower price still holds as written: not ended, at the same usual price. */
export function offerCheck(s: BusinessState, message: Message, now: string): OfferCheck | null {
  if (!message.offer || !message.opening) return null
  if (Date.parse(now) >= Date.parse(message.offer.endsAt)) return 'ended'
  const service = s.services.find((item) => item.id === message.opening!.serviceId)
  if (!service || service.archived) return 'not-offered'
  if (
    serviceAt(service, offerPlace(s, message.opening)).priceMinor !== message.offer.usualPriceMinor
  )
    return 'changed'
  return null
}

/** Why an invitation's lower price can no longer be approved or sent, or null while it holds. */
export function offerStale(s: BusinessState, messageId: string, now: string) {
  const message = operations(s).messages.find((m) => m.id === messageId)
  const check = message && offerCheck(s, message, now)
  if (!message || !check) return null
  if (check === 'ended')
    return `The lower price in this invitation ended on ${offerEnds(s, message.offer!, message.createdAt)}.`
  if (check === 'not-offered') return 'The treatment in this invitation is no longer offered.'
  return 'The treatment’s usual price has changed since this invitation was written, so its lower price no longer holds.'
}

/** The record's own checks: an offer is always below its usual price and is booked once at most. */
export function quietOffersProblem(s: BusinessState) {
  const used = new Set<string>()
  for (const visit of s.appointments) {
    if (!visit.bookedOffer) continue
    if (visit.bookedOffer.usualPriceMinor <= visit.bookedPriceMinor)
      return 'A quiet-time price must be below the usual price.'
    if (used.has(visit.bookedOffer.messageId)) return 'A quiet-time price is booked once only.'
    used.add(visit.bookedOffer.messageId)
  }
  for (const message of operations(s).messages)
    if (message.offer && (!message.opening || message.purpose !== 'marketing'))
      return 'A quiet-time price belongs to an invitation to one time.'
  return null
}
