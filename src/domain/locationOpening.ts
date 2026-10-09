import type { BusinessState, Service } from './model'
import type { Command } from './commandSchema'
import { execute } from './commands'
import { operations } from './operations'
import { places } from './locations'
import { houseRules, priceRange } from './brandRules'
import { parseMinor, minorInput } from './money'
import { emailProblem, phoneProblem } from './studioContact'
import { isUpcoming, scheduleImpact } from './schedule'
import type { AffectedVisit } from './schedule'
import { locationParts, suggestedRooms } from './setup'

/**
 * "Add a location": what the owner fills in across its screens, the one change it saves at the
 * end, and what each screen still needs. Nothing is saved until the last screen, because a new
 * location is a new place guests can book and adds to the studio's monthly price.
 */
export const OPENING_STEPS = ['where', 'hours', 'treatments', 'rooms', 'team', 'open'] as const
export type OpeningStep = (typeof OPENING_STEPS)[number]

type WeekHours = ReturnType<typeof operations>['hours']
type Place = Service['resourceType']
type Opening = Extract<Command, { type: 'location-open' }>

export type OpeningDraft = {
  name: string
  address: string
  phone: string
  email: string
  note: string
  /** Its own opening hours, or the studio's. */
  ownHours: boolean
  hours: WeekHours
  /** Each treatment on the menu: whether it is offered here and at what price. */
  menu: Record<string, { offered: boolean; price: string }>
  rooms: { key: string; name: string; type: Place }[]
  /** The days each person already on the team works here, Sunday as 0. */
  days: Record<string, number[]>
  newTeam: { key: string; name: string; role: string; serviceIds: string[]; days: number[] }[]
}

const current = <T extends { archived?: boolean }>(rows: T[]) => rows.filter((r) => !r.archived)

/** A treatment's line on this location's menu; one added since the wizard opened is offered. */
export const menuRow = (draft: OpeningDraft, service: Service) =>
  draft.menu[service.id] ?? { offered: true, price: minorInput(service.priceMinor) }

/** A core treatment under the house rules stays on every location's menu. */
export const coreTreatment = (s: BusinessState, id: string) =>
  !!houseRules(s).coreServiceIds?.includes(id)

export function openingDraft(s: BusinessState): OpeningDraft {
  return {
    name: '',
    address: '',
    phone: '',
    email: '',
    note: '',
    ownHours: false,
    hours: operations(s).hours.map((day) => ({ ...day })),
    menu: Object.fromEntries(
      current(s.services).map((service) => [
        service.id,
        { offered: true, price: minorInput(service.priceMinor) },
      ]),
    ),
    rooms: [],
    days: {},
    newTeam: [],
  }
}

/** The location's opening hours as the draft stands. */
export const openingHours = (s: BusinessState, draft: OpeningDraft) =>
  draft.ownHours ? draft.hours : operations(s).hours

/** Days the location is open, so only those can be chosen for its team. */
export function openDays(s: BusinessState, draft: OpeningDraft) {
  return new Set(openingHours(s, draft).flatMap((h) => (h.closed ? [] : [h.day])))
}

/** Rooms to start with: one of each kind its menu needs, named after the location. */
export function startingRooms(s: BusinessState, draft: OpeningDraft) {
  const name = draft.name.trim() || 'New location'
  const offered = current(s.services).filter((x) => menuRow(draft, x).offered)
  return suggestedRooms(offered, draft.rooms).map((room, i) => ({
    key: `suggested-${room.type}-${i}`,
    type: room.type,
    name: room.type === 'chair' ? `${name} chair 1` : `${name} room 1`,
  }))
}

/** The one change the last screen saves. */
export function openingCommand(s: BusinessState, draft: OpeningDraft): Opening {
  const open = openDays(s, draft)
  const onOpenDays = (days: number[]) => days.filter((day) => open.has(day))
  const services = current(s.services)
  const team = new Set(current(s.staff).map((person) => person.id))
  return {
    type: 'location-open',
    location: {
      name: draft.name.trim(),
      address: draft.address.trim(),
      ...(draft.note.trim() ? { arrivalNote: draft.note.trim() } : {}),
      ...(draft.phone.trim() ? { phone: draft.phone.trim() } : {}),
      ...(draft.email.trim() ? { email: draft.email.trim() } : {}),
      ...(draft.ownHours ? { hours: draft.hours } : {}),
    },
    rooms: draft.rooms.map((room) => ({ name: room.name.trim(), type: room.type })),
    team: Object.entries(draft.days)
      .map(([staffId, days]) => ({ staffId, days: onOpenDays(days) }))
      .filter((row) => team.has(row.staffId) && row.days.length > 0),
    newTeam: draft.newTeam.map((person, i) => ({
      name: person.name.trim(),
      role: person.role.trim(),
      tone: (['sage', 'blue', 'sand'] as const)[i % 3],
      serviceIds: person.serviceIds,
      days: onOpenDays(person.days),
    })),
    notOffered: services.filter((x) => !menuRow(draft, x).offered).map((x) => x.id),
    prices: services.flatMap((service) => {
      const row = menuRow(draft, service)
      const price = row.offered ? parseMinor(row.price) : NaN
      return Number.isFinite(price) && price !== service.priceMinor
        ? [{ serviceId: service.id, priceMinor: price }]
        : []
    }),
  }
}

