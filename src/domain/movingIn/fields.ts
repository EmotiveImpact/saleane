/**
 * Moving in, stage 1: what each column in an old system's file means, without the owner renaming
 * anything. A column is matched by its heading (the words studio systems use, collected from
 * Fresha, Phorest, Timely, Treatwell, Booksy and others; see
 * /mnt/project-files/moving-in/export-field-map.md) and then checked against what is inside it,
 * so a column full of email addresses is read as emails whatever its heading says.
 */

export const clientFields = [
  'fullName',
  'firstName',
  'lastName',
  'email',
  'mobile',
  'phone',
  'birthday',
  'postcode',
  'address',
  'notes',
  'tags',
  'emailMarketing',
  'smsMarketing',
  'marketing',
  'blocked',
] as const
export type ClientField = (typeof clientFields)[number]

/** Plain words for each field, for the review screen and the owner's questions. */
export const FIELD_LABEL: Record<ClientField, string> = {
  fullName: 'Full name',
  firstName: 'First name',
  lastName: 'Last name',
  email: 'Email',
  mobile: 'Mobile',
  phone: 'Other phone',
  birthday: 'Birthday',
  postcode: 'Postcode or ZIP',
  address: 'Address',
  notes: 'Notes',
  tags: 'Tags',
  emailMarketing: 'Agreed to email marketing',
  smsMarketing: 'Agreed to text marketing',
  marketing: 'Agreed to marketing',
  blocked: 'Blocked',
}

/** Lower case, no punctuation or spaces: "E-mail Address" and "emailAddress" both become "emailaddress". */
export function headingKey(heading: string) {
  return heading
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/[^a-z0-9#]+/g, '')
}

const SYNONYMS: Record<ClientField, string[]> = {
  fullName: [
    'name',
    'client',
    'customer',
    'clientname',
    'customername',
    'fullname',
    'contact',
    'contactname',
    'guest',
    'guestname',
  ],
  firstName: ['firstname', 'givenname', 'forename', 'first', 'clientfirstname'],
  lastName: ['lastname', 'surname', 'familyname', 'last', 'clientlastname'],
  email: ['email', 'emailaddress', 'clientemail', 'clientemailaddress', 'customeremail', 'mail'],
  mobile: [
    'mobile',
    'mobilenumber',
    'mobilephone',
    'cellphone',
    'cell',
    'smsnumber',
    'phone',
    'phonenumber',
    'telephone',
    'clientphonenumber',
    'contactnumber',
    'mobileno',
  ],
  phone: [
    'landline',
    'homephone',
    'workphone',
    'dayphone',
    'nightphone',
    'day',
    'night',
    'otherphone',
    'businessphone',
    'phone2',
  ],
  birthday: ['birthday', 'birthdate', 'dateofbirth', 'dob', 'bday'],
  postcode: ['postcode', 'postalcode', 'zip', 'zipcode', 'eircode', 'post code'],
  address: ['address', 'fulladdress', 'homeaddress', 'streetaddress', 'address1', 'addressline1'],
  notes: [
    'notes',
    'note',
    'clientnotes',
    'customernotes',
    'memo',
    'comments',
    'alert',
    'alerts',
    'staffalert',
    'clientalert',
  ],
  tags: ['tags', 'tag', 'clienttags', 'labels', 'category', 'clientcategory', 'groups'],
  emailMarketing: [
    'acceptsmarketing',
    'acceptsemailmarketing',
    'emailmarketing',
    'emailmarketingconsent',
    'emailsubscriptionstatus',
    'emailoptin',
    'emailoptinstatus',
    'clientemailoptinstatus',
    'emailmarketingstatus',
    'emailnewsletter',
    'subscribedtoemail',
  ],
  smsMarketing: [
    'acceptssmsmarketing',
    'smsmarketing',
    'smsmarketingconsent',
    'textmarketing',
    'smsoptin',
    'textoptin',
    'clienttextoptinstatus',
    'smsoptinstatus',
  ],
  marketing: ['marketing', 'marketingconsent', 'optin', 'optedin', 'marketingoptin', 'newsletter'],
  blocked: ['banned', 'blocked', 'blacklisted', 'isblocked', 'blockedclient'],
}

/** Headings that are never a client field even when they look close (counts, totals, money). */
const NOT_A_CLIENT_FIELD = /^(total|count|number of|appointments booked|visits|amount|points)/i

/** Exact heading matches first, then near ones ("Client mobile number" contains "mobile number"). */
export function fieldFromHeading(heading: string): ClientField | null {
  const key = headingKey(heading)
  if (!key || NOT_A_CLIENT_FIELD.test(heading.trim())) return null
  for (const field of clientFields) if (SYNONYMS[field].includes(key)) return field
  // Near matches, most specific first so "email marketing" is not read as "email".
  const order: ClientField[] = [
    'smsMarketing',
    'emailMarketing',
    'marketing',
    'birthday',
    'firstName',
    'lastName',
    'postcode',
    'email',
    'mobile',
    'phone',
    'notes',
    'tags',
    'blocked',
  ]
  for (const field of order)
    if (SYNONYMS[field].some((word) => word.length >= 5 && key.includes(word))) return field
  return null
}

// ---------------------------------------------------------------------------------------------
// What a column holds, judged from its values.

export type ValueKind = 'email' | 'phone' | 'date' | 'yesno' | 'money' | 'number' | 'text' | 'empty'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PHONE = /^\+?[\d\s().-]{7,20}$/
const YES = new Set([
  'yes',
  'y',
  'true',
  '1',
  'subscribed',
  'opted in',
  'optedin',
  'opt in',
  'agreed',
  'accepted',
  'on',
])
const NO = new Set([
  'no',
  'n',
  'false',
  '0',
  'unsubscribed',
  'not subscribed',
  'opted out',
  'optedout',
  'opt out',
  'off',
  'unknown',
  'declined',
  'never subscribed',
])

/** A clear yes, a clear no, or null when the cell says nothing usable. */
export function yesNo(value: string): boolean | null {
  const v = value.trim().toLowerCase()
  if (YES.has(v)) return true
  if (NO.has(v)) return false
  return null
}

export function valueKind(value: string): ValueKind {
  const v = value.trim()
  if (!v) return 'empty'
  if (EMAIL.test(v)) return 'email'
  if (yesNo(v) !== null && !/^\d$/.test(v)) return 'yesno'
  if (/^[£$€]\s?-?[\d,]+(\.\d{1,2})?$|^-?[\d,]+\.\d{2}$/.test(v)) return 'money'
  if (looksLikeDate(v)) return 'date'
  const digits = v.replace(/\D/g, '')
  if (PHONE.test(v) && digits.length >= 9 && digits.length <= 15 && !/^\d{1,8}$/.test(v))
    return 'phone'
  if (/^-?\d+(\.\d+)?$/.test(v)) return 'number'
  return 'text'
}

const MONTHS = 'jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec'
function looksLikeDate(v: string) {
  return (
    /^\d{4}-\d{1,2}-\d{1,2}([ T]\d{1,2}:\d{2}.*)?$/.test(v) ||
    /^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}([ ,]+\d{1,2}:\d{2}.*)?$/.test(v) ||
    new RegExp(`^\\d{1,2}(st|nd|rd|th)? (${MONTHS})[a-z]* \\d{2,4}`, 'i').test(v) ||
    new RegExp(`^(${MONTHS})[a-z]* \\d{1,2}(st|nd|rd|th)?,? \\d{2,4}`, 'i').test(v) ||
    new RegExp(`^\\d{1,2}(st|nd|rd|th)? (${MONTHS})[a-z]*$`, 'i').test(v)
  )
}

