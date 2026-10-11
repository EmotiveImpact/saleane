import type { BusinessState, Service, Staff } from '../model'
import {
  businessDate,
  businessMinutes,
  hoursFor,
  operations,
  staffHoursFor,
  usualHoursFor,
} from '../operations'
import { offeredAt, placeOf, staffLocationOn } from '../locations'
import { alreadyBooked, heldVisit, placeImportedVisit } from '../switching'
import type { ImportedVisit } from '../switching'
import { dateLabel, money, timeLabel } from '../format'
import { dateOrder, internationalPhone, tidyName } from './clients'
import type { MovingClient, MovingFile } from './clients'
import { SYSTEM_NAME } from './systems'
import type { OldSystem } from './systems'
import { VISIT_FIELD_LABEL } from './visitFields'
import type { VisitField } from './visitFields'

/**
 * Moving in, stage 2: upcoming visits from the old system's own files. Each visit is matched to a
 * client (already in SALEANE, coming across in the same move, or new from the visits file), its
 * treatment and professional are matched by name with the owner confirming anything unsure, and
 * its time is checked against the studio's hours, the team's hours and every other visit, exactly
 * as the server will check it. Past, cancelled and missed visits are counted and left behind.
 */

// ---------------------------------------------------------------------------------------------
// Values

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const WEEKDAY = /^(mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?,?\s+/

function civil(year: number, month: number | null, day: number) {
  if (!month || month > 12 || day < 1 || year < 1900 || year > 2200) return null
  if (day > new Date(Date.UTC(year, month, 0)).getUTCDate()) return null
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}
const monthOf = (word: string) => {
  const index = MONTHS.indexOf(word.slice(0, 3))
  return index < 0 ? null : index + 1
}
const fullYear = (year: number) => (year < 100 ? 2000 + year : year)

/** Minutes past midnight from "14:30", "2:30pm", "2pm", a slot such as "14:30:00-15:30:00" (its start) or an Excel time. */
export function timeFrom(raw: string): number | null {
  let v = raw
    .trim()
    .toLowerCase()
    .replace(/([ap])\.?m\.?$/, '$1m')
  if (!v) return null
  // Excel keeps a time on its own as a time on 30 December 1899.
  const stamp = /^\d{4}-\d{2}-\d{2}[ t](\d{1,2}:\d{2})/.exec(v)
  if (stamp) v = stamp[1]
  v = v.split(/\s*(?:-|–|\bto\b)\s*(?=\d)/)[0].trim()
  if (/^0?\.\d+$/.test(v)) return Math.round(Number(v) * 1440) % 1440
  let m = /^(\d{1,2})(?:[:.](\d{2}))?(?::\d{2})?\s*([ap])m$/.exec(v)
  if (m) {
    const hour = Number(m[1])
    const minute = Number(m[2] ?? 0)
    if (hour < 1 || hour > 12 || minute > 59) return null
    return ((hour % 12) + (m[3] === 'p' ? 12 : 0)) * 60 + minute
  }
  m = /^(\d{1,2})[:.](\d{2})(?::\d{2})?$/.exec(v)
  if (m) {
    const hour = Number(m[1])
    const minute = Number(m[2])
    return hour < 24 && minute < 60 ? hour * 60 + minute : null
  }
  if (v === 'noon' || v === 'midday') return 720
  return null
}

/**
 * The day of a visit, and its start when the same cell or the time column gives one. Reads
 * "14 Oct 2026, 10:30am" (Fresha), "2026-10-14 10:30", "14/10/2026" or "10/14/2026" (by the
 * file's own order), "October 14, 2026 10:00" and "Wed 14 Oct 2026".
 */
export function whenFrom(
  dateCell: string,
  timeCell: string,
  order: 'dayFirst' | 'monthFirst',
): { date: string; start: number | null } | null {
  const v = dateCell
    .trim()
    .toLowerCase()
    .replace(WEEKDAY, '')
    .replace(/(\d)(st|nd|rd|th)\b/g, '$1')
    .replace(/\s+/g, ' ')
  let date: string | null = null
  let rest = ''
  let m: RegExpExecArray | null
  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ t,]+(.*))?$/.exec(v))) {
    date = civil(Number(m[1]), Number(m[2]), Number(m[3]))
    rest = m[4] ?? ''
  } else if ((m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})(?:[ ,]+(?:at )?(.*))?$/.exec(v))) {
    const [day, month] = order === 'dayFirst' ? [m[1], m[2]] : [m[2], m[1]]
    date = civil(fullYear(Number(m[3])), Number(month), Number(day))
    rest = m[4] ?? ''
  } else if ((m = /^(\d{1,2}) ([a-z]+)\.?,? (\d{2,4})(?:[ ,]+(?:at )?(.*))?$/.exec(v))) {
    date = civil(fullYear(Number(m[3])), monthOf(m[2]), Number(m[1]))
    rest = m[4] ?? ''
  } else if ((m = /^([a-z]+)\.? (\d{1,2}),? (\d{2,4})(?:[ ,]+(?:at )?(.*))?$/.exec(v))) {
    date = civil(fullYear(Number(m[3])), monthOf(m[1]), Number(m[2]))
    rest = m[4] ?? ''
  }
  if (!date) return null
  const fromTime = timeCell.trim() ? timeFrom(timeCell) : null
  return { date, start: fromTime ?? (rest.trim() ? timeFrom(rest) : null) }
}