/** The lowest and highest price allowed here under the house rules, if there is a price band. */
export function priceLimits(s: BusinessState, service: Service) {
  const band = houseRules(s).priceBandPercent
  return band === undefined ? null : { band, ...priceRange(service.priceMinor, band) }
}

/** The weekdays someone already has visits booked, which moving that day here would strand. */
export function bookedWeekdays(s: BusinessState, staffId: string, now: string) {
  const days = new Set<number>()
  for (const a of s.appointments)
    if (a.staffId === staffId && isUpcoming(s, a, now))
      days.add(new Date(`${a.date}T12:00:00Z`).getUTCDay())
  return days
}

/**
 * Visits already booked that the team's days here would leave stranded: someone moved here on
 * a day they have visits at another location. Shown on the team screen, so the owner can choose
 * other days before saving; the save itself refuses them too.
 */
export function openingImpact(s: BusinessState, draft: OpeningDraft, now: string): AffectedVisit[] {
  const opening = openingCommand(s, draft)
  if (!opening.team.length) return []
  const preview = 'location-preview'
  const added = execute(s, { type: 'location', input: opening.location }, now, () => preview)
  if (!added.ok) return []
  try {
    const parts = locationParts(
      s,
      { ...opening, rooms: [], newTeam: [], notOffered: [], prices: [] },
      preview,
    )
    return parts.flatMap((part) =>
      part.type === 'staff' ? scheduleImpact(added.state, part, now) : [],
    )
  } catch {
    return []
  }
}

/** What a screen still needs before Continue, in plain words, or null when it is ready. */
export function openingProblem(
  s: BusinessState,
  step: OpeningStep,
  draft: OpeningDraft,
  impact: AffectedVisit[] = [],
): string | null {
  const region = s.organisation.region
  const services = current(s.services)
  if (step === 'where') {
    const name = draft.name.trim()
    if (name.length < 2) return 'Give the location a name, such as the area it is in.'
    if (places(s, true).some((p) => p.name.toLowerCase() === name.toLowerCase()))
      return 'Another location already has that name.'
    if (draft.address.trim().length < 5) return 'Add the address so guests can find it.'
    if (draft.phone.trim()) {
      const problem = phoneProblem(draft.phone, region)
      if (problem) return problem
    }
    if (draft.email.trim()) {
      const problem = emailProblem(draft.email)
      if (problem) return problem
    }
    return null
  }
  if (step === 'hours') {
    if (!draft.ownHours) return null
    const open = draft.hours.filter((h) => !h.closed)
    if (!open.length) return 'Open on one day at least.'
    const late = open.find((h) => h.close <= h.open)
    if (late) return `On ${weekdayNames[late.day]}, closing must come after opening.`
    return null
  }
  if (step === 'treatments') {
    const core = services.find((x) => coreTreatment(s, x.id) && !menuRow(draft, x).offered)
    if (core) return `${core.name} is a core treatment, so it stays on every location’s menu.`
    const offered = services.filter((x) => menuRow(draft, x).offered)
    if (!offered.length) return 'Offer one treatment here at least.'
    for (const service of offered) {
      const price = parseMinor(menuRow(draft, service).price)
      if (!Number.isFinite(price) || price < 0) return `Add a price for ${service.name}.`
      const limits = priceLimits(s, service)
      if (limits && (price < limits.min || price > limits.max))
        return limits.band === 0
          ? `Under the house rules ${service.name} is the same price everywhere.`
          : `Under the house rules ${service.name} stays within ${limits.band}% of the house price.`
    }
    return null
  }
  if (step === 'rooms') {
    if (!draft.rooms.length) return 'Add a room or chair here.'
    if (draft.rooms.some((room) => room.name.trim().length < 2)) return 'Give each room a name.'
    const names = draft.rooms.map((room) => room.name.trim().toLowerCase())
    if (new Set(names).size !== names.length) return 'Give each room its own name.'
    const kinds = new Set(draft.rooms.map((room) => room.type))
    const unplaced = services.find((x) => menuRow(draft, x).offered && !kinds.has(x.resourceType))
    if (unplaced)
      return unplaced.resourceType === 'chair'
        ? `${unplaced.name} needs a styling chair. Add one, or leave it off the menu here.`
        : `${unplaced.name} needs a treatment room. Add one, or leave it off the menu here.`
    return null
  }
  if (step === 'team') {
    const open = openDays(s, draft)
    const working =
      Object.values(draft.days).some((days) => days.some((day) => open.has(day))) ||
      draft.newTeam.length > 0
    if (!working) return 'Choose who works here, and on which days.'
    for (const person of draft.newTeam) {
      const who = person.name.trim()
      if (who.length < 2) return 'Give each new person a name.'
      if (person.role.trim().length < 2)
        return `Say what ${who} does, such as Stylist or Therapist.`
      if (!person.serviceIds.length) return `Tick the treatments ${who} gives.`
      if (!person.days.some((day) => open.has(day))) return `Choose the days ${who} works here.`
    }
    if (impact.length)
      return 'Some visits already booked would lose their professional. Choose other days for them, or move those visits first.'
    return null
  }
  return null
}

const weekdayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