/** The kind most of a column's filled cells share, and how sure that is (0 to 1). */
export function columnKind(values: string[]): { kind: ValueKind; share: number } {
  const filled = values.filter((v) => v.trim())
  if (!filled.length) return { kind: 'empty', share: 1 }
  const counts = new Map<ValueKind, number>()
  for (const v of filled.slice(0, 500)) {
    const kind = valueKind(v)
    counts.set(kind, (counts.get(kind) ?? 0) + 1)
  }
  let best: ValueKind = 'text'
  let n = 0
  for (const [kind, count] of counts)
    if (count > n) {
      best = kind
      n = count
    }
  return { kind: best, share: n / Math.min(filled.length, 500) }
}

/** What each field's values should look like. Text fields accept anything. */
const EXPECTED: Partial<Record<ClientField, ValueKind[]>> = {
  email: ['email'],
  mobile: ['phone'],
  phone: ['phone'],
  birthday: ['date'],
  emailMarketing: ['yesno'],
  smsMarketing: ['yesno'],
  marketing: ['yesno'],
  blocked: ['yesno'],
}

export type ColumnMatch = {
  index: number
  heading: string
  field: ClientField | null
  /** high: heading and contents agree. low: one of them is unsure, so the owner is asked. */
  confidence: 'high' | 'low'
  /** Why a column was left out, in plain words, when it was. */
  leftOut?: string
}

/**
 * Matches every column. `known` is a layout already recognised for this system and file (headings
 * to fields), which is trusted over guessing. Each field is used once; a second column claiming
 * the same field is left out unless it is a phone, which falls back to "other phone".
 */
