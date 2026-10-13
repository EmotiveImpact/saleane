import type { Appointment, BusinessState } from './model'
import { addDays, timeLabel } from './format'
import { venueDate } from './tillCount'

/**
 * The welcome that plays as SALEANE opens: five short films, one for each moment someone opens
 * the app (approved by the owner on 11 October 2026, mockup "Loading welcome screen"). SALEANE
 * chooses the moment from the clock and the diary, never at random, and every word on screen is
 * built from what the studio's records say, so it is always true.
 *
 * - `first`: the very first time someone opens a studio, while their account or the studio is new.
 * - `birthday`: the first open on or just after the day the studio joined SALEANE, once a year.
 * - `evening`: the first open after the day's last visit has ended, once a day.
 * - `morning`: the first open of the day.
 * - `back`: opening again after an hour or more away.
 *
 * Anything else (opening again a few minutes later, a quiet day with nothing new) plays nothing.
 */
export const WELCOME_SCENES = ['morning', 'back', 'evening', 'first', 'birthday'] as const
export type WelcomeScene = (typeof WELCOME_SCENES)[number]

export const isWelcomeScene = (value: unknown): value is WelcomeScene =>
  typeof value === 'string' && (WELCOME_SCENES as readonly string[]).includes(value)

/** The names people see for each moment, in the order a day runs. */
export const WELCOME_NAMES: Record<WelcomeScene, string> = {
  morning: 'First open of the day',
  back: 'Coming back later',
  evening: 'Closing up',
  first: 'Very first sign in',
  birthday: 'The studio’s birthday',
}

/** How long each film runs before the app takes over, in seconds. */
export const WELCOME_LENGTH: Record<WelcomeScene, number> = {
  morning: 4.8,
  back: 2.4,
  evening: 5.2,
  first: 5.6,
  birthday: 5.6,
}

/**
 * What this browser remembers about one person's welcomes in one studio. Kept on the device only:
 * it decides which film plays, and losing it costs at most an extra welcome.
 */
export type WelcomeMemory = {
  /** The studio has been opened here before. */
  opened?: boolean
  /** When SALEANE was last open and in view here, in milliseconds. */
  lastSeen?: number
  /** The studio day the first open of the day last played (or was passed). */
  morning?: string
  /** The studio day closing up last played. */
  evening?: string
  /** The last birthday celebrated, in years. */
  birthday?: number
}

/** Away this long before "welcome back" plays. */
export const AWAY_MINUTES = 60
/** An account or studio this new still gets the very first welcome on a device it has not seen. */
export const NEW_DAYS = 7
/** A birthday is still celebrated at the first open this many days after it, once. */
export const BIRTHDAY_GRACE_DAYS = 6
/** Closing up never plays before this time, however early the last visit ended. */
export const EVENING_FROM = 16 * 60

export type WelcomeMoment = {
  /** Now, in milliseconds. */
  now: number
  /** The studio's date and minutes past midnight on its own clock. */
  today: string
  minutes: number
  /** Today's visits, without cancelled and missed ones. */
  day: Appointment[]
  /** The studio's date the day it joined SALEANE, when known. */
  joinedOn?: string
  /** When the studio and the person's account were made, in milliseconds, when known. */
  studioMadeAt?: number
  accountMadeAt?: number
  memory: WelcomeMemory
}

const DAY = 24 * 60 * 60 * 1000

/** Visits still counted for the day: cancelled and missed ones are not. */
export const countedVisits = (appointments: Appointment[], date: string) =>
  appointments
    .filter((a) => a.date === date && a.status !== 'cancelled' && a.status !== 'no_show')
    .sort((a, b) => a.startMinutes - b.startMinutes || a.id.localeCompare(b.id))

const endOf = (a: Appointment) => a.startMinutes + a.bookedDurationMinutes

/** The minute the day's last visit ends, or null on a day with none. */
export function dayEnds(day: Appointment[]) {
  return day.length ? Math.max(...day.map(endOf)) : null
}

/**
 * The studio's birthday reached on `today`: how many years it has been with SALEANE, and the day
 * of the birthday, when `today` falls on it or within the few days after.
 */
