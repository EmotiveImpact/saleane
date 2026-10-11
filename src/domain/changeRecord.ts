import type { Command } from './commandSchema'
import type { BusinessState } from './model'
import { roleNames, type Role } from './operations'
import { socialLabel } from './inboxSchema'
import { METHOD_WORDS } from './accounts'
import { csvRows } from './csv'
import { dateLabel, fullDateLabel, money, timeLabel } from './format'
import { rotaChangeDetail } from './rota'
import { giftMoveDetail } from './giftCards'
import { staffMoveDetail } from './staffMoves'
import { timeOffChangeDetail } from './timeOff'
import { signOffChangeDetail } from './signoffs'
import { tillLabel } from './otherTill'
import type { OtherTillSale } from './otherTillSchema'
import { defaultQuietOffers } from './quietOffersSchema'
import { retentionDecision, retentionKinds } from './retentionDue'
import type { RetentionKind } from './retentionSchema'
import { ASK_NAME } from '../assistant/name'

/**
 * NEXT-05: who changed what. Every saved change is already written to the studio's audit log
 * with who made it and when. This turns those entries into plain words for the owner, and works
 * out at the moment of saving which details of the record changed.
 *
 * What the record keeps: the names of the details that changed, and the before and after values
 * of numbers, money, times, dates, yes-or-no settings and links between records (which
 * professional, which treatment). It never keeps wording people typed, contact details, notes or
 * anything else about a client beyond which details changed, so it never becomes a second copy of
 * client records.
 */

export const changeGroups = {
  visits: 'Visits',
  clients: 'Clients',
  money: 'Money',
  team: 'Team and pay',
  stock: 'Stock',
  messages: 'Messages',
  settings: 'Settings',
  access: 'Sign-in and access',
} as const
export type ChangeGroup = keyof typeof changeGroups

/** The kind of change, what was done, and what was done when it made a new record. */
type Words = readonly [ChangeGroup, string, string?]

