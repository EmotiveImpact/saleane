import type { BusinessState, Client, Region } from './model'
import { addDays } from './format'
import { hoursFor, operations, staffHoursFor } from './operations'

/**
 * The fictional sample studio's regular clients and their diary. Everything here is invented and
 * deterministic: a seeded random generator gives the same clients, visits and bookings every time,
 * so tests and screenshots can rely on them.
 */

/** mulberry32, a small seeded random number generator: a number from 0 up to 1 each call. */
export function seeded(seed: number) {
  let t = seed >>> 0
  return () => {
    t = (t + 0x6d2b79f5) >>> 0
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}
export type Random = () => number
const below = (random: Random, n: number) => Math.floor(random() * n)
/** A shuffled copy, the same in every browser for the same random numbers. */
function shuffled<T>(random: Random, items: readonly T[]) {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = below(random, i + 1)
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}
function weighted<T>(random: Random, items: readonly (readonly [T, number])[]) {
  let left = random() * items.reduce((sum, [, weight]) => sum + weight, 0)
  for (const [item, weight] of items) if ((left -= weight) < 0) return item
  return items[items.length - 1][0]
}
const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000)

/**
 * Who is booked when. A sample visit is placed only where the studio is open, the person is
 * working and free, and their room or chair is free, turnaround time included.
 */
export class Diary {
  private readonly days = new Map<
    string,
    { staffId: string; resourceId: string; from: number; to: number }[]
  >()
  constructor(private readonly s: BusinessState) {}
  fits(staffId: string, resourceId: string, date: string, start: number, minutes: number) {
    const studio = hoursFor(this.s, date)
    const own = staffHoursFor(this.s, staffId, date)
    const end = start + minutes
    if (studio.closed || own.closed) return false
    if (start < Math.max(studio.open, own.open) || end > Math.min(studio.close, own.close))
      return false
    if (
      operations(this.s).closures.some(
        (c) =>
          c.date === date &&
          (!c.staffId || c.staffId === staffId) &&
          start < c.endMinutes &&
          end > c.startMinutes,
      )
    )
      return false
    return !(this.days.get(date) ?? []).some(
      (v) => (v.staffId === staffId || v.resourceId === resourceId) && start < v.to && end > v.from,
    )
  }
  take(staffId: string, resourceId: string, date: string, start: number, minutes: number) {
    if (!this.fits(staffId, resourceId, date, start, minutes))
      throw new Error(`The sample diary cannot place ${staffId} on ${date} at minute ${start}.`)
    const day = this.days.get(date) ?? []
    day.push({ staffId, resourceId, from: start, to: start + minutes })
    this.days.set(date, day)
  }
  /** Visits a person already has on a day. */
  count(staffId: string, date: string) {
    return (this.days.get(date) ?? []).filter((v) => v.staffId === staffId).length
  }
}

/** What a regular usually books, with whom, how often and at what time of day. */
export type Habit = {
  staffId: string
  /** Treatments they book, the first most often. */
  serviceIds: string[]
  /** Usual days between visits. */
  every: number
  /** The weekday they like (0 is Sunday), when they have one. */
  weekday?: number
  /** Start times they like, best first, in minutes past midnight. */
  times: number[]
}
export type Regular = { client: Client; habit: Habit }

const FIRST =
  'Hannah Priya Freya Leah Maisie Aisha Chloe Sienna Rosa Imogen Harriet Esme Lily Martha Alice Phoebe Daisy Evie Florence Matilda Yasmin Amira Zara Layla Mei Hana Ines Lucia Camille Elena Nadia Tara Rhea Anya Kiran Sana Fatima Bethany Holly Georgia Abigail Lauren Megan Rebecca Katie Naomi Ruth Joanna Clara Helena Iris Ottilie Beatrice Thea Margot Sofia Gabriela Bianca Adaeze Chioma Temi Simone Keisha Niamh Orla Ffion Eilidh Oliver James Arjun Tom Ben Sam Max Leo Felix Marcus Daniel Kwame Ravi Hugo Ethan Adam Callum Rory Jonah Elias Nikhil Omar'.split(
    ' ',
  )
