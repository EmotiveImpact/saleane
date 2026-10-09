import type { BusinessState, Service } from './model'
import type { Command } from './commandSchema'
import type { StudioLook } from './brandRulesSchema'
import { firstColours, secondColours } from './brandRulesSchema'
import { operations } from './operations'
import { parseMinor, minorInput } from './money'
import { emailProblem, phoneProblem } from './studioContact'
import { PLACE_FOR, suggestedRooms } from './setup'
import type { SETUP_CHANGE_TYPES } from './setupSchema'

/**
 * What each screen of "Set up your studio" holds while the owner works on it, and the Settings
 * changes it saves when they press Continue. A screen saves only what differs from the studio
 * record, and says in plain words what is missing before it can save.
 */
/** A Settings change a setup screen can make. */
export type SetupChange = Extract<Command, { type: (typeof SETUP_CHANGE_TYPES)[number] }>
type Screen = { changes: SetupChange[]; problem: string | null }
type WeekHours = ReturnType<typeof operations>['hours']
type Category = Service['category']
type Place = Service['resourceType']
const live = <T extends { archived?: boolean }>(rows: readonly T[]) =>
  rows.filter((r) => !r.archived)
const weekdayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const firstName = (rows: { name: string }[]) => rows[0]?.name.trim() || 'one of them'

/** The studio's name, address and how guests reach it. */
export type StudioDraft = {
  name: string
  locationName: string
  address: string
  phone: string
  email: string
}
export function studioDraft(s: BusinessState): StudioDraft {
  const o = s.organisation
  return {
    name: o.name,
    locationName: o.locationName,
    address: o.address,
    phone: o.phone ?? '',
    email: o.email ?? '',
  }
}
export function studioScreen(s: BusinessState, d: StudioDraft): Screen {
  const o = s.organisation
  const problem =
    d.name.trim().length < 2
      ? 'Add your business name.'
      : d.locationName.trim().length < 2
        ? 'Name this location, such as the area it is in.'
        : !d.address.trim()
          ? 'Add your address so guests can find you.'
          : d.phone.trim()
            ? phoneProblem(d.phone, o.region)
            : null
  const emailIssue = d.email.trim() ? emailProblem(d.email) : null
  const same =
    d.name.trim() === o.name &&
    d.locationName.trim() === o.locationName &&
    d.address.trim() === o.address &&
    d.phone.trim() === (o.phone ?? '') &&
    d.email.trim() === (o.email ?? '')
  return {
    problem: problem ?? emailIssue,
    changes: same
      ? []
      : [
          {
            type: 'organisation',
            name: d.name.trim(),
            locationName: d.locationName.trim(),
            address: d.address.trim(),
            timeZone: o.timeZone,
            bookingEnabled: operations(s).bookingEnabled,
            phone: d.phone.trim(),
            email: d.email.trim(),
          },
        ],
  }
}

/** The week the studio is open. */
export const hoursDraft = (s: BusinessState): WeekHours =>
  operations(s).hours.map((day) => ({ ...day }))
export function hoursScreen(s: BusinessState, hours: WeekHours): Screen {
  const late = [1, 2, 3, 4, 5, 6, 0]
    .map((n) => hours.find((h) => h.day === n)!)
    .find((h) => !h.closed && h.close <= h.open)
  const problem = !hours.some((h) => !h.closed)
    ? 'Open on one day at least.'
    : late
      ? `On ${weekdayNames[late.day]}, closing must come after opening.`
      : null
  const same = JSON.stringify(hours) === JSON.stringify(operations(s).hours)
  return { problem, changes: same ? [] : [{ type: 'hours', hours }] }
}