/** Every change the team makes through the app. A new command fails to compile until it has words. */
const commandWords: Record<Command['type'], Words> = {
  book: ['visits', 'Booked a visit'],
  'book-repeat': ['visits', 'Booked repeat visits'],
  'book-together': ['visits', 'Booked visits for several people'],
  reschedule: ['visits', 'Moved a visit'],
  cancel: ['visits', 'Cancelled a visit'],
  'no-show': ['visits', 'Marked a visit as a no-show'],
  arrive: ['visits', 'Marked a guest as arrived'],
  checkout: ['money', 'Took payment for a visit'],
  note: ['clients', 'Added a note to a client'],
  'counter-sale': ['money', 'Sold products without a visit'],
  client: ['clients', 'Added a client'],
  consent: ['clients', 'Changed whether a client gets email news'],
  'consent-wording': ['settings', 'Changed the email news wording'],
  'guest-consent-stop': ['clients', 'Stopped email news from their visit link'],
  'consultation-save': ['clients', 'Changed a consultation', 'Saved a consultation'],
  'reply-received': ['messages', 'A message came in'],
  'social-answer': ['messages', 'Answered on Instagram, Facebook or WhatsApp'],
  'reply-note': ['messages', 'Wrote down a conversation with a client'],
  'replies-read': ['messages', 'Marked messages as read'],
  'reply-link': ['messages', 'Linked a message to a client'],
  'saved-reply-save': ['messages', 'Changed a saved reply', 'Added a saved reply'],
  'saved-reply-remove': ['messages', 'Removed a saved reply'],
  'till-count': ['money', 'Counted the till'],
  feedback: ['clients', 'Left feedback after their visit'],
  'waitlist-add': ['visits', 'Added someone to the waitlist'],
  'waitlist-remove': ['visits', 'Took someone off the waitlist'],
  'waitlist-offer': ['visits', 'Offered a waitlist time'],
  'opening-invite': ['messages', 'Wrote invitations to a cancelled time'],
  'waitlist-join': ['visits', 'Joined the waitlist'],
  'waitlist-leave': ['visits', 'Left the waitlist'],
  'form-save': ['settings', 'Changed a guest form', 'Added a guest form'],
  'form-archive': ['settings', 'Archived or brought back a guest form'],
  'form-submit': ['clients', 'Filled in a guest form'],
  'guest-here': ['visits', 'Said they had arrived'],
  'missed-call': ['messages', 'Wrote down a missed call'],
  'missed-call-done': ['messages', 'Marked a missed call as called back'],
  'call-answered': ['messages', 'Answered a call'],
  'answered-call-done': ['messages', 'Marked an answered call as followed up'],
  offer: ['settings', 'Changed a package or membership', 'Added a package or membership'],
  'plan-sell': ['money', 'Sold a package or membership'],
  'plan-renew': ['money', 'Renewed a package or membership'],
  'plan-cancel': ['money', 'Cancelled a package or membership'],
  'plan-card': [
    'money',
    'Changed card payments for a membership',
    'Set up card payments for a membership',
  ],
  'plan-card-try': ['money', 'Noted a declined card payment for a membership'],
  batch: ['visits', `Approved several changes from ${ASK_NAME}`],
  'special-plan': ['settings', 'Planned a special'],
  'task-add': ['team', 'Left a reminder for the team'],
  'task-done': ['team', 'Ticked off a team reminder'],
  'special-stop': ['settings', 'Stopped a special'],
  'gift-card-sell': ['money', 'Sold a gift card'],
  'gift-card-extend': ['money', 'Extended a gift card'],
  'gift-card-cancel': ['money', 'Cancelled a gift card'],
  'gift-card-move': ['money', 'Moved a gift card to another location'],
  'patch-test': ['clients', 'Recorded a patch test'],
  'patch-test-result': ['clients', 'Recorded a patch test result'],
  'patch-test-settings': ['settings', 'Changed the patch test rules'],
  'group-checks': ['settings', 'Changed the automatic checks'],
  region: ['settings', 'Changed a region', 'Added a region'],
  'region-remove': ['settings', 'Removed a region'],
  targets: ['settings', 'Changed the monthly targets'],
  'checklist-save': ['team', 'Changed a branch visit checklist', 'Added a branch visit checklist'],
  'checklist-archive': ['team', 'Archived or brought back a branch visit checklist'],
  'branch-visit': ['team', 'Recorded a branch visit'],
  'branch-visit-fix': ['team', 'Marked a branch visit point as put right'],
  'request-raise': ['team', 'Sent a request up for sign-off'],
  'request-decide': ['team', 'Answered a request'],
  'approval-limit': ['settings', 'Changed the sign-off limit'],
  'signoff-rules': ['settings', 'Changed the sign-off rules'],
  'request-start': ['settings', 'Started a new price that was signed off'],
  'studio-look': ['settings', 'Changed the studio’s look'],
  'till-settings': ['settings', 'Changed how receipts print'],
  'house-rules': ['settings', 'Changed the house rules'],
  'benchmark-sharing': ['settings', 'Changed sharing for How you compare'],
  organisation: ['settings', 'Changed the studio details'],
  hours: ['settings', 'Changed the opening hours'],
  location: ['settings', 'Changed a location', 'Added a location'],
  'location-open': ['settings', 'Added a location', 'Added a location with its rooms and team'],
  'setup-step': ['settings', 'Saved a screen of setting up the studio'],
  'guest-notes': ['settings', 'Changed the notes for guests'],
  closure: ['visits', 'Closed time in the diary'],
  'remove-closure': ['visits', 'Opened closed time again'],
  service: ['settings', 'Changed a treatment', 'Added a treatment'],
  staff: ['team', 'Changed a team member', 'Added a team member'],
  resource: ['settings', 'Changed a room or chair', 'Added a room or chair'],
  message: ['messages', 'Wrote a message to a guest'],
  'message-queue': ['messages', 'Approved a message for sending'],
  receptionist: ['settings', 'Changed the AI receptionist'],
  'ai-voice': ['settings', 'Changed how the AI speaks for the studio'],
  'own-voice': ['settings', `Chose their own voice for ${ASK_NAME}`],
  'visit-write-up': ['clients', 'Wrote up a visit'],
  'google-booking': ['settings', 'Changed Book with Google'],
  'ai-booking': ['settings', 'Changed booking through ChatGPT or Claude'],
  reminders: ['settings', 'Changed confirmations and reminders'],
  'contact-preferences': ['clients', 'Changed how a client is contacted'],
  refund: ['money', 'Recorded a refund'],
  deposit: ['money', 'Took a deposit'],
  fee: ['money', 'Charged a no-show or late cancellation fee'],
  protection: ['settings', 'Changed the deposit and cancellation rules'],
  tax: ['settings', 'Changed tax'],
  product: ['stock', 'Changed a product', 'Added a product'],
  'time-off': ['team', 'Booked time off'],
  rental: ['team', 'Set up a chair rental'],
  supplier: ['stock', 'Changed a supplier', 'Added a supplier'],
  'purchase-order': ['stock', 'Ordered from a supplier'],
  'receive-order': ['stock', 'Received a delivery'],
  'cancel-order': ['stock', 'Cancelled a supplier order'],
  'accounting-settings': ['settings', 'Changed the accounting settings'],
  'accounting-export': ['money', 'Made an accounting export'],
  'end-rental': ['team', 'Ended a chair rental'],
  'rent-payment': ['money', 'Recorded rent paid'],
  'cancel-time-off': ['team', 'Cancelled time off'],
  'time-off-change': ['team', 'Changed time off'],
  'clock-in': ['team', 'Clocked in'],
  'clock-out': ['team', 'Clocked out'],
  'shift-save': ['team', 'Changed hours worked', 'Added hours worked'],
  'shift-remove': ['team', 'Removed hours worked'],
  'leave-allowance': ['team', 'Changed a holiday allowance'],
  'rota-day': ['team', 'Changed a day on the rota'],
  'rota-day-usual': ['team', 'Put a day on the rota back to usual hours'],
  'rota-week-copy': ['team', 'Copied last week’s rota changes'],
  'rota-week-clear': ['team', 'Cleared a week’s rota changes'],
  'staff-move': ['team', 'Moved someone to another location'],
  'staff-move-cancel': ['team', 'Cancelled a move to another location'],
  'pay-rules': ['team', 'Changed the pay rules'],
  'pay-rate': ['team', 'Changed a pay rate'],
  'commission-rate': ['team', 'Changed a commission rate for a treatment or product'],
  'commission-steps': ['team', 'Changed commission steps by takings'],
  'staff-target': ['team', 'Changed a monthly target'],
  stock: ['stock', 'Changed a stock count'],
  'stock-move': ['stock', 'Moved stock between locations'],
  'client-birthday': ['clients', 'Changed a client’s birthday'],
  'client-area': ['clients', 'Changed a client’s area'],
  'client-edit': ['clients', 'Changed a client’s details'],
  'import-services': ['settings', 'Brought in treatments from another system'],
  'import-appointments': ['visits', 'Brought in visits from another system'],
  'import-balances': ['money', 'Brought in balances from another system'],
  'import-gift-cards': ['money', 'Brought in gift cards from another system'],
  'import-packages': ['money', 'Brought in packages from another system'],
  'balance-settle': ['money', 'Settled a brought-in balance'],
  'import-clients': ['clients', 'Brought in clients from another system'],
  // Stage 4: one message from the studio to its clients.
  'news-save': ['messages', 'Changed a message to clients', 'Wrote a message to clients'],
  'news-approve': ['messages', 'Approved a message to clients'],
  'news-stop': ['messages', 'Stopped a message to clients'],
  'news-discard': ['messages', 'Put aside a message to clients'],
  'news-unsubscribe': ['clients', 'Stopped news from the link in a message'],
  // Stage 5: a chain's own till, sending in through its access key.
  'other-till-sale': ['money', 'Recorded a sale from another till'],
  'other-till-refund': ['money', 'Recorded money given back on another till'],
  // Stage 5: a lower price for a quiet time.
  'quiet-offers': ['settings', 'Changed the lower price for quiet times'],
  'offer-invite': ['messages', 'Wrote an invitation to a quiet time at a lower price'],
  // Stage 6: records at the end of their keeping period.
  'retention-delete': ['clients', 'Approved deleting records at the end of their keeping period'],
  'retention-keep': ['clients', 'Kept records past the end of their keeping period'],
  // Stage 6: asking everyone in the studio to use two-step sign-in.
  'two-step-rule': ['access', 'Changed whether everyone must use two-step sign-in'],
}

