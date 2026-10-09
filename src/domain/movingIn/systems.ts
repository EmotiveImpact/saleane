import { headingKey } from './fields'
import type { ClientField } from './fields'

/**
 * Moving in, stage 1: the old systems SALEANE knows, and how to tell which system and which of its
 * reports a file came from. Only layouts confirmed from a real export or an official column list
 * are written as layouts; everything else is read by meaning (fields.ts). Sources for each are in
 * /mnt/project-files/moving-in/export-field-map.md.
 */

export const oldSystems = [
  'fresha',
  'phorest',
  'timely',
  'treatwell',
  'booksy',
  'square',
  'vagaro',
  'glossgenius',
  'other',
] as const
export type OldSystem = (typeof oldSystems)[number]

export const SYSTEM_NAME: Record<OldSystem, string> = {
  fresha: 'Fresha',
  phorest: 'Phorest',
  timely: 'Timely',
  treatwell: 'Treatwell',
  booksy: 'Booksy',
  square: 'Square',
  vagaro: 'Vagaro',
  glossgenius: 'GlossGenius',
  other: 'another system',
}

/** The five most UK studios come from, offered first. */
export const UK_FIRST: OldSystem[] = ['fresha', 'phorest', 'timely', 'treatwell', 'booksy']

/** What a file holds. Stage 1 brings clients across; the others are recognised and named, not saved. */
export type FileKind = 'clients' | 'visits' | 'giftCards' | 'packages' | 'payments' | 'unknown'

export const KIND_LABEL: Record<FileKind, string> = {
  clients: 'client list',
  visits: 'visits',
  giftCards: 'gift cards and vouchers',
  packages: 'packages, courses or memberships',
  payments: 'payments and sales',
  unknown: 'something SALEANE does not recognise yet',
}

/** Where to find each list in the old system, in the owner's words. */
export const WHERE_TO_EXPORT: Record<OldSystem, string> = {
  fresha:
    'In Fresha, go to Clients, open Options and choose CSV or Excel. Your client list includes notes and marketing choices.',
  phorest:
    'In Phorest, go to Manager, Business, CSV Export and choose the clients export. It is usually ready within 15 minutes.',
  timely:
    'In Timely, open Reports, choose Client overview, view the report and export it as CSV or Excel.',
  treatwell:
    'In Treatwell Connect on a computer, open your clients and choose to export your client list.',
  booksy:
    'Booksy sends your client list when you ask their support team. In the UK, email info.gb@booksy.com and ask for your full client list as a spreadsheet.',
  square:
    'In Square, go to Customers, Directory, Import or export, then Export customers and choose all customers.',
  vagaro:
    'In Vagaro, open Reports, Customers, set Service Providers to all, run the Customer List and export it to Excel.',
  glossgenius: 'In GlossGenius on a computer, go to Clients and choose Export.',
  other: 'Download your client list as a CSV or Excel file. Any layout is fine.',
}

type Layout = {
  system: OldSystem
  kind: FileKind
  /** A plain name for the report, shown to the owner. */
  report: string
  /** Every one of these headings must be present. */
  needs: string[]
  /** Headings known in this layout, and what each means for a client. Null means not needed. */
  fields?: Record<string, ClientField | null>
}

const k = headingKey

