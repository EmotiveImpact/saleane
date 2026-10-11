import type { BusinessState } from '../model'
import { businessDate, operations } from '../operations'
import { carriedCode, normaliseCode } from '../giftCards'
import { planStanding } from '../plans'
import { fullDateLabel, money } from '../format'
import { dateOrder, internationalPhone, tidyName } from './clients'
import type { MovingClient, MovingFile } from './clients'
import { SYSTEM_NAME } from './systems'
import type { OldSystem } from './systems'
import { MONEY_FIELD_LABEL } from './moneyFields'
import type { MoneyField } from './moneyFields'
import {
  People,
  WALK_IN,
  arrivedClients,
  matchNames,
  moneyFrom,
  nameKey,
  suggestTreatment,
  treatmentKey,
  whenFrom,
} from './visits'
import type { ClientKey, FindWords, NameMatch, Person, Who } from './visits'

/**
 * Moving in, stage 3: money the studio already holds for its clients, from the old system's own
 * files. Gift cards keep the code printed on them and what is left to spend; packages keep their
 * visits left; credit and money owed are recorded for the desk. Each is recorded as paid to the
 * old system, so nothing counts as takings twice, and every total is checked against the old
 * system's own total when the file gives one. Memberships wait for clients to save their card.
 */

export type MoneyKind = 'giftCards' | 'packages' | 'credit'

export type MoneyRowStatus =
  'ready' | 'here' | 'problem' | 'used' | 'expired' | 'cancelled' | 'skipped' | 'combined'

export type MoneyRow = {
  fileName: string
  line: number
  kind: MoneyKind
  status: MoneyRowStatus
  /** What it becomes, or why it is not coming across. */
  detail: string
  /** Small things to know, such as a new code or a value worked out. */
  notes: string[]
  /** For recognising it: "GV58214 · £30.00 left · Olivia James". */
  label: string
  /**
   * What is left as the file writes it, for checking against the old system's total: money for
   * gift cards and credit, visits for packages. Null when it could not be read.
   */
  left: number | null
}

/** A client already in SALEANE, or one coming across in the same move. */
export type ClientRef = { id: string } | { arriving: ClientKey }

export type PlannedCard = {
  code?: string
  codeBefore?: string
  balanceMinor: number
  valueBeforeMinor?: number
  client?: ClientRef
  purchaserName: string
  recipientName: string
  issuedOn?: string
  expiresOn?: string
}

export type PlannedPackage = {
  client: ClientRef
  name: string
  serviceIds: string[]
  visitsLeft: number
  visitsBefore?: number
  valueMinor: number
  startedOn?: string
  endsOn?: string
}

export type PlannedCredit = {
  client: ClientRef
  kind: 'credit' | 'owed'
  amountMinor: number
  note: string
}

/** A file whose amounts could mean either way round, and what an amount above zero is taken to mean. */
export type SignQuestion = {
  fileName: string
  positive: 'credit' | 'owed'
  how: 'suggested' | 'chosen'
  /** A few amounts from the file, as written. */
  samples: string[]
}

/** What came across against what the old system says it holds. */
export type TotalCheck = {
  kind: MoneyKind
  unit: 'money' | 'visits'
  /** Where the old system's figure comes from, in plain words. */
  source: string
  theirs: number
  /** What every row SALEANE read adds up to. */
  rows: number
  coming: number
  /** What stays behind, by reason, leaving out reasons with nothing in them. */
  behind: { status: MoneyRowStatus; count: number; amount: number }[]
  agrees: boolean
}

export type MoneyChoices = {
  /** A package's treatment, as matched, to a SALEANE treatment; null leaves those packages behind. */
  packages: Record<string, string | null>
  /** A file's name to what an amount above zero means in it. */
  signs: Record<string, 'credit' | 'owed'>
}

export type MoneyReview = {
  rows: MoneyRow[]
  cards: PlannedCard[]
  packages: PlannedPackage[]
  credit: PlannedCredit[]
  /** Clients a package or credit file names with an email or phone who are not here yet. */
  newClients: MovingClient[]
  /** Which treatment each package is for; `visits` counts the packages. */
  treatments: NameMatch[]
  signs: SignQuestion[]
  counts: Record<MoneyRowStatus, number>
  cardsMinor: number
  packagesMinor: number
  packageVisits: number
  creditMinor: number
  owedMinor: number
  checks: TotalCheck[]
  /** Files where SALEANE could not find a column it needs. */
  missing: { fileName: string; fields: MoneyField[] }[]
}

// ---------------------------------------------------------------------------------------------
// Values

/**
 * Timely keeps a card's last day with its code: "GV58214 (expires 31/03/2027)", or
 * "(expires never)". Returns the code alone, and the last day as written when there is one.
 */
export function codeAndExpiry(raw: string): { code: string; expiry: string | null } {
  const m = /^(.*?)\s*\(\s*(?:expires|expiry|exp\.?|valid until|until)\s*:?\s*([^)]*)\)\s*$/i.exec(
    raw.trim(),
  )
  return m ? { code: m[1].trim(), expiry: m[2].trim() } : { code: raw.trim(), expiry: null }
}

