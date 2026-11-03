import { headingKey } from './fields'
import type { ClientField } from './fields'
import type { MoneyField } from './moneyFields'
import type { VisitField } from './visitFields'

/**
 * Moving in: the old systems SALEANE knows, and how to tell which system and which of its
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

/**
 * What a file holds. Clients (stage 1), upcoming visits (stage 2), and gift cards, packages and
 * credit (stage 3) come across; a totals file is read only to check against. The others are
 * recognised and named, not saved.
 */
export type FileKind =
  | 'clients'
  | 'visits'
  | 'giftCards'
  | 'packages'
  | 'credit'
  | 'totals'
  | 'memberships'
  | 'payments'
  | 'unknown'

export const KIND_LABEL: Record<FileKind, string> = {
  clients: 'client list',
  visits: 'visits',
  giftCards: 'gift cards and vouchers',
  packages: 'packages and courses',
  credit: 'client credit',
  totals: 'totals of money held for clients',
  memberships: 'memberships',
  payments: 'payments and sales',
  unknown: 'something SALEANE does not recognise yet',
}

/** The kinds that come across in the money step. */
export const MONEY_KINDS: readonly FileKind[] = ['giftCards', 'packages', 'credit', 'totals']

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

/**
 * Where to find the upcoming visits. Only what research confirmed is stated as a route; where a
 * system has no download of its own, the owner is told to ask its support team.
 */
export const WHERE_TO_EXPORT_VISITS: Record<OldSystem, string> = {
  fresha:
    'In Fresha, open Reports and choose Appointments list. Set the dates from today to your furthest booking, then download it as CSV or Excel.',
  phorest:
    'Phorest’s upcoming appointments report prints as a PDF, so ask Phorest’s support team for your future appointments as a spreadsheet.',
  timely:
    'In Timely, open Reports and choose Appointment schedule. Set the dates from today onwards, then export it as CSV or Excel.',
  treatwell:
    'Ask Treatwell’s support team for your upcoming appointments as a spreadsheet, with each client’s name, email or mobile.',
  booksy:
    'Booksy sends your appointments when you ask their support team. In the UK, email info.gb@booksy.com and ask for your upcoming appointments as a spreadsheet.',
  square:
    'Square can download your appointments, past and upcoming, as a CSV file. Add it as it comes; past visits are counted and left behind for now.',
  vagaro:
    'In Vagaro, open Reports, Appointments Summary, and export each booking status you keep, such as Confirmed and Accepted, to Excel. Add every file.',
  glossgenius:
    'GlossGenius has no appointments download, so ask their support team for your upcoming appointments as a spreadsheet.',
  other:
    'Download your upcoming visits (often called appointments or bookings) as a CSV or Excel file, from today onwards. Any layout is fine.',
}

/**
 * Where to find gift cards, packages and client credit. As with visits, only routes research
 * confirmed are given; otherwise the owner is told which report to ask for.
 */