/** Changes the server makes or records itself. */
const serverWords: Record<string, Words> = {
  'workspace.created': ['settings', 'Created the studio'],
  'workspace.restored': ['settings', 'Restored the studio from a backup'],
  'invitation.created': ['access', 'Invited someone to sign in'],
  'invitation.accepted': ['access', 'Accepted an invitation and joined'],
  'membership.changed': ['access', 'Changed someone’s access'],
  'guest_link.created': ['visits', 'Made a new visit link for a guest'],
  'guest_link.revoked': ['visits', 'Turned off a guest’s visit link'],
  'api-key.created': ['access', 'Made a partner access key'],
  'api-key.revoked': ['access', 'Turned off a partner access key'],
  'diary-link.made': ['access', 'Made a diary link for Google or Apple Calendar'],
  'diary-link.stopped': ['access', 'Stopped a diary link'],
  'connection.created': ['settings', 'Connected software'],
  'connection.paused-all': ['settings', 'Paused all connected software'],
  'connection.changed': ['settings', 'Changed connected software'],
  'connection.secret-renewed': ['settings', 'Renewed a connection’s secret'],
  'connection.removed': ['settings', 'Removed connected software'],
  'social.added': ['settings', 'Added a social account'],
  'social.confirmed': ['settings', 'Confirmed a social account'],
  'social.disconnected': ['settings', 'Disconnected a social account'],
  'payment.deposit.started': ['money', 'Started a card payment for a deposit'],
  'payment.balance.started': ['money', 'Started a card payment for a visit'],
  'payment.fee.started': ['money', 'Started a card payment for a fee'],
  'payment.save_card.started': ['money', 'Started saving a card'],
  'payment.refund.started': ['money', 'Started a card refund'],
  'payment.deposit': ['money', 'Recorded a card payment for a deposit'],
  'payment.balance': ['money', 'Recorded a card payment for a visit'],
  'payment.fee': ['money', 'Recorded a card payment for a fee'],
  'payment.save_card': ['money', 'Recorded a saved card'],
  'payment.refund': ['money', 'Recorded a card refund'],
  'card.removed': ['money', 'Removed a saved card'],
  'membership.card-payment': ['money', 'Took a membership payment from a saved card'],
  'membership.card-payment.unclear': ['money', 'Checked an unclear membership card payment'],
  'membership.card-refund.started': ['money', 'Started a refund to the card for a membership'],
  'membership.card-refund': ['money', 'Refunded a membership to the card and ended it'],
  'membership.cards-resumed': ['money', 'Turned membership card payments back on after a restore'],
  'assistant.proposed': ['settings', `Asked ${ASK_NAME} to suggest a change`],
  'assistant.approved': ['settings', `Approved a change ${ASK_NAME} suggested`],
  'assistant.declined': ['settings', `Turned down a change ${ASK_NAME} suggested`],
  'assistant.talked': ['settings', `Talked to ${ASK_NAME}`],
  'outbox.retry': ['messages', 'Tried sending a message again'],
  'client.exported': ['clients', 'Downloaded a copy of a client’s data'],
  'client.erasure_requested': ['clients', 'Recorded a request to erase a client'],
  'studio.exported': ['settings', 'Exported the whole studio'],
  'public.book': ['visits', 'Booked online'],
  'guest.feedback': ['clients', 'Left feedback after their visit'],
  'guest.form': ['clients', 'Filled in a guest form'],
  'guest.email-news': ['clients', 'Changed whether they get email news'],
  'guest.news-stop': ['clients', 'Stopped news from the link in a message'],
  'guest.here': ['visits', 'Said they had arrived'],
  'guest.waitlist': ['visits', 'Changed their waitlist request'],
  'guest.cancel': ['visits', 'Cancelled their visit'],
  'guest.move': ['visits', 'Moved their visit'],
  'google.book': ['visits', 'Booked through Book with Google'],
  'google.cancel': ['visits', 'Cancelled through Book with Google'],
  // Stage 5: a guest moving their Google booking to a new time.
  'google.move': ['visits', 'Moved through Book with Google'],
  // Stage 5: a guest booking through an AI assistant, named when it said which.
  'ai-booking.chatgpt': ['visits', 'Booked through ChatGPT'],
  'ai-booking.claude': ['visits', 'Booked through Claude'],
  'ai-booking.assistant': ['visits', 'Booked through an AI assistant'],
  'phone.missed-call': ['messages', 'Wrote down a missed call'],
  'phone.answered': ['messages', 'Answered a call'],
  'inbox.reply': ['messages', 'A message came in'],
  'inbox.test-text': ['messages', 'Delivered a test text to the studio’s line'],
  'receptionist.message': ['messages', 'Passed on a message from the AI receptionist'],
  // NEXT-02: the studio's own SALEANE plan.
  'billing.card': ['settings', 'Saved a card for the SALEANE plan'],
  'billing.plus': ['settings', 'Changed Plus on the SALEANE plan'],
  'billing.stop': ['settings', 'Asked to stop the SALEANE plan at the end of the month'],
  'billing.keep': ['settings', 'Kept the SALEANE plan going'],
  'billing.paid': ['settings', 'Paid a SALEANE bill'],
  'billing.test-paid': ['settings', 'Settled a test SALEANE bill. No money moved'],
  'billing.failed': ['settings', 'A SALEANE bill could not be taken'],
  'billing.read-only': ['settings', 'The studio became read only until it is paid'],
  'billing.locked': ['settings', 'The studio locked until its SALEANE bill is paid'],
  'billing.checked': [
    'settings',
    'Checked the SALEANE payments with the card service after a restore',
  ],
  'till.drawer': ['money', 'Opened the cash drawer without a sale'],
  'receipt.emailed': ['messages', 'Emailed a receipt'],
}