export function matchColumns(
  headings: string[],
  rows: string[][],
  known: Record<string, ClientField | null> = {},
): ColumnMatch[] {
  const used = new Set<ClientField>()
  const matches: ColumnMatch[] = headings.map((heading, index) => {
    const values = rows.map((row) => row[index] ?? '')
    const { kind, share } = columnKind(values)
    const fromLayout = known[headingKey(heading)]
    if (fromLayout !== undefined)
      return {
        index,
        heading,
        field: fromLayout,
        confidence: 'high' as const,
        ...(fromLayout ? {} : { leftOut: leftOutReason(heading, kind) }),
      }
    const byName = fieldFromHeading(heading)
    if (kind === 'empty')
      return {
        index,
        heading,
        field: byName,
        confidence: 'high' as const,
        ...(byName ? {} : { leftOut: 'Empty in this file.' }),
      }
    if (byName) {
      const expected = EXPECTED[byName]
      if (!expected) {
        // "Contact" could be a name or a number; a column of phone numbers or emails is asked about.
        const byValues = fieldFromValues(kind, share)
        if (byValues) return { index, heading, field: byValues, confidence: 'low' as const }
        return { index, heading, field: byName, confidence: 'high' as const }
      }
      if (expected.includes(kind) && share >= 0.6)
        return { index, heading, field: byName, confidence: 'high' as const }
      // The heading says one thing and the contents another: trust the contents when they are clear.
      const byValues = fieldFromValues(kind, share)
      if (byValues && byValues !== byName)
        return { index, heading, field: byValues, confidence: 'low' as const }
      return { index, heading, field: byName, confidence: 'low' as const }
    }
    const byValues = fieldFromValues(kind, share)
    if (byValues) return { index, heading, field: byValues, confidence: 'low' as const }
    return {
      index,
      heading,
      field: null,
      confidence: 'high' as const,
      leftOut: leftOutReason(heading, kind),
    }
  })
  // One column per field: keep the surest, then the first.
  const sorted = [...matches].sort(
    (a, b) =>
      Number(b.confidence === 'high') - Number(a.confidence === 'high') || a.index - b.index,
  )
  for (const match of sorted) {
    if (!match.field) continue
    if (!used.has(match.field)) {
      used.add(match.field)
      continue
    }
    if (match.field === 'mobile' && !used.has('phone')) {
      match.field = 'phone'
      used.add('phone')
      continue
    }
    match.leftOut = `Another column already gives the ${FIELD_LABEL[match.field].toLowerCase()}.`
    match.field = null
  }
  return matches
}

function fieldFromValues(kind: ValueKind, share: number): ClientField | null {
  if (share < 0.8) return null
  if (kind === 'email') return 'email'
  if (kind === 'phone') return 'mobile'
  return null
}

function leftOutReason(heading: string, kind: ValueKind) {
  const words = heading.replace(/([a-z])([A-Z])/g, '$1 $2')
  if (/card/i.test(words) && !/gift/i.test(words))
    return 'Card details never move across. Clients save their card again through a link.'
  if (/\bid\b|reference|ref\.?$/i.test(words)) return 'The old system’s own reference. Not needed.'
  if (/membership|package|course/i.test(words))
    return 'Memberships and packages come across in a later step.'
  if (/since|added|created|creation/i.test(words))
    return 'SALEANE keeps its own history from the day they arrive.'
  if (kind === 'money' || /total|spend|sales|paid|amount/i.test(words))
    return 'Money totals are worked out again from visits and payments.'
  if (/visit|booked|appointment|last seen|no.?show|check.?in|employees? seen/i.test(words))
    return 'Visit counts are worked out again from visits.'
  if (/gender|sex|pronoun/i.test(words)) return 'SALEANE does not keep this.'
  return 'SALEANE has no place for this yet.'
}

/**
 * The heading row: the first of the opening rows that reads most like headings (several cells,
 * known words, no email addresses). Title rows such as "Client list, 1 Jan to 31 Dec" are skipped.
 */
export function findHeadingRow(rows: string[][]) {
  let best = 0
  let bestScore = -Infinity
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const row = rows[i]
    const filled = row.filter((cell) => cell.trim())
    if (filled.length < 2) continue
    const known = filled.filter((cell) => fieldFromHeading(cell)).length
    const dataLike = filled.filter((cell) => {
      const kind = valueKind(cell)
      return kind === 'email' || kind === 'phone' || kind === 'money' || kind === 'date'
    }).length
    const score = known * 3 + filled.length - dataLike * 4
    if (score > bestScore) {
      best = i
      bestScore = score
    }
  }
  return best
}

/** Rows that are totals or section titles in a report, not people. */
export function isSummaryRow(row: string[]) {
  const filled = row.filter((cell) => cell.trim())
  if (!filled.length) return true
  return /^(grand )?totals?\b|^(sub ?total|count|summary|report generated|page \d)/i.test(
    filled[0].trim(),
  )
}
