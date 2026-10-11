import type { Appointment, BusinessState } from './model'
import { addDays, dateLabel } from './format'
import { guestBackground } from './usual'
import { visitPatchTest } from './patchTests'

/**
 * Stage 6: the card the team reads before a guest arrives, so every guest feels remembered, and
 * the quiet milestones it carries. Everything is worked out from the record alone: a milestone is
 * counted from visits the guest actually came to, across every record with their email, and
 * nothing here changes the record or contacts anyone.
 */

const DAY = 86_400_000
/** A guest a few minutes late is still the next to arrive. */
export const LATE_GRACE_MINUTES = 10
/** The visit counts worth a quiet word; after 100, every 50th. */
const COUNTED = [5, 10, 25, 50, 75, 100]
/** A gap this long or longer between visits reads as coming back. */
const BACK_AFTER_DAYS = 180
/** An anniversary is mentioned at the first visit within this many days after it. */
const ANNIVERSARY_DAYS = 30
/** A birthday this close to the visit, either side, is mentioned. */
const BIRTHDAY_DAYS = 3
/** The studio's own visit counts worth a quiet word; after 1,000, every 1,000th. */
const STUDIO_COUNTED = [100, 250, 500, 1000]

export type GuestMilestone =
  | { kind: 'first-visit' }
  | { kind: 'visit-count'; count: number }
  | { kind: 'anniversary'; years: number }
  | { kind: 'birthday'; offsetDays: number }
  | { kind: 'back'; months: number }

const days = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / DAY)