export const changeWords: Readonly<Record<string, Words>> = { ...commandWords, ...serverWords }

/** Every action of one kind, for finding them in the log. */
export function actionsIn(group: ChangeGroup) {
  return Object.entries(changeWords)
    .filter(([, words]) => words[0] === group)
    .map(([action]) => action)
}

/**
 * Who made a change nobody signed in made, from where it came in. A card payment started at the
 * desk keeps the person who started it.
 */
export function automaticSource(action: string) {
  if (action === 'workspace.restored') return 'A backup on this computer'
  if (action === 'public.book') return 'A guest booking online'
  if (action === 'guest.news-stop') return 'A client, from the link in a message to clients'
  if (action.startsWith('guest.')) return 'A guest, from their visit link'
  if (action.startsWith('google.')) return 'A guest, through Google'
  if (action === 'ai-booking.chatgpt') return 'A guest, through ChatGPT'
  if (action === 'ai-booking.claude') return 'A guest, through Claude'
  if (action === 'ai-booking.assistant') return 'A guest, through an AI assistant'
  if (action.startsWith('payment.')) return 'A guest paying by card'
  if (action === 'phone.missed-call') return 'The studio phone line'
  if (action === 'phone.answered') return 'The AI receptionist, on the phone'
  if (action === 'inbox.reply') return 'A guest’s message'
  if (action === 'receptionist.message') return 'The AI receptionist'
  return 'SALEANE'
}

/** One detail of a record that changed. `from` and `to` are kept only when safe to keep. */
export type ChangedField = { f: string; from?: Value; to?: Value }
type Value = string | number | boolean | null
export type ChangeDetail = { made?: 'added' | 'removed'; fields?: ChangedField[] }

const MAX_FIELDS = 12
/** Bookkeeping that changes with every save and says nothing to the owner. */
const ignored = new Set(['id', 'organisationId', 'actor', 'version', 'revision'])
const bookkeeping = (field: string) => ignored.has(field) || /(At|By)$/.test(field)
/**
 * Records about a person, whose values are never kept: only which details changed. Visits keep
 * their times, treatment and professional, since moving a visit is the change.
 */
