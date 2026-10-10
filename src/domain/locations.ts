import type { Appointment, BusinessState, Service } from './model'
import type { GiftCard } from './giftCardsSchema'
import { addDays } from './format'
import { businessDate, operations, plannedHoursFor, usualHoursFor } from './operations'

/**
 * V2: several locations. The main location lives on the organisation; further ones are kept in
 * operations. Rooms belong to one location, and each person works at one location on a given day
 * (set on their weekly hours). Anything without a location belongs to the main one, so a studio
 * with one location behaves exactly as before.
 */
export type Place = {
  id: string
  name: string
  address: string
  arrivalNote?: string
  /** How guests reach this location, when it has its own number or address. */
  phone?: string
  email?: string
  main: boolean
  archived: boolean
}

export function places(s: BusinessState, includeArchived = false): Place[] {
  const org = s.organisation
  const main: Place = {
    id: org.locationId,
    name: org.locationName,
    address: org.address,
    ...(org.arrivalNote ? { arrivalNote: org.arrivalNote } : {}),
    ...(org.phone ? { phone: org.phone } : {}),
    ...(org.email ? { email: org.email } : {}),
    main: true,
    archived: false,
  }
  const more = (operations(s).locations ?? []).map((l) => ({
    id: l.id,
    name: l.name,
    address: l.address,
    ...(l.arrivalNote ? { arrivalNote: l.arrivalNote } : {}),
    ...(l.phone ? { phone: l.phone } : {}),
    ...(l.email ? { email: l.email } : {}),
    main: false,
    archived: !!l.archived,
  }))
  return [main, ...more].filter((p) => includeArchived || !p.archived)
}

/** More than one open location: only then do screens ask which one. */
export function hasLocations(s: BusinessState) {
  return places(s).length > 1
}

/**
 * Whether selling a gift card, package or membership asks which location sold it: only with more
 * than one location, and never a general manager, whose own location the server sets.
 */
export const asksSoldAt = (s: BusinessState, role: string) => hasLocations(s) && role !== 'general'

export function placeOf(s: BusinessState, locationId: string | undefined) {
  return places(s, true).find((p) => p.id === (locationId ?? s.organisation.locationId))
}

export function resourceLocation(s: BusinessState, resource: { locationId?: string }) {
  return resource.locationId ?? s.organisation.locationId
}

/** Where a person works on a day, from their weekly hours or the day as changed on the rota. */
export function staffLocationOn(s: BusinessState, staffId: string, date: string) {
  return plannedHoursFor(s, staffId, date).locationId ?? s.organisation.locationId
}

/**
 * Every location someone works at across their usual week from today, and from each move still to
 * come (Stage 4), and anywhere the rota sends them on a day still to come (Stage 3).
 */
export function staffPlaces(s: BusinessState, staffId: string, now = new Date().toISOString()) {
  const main = s.organisation.locationId
  const today = businessDate(s, now)
  const weeks = [
    today,
    ...(operations(s).staffMoves ?? [])
      .filter((m) => !m.cancelled && m.staffId === staffId && m.date > today)
      .map((m) => m.date),
  ]
  return [
    ...new Set([
      ...weeks.flatMap((from) =>
        Array.from(
          { length: 7 },
          (_, i) => usualHoursFor(s, staffId, addDays(from, i)).locationId ?? main,
        ),
      ),
      ...(operations(s).rotaChanges ?? [])
        .filter((c) => !c.ended && c.working && c.staffId === staffId && c.date >= today)
        .map((c) => c.locationId ?? main),
    ]),
  ]
}

/** Where a visit takes place: its name and address for guests and messages. */
export function visitPlace(s: BusinessState, a: Pick<Appointment, 'locationId'>) {
  return placeOf(s, a.locationId) ?? places(s)[0]
}

/** Names a location on a record only when it is not the main one, which stays unnamed as before. */
export function placeField(s: BusinessState, locationId: string | undefined) {
  return locationId && locationId !== s.organisation.locationId ? { locationId } : {}
}

/**
 * Stage 4: the location a gift card belongs to now: where it was last moved to, or where it was
 * sold. Where it was sold (`locationId`) never changes, so its sale stays in that location's
 * figures; the card can still be spent at any location.
 */
export function giftHome(s: BusinessState, card: Pick<GiftCard, 'locationId' | 'moves'>) {
  return card.moves?.at(-1)?.to ?? card.locationId ?? s.organisation.locationId
}

/**
 * Where a sale without a visit was made, such as a gift card or a package: an open location,
 * named on the record only when it is not the main one (V2).
 */
export function salePlace(s: BusinessState, locationId: string | undefined) {
  const site = placeOf(s, locationId)
  if (!site || site.archived) throw new Error('Choose an open location.')
  return placeField(s, site.id)
}

/** A treatment as offered at one location, with its price there (V2). */
export function serviceAt<T extends Pick<Service, 'priceMinor' | 'locationPrices'>>(
  service: T,
  locationId: string | undefined,
): T {
  const row = locationId && service.locationPrices?.find((r) => r.locationId === locationId)
  return row ? { ...service, priceMinor: row.priceMinor } : service
}

export function offeredAt(service: Pick<Service, 'notOfferedAt'>, locationId: string) {
  return !service.notOfferedAt?.includes(locationId)
}