/** A visit's length in minutes from "1h 30min", "45min", "90", "1:30" or "1.5 hours". */
export function durationFrom(raw: string): number | null {
  const v = raw.trim().toLowerCase()
  if (!v) return null
  if (/^\d+$/.test(v)) return Number(v) > 0 && Number(v) <= 1440 ? Number(v) : null
  let m = /^(\d{1,2}):(\d{2})$/.exec(v)
  if (m) return Number(m[1]) * 60 + Number(m[2]) || null
  const hours = /(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)(?![a-z])/.exec(v)
  m = /(\d+)\s*(?:m|min|mins|minute|minutes)(?![a-z])/.exec(v)
  if (!hours && !m) return null
  const total = Math.round((hours ? Number(hours[1]) * 60 : 0) + (m ? Number(m[1]) : 0))
  return total > 0 && total <= 1440 ? total : null
}

/** The length of a slot such as "14:30:00-15:30:00", or null for a single time. */
export function slotLength(raw: string): number | null {
  const parts = raw.trim().split(/\s*(?:-|–|\bto\b)\s*(?=\d)/)
  if (parts.length !== 2) return null
  const start = timeFrom(parts[0])
  const end = timeFrom(parts[1])
  return start !== null && end !== null && end > start ? end - start : null
}

/** An amount in pence or cents: "£85.00", "85", "1,250.50", "(12.00)". Null when it is not money. */
export function moneyFrom(raw: string): number | null {
  let v = raw.trim()
  if (!v) return null
  if (/^(free|none|-|–)$/i.test(v)) return 0
  const negative = /^\(.*\)$/.test(v) || /^-/.test(v.replace(/[£$€\s]/g, ''))
  v = v.replace(/[()£$€\s]|gbp|usd|eur/gi, '').replace(/^-/, '')
  if (/^\d+,\d{2}$/.test(v)) v = v.replace(',', '.')
  v = v.replace(/,/g, '')
  if (!/^\d+(\.\d{1,2})?$/.test(v)) return null
  const minor = Math.round(Number(v) * 100)
  return negative ? -minor : minor
}

export type VisitStatusKind = 'active' | 'cancelled' | 'missed' | 'request'

/** What an old system's status means here. Anything not cancelled, missed or a request is a visit. */
export function statusKind(raw: string): VisitStatusKind {
  const v = raw.trim().toLowerCase()
  if (/cancel|deleted|denied|declined|rejected|void|removed/.test(v)) return 'cancelled'
  if (/no.?show|did not (show|attend)|missed|\bdna\b/.test(v)) return 'missed'
  if (/^request|awaiting approval|pending approval/.test(v)) return 'request'
  return 'active'
}