const LAYOUTS: Layout[] = [
  // Fresha. Appointments list headings confirmed from a working importer; the client list is
  // confirmed to carry both marketing columns.
  {
    system: 'fresha',
    kind: 'visits',
    report: 'appointments list',
    needs: ['Appt. ref.', 'Appt. slot', 'Team member'],
  },
  {
    system: 'fresha',
    kind: 'clients',
    report: 'client list',
    needs: ['Accepts marketing', 'Accepts SMS marketing'],
    fields: {
      [k('Accepts marketing')]: 'emailMarketing',
      [k('Accepts SMS marketing')]: 'smsMarketing',
      [k('Mobile number')]: 'mobile',
      [k('Telephone')]: 'phone',
      [k('Added on')]: null,
      [k('Referral source')]: null,
      [k('Gender')]: null,
    },
  },
  {
    system: 'fresha',
    kind: 'giftCards',
    report: 'liability report',
    needs: ['Liability type', 'Closing balance'],
  },
  {
    system: 'fresha',
    kind: 'giftCards',
    report: 'liability activity',
    needs: ['Liability type', 'Activity', 'Sale number'],
  },
  {
    system: 'fresha',
    kind: 'payments',
    report: 'payment transactions',
    needs: ['Payment number', 'Sale number', 'Payment method'],
  },
  // Phorest report labels and API names (likely, not confirmed from a downloaded file).
  {
    system: 'phorest',
    kind: 'giftCards',
    report: 'vouchers outstanding',
    needs: ['Serial Number', 'Remaining', 'Issue Date'],
  },
  {
    system: 'phorest',
    kind: 'packages',
    report: 'client courses',
    needs: ['Course Description', 'Remaining'],
  },
  {
    system: 'phorest',
    kind: 'clients',
    report: 'client export',
    needs: ['smsMarketingConsent', 'emailMarketingConsent'],
    fields: {
      [k('landLine')]: 'phone',
      [k('clientSince')]: null,
      [k('firstVisit')]: null,
      [k('lastVisit')]: null,
      [k('gender')]: null,
      [k('clientId')]: null,
    },
  },
  // Timely report labels (likely).
  {
    system: 'timely',
    kind: 'giftCards',
    report: 'customer gift voucher details',
    needs: ['Gift Voucher', 'Recipient', 'Outstanding'],
  },
  {
    system: 'timely',
    kind: 'giftCards',
    report: 'customer credit details',
    needs: ['Reason', 'Redeemed', 'Outstanding'],
  },
  {
    system: 'timely',
    kind: 'clients',
    report: 'customer list',
    needs: ['isVIP'],
    fields: { [k('isVIP')]: null, [k('CompanyName')]: null, [k('SMS Number')]: 'mobile' },
  },
  // Square (confirmed column names).
  {
    system: 'square',
    kind: 'clients',
    report: 'customer directory',
    needs: ['Square Customer ID'],
    fields: {
      [k('Square Customer ID')]: null,
      [k('Email Subscription Status')]: 'emailMarketing',
      [k('Reference Number')]: null,
      [k('Creation Source')]: null,
      [k('Memo')]: 'notes',
    },
  },
  {
    system: 'square',
    kind: 'giftCards',
    report: 'gift cards',
    needs: ['PAN Suffix'],
  },
  // Vagaro (confirmed official column lists).
  {
    system: 'vagaro',
    kind: 'clients',
    report: 'customer list',
    needs: ['Employees Seen', 'Customer Since'],
    fields: {
      [k('Name')]: 'fullName',
      [k('Mobile')]: 'mobile',
      [k('Cell Phone')]: 'mobile',
      [k('Day')]: 'phone',
      [k('Day Phone')]: 'phone',
      [k('Night')]: null,
      [k('Night Phone')]: null,
      [k('Birthdate')]: 'birthday',
      [k('Credit Card')]: null,
      [k('Membership')]: null,
      [k('Referred By')]: null,
      [k('Online Booking')]: null,
      [k('Customer Since')]: null,
      [k('Last Visited')]: null,
      [k('Employees Seen')]: null,
      [k('Gender')]: null,
    },
  },
  {
    system: 'vagaro',
    kind: 'visits',
    report: 'appointments summary',
    needs: ['Customer Name', 'Appointment Date', 'Service Name', 'Employee'],
  },
  {
    system: 'vagaro',
    kind: 'packages',
    report: 'packages',
    needs: ['# of Visits Remaining'],
  },
  {
    system: 'vagaro',
    kind: 'packages',
    report: 'memberships',
    needs: ['Membership Card ID'],
  },
  // GlossGenius (confirmed: exactly these five).
  {
    system: 'glossgenius',
    kind: 'clients',
    report: 'client export',
    needs: ['Name', 'Email', 'Phone', 'Date of Birth', 'Banned'],
    fields: { [k('Banned')]: 'blocked', [k('Date of Birth')]: 'birthday' },
  },
]

export type Recognised = {
  system: OldSystem | null
  kind: FileKind
  report: string | null
  fields: Record<string, ClientField | null>
}

/** Which system and report a file's headings come from, when SALEANE knows the layout. */
export function recogniseLayout(headings: string[]): Recognised | null {
  const keys = new Set(headings.map(headingKey))
  let best: Layout | null = null
  for (const layout of LAYOUTS)
    if (layout.needs.every((need) => keys.has(headingKey(need))))
      if (!best || layout.needs.length > best.needs.length) best = layout
  return best
    ? { system: best.system, kind: best.kind, report: best.report, fields: best.fields ?? {} }
    : null
}

/** A file SALEANE has no layout for, judged from its columns. */
export function guessKind(headings: string[], hasClientColumns: boolean): FileKind {
  const text = headings.map((h) => h.toLowerCase()).join(' | ')
  if (/voucher|gift ?card|liabilit/.test(text)) return 'giftCards'
  if (/course|package|membership|sessions? (left|remaining)|visits remaining/.test(text))
    return 'packages'
  if (/payment method|transaction|sale number|receipt/.test(text)) return 'payments'
  if (
    /(service|treatment)/.test(text) &&
    /(date|time|start|scheduled)/.test(text) &&
    /(staff|team|employee|professional|stylist|therapist)/.test(text)
  )
    return 'visits'
  return hasClientColumns ? 'clients' : 'unknown'
}