const personal = new Set([
  'clients',
  'consultations',
  'consentRecords',
  'formResponses',
  'feedback',
  'patchTests',
  'replies',
  'socialAnswers',
  'events',
  'relationships',
  'waitlist',
  'messages',
  'missedCalls',
  'answeredCalls',
  'tasks',
])
/** Short words from a fixed list, safe to keep. Anything else typed in is never kept. */
const listed = new Set([
  'status',
  'category',
  'resourceType',
  'type',
  'kind',
  'method',
  'tone',
  // Stage 4: how a request was answered, and which rota changes need a sign-off.
  'outcome',
  'rotaSignOff',
  // Stage 5: whether quiet times carry a lower price, and of which kind.
  'discount',
])
const named = new Set(['name', 'title', 'label'])
const civilDate = /^\d{4}-\d{2}-\d{2}$/

/** The value of a detail, if it may be kept; otherwise undefined. */
function keepable(collection: string, field: string, value: unknown): Value | undefined {
  if (personal.has(collection)) return undefined
  // A photo's id means nothing to the owner; the record says the photo changed.
  if (field === 'imageId') return undefined
  if (value === null || value === undefined) return null
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value !== 'string') return undefined
  if (/Id$/.test(field) || listed.has(field) || civilDate.test(value)) return value.slice(0, 100)
  if (named.has(field)) return value.slice(0, 100)
  return undefined
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

type Hit = { collection: string; record: Record<string, unknown> }

/** Every record with an id in the studio, with the list it is kept in. */
function* records(s: BusinessState): Generator<Hit> {
  yield { collection: 'organisation', record: s.organisation }
  const lists = (owner: Record<string, unknown>) =>
    Object.entries(owner).filter((entry): entry is [string, unknown[]] => Array.isArray(entry[1]))
  for (const [collection, items] of [
    ...lists(s as unknown as Record<string, unknown>),
    ...lists((s.operations ?? {}) as Record<string, unknown>),
  ])
    for (const item of items)
      if (isRecord(item) && typeof item.id === 'string') yield { collection, record: item }
}
function find(s: BusinessState, id: string) {
  for (const hit of records(s)) if (hit.record.id === id) return hit
  return undefined
}

/** Settings a command changes, kept on the studio rather than as a record of their own. */
const settingsOf: Partial<Record<string, (s: BusinessState) => unknown>> = {
  organisation: (s) => s.organisation,
  tax: (s) => s.operations?.tax,
  reminders: (s) => s.operations?.reminders,
  protection: (s) => s.operations?.protection,
  receptionist: (s) => s.operations?.receptionist,
  'ai-voice': (s) => s.operations?.aiVoice,
  'google-booking': (s) => s.operations?.googleBooking,
  'ai-booking': (s) => s.operations?.aiBooking,
  'patch-test-settings': (s) => s.operations?.patchTests,
  'accounting-settings': (s) => s.operations?.accounting,
  'approval-limit': (s) => s.operations?.approvals,
  'signoff-rules': (s) => s.operations?.approvals,
  'studio-look': (s) => s.operations?.look,
  'till-settings': (s) => s.operations?.till,
  'house-rules': (s) => s.operations?.houseRules,
  'benchmark-sharing': (s) => s.operations?.benchmark,
  'group-checks': (s) => s.operations?.groupChecks,
  // Stage 5: the first change reads against the setting as it stood, off.
  'quiet-offers': (s) => s.operations?.quietOffers ?? defaultQuietOffers,
  // Stage 6: the first change reads against the setting as it stood, off.
  'two-step-rule': (s) => s.operations?.twoStep ?? { forEveryone: false },
}

function compare(
  collection: string,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
) {
  const fields: ChangedField[] = []
  for (const f of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (bookkeeping(f) || same(before[f], after[f])) continue
    const from = keepable(collection, f, before[f]),
      to = keepable(collection, f, after[f])
    fields.push(from === undefined || to === undefined ? { f } : { f, from, to })
  }
  return fields
}

/** A day's opening hours as one value, such as "540-1080", or "closed". */
type Day = { day: number; closed: boolean; open: number; close: number }
const dayValue = (h: Day | undefined) => (!h ? null : h.closed ? 'closed' : `${h.open}-${h.close}`)
function compareHours(before: Day[], after: Day[]) {
  return [1, 2, 3, 4, 5, 6, 0]
    .map((day) => ({
      f: `day${day}`,
      from: dayValue(before.find((h) => h.day === day)),
      to: dayValue(after.find((h) => h.day === day)),
    }))
    .filter((change) => change.from !== change.to)
}

/** New money records keep their amounts, so the record says what was taken or given back. */
function amounts(collection: string, record: Record<string, unknown>) {
  if (personal.has(collection)) return []
  return Object.entries(record)
    .filter(([f, v]) => (/Minor$/.test(f) && typeof v === 'number' && v > 0) || f === 'method')
    .map(([f, v]) => ({ f, to: keepable(collection, f, v) }))
    .filter((change): change is { f: string; to: Value } => change.to !== undefined)
}

/**
 * What changed in the record a saved change was about, worked out from the studio before and
 * after. Returns nothing when there is nothing useful to add to the words for the action.
 */
