import type { BusinessState, Service } from './model'
import type { Command } from './commandSchema'
import { operations } from './operations'
import { SETUP_PLACES, SETUP_STEPS } from './setupSchema'
import type { SetupPlace, SetupStep } from './setupSchema'

/**
 * The two setup wizards' rules. "Set up your studio" takes a new owner from sign-up to taking
 * bookings, one screen at a time, each screen saving when they press Continue. "Add a location"
 * gathers a new location's details, rooms, team and menu and saves them together at the end.
 * Both make only the changes Settings already makes, so every check there applies here too.
 */

/** The furthest screen reached; going back to an earlier screen never moves it back. */
export function setupPlace(s: BusinessState): SetupPlace | null {
  return operations(s).setup?.next ?? null
}

export const setupFinished = (s: BusinessState) => setupPlace(s) === 'done'

/** Whether the owner has been through a screen and pressed Continue on it. */
export function setupPassed(s: BusinessState, step: SetupStep) {
  const place = setupPlace(s)
  return place !== null && SETUP_PLACES.indexOf(place) > SETUP_STEPS.indexOf(step)
}

/** The screen to open: where the owner left off, or the first one once they have finished. */
export function resumeStep(s: BusinessState): SetupStep {
  const place = setupPlace(s)
  return place && place !== 'done' ? place : SETUP_STEPS[0]
}

/** The studio after a setup screen, remembering the further of where it was and `next`. */
export function withSetupProgress(s: BusinessState, next: SetupPlace, now: string) {
  const o = operations(s)
  const before = o.setup?.next
  const furthest =
    before && SETUP_PLACES.indexOf(before) >= SETUP_PLACES.indexOf(next) ? before : next
  if (before === furthest) return s
  return {
    ...s,
    operations: {
      ...o,
      setup: { next: furthest, ...(furthest === 'done' ? { finishedAt: now } : {}) },
    },
  }
}

type Opening = Extract<Command, { type: 'location-open' }>
type WeekHours = ReturnType<typeof operations>['hours']
const weekdayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** Whether a treatment is on the menu and still offered. */
const current = (service: Service) => !service.archived

/**
 * Everything after the location itself, once it has an id: its rooms and chairs, the days each
 * person works there, any new people starting there, and its menu. Each is an ordinary Settings
 * change, so the schedule, house rules and price checks all apply.
 *
 * Someone who already works on a chosen day keeps their usual times and works them here; on a day
 * they had off they work the location's opening hours.
 */