const LAST =
  'Price Shah Collins Hughes Turner Rahman Marsh Ward Delgado Hart Fletcher Doyle Gill Okoye Mensah Nowak Rossi Moreau Silva Costa Ferreira Byrne Gallagher Quinn Walsh Kennedy Lindqvist Achterberg Ashworth Barker Bell Blake Bradley Bryant Carr Chapman Cole Dixon Ellis Fisher Foster Gibson Grant Hamilton Hayward Holland Hope Hudson Hunt Iqbal Jenkins Kapoor Kerr Lawson Lowe Lynch Mason Mills Mitchell Nash Nolan Osei Owusu Palmer Parry Patel Pearce Perry Pike Ramsay Reid Rees Riley Russell Sandhu Saunders Sharma Sloane Spencer Stevens Sutton Thornton Tran Vaughan Wade Webb Wells Whitaker Wilde Yeo'.split(
    ' ',
  )
/** Where sample clients live, by the first half of the postcode (US: first three ZIP digits). */
const AREAS: Record<Region, [string, number][]> = {
  UK: [
    ['W1G', 7],
    ['W1U', 5],
    ['W1H', 4],
    ['W1W', 3],
    ['W1T', 2],
    ['NW1', 6],
    ['NW8', 4],
    ['W2', 5],
    ['W9', 3],
    ['NW3', 2],
    ['W11', 2],
    ['N1', 2],
    ['WC1H', 1],
    ['SW3', 1],
    ['SW7', 1],
    ['EC1V', 1],
    ['N7', 1],
    ['E8', 1],
  ],
  US: [
    ['100', 12],
    ['101', 2],
    ['102', 1],
    ['104', 1],
    ['110', 1],
    ['112', 5],
    ['113', 2],
    ['114', 1],
    ['070', 2],
    ['073', 2],
  ],
}
const MORNING = [540, 570, 600, 630, 660]
const MIDDAY = [690, 720, 750, 780, 810]
const AFTERNOON = [840, 870, 900, 930, 960, 990]

/** What each person's regulars book, and how often (days between visits). */
const BOOKS: Record<string, [serviceIds: string[], every: [number, number], weight: number][]> = {
  'staff-maya': [
    [['service-facial'], [28, 42], 6],
    [['service-restore', 'service-facial'], [21, 35], 3],
  ],
  'staff-sophia': [
    [['service-lymphatic'], [21, 35], 4],
    [['service-restore', 'service-lymphatic'], [21, 35], 4],
    [['service-facial'], [28, 42], 2],
  ],
  'staff-theo': [
    [['service-cut'], [28, 42], 2],
    // Colour: a gloss every few weeks, with a cut now and then.
    [['service-gloss', 'service-cut'], [21, 35], 1],
  ],
}

/**
 * Fictional regular clients. Phone numbers are from the ranges set aside for drama and examples
 * (07700 900xxx in the UK, 555-01xx in the US); email addresses are at example.com.
 */