export function birthdayOn(joinedOn: string, today: string) {
  const [y, m, d] = joinedOn.split('-').map(Number)
  const year = Number(today.slice(0, 4))
  for (const candidate of [year, year - 1]) {
    const years = candidate - y
    if (years < 1) continue
    // A studio that joined on 29 February celebrates on the 28th in other years.
    const leap = (candidate % 4 === 0 && candidate % 100 !== 0) || candidate % 400 === 0
    const day = m === 2 && d === 29 && !leap ? 28 : d
    const on = `${candidate}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    if (on <= today && today <= addDays(on, BIRTHDAY_GRACE_DAYS)) return { years, on }
  }
  return null
}

/** Which film plays as SALEANE opens now, or null for none. */
export function chooseWelcome(moment: WelcomeMoment): WelcomeScene | null {
  const { memory, now, today, minutes, day } = moment
  const recent = (made?: number) => made !== undefined && now - made < NEW_DAYS * DAY
  if (!memory.opened && (recent(moment.accountMadeAt) || recent(moment.studioMadeAt)))
    return 'first'
  if (memory.morning !== today) {
    const birthday = moment.joinedOn && birthdayOn(moment.joinedOn, today)
    if (birthday && memory.birthday !== birthday.years) return 'birthday'
  }
  const ends = dayEnds(day)
  if (memory.evening !== today && ends !== null && minutes >= ends && minutes >= EVENING_FROM)
    return 'evening'
  if (memory.morning !== today) return 'morning'
  if (memory.lastSeen !== undefined && now - memory.lastSeen >= AWAY_MINUTES * 60 * 1000)
    return 'back'
  return null
}

/** What the browser remembers once a film has played (or the moment has passed without one). */
export function rememberWelcome(
  memory: WelcomeMemory,
  scene: WelcomeScene | null,
  moment: Pick<WelcomeMoment, 'now' | 'today' | 'joinedOn'>,
): WelcomeMemory {
  const next: WelcomeMemory = { ...memory, opened: true, lastSeen: moment.now }
  // Any first open of a day is that day's first open, whichever film it played.
  next.morning = moment.today
  if (scene === 'evening') next.evening = moment.today
  if (scene === 'birthday' && moment.joinedOn) {
    const birthday = birthdayOn(moment.joinedOn, moment.today)
    if (birthday) next.birthday = birthday.years
  }
  return next
}

const NUMBERS = [
  'No',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
  'Twenty',
]
/** A count in words up to twenty, as a sentence would start it; figures after that. */
export const inWords = (n: number) => NUMBERS[n] ?? String(n)
const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth']
const ordinalWord = (n: number) => ORDINALS[n - 1] ?? `${n}th`

/** Good morning before noon, good afternoon before five, good evening after. */
export function greetingAt(minutes: number) {
  if (minutes < 12 * 60) return 'Good morning'
  if (minutes < 17 * 60) return 'Good afternoon'
  return 'Good evening'
}

export type WelcomeWords = {
  /** Read out once to screen readers, in place of the film. */
  said: string
  eyebrow: string
  title: string
  line?: string
  /** A figure that rolls up like a counter, with what it counts. */
  figure?: { value: number; shown: string; unit: string; detail?: string }
  /** The words on the two doors of the very first welcome. */
  doors?: { by: string; welcomes: string; name: string }
  thanks?: string
  /** The three words under the loading line, the last one staying. */
  steps: [string, string, string]
}

export type WelcomeContext = {
  state: BusinessState
  today: string
  minutes: number
  /** The person's first name, when someone is signed in. */
  firstName?: string
  /** The place this person's day is at (a general manager's location), else the studio's own. */
  place?: string
  /** The studio's setup screens are not finished yet, so the owner is about to start them. */
  settingUp?: boolean
  /** The studio's date the day it joined SALEANE, for the birthday. */
  joinedOn?: string
}

function clientFirst(state: BusinessState, a: Appointment) {
  return state.clients.find((c) => c.id === a.clientId)?.name.split(' ')[0] ?? 'A guest'
}
function treatment(state: BusinessState, a: Appointment) {
  return a.bookedServiceName ?? state.services.find((s) => s.id === a.serviceId)?.name
}
const named = (greeting: string, first?: string) => (first ? `${greeting}, ${first}` : greeting)

/** The next visit still to arrive today, at or after `minutes`. */
export function nextVisit(day: Appointment[], minutes: number) {
  return day.find((a) => a.status === 'confirmed' && a.startMinutes >= minutes)
}

/** Completed visits in the year that ended on the studio's latest birthday. */
export function visitsInYear(state: BusinessState, birthday: string) {
  const from = `${Number(birthday.slice(0, 4)) - 1}${birthday.slice(4)}`
  return state.appointments.filter(
    (a) => a.status === 'completed' && a.date >= from && a.date < birthday,
  ).length
}

/** The words a film shows, built from the studio's records only. */
export function welcomeWords(scene: WelcomeScene, ctx: WelcomeContext): WelcomeWords {
  const { state, today, minutes, firstName } = ctx
  const studio = state.organisation.name
  const locale = state.organisation.locale
  const place = ctx.place ?? state.organisation.locationName
  const at = (m: number) => timeLabel(m, locale)
  const day = countedVisits(state.appointments, today)
  const next = nextVisit(day, minutes)
  const nextLine = (a: Appointment) => {
    const what = treatment(state, a)
    return `Next is ${clientFirst(state, a)} at ${at(a.startMinutes)}${what ? `, ${what}` : ''}.`
  }
  switch (scene) {
    case 'morning': {
      const title = named(greetingAt(minutes), firstName)
      const count = day.length
      const first = day[0]
      const line = !count
        ? 'Nothing is booked today yet.'
        : count === 1
          ? first.startMinutes >= minutes && first.status === 'confirmed'
            ? `One visit today, at ${at(first.startMinutes)}.`
            : 'One visit today.'
          : first.startMinutes >= minutes && first.status === 'confirmed'
            ? `${inWords(count)} visits today. The first is at ${at(first.startMinutes)}.`
            : next
              ? `${inWords(count)} visits today. ${nextLine(next)}`
              : `${inWords(count)} visits today.`
      const eyebrow = place && place !== studio ? `${studio} · ${place}` : studio
      return {
        said: `${title}. ${line}`,
        eyebrow,
        title,
        line,
        steps: ['Opening your diary', 'Gathering today’s visits', 'Your day is ready'],
      }
    }
    case 'back': {
      const title = named('Welcome back', firstName)
      const line = next
        ? nextLine(next)
        : day.length
          ? 'Nothing else is booked today.'
          : 'Nothing is booked today yet.'
      return {
        said: `${title}. ${line}`,
        eyebrow: `${studio} · ${at(minutes)}`,
        title,
        line,
        steps: ['Picking up where you left off', 'Checking what’s changed', 'All up to date'],
      }
    }
    case 'evening': {
      const title = named(greetingAt(minutes), firstName)
      const count = day.length
      // A visit still open (here, or never marked) is not "looked after" until it is finished.
      const open = day.filter((a) => a.status !== 'completed').length
      const unit = count === 1 ? 'visit today' : 'visits today'
      const detail = !count
        ? undefined
        : !open
          ? count === 1
            ? 'looked after'
            : 'all looked after'
          : `${inWords(open).toLowerCase()} still to finish`
      return {
        said: `${title}. ${count} ${unit}${detail ? `, ${detail}` : ''}.`,
        eyebrow: `${studio} · ${at(minutes)}`,
        title,
        figure: { value: count, shown: count.toLocaleString(locale), unit, detail },
        steps: ['Looking back over today', 'Counting today’s visits', 'Rest well'],
      }
    }
    case 'first': {
      if (ctx.settingUp || !firstName) {
        const title = `${studio}, come on in`
        const line = ctx.settingUp
          ? 'We’ll set up your studio together, one screen at a time.'
          : 'Everything is ready whenever you are.'
        return {
          said: `Welcome to SALEANE. ${title}. ${line}`,
          eyebrow: 'Welcome to SALEANE',
          title,
          line,
          doors: { by: 'SALEANE', welcomes: 'welcomes', name: studio },
          steps: [
            'Making room for your studio',
            'Laying out a fresh diary',
            'Your new home is ready',
          ],
        }
      }
      const title = `Come on in, ${firstName}`
      const line = 'Everything is ready whenever you are.'
      return {
        said: `Welcome to ${studio}. ${title}. ${line}`,
        eyebrow: `Welcome to ${studio}`,
        title,
        line,
        doors: { by: studio, welcomes: 'welcomes', name: firstName },
        steps: ['Making room for you', 'Opening the diary', 'You’re all set'],
      }
    }
    case 'birthday': {
      const reached = ctx.joinedOn ? birthdayOn(ctx.joinedOn, today) : null
      // Shown ahead of a first birthday (a preview), the year is the last twelve months.
      const years = reached?.years ?? 1
      const on = reached?.on ?? today
      const count = visitsInYear(state, on)
      const unit = `${count === 1 ? 'visit' : 'visits'} in your ${ordinalWord(years)} year`
      const eyebrow = `${inWords(years)} ${years === 1 ? 'year' : 'years'} of ${studio} on SALEANE`
      return {
        said: `${eyebrow}. ${count.toLocaleString(locale)} ${unit}. Thank you for every one.`,
        eyebrow,
        title: eyebrow,
        figure: { value: count, shown: count.toLocaleString(locale), unit },
        thanks: 'Thank you for every one.',
        steps: ['Opening your diary', 'Gathering a year of visits', 'Here’s to the next one'],
      }
    }
  }
}

/** The studio's date on the day it joined SALEANE. */
export function joinedOnFor(state: BusinessState, madeAt?: number) {
  return madeAt === undefined
    ? undefined
    : venueDate(state.organisation.timeZone, new Date(madeAt).toISOString())
}