/** One treatment on the screen: a saved one has its id; a new one has only a key. */
export type TreatmentRow = {
  key: string
  id?: string
  name: string
  category: Category
  minutes: number
  /** As typed, so an empty price stays empty until the owner gives one. */
  price: string
  place: Place
}
export type TreatmentsDraft = { rows: TreatmentRow[]; removed: string[] }
export function treatmentsDraft(s: BusinessState): TreatmentsDraft {
  return {
    rows: live(s.services).map((service) => ({
      key: service.id,
      id: service.id,
      name: service.name,
      category: service.category,
      minutes: service.durationMinutes,
      price: minorInput(service.priceMinor),
      place: service.resourceType,
    })),
    removed: [],
  }
}
/** A new treatment row of a kind, with the room or chair that kind usually needs. */
export function treatmentRow(
  key: string,
  category: Category,
  name = '',
  minutes = 60,
): TreatmentRow {
  return { key, name, category, minutes, price: '', place: PLACE_FOR[category] }
}
const inputOf = ({ id: _id, organisationId: _org, ...rest }: Service) => {
  void [_id, _org]
  return rest
}
export function treatmentsScreen(s: BusinessState, d: TreatmentsDraft): Screen {
  const unnamed = d.rows.find((row) => row.name.trim().length < 2)
  const unpriced = d.rows.find((row) => !Number.isFinite(parseMinor(row.price)))
  const problem = !d.rows.length
    ? 'Add one treatment at least.'
    : unnamed
      ? 'Give each treatment a name.'
      : unpriced
        ? `Add a price for ${unpriced.name.trim()}.`
        : null
  const changes: SetupChange[] = []
  for (const id of d.removed) {
    const service = s.services.find((x) => x.id === id)
    if (service && !service.archived)
      changes.push({ type: 'service', id, input: { ...inputOf(service), archived: true } })
  }
  for (const row of d.rows) {
    const values = {
      name: row.name.trim(),
      category: row.category,
      durationMinutes: row.minutes,
      priceMinor: parseMinor(row.price),
      resourceType: row.place,
    }
    const saved = row.id ? s.services.find((x) => x.id === row.id) : undefined
    if (!saved)
      changes.push({
        type: 'service',
        input: {
          ...values,
          description: '',
          bufferMinutes: 15,
          depositMinor: 0,
          archived: false,
        },
      })
    else if (
      (Object.keys(values) as (keyof typeof values)[]).some((key) => values[key] !== saved[key])
    )
      changes.push({ type: 'service', id: saved.id, input: { ...inputOf(saved), ...values } })
  }
  return { problem, changes: problem ? [] : changes }
}

/** One person on the team and the treatments they give. */
export type PersonRow = {
  key: string
  id?: string
  name: string
  role: string
  serviceIds: string[]
}
export type TeamDraft = { rows: PersonRow[]; removed: string[] }
export function teamDraft(s: BusinessState): TeamDraft {
  return {
    rows: live(s.staff).map((person) => ({
      key: person.id,
      id: person.id,
      name: person.name,
      role: person.role,
      serviceIds: [...person.serviceIds],
    })),
    removed: [],
  }
}
const tones = ['sage', 'blue', 'sand'] as const
/** What to call someone who gives this studio's treatments, as a starting point. */
export function usualRole(s: BusinessState) {
  const kinds = new Set(live(s.services).map((x) => x.category))
  return kinds.size === 1 && kinds.has('Hair') ? 'Stylist' : 'Therapist'
}
export function teamScreen(s: BusinessState, d: TeamDraft): Screen {
  const offered = new Set(live(s.services).map((x) => x.id))
  const unnamed = d.rows.find((row) => row.name.trim().length < 2)
  const noRole = d.rows.find((row) => row.role.trim().length < 2)
  const giving = d.rows.some((row) => row.serviceIds.some((id) => offered.has(id)))
  const problem = !d.rows.length
    ? 'Add one person at least. If you work on your own, add yourself.'
    : unnamed
      ? 'Give each person a name.'
      : noRole
        ? `Say what ${noRole.name.trim() || 'each person'} does, such as Stylist or Therapist.`
        : !giving
          ? `Tick the treatments ${firstName(d.rows)} gives.`
          : null
  const changes: SetupChange[] = []
  for (const id of d.removed) {
    const person = s.staff.find((p) => p.id === id)
    if (person && !person.archived) {
      const { id: _id, organisationId: _org, ...input } = person
      void [_id, _org]
      changes.push({ type: 'staff', id, input: { ...input, archived: true } })
    }
  }
  const used = live(s.staff).length
  d.rows.forEach((row, index) => {
    const values = {
      name: row.name.trim(),
      role: row.role.trim(),
      serviceIds: row.serviceIds.filter((id) => offered.has(id)),
    }
    const saved = row.id ? s.staff.find((p) => p.id === row.id) : undefined
    if (!saved)
      changes.push({
        type: 'staff',
        input: { ...values, tone: tones[(used + index) % tones.length], archived: false },
      })
    else if (
      values.name !== saved.name ||
      values.role !== saved.role ||
      values.serviceIds.join() !== saved.serviceIds.join()
    ) {
      const { id: _id, organisationId: _org, ...input } = saved
      void [_id, _org]
      changes.push({ type: 'staff', id: saved.id, input: { ...input, ...values } })
    }
  })
  return { problem, changes: problem ? [] : changes }
}