export function sampleRegulars(
  region: Region,
  count: number,
  random: Random,
  organisationId: string,
  taken: string[],
  /** The weekdays each person works (0 is Sunday). */
  workdays: Record<string, number[]>,
): Regular[] {
  const used = new Set(taken)
  const regulars: Regular[] = []
  for (let i = 0; regulars.length < count; i++) {
    const first = FIRST[i % FIRST.length]
    const name = `${first} ${LAST[(i * 37 + 11) % LAST.length]}`
    if (used.has(name)) continue
    used.add(name)
    const n = regulars.length
    const staffId = weighted(random, [
      ['staff-maya', 32],
      ['staff-sophia', 34],
      ['staff-theo', 34],
    ] as const)
    const [serviceIds, [shortest, longest]] = weighted(
      random,
      BOOKS[staffId].map(([ids, every, weight]) => [[ids, every] as const, weight] as const),
    )
    const days = workdays[staffId]
    const band = weighted(random, [
      [MORNING, 4],
      [MIDDAY, 3],
      [AFTERNOON, 4],
    ] as const)
    const area = random() < 0.9 ? weighted(random, AREAS[region]) : undefined
    const phone =
      region === 'UK'
        ? `+44 7700 900${String(500 + n).padStart(3, '0')}`
        : `+1 ${['646', '917', '718', '347'][Math.floor(n / 100)]} 555 01${String(n % 100).padStart(2, '0')}`
    regulars.push({
      client: {
        organisationId,
        id: `client-r${n + 1}`,
        name,
        email: `${name.toLowerCase().replace(' ', '.')}@example.com`,
        phone,
        preferences: '',
        marketingConsent: random() < 0.72,
        // Replaced by the moment of their first booking once their visits are planned.
        createdAt: '2026-09-01T09:00:00.000Z',
        ...(area ? { postcodeArea: area } : {}),
      },
      habit: {
        staffId,
        serviceIds: [...serviceIds],
        every: shortest + 7 * below(random, (longest - shortest) / 7 + 1),
        ...(random() < 0.6 ? { weekday: days[below(random, days.length)] } : {}),
        times: shuffled(random, band),
      },
    })
  }
  return regulars
}

/** One visit placed in the sample diary, before its receipts and timeline are written. */
export type PlannedVisit = {
  id: string
  clientId: string
  serviceId: string
  staffId: string
  resourceId: string
  date: string
  start: number
  source: 'desk' | 'online' | 'rebook'
  /** The completed visit this one was booked at the checkout of. */
  rebookedFromId?: string
  /** When it was booked: a day and minutes past midnight on the studio's clock. */
  bookedOn: string
  bookedMinutes: number
}

export type DiaryWindow = {
  /** The first day of the sample's records. */
  from: string
  /** The sample day. Regulars are never added to it; its visits are the sample's own. */
  today: string
  /** The last day a regular has booked by phone, online or at the desk. */
  until: string
  /** The last day a next visit booked at checkout can be. */
  rebookUntil: string
}

/**
 * Places each regular's visits at their usual rhythm, near their usual day and time, wherever the
 * diary is free: visits before the sample day are complete, and after it each regular has at most
 * one visit booked. About three in five book their next visit at checkout. A regular whose usual
 * gap has passed always has a visit booked, so the sample's "ready to return" list stays its own.
 */
