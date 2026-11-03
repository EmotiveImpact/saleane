import type { BusinessState } from './model'
import type { MessageKind, OutboxStatus } from './reminders'
import type { ReminderSettings } from './reminderSettings'
import { venueDate } from './tillCount'
import { consentRecords } from './consent'
import { instantIn } from './operations'

/**
 * NEXT-14: Marketing, its own section beside the Inbox. Campaigns are the messages to clients
 * (Stage 4); automatic messages are the emails SALEANE writes for the studio when they fall due.
 * Results count only what SALEANE itself records: what each sender accepted, what was not sent
 * and why, who used the link to stop, and who booked afterwards. Nothing tracks opens or clicks.
 */

/** The emails that go by themselves once switched on, in the order the studio meets them. */
export const automaticKinds = ['aftercare', 'due_back', 'birthday', 'miss_you'] as const
export type AutomaticKind = (typeof automaticKinds)[number]
export const automaticSetting: Record<
  AutomaticKind,
  'aftercare' | 'dueBack' | 'birthday' | 'missYou'
> = {
  aftercare: 'aftercare',
  due_back: 'dueBack',
  birthday: 'birthday',
  miss_you: 'missYou',
}
export const automaticLabel: Record<AutomaticKind, string> = {
  aftercare: 'Aftercare',
  due_back: 'Due back',
  birthday: 'Birthday',
  miss_you: 'We miss you',
}
/** When each one goes and to whom, in a sentence. */
export const automaticWhen: Record<AutomaticKind, string> = {
  aftercare:
    'After checkout, the treatment’s aftercare advice, when the treatment has some. It goes to every guest: it is about their visit, not news.',
  due_back:
    'When a guest is about due for their next visit, going by the treatment, and nothing is booked. Only guests who agreed to hear from you.',
  birthday:
    'On a guest’s birthday, when they shared the day and month. Only guests who agreed to hear from you.',
  miss_you:
    'Once, after a long gap without a visit and nothing booked. Only guests who agreed to hear from you.',
}
export const isAutomaticOn = (settings: ReminderSettings, kind: AutomaticKind) =>
  settings[automaticSetting[kind]] !== false

/**
 * The emails that count towards a location's marketing emails each month (src/domain/pricing.ts):
 * campaigns and the automatic emails sent because a guest agreed to hear from the studio.
 * Aftercare is about a visit, like confirmations and reminders, and never counts.
 */
export const countedKinds = ['news', 'due_back', 'birthday', 'miss_you'] as const
/**
 * The statuses that use one up: handed to the sender (or interrupted while it was), and a
 * campaign's copies still waiting, which its approval set aside. A copy in test mode, not sent or
 * failed uses nothing. An automatic email still waiting takes what is left when it goes.
 */
export const usedStatuses = ['accepted', 'delivered', 'unknown'] as const

/** The first moment of the studio's current month, on its own clock, in milliseconds. */
export function monthStartIn(timeZone: string, now: number) {
  const first = `${venueDate(timeZone, new Date(now).toISOString()).slice(0, 8)}01`
  try {
    return Date.parse(instantIn(timeZone, first, 0))
  } catch {
    // A few places once moved their clocks at midnight; the month then begins an hour in.
    return Date.parse(instantIn(timeZone, first, 60))
  }
}

/** "1,640 of 2,000 left this month", in plain words. */
export function emailsLeftWords(used: number, limit: number) {
  const n = (value: number) => value.toLocaleString('en-GB')
  if (limit <= 0) return 'Marketing emails are paused while the studio’s plan is stopped.'
  if (used >= limit) return `All ${n(limit)} marketing emails for this month are used.`
  return `${n(limit - used)} of ${n(limit)} marketing emails left this month.`
}

/** How long after a message a booking counts towards it. */
export const BOOKED_WITHIN_DAYS = 14
const DAY = 86400000

/** One copy of a message in the outbox, as the server keeps it. */
export type SentCopy = {
  kind: MessageKind
  slot: string
  clientId: string
  status: OutboxStatus
  /** When it was written down, and when its state last changed, in milliseconds. */
  createdAt: number
  updatedAt: number
}
/** A stop link that was used, for the campaign it came in. */
export type UsedStopLink = { messageId: string; usedAt: number }