/** Rooms and chairs: what is there, plus one of each kind the menu needs and the studio lacks. */
export type RoomRow = { key: string; id?: string; name: string; type: Place }
export type RoomsDraft = { rows: RoomRow[]; removed: string[] }
export function roomsDraft(s: BusinessState): RoomsDraft {
  const rows: RoomRow[] = live(s.resources).map((room) => ({
    key: room.id,
    id: room.id,
    name: room.name,
    type: room.type,
  }))
  return {
    rows: [
      ...rows,
      ...suggestedRooms(s.services, s.resources).map((room) => ({
        ...room,
        key: `suggested-${room.type}`,
      })),
    ],
    removed: [],
  }
}
/** The next free name for another room or chair: "Treatment room 3". */
export function nextRoomName(rows: readonly RoomRow[], type: Place) {
  const base = type === 'treatment' ? 'Treatment room' : 'Styling chair'
  let n = rows.filter((row) => row.type === type).length + 1
  while (rows.some((row) => row.name.trim().toLowerCase() === `${base} ${n}`.toLowerCase())) n++
  return `${base} ${n}`
}
export function roomsScreen(s: BusinessState, d: RoomsDraft): Screen {
  const unnamed = d.rows.find((row) => row.name.trim().length < 2)
  const needed = (['treatment', 'chair'] as const).find(
    (type) =>
      live(s.services).some((x) => x.resourceType === type) &&
      !d.rows.some((row) => row.type === type),
  )
  const problem = !d.rows.length
    ? 'Add a room or a chair.'
    : unnamed
      ? 'Give each room and chair a name.'
      : needed
        ? needed === 'chair'
          ? 'Some treatments take place at a styling chair. Add one.'
          : 'Some treatments take place in a treatment room. Add one.'
        : null
  const changes: SetupChange[] = []
  for (const id of d.removed) {
    const room = s.resources.find((r) => r.id === id)
    if (room && !room.archived) {
      const { id: _id, organisationId: _org, ...input } = room
      void [_id, _org]
      changes.push({ type: 'resource', id, input: { ...input, archived: true } })
    }
  }
  for (const row of d.rows) {
    const saved = row.id ? s.resources.find((r) => r.id === row.id) : undefined
    const values = { name: row.name.trim(), type: row.type }
    if (!saved) changes.push({ type: 'resource', input: { ...values, archived: false } })
    else if (values.name !== saved.name || values.type !== saved.type) {
      const { id: _id, organisationId: _org, ...input } = saved
      void [_id, _org]
      changes.push({ type: 'resource', id: saved.id, input: { ...input, ...values } })
    }
  }
  return { problem, changes: problem ? [] : changes }
}

/** The studio's two colours. Saving records the choice even when the owner keeps the house ones. */
export const lookDraft = (s: BusinessState): StudioLook =>
  operations(s).look ?? { first: firstColours[0].value, second: secondColours[0].value }
export function lookScreen(s: BusinessState, look: StudioLook): Screen {
  const saved = operations(s).look
  const same = saved?.first === look.first && saved?.second === look.second
  return { problem: null, changes: same ? [] : [{ type: 'studio-look', look }] }
}