export function changeDetail(
  before: BusinessState,
  after: BusinessState,
  action: string,
  recordId: string,
): ChangeDetail | undefined {
  // Stage 6: a decision about records at the end of their period keeps which kind, how many and
  // until when. Never what was deleted: no names, no record ids and no content.
  if (action === 'retention-delete' || action === 'retention-keep') {
    const decision = retentionDecision(after, recordId)
    if (!decision) return undefined
    return {
      fields: [
        { f: 'records', to: decision.kind },
        { f: 'count', to: decision.count },
        ...(decision.until ? [{ f: 'keptUntil', to: decision.until }] : []),
      ],
    }
  }
  // Stage 3: a day on the rota keeps which day it was and its hours before and after.
  const rota = rotaChangeDetail(before, after, action, recordId)
  if (rota) return rota
  // Stage 4: a gift card or someone moving keeps where from and where to.
  const moved = giftMoveDetail(after, action, recordId) ?? staffMoveDetail(after, action, recordId)
  if (moved) return moved
  // Stage 4: changed time off keeps its days and kind before and after.
  const away = timeOffChangeDetail(before, after, action, recordId)
  if (away) return away
  // Stage 4: an approved new price or rota change keeps what it changed, before and after.
  const signOff = signOffChangeDetail(before, after, action, recordId)
  if (signOff) return signOff
  let fields: ChangedField[] = []
  let made: ChangeDetail['made']
  const settings = settingsOf[action]
  if (action === 'hours')
    fields = compareHours(
      (before.operations?.hours ?? []) as Day[],
      (after.operations?.hours ?? []) as Day[],
    )
  else if (settings) {
    const a = settings(before),
      b = settings(after)
    if (isRecord(b)) fields = compare('settings', isRecord(a) ? a : {}, b)
  } else {
    const a = find(before, recordId),
      b = find(after, recordId)
    if (!a && b) {
      made = 'added'
      fields = amounts(b.collection, b.record)
    } else if (a && !b) made = 'removed'
    else if (a && b) fields = compare(b.collection, a.record, b.record)
  }
  if (!made && !fields.length) return undefined
  return {
    ...(made ? { made } : {}),
    ...(fields.length ? { fields: fields.slice(0, MAX_FIELDS) } : {}),
  }
}

/** Read back a stored detail, ignoring anything that does not look like one. */
export function readDetail(text: string | null): ChangeDetail | undefined {
  if (!text) return undefined
  try {
    const value: unknown = JSON.parse(text)
    if (!isRecord(value)) return undefined
    const fields = Array.isArray(value.fields)
      ? value.fields.filter((f): f is ChangedField => isRecord(f) && typeof f.f === 'string')
      : undefined
    const made = value.made === 'added' || value.made === 'removed' ? value.made : undefined
    return { ...(made ? { made } : {}), ...(fields ? { fields } : {}) }
  } catch {
    return undefined
  }
}

const fieldWords: Record<string, string> = {
  name: 'name',
  title: 'name',
  label: 'name',
  email: 'email',
  phone: 'phone',
  preferences: 'preferences',
  marketingConsent: 'email news',
  noEmailReminders: 'no visit emails',
  noTextReminders: 'no visit texts',
  birthday: 'birthday',
  description: 'description',
  enabled: 'switched on',
  category: 'kind of treatment',
  durationMinutes: 'length',
  bufferMinutes: 'time after each visit',
  priceMinor: 'price',
  depositMinor: 'deposit',
  resourceType: 'room or chair',
  archived: 'archived',
  prepNote: 'preparation note',
  aftercareNote: 'aftercare note',
  patchTest: 'needs a patch test',
  stopOnline: 'stop online booking without a patch test',
  testServiceId: 'patch test guests book',
  locationPrices: 'prices at other locations',
  notOfferedAt: 'locations that do not offer it',
  role: 'job title',
  serviceIds: 'treatments they do',
  tone: 'diary colour',
  hours: 'working hours',
  restMinutes: 'resting time',
  locationId: 'location',
  clientId: 'client',
  serviceId: 'treatment',
  staffId: 'professional',
  resourceId: 'room or chair',
  date: 'date',
  startMinutes: 'time',
  status: 'status',
  locationName: 'main location name',
  address: 'address',
  timeZone: 'time zone',
  arrivalNote: 'arrival note',
  reviewUrl: 'review link',
  rateBps: 'rate',
  inclusive: 'prices include tax',
  serviceMinor: 'treatments',
  discountMinor: 'discount',
  taxMinor: 'tax',
  tipMinor: 'tip',
  depositAppliedMinor: 'deposit used',
  totalMinor: 'total',
  balanceMinor: 'left to pay',
  amountMinor: 'amount',
  refundMinor: 'refunded',
  method: 'paid by',
  printers: 'receipt printer',
  taxNumber: 'VAT number or tax ID',
  access: 'access',
  barcode: 'barcode',
  imageId: 'photo',
  day1: 'Monday',
  day2: 'Tuesday',
  day3: 'Wednesday',
  day4: 'Thursday',
  day5: 'Friday',
  day6: 'Saturday',
  day0: 'Sunday',
  shift: 'hours that day',
  weekOf: 'week of',
  daysChanged: 'days changed',
  visitsKept: 'booked visits kept outside the hours',
  // Stage 4: booked visits kept at a location someone moved away from.
  visitsKeptAway: 'booked visits kept where they no longer work',
  daysMoved: 'days of the week moved',
  timeOffKind: 'kind of time off',
  outcome: 'answer',
  newPriceMinor: 'new price',
  startsOn: 'starts on',
  notStarted: 'could not start',
  regionalLimitMinor: 'what a regional manager may approve',
  generalRefundLimitMinor: 'what a general manager may give back',
  managerRefundLimitMinor: 'what a manager may give back',
  rotaSignOff: 'rota changes needing a sign-off',
  subject: 'subject',
  body: 'words',
  by: 'how it goes',
  locationIds: 'locations',
  bookLink: 'booking link',
  toEmail: 'clients by email',
  toText: 'clients by text',
  leftOut: 'clients left out',
  discount: 'lower price for quiet times',
  offPercent: 'percentage off',
  offMinor: 'amount off',
  floorMinor: 'never below',
  openHours: 'how long an offer stays open',
  leftOutIds: 'treatments left out',
  records: 'records',
  count: 'how many',
  keptUntil: 'kept until',
  forEveryone: 'two-step sign-in for everyone',
}
/** A detail's name in words: "cutoffHours" reads "cutoff hours". */
export function fieldName(field: string) {
  return (
    fieldWords[field] ??
    field
      .replace(/(Minor|Bps|Id|Ids)$/, '')
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .toLowerCase()
  )
}