/** What happened to one campaign's or one automatic message's copies. */
export type Tally = {
  /** Accepted by the sender, or confirmed delivered. Never more than the sender said. */
  sent: number
  /** Written in test mode: nothing left SALEANE. */
  test: number
  /** Refused by the sender, or not sent because something changed first. */
  notSent: number
  /** Still to go, or waiting for the sender to say. */
  waiting: number
  /** Guests who used the link in it to stop hearing from the studio. Campaigns only. */
  stopped: number
  /** Guests it reached who booked a visit within two weeks of it. */
  booked: number
}
export type CampaignResult = Tally & { id: string }
export type AutomaticResult = Tally & { kind: AutomaticKind; lastThirtyDays: number }
export type MonthResult = {
  /** "2026-10", on the studio's own calendar. */
  month: string
  campaigns: (Tally & { id: string })[]
  automatic: (Tally & { kind: AutomaticKind })[]
  /** Guests who stopped hearing from the studio that month, however they asked. */
  stoppedAll: number
}
export type MarketingResults = {
  campaigns: CampaignResult[]
  /** Owners and managers only: a general manager sees their location's campaigns. */
  automatic?: AutomaticResult[]
  months: MonthResult[]
}

const empty = (): Tally => ({ sent: 0, test: 0, notSent: 0, waiting: 0, stopped: 0, booked: 0 })
const isAutomatic = (kind: string): kind is AutomaticKind =>
  (automaticKinds as readonly string[]).includes(kind)
const campaignOf = (slot: string) => (slot.startsWith('news:') ? slot.slice(5) : null)

function add(tally: Tally, copy: SentCopy) {
  if (copy.status === 'accepted' || copy.status === 'delivered') tally.sent += 1
  else if (copy.status === 'test') tally.test += 1
  else if (copy.status === 'failed' || copy.status === 'skipped') tally.notSent += 1
  else tally.waiting += 1
}

/**
 * Who booked after hearing from the studio: for each guest a copy reached, whether a visit was
 * booked for them in the two weeks after it went. Imported visits are history, not bookings, and
 * are left out. Each guest counts once for each message, however many visits they booked.
 */
function bookedAfter(s: BusinessState) {
  const booked = new Map<string, number[]>()
  for (const a of s.appointments) {
    if (a.source === 'import') continue
    const at = Date.parse(a.createdAt)
    if (Number.isFinite(at)) booked.set(a.clientId, [...(booked.get(a.clientId) ?? []), at])
  }
  return (copy: SentCopy) =>
    (booked.get(copy.clientId) ?? []).some(
      (at) => at >= copy.updatedAt && at <= copy.updatedAt + BOOKED_WITHIN_DAYS * DAY,
    )
}

/**
 * The results of the studio's campaigns and automatic messages, overall and by month, newest month
 * first. `campaignIds` are the campaigns this person may see; `automatic` is false for a general
 * manager. Only copies that reached the sender count as reaching a guest.
 */
