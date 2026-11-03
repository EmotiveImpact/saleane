import type { AssistantChannel, BusinessState } from './model'
import { slots } from './commands'
import { channelLabel } from './bookingChannel'
import { bookingLocations, placeClosed } from './bookingPlaces'
import { bookableOnGoogle } from './googleFeeds'
import { addDays, dateLabel, money } from './format'
import { businessDate, hoursFor, operations, visitTax } from './operations'
import { bookablePlaces, places, serviceAt, staffLocationOn, staffPlaces } from './locations'
import { fullPriceMinor } from './priceSentence'
import { onlinePatchTestStop } from './patchTests'
import { BOOKING_DAYS, STRIP_DAYS, cancellationRule, cancellationTerms } from './bookingTerms'
import { GUEST_CANCEL_CUTOFF_HOURS } from './guest'

/**
 * Stage 5: booking through ChatGPT or Claude. What an AI assistant reads and is told through the
 * studio's booking connection, built from the studio record with the booking page's own rules.
 * It holds only what the booking page shows any guest: the studio, its open locations and hours,
 * the treatments guests can book online, professionals' names and free times. Never a client,
 * another guest's visit, a price paid or anything only the team sees. The server
 * (`server/aiBooking.ts`) speaks the protocol and books through the booking page's own path.
 */

/** Which assistant a connection came from, from the names it gave when it connected. */
export function assistantFrom(...names: (string | undefined)[]): AssistantChannel {
  const text = names.filter(Boolean).join(' ').toLowerCase()
  if (/chatgpt|openai/.test(text)) return 'chatgpt'
  if (/claude|anthropic/.test(text)) return 'claude'
  return 'assistant'
}

/** Who a booking through an assistant is recorded as, on the visit's history. */
export const aiBookingActor = (assistant: AssistantChannel) =>
  `Guest, through ${channelLabel(assistant)}`

/** The change record's action for a booking through an assistant. */
export const aiBookingAction = (assistant: AssistantChannel) => `ai-booking.${assistant}` as const

/** Whether the studio lets assistants book: the owner chose it and online booking is open. */
export const aiBookingOn = (s: BusinessState) =>
  !!operations(s).aiBooking?.enabled && operations(s).bookingEnabled

/**
 * Treatments an assistant can book: the same as Book with Google. No payment is taken through an
 * assistant, so a treatment that needs a deposit stays on the booking page, where it is taken; so
 * does one the studio books only for guests with a patch test, since the guest is not known yet.
 */
export const bookableByAssistant = bookableOnGoogle

/** Treatments guests book only on the booking page, and why, by name only. */
export function bookingPageOnly(s: BusinessState) {
  const bookable = new Set(bookableByAssistant(s).map((x) => x.id))
  return s.services
    .filter((x) => !x.archived && !bookable.has(x.id) && bookablePlaces(s, x).length > 0)
    .map((x) => ({
      name: x.name,
      // Nothing else keeps a treatment guests can book online off this list.
      reason: x.depositMinor > 0 ? ('deposit' as const) : ('patch test' as const),
    }))
}