const statusWords: Record<string, string> = {
  confirmed: 'booked',
  arrived: 'arrived',
  completed: 'completed',
  cancelled: 'cancelled',
  no_show: 'no-show',
}

/** A name for every record with an id, made once for a page of the change record. */
export type RecordNames = (id: string) => string | undefined
export function recordNames(s: BusinessState): RecordNames {
  const byId = new Map<string, Hit>()
  for (const hit of records(s)) byId.set(hit.record.id as string, hit)
  const locale = s.organisation.locale
  const text = (record: Record<string, unknown>, field: string) =>
    typeof record[field] === 'string' ? (record[field] as string) : undefined
  const visit = (id: unknown, depth = 0): string | undefined => {
    const hit = typeof id === 'string' ? byId.get(id) : undefined
    if (!hit || hit.collection !== 'appointments') return undefined
    const a = hit.record as {
      clientId: string
      serviceId: string
      date: string
      startMinutes: number
    }
    const who = name(a.clientId, depth + 1) ?? 'A client'
    const what = name(a.serviceId, depth + 1)
    return `${who}${what ? `, ${what}` : ''}, ${dateLabel(a.date, locale, true)} at ${timeLabel(a.startMinutes, locale)}`
  }
  const name = (id: string, depth = 0): string | undefined => {
    // The main location is the studio's own, kept on the organisation rather than as a record.
    if (id === s.organisation.locationId) return s.organisation.locationName
    const hit = byId.get(id)
    // Links only ever lead a few steps (a refund, its receipt, the visit), never round in a circle.
    if (!hit || depth > 3) return undefined
    const r = hit.record
    if (hit.collection === 'appointments') return visit(id, depth)
    if (hit.collection === 'organisation') return text(r, 'name')
    if (hit.collection === 'giftCards' && typeof r.valueMinor === 'number')
      return `${money(r.valueMinor, s.organisation)} gift card`
    // Stage 4: a message to clients is named by its subject, which the owner wrote for them all.
    if (hit.collection === 'news') return text(r, 'subject')
    // Stage 5: a sale from another till is named by its receipt and the till that sent it.
    if (hit.collection === 'otherTillSales') return tillLabel(r as unknown as OtherTillSale)
    const own = text(r, 'name') ?? text(r, 'title') ?? text(r, 'label')
    if (own && !['consentRecords', 'formResponses'].includes(hit.collection)) return own
    // Otherwise named after what it belongs to: a refund after its receipt, a payment its visit.
    for (const link of ['appointmentId', 'saleId', 'paymentId', 'counterSaleId', 'clientId'])
      if (typeof r[link] === 'string' && r[link] !== id) {
        const linked =
          link === 'appointmentId' ? visit(r[link], depth + 1) : name(r[link] as string, depth + 1)
        if (linked) return linked
      }
    for (const link of ['staffId', 'productId', 'offerId', 'serviceId'])
      if (typeof r[link] === 'string') return name(r[link] as string, depth + 1)
    return undefined
  }
  return (id) => name(id) ?? socialLabel[id as keyof typeof socialLabel]
}

