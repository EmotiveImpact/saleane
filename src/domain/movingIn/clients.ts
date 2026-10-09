import type { BusinessState, Region } from '../model'
import { postcodeArea } from '../clientAreas'
import {
  FIELD_LABEL,
  findHeadingRow,
  headingKey,
  isSummaryRow,
  matchColumns,
  yesNo,
} from './fields'
import type { ClientField, ColumnMatch } from './fields'
import { SYSTEM_NAME, guessKind, recogniseLayout } from './systems'
import type { FileKind, OldSystem } from './systems'
import type { Sheet } from './sheet'

/**
 * Moving in, stage 1: turning an old system's client list into SALEANE clients. Every row is
 * checked and shown before anything is saved. Nobody is merged with a client already in SALEANE;
 * a likely match is shown as "already here" and left alone. Marketing permission comes across
 * only when the file clearly records that the client agreed, and the evidence is kept.
 */

/** Notes are kept up to the client record's limit. */
const NOTES_LIMIT = 1000

export type MovingFile = {
  fileName: string
  system: OldSystem | null
  report: string | null
  kind: FileKind
  headings: string[]
  matches: ColumnMatch[]
  /** Data rows only: heading, title and totals rows removed. */
  rows: string[][]
  /** The row number in the file of each data row, for pointing the owner at it. */
  lineNumbers: number[]
}

/** Reads what a file is and what each of its columns means. */
export function understandFile(
  sheet: Sheet,
  answers: Record<string, ClientField | null> = {},
): MovingFile {
  const headingRow = findHeadingRow(sheet.rows)
  const headings = (sheet.rows[headingRow] ?? []).map((h, i) => h.trim() || `Column ${i + 1}`)
  const rows: string[][] = []
  const lineNumbers: number[] = []
  sheet.rows.slice(headingRow + 1).forEach((row, i) => {
    if (isSummaryRow(row)) return
    // A heading row repeated on each page of a report.
    if (row.every((cell, j) => cell.trim() === (headings[j] ?? '').trim())) return
    rows.push(row)
    lineNumbers.push(headingRow + i + 2)
  })
  const layout = recogniseLayout(headings)
  const known = { ...(layout?.fields ?? {}), ...answers }
  const matches = matchColumns(headings, rows, known)
  const fields = new Set(matches.map((m) => m.field))
  const hasClientColumns =
    (fields.has('fullName') || fields.has('firstName') || fields.has('lastName')) &&
    (fields.has('email') || fields.has('mobile') || fields.has('phone'))
  return {
    fileName: sheet.fileName,
    system: layout?.system ?? null,
    report: layout?.report ?? null,
    kind: layout?.kind ?? guessKind(headings, hasClientColumns),
    headings,
    matches,
    rows,
    lineNumbers,
  }
}

/** The answers the owner gave about a file's unsure columns, keyed so they apply to every file like it. */
export function answerKey(heading: string) {
  return headingKey(heading)
}

// ---------------------------------------------------------------------------------------------
// Values