export const WHERE_TO_EXPORT_MONEY: Record<OldSystem, string> = {
  fresha:
    'In Fresha, open Reports and download your gift cards list, with each code and what is left on it, as CSV or Excel. Add the liability summary too, so SALEANE can check its total against Fresha’s.',
  phorest:
    'In Phorest, open Reports and export Vouchers Outstanding. Client courses and client credit print as PDFs, so ask Phorest’s support team for them as spreadsheets.',
  timely:
    'In Timely, open Reports and export Customer gift voucher details, Customer package details and Customer credit details, each as CSV or Excel.',
  treatwell:
    'Gift cards bought on Treatwell belong to Treatwell, so they stay there. Add any gift cards or packages you sold yourself as a spreadsheet.',
  booksy:
    'Ask Booksy’s support team for your gift cards, packages and client credit as spreadsheets. In the UK, email info.gb@booksy.com.',
  square:
    'In Square, download your gift cards list. Square shares only the last four digits of each card, so each one gets a new SALEANE code for the desk to give the guest.',
  vagaro:
    'In Vagaro, open Reports and export Packages (choose All Packages) and your gift cards report to Excel.',
  glossgenius:
    'Ask GlossGenius’s support team for your gift cards and packages as a spreadsheet, with what is left on each.',
  other:
    'Download your gift cards, packages and client credit as CSV or Excel files, with what is left on each. Any layout is fine.',
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
  /** The same for a visits file. */
  visitFields?: Record<string, VisitField | null>
  /** The same for a gift card, package, credit or totals file. */
  moneyFields?: Record<string, MoneyField | null>
  /** Why a recognised file is not read, in the owner's words. */
  unread?: string
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
    visitFields: {
      [k('Appt. ref.')]: 'reference',
      [k('Client')]: 'client',
      [k('Team member')]: 'professional',
      [k('Status')]: 'status',
      [k('Created date')]: null,
      [k('Scheduled date')]: 'date',
      [k('Cancelled date')]: null,
      [k('Category')]: null,
      [k('Service')]: 'treatment',
      [k('Duration (mins)')]: 'duration',
      [k('Appt. slot')]: 'time',
      [k('Created by')]: null,
      [k('Cancelled by')]: null,
      [k('Location')]: null,
      [k('Net sales')]: 'price',
      [k('Cancellation reason')]: null,
      [k('Fees charged')]: null,
      [k('Upfront payments')]: 'deposit',
      [k('Resource')]: null,
    },
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
    kind: 'totals',
    report: 'liability summary',
    needs: ['Liability type', 'Closing balance'],
    moneyFields: {
      [k('Liability type')]: 'type',
      [k('Closing balance')]: 'balance',
      [k('Opening balance')]: null,
      [k('Collections')]: null,
      [k('Redemptions')]: null,
      [k('Expirations')]: null,
      [k('Refunds')]: null,
      [k('Net change')]: null,
    },
  },
  {
    system: 'fresha',
    kind: 'giftCards',
    report: 'liability activity',
    needs: ['Liability type', 'Activity', 'Sale number'],
    unread:
      'This lists each time money was added or spent, not what is left on each card. Add Fresha’s gift cards list for the cards, and its liability summary for the total.',
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
    moneyFields: {
      [k('Serial Number')]: 'code',
      [k('Client')]: 'client',
      [k('Branch Sold')]: null,
      [k('Remaining')]: 'balance',
      [k('Issue Date')]: 'issued',
      [k('Expiry Date')]: 'expiry',
    },
  },
  {
    system: 'phorest',
    kind: 'packages',
    report: 'client courses',
    needs: ['Course Description', 'Remaining'],
    // "Total" and "Remaining" count visits; the "Gross" columns are money.
    moneyFields: {
      [k('Client Name')]: 'client',
      [k('Course Description')]: 'name',
      [k('Purchase Date')]: 'issued',
      [k('Total')]: 'visitsTotal',
      [k('Total Gross')]: 'value',
      [k('Remaining')]: 'visitsLeft',
      [k('Remaining Gross')]: 'balance',
    },
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
    // The code cell also holds the last day: "GV58214 (expires 31/03/2027)".
    moneyFields: {
      [k('Customer')]: 'client',
      [k('Gift Voucher')]: 'name',
      [k('Recipient')]: 'recipient',
      [k('Status')]: 'status',
      [k('Code')]: 'code',
      [k('Amount')]: 'value',
      [k('Redeemed')]: 'redeemed',
      [k('Outstanding')]: 'balance',
    },
  },
  {
    system: 'timely',
    kind: 'credit',
    report: 'customer credit details',
    needs: ['Reason', 'Redeemed', 'Outstanding'],
    moneyFields: {
      [k('Customer')]: 'client',
      [k('Reason')]: 'note',
      [k('Status')]: 'status',
      [k('Expiry')]: 'expiry',
      [k('Amount')]: 'value',
      [k('Redeemed')]: 'redeemed',
      [k('Outstanding')]: 'balance',
    },
  },
  {
    system: 'timely',
    kind: 'packages',
    report: 'customer package details',
    needs: ['Package', 'Visits available'],
    moneyFields: {
      [k('Customer')]: 'client',
      [k('Package')]: 'name',
      [k('Status')]: 'status',
      [k('Expiry')]: 'expiry',
      [k('Payment')]: 'value',
      [k('Visits available')]: 'visitsLeft',
      [k('Visits redeemed')]: 'visitsUsed',
    },
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
    moneyFields: {
      [k('PAN Suffix')]: 'codeEnd',
      [k('Current outstanding Amount')]: 'balance',
    },
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
    visitFields: {
      [k('Customer Name')]: 'client',
      [k('Appointment Date')]: 'date',
      [k('Status')]: 'status',
      [k('Service Name')]: 'treatment',
      [k('Employee')]: 'professional',
      [k('Amount')]: 'price',
    },
  },
  {
    system: 'vagaro',
    kind: 'packages',
    report: 'packages',
    needs: ['# of Visits Remaining'],
    moneyFields: {
      [k('Purchase Date')]: 'issued',
      [k('Customer')]: 'client',
      [k('Initial Amount')]: 'value',
      [k('Current Amount')]: 'balance',
      [k('# of Visits Remaining')]: 'visitsLeft',
      [k('Expiration Date')]: 'expiry',
      [k('Status')]: 'status',
    },
  },
  {
    system: 'vagaro',
    kind: 'memberships',
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
  visitFields: Record<string, VisitField | null>
  moneyFields: Record<string, MoneyField | null>
  unread: string | null
}

/** Which system and report a file's headings come from, when SALEANE knows the layout. */
export function recogniseLayout(headings: string[]): Recognised | null {
  const keys = new Set(headings.map(headingKey))
  let best: Layout | null = null
  for (const layout of LAYOUTS)
    if (layout.needs.every((need) => keys.has(headingKey(need))))
      if (!best || layout.needs.length > best.needs.length) best = layout
  return best
    ? {
        system: best.system,
        kind: best.kind,
        report: best.report,
        fields: best.fields ?? {},
        visitFields: best.visitFields ?? {},
        moneyFields: best.moneyFields ?? {},
        unread: best.unread ?? null,
      }
    : null
}

/** A file SALEANE has no layout for, judged from its columns. */
export function guessKind(headings: string[], hasClientColumns: boolean): FileKind {
  const text = headings.map((h) => h.toLowerCase()).join(' | ')
  if (/liabilit/.test(text) && /closing balance/.test(text)) return 'totals'
  if (/voucher|gift ?card|liabilit|pan suffix/.test(text)) return 'giftCards'
  if (/course|package|(sessions?|visits|treatments) (left|remaining|available)/.test(text))
    return 'packages'
  if (/membership/.test(text)) return 'memberships'
  if (/payment method|transaction|sale number|receipt/.test(text)) return 'payments'
  // A client list may carry each client's credit; a file of credit alone has no email or phone.
  if (!hasClientColumns && /credit|account balance|outstanding balance|owed|debt/.test(text))
    return 'credit'
  if (
    /(service|treatment)/.test(text) &&
    /(date|time|start|scheduled)/.test(text) &&
    /(staff|team|employee|professional|stylist|therapist)/.test(text)
  )
    return 'visits'
  return hasClientColumns ? 'clients' : 'unknown'
}