// ---------------------------------------------------------------------------------------------
// Names

/** "Signature Cut & Finish" and "signature cut and finish" are the same name. */
export function nameKey(name: string) {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** A treatment's name without the length some systems add: "Gloss & Tone (45 mins)". */
export function treatmentKey(name: string) {
  return nameKey(name)
    .replace(/\b\d+\s*h\s*\d+\b/g, ' ')
    .replace(/\b\d+(?: \d+)?\s*(?:h|hr|hrs|hour|hours|m|min|mins|minute|minutes)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const STOP_WORDS = new Set(['and', 'the', 'with', 'a', 'an', 'of', 'for', 'treatment'])
const words = (key: string) => key.split(' ').filter((w) => w.length > 1 && !STOP_WORDS.has(w))

/** How alike two treatment names are, 0 to 1. One name inside the other counts for a lot. */
function likeness(a: string, b: string) {
  if (a === b) return 1
  const left = new Set(words(a))
  const right = new Set(words(b))
  if (!left.size || !right.size) return 0
  let shared = 0
  for (const word of left) if (right.has(word)) shared++
  if (!shared) return 0
  const overlap = shared / (left.size + right.size - shared)
  return shared === Math.min(left.size, right.size) ? Math.max(overlap, 0.6) : overlap
}

function suggestTreatment(key: string, services: Service[]) {
  const scored = services
    .map((service) => ({ service, score: likeness(key, treatmentKey(service.name)) }))
    .sort((a, b) => b.score - a.score)
  const [best, next] = scored
  return best && best.score >= 0.5 && (!next || next.score < best.score) ? best.service : null
}

/** "Maya" or "Maya L" for Maya Lewis: the same first name, when only one person has it. */
function suggestPerson(key: string, staff: Staff[]) {
  const first = key.split(' ')[0]
  const same = staff.filter((person) => nameKey(person.name).split(' ')[0] === first)
  return first && same.length === 1 ? same[0] : null
}

export type NameMatch = {
  /** The old name, as matched: lower case, no punctuation. */
  key: string
  /** The old name as the file first spells it. */
  name: string
  /** Upcoming visits that use it. */
  visits: number
  /** The SALEANE treatment or professional; null leaves its visits behind; undefined is not chosen yet. */
  id: string | null | undefined
  /** same: the same name. suggested: a likely match to confirm. chosen: the owner's answer. */
  how: 'same' | 'suggested' | 'chosen' | 'none'
}

/** The owner's answers: an old name's key to a SALEANE id, or null to leave its visits behind. */
export type NameChoices = {
  treatment: Record<string, string | null>
  professional: Record<string, string | null>
}

function matchNames<T extends { id: string; name: string }>(
  names: string[],
  items: T[],
  chosen: Record<string, string | null>,
  keyOf: (name: string) => string,
  suggest: (key: string, items: T[]) => T | null,
): NameMatch[] {
  const byKey = new Map<string, NameMatch>()
  for (const name of names) {
    const key = keyOf(name)
    const found = byKey.get(key)
    if (found) {
      found.visits++
      continue
    }
    const choice = chosen[key]
    const base = { key, name, visits: 1 }
    let match: NameMatch
    if (choice === null) match = { ...base, id: null, how: 'chosen' }
    else if (choice && items.some((item) => item.id === choice))
      match = { ...base, id: choice, how: 'chosen' }
    else {
      const same = items.filter((item) => keyOf(item.name) === key)
      const likely = same.length ? null : suggest(key, items)
      match =
        same.length === 1
          ? { ...base, id: same[0].id, how: 'same' }
          : likely
            ? { ...base, id: likely.id, how: 'suggested' }
            : { ...base, id: undefined, how: 'none' }
    }
    byKey.set(key, match)
  }
  return [...byKey.values()].sort((a, b) => b.visits - a.visits || a.name.localeCompare(b.name))
}

/** A treatment or person the owner still has to confirm or choose. */
export const needsAnswer = (match: NameMatch) => match.how === 'suggested' || match.how === 'none'

// ---------------------------------------------------------------------------------------------
// Clients

/** Enough to find a client coming across in the same move once the server has saved them. */
export type ClientKey = { name: string; email: string; phone: string }

type Person = ClientKey & { key: string; id?: string }
type Who = ClientKey & { key: string }

const WALK_IN = /^(walk ?in|walkin|no client|unknown|guest|n a|none)( client| guest)?$/

/** Everyone a visit could be for, found by email, phone or name. */
class People {
  private byEmail = new Map<string, Person[]>()
  private byPhone = new Map<string, Person[]>()
  private byName = new Map<string, Person[]>()
  add(person: Person) {
    const put = (map: Map<string, Person[]>, key: string) => {
      if (key) map.set(key, [...(map.get(key) ?? []), person])
    }
    put(this.byEmail, person.email)
    put(this.byPhone, person.phone)
    put(this.byName, person.key)
  }
  /** Which client a visit is for, by email, then phone, then name. */
  find(who: Who): Person | { problem: string } | null {
    let pool = (who.email && this.byEmail.get(who.email)) || []
    const by = pool.length ? 'email' : 'phone number'
    if (!pool.length && who.phone) pool = this.byPhone.get(who.phone) ?? []
    if (pool.length > 1 && who.key) {
      const named = pool.filter((p) => p.key === who.key)
      if (named.length) pool = named
    }
    if (pool.length > 1)
      return { problem: `${pool.length} clients share this ${by}. Book this visit by hand.` }
    const named = (who.key && this.byName.get(who.key)) || []
    if (pool.length === 1) {
      const [person] = pool
      // The same email under another name is the same person spelt differently, unless the first
      // names differ: then it is most likely someone else in the household.
      const firstName = (key: string) => key.split(' ')[0]
      if (!who.key || person.key === who.key || firstName(person.key) === firstName(who.key))
        return person
      if (named.length === 1) return named[0]
      return {
        problem: `The ${by} belongs to ${person.name}, but this visit is for ${who.name}. Book it by hand.`,
      }
    }
    if (named.length === 1) return named[0]
    if (named.length > 1)
      return {
        problem: `${named.length} clients are called ${who.name}. Book this visit by hand, or add each client’s email or mobile to the file.`,
      }
    return null
  }
}

/**
 * Finds the clients SALEANE saved for those who came across in this move: the newest client with
 * the same name and the same email or phone.
 */
export function arrivedClients(state: Pick<BusinessState, 'clients' | 'organisation'>) {
  const region = state.organisation.region
  const ids = new Map<string, string>()
  for (const c of state.clients) {
    const key = nameKey(c.name)
    if (c.email) ids.set(`${key}|${c.email.toLowerCase()}`, c.id)
    const phone = internationalPhone(c.phone, region)
    if (phone) ids.set(`${key}|${phone}`, c.id)
  }
  return (client: ClientKey) => {
    const key = nameKey(client.name)
    return (
      (client.email && ids.get(`${key}|${client.email}`)) ||
      (client.phone && ids.get(`${key}|${client.phone}`)) ||
      undefined
    )
  }
}

// ---------------------------------------------------------------------------------------------
// Review

export type VisitRowStatus =
  'ready' | 'here' | 'problem' | 'past' | 'cancelled' | 'skipped' | 'combined'

export type VisitRow = {
  fileName: string
  line: number
  status: VisitRowStatus
  /** Why a visit is not coming across, or what it becomes. */
  detail: string
  /** Small things to know, such as a length that differs. */
  notes: string[]
  /** For recognising it: "Grace Mensah · Wed 14 Oct, 10:30 · Signature facial". */
  label: string
}

export type PlannedVisit = Omit<ImportedVisit, 'clientId' | 'contact'> & {
  client: { id: string } | { arriving: ClientKey }
}

export type VisitReview = {
  rows: VisitRow[]
  ready: PlannedVisit[]
  /** Clients a visits file names with an email or phone who are not in SALEANE or the client list. */
  newClients: MovingClient[]
  treatments: NameMatch[]
  professionals: NameMatch[]
  counts: Record<VisitRowStatus, number>
  valueMinor: number
  depositsMinor: number
  first: string | null
  last: string | null
  /** Files where SALEANE could not find a column it needs. */
  missing: { fileName: string; fields: VisitField[] }[]
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const list = (items: string[]) =>
  new Intl.ListFormat('en-GB', { type: 'conjunction' }).format(items)

/** "1 hour 30 minutes", "45 minutes". */
function lengthLabel(minutes: number) {
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return [
    hours ? `${hours} ${hours === 1 ? 'hour' : 'hours'}` : '',
    rest ? `${rest} ${rest === 1 ? 'minute' : 'minutes'}` : '',
  ]
    .filter(Boolean)
    .join(' ')
}

/**
 * The plain reason a visit's time does not fit, checked in the order the booking rules check it.
 * Null when none of these is it, so the general reason is shown.
 */
function whyItDoesNotFit(
  s: BusinessState,
  plan: { date: string; startMinutes: number },
  service: Service,
  staff: Staff,
) {
  const { date, startMinutes: start } = plan
  const locale = s.organisation.locale
  const weekday = new Intl.DateTimeFormat('en-GB', { weekday: 'long', timeZone: 'UTC' }).format(
    new Date(`${date}T12:00:00Z`),
  )
  const at = timeLabel(start, locale)
  const end = start + service.durationMinutes + service.bufferMinutes
  if (!staff.serviceIds.includes(service.id))
    return `${staff.name} is not set up to give ${service.name} in SALEANE. Turn it on in Team, then check again.`
  const place = staffLocationOn(s, staff.id, date)
  const site = placeOf(s, place)
  if (!offeredAt(service, place))
    return `${service.name} is not offered at ${site?.name ?? 'that location'}, where ${staff.name} works that day.`
  const hours = hoursFor(s, date, place)
  if (!hours || hours.closed) return `The studio is closed on ${weekday}s in SALEANE.`
  if (start < hours.open || end > hours.close)
    return `${at} is outside your opening hours on ${weekday}s, ${timeLabel(hours.open, locale)} to ${timeLabel(hours.close, locale)}.`
  const own = staffHoursFor(s, staff.id, date)
  if (!own || own.closed)
    return usualHoursFor(s, staff.id, date)?.closed === false
      ? `${staff.name} has time away that day.`
      : `${staff.name} does not work on ${weekday}s in SALEANE.`
  if (start < own.open || end > own.close)
    return `${at} is outside ${staff.name}’s hours that day, ${timeLabel(own.open, locale)} to ${timeLabel(own.close, locale)}.`
  if (
    operations(s).closures.some(
      (c) =>
        c.date === date &&
        (!c.staffId || c.staffId === staff.id) &&
        start < c.endMinutes &&
        end > c.startMinutes,
    )
  )
    return 'Time is blocked out in the calendar then.'
  if (
    s.appointments.some(
      (a) =>
        a.date === date &&
        a.staffId === staff.id &&
        a.status !== 'cancelled' &&
        a.status !== 'no_show' &&
        start < a.startMinutes + a.bookedDurationMinutes + a.bookedBufferMinutes &&
        end > a.startMinutes,
    )
  )
    return `${staff.name} already has a visit then.`
  if (start % 5) return `It starts at ${at}; SALEANE’s calendar keeps to five-minute steps.`
  return `No ${service.resourceType === 'chair' ? 'chair' : 'treatment room'} is free then.`
}

type Upcoming = {
  row: VisitRow
  who: Who
  date: string
  start: number
  treatment: string
  professional: string
  price: string
  deposit: string
  reference: string
  duration: number | null
  system: string
}

/**
 * Builds the review for every visits file the owner added. `arriving` are the clients coming
 * across in the same move; `withoutContact` are names in the client list that cannot come across
 * because they have no email or phone, so their visits can say why.
 */
export function reviewVisits(
  files: MovingFile[],
  state: BusinessState,
  arriving: MovingClient[],
  choices: NameChoices,
  chosenSystem: OldSystem,
  now: string,
  withoutContact: string[] = [],
): VisitReview {
  const org = state.organisation
  const region = org.region
  const today = businessDate(state, now)
  // A sample studio's clock stands still on its sample day, as its date does.
  const minutesNow = businessMinutes(state, operations(state).mode === 'sandbox' ? undefined : now)
  const rows: VisitRow[] = []
  const upcoming: Upcoming[] = []
  const missing: VisitReview['missing'] = []
  for (const file of files.filter((f) => f.kind === 'visits')) {
    const system = SYSTEM_NAME[file.system ?? chosenSystem]
    const column = (field: VisitField) => file.visitMatches.find((m) => m.field === field)?.index
    const at = (cells: string[], field: VisitField) => {
      const index = column(field)
      return index === undefined ? '' : (cells[index] ?? '').trim()
    }
    const needs: VisitField[] = []
    if (column('date') === undefined) needs.push('date')
    if (column('treatment') === undefined) needs.push('treatment')
    if (column('professional') === undefined) needs.push('professional')
    if (
      (['client', 'firstName', 'lastName', 'email', 'phone'] as const).every(
        (f) => column(f) === undefined,
      )
    )
      needs.push('client')
    if (needs.length) missing.push({ fileName: file.fileName, fields: needs })
    const dateColumn = column('date')
    const order = dateOrder(
      dateColumn === undefined ? [] : file.rows.map((r) => r[dateColumn] ?? ''),
      region,
    )
    file.rows.forEach((cells, i) => {
      const name = tidyName(at(cells, 'firstName'), at(cells, 'lastName'), at(cells, 'client'))
      const when = whenFrom(at(cells, 'date'), at(cells, 'time'), order)
      const treatment = at(cells, 'treatment')
      const label = [
        name,
        when
          ? `${dateLabel(when.date, org.locale, true)}${when.start !== null ? `, ${timeLabel(when.start, org.locale)}` : ''}`
          : at(cells, 'date'),
        treatment,
      ]
        .filter(Boolean)
        .join(' · ')
      const row: VisitRow = {
        fileName: file.fileName,
        line: file.lineNumbers[i],
        status: 'problem',
        detail: '',
        notes: [],
        label,
      }
      rows.push(row)
      if (needs.length) {
        row.detail = `SALEANE could not find the ${list(needs.map((f) => VISIT_FIELD_LABEL[f].toLowerCase()))} in ${file.fileName}. Choose ${needs.length === 1 ? 'it' : 'them'} under “How each column was read”.`
        return
      }
      const status = statusKind(at(cells, 'status'))
      if (status === 'cancelled' || status === 'missed') {
        row.status = 'cancelled'
        row.detail = status === 'missed' ? 'A missed visit.' : 'A cancelled visit.'
        return
      }
      if (!when) {
        row.detail = at(cells, 'date')
          ? `The date “${at(cells, 'date')}” could not be read.`
          : 'This visit has no date.'
        return
      }
      if (when.start === null) {
        row.detail = at(cells, 'time')
          ? `The time “${at(cells, 'time')}” could not be read.`
          : 'This visit has no start time.'
        return
      }
      if (when.date < today || (when.date === today && when.start <= minutesNow)) {
        row.status = 'past'
        row.detail = 'A past visit.'
        return
      }
      if (status === 'request') {
        row.detail = `Still a request in ${system}. Book it by hand if you accept it.`
        return
      }
      const professional = at(cells, 'professional')
      if (!treatment || !professional) {
        row.detail = treatment ? 'This visit has no professional.' : 'This visit has no treatment.'
        return
      }
      const rawEmail = at(cells, 'email').toLowerCase()
      const phone = at(cells, 'phone')
      upcoming.push({
        row,
        who: {
          name,
          key: nameKey(name),
          email: EMAIL.test(rawEmail) && rawEmail.length <= 254 ? rawEmail : '',
          phone: (phone && internationalPhone(phone, region)) || '',
        },
        date: when.date,
        start: when.start,
        treatment,
        professional,
        price: at(cells, 'price'),
        deposit: at(cells, 'deposit'),
        reference: at(cells, 'reference'),
        duration: durationFrom(at(cells, 'duration')) ?? slotLength(at(cells, 'time')),
        system,
      })
    })
  }

  // The same visit in two files (a history downloaded year by year, or a report run twice).
  const seen = new Map<string, Upcoming>()
  const unique: Upcoming[] = []
  for (const v of upcoming) {
    const key = [
      v.reference ? `${v.system}|${v.reference}` : v.who.key || v.who.email || v.who.phone,
      treatmentKey(v.treatment),
      v.date,
      v.start,
    ].join('|')
    const first = seen.get(key)
    if (first) {
      v.row.status = 'combined'
      v.row.detail = `Listed twice, so it comes across once (${first.row.fileName}, line ${first.row.line}).`
      continue
    }
    seen.set(key, v)
    unique.push(v)
  }

  const services = state.services.filter((s) => !s.archived)
  const team = state.staff.filter((p) => !p.archived)
  const treatments = matchNames(
    unique.map((v) => v.treatment),
    services,
    choices.treatment,
    treatmentKey,
    suggestTreatment,
  )
  const professionals = matchNames(
    unique.map((v) => v.professional),
    team,
    choices.professional,
    nameKey,
    suggestPerson,
  )

  const people = new People()
  for (const c of state.clients)
    people.add({
      id: c.id,
      name: c.name,
      key: nameKey(c.name),
      email: c.email.trim().toLowerCase(),
      phone: internationalPhone(c.phone, region) ?? '',
    })
  for (const c of arriving)
    people.add({ name: c.name, key: nameKey(c.name), email: c.email, phone: c.phone })
  const noContact = new Set(withoutContact.map(nameKey))
  const withClientList = arriving.length > 0 || withoutContact.length > 0
  const newClients: MovingClient[] = []
  const ready: PlannedVisit[] = []
  // Earlier visits are held in a working copy, so later ones cannot double-book them.
  const work = structuredClone(state)
  const amount = (minor: number) => money(minor, org, true)
  const sorted = [...unique].sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start)
  sorted.forEach((v, n) => {
    const { row, who } = v
    const t = treatments.find((m) => m.key === treatmentKey(v.treatment))!
    const p = professionals.find((m) => m.key === nameKey(v.professional))!
    if (t.id === null || p.id === null) {
      row.status = 'skipped'
      row.detail =
        t.id === null
          ? `You chose to leave “${t.name}” visits behind.`
          : `You chose to leave visits with ${p.name} behind.`
      return
    }
    if (t.id === undefined) {
      row.detail = `Choose which of your treatments “${t.name}” is.`
      return
    }
    if (p.id === undefined) {
      row.detail = `Choose who “${p.name}” is on your team.`
      return
    }
    const service = services.find((s) => s.id === t.id)!
    const staff = team.find((s) => s.id === p.id)!
    const price = v.price ? moneyFrom(v.price) : service.priceMinor
    if (price === null || price < 0) {
      row.detail = `The price “${v.price}” could not be read.`
      return
    }
    const deposit = v.deposit ? moneyFrom(v.deposit) : 0
    if (deposit === null || deposit < 0) {
      row.detail = `The deposit “${v.deposit}” could not be read.`
      return
    }
    if (deposit > price) {
      row.detail = `The deposit paid (${amount(deposit)}) is more than the price (${amount(price)}).`
      return
    }
    if (!who.key && !who.email && !who.phone) {
      row.detail = 'This visit has no client.'
      return
    }
    if (WALK_IN.test(who.key)) {
      row.detail = 'A walk-in with no client. Book it by hand if you need it.'
      return
    }
    const found = people.find(who)
    if (found && 'problem' in found) {
      row.detail = found.problem
      return
    }
    let newcomer: MovingClient | undefined
    if (!found) {
      if (!who.email && !who.phone) {
        // Said the same way for every visit, so the check can group them; the row names the client.
        row.detail = noContact.has(who.key)
          ? 'This client is in your client list without an email or phone, so neither they nor this visit can come across.'
          : withClientList
            ? 'This client is not in SALEANE or in your client list, and this file has no email or phone to add them by. Book the visit by hand once they are a client.'
            : 'This client is not in SALEANE, and this file has no email or phone to add them by. Add your client list too.'
        return
      }
      if (who.name.length < 2) {
        row.detail =
          'No client in SALEANE or in your client list has this email or phone, and the file gives no name to add them by.'
        return
      }
      newcomer = { name: who.name, email: who.email, phone: who.phone, marketingConsent: false }
    }
    const person = found ?? { ...newcomer!, key: who.key }
    if (person.id && alreadyBooked(state, person.id, v.date, v.start)) {
      row.status = 'here'
      row.detail = `Already booked in SALEANE at this time. It stays as it is.`
      return
    }
    const plan = { serviceId: service.id, staffId: staff.id, date: v.date, startMinutes: v.start }
    const placed = placeImportedVisit(work, plan, now)
    if ('problem' in placed) {
      row.detail = whyItDoesNotFit(work, plan, service, staff) ?? placed.problem
      return
    }
    work.appointments.push(heldVisit(work, plan, placed.resourceId, `moving-${n}`))
    if (newcomer) {
      newClients.push(newcomer)
      people.add({ ...newcomer, key: who.key })
      row.notes.push(
        'This client is not in your client list, so they come across as a new client from this file, with marketing off.',
      )
    }
    if (!v.price)
      row.notes.push(
        `The file gives no price, so it keeps ${service.name}’s price of ${amount(service.priceMinor)}.`,
      )
    if (v.duration && Math.abs(v.duration - service.durationMinutes) >= 5)
      row.notes.push(
        `Booked for ${lengthLabel(v.duration)} in ${v.system}; ${service.name} takes ${lengthLabel(service.durationMinutes)} in SALEANE, so the calendar holds ${lengthLabel(service.durationMinutes)}.`,
      )
    let reference = v.reference
    if (reference.length > 40) {
      reference = reference.slice(0, 40)
      row.notes.push('The booking reference was longer than SALEANE keeps, so its end was cut.')
    }
    row.status = 'ready'
    row.detail = `${service.name} with ${staff.name}.`
    ready.push({
      client: person.id
        ? { id: person.id }
        : { arriving: { name: person.name, email: person.email, phone: person.phone } },
      ...plan,
      priceMinor: price,
      depositPaidMinor: deposit,
      ...(reference ? { reference } : {}),
    })
  })

  const counts: Record<VisitRowStatus, number> = {
    ready: 0,
    here: 0,
    problem: 0,
    past: 0,
    cancelled: 0,
    skipped: 0,
    combined: 0,
  }
  for (const r of rows) counts[r.status]++
  const dates = ready.map((v) => v.date).sort()
  return {
    rows,
    ready,
    newClients,
    treatments,
    professionals,
    counts,
    valueMinor: ready.reduce((sum, v) => sum + v.priceMinor, 0),
    depositsMinor: ready.reduce((sum, v) => sum + v.depositPaidMinor, 0),
    first: dates[0] ?? null,
    last: dates.at(-1) ?? null,
    missing,
  }
}

/** The import command's rows for one part, with each arriving client's saved id. */
export function visitRows(
  part: PlannedVisit[],
  state: Pick<BusinessState, 'clients' | 'organisation'>,
): { rows: ImportedVisit[]; lost: number } {
  const rows: ImportedVisit[] = []
  const arrived = arrivedClients(state)
  let lost = 0
  for (const { client, ...visit } of part) {
    const id = 'id' in client ? client.id : arrived(client.arriving)
    if (id) rows.push({ clientId: id, ...visit })
    else lost++
  }
  return { rows, lost }
}