const NO_LAST_DAY =
  /^(never|none|no|n\/?a|-|–|no expiry|no expiration|no end date|does not expire|doesn.t expire|unlimited|indefinite)$/i

/** A last day: a date, none at all, or something that could not be read. */
function lastDayFrom(
  raw: string,
  order: 'dayFirst' | 'monthFirst',
): { date: string } | { none: true } | { unreadable: string } {
  const v = raw.trim()
  if (!v || NO_LAST_DAY.test(v)) return { none: true }
  const when = whenFrom(v, '', order)
  return when ? { date: when.date } : { unreadable: v }
}

/** A count of visits: "4", "4.0", "4 visits"; unlimited counts are kept apart. */
export function countFrom(raw: string): number | 'unlimited' | null {
  const v = raw.trim().toLowerCase().replace(/,/g, '')
  if (!v) return null
  if (/unlimited|∞/.test(v)) return 'unlimited'
  const m = /^(-?\d+)(?:\.0+)?(?:\s*(?:visits?|sessions?|treatments?|units?|credits?))?$/.exec(v)
  return m ? Number(m[1]) : null
}

type MoneyStatus = 'active' | 'used' | 'expired' | 'cancelled'

/** What an old system's status means for a card, package or credit. */
export function moneyStatus(raw: string): MoneyStatus {
  const v = raw.trim().toLowerCase()
  if (/cancel|refund|void|deleted|revoked|written off|terminated|suspended/.test(v))
    return 'cancelled'
  if (/expired|lapsed/.test(v)) return 'expired'
  if (/^(fully )?(redeemed|used( up)?|spent|completed?|finished|exhausted)$/.test(v)) return 'used'
  return 'active'
}

const OWED = /owe|owing|debt|\bdue\b|unpaid|arrears|outstanding payment|account receivable/i
const CREDIT = /credit|prepaid|pre-paid|refund|deposit|top.?up|account/i

/**
 * The treatment a package is for, without the words around it: "Course of 6 Skin Renewal
 * Facials" and "Skin Renewal Facial" both become "skin renewal facial".
 */
export function packageKey(name: string) {
  return treatmentKey(name)
    .replace(
      /\b(courses?|packages?|bundles?|block|series|of|sessions?|visits?|treatments?|x\s?\d+|\d+\s?x|\d+)\b/g,
      ' ',
    )
    .split(' ')
    .filter(Boolean)
    .map((word) =>
      word.length > 3 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word,
    )
    .join(' ')
}

const list = (items: string[]) =>
  new Intl.ListFormat('en-GB', { type: 'conjunction' }).format(items)
const plural = (n: number, word: string) => `${n} ${n === 1 ? word : `${word}s`}`