/** A phone number in international form for the studio's country, or null when it is not one. */
export function internationalPhone(raw: string, region: Region): string | null {
  // "+44 (0)20 7946 0018": the (0) is dialled only from inside the country.
  let digits = raw
    .trim()
    .replace(/\(0\)/g, '')
    .replace(/[\s().-]/g, '')
  if (!digits) return null
  if (digits.startsWith('00')) digits = `+${digits.slice(2)}`
  if (digits.startsWith('+')) return /^\+[1-9]\d{6,14}$/.test(digits) ? digits : null
  if (!/^\d+$/.test(digits)) return null
  if (/^(\d)\1+$/.test(digits.slice(1))) return null // placeholders such as 10000000000
  if (region === 'UK') {
    if (/^0\d{9,10}$/.test(digits)) return `+44${digits.slice(1)}`
    // Excel drops the leading zero: 7700900123.
    if (/^7\d{9}$/.test(digits)) return `+44${digits}`
    if (/^44\d{10}$/.test(digits)) return `+${digits}`
    if (/^353\d{8,9}$/.test(digits)) return `+${digits}`
    return null
  }
  if (/^\d{10}$/.test(digits)) return `+1${digits}`
  if (/^1\d{10}$/.test(digits)) return `+${digits}`
  return null
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
function monthNumber(word: string) {
  const index = MONTHS.indexOf(word.slice(0, 3).toLowerCase())
  return index < 0 ? null : index + 1
}

/** Which way round a file writes dates such as 05/03/1990, judged from the dates it has. */
export function dateOrder(values: string[], region: Region): 'dayFirst' | 'monthFirst' {
  let dayFirst = 0
  let monthFirst = 0
  for (const v of values) {
    const m = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-]\d{2,4})?\b/.exec(v.trim())
    if (!m) continue
    if (Number(m[1]) > 12) dayFirst++
    if (Number(m[2]) > 12) monthFirst++
  }
  if (dayFirst && !monthFirst) return 'dayFirst'
  if (monthFirst && !dayFirst) return 'monthFirst'
  return region === 'UK' ? 'dayFirst' : 'monthFirst'
}