/** The same day N years on; 29 February falls on 28 February in a common year. */
function yearsOn(date: string, years: number) {
  const [y, m, d] = date.split('-').map(Number)
  const year = y + years
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
  const day = m === 2 && d === 29 && !leap ? 28 : d
  return `${year}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

const counted = (n: number) => COUNTED.includes(n) || (n > 100 && n % 50 === 0)
export const studioCounted = (n: number) =>
  STUDIO_COUNTED.includes(n) || (n > 1000 && n % 1000 === 0)

/**
 * The milestones a visit brings, most personal first. `earlier` is every visit the guest came to
 * before this one, newest first (guestBackground). `birthday` is month and day only.
 */
export function guestMilestones(
  visit: Pick<Appointment, 'date'>,
  earlier: readonly Pick<Appointment, 'date'>[],
  birthday?: string,
): GuestMilestone[] {
  const found: GuestMilestone[] = []
  if (birthday) {
    // The nearest of last year's, this year's and next year's, so a visit on 30 December sees a
    // birthday on 2 January.
    const year = Number(visit.date.slice(0, 4))
    const near = [year - 1, year, year + 1]
      .map((y) => {
        const [m, d] = birthday.split('-').map(Number)
        const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
        const day = m === 2 && d === 29 && !leap ? 28 : d
        return days(visit.date, `${y}-${birthday.slice(0, 2)}-${String(day).padStart(2, '0')}`)
      })
      .sort((a, b) => Math.abs(a) - Math.abs(b))[0]
    if (Math.abs(near) <= BIRTHDAY_DAYS) found.push({ kind: 'birthday', offsetDays: near })
  }
  if (!earlier.length) return [{ kind: 'first-visit' }, ...found]
  const number = earlier.length + 1
  if (counted(number)) found.push({ kind: 'visit-count', count: number })
  const first = earlier[earlier.length - 1].date
  const previous = earlier[0].date
  for (let years = 1; yearsOn(first, years) <= visit.date; years++) {
    const on = yearsOn(first, years)
    if (on > previous && days(on, visit.date) <= ANNIVERSARY_DAYS)
      found.push({ kind: 'anniversary', years })
  }
  const gap = days(previous, visit.date)
  if (gap >= BACK_AFTER_DAYS) found.push({ kind: 'back', months: Math.floor(gap / 30.44) })
  return found
}

const NUMBER_WORDS = [
  '',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
]
const ORDINAL_WORDS: Record<number, string> = {
  5: 'fifth',
  10: 'tenth',
  25: 'twenty-fifth',
  50: 'fiftieth',
  75: 'seventy-fifth',
  100: 'hundredth',
}
function ordinal(n: number) {
  if (ORDINAL_WORDS[n]) return ORDINAL_WORDS[n]
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return `${n.toLocaleString('en-GB')}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`
}
const yearsWord = (n: number) =>
  n === 1 ? 'A year' : `${capital(NUMBER_WORDS[n] ?? String(n))} years`
const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

/** One quiet sentence for a milestone, naming the guest by first name. */
export function milestoneLine(
  m: GuestMilestone,
  firstName: string,
  context: { visitDate: string; locale: 'en-GB' | 'en-US' },
): string {
  switch (m.kind) {
    case 'first-visit':
      return `${firstName}’s first visit. A warm welcome, and a moment to settle in.`
    case 'visit-count':
      return `${firstName}’s ${ordinal(m.count)} visit.`
    case 'anniversary':
      return `${yearsWord(m.years)} since ${firstName}’s first visit.`
    case 'back':
      return `${firstName} is back after ${NUMBER_WORDS[m.months] ?? m.months} months.`
    case 'birthday': {
      if (m.offsetDays === 0) return `${firstName}’s birthday is today.`
      const on = addDays(context.visitDate, m.offsetDays)
      const day = new Date(`${on}T12:00:00Z`).toLocaleDateString(context.locale, {
        weekday: 'long',
        timeZone: 'UTC',
      })
      return m.offsetDays < 0
        ? `${firstName}’s birthday was on ${day}.`
        : `${firstName}’s birthday is on ${day}.`
    }
  }
}

/** A short tag for a milestone in a list of visits, or nothing when it needs no tag. */
export function milestoneTag(m: GuestMilestone): string | undefined {
  switch (m.kind) {
    case 'first-visit':
      return 'First visit'
    case 'visit-count':
      return `${ordinal(m.count).replace(/^./, (c) => c.toUpperCase())} visit`
    case 'anniversary':
      return m.years === 1
        ? 'A year with you'
        : `${capital(NUMBER_WORDS[m.years] ?? String(m.years))} years with you`
    case 'birthday':
      return m.offsetDays === 0 ? 'Birthday today' : 'Birthday this week'
    case 'back':
      return 'Welcome back'
  }
}

/** The milestones of one visit, read from the record. */
export function visitMilestones(s: BusinessState, appointment: Appointment) {
  const background = guestBackground(s, appointment)
  const birthday = s.clients.find((c) => c.id === appointment.clientId)?.birthday
  const completed = background.earlier.filter((a) => a.status === 'completed')
  return guestMilestones(appointment, completed, birthday)
}

/**
 * The visit the team should get ready for next: the first one still booked today that has not
 * started more than a few minutes ago, optionally for one person or one location.
 */
export function nextToArrive(
  s: BusinessState,
  today: string,
  nowMinutes: number,
  scope: { staffId?: string; locationId?: string } = {},
) {
  return s.appointments
    .filter(
      (a) =>
        a.date === today &&
        a.status === 'confirmed' &&
        a.startMinutes >= nowMinutes - LATE_GRACE_MINUTES &&
        (!scope.staffId || a.staffId === scope.staffId) &&
        (!scope.locationId || a.locationId === scope.locationId),
    )
    .sort((a, b) => a.startMinutes - b.startMinutes)[0]
}

export type BeforeVisit = {
  appointment: Appointment
  name: string
  firstName: string
  treatment: string
  staffName: string
  milestones: GuestMilestone[]
  /** What is good to remember, from the visit's own record or another with the same email. */
  remembered: string
  /** Their last visit, as "Tuesday 15 September, Skin Renewal Facial with Maya". */
  lastTime?: string
  /** A patch test that is not in order for this treatment, in the patch test page's words. */
  patchTest?: string
  /** True when nothing is booked for them after this visit, so the desk can offer the next one. */
  nothingAfter: boolean
}

/** Everything the card says about one visit. */
export function beforeVisit(s: BusinessState, appointment: Appointment): BeforeVisit | undefined {
  const client = s.clients.find((c) => c.id === appointment.clientId)
  const staff = s.staff.find((p) => p.id === appointment.staffId)
  if (!client || !staff) return undefined
  const background = guestBackground(s, appointment)
  const completed = background.earlier.filter((a) => a.status === 'completed')
  const last = completed[0]
  const serviceName = (a: Appointment) =>
    a.bookedServiceName ?? s.services.find((x) => x.id === a.serviceId)?.name ?? 'A treatment'
  const lastWith = last && s.staff.find((p) => p.id === last.staffId)?.name.split(' ')[0]
  const standing = visitPatchTest(s, appointment)
  const nothingAfter = !s.appointments.some(
    (a) =>
      background.ids.has(a.clientId) &&
      a.id !== appointment.id &&
      a.status === 'confirmed' &&
      (a.date > appointment.date ||
        (a.date === appointment.date && a.startMinutes > appointment.startMinutes)),
  )
  return {
    appointment,
    name: client.name,
    firstName: client.name.split(' ')[0],
    treatment: serviceName(appointment),
    staffName: staff.name.split(' ')[0],
    milestones: guestMilestones(appointment, completed, client.birthday),
    remembered: background.remembered,
    ...(last
      ? {
          lastTime: `${dateLabel(last.date, s.organisation.locale)}, ${serviceName(last)}${lastWith ? ` with ${lastWith}` : ''}`,
        }
      : {}),
    ...(standing && standing.state !== 'clear' ? { patchTest: standing.label } : {}),
    nothingAfter,
  }
}

/**
 * The studio's own milestone today: when today's visits carry the studio past 100, 250, 500 or
 * 1,000 visits (then every 1,000th), which visit it is and whether it has happened yet. Only
 * completed visits count, so "will be" stays honest until the guest has come.
 */
export function studioMilestone(s: BusinessState, today: string, locationId?: string) {
  const here = (a: Appointment) => !locationId || a.locationId === locationId
  const before = s.appointments.filter(
    (a) => a.status === 'completed' && a.date < today && here(a),
  ).length
  const day = s.appointments
    .filter(
      (a) =>
        a.date === today && here(a) && ['confirmed', 'arrived', 'completed'].includes(a.status),
    )
    .sort((a, b) => a.startMinutes - b.startMinutes || a.id.localeCompare(b.id))
  // Visits already finished today come first in the count, so the one that reaches the number is
  // decided by what has actually happened.
  const ordered = [
    ...day.filter((a) => a.status === 'completed'),
    ...day.filter((a) => a.status !== 'completed'),
  ]
  for (let i = 0; i < ordered.length; i++) {
    const count = before + i + 1
    if (studioCounted(count))
      return { count, appointment: ordered[i], done: ordered[i].status === 'completed' }
  }
  return undefined
}

/** The studio's milestone as one sentence for Today. */
export function studioMilestoneLine(
  milestone: NonNullable<ReturnType<typeof studioMilestone>>,
  studio: string,
  guestFirstName: string,
  time: string,
) {
  const nth = ordinal(milestone.count)
  return milestone.done
    ? `${guestFirstName}’s visit today was ${studio}’s ${nth}.`
    : `${guestFirstName}’s visit at ${time} will be ${studio}’s ${nth}.`
}