/** A time on the studio's clock as the assistant reads and sends it, such as 09:30. */
export const clockText = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`

/** The minutes past midnight of a time such as 09:30, or null when it is not one. */
export function clockMinutes(text: string) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(text.trim())
  return match ? Number(match[1]) * 60 + Number(match[2]) : null
}

const weekday = (date: string) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'long' }).format(
    new Date(`${date}T12:00:00Z`),
  )
const dayWords = (s: BusinessState, date: string) => dateLabel(date, s.organisation.locale)
/** The full price a guest pays, including any tax, as the booking page shows it. */
const priceWords = (s: BusinessState, priceMinor: number) =>
  money(fullPriceMinor({ priceMinor }, operations(s).tax), s.organisation, true)
/** The places a guest can book at, or the main location while none can take a visit yet. */
const guestPlaces = (s: BusinessState) => {
  const open = bookingLocations(s)
  return open.length ? open : places(s).filter((p) => p.main)
}

export type ToolAnswer = { text: string; data: Record<string, unknown> }
export type ToolRefusal = { refused: string }

/** The studio, its locations and opening hours, how cancelling works and its booking page. */
export function studioDetails(
  s: BusinessState,
  context: { bookingUrl: string; now: string },
): ToolAnswer {
  const today = businessDate(s, context.now)
  const protection = operations(s).protection
  const cancelling = cancellationRule({
    cutoffHours: GUEST_CANCEL_CUTOFF_HOURS,
    feePercent: protection?.feePercent ?? 0,
    depositMinor: 0,
  })
  const week = Array.from({ length: 7 }, (_, i) => addDays(today, i)).sort(
    (a, b) =>
      ((new Date(`${a}T12:00:00Z`).getUTCDay() + 6) % 7) -
      ((new Date(`${b}T12:00:00Z`).getUTCDay() + 6) % 7),
  )
  const locations = guestPlaces(s).map((place) => {
    const hours = week.map((date) => {
      const day = hoursFor(s, date, place.id)
      return day.closed
        ? { day: weekday(date), closed: true }
        : { day: weekday(date), open: clockText(day.open), close: clockText(day.close) }
    })
    // Days in the next month the location is shut although its usual hours say open.
    const closedDays = Array.from({ length: 30 }, (_, i) => addDays(today, i)).filter(
      (date) => !hoursFor(s, date, place.id).closed && placeClosed(s, date, place.id),
    )
    return {
      id: place.id,
      name: place.name,
      address: place.address,
      ...(place.phone ? { phone: place.phone } : {}),
      ...(place.email ? { email: place.email } : {}),
      ...(place.arrivalNote ? { arrivalNote: place.arrivalNote } : {}),
      hours,
      closedDays,
    }
  })
  const sample = operations(s).mode === 'sandbox'
  const data = {
    studio: s.organisation.name,
    today,
    timeZone: s.organisation.timeZone,
    currency: s.organisation.currency,
    locations,
    cancelling,
    bookingPage: context.bookingUrl,
    ...(sample ? { sample: true } : {}),
  }
  const text = [
    `${s.organisation.name}. Today is ${dayWords(s, today)} on the studio's clock (${s.organisation.timeZone}).`,
    ...(sample ? ['This is a fictional sample studio: bookings here are for practice.'] : []),
    ...locations.map((place) =>
      [
        `${place.name} [location_id ${place.id}]: ${place.address || 'no address given'}.`,
        place.phone ? `Phone ${place.phone}.` : '',
        place.email ? `Email ${place.email}.` : '',
        `Opening hours: ${place.hours
          .map((h) => ('closed' in h ? `${h.day} closed` : `${h.day} ${h.open} to ${h.close}`))
          .join(', ')}.`,
        place.closedDays.length
          ? `Also closed on ${place.closedDays.map((d) => dayWords(s, d)).join(', ')}.`
          : '',
        place.arrivalNote ? `Before arriving: ${place.arrivalNote}` : '',
      ]
        .filter(Boolean)
        .join(' '),
    ),
    `Cancelling: ${cancelling}`,
    `Booking page: ${context.bookingUrl}`,
  ].join('\n')
  return { text, data }
}

/** The treatments an assistant can book, and the ones that stay on the booking page. */
export function treatmentList(s: BusinessState, context: { bookingUrl: string }): ToolAnswer {
  const treatments = bookableByAssistant(s).map((x) => {
    const at = bookablePlaces(s, x)
    const people = s.staff.filter(
      (p) =>
        !p.archived &&
        p.serviceIds.includes(x.id) &&
        staffPlaces(s, p.id).some((id) => at.some((place) => place.id === id)),
    )
    return {
      id: x.id,
      name: x.name,
      category: x.category,
      description: x.description,
      durationMinutes: x.durationMinutes,
      locations: at.map((place) => ({
        id: place.id,
        name: place.name,
        price: priceWords(s, serviceAt(x, place.id).priceMinor),
      })),
      professionals: people.map((p) => ({ id: p.id, name: p.name, role: p.role })),
    }
  })
  const elsewhere = bookingPageOnly(s)
  const data = { treatments, bookingPageOnly: elsewhere, bookingPage: context.bookingUrl }
  const several = places(s).length > 1
  const text = [
    treatments.length
      ? `Treatments to book here, with the full price a guest pays:`
      : 'There are no treatments to book through this connection at the moment.',
    ...treatments.map((x) => {
      const prices = [...new Set(x.locations.map((l) => l.price))]
      const price =
        prices.length === 1
          ? prices[0]
          : x.locations.map((l) => `${l.price} at ${l.name}`).join(', ')
      return `${x.name} [treatment_id ${x.id}]: ${x.durationMinutes} minutes, ${price}${
        several && prices.length === 1 ? ` at ${x.locations.map((l) => l.name).join(' or ')}` : ''
      }. With ${x.professionals
        .map((p) => `${p.name} [professional_id ${p.id}]`)
        .join(' or ')}, or anyone. ${x.description}`
    }),
    ...(elsewhere.length
      ? [
          `Booked only on the studio's booking page, ${context.bookingUrl}: ${elsewhere
            .map((x) =>
              x.reason === 'deposit'
                ? `${x.name} (needs a deposit)`
                : `${x.name} (needs a patch test first)`,
            )
            .join(', ')}.`,
        ]
      : []),
  ].join('\n')
  return { text, data }
}