export function locationParts(s: BusinessState, opening: Opening, locationId: string): Command[] {
  const studioHours = operations(s).hours
  const here = opening.location.hours ?? studioHours
  const name = opening.location.name.trim()
  const openOn = (day: number) => {
    const hours = here.find((h) => h.day === day)!
    if (hours.closed) throw new Error(`${name} is closed on ${weekdayNames[day]}s.`)
    return hours
  }
  const parts: Command[] = opening.rooms.map((room) => ({
    type: 'resource',
    input: { ...room, locationId },
  }))
  for (const { staffId, days } of opening.team) {
    const person = s.staff.find((p) => p.id === staffId && !p.archived)
    if (!person) throw new Error('Choose someone on the team.')
    const hours: WeekHours = (person.hours ?? studioHours).map((day) => {
      if (!days.includes(day.day)) return { ...day }
      const open = openOn(day.day)
      return day.closed
        ? { day: day.day, open: open.open, close: open.close, closed: false, locationId }
        : { ...day, locationId }
    })
    parts.push({
      type: 'staff',
      id: person.id,
      input: {
        name: person.name,
        role: person.role,
        tone: person.tone,
        serviceIds: person.serviceIds,
        hours,
        ...(person.archived !== undefined ? { archived: person.archived } : {}),
      },
    })
  }
  const offered = new Set(s.services.filter(current).map((service) => service.id))
  for (const person of opening.newTeam) {
    if (person.serviceIds.some((id) => !offered.has(id)))
      throw new Error('Choose treatments on your menu for each new person.')
    parts.push({
      type: 'staff',
      input: {
        name: person.name,
        role: person.role,
        tone: person.tone,
        serviceIds: person.serviceIds,
        hours: studioHours.map(({ day }) => {
          if (!person.days.includes(day)) {
            const usual = here.find((h) => h.day === day)!
            return { day, open: usual.open, close: usual.close, closed: true }
          }
          const open = openOn(day)
          return { day, open: open.open, close: open.close, closed: false, locationId }
        }),
      },
    })
  }
  // The menu: by default every treatment is offered here at the house price.
  const left = new Set(opening.notOffered)
  const priced = new Map(opening.prices.map((row) => [row.serviceId, row.priceMinor]))
  for (const id of [...left, ...priced.keys()])
    if (!offered.has(id)) throw new Error('Choose treatments on your menu.')
  for (const service of s.services.filter(current)) {
    const price = priced.get(service.id)
    const offeredHere = !left.has(service.id)
    const ownPrice = offeredHere && price !== undefined && price !== service.priceMinor
    if (offeredHere && !ownPrice) continue
    const { id, organisationId: _organisation, ...input } = service
    void _organisation
    parts.push({
      type: 'service',
      id,
      input: {
        ...input,
        ...(offeredHere ? {} : { notOfferedAt: [...(input.notOfferedAt ?? []), locationId] }),
        ...(ownPrice
          ? {
              locationPrices: [
                ...(input.locationPrices ?? []),
                { locationId, priceMinor: price as number },
              ],
            }
          : {}),
      },
    })
  }
  return parts
}

/** Adds the location, then everything that goes with it, through `run`; returns the new id. */
export function openLocation(
  s: BusinessState,
  opening: Opening,
  run: (command: Command) => string,
) {
  const locationId = run({ type: 'location', input: opening.location })
  for (const part of locationParts(s, opening, locationId)) run(part)
  return locationId
}

/** A rough guide to what each kind of treatment needs: a room, or a styling chair. */
export const PLACE_FOR = { Skin: 'treatment', Body: 'treatment', Hair: 'chair' } as const

/**
 * Common treatments a new owner can add with one tap, by kind. The length is filled in; the price
 * is always the owner's to type, so nothing is charged at a price SALEANE guessed.
 */
export const STARTER_TREATMENTS: Record<
  Service['category'],
  readonly { name: string; minutes: number }[]
> = {
  Hair: [
    { name: 'Cut and finish', minutes: 60 },
    { name: 'Blow-dry', minutes: 45 },
    { name: 'Full head colour', minutes: 120 },
    { name: 'Highlights', minutes: 150 },
    { name: 'Gloss and tone', minutes: 45 },
  ],
  Skin: [
    { name: 'Signature facial', minutes: 60 },
    { name: 'Express facial', minutes: 30 },
    { name: 'Brow shape and tint', minutes: 30 },
    { name: 'Lash lift', minutes: 45 },
  ],
  Body: [
    { name: 'Full body massage', minutes: 60 },
    { name: 'Back, neck and shoulder massage', minutes: 30 },
    { name: 'Manicure', minutes: 45 },
    { name: 'Pedicure', minutes: 60 },
  ],
}

/**
 * Rooms and chairs to suggest from the menu: one of each kind the treatments need that the
 * studio does not have yet, numbered after any already there.
 */
export function suggestedRooms(
  services: readonly Pick<Service, 'resourceType' | 'archived'>[],
  rooms: readonly { type: 'treatment' | 'chair'; archived?: boolean }[],
) {
  const kinds = (['treatment', 'chair'] as const).filter((kind) =>
    services.some((service) => !service.archived && service.resourceType === kind),
  )
  return kinds
    .filter((kind) => !rooms.some((room) => !room.archived && room.type === kind))
    .map((kind) => ({
      type: kind,
      name: kind === 'treatment' ? 'Treatment room 1' : 'Styling chair 1',
    }))
}