/** A birthday as "MM-DD" (the year is never kept), or null when it cannot be read. */
export function birthdayFrom(raw: string, order: 'dayFirst' | 'monthFirst'): string | null {
  const v = raw
    .trim()
    .toLowerCase()
    .replace(/(\d)(st|nd|rd|th)\b/g, '$1')
  if (!v) return null
  let month: number | null = null
  let day: number | null = null
  let m: RegExpExecArray | null
  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(v))) {
    month = Number(m[2])
    day = Number(m[3])
  } else if ((m = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?(?:\s|,|$)/.exec(v))) {
    ;[day, month] =
      order === 'dayFirst' ? [Number(m[1]), Number(m[2])] : [Number(m[2]), Number(m[1])]
  } else if ((m = /^(\d{1,2}) ([a-z]+)/.exec(v))) {
    day = Number(m[1])
    month = monthNumber(m[2])
  } else if ((m = /^([a-z]+) (\d{1,2})/.exec(v))) {
    month = monthNumber(m[1])
    day = Number(m[2])
  }
  if (!month || !day || month > 12 || day < 1) return null
  if (day > new Date(Date.UTC(2024, month, 0)).getUTCDate()) return null
  return `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** "SMITH, JANE" becomes "Jane Smith"; a name typed normally is left as it is. */
export function tidyName(first: string, last: string, full: string) {
  let name = [first.trim(), last.trim()].filter(Boolean).join(' ')
  if (!name) {
    name = full.trim()
    const comma = /^([^,]+),\s*([^,]+)$/.exec(name)
    if (comma) name = `${comma[2]} ${comma[1]}`
  }
  name = name.replace(/\s+/g, ' ').trim()
  const letters = name.replace(/[^A-Za-z]/g, '')
  if (
    letters.length > 1 &&
    (letters === letters.toUpperCase() || letters === letters.toLowerCase())
  )
    name = name
      .toLowerCase()
      .replace(/(^|[\s'-])([a-z])/g, (_, gap: string, ch: string) => gap + ch.toUpperCase())
      .replace(/\bMc([a-z])/g, (_, ch: string) => `Mc${ch.toUpperCase()}`)
  return name.slice(0, 100)
}

const UK_POSTCODE_IN_TEXT = /\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/i
const US_ZIP_IN_TEXT = /\b(\d{5})(?:-\d{4})?\s*$/

// ---------------------------------------------------------------------------------------------
// Rows

export type MovingClient = {
  name: string
  email: string
  phone: string
  marketingConsent: boolean
  /** What the old system recorded, when marketing permission comes across. */
  consentEvidence?: string
  /** The old system recorded that the client agreed to marketing texts (noted, not used). */
  textMarketing?: boolean
  birthday?: string
  postcodeArea?: string
  preferences?: string
}

export type ClientRowStatus = 'ready' | 'here' | 'problem' | 'combined'

export type ClientRow = {
  /** Which file and line the row came from. */
  fileName: string
  line: number
  status: ClientRowStatus
  /** Why a row is not coming across, or what was changed on the way. */
  detail: string
  /** Small things to know: a birthday that could not be read, notes shortened. */
  notes: string[]
  client?: MovingClient
}

export type ClientReview = {
  rows: ClientRow[]
  ready: MovingClient[]
  counts: Record<ClientRowStatus, number>
  marketing: number
  birthdays: number
  withNotes: number
}

type Picked = Partial<Record<ClientField, string>>

function pick(file: MovingFile, row: string[]): Picked {
  const picked: Picked = {}
  for (const match of file.matches)
    if (match.field) picked[match.field] = (row[match.index] ?? '').trim()
  return picked
}

/** The heading a field came from in a file, for the consent evidence. */
function headingFor(file: MovingFile, field: ClientField) {
  return file.matches.find((m) => m.field === field)?.heading ?? FIELD_LABEL[field]
}

/**
 * Builds the review for every client file the owner added, together. Rows for the same person in
 * two files of the old system (same name, and the same email or phone) are combined, filling gaps.
 */
export function reviewClients(
  files: MovingFile[],
  state: Pick<BusinessState, 'clients' | 'organisation'>,
  chosenSystem: OldSystem,
): ClientReview {
  const region = state.organisation.region
  const rows: ClientRow[] = []
  // Households often share an email or a phone, so each one can belong to several people.
  const byEmail = new Map<string, ClientRow[]>()
  const byPhone = new Map<string, ClientRow[]>()
  const existingEmail = new Map<string, string[]>()
  const existingPhone = new Map<string, string[]>()
  const add = <T>(map: Map<string, T[]>, key: string, value: T) => {
    const list = map.get(key) ?? []
    if (!list.includes(value)) map.set(key, [...list, value])
  }
  const index = (row: ClientRow) => {
    if (row.client?.email) add(byEmail, row.client.email, row)
    if (row.client?.phone) add(byPhone, row.client.phone, row)
  }
  for (const c of state.clients) {
    if (c.email.trim()) add(existingEmail, c.email.trim().toLowerCase(), c.name)
    const phone = internationalPhone(c.phone, region)
    if (phone) add(existingPhone, phone, c.name)
  }
  // Already in SALEANE, by the server's own rule: the same name with the same email or phone.
  const named = (names: string[] | undefined, name: string) =>
    !!names?.some((other) => other.toLowerCase() === name.toLowerCase())
  const alreadyHere = (c: MovingClient) =>
    (!!c.email && named(existingEmail.get(c.email), c.name)) ||
    (!!c.phone && named(existingPhone.get(c.phone), c.name))
  for (const file of files.filter((f) => f.kind === 'clients')) {
    const system = SYSTEM_NAME[file.system ?? chosenSystem]
    const birthdayColumn = file.matches.find((m) => m.field === 'birthday')
    const order = dateOrder(
      birthdayColumn ? file.rows.map((r) => r[birthdayColumn.index] ?? '') : [],
      region,
    )
    file.rows.forEach((row, i) => {
      const line = file.lineNumbers[i]
      const p = pick(file, row)
      const notes: string[] = []
      const name = tidyName(p.firstName ?? '', p.lastName ?? '', p.fullName ?? '')
      const rawEmail = (p.email ?? '').toLowerCase()
      const email =
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail) && rawEmail.length <= 254 ? rawEmail : ''
      if (rawEmail && !email)
        notes.push(`The email “${p.email}” is not a real address, so it was left out.`)
      let phone = ''
      const extraPhones: string[] = []
      for (const raw of [p.mobile, p.phone]) {
        if (!raw) continue
        const intl = internationalPhone(raw, region)
        if (intl && !phone) phone = intl
        else if (intl && intl !== phone) extraPhones.push(intl)
        else if (!intl) notes.push(`The number “${raw}” could not be read, so it was left out.`)
      }
      const base = { fileName: file.fileName, line, notes }
      if (name.length < 2) {
        rows.push({ ...base, status: 'problem', detail: 'This row has no name.' })
        return
      }
      if (!email && !phone) {
        rows.push({
          ...base,
          status: 'problem',
          detail: `${name} has no email or phone number SALEANE can use.`,
        })
        return
      }
      let birthday: string | undefined
      if (p.birthday) {
        birthday = birthdayFrom(p.birthday, order) ?? undefined
        if (!birthday)
          notes.push(`The birthday “${p.birthday}” could not be read, so it was left out.`)
      }
      let area: string | undefined
      const postcodeText =
        p.postcode ||
        (region === 'UK'
          ? UK_POSTCODE_IN_TEXT.exec(p.address ?? '')
              ?.slice(1, 3)
              .join('')
          : US_ZIP_IN_TEXT.exec(p.address ?? '')?.[1]) ||
        ''
      if (postcodeText) area = postcodeArea(postcodeText, region) ?? undefined
      // Notes, tags, a second number and "blocked" all live in the client's notes.
      const noteParts: string[] = []
      if (p.notes) noteParts.push(p.notes)
      if (p.tags) noteParts.push(`Tags: ${p.tags}`)
      if (extraPhones.length) noteParts.push(`Other phone: ${extraPhones.join(', ')}`)
      if (p.blocked && yesNo(p.blocked)) noteParts.push(`Marked as blocked in ${system}.`)
      let preferences = noteParts.join('\n').trim()
      if (preferences.length > NOTES_LIMIT) {
        preferences = `${preferences.slice(0, NOTES_LIMIT - 1)}…`
        notes.push('The notes were longer than SALEANE keeps, so the end was cut.')
      }
      // Marketing: only a clear yes in a marketing column counts. Anything else stays off.
      let consentEvidence: string | undefined
      for (const field of ['emailMarketing', 'marketing'] as const) {
        const value = p[field]
        if (value && yesNo(value) === true && !consentEvidence)
          consentEvidence = `${system} recorded “${headingFor(file, field)}: ${value}”`
      }
      const textMarketing = p.smsMarketing ? yesNo(p.smsMarketing) === true : undefined
      const client: MovingClient = {
        name,
        email,
        phone,
        marketingConsent: !!consentEvidence,
        ...(consentEvidence ? { consentEvidence } : {}),
        ...(textMarketing ? { textMarketing } : {}),
        ...(birthday ? { birthday } : {}),
        ...(area ? { postcodeArea: area } : {}),
        ...(preferences ? { preferences } : {}),
      }
      // Already in SALEANE: left alone, never merged.
      if (alreadyHere(client)) {
        rows.push({
          ...base,
          status: 'here',
          detail: `${name} is already in SALEANE. Their record stays as it is.`,
          client,
        })
        return
      }
      const hereByEmail = (email && existingEmail.get(email)) || []
      const hereByPhone = (phone && existingPhone.get(phone)) || []
      if (hereByEmail.length || hereByPhone.length)
        notes.push(
          `Shares ${hereByEmail.length ? 'an email' : 'a phone number'} with ${hereByEmail[0] ?? hereByPhone[0]}, who is already here. Both are kept.`,
        )
      // The same person twice in the old system's files: combine, filling gaps.
      const sharingEmail = (email && byEmail.get(email)) || []
      const sharing = [...sharingEmail, ...((phone && byPhone.get(phone)) || [])]
      const earlier = sharing.find((r) => r.client?.name.toLowerCase() === name.toLowerCase())
      if (earlier?.client) {
        fold(earlier.client, client)
        index(earlier)
        rows.push({
          ...base,
          status: 'combined',
          detail: `Combined with ${name} from ${earlier.fileName}, line ${earlier.line}.`,
        })
        return
      }
      if (sharing[0]?.client)
        notes.push(
          `Shares ${sharingEmail.length ? 'an email' : 'a phone number'} with ${sharing[0].client.name}. Both are kept.`,
        )
      const ready: ClientRow = {
        ...base,
        status: 'ready',
        detail: consentEvidence
          ? 'Agreed to marketing in your old system.'
          : 'Marketing stays off.',
        client,
      }
      rows.push(ready)
      index(ready)
    })
  }
  // Combining can give a client a second email or phone, so the finished list is checked once
  // more: against everyone already here, and against itself.
  const seen = new Map<string, ClientRow>()
  for (const r of rows) {
    if (r.status !== 'ready' || !r.client) continue
    const c = r.client
    if (alreadyHere(c)) {
      r.status = 'here'
      r.detail = `${c.name} is already in SALEANE. Their record stays as it is.`
      continue
    }
    const keys = (row: MovingClient) =>
      [
        row.email && `${row.name.toLowerCase()}|${row.email}`,
        row.phone && `${row.name.toLowerCase()}|${row.phone}`,
      ].filter((key): key is string => !!key)
    const first = keys(c)
      .map((key) => seen.get(key))
      .find((row) => row?.client)
    if (first?.client) {
      fold(first.client, c)
      r.status = 'combined'
      r.detail = `Combined with ${c.name} from ${first.fileName}, line ${first.line}.`
      delete r.client
      for (const key of keys(first.client)) seen.set(key, first)
    } else for (const key of keys(c)) seen.set(key, r)
  }
  // Email marketing needs an email to go to. A client with none, even after combining, starts off.
  for (const r of rows)
    if (r.status === 'ready' && r.client?.marketingConsent && !r.client.email) {
      r.client.marketingConsent = false
      delete r.client.consentEvidence
      r.detail = 'Marketing stays off.'
      r.notes.push(
        'Agreed to marketing in the old system but has no email, so marketing starts off.',
      )
    }
  const ready = rows.filter((r) => r.status === 'ready').map((r) => r.client!)
  const counts = { ready: 0, here: 0, problem: 0, combined: 0 }
  for (const r of rows) counts[r.status]++
  return {
    rows,
    ready,
    counts,
    marketing: ready.filter((c) => c.marketingConsent).length,
    birthdays: ready.filter((c) => c.birthday).length,
    withNotes: ready.filter((c) => c.preferences).length,
  }
}

/** Two rows for the same person become one client: gaps are filled and every note is kept. */
function fold(into: MovingClient, from: MovingClient) {
  if (!into.email && from.email) into.email = from.email
  if (!into.phone && from.phone) into.phone = from.phone
  if (!into.birthday && from.birthday) into.birthday = from.birthday
  if (!into.postcodeArea && from.postcodeArea) into.postcodeArea = from.postcodeArea
  if (from.preferences && !(into.preferences ?? '').includes(from.preferences))
    into.preferences = [into.preferences, from.preferences]
      .filter(Boolean)
      .join('\n')
      .slice(0, NOTES_LIMIT)
  if (!into.marketingConsent && from.consentEvidence) {
    into.marketingConsent = true
    into.consentEvidence = from.consentEvidence
  }
  if (from.textMarketing) into.textMarketing = true
}

/** Requests stay under the server's size limit, so a long list goes in several parts. */
export const MOVE_PART_BYTES = 56 * 1024
export const MOVE_PART_ROWS = 500

export function movingParts(clients: MovingClient[]) {
  const parts: MovingClient[][] = []
  let current: MovingClient[] = []
  let size = 0
  for (const client of clients) {
    const bytes = new TextEncoder().encode(JSON.stringify(client)).byteLength + 1
    if (current.length && (size + bytes > MOVE_PART_BYTES || current.length >= MOVE_PART_ROWS)) {
      parts.push(current)
      current = []
      size = 0
    }
    current.push(client)
    size += bytes
  }
  if (current.length) parts.push(current)
  return parts
}