/** A value in words, in the studio's money, language and clock. */
function valueText(s: BusinessState, names: RecordNames, f: string, v: Value) {
  const locale = s.organisation.locale
  if (v === null) return 'none'
  if ((/^day\d$/.test(f) || f === 'shift') && typeof v === 'string') {
    if (v === 'closed') return 'closed'
    if (v === 'off') return 'not working'
    if (v === 'usual') return 'their usual hours'
    const [open, close] = v.split('-').map(Number)
    const clock = (m: number) => (m >= 1440 ? 'midnight' : timeLabel(m, locale))
    return `${clock(open)} to ${clock(close)}`
  }
  if (typeof v === 'boolean') return v ? 'yes' : 'no'
  if (typeof v === 'number') {
    if (/Minor$/.test(f)) return money(v, s.organisation, true)
    if (/Bps$/.test(f)) return `${v / 100}%`
    if (/Percent$/.test(f)) return `${v}%`
    if (f === 'startMinutes') return timeLabel(v, locale)
    if (/Minutes$/.test(f)) return `${v} ${v === 1 ? 'minute' : 'minutes'}`
    if (/Hours$/.test(f)) return `${v} ${v === 1 ? 'hour' : 'hours'}`
    if (/Days$/.test(f)) return `${v} ${v === 1 ? 'day' : 'days'}`
    return new Intl.NumberFormat(locale).format(v)
  }
  if (f === 'access') return v === 'remove' ? 'removed' : (roleNames[v as Role] ?? v)
  if (f === 'status') return statusWords[v] ?? v
  if (f === 'discount')
    return v === 'none' ? 'no lower price' : v === 'percent' ? 'a percentage off' : 'an amount off'
  if (f === 'records' && v in retentionKinds)
    return retentionKinds[v as RetentionKind].label.toLowerCase()
  if (f === 'rotaSignOff') return v === 'extra' ? 'extra days' : v === 'all' ? 'every change' : v
  if (f === 'method') return METHOD_WORDS[v] ?? v.replace(/_/g, ' ')
  if (/Id$/.test(f)) return names(v) ?? 'one no longer listed'
  if (civilDate.test(v)) return fullDateLabel(v, locale)
  return v.replace(/_/g, ' ')
}

export type ChangeLine = { what: string; from?: string; to?: string }
/** One entry of the change record as the owner reads it. */
export type ChangeEntry = {
  id: string
  at: number
  who: string
  /** A person signed in to the studio made it, rather than a guest or something automatic. */
  person: boolean
  group: ChangeGroup
  what: string
  about?: string
  /** Details whose before and after are kept, then the names of the rest. */
  lines: ChangeLine[]
  others: string[]
}
export type ChangeRow = {
  id: string
  action: string
  recordId: string
  occurredAt: number
  actor: string | null
  /** The name of the account a change was about, for changes to someone's access. */
  account: string | null
  detail: string | null
  /** Stage 5: the access key whose software made the change, when one did. */
  keyName?: string | null
}

export function describeChange(s: BusinessState, names: RecordNames, row: ChangeRow): ChangeEntry {
  const words = changeWords[row.action]
  const detail = readDetail(row.detail)
  const lines: ChangeLine[] = [],
    others: string[] = []
  for (const field of detail?.fields ?? []) {
    const what = fieldName(field.f)
    if ('to' in field && 'from' in field) {
      // A switch never set before was off, so its first change reads "no became yes".
      const off = (v: Value | undefined, other: Value | undefined) =>
        (v ?? null) === null && typeof other === 'boolean' ? false : (v ?? null)
      lines.push({
        what,
        from: valueText(s, names, field.f, off(field.from, field.to)),
        to: valueText(s, names, field.f, off(field.to, field.from)),
      })
    } else if ('to' in field)
      lines.push({ what, to: valueText(s, names, field.f, field.to ?? null) })
    else if (!others.includes(what)) others.push(what)
  }
  const about =
    row.account ??
    (row.action === 'workspace.created' || row.action === 'studio.exported'
      ? s.organisation.name
      : names(row.recordId))
  return {
    id: row.id,
    at: row.occurredAt,
    who: row.keyName
      ? `${row.keyName}, through its access key`
      : (row.actor ?? automaticSource(row.action)),
    person: !row.keyName && row.actor !== null,
    group: words?.[0] ?? 'settings',
    what: (detail?.made === 'added' ? words?.[2] : undefined) ?? words?.[1] ?? 'Made a change',
    ...(about ? { about } : {}),
    lines,
    others,
  }
}

/** A change's details in one line of words, for a spreadsheet or a screen reader. */
export function changeSummary(entry: Pick<ChangeEntry, 'lines' | 'others'>) {
  const parts = entry.lines.map((line) =>
    line.from === undefined
      ? `${capital(line.what)}: ${line.to}`
      : `${capital(line.what)} ${line.from} became ${line.to}`,
  )
  if (entry.others.length)
    parts.push(`${parts.length ? 'Also changed' : 'Changed'} ${list(entry.others)}`)
  return parts.join('. ')
}
export const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)
export function list(items: string[]) {
  return items.length < 2
    ? (items[0] ?? '')
    : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

/** The change record as a spreadsheet, in the studio's own time. */
export function changeCsv(s: BusinessState, entries: ChangeEntry[]) {
  const { timeZone } = s.organisation
  const when = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
  return csvRows([
    ['When', 'Who', 'Kind', 'What', 'About', 'Details'],
    ...entries.map((e) => [
      when.format(new Date(e.at)).replace(',', ''),
      e.who,
      changeGroups[e.group],
      e.what,
      e.about ?? '',
      changeSummary(e),
    ]),
  ])
}
