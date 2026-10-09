import type { BusinessState } from './model'
import { slots } from './commands'
import { addDays } from './format'
import { businessDate, instantFor, operations } from './operations'
import { fullPriceMinor } from './priceSentence'
import { bookablePlaces, listPrice } from './locations'

/**
 * V4: Book with Google. The three feeds Google's Actions Center reads from a booking partner,
 * built from the studio's own records: the studio (merchant), its treatments (services) and their
 * free times (availability). Field names follow Google's published feed references as read on
 * 8 October 2026; they are checked with Google's own feed tools before anything is sent.
 */

export type FeedStudio = { id: string; slug: string; state: BusinessState }

/** How far ahead free times are offered on Google. */
export const GOOGLE_DAYS = 30

const metadata = (generatedAt: number) => ({
  processing_instruction: 'PROCESS_AS_COMPLETE',
  shard_number: 0,
  total_shards: 1,
  generation_timestamp: Math.floor(generatedAt / 1000),
})

/**
 * Treatments Google can book. Google takes no payment here, so a treatment that needs a deposit
 * stays on the studio's own booking page, where the deposit is taken. A treatment no open location
 * offers, or that nobody who works there does, is left off (V2).
 */
export const bookableOnGoogle = (s: BusinessState) =>
  s.services.filter((x) => !x.archived && x.depositMinor === 0 && bookablePlaces(s, x).length > 0)

/** Only studios of their own that chose Google, and still take bookings online. */
export const offeredOnGoogle = (s: BusinessState) =>
  operations(s).mode === 'local' &&
  !!operations(s).googleBooking?.enabled &&
  operations(s).bookingEnabled

export function merchantFeed(studios: FeedStudio[], origin: string, generatedAt: number) {
  return {
    metadata: metadata(generatedAt),
    merchant: studios.map(({ id, slug, state }) => ({
      merchant_id: id,
      name: state.organisation.name,
      ...(state.organisation.address
        ? { geo: { unstructured_address: state.organisation.address } }
        : {}),
      category: 'beauty_salon',
      url: `${origin}/book/${slug}?from=google`,
    })),
  }
}

export function serviceFeed(studios: FeedStudio[], generatedAt: number) {
  return {
    metadata: metadata(generatedAt),
    service: studios.flatMap(({ id, state }) => {
      const tax = operations(state).tax
      return bookableOnGoogle(state).map((x) => {
        // V2: Google lists the studio once, so a treatment priced differently at its locations
        // shows the lowest price as a starting price, as the booking page's list does.
        const { priceMinor, from } = listPrice(
          x,
          bookablePlaces(state, x).map((p) => p.id),
        )
        return {
          merchant_id: id,
          service_id: x.id,
          localized_service_name: {
            value: x.name,
            localized_value: [{ locale: state.organisation.locale, value: x.name }],
          },
          description: x.description,
          // The full price the guest pays, including any tax, as the booking page shows it.
          price: {
            price_micros: fullPriceMinor({ priceMinor }, tax) * 10000,
            currency_code: state.organisation.currency,
          },
          ...(from ? { price_interpretation: 'STARTS_AT' } : {}),
        }
      })
    }),
  }
}

/** One entry per free start time for each professional who offers the treatment. */
export function availabilityEntries(studio: FeedStudio, nowIso: string, days = GOOGLE_DAYS) {
  const { id, state } = studio
  const today = businessDate(state, nowIso)
  const entries: {
    merchant_id: string
    service_id: string
    start_sec: number
    duration_sec: number
    spots_total: number
    spots_open: number
    resources: { staff_id: string; staff_name: string }
  }[] = []
  for (const service of bookableOnGoogle(state))
    for (const person of state.staff.filter(
      (p) => !p.archived && p.serviceIds.includes(service.id),
    ))
      for (let d = 0; d < days; d++) {
        const date = addDays(today, d)
        for (const start of slots(state, service.id, person.id, date, nowIso)) {
          let at: string
          try {
            at = instantFor(state, date, start)
          } catch {
            continue // A time the clocks skip or repeat is never offered.
          }
          entries.push({
            merchant_id: id,
            service_id: service.id,
            start_sec: Date.parse(at) / 1000,
            duration_sec: service.durationMinutes * 60,
            spots_total: 1,
            spots_open: 1,
            resources: { staff_id: person.id, staff_name: person.name },
          })
        }
      }
  return entries
}

export function availabilityFeed(studios: FeedStudio[], nowIso: string, generatedAt: number) {
  return {
    metadata: metadata(generatedAt),
    service_availability: [
      { availability: studios.flatMap((studio) => availabilityEntries(studio, nowIso)) },
    ],
  }
}