/**
 * A treatment's price for a list, from the places a guest can actually book it: the lowest of
 * them, and whether it differs between them, so the list says "From" (V2).
 */
export function listPrice(
  service: Pick<Service, 'priceMinor' | 'locationPrices'>,
  bookableIds: string[],
) {
  const prices = bookableIds.map((id) => serviceAt(service, id).priceMinor)
  if (!prices.length) return { priceMinor: service.priceMinor, from: false }
  return { priceMinor: Math.min(...prices), from: new Set(prices).size > 1 }
}

/**
 * The open locations where a guest can book a treatment: it is on the menu there and someone who
 * does it works there in a usual week (V2).
 */
export function bookablePlaces(s: BusinessState, service: Pick<Service, 'id' | 'notOfferedAt'>) {
  return places(s).filter(
    (place) =>
      offeredAt(service, place.id) &&
      s.staff.some(
        (p) =>
          !p.archived &&
          p.serviceIds.includes(service.id) &&
          staffPlaces(s, p.id).includes(place.id),
      ),
  )
}

/**
 * The studio as seen from one location, for figures: its visits and their receipts, and walk-in
 * sales, gift cards, packages and memberships sold there (anything sold before locations were
 * recorded counts at the main one). A gift card moved since (Stage 4) still counts where it was
 * sold. Everything else is unchanged.
 */
export function atPlace(s: BusinessState, locationId: string): BusinessState {
  const main = s.organisation.locationId
  const here = (row: { locationId?: string }) => (row.locationId ?? main) === locationId
  const appointments = s.appointments.filter((a) => a.locationId === locationId)
  const visits = new Set(appointments.map((a) => a.id))
  return {
    ...s,
    appointments,
    sales: s.sales.filter((sale) => visits.has(sale.appointmentId)),
    ...(s.counterSales ? { counterSales: s.counterSales.filter(here) } : {}),
    ...(s.giftCards ? { giftCards: s.giftCards.filter(here) } : {}),
    ...(s.holdings ? { holdings: s.holdings.filter(here) } : {}),
  }
}

/** Ledger checks: every location named is known, and every id is used once. */
export function locationsProblem(s: BusinessState) {
  const all = places(s, true)
  const known = new Set(all.map((p) => p.id))
  if (known.size !== all.length) return 'Duplicate location IDs.'
  if (s.resources.some((r) => r.locationId && !known.has(r.locationId)))
    return 'A room names a missing location.'
  if (s.staff.some((p) => p.hours?.some((h) => h.locationId && !known.has(h.locationId))))
    return 'Working hours name a missing location.'
  if (s.appointments.some((a) => !known.has(a.locationId)))
    return 'A visit names a missing location.'
  const o = operations(s)
  if (o.hours.some((h) => h.locationId)) return 'Studio opening hours cannot name a location.'
  const main = s.organisation.locationId
  if (
    s.services.some(
      (service) =>
        service.locationPrices?.some((r) => r.locationId === main || !known.has(r.locationId)) ||
        service.notOfferedAt?.some((place) => !known.has(place)),
    )
  )
    return 'A treatment names a missing location.'
  if (
    o.movements.some((m) => m.locationId && !known.has(m.locationId)) ||
    (s.counterSales ?? []).some((c) => c.locationId && !known.has(c.locationId)) ||
    (s.giftCards ?? []).some(
      (c) =>
        (c.locationId && !known.has(c.locationId)) ||
        c.moves?.some((m) => !known.has(m.from) || !known.has(m.to)),
    ) ||
    (o.staffMoves ?? []).some((m) => !known.has(m.to) || m.days.some((d) => !known.has(d.from))) ||
    (s.holdings ?? []).some((h) => h.locationId && !known.has(h.locationId)) ||
    (o.purchaseOrders ?? []).some((order) => order.locationId && !known.has(order.locationId)) ||
    (s.waitlist ?? []).some((entry) => entry.locationId && !known.has(entry.locationId))
  )
    return 'Stock, a sale, an order or the waitlist names a missing location.'
  // Moving stock is always a matched pair: the same product leaves one location for another.
  const transfers = new Map<string, typeof o.movements>()
  for (const m of o.movements) {
    if ((m.reason === 'moved') !== !!m.transferId) return 'Invalid stock move.'
    if (m.transferId) transfers.set(m.transferId, [...(transfers.get(m.transferId) ?? []), m])
  }
  for (const [, pair] of transfers) {
    const [out, into] = pair
    if (
      pair.length !== 2 ||
      out.productId !== into.productId ||
      out.quantity + into.quantity !== 0 ||
      out.quantity === 0 ||
      (out.locationId ?? main) === (into.locationId ?? main)
    )
      return 'Invalid stock move.'
  }
  return null
}

/** The room's name, with its location when the studio has more than one: "Room 2, Islington". */
export function roomWithPlace(s: BusinessState, a: Pick<Appointment, 'resourceId' | 'locationId'>) {
  const room = s.resources.find((r) => r.id === a.resourceId)?.name ?? ''
  return hasLocations(s) || a.locationId !== s.organisation.locationId
    ? [room, visitPlace(s, a).name].filter(Boolean).join(', ')
    : room
}