export function planRegulars(
  s: BusinessState,
  diary: Diary,
  regulars: Regular[],
  random: Random,
  window: DiaryWindow,
  roomFor: (staffId: string) => string,
  /** The most visits a person takes in a day, so days keep some open time. */
  dailyLimit: (staffId: string, date: string) => number,
): PlannedVisit[] {
  const planned: PlannedVisit[] = []
  const length = (serviceId: string) => {
    const service = s.services.find((item) => item.id === serviceId)!
    return service.durationMinutes + service.bufferMinutes
  }
  const needsTest = (serviceId: string) =>
    !!s.services.find((item) => item.id === serviceId)?.patchTest
  /** The nearest free time on or around a day, trying their own times first. */
  function place(
    regular: Regular,
    serviceId: string,
    target: string,
    earliest: string,
    latest: string,
  ) {
    const { habit } = regular
    const minutes = length(serviceId)
    const resourceId = roomFor(habit.staffId)
    const offsets = [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6, -6]
    const days = offsets
      .map((offset) => addDays(target, offset))
      .filter((date) => date >= earliest && date <= latest && date !== window.today)
      // Their own weekday first, then the nearest day.
      .sort(
        (a, b) =>
          Number(new Date(`${b}T12:00:00Z`).getUTCDay() === habit.weekday) -
          Number(new Date(`${a}T12:00:00Z`).getUTCDay() === habit.weekday),
      )
    const others = [...MORNING, ...MIDDAY, ...AFTERNOON].filter((t) => !habit.times.includes(t))
    for (const date of days) {
      if (diary.count(habit.staffId, date) >= dailyLimit(habit.staffId, date)) continue
      for (const start of [...habit.times, ...others])
        if (diary.fits(habit.staffId, resourceId, date, start, minutes)) {
          diary.take(habit.staffId, resourceId, date, start, minutes)
          return { date, start, resourceId }
        }
    }
    return undefined
  }
  for (const regular of regulars) {
    const { habit } = regular
    let target = addDays(window.from, below(random, habit.every))
    let previous: PlannedVisit | undefined
    for (;;) {
      const usual =
        habit.serviceIds.length > 1 && random() < 0.3 ? habit.serviceIds[1] : habit.serviceIds[0]
      // Colour needs a patch test, which is done at an earlier visit, so a first visit is not colour.
      const serviceId =
        !previous && needsTest(usual)
          ? (habit.serviceIds.find((id) => !needsTest(id)) ?? usual)
          : usual
      if (target >= window.today) {
        // After the sample day: at most one visit, and only once they have booked it.
        const rebooked = !!previous && random() < 0.62
        const due = !!previous && addDays(previous.date, 28) <= window.today
        const soon = daysBetween(window.today, target) <= 14
        if (!rebooked && !due && !(soon && random() < 0.8) && random() >= 0.15) break
        // Booked at checkout, or due back already: the first good time, however far ahead.
        const latest = rebooked || due ? window.rebookUntil : window.until
        if (target > latest) break
        let at = place(regular, serviceId, target, addDays(window.today, 1), latest)
        for (
          let later = addDays(target, 7);
          due && !at && later <= latest;
          later = addDays(later, 7)
        )
          at = place(regular, serviceId, later, addDays(window.today, 1), latest)
        if (at) planned.push(booking(regular, serviceId, at, previous, rebooked))
        break
      }
      const at = place(regular, serviceId, target, window.from, addDays(window.today, -1))
      if (at) {
        previous = booking(regular, serviceId, at, previous, !!previous && random() < 0.62)
        planned.push(previous)
      }
      target = addDays(at?.date ?? target, habit.every + below(random, 7) - 3)
    }
  }
  return planned

  function booking(
    regular: Regular,
    serviceId: string,
    at: { date: string; start: number; resourceId: string },
    previous: PlannedVisit | undefined,
    rebooked: boolean,
  ): PlannedVisit {
    const base = {
      id: `visit-r${planned.length + 1}`,
      clientId: regular.client.id,
      serviceId,
      staffId: regular.habit.staffId,
      resourceId: at.resourceId,
      date: at.date,
      start: at.start,
    }
    if (rebooked && previous)
      // Booked at the desk as they paid for their last visit, just after it ended.
      return {
        ...base,
        source: 'rebook',
        rebookedFromId: previous.id,
        bookedOn: previous.date,
        bookedMinutes: previous.start + length(previous.serviceId) - 10,
      }
    // Otherwise booked one to three weeks ahead, by phone or online, after their last visit and
    // never later than the sample's own moment (the morning of the sample day).
    const latest = at.date > window.today ? window.today : addDays(at.date, -1)
    let bookedOn = addDays(at.date, -(2 + below(random, 18)))
    const earliest = previous ? addDays(previous.date, 1) : window.from
    if (bookedOn < earliest) bookedOn = earliest
    if (bookedOn > latest) bookedOn = latest
    // The desk is closed on Sundays, so a Sunday booking was made online.
    const online = random() < 0.45 || new Date(`${bookedOn}T12:00:00Z`).getUTCDay() === 0
    const opens = online ? 7 * 60 : 9 * 60
    const closes = bookedOn === window.today ? 10 * 60 + 30 : online ? 22 * 60 : 17 * 60 + 45
    return {
      ...base,
      source: online ? 'online' : 'desk',
      bookedOn,
      bookedMinutes: opens + 15 * below(random, (closes - opens) / 15 + 1),
    }
  }
}