/** Deposits on each treatment, the missed visit fee, saved cards and tax. */
export type MoneyDraft = {
  /** By treatment id, as typed. */
  deposits: Record<string, string>
  feePercent: number
  saveCard: boolean
  /** Whether checkout adds VAT or sales tax at all; null until the owner says. */
  taxed: boolean | null
  rate: string
  included: boolean
}
export function moneyDraft(s: BusinessState): MoneyDraft {
  const o = operations(s)
  const uk = s.organisation.region === 'UK'
  return {
    deposits: Object.fromEntries(
      live(s.services).map((x) => [x.id, x.depositMinor ? minorInput(x.depositMinor) : '']),
    ),
    feePercent: o.protection?.feePercent ?? 0,
    saveCard: o.protection?.saveCard ?? false,
    // Many small studios are not VAT registered, so nothing is assumed either way.
    taxed: o.tax ? o.tax.rateBps > 0 : null,
    rate: o.tax?.rateBps ? String(o.tax.rateBps / 100) : uk ? '20' : '',
    // UK prices for the public include VAT; US prices usually have sales tax added at the till.
    included: o.tax?.inclusive ?? uk,
  }
}
/** Every treatment's deposit as a share of its price, rounded down to whole pounds or dollars. */
export function depositsAsShare(s: BusinessState, percent: number) {
  return Object.fromEntries(
    live(s.services).map((x) => {
      const minor = Math.floor((x.priceMinor * percent) / 100 / 100) * 100
      return [x.id, minor ? minorInput(minor) : '']
    }),
  )
}
export function moneyScreen(s: BusinessState, d: MoneyDraft): Screen {
  const o = operations(s)
  const label = s.organisation.region === 'UK' ? 'VAT' : 'Sales tax'
  const services = live(s.services)
  const unreadable = services.find((x) => !Number.isFinite(parseMinor(d.deposits[x.id] ?? '', 0)))
  const tooMuch = services.find((x) => parseMinor(d.deposits[x.id] ?? '', 0) > x.priceMinor)
  const rate = Number(d.rate)
  const problem = unreadable
    ? `Enter the deposit for ${unreadable.name} as an amount, such as 20 or 12.50.`
    : tooMuch
      ? `The deposit for ${tooMuch.name} is more than its price.`
      : d.taxed === null
        ? `Choose whether you charge ${label === 'VAT' ? 'VAT' : 'sales tax'}.`
        : d.taxed && !(rate > 0 && rate <= 100)
          ? `Enter your ${label === 'VAT' ? 'VAT' : 'sales tax'} rate, such as ${label === 'VAT' ? '20' : '8.875'}.`
          : null
  if (problem) return { problem, changes: [] }
  const changes: SetupChange[] = []
  for (const service of services) {
    const depositMinor = parseMinor(d.deposits[service.id] ?? '', 0)
    if (depositMinor !== service.depositMinor)
      changes.push({
        type: 'service',
        id: service.id,
        input: { ...inputOf(service), depositMinor },
      })
  }
  const protection = { saveCard: d.saveCard, feePercent: d.feePercent }
  if (
    !o.protection ||
    o.protection.saveCard !== protection.saveCard ||
    o.protection.feePercent !== protection.feePercent
  )
    changes.push({ type: 'protection', settings: protection })
  const tax = {
    label,
    rateBps: d.taxed ? Math.round(rate * 100) : 0,
    inclusive: d.taxed ? d.included : true,
  }
  if (
    !o.tax ||
    o.tax.label !== tax.label ||
    o.tax.rateBps !== tax.rateBps ||
    o.tax.inclusive !== tax.inclusive
  )
    changes.push({ type: 'tax', ...tax })
  return { problem: null, changes }
}

/** The last screen: whether to take bookings online from now on. */
export function openScreen(s: BusinessState, online: boolean): Screen {
  if (online === operations(s).bookingEnabled) return { problem: null, changes: [] }
  const o = s.organisation
  return {
    problem: null,
    changes: [
      {
        type: 'organisation',
        name: o.name,
        locationName: o.locationName,
        address: o.address,
        timeZone: o.timeZone,
        bookingEnabled: online,
      },
    ],
  }
}