export function marketingResults(
  s: BusinessState,
  copies: readonly SentCopy[],
  usedLinks: readonly UsedStopLink[],
  options: { campaignIds: readonly string[]; automatic: boolean; now: number; months?: number },
): MarketingResults {
  const { timeZone } = s.organisation
  const monthOf = (ms: number) => venueDate(timeZone, new Date(ms).toISOString()).slice(0, 7)
  const reachedAndBooked = bookedAfter(s)
  const wanted = new Set(options.campaignIds)
  const campaigns = new Map(options.campaignIds.map((id) => [id, empty()]))
  const automatic = new Map<AutomaticKind, Tally & { lastThirtyDays: number }>(
    automaticKinds.map((kind) => [kind, { ...empty(), lastThirtyDays: 0 }]),
  )
  const months = new Map<string, MonthResult>()
  const month = (key: string) => {
    let found = months.get(key)
    if (!found) {
      found = { month: key, campaigns: [], automatic: [], stoppedAll: 0 }
      months.set(key, found)
    }
    return found
  }
  const monthly = <K extends 'campaigns' | 'automatic'>(
    key: string,
    list: K,
    match: (row: MonthResult[K][number]) => boolean,
    made: () => MonthResult[K][number],
  ) => {
    const rows = month(key)[list] as MonthResult[K][number][]
    let row = rows.find(match)
    if (!row) {
      row = made()
      rows.push(row)
    }
    return row
  }
  for (const copy of copies) {
    const id = copy.kind === 'news' ? campaignOf(copy.slot) : null
    const when = monthOf(copy.updatedAt)
    const reached = copy.status === 'accepted' || copy.status === 'delivered'
    if (id !== null) {
      if (!wanted.has(id)) continue
      const row = monthly(
        when,
        'campaigns',
        (r) => r.id === id,
        () => ({ id, ...empty() }),
      )
      for (const tally of [campaigns.get(id)!, row]) {
        add(tally, copy)
        if (reached && reachedAndBooked(copy)) tally.booked += 1
      }
    } else if (options.automatic && isAutomatic(copy.kind)) {
      const kind = copy.kind
      const row = monthly(
        when,
        'automatic',
        (r) => r.kind === kind,
        () => ({ kind, ...empty() }),
      )
      const overall = automatic.get(kind)!
      for (const tally of [overall, row]) {
        add(tally, copy)
        if (reached && reachedAndBooked(copy)) tally.booked += 1
      }
      if (reached && copy.updatedAt > options.now - 30 * DAY) overall.lastThirtyDays += 1
    }
  }
  for (const link of usedLinks) {
    if (!wanted.has(link.messageId)) continue
    campaigns.get(link.messageId)!.stopped += 1
    monthly(
      monthOf(link.usedAt),
      'campaigns',
      (r) => r.id === link.messageId,
      () => ({ id: link.messageId, ...empty() }),
    ).stopped += 1
  }
  if (options.automatic)
    for (const record of consentRecords(s))
      if (!record.given) month(monthOf(Date.parse(record.recordedAt))).stoppedAll += 1
  const newest = [...months.values()].sort((a, b) => b.month.localeCompare(a.month))
  return {
    campaigns: [...campaigns].map(([id, tally]) => ({ id, ...tally })),
    ...(options.automatic
      ? { automatic: [...automatic].map(([kind, tally]) => ({ kind, ...tally })) }
      : {}),
    months: newest.slice(0, options.months ?? 12),
  }
}

/** "12 sent · 1 not sent · 3 booked within two weeks": only the parts that happened. */
export function tallyWords(tally: Tally, campaign: boolean) {
  const parts: string[] = []
  const n = (value: number) => value.toLocaleString('en-GB')
  if (tally.sent) parts.push(`${n(tally.sent)} sent`)
  if (tally.test) parts.push(`${n(tally.test)} in test mode, not sent`)
  if (tally.waiting) parts.push(`${n(tally.waiting)} still going`)
  if (tally.notSent) parts.push(`${n(tally.notSent)} not sent`)
  if (campaign && tally.stopped) parts.push(`${n(tally.stopped)} stopped hearing from you`)
  if (tally.booked) parts.push(`${n(tally.booked)} booked within two weeks`)
  return parts.join(' · ')
}

/**
 * Who the studio may send news to, by how they agreed or stopped, from the consent records: the
 * newest record for each client decides. For the Audience page; counts only, never names.
 */
export function audienceChanges(s: BusinessState, now: number, months = 6) {
  const { timeZone } = s.organisation
  const monthOf = (iso: string) => venueDate(timeZone, iso).slice(0, 7)
  const thisMonth = venueDate(timeZone, new Date(now).toISOString()).slice(0, 7)
  const latest = new Map<string, ReturnType<typeof consentRecords>[number]>()
  for (const record of consentRecords(s)) latest.set(record.clientId, record)
  const known = new Set(s.clients.map((c) => c.id))
  const stoppedBy = { link: 0, desk: 0, booking: 0, software: 0 }
  for (const [clientId, record] of latest) {
    if (record.given || !known.has(clientId)) continue
    if (record.source === 'email link' || record.source === 'guest link') stoppedBy.link += 1
    else if (record.source === 'desk') stoppedBy.desk += 1
    else if (record.source === 'booking page') stoppedBy.booking += 1
    else stoppedBy.software += 1
  }
  const byMonth = new Map<string, { month: string; agreed: number; stopped: number }>()
  for (const record of consentRecords(s)) {
    const key = monthOf(record.recordedAt)
    if (key > thisMonth) continue
    const row = byMonth.get(key) ?? { month: key, agreed: 0, stopped: 0 }
    if (record.given) row.agreed += 1
    else row.stopped += 1
    byMonth.set(key, row)
  }
  return {
    agreed: s.clients.filter((c) => c.marketingConsent).length,
    neverAsked: s.clients.filter((c) => !c.marketingConsent && !latest.has(c.id)).length,
    stoppedBy,
    months: [...byMonth.values()].sort((a, b) => b.month.localeCompare(a.month)).slice(0, months),
  }
}