/** Why a treatment cannot be booked through an assistant, in words the guest can act on. */
export function notBookable(s: BusinessState, treatmentId: string, bookingUrl: string) {
  const service = s.services.find((x) => x.id === treatmentId && !x.archived)
  if (!service) return 'There is no treatment with that id here. Use list_treatments to see them.'
  if (service.depositMinor > 0)
    return `${service.name} needs a deposit, so it is booked on the studio's booking page: ${bookingUrl}`
  if (onlinePatchTestStop(s, service.id))
    return `${service.name} needs a patch test first, so it is booked with the studio. Their booking page has the details: ${bookingUrl}`
  return `${service.name} cannot be booked online at the moment. The studio's booking page has the details: ${bookingUrl}`
}

export type TimesInput = {
  treatment_id: string
  professional_id?: string
  location_id?: string
  from_date?: string
  to_date?: string
}

/**
 * The checks shared by finding and booking a time: a treatment an assistant can book, someone who
 * does it, and a location that offers it.
 */
export function bookingChoice(
  s: BusinessState,
  input: { treatment_id: string; professional_id?: string; location_id?: string },
  bookingUrl: string,
) {
  const service = bookableByAssistant(s).find((x) => x.id === input.treatment_id)
  if (!service) return { refused: notBookable(s, input.treatment_id, bookingUrl) } as ToolRefusal
  const staffId =
    input.professional_id && input.professional_id !== 'any' ? input.professional_id : 'any'
  if (
    staffId !== 'any' &&
    !s.staff.some((p) => p.id === staffId && !p.archived && p.serviceIds.includes(service.id))
  )
    return {
      refused: `That professional does not do ${service.name}. Use list_treatments to see who does.`,
    } as ToolRefusal
  const at = bookablePlaces(s, service)
  if (input.location_id && !at.some((p) => p.id === input.location_id))
    return {
      refused: `${service.name} is not booked at that location. It is offered at ${at.map((p) => p.name).join(', ')}.`,
    } as ToolRefusal
  return { service, staffId, locationId: input.location_id }
}

/**
 * The free times for a treatment, day by day, as the booking page offers them: free for desk
 * bookings and for guests holding a time (pass the studio record with online holds added), within
 * opening hours and never in the past. At most STRIP_DAYS days in one answer.
 */