const MONEY_WORDS: FindWords = {
  shared: (count, by) =>
    `${count} clients share this ${by}, so SALEANE cannot tell whose this is. Add the client’s name to the file.`,
  otherName: (by, owner, name) =>
    `The ${by} belongs to ${owner}, but this is for ${name}. Check which client it belongs to in the file.`,
  sameName: (count, name) =>
    `${count} clients are called ${name}. Add each client’s email or mobile to the file so SALEANE can tell them apart.`,
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// ---------------------------------------------------------------------------------------------
// Review

type Read = {
  row: MoneyRow
  who: Who
  system: string
  get: (field: MoneyField) => string
}

type CardIn = Read & {
  code: string | null
  codeBefore?: string
  balance: number
  valueBefore: number | null
  recipient: string
  purchaser: string
  issuedOn?: string
  expiresOn?: string
}
type PackageIn = Read & {
  name: string
  matchName: string
  visitsLeft: number
  visitsBefore?: number
  valueMinor: number
  startedOn?: string
  endsOn?: string
}
type CreditIn = Read & { signed: number; note: string }

/**
 * Builds the review for every gift card, package and credit file the owner added, and the credit
 * in any client list that carries it. `arriving` are the clients coming across in the same move;
 * `withoutContact` are names in the client list that cannot come across.
 */
export function reviewMoney(
  files: MovingFile[],
  state: BusinessState,
  arriving: MovingClient[],
  choices: MoneyChoices,
  chosenSystem: OldSystem,
  now: string,
  withoutContact: string[] = [],
): MoneyReview {
  const org = state.organisation
  const region = org.region
  const today = businessDate(state, now)
  const amount = (minor: number) => money(minor, org, true)
  const day = (date: string) => fullDateLabel(date, org.locale)
  const rows: MoneyRow[] = []
  const missing: MoneyReview['missing'] = []
  const signs: SignQuestion[] = []
  const cardsIn: CardIn[] = []
  const packagesIn: PackageIn[] = []
  const creditIn: CreditIn[] = []
  // Each file's rows, for its own total row.
  const byFile = new Map<MovingFile, MoneyRow[]>()

  for (const file of files) {
    if (file.unread || !file.moneyMatches.length) continue
    const fromClientList = file.kind === 'clients'
    const kind: MoneyKind | null =
      fromClientList || file.kind === 'credit'
        ? 'credit'
        : file.kind === 'giftCards' || file.kind === 'packages'
          ? file.kind
          : null
    if (!kind) continue
    const system = SYSTEM_NAME[file.system ?? chosenSystem]
    const column = (field: MoneyField) => {
      const match = file.moneyMatches.find((m) => m.field === field)
      // A client list's credit column counts only when its heading and contents agree.
      if (fromClientList && match && match.confidence !== 'high') return undefined
      return match?.index
    }
    const at = (cells: string[], field: MoneyField) => {
      const index = column(field)
      return index === undefined ? '' : (cells[index] ?? '').trim()
    }
    const has = (field: MoneyField) => column(field) !== undefined
    if (fromClientList && !has('credit')) continue
    const clientColumn = (field: string) => file.matches.find((m) => m.field === field)?.index
    const fromClients = (cells: string[], field: string) => {
      const index = clientColumn(field)
      return index === undefined ? '' : (cells[index] ?? '').trim()
    }
    const hasClient = fromClientList
      ? true
      : (['client', 'firstName', 'lastName', 'email', 'phone'] as const).some(has)

    const needs: MoneyField[] = []
    if (kind === 'giftCards' && !has('balance') && !(has('value') && has('redeemed')))
      needs.push('balance')
    if (kind === 'packages') {
      if (!has('name') && !has('treatment')) needs.push('name')
      if (!has('visitsLeft') && !(has('visitsTotal') && has('visitsUsed'))) needs.push('visitsLeft')
    }
    if (kind === 'credit' && !has('credit') && !has('balance') && !has('value'))
      needs.push('credit')
    if (kind !== 'giftCards' && !hasClient) needs.push('client')
    if (needs.length) missing.push({ fileName: file.fileName, fields: needs })

    // Dates in this file, to tell 05/03 from 03/05.
    const dateCells: string[] = []
    for (const cells of file.rows) {
      dateCells.push(at(cells, 'issued'), at(cells, 'expiry'))
      const fromCode = codeAndExpiry(at(cells, 'code')).expiry
      if (fromCode) dateCells.push(fromCode)
    }
    const order = dateOrder(dateCells, region)
    const fileRows: MoneyRow[] = []
    byFile.set(file, fileRows)

    // Credit files whose amounts could mean either way round.
    let positive: 'credit' | 'owed' = 'credit'
    if (kind === 'credit') {
      const amounts = file.rows
        .map((cells) => at(cells, has('credit') ? 'credit' : 'balance'))
        .filter((v) => v)
      const negative = amounts.some((v) => (moneyFrom(v) ?? 0) < 0)
      const phorest = (file.system ?? chosenSystem) === 'phorest'
      if (!has('type') && (negative || phorest)) {
        const chosen = choices.signs[file.fileName]
        positive = chosen ?? (phorest ? 'owed' : 'credit')
        signs.push({
          fileName: file.fileName,
          positive,
          how: chosen ? 'chosen' : 'suggested',
          samples: [...new Set(amounts)].slice(0, 4),
        })
      }
    }

    file.rows.forEach((cells, i) => {
      const get = (field: MoneyField) => at(cells, field)
      const name = fromClientList
        ? tidyName(
            fromClients(cells, 'firstName'),
            fromClients(cells, 'lastName'),
            fromClients(cells, 'fullName'),
          )
        : tidyName(get('firstName'), get('lastName'), get('client'))
      const rawEmail = (fromClientList ? fromClients(cells, 'email') : get('email')).toLowerCase()
      const rawPhone = fromClientList
        ? fromClients(cells, 'mobile') || fromClients(cells, 'phone')
        : get('phone')
      const who: Who = {
        name,
        key: nameKey(name),
        email: EMAIL.test(rawEmail) && rawEmail.length <= 254 ? rawEmail : '',
        phone: (rawPhone && internationalPhone(rawPhone, region)) || '',
      }
      const row: MoneyRow = {
        fileName: file.fileName,
        line: file.lineNumbers[i],
        kind,
        status: 'problem',
        detail: '',
        notes: [],
        label: '',
        left: null,
      }
      const read: Read = { row, who, system, get }
      const status = moneyStatus(get('status'))
      fileRows.push(row)

      if (kind === 'giftCards') {
        const { code: codeCell, expiry: expiryInCode } = codeAndExpiry(get('code'))
        const codeEnd = get('codeEnd').replace(/\D/g, '')
        let balance = get('balance') ? moneyFrom(get('balance')) : null
        const value = get('value') ? moneyFrom(get('value')) : null
        const redeemed = get('redeemed') ? moneyFrom(get('redeemed')) : null
        if (balance === null && !get('balance') && value !== null && redeemed !== null)
          balance = value - redeemed
        row.left = balance
        const recipient = tidyName('', '', get('recipient'))
        row.label = [
          codeCell || (codeEnd ? `Ending ${codeEnd}` : 'No code'),
          balance !== null ? `${amount(balance)} left` : '',
          name || recipient,
        ]
          .filter(Boolean)
          .join(' · ')
        rows.push(row)
        if (needs.length) return missingDetail(row, file.fileName, needs)
        if (balance === null) {
          row.detail = get('balance')
            ? `What is left on it (“${get('balance')}”) could not be read.`
            : 'This row does not say what is left on it.'
          return
        }
        if (status === 'cancelled') return leave(row, 'cancelled', `Cancelled in ${system}.`)
        if (balance <= 0) return leave(row, 'used', 'Nothing left to spend.')
        const last = lastDayFrom(get('expiry') || expiryInCode || '', order)
        if ('unreadable' in last) {
          row.detail = `Its last day (“${last.unreadable}”) could not be read.`
          return
        }
        if (status === 'expired' || ('date' in last && last.date < today))
          return leave(
            row,
            'expired',
            'date' in last && last.date < today
              ? `Expired on ${day(last.date)}.`
              : `Marked as expired in ${system}.`,
          )
        if (status === 'used')
          row.notes.push(
            `Marked as used in ${system}, but ${amount(balance)} is still left on it, so it comes across.`,
          )
        const kept = codeCell ? carriedCode(codeCell) : null
        let codeBefore: string | undefined
        if (codeCell && !kept) {
          codeBefore = codeCell.slice(0, 40)
          row.notes.push(
            `The code “${codeCell}” cannot be typed at the desk, so it gets a new SALEANE code. Give the guest their new code.`,
          )
        } else if (!codeCell && codeEnd) {
          codeBefore = `ending ${codeEnd.slice(-4)}`
          row.notes.push(
            `${system} shares only the last digits of each code, so it gets a new SALEANE code. Give the guest their new code.`,
          )
        } else if (!codeCell)
          row.notes.push('The file gives no code, so it gets a new SALEANE code.')
        let valueBefore = value ?? (redeemed !== null ? balance + redeemed : null)
        if (valueBefore !== null && valueBefore < balance) {
          row.notes.push(
            `It has more left (${amount(balance)}) than it was bought for (${amount(valueBefore)}), so only what is left comes across.`,
          )
          valueBefore = null
        }
        const issued = get('issued') ? lastDayFrom(get('issued'), order) : null
        const itemName = get('name')
        if (itemName && !/gift|^[£$€\d]|\d\s*(gbp|usd|eur)?$/i.test(itemName))
          row.notes.push(
            `Bought as “${itemName}” in ${system}. It comes across as ${amount(balance)} to spend on anything.`,
          )
        if ('none' in last)
          row.notes.push(
            `${has('expiry') || expiryInCode ? `No last day in ${system}` : 'The file gives no last day'}, so SALEANE keeps it for ten years.`,
          )
        cardsIn.push({
          ...read,
          code: kept,
          ...(codeBefore ? { codeBefore } : {}),
          balance,
          valueBefore,
          recipient,
          purchaser: tidyName('', '', get('purchaser')),
          ...(issued && 'date' in issued && issued.date <= today ? { issuedOn: issued.date } : {}),
          ...('date' in last ? { expiresOn: last.date } : {}),
        })
        return
      }

      if (kind === 'packages') {
        const itemName = (get('name') || get('treatment')).replace(/\s+/g, ' ').trim()
        const left = countFrom(get('visitsLeft'))
        const used = countFrom(get('visitsUsed'))
        const total = countFrom(get('visitsTotal'))
        let visitsLeft = left
        if (visitsLeft === null && typeof total === 'number' && typeof used === 'number')
          visitsLeft = total - used
        row.left = typeof visitsLeft === 'number' ? visitsLeft : null
        row.label = [
          name,
          itemName,
          typeof visitsLeft === 'number' ? `${plural(visitsLeft, 'visit')} left` : '',
        ]
          .filter(Boolean)
          .join(' · ')
        rows.push(row)
        if (needs.length) return missingDetail(row, file.fileName, needs)
        if (status === 'cancelled') return leave(row, 'cancelled', `Cancelled in ${system}.`)
        if (visitsLeft === 'unlimited' || (typeof visitsLeft === 'number' && visitsLeft > 100)) {
          row.detail =
            'It has unlimited visits, which makes it a membership. Memberships come across once clients save their card again.'
          return
        }
        if (visitsLeft === null) {
          row.detail = get('visitsLeft')
            ? `How many visits are left (“${get('visitsLeft')}”) could not be read.`
            : 'This row does not say how many visits are left.'
          return
        }
        if (visitsLeft <= 0) return leave(row, 'used', 'No visits left.')
        const last = lastDayFrom(get('expiry'), order)
        if ('unreadable' in last) {
          row.detail = `Its last day (“${last.unreadable}”) could not be read.`
          return
        }
        if (status === 'expired' || ('date' in last && last.date < today))
          return leave(
            row,
            'expired',
            'date' in last && last.date < today
              ? `Ended on ${day(last.date)}.`
              : `Marked as expired in ${system}.`,
          )
        if (itemName.length < 2) {
          row.detail = 'This row does not say what the package is.'
          return
        }
        let visitsBefore =
          typeof total === 'number'
            ? total
            : typeof used === 'number'
              ? visitsLeft + used
              : undefined
        if (visitsBefore !== undefined && (visitsBefore < visitsLeft || visitsBefore > 100)) {
          row.notes.push('The number of visits it began with does not add up, so it is left out.')
          visitsBefore = undefined
        }
        // What the visits left are worth: what is left in money when the file says, otherwise
        // their share of what it was bought for.
        const leftValue = get('balance') ? moneyFrom(get('balance')) : null
        const paid = get('value') ? moneyFrom(get('value')) : null
        let valueMinor = 0
        if (leftValue !== null && leftValue >= 0) valueMinor = leftValue
        else if (paid !== null && paid >= 0 && visitsBefore) {
          valueMinor = Math.round((paid * visitsLeft) / visitsBefore)
          if (visitsBefore !== visitsLeft)
            row.notes.push(
              `Bought for ${amount(paid)}; the ${plural(visitsLeft, 'visit')} left are worth ${amount(valueMinor)}.`,
            )
        } else
          row.notes.push(
            paid !== null
              ? 'The file does not say how many visits it began with, so SALEANE cannot tell what the visits left are worth. It counts them as worth nothing; each visit still comes off in full.'
              : 'The file does not say what it cost, so SALEANE counts it as worth nothing. Each visit still comes off in full.',
          )
        const started = get('issued') ? lastDayFrom(get('issued'), order) : null
        if ('none' in last)
          row.notes.push(
            `${has('expiry') ? `No last day in ${system}` : 'The file gives no last day'}, so SALEANE keeps it for ten years.`,
          )
        packagesIn.push({
          ...read,
          name: itemName.slice(0, 100),
          matchName: get('treatment') || itemName,
          visitsLeft,
          ...(visitsBefore !== undefined ? { visitsBefore } : {}),
          valueMinor,
          ...(started && 'date' in started && started.date <= today
            ? { startedOn: started.date }
            : {}),
          ...('date' in last ? { endsOn: last.date } : {}),
        })
        return
      }

      // Credit, or money owed. A client list gives it only in its credit column.
      const raw = fromClientList ? get('credit') : get('credit') || get('balance') || get('value')
      let signed = raw ? moneyFrom(raw) : null
      if (
        !fromClientList &&
        !get('credit') &&
        !get('balance') &&
        signed !== null &&
        get('redeemed')
      ) {
        const redeemed = moneyFrom(get('redeemed'))
        signed = redeemed === null ? null : signed - redeemed
      }
      if (fromClientList && (!raw || signed === 0)) {
        fileRows.pop()
        return
      }
      const typeWords = get('type')
      const kindOf = (n: number): 'credit' | 'owed' => {
        if (OWED.test(typeWords)) return 'owed'
        if (CREDIT.test(typeWords)) return 'credit'
        const flip = positive === 'credit' ? 'owed' : 'credit'
        return n >= 0 ? positive : flip
      }
      row.left = signed
      row.label = [
        name,
        signed !== null && signed !== 0
          ? `${amount(Math.abs(signed))} ${kindOf(signed) === 'owed' ? 'owed' : 'credit'}`
          : '',
      ]
        .filter(Boolean)
        .join(' · ')
      rows.push(row)
      if (needs.length) return missingDetail(row, file.fileName, needs)
      if (signed === null) {
        row.detail = raw ? `The amount “${raw}” could not be read.` : 'This row has no amount.'
        return
      }
      if (status === 'cancelled') return leave(row, 'cancelled', `Cancelled in ${system}.`)
      if (signed === 0) return leave(row, 'used', 'Nothing left.')
      const last = lastDayFrom(get('expiry'), order)
      if (status === 'expired' || ('date' in last && last.date < today))
        return leave(
          row,
          'expired',
          'date' in last && last.date < today
            ? `Expired on ${day(last.date)}.`
            : `Marked as expired in ${system}.`,
        )
      if (status === 'used')
        row.notes.push(
          `Marked as used in ${system}, but ${amount(Math.abs(signed))} is still left, so it comes across.`,
        )
      const kindHere = kindOf(signed)
      const reason = get('note').replace(/\s+/g, ' ').trim()
      const note = [
        reason,
        'date' in last ? `Expires ${day(last.date)} in ${system}` : '',
        'unreadable' in last ? `Last day in ${system}: ${last.unreadable}` : '',
      ]
        .filter(Boolean)
        .join('. ')
        .slice(0, 200)
      creditIn.push({
        ...read,
        signed: kindHere === 'credit' ? Math.abs(signed) : -Math.abs(signed),
        note,
      })
    })
  }

  // Who each package and credit is for, and who each gift card was bought by.
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
  type Found = Person & { isNew?: true }
  const refOf = (person: Found): ClientRef =>
    person.id
      ? { id: person.id }
      : { arriving: { name: person.name, email: person.email, phone: person.phone } }
  const keyOf = (person: Found) => person.id ?? `${person.key}|${person.email}|${person.phone}`
  /** The client a package or credit belongs to, or why there is none. */
  const clientFor = (read: Read, what: string): Found | { problem: string } => {
    const { who } = read
    if (!who.key && !who.email && !who.phone) return { problem: `This ${what} has no client.` }
    if (WALK_IN.test(who.key)) return { problem: `This ${what} has no client.` }
    const found = people.find(who, MONEY_WORDS)
    if (found) return found
    if (!who.email && !who.phone)
      return {
        problem: noContact.has(who.key)
          ? `This client is in your client list without an email or phone, so neither they nor this ${what} can come across.`
          : withClientList
            ? `This client is not in SALEANE or in your client list, so this ${what} cannot come across. Add the client, then add this file again.`
            : `This client is not in SALEANE yet. Add your client list too, so this ${what} can come across.`,
      }
    if (who.name.length < 2)
      return {
        problem:
          'No client in SALEANE or in your client list has this email or phone, and the file gives no name to add them by.',
      }
    return { name: who.name, key: who.key, email: who.email, phone: who.phone, isNew: true }
  }
  /** A client new from a package or credit file comes across once something of theirs does. */
  const welcome = (row: MoneyRow, person: Found) => {
    if (!person.isNew) return
    newClients.push({
      name: person.name,
      email: person.email,
      phone: person.phone,
      marketingConsent: false,
    })
    people.add({ name: person.name, key: person.key, email: person.email, phone: person.phone })
    delete person.isNew
    row.notes.push(
      'This client is not in your client list, so they come across as a new client from this file, with marketing off.',
    )
  }

  // Gift cards: each code once, and never one already here.
  const taken = new Set((state.giftCards ?? []).map((card) => normaliseCode(card.code)))
  const seenCodes = new Map<string, CardIn>()
  const cards: PlannedCard[] = []
  for (const card of cardsIn) {
    const { row } = card
    if (card.code) {
      const first = seenCodes.get(card.code)
      if (first) {
        leave(
          row,
          'combined',
          `Listed twice, so it comes across once (${first.row.fileName}, line ${first.row.line}).`,
        )
        continue
      }
      seenCodes.set(card.code, card)
      if (taken.has(card.code)) {
        leave(row, 'here', 'A gift card with this code is already in SALEANE. It stays as it is.')
        continue
      }
    }
    let client: ClientRef | undefined
    let linkedName = ''
    if ((card.who.key || card.who.email || card.who.phone) && !WALK_IN.test(card.who.key)) {
      const found = people.find(card.who, MONEY_WORDS)
      if (found && !('problem' in found)) {
        client = refOf(found)
        linkedName = found.name
      } else if (card.who.name.length >= 2)
        row.notes.push(
          found
            ? `Not linked to a client: ${found.problem}`
            : `${card.who.name} is not in SALEANE or your client list, so the card is not linked to a client.`,
        )
    }
    const purchaserName =
      [card.purchaser, linkedName, card.who.name, card.recipient].find((n) => n.length >= 2) ??
      `A ${card.system} customer`
    row.status = 'ready'
    row.detail = `${card.code ? 'Keeps its code.' : 'Gets a new SALEANE code.'} ${amount(card.balance)} to spend${card.expiresOn ? ` until ${day(card.expiresOn)}` : ''}.`
    cards.push({
      ...(card.code ? { code: card.code } : {}),
      ...(card.codeBefore ? { codeBefore: card.codeBefore } : {}),
      balanceMinor: card.balance,
      ...(card.valueBefore !== null ? { valueBeforeMinor: card.valueBefore } : {}),
      ...(client ? { client } : {}),
      purchaserName: purchaserName.slice(0, 100),
      recipientName: card.recipient.slice(0, 100),
      ...(card.issuedOn ? { issuedOn: card.issuedOn } : {}),
      ...(card.expiresOn ? { expiresOn: card.expiresOn } : {}),
    })
  }

  // Packages: whose each is, then which treatment it is for, asked only about packages that can
  // otherwise come across.
  const holdings = state.holdings ?? []
  const seenPackages = new Map<string, PackageIn>()
  const waiting: { p: PackageIn; found: Found }[] = []
  for (const p of packagesIn) {
    const { row } = p
    const found = clientFor(p, 'package')
    if ('problem' in found) {
      row.detail = found.problem
      continue
    }
    const sameKey = [keyOf(found), nameKey(p.name), p.visitsLeft, p.endsOn ?? ''].join('|')
    const first = seenPackages.get(sameKey)
    if (first) {
      leave(
        row,
        'combined',
        `Listed twice, so it comes across once (${first.row.fileName}, line ${first.row.line}).`,
      )
      continue
    }
    seenPackages.set(sameKey, p)
    if (
      found.id &&
      holdings.some(
        (h) =>
          h.carried &&
          h.clientId === found.id &&
          h.name === p.name &&
          h.status === 'active' &&
          planStanding(h, today).visitsLeft > 0,
      )
    ) {
      leave(row, 'here', `${found.name} already has ${p.name} in SALEANE. It stays as it is.`)
      continue
    }
    waiting.push({ p, found })
  }
  const services = state.services.filter((s) => !s.archived)
  const treatments = matchNames(
    waiting.map(({ p }) => p.matchName),
    services,
    choices.packages,
    packageKey,
    suggestTreatment,
  )
  const packages: PlannedPackage[] = []
  const namesUsed = new Map<string, number>()
  for (const { p, found } of waiting) {
    const { row } = p
    const t = treatments.find((m) => m.key === packageKey(p.matchName))!
    if (t.id === null) {
      leave(row, 'skipped', `You chose to leave “${t.name}” packages behind.`)
      continue
    }
    if (t.id === undefined) {
      row.detail = `Choose which of your treatments “${t.name}” is for.`
      continue
    }
    // The same package bought twice by one client comes across as two, told apart by number.
    const nameFor = `${keyOf(found)}|${nameKey(p.name)}`
    const times = (namesUsed.get(nameFor) ?? 0) + 1
    namesUsed.set(nameFor, times)
    const name = times > 1 ? `${p.name.slice(0, 95)} (${times})` : p.name
    if (times > 1)
      row.notes.push(
        `${found.name} has this package more than once, so this one is called “${name}”.`,
      )
    welcome(row, found)
    const service = services.find((s) => s.id === t.id)!
    row.status = 'ready'
    row.detail = `${plural(p.visitsLeft, 'visit')} of ${service.name} left${p.endsOn ? `, until ${day(p.endsOn)}` : ''}.`
    packages.push({
      client: refOf(found),
      name,
      serviceIds: [service.id],
      visitsLeft: p.visitsLeft,
      ...(p.visitsBefore !== undefined ? { visitsBefore: p.visitsBefore } : {}),
      valueMinor: p.valueMinor,
      ...(p.startedOn ? { startedOn: p.startedOn } : {}),
      ...(p.endsOn ? { endsOn: p.endsOn } : {}),
    })
  }

  // Credit: one carried balance for each client, so several rows for one client are added up.
  const balances = operations(state).balances ?? []
  type Held = { first: CreditIn; found: Found; total: number; mixed: boolean }
  const perClient = new Map<string, Held>()
  for (const c of creditIn) {
    const found = clientFor(c, 'credit')
    if ('problem' in found) {
      c.row.detail = found.problem
      continue
    }
    if (found.id && balances.some((b) => b.clientId === found.id && !b.settled)) {
      leave(
        c.row,
        'here',
        `${found.name} already has a carried-over balance in SALEANE. It stays as it is.`,
      )
      continue
    }
    const held = perClient.get(keyOf(found))
    if (held) {
      held.total += c.signed
      if (Math.sign(c.signed) !== Math.sign(held.first.signed)) held.mixed = true
      leave(
        c.row,
        'combined',
        `Added to ${found.name}’s balance from ${held.first.row.fileName}, line ${held.first.row.line}, because SALEANE keeps one carried balance for each client.`,
      )
      if (c.note && !held.first.note.includes(c.note))
        held.first.note = [held.first.note, c.note].filter(Boolean).join('. ').slice(0, 200)
      continue
    }
    perClient.set(keyOf(found), { first: c, found, total: c.signed, mixed: false })
  }
  const credit: PlannedCredit[] = []
  for (const { first, found, total, mixed } of perClient.values()) {
    const { row } = first
    if (mixed) row.notes.push('Credit and money owed for this client are added together.')
    if (total === 0) {
      leave(row, 'used', `${found.name}’s credit and money owed cancel each other out.`)
      continue
    }
    welcome(row, found)
    const kind = total > 0 ? 'credit' : 'owed'
    row.status = 'ready'
    row.detail =
      kind === 'credit'
        ? `${amount(total)} in credit, for the desk to use or give back.`
        : `${amount(-total)} owed to you.`
    credit.push({ client: refOf(found), kind, amountMinor: Math.abs(total), note: first.note })
  }

  const counts: Record<MoneyRowStatus, number> = {
    ready: 0,
    here: 0,
    problem: 0,
    used: 0,
    expired: 0,
    cancelled: 0,
    skipped: 0,
    combined: 0,
  }
  for (const r of rows) counts[r.status]++

  return {
    rows,
    cards,
    packages,
    credit,
    newClients,
    treatments,
    signs,
    counts,
    cardsMinor: cards.reduce((sum, c) => sum + c.balanceMinor, 0),
    packagesMinor: packages.reduce((sum, p) => sum + p.valueMinor, 0),
    packageVisits: packages.reduce((sum, p) => sum + p.visitsLeft, 0),
    creditMinor: credit
      .filter((c) => c.kind === 'credit')
      .reduce((sum, c) => sum + c.amountMinor, 0),
    owedMinor: credit.filter((c) => c.kind === 'owed').reduce((sum, c) => sum + c.amountMinor, 0),
    checks: totalChecks(files, rows, byFile, chosenSystem),
    missing,
  }
}

function leave(row: MoneyRow, status: MoneyRowStatus, detail: string) {
  row.status = status
  row.detail = detail
}

function missingDetail(row: MoneyRow, fileName: string, needs: MoneyField[]) {
  row.detail = `SALEANE could not find the ${list(needs.map((f) => MONEY_FIELD_LABEL[f].toLowerCase()))} in ${fileName}. Choose ${needs.length === 1 ? 'it' : 'them'} under “How each column was read”.`
}

/**
 * Checks what came across against the old system's own figures: each file's totals row, and a
 * totals file such as Fresha's liability summary.
 */
function totalChecks(
  files: MovingFile[],
  rows: MoneyRow[],
  byFile: Map<MovingFile, MoneyRow[]>,
  chosenSystem: OldSystem,
): TotalCheck[] {
  const checks: TotalCheck[] = []
  const check = (
    kind: MoneyKind,
    unit: TotalCheck['unit'],
    source: string,
    theirs: number,
    read: MoneyRow[],
  ) => {
    // Credit added to another row of the same client still comes across.
    const coming = (r: MoneyRow) =>
      r.status === 'ready' || (kind === 'credit' && r.status === 'combined')
    const sum = (list: MoneyRow[]) => list.reduce((total, r) => total + (r.left ?? 0), 0)
    const behind = new Map<MoneyRowStatus, MoneyRow[]>()
    for (const r of read) if (!coming(r)) behind.set(r.status, [...(behind.get(r.status) ?? []), r])
    const all = sum(read)
    checks.push({
      kind,
      unit,
      source,
      theirs,
      rows: all,
      coming: sum(read.filter(coming)),
      behind: [...behind.entries()]
        .map(([status, list]) => ({ status, count: list.length, amount: sum(list) }))
        .filter((group) => group.amount !== 0 || group.status === 'problem'),
      agrees: all === theirs && read.every((r) => r.left !== null),
    })
  }
  for (const file of files) {
    if (file.unread || !file.totals.length) continue
    const read = byFile.get(file) ?? []
    if (!read.length) continue
    const kind = read[0].kind
    const field: MoneyField =
      kind === 'packages'
        ? 'visitsLeft'
        : kind === 'credit' && file.moneyMatches.some((m) => m.field === 'credit')
          ? 'credit'
          : 'balance'
    const index = file.moneyMatches.find((m) => m.field === field)?.index
    if (index === undefined) continue
    const cell = file.totals[0].cells[index] ?? ''
    const theirs =
      kind === 'packages'
        ? (() => {
            const n = countFrom(cell)
            return typeof n === 'number' ? n : null
          })()
        : moneyFrom(cell)
    if (theirs === null) continue
    check(
      kind,
      kind === 'packages' ? 'visits' : 'money',
      `the total in ${file.fileName}`,
      theirs,
      read,
    )
  }
  // A totals file, such as Fresha's liability summary: its closing balance for each kind.
  for (const file of files.filter((f) => f.kind === 'totals' && !f.unread)) {
    const type = file.moneyMatches.find((m) => m.field === 'type')?.index
    const balance = file.moneyMatches.find((m) => m.field === 'balance')?.index
    if (type === undefined || balance === undefined) continue
    const system = SYSTEM_NAME[file.system ?? chosenSystem]
    for (const cells of file.rows) {
      const words = (cells[type] ?? '').toLowerCase()
      const kind: MoneyKind | null = /gift|voucher/.test(words)
        ? 'giftCards'
        : /credit|client balance|account/.test(words)
          ? 'credit'
          : null
      const theirs = moneyFrom(cells[balance] ?? '')
      if (!kind || theirs === null || (theirs === 0 && !rows.some((r) => r.kind === kind))) continue
      check(
        kind,
        'money',
        `${system}’s ${file.report ?? 'totals'}`,
        theirs,
        rows.filter((r) => r.kind === kind),
      )
    }
  }
  return checks
}

/** The import commands' rows for one part, with each arriving client's saved id. */
export function moneyRows(
  part: { cards?: PlannedCard[]; packages?: PlannedPackage[]; credit?: PlannedCredit[] },
  state: Pick<BusinessState, 'clients' | 'organisation'>,
) {
  const arrived = arrivedClients(state)
  const idOf = (client: ClientRef) => ('id' in client ? client.id : arrived(client.arriving))
  let lost = 0
  const cards = (part.cards ?? []).map(({ client, ...card }) => {
    const clientId = client ? idOf(client) : undefined
    return { ...card, ...(clientId ? { clientId } : {}) }
  })
  const packages = (part.packages ?? []).flatMap(({ client, ...row }) => {
    const clientId = idOf(client)
    if (!clientId) lost++
    return clientId ? [{ ...row, clientId }] : []
  })
  const credit = (part.credit ?? []).flatMap(({ client, ...row }) => {
    const clientId = idOf(client)
    if (!clientId) lost++
    return clientId ? [{ ...row, clientId }] : []
  })
  return { cards, packages, credit, lost }
}

/** Parts small enough for one request each. */
export function moneyParts<T>(items: T[], size: number) {
  const parts: T[][] = []
  for (let i = 0; i < items.length; i += size) parts.push(items.slice(i, i + size))
  return parts
}