export function freeTimes(
  s: BusinessState,
  input: TimesInput,
  context: { bookingUrl: string; now: string },
): ToolAnswer | ToolRefusal {
  const choice = bookingChoice(s, input, context.bookingUrl)
  if ('refused' in choice) return choice
  const { service, staffId, locationId } = choice
  const today = businessDate(s, context.now)
  const last = addDays(today, BOOKING_DAYS - 1)
  const from = input.from_date && input.from_date > today ? input.from_date : today
  if (from > last) return { refused: 'That is further ahead than the studio takes bookings.' }
  const asked = input.to_date ?? addDays(from, 6)
  if (asked < from) return { refused: 'Choose an end date on or after the start date.' }
  const most = addDays(from, STRIP_DAYS - 1)
  const to = [asked, most, last].sort()[0]
  const days: { date: string; weekday: string; closed: boolean; times: string[] }[] = []
  for (let date = from; date <= to; date = addDays(date, 1)) {
    const place = locationId ?? (staffId === 'any' ? undefined : staffLocationOn(s, staffId, date))
    const closed = placeClosed(s, date, place)
    const times = closed ? [] : slots(s, service.id, staffId, date, context.now, locationId)
    days.push({ date, weekday: weekday(date), closed, times: times.map(clockText) })
  }
  const person = s.staff.find((p) => p.id === staffId)
  const where = locationId ? places(s).find((p) => p.id === locationId)?.name : undefined
  const free = days.reduce((n, d) => n + d.times.length, 0)
  const data = {
    treatment: { id: service.id, name: service.name, durationMinutes: service.durationMinutes },
    professional: person ? { id: person.id, name: person.name } : 'anyone',
    ...(where ? { location: { id: locationId, name: where } } : {}),
    from,
    to,
    days,
    ...(to < asked ? { more: `Ask again from ${addDays(to, 1)} for later days.` } : {}),
  }
  const text = [
    `Free times for ${service.name} (${service.durationMinutes} minutes) with ${person ? person.name : 'anyone'}${where ? ` at ${where}` : ''}, on the studio's clock (${s.organisation.timeZone}):`,
    ...days.map(
      (d) =>
        `${dayWords(s, d.date)} (${d.date}): ${d.closed ? 'closed' : d.times.length ? d.times.join(', ') : 'nothing free'}`,
    ),
    ...(free ? [] : ['Nothing is free on these days. Try later dates or another professional.']),
    ...(to < asked ? [`For later days, ask again from ${addDays(to, 1)}.`] : []),
  ].join('\n')
  return { text, data }
}

/** What the assistant tells the guest once a visit is booked, with their private link. */
export function bookedAnswer(
  s: BusinessState,
  appointmentId: string,
  context: { manageUrl: string; now: number; emailsLive: boolean },
): ToolAnswer {
  const visit = s.appointments.find((a) => a.id === appointmentId)!
  const service = s.services.find((x) => x.id === visit.serviceId)
  const name = visit.bookedServiceName ?? service?.name ?? 'Treatment'
  const professional = s.staff.find((p) => p.id === visit.staffId)?.name.split(' ')[0] ?? ''
  const place = places(s, true).find((p) => p.id === visit.locationId)
  const price = money(
    fullPriceMinor({ priceMinor: visit.bookedPriceMinor }, visitTax(s, visit)),
    s.organisation,
    true,
  )
  const terms = cancellationTerms({
    date: visit.date,
    startMinutes: visit.startMinutes,
    timeZone: s.organisation.timeZone,
    locale: s.organisation.locale,
    depositMinor: 0,
    cutoffHours: GUEST_CANCEL_CUTOFF_HOURS,
    feePercent: operations(s).protection?.feePercent ?? 0,
    now: context.now,
  })
  const sample = operations(s).mode === 'sandbox'
  const confirmation = sample
    ? 'This is a fictional sample studio, so the visit is for practice and nothing is sent.'
    : context.emailsLive
      ? "The studio's usual confirmation email is queued for the guest."
      : 'Emails are in test mode, so no confirmation email is sent. Give the guest the private link.'
  const data = {
    booked: true,
    visit: {
      treatment: name,
      date: visit.date,
      start: clockText(visit.startMinutes),
      durationMinutes: visit.bookedDurationMinutes,
      professional,
      location: place ? { name: place.name, address: place.address } : null,
      price,
    },
    privateLink: context.manageUrl,
    cancelling: terms.rule,
    confirmation,
    ...(sample ? { sample: true } : {}),
  }
  const text = [
    `Booked: ${name} with ${professional} on ${dayWords(s, visit.date)} at ${clockText(visit.startMinutes)}, ${visit.bookedDurationMinutes} minutes, ${price}${place ? `, at ${place.name}${place.address ? `, ${place.address}` : ''}` : ''}.`,
    `The guest can see, move or cancel this visit from their private link: ${context.manageUrl}`,
    'Give the link only to the guest. Anyone who has it can change the visit.',
    `Cancelling: ${terms.rule}`,
    confirmation,
  ].join('\n')
  return { text, data }
}
