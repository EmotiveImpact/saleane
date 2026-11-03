import { hasLocations, visitPlace } from './locations'
import type { Appointment, BusinessState, Client } from './model'
import type { MissedCall } from './missedCallsSchema'
import type { SocialChannel } from './inboxSchema'
import { formsWaiting } from './forms'
import { businessDate, businessMinutes, instantFor, operations } from './operations'
import { dateLabel, timeLabel } from './format'
import { GUEST_CANCEL_CUTOFF_HOURS } from './guest'
import { FEEDBACK_WINDOW_MS } from './feedback'
import { BOOK_LINK, defaultReminderSettings } from './reminderSettings'
import type { ReminderSettings } from './reminderSettings'
import { countsForVisit, patchTestSettings, patchTests, visitPatchTest } from './patchTests'
import { addDays } from './format'
import {
  alsoBookedLine,
  cancelledTogether,
  cancelledTooLine,
  everyLabel,
  laterInRepeat,
  repeatVisits,
  visitOrder,
} from './repeat'
import {
  bookedByLine,
  bookedWithYouLine,
  cancelledWith,
  cancelledWithLine,
  othersTogether,
} from './together'
import {
  DEFAULT_RETURN_DAYS,
  dueBackOn,
  agreedEverywhere,
  hasVisitAhead,
  isLatestVisit,
  latestGuestVisit,
  sameGuest,
  returnWeeksFor,
} from './dueBack'
import { textsStopped } from './textStop'

/**
 * PILOT-01: appointment confirmations and reminders by email and text.
 *
 * This module only decides what should be sent and what it says. The server's outbox records each
 * message once, hands it to whichever provider is configured, and keeps the provider's answer.
 * With no provider configured the outbox runs in test mode: messages are written down and nothing
 * leaves the computer. A message is called delivered only when a provider receipt says so.
 */
export {
  BOOK_LINK,
  defaultReminderSettings,
  missYouDayChoices,
  reminderHourChoices,
  reminderSettingsSchema,
} from './reminderSettings'
export type { ReminderSettings } from './reminderSettings'
export function reminderSettings(s: BusinessState): ReminderSettings {
  return operations(s).reminders ?? defaultReminderSettings
}

export const messageKinds = [
  'confirmation',
  'changed',
  'reminder',
  'cancelled',
  'feedback',
  'patch_test',
  'aftercare',
  'due_back',
  'birthday',
  'miss_you',
  'missed_call',
  'message',
  'receptionist',
  'social',
  // Stage 1: before a membership's card payment, and after its last decline.
  'plan_reminder',
  'plan_declined',
  // Stage 2: a receipt the desk chose to email. Never planned; only queued when asked for.
  'receipt',
  // Stage 4: one copy of a message to clients, queued only when the owner approves it.
  'news',
] as const
export type MessageKind = (typeof messageKinds)[number]
/** Messages about the guest rather than one visit. Their rows carry no appointment. */
export const clientKinds = ['birthday', 'miss_you'] as const
export type ClientKind = (typeof clientKinds)[number]
/** Messages about one visit. */
export type VisitKind = Exclude<
  MessageKind,
  | ClientKind
  | 'missed_call'
  | 'message'
  | 'receptionist'
  | 'social'
  | 'plan_reminder'
  | 'plan_declined'
  | 'receipt'
  | 'news'
>
export const isClientKind = (kind: string): kind is ClientKind =>
  (clientKinds as readonly string[]).includes(kind)
export const messageChannels = ['email', 'sms'] as const
export type MessageChannel = (typeof messageChannels)[number]
/** Where the outbox can send: the studio's email and text lines, and (V4) its social accounts. */
export type OutboxChannel = MessageChannel | SocialChannel
/** Where a link to manage the visit goes. The outbox swaps it for a fresh private link. */
export const MANAGE_LINK = '{{manage_link}}'

/** A message the outbox has already recorded, enough to avoid sending it twice. */
export type RecordedMessage = {
  appointmentId: string
  /** Needed for messages about the guest rather than a visit. */
  clientId?: string
  kind: MessageKind
  channel: OutboxChannel
  slot: string
  status: OutboxStatus
  /** When it was queued, so a reminder from before a reaction does not stand in for a new one. */
  createdAt?: string
}
export type PlannedMessage = {
  dedupeKey: string
  appointmentId: string
  clientId: string
  kind: MessageKind
  channel: OutboxChannel
  slot: string
  recipient: string
  subject: string
  body: string
}
export const outboxStatuses = [
  'pending',
  'test',
  'accepted',
  'delivered',
  'failed',
  'unknown',
  'skipped',
] as const
export type OutboxStatus = (typeof outboxStatuses)[number]
/** Plain words for each state. None of them claims more than the provider has told us. */
export const outboxStatusLabel: Record<OutboxStatus, string> = {
  pending: 'Waiting to go',
  test: 'Test mode, not sent',
  accepted: 'With the provider, no receipt yet',
  delivered: 'Delivered',
  failed: 'Not delivered',
  unknown: 'Unclear, check before resending',
  skipped: 'Not sent',
}

const HOUR = 60 * 60000
/** Confirmations go only for visits booked or moved recently, never for old ones in bulk. */
const RECENT_MS = 48 * HOUR
/** A reminder that would arrive less than this before the visit is no longer useful. */
const REMINDER_FLOOR_MS = 45 * 60000
/** A feedback request goes this long after checkout, so it never lands while the guest is still in. */
const FEEDBACK_DELAY_MS = 2 * HOUR

/**
 * Whether a completed visit's feedback request may go now: switched on, not yet answered, at least
 * two hours and at most two days after checkout, and within the private link's lifetime. Checked
 * when planning and again just before sending, so a late or retried request never goes out.
 */
export function feedbackDue(s: BusinessState, a: Appointment, start: number, now: number) {
  const paidAt = Date.parse(s.sales.find((sale) => sale.appointmentId === a.id)?.paidAt ?? '')
  return (
    a.status === 'completed' &&
    reminderSettings(s).feedback !== false &&
    now - paidAt >= FEEDBACK_DELAY_MS &&
    now - paidAt < RECENT_MS &&
    now < start + FEEDBACK_WINDOW_MS &&
    !s.feedback?.some((f) => f.appointmentId === a.id)
  )
}

/** Aftercare goes a little after checkout, once the guest has had time to get home. */
const AFTERCARE_DELAY_MS = 30 * 60000

/** The care advice for a visit's treatment, if the studio has written some. */
export function aftercareNote(s: BusinessState, a: Appointment) {
  return s.services.find((x) => x.id === a.serviceId)?.aftercareNote?.trim() ?? ''
}

/**
 * NEXT-16: the aftercare written up for this visit, signed with the first name of the professional
 * who wrote it. Written at the desk, it goes unsigned.
 */
export function visitAftercare(s: BusinessState, a: Appointment) {
  const text = a.aftercare?.text.trim()
  if (!text) return ''
  const signed = a.aftercare!.staffId
  const who = signed ? s.staff.find((p) => p.id === signed)?.name.split(' ')[0] : undefined
  return who ? `A note from ${who}: ${text}` : text
}

/**
 * Whether a completed visit's aftercare email may go now: switched on, the treatment has advice,
 * and between half an hour and two days after checkout. Checked again just before sending.
 */
export function aftercareDue(s: BusinessState, a: Appointment, now: number) {
  const paidAt = Date.parse(s.sales.find((sale) => sale.appointmentId === a.id)?.paidAt ?? '')
  return (
    a.status === 'completed' &&
    reminderSettings(s).aftercare !== false &&
    (!!aftercareNote(s, a) || !!visitAftercare(s, a)) &&
    now - paidAt >= AFTERCARE_DELAY_MS &&
    now - paidAt < RECENT_MS
  )
}

/**
 * NEXT-16: whether aftercare saved on this visit now will still go in the guest's aftercare email.
 * Not once that email has gone (`sent`), nor two days after checkout, nor to a guest without email,
 * nor while aftercare emails are switched off or the studio sends nothing.
 */
export function aftercareEmailAhead(s: BusinessState, a: Appointment, now: number, sent: boolean) {
  if (sent || operations(s).mode !== 'local' || reminderSettings(s).aftercare === false)
    return false
  const client = s.clients.find((c) => c.id === a.clientId)
  if (!client?.email || !channelsFor(s, client).includes('email')) return false
  if (a.status === 'arrived') return true
  if (a.status !== 'completed') return false
  const paidAt = Date.parse(s.sales.find((sale) => sale.appointmentId === a.id)?.paidAt ?? '')
  return now - paidAt < RECENT_MS
}

/** "You're due back" may go from a few days before the due date until two weeks after it. */
const DUE_BACK_EARLY_DAYS = 3
const DUE_BACK_LATE_DAYS = 14
/** And only in the daytime on the studio's clock, never at night. */
const DAYTIME = { from: 9 * 60, to: 19 * 60 }

/**
 * Whether a guest may be told they are due back, after this visit: switched on, the treatment sets
 * how many weeks guests usually leave, the guest agreed to hear from the studio, this is their
 * latest visit, nothing is booked, and today is near the due date. Checked again before sending,
 * so a booking made meanwhile, or a guest changing their mind, stops it.
 */
export function dueBackDue(s: BusinessState, a: Appointment, nowIso: string) {
  const client = s.clients.find((c) => c.id === a.clientId)
  if (
    a.status !== 'completed' ||
    reminderSettings(s).dueBack === false ||
    !returnWeeksFor(s, a) ||
    !client ||
    // A guest who said no under any of their records has said no.
    !agreedEverywhere(s, client.id) ||
    !isLatestVisit(s, a) ||
    hasVisitAhead(s, a.clientId)
  )
    return false
  const today = businessDate(s, nowIso)
  const due = dueBackOn(s, a)
  return (
    today >= addDays(due, -DUE_BACK_EARLY_DAYS) &&
    today <= addDays(due, DUE_BACK_LATE_DAYS) &&
    daytime(s, nowIso)
  )
}

function daytime(s: BusinessState, nowIso: string) {
  const minutes = businessMinutes(s, nowIso)
  return minutes >= DAYTIME.from && minutes < DAYTIME.to
}

/** The day a "MM-DD" birthday falls on in a year: 29 February is the 28th in other years. */
export function birthdayIn(birthday: string, year: number) {
  const leap = new Date(Date.UTC(year, 1, 29)).getUTCMonth() === 1
  return `${year}-${birthday === '02-29' && !leap ? '02-28' : birthday}`
}

/**
 * Whether a guest may get a birthday email now: switched on, the guest shared the date and agreed
 * to hear from the studio, it is that day on the studio's clock, in the daytime. When one guest has
 * several records, only the first with a birthday sends, so they get one email.
 */
export function birthdayDue(s: BusinessState, client: Client, nowIso: string) {
  if (reminderSettings(s).birthday === false || !client.birthday) return false
  if (!agreedEverywhere(s, client.id)) return false
  const ids = sameGuest(s, client.id)
  const first = s.clients
    .filter((c) => ids.has(c.id) && c.birthday)
    .sort((a, b) => a.id.localeCompare(b.id))[0]
  if (first?.id !== client.id) return false
  const today = businessDate(s, nowIso)
  return today === birthdayIn(client.birthday, Number(today.slice(0, 4))) && daytime(s, nowIso)
}

/** A "we miss you" note may go for this long once the gap is reached, never for old gaps in bulk. */
const MISS_YOU_WINDOW_DAYS = 30

/**
 * The first day a guest may be told "we miss you": the studio's gap (90 days by default) after
 * their last visit, and never while a due back note could still be on its way.
 */
export function missYouFrom(s: BusinessState, last: Appointment) {
  // The setting is offered as months (60 days is "two months"), so count calendar months.
  const months = (reminderSettings(s).missYouDays ?? 90) / 30
  const afterDueBack = addDays(dueBackOn(s, last), DUE_BACK_LATE_DAYS + 14)
  const afterGap = addMonths(last.date, months)
  return afterGap > afterDueBack ? afterGap : afterDueBack
}

/** The same day some months later, or the month's last day when it is shorter (31 Aug + 3 is 30 Nov). */
export function addMonths(date: string, months: number) {
  const [year, month, day] = date.split('-').map(Number)
  const last = new Date(Date.UTC(year, month - 1 + months + 1, 0)).getUTCDate()
  return new Date(Date.UTC(year, month - 1 + months, Math.min(day, last)))
    .toISOString()
    .slice(0, 10)
}

/**
 * Whether a guest may get one "we miss you" email now, for their current gap: switched on, they
 * agreed to hear, nothing is booked, the gap is reached and less than a month old, in the daytime.
 * Sent from the record that holds the last visit, so a guest with several records gets one.
 */
export function missYouDue(s: BusinessState, client: Client, nowIso: string) {
  if (reminderSettings(s).missYou === false || !agreedEverywhere(s, client.id)) return false
  const last = latestGuestVisit(s, client.id)
  if (!last || last.clientId !== client.id || hasVisitAhead(s, client.id)) return false
  const from = missYouFrom(s, last)
  const today = businessDate(s, nowIso)
  return today >= from && today < addDays(from, MISS_YOU_WINDOW_DAYS) && daytime(s, nowIso)
}

/** Which birthday or gap a client message is about, so each goes once. */
export function clientSlot(s: BusinessState, client: Client, kind: ClientKind, nowIso: string) {
  return kind === 'birthday'
    ? businessDate(s, nowIso).slice(0, 4)
    : (latestGuestVisit(s, client.id)?.id ?? '')
}

/** A missed caller is texted back only soon after they rang, while it still makes sense. */
export const TEXT_BACK_MS = 15 * 60000

/** Clients whose mobile number is this one. */
export function clientsWithNumber(s: BusinessState, number: string) {
  return s.clients.filter((c) => textNumber(c.phone) === number)
}

/**
 * Whether a caller the studio missed may get one text now: the studio switched it on and sends
 * texts, nobody has called them back, they rang in the last 15 minutes, no client with that
 * number asked not to get texts and the number has not replied STOP. Checked again just before
 * sending.
 */
export function missedCallTextDue(s: BusinessState, call: MissedCall, nowIso: string) {
  const settings = reminderSettings(s)
  const since = Date.parse(nowIso) - Date.parse(call.lastAt)
  return (
    operations(s).mode === 'local' &&
    settings.missedCall === true &&
    settings.sms &&
    !call.calledBackAt &&
    since >= 0 &&
    since < TEXT_BACK_MS &&
    !clientsWithNumber(s, call.number).some((c) => c.noTextReminders) &&
    // Stage 1: nor has the number replied STOP, client or not.
    !textsStopped(s, call.number)
  )
}

/** One text per number per day on the studio's clock, however often they ring. */
export function missedCallSlot(s: BusinessState, call: MissedCall) {
  return `${call.number}@${businessDate(s, call.at)}`
}

/** The words of the text to a missed caller. Short, warm and with a way to stop. */
export function composeMissedCallText(s: BusinessState) {
  const org = s.organisation
  const book = operations(s).bookingEnabled
    ? ` If it was about a visit, you can book here: ${BOOK_LINK}`
    : ''
  return {
    subject: '',
    body: `${org.name}: sorry we missed your call. We will call you back as soon as we can.${book} Reply STOP to stop texts.`,
  }
}

/** A patch test reminder goes no earlier than this before the visit. */
const PATCH_TEST_LEAD_MS = 14 * 24 * HOUR

/**
 * Whether a booked visit's "please come in for a patch test" message may go now: the treatment
 * needs one, the guest has none that counts, and there is still time to do it before the visit.
 * Checked when planning and again just before sending, so a test recorded meanwhile stops it.
 */
export function patchTestReminderDue(s: BusinessState, a: Appointment, start: number, now: number) {
  const settings = patchTestSettings(s)
  return (
    a.status === 'confirmed' &&
    settings.remind &&
    start - now <= PATCH_TEST_LEAD_MS &&
    start - now > settings.hoursBefore * HOUR &&
    wantsTest(s, a, new Date(start).toISOString())
  )
}
/** No test that counts, or a reaction with no new test since that could count for this visit. */
function wantsTest(s: BusinessState, a: Appointment, startIso: string) {
  const standing = visitPatchTest(s, a)
  if (standing?.state === 'needed') return true
  if (standing?.state !== 'reaction' || !standing.test) return false
  const after = standing.test.testedAt
  return !patchTests(s).some(
    (t) =>
      t.clientId === a.clientId &&
      t.testedAt > after &&
      !t.result &&
      countsForVisit(s, t, startIso),
  )
}

/** When the reaction now standing in the way of this visit was recorded, if there is one. */
function reactedAt(s: BusinessState, a: Appointment) {
  const standing = visitPatchTest(s, a)
  return standing?.state === 'reaction' ? (standing.test?.result?.at ?? null) : null
}

/** A visit's time and place, so a moved visit is told about again. */
export function visitSlot(a: Pick<Appointment, 'date' | 'startMinutes' | 'staffId'>) {
  return `${a.date}T${String(a.startMinutes).padStart(4, '0')}@${a.staffId}`
}

/**
 * A number a text provider accepts (E.164), or null. Numbers are already stored with a country
 * code; this removes spacing and rejects anything else rather than guessing a country.
 */
export function textNumber(phone: string) {
  const compact = phone.replace(/[\s().-]/g, '')
  return /^\+[1-9]\d{7,14}$/.test(compact) ? compact : null
}

export function channelsFor(s: BusinessState, client: Client): MessageChannel[] {
  const settings = reminderSettings(s)
  const channels: MessageChannel[] = []
  if (settings.email && !client.noEmailReminders) channels.push('email')
  if (settings.sms && !textsOff(s, client) && textNumber(client.phone)) channels.push('sms')
  return channels
}

function lastMoved(s: BusinessState, appointmentId: string) {
  let latest = 0
  for (const event of s.events)
    if (event.appointmentId === appointmentId && event.type === 'rescheduled')
      latest = Math.max(latest, Date.parse(event.occurredAt))
  return latest
}

/**
 * Everything that should be sent now and has not been recorded yet. Pure: the same records and
 * time always give the same plan, so a restart or a second worker cannot send a message twice.
 */
export function planMessages(
  s: BusinessState,
  nowIso: string,
  recorded: RecordedMessage[],
): PlannedMessage[] {
  if (operations(s).mode !== 'local') return []
  const settings = reminderSettings(s)
  const now = Date.parse(nowIso)
  const byVisit = new Map<string, RecordedMessage[]>()
  for (const row of recorded)
    byVisit.set(row.appointmentId, [...(byVisit.get(row.appointmentId) ?? []), row])
  const plan: PlannedMessage[] = []
  for (const a of s.appointments) {
    const client = s.clients.find((c) => c.id === a.clientId)
    if (!client) continue
    let start: number
    try {
      start = Date.parse(instantFor(s, a.date, a.startMinutes))
    } catch {
      continue
    }
    const slot = visitSlot(a)
    // V1.5: once a visit is complete, each follow-up goes at most once, by email only: a text
    // adds cost for messages the guest may ignore. Feedback a little after checkout, aftercare
    // advice soon after it, and a "due back" note weeks later for guests who agreed to hear.
    if (a.status === 'completed') {
      if (!channelsFor(s, client).includes('email') || !client.email) continue
      const sent = byVisit.get(a.id) ?? []
      const due: Record<'feedback' | 'aftercare' | 'due_back', boolean> = {
        feedback: feedbackDue(s, a, start, now),
        aftercare: aftercareDue(s, a, now),
        due_back: dueBackDue(s, a, nowIso),
      }
      for (const kind of ['feedback', 'aftercare', 'due_back'] as const) {
        if (!due[kind] || sent.some((row) => row.kind === kind)) continue
        plan.push({
          dedupeKey: `${a.id}:${kind}:email:${slot}`,
          appointmentId: a.id,
          clientId: client.id,
          kind,
          channel: 'email',
          slot,
          recipient: client.email,
          ...composeMessage(s, a, kind, 'email'),
        })
      }
      continue
    }
    if (start <= now) continue
    const rows = byVisit.get(a.id) ?? []
    const moved = lastMoved(s, a.id)
    const add = (kind: VisitKind, channel: MessageChannel, attempt = 0) => {
      const recipient = channel === 'email' ? client.email : textNumber(client.phone)
      if (!recipient) return
      const text = composeMessage(s, a, kind, channel)
      plan.push({
        dedupeKey: `${a.id}:${kind}:${channel}:${slot}${attempt ? `:again-${attempt}` : ''}`,
        appointmentId: a.id,
        clientId: client.id,
        kind,
        channel,
        slot,
        recipient,
        ...text,
      })
    }
    // NEXT-09: a confirmation of a visit that reached the guest on this channel.
    const confirmedOn = (id: string, channel: MessageChannel) =>
      (byVisit.get(id) ?? []).some(
        (row) =>
          row.channel === channel &&
          row.kind === 'confirmation' &&
          !['skipped', 'failed'].includes(row.status),
      )
    for (const channel of channelsFor(s, client)) {
      const mine = rows.filter((row) => row.channel === channel)
      const told = mine.filter((row) => row.kind === 'confirmation' || row.kind === 'changed')
      const reached = mine.filter((row) => !['skipped', 'failed'].includes(row.status))
      if (a.status === 'cancelled') {
        // NEXT-09: repeat visits cancelled together are one message, from the earliest of them.
        if (cancelledTogether(s, a).some((x) => visitOrder(x) < visitOrder(a))) continue
        // Only a guest who was told about the visit is told it is off. A later repeat visit was
        // told of in the first one's confirmation.
        const heard =
          reached.length > 0 || repeatVisits(s, a).some((x) => confirmedOn(x.id, channel))
        if (heard && !mine.some((row) => row.kind === 'cancelled' && row.slot === slot))
          add('cancelled', channel)
        continue
      }
      if (a.status !== 'confirmed') continue
      if (settings.confirmations && !told.some((row) => row.slot === slot)) {
        if (told.length || (moved && now - moved < RECENT_MS)) add('changed', channel)
        // A visit carried over from another system was confirmed there already (PILOT-03).
        // NEXT-09: repeat visits are confirmed together, in the first one's message, so a later
        // one is not confirmed again when the first is cancelled or has already been.
        else if (
          a.source !== 'import' &&
          now - Date.parse(a.createdAt) < RECENT_MS &&
          !repeatVisits(s, a).some(
            (x) =>
              visitOrder(x) < visitOrder(a) &&
              (x.status === 'confirmed' || confirmedOn(x.id, channel)),
          )
        )
          add('confirmation', channel)
      }
      // One reminder per visit and channel, even if the visit moves afterwards. One that was
      // skipped (a test was recorded, or the visit moved) may be asked for again, under a new key
      // so the outbox takes it. A failed one is not: its retries were already spent. Once a test
      // shows a reaction, reminders from before it no longer count: the guest needs a new test.
      const patchRows = mine.filter((row) => row.kind === 'patch_test')
      const since = reactedAt(s, a)
      // One still waiting to go out serves the new round too, so the guest is not told twice.
      const current = patchRows.filter(
        (row) =>
          !since ||
          !row.createdAt ||
          ['pending', 'unknown'].includes(row.status) ||
          Date.parse(row.createdAt) > Date.parse(since),
      )
      if (
        patchTestReminderDue(s, a, start, now) &&
        current.every((row) => row.status === 'skipped')
      )
        add('patch_test', channel, patchRows.length)
      if (settings.reminders && !mine.some((row) => row.kind === 'reminder' && row.slot === slot)) {
        const opens = start - settings.hoursBefore * HOUR
        // Booked or moved after the reminder time: the confirmation already did this job.
        // A carried-over visit was booked in the old system long before, so only a move counts.
        const settled = Math.max(a.source === 'import' ? 0 : Date.parse(a.createdAt), moved)
        if (now >= opens && settled < opens && start - now >= REMINDER_FLOOR_MS)
          add('reminder', channel)
      }
    }
  }
  // V1.5: messages about the guest rather than one visit, by email only, once per birthday or gap.
  for (const client of s.clients) {
    if (!channelsFor(s, client).includes('email') || !client.email) continue
    const due: Record<ClientKind, boolean> = {
      birthday: birthdayDue(s, client, nowIso),
      miss_you: missYouDue(s, client, nowIso),
    }
    const ids = sameGuest(s, client.id)
    for (const kind of clientKinds) {
      if (!due[kind]) continue
      const slot = clientSlot(s, client, kind, nowIso)
      if (
        recorded.some(
          (row) => row.kind === kind && row.slot === slot && ids.has(row.clientId ?? ''),
        )
      )
        continue
      plan.push({
        dedupeKey: `${client.id}:${kind}:email:${slot}`,
        appointmentId: '',
        clientId: client.id,
        kind,
        channel: 'email',
        slot,
        recipient: client.email,
        ...composeClientMessage(s, client, kind),
      })
    }
  }
  // V1.5: one text back to a caller the studio missed, if the studio switched it on.
  for (const call of operations(s).missedCalls ?? []) {
    if (!missedCallTextDue(s, call, nowIso)) continue
    const slot = missedCallSlot(s, call)
    if (recorded.some((row) => row.kind === 'missed_call' && row.slot === slot)) continue
    plan.push({
      dedupeKey: `call:missed_call:sms:${slot}`,
      appointmentId: '',
      clientId: call.clientId ?? '',
      kind: 'missed_call',
      channel: 'sms',
      slot,
      recipient: call.number,
      ...composeMissedCallText(s),
    })
  }
  // V1.5: a message the studio wrote in the inbox, once, as it was approved. Only one approved
  // lately: one approved while the studio was not yet sending stays queued rather than going out.
  for (const message of operations(s).messages) {
    if (message.status !== 'queued' || !message.approvedAt) continue
    if (now - Date.parse(message.approvedAt) > RECENT_MS) continue
    const slot = messageSlot(message.id)
    if (recorded.some((row) => row.kind === 'message' && row.slot === slot)) continue
    const client = s.clients.find((c) => c.id === message.clientId)
    if (!client || (message.purpose === 'marketing' && !client.marketingConsent)) continue
    const channel = message.channel ?? 'email'
    if (message.purpose === 'appointment' && appointmentMessagesOff(client, channel)) continue
    if (channel === 'sms' && textsOff(s, client)) continue
    const recipient = channel === 'email' ? client.email.trim() : textNumber(client.phone)
    if (!recipient) continue
    plan.push({
      dedupeKey: `${message.id}:message:${channel}`,
      appointmentId: message.appointmentId ?? '',
      clientId: client.id,
      kind: 'message',
      channel,
      slot,
      recipient,
      subject: message.subject,
      body: message.body,
    })
  }
  // V4: the team's answer on Instagram, Facebook or WhatsApp, once, as it was written.
  for (const answer of s.socialAnswers ?? []) {
    if (now - Date.parse(answer.answeredAt) > RECENT_MS) continue
    const slot = socialSlot(answer.id)
    if (recorded.some((row) => row.kind === 'social' && row.slot === slot)) continue
    plan.push({
      dedupeKey: `${answer.id}:social:${answer.channel}`,
      appointmentId: '',
      clientId: answer.clientId ?? '',
      kind: 'social',
      channel: answer.channel,
      slot,
      recipient: answer.to,
      subject: '',
      body: answer.body,
    })
  }
  return plan
}

/** The outbox slot of an answer on a social app, which names the answer. */
export const socialSlot = (answerId: string) => `social:${answerId}`

/** Whether a client asked for no appointment messages on this channel. */
export const appointmentMessagesOff = (client: Client, channel: MessageChannel) =>
  channel === 'email' ? !!client.noEmailReminders : !!client.noTextReminders

/**
 * Stage 1: whether nothing may be texted to this client: they asked for no texts, or their number
 * replied STOP to the studio's line and has not texted START since (textStop.ts).
 */
export const textsOff = (s: BusinessState, client: Client) =>
  !!client.noTextReminders || textsStopped(s, client.phone)

/** The outbox slot of a message written in the inbox, which names the message. */
export const messageSlot = (messageId: string) => `message:${messageId}`

/** The words of a message about the guest rather than one visit. Warm, short, never pushy. */
export function composeClientMessage(s: BusinessState, client: Client, kind: ClientKind) {
  const org = s.organisation
  const bookLine = operations(s).bookingEnabled
    ? `Book when it suits you: ${BOOK_LINK}`
    : 'Call us or reply to book when it suits you.'
  const subject = {
    birthday: `Happy birthday from ${org.name}`,
    miss_you: `We miss you at ${org.name}`,
  }[kind]
  const opening = {
    birthday: `Everyone at ${org.name} wishes you a very happy birthday. We hope it is a lovely day.`,
    miss_you: `It has been a little while since your last visit, and we would love to see you again whenever you are ready.`,
  }[kind]
  // A guest who already has a visit booked is simply wished a happy birthday.
  const invite = {
    birthday: hasVisitAhead(s, client.id)
      ? `We look forward to seeing you soon.`
      : operations(s).bookingEnabled
        ? `If you fancy a treat this month: ${BOOK_LINK}`
        : 'If you fancy a treat this month, call us or reply to book.',
    miss_you: bookLine,
  }[kind]
  const body = [
    `Hello ${firstName(client.name)},`,
    '',
    opening,
    '',
    invite,
    '',
    STOP_LINE,
    '',
    org.name,
  ].join('\n')
  return { subject, body }
}

/** Every message sent because a guest agreed to hear from the studio says why, and how to stop. */
export const STOP_LINE =
  'You are hearing this because you said we could keep in touch. To stop these, reply to this email or tell us at your next visit.'

function firstName(name: string) {
  return name.trim().split(/\s+/)[0] ?? name
}

/** The words of each message. Practical and warm, with nothing clinical and no marketing. */
export function composeMessage(
  s: BusinessState,
  a: Appointment,
  kind: VisitKind,
  channel: MessageChannel,
) {
  const org = s.organisation
  const client = s.clients.find((c) => c.id === a.clientId)
  const professional = s.staff.find((p) => p.id === a.staffId)?.name.split(' ')[0]
  const service =
    a.bookedServiceName ?? s.services.find((x) => x.id === a.serviceId)?.name ?? 'your visit'
  const when = `${dateLabel(a.date, org.locale)} at ${timeLabel(a.startMinutes, org.locale)}`
  const withWhom = professional ? ` with ${professional}` : ''
  const greeting = client ? `Hello ${firstName(client.name)},` : 'Hello,'
  // V2: the name, address and arrival note of the location the visit is at.
  const place = visitPlace(s, a)
  const arrival = place.arrivalNote?.trim()
  const prep = s.services.find((x) => x.id === a.serviceId)?.prepNote?.trim()
  // V1.5: ordinary forms the visit still waits for, filled in from the same private link.
  const forms = formsWaiting(s, a).map((item) => item.current.content.title)
  const formLine = forms.length
    ? `Before your visit, please fill in ${forms.length === 1 ? 'a short form' : `${forms.length} short forms`} (${forms.join(', ')}) from the link below.`
    : ''
  // With online booking off, the link would lead nowhere, so ask the guest to get in touch.
  const bookLine = operations(s).bookingEnabled
    ? `Book when it suits you: ${BOOK_LINK}`
    : 'Call us or reply to book when it suits you.'
  const policy = `If your plans change, please let us know at least ${GUEST_CANCEL_CUTOFF_HOURS} hours before.`
  // NEXT-09: the first of several repeat visits names the rest.
  const also = kind === 'confirmation' ? alsoBookedLine(s, a) : ''
  const later = kind === 'confirmation' ? laterInRepeat(s, a).length : 0
  const tooLine = kind === 'cancelled' ? cancelledTooLine(s, a) : ''
  const cancelledCount = tooLine
    ? cancelledTogether(s, a).filter((x) => visitOrder(x) > visitOrder(a)).length
    : 0
  const repeatText = later
    ? ` Also booked: ${later} more ${later === 1 ? 'visit' : 'visits'}, ${everyLabel(a.repeat!.everyWeeks)}.`
    : ''
  // NEXT-08: the person a booking for several people was made for hears who else is booked, and
  // each of the others who booked them.
  const withLine = kind === 'confirmation' ? bookedWithYouLine(s, a) || bookedByLine(s, a) : ''
  const withCount = kind === 'confirmation' && a.together?.lead ? othersTogether(s, a).length : 0
  const leadName = withLine && !a.together?.lead ? withLine : ''
  const withText = withCount
    ? ` Also booked with you: ${withCount} more ${withCount === 1 ? 'person' : 'people'}.`
    : leadName
      ? ` ${leadName}`
      : ''
  const offWithLine = kind === 'cancelled' ? cancelledWithLine(s, a) : ''
  const offWithCount = offWithLine ? cancelledWith(s, a).length : 0
  if (channel === 'sms') {
    // V2: with several locations, a text says which one, since it has no address block.
    const at = hasLocations(s)
      ? `, at ${[place.name, place.address].filter(Boolean).join(', ')}`
      : ''
    const lead = {
      confirmation: `${org.name}: you're booked for ${service}${withWhom}, ${when}${at}.${repeatText}${withText}`,
      changed: `${org.name}: your visit has moved to ${when}${at}, ${service}${withWhom}.`,
      reminder: `${org.name}: a reminder of ${service}${withWhom}, ${when}${at}.`,
      cancelled: `${org.name}: your ${service} on ${when} is cancelled.${cancelledCount ? ` ${cancelledCount} later ${cancelledCount === 1 ? 'visit is' : 'visits are'} cancelled too.` : ''}${offWithCount ? ` The ${offWithCount === 1 ? 'visit' : `${offWithCount} visits`} booked with yours ${offWithCount === 1 ? 'is' : 'are'} cancelled too.` : ''}`,
      feedback: `${org.name}: thank you for visiting. How was it? Tell us privately:`,
      patch_test: `${org.name}: your ${service} on ${when} needs a quick patch test at least ${patchTestSettings(s).hoursBefore} hours before. Please call or pop in to arrange one.`,
      aftercare: `${org.name}: looking after your ${service}. ${aftercareNote(s, a)}`,
      due_back: `${org.name}: you're about due for your next ${service}.`,
    }[kind]
    const tail =
      kind === 'cancelled'
        ? ' We hope to see you soon.'
        : kind === 'feedback'
          ? ` ${MANAGE_LINK}`
          : kind === 'aftercare'
            ? ''
            : kind === 'due_back'
              ? ` ${bookLine}`
              : forms.length && kind !== 'patch_test'
                ? ` Before you come, please fill in a short form: ${MANAGE_LINK}`
                : ` Manage your visit: ${MANAGE_LINK}`
    return { subject: '', body: `${lead}${tail} Reply STOP to stop texts.` }
  }
  const subject = {
    confirmation: `Your visit to ${org.name} is booked`,
    changed: `Your visit to ${org.name} has moved`,
    reminder: `See you soon at ${org.name}`,
    cancelled: `Your visit to ${org.name} is cancelled`,
    feedback: `How was your visit to ${org.name}?`,
    patch_test: `A quick patch test before your visit to ${org.name}`,
    aftercare: `Looking after your ${service}`,
    due_back: `Time for your next visit to ${org.name}?`,
  }[kind]
  const weeks = returnWeeksFor(s, a) ?? DEFAULT_RETURN_DAYS / 7
  const opening = {
    confirmation: `Thank you for booking. Here are your details.`,
    changed: `Your visit has a new time. Here are the updated details.`,
    reminder: `A gentle reminder of your visit.`,
    cancelled: `Your visit below has been cancelled. Nothing else is needed from you.`,
    feedback: `Thank you for visiting us. We would love to know how it went.`,
    patch_test: `Your treatment below needs a quick patch test at least ${patchTestSettings(s).hoursBefore} hours before, and we need a new one for you. It takes a few minutes: please call us or pop in to arrange it.`,
    aftercare: `Thank you for coming in. Here is how to look after your ${service} over the next few days.`,
    due_back: `It is about ${weeks === 1 ? 'a week' : `${weeks} weeks`} since your ${service}${withWhom}, which is usually when guests come back for the next one.`,
  }[kind]
  const lines = [greeting, '', opening, '']
  if (kind === 'aftercare') {
    lines.push(
      ...[aftercareNote(s, a), visitAftercare(s, a)].filter(Boolean).flatMap((part) => [part, '']),
      `If anything feels wrong, please call us. For anything urgent, contact a medical professional.`,
    )
  } else if (kind === 'due_back') {
    lines.push(bookLine, '', STOP_LINE)
  } else {
    lines.push(
      `${service}${withWhom}`,
      when,
      [place.name, place.address].filter(Boolean).join(', '),
    )
    if (also) lines.push('', also)
    if (tooLine) lines.push('', tooLine)
    if (withLine) lines.push('', withLine)
    if (offWithLine) lines.push('', offWithLine)
  }
  // Aftercare and due back are about a visit that is over: no visit details or manage link.
  if (kind === 'feedback') {
    lines.push(
      '',
      `Rate your visit${professional ? ` and ${professional}` : ''}, and add a note if you like. Only the studio's owner and managers read what you write: ${MANAGE_LINK}`,
    )
    // V1.5: the same invitation to every guest, whatever they go on to tell the studio.
    if (org.reviewUrl)
      lines.push(
        '',
        `If you would like to tell others about your visit, you can also leave a public review: ${org.reviewUrl}`,
      )
  } else if (kind !== 'cancelled' && kind !== 'aftercare' && kind !== 'due_back') {
    if (arrival) lines.push('', `Before you arrive: ${arrival}`)
    if (prep) lines.push('', prep)
    if (formLine && kind !== 'patch_test') lines.push('', formLine)
    lines.push('', policy, `View, add to your calendar or cancel: ${MANAGE_LINK}`)
  }
  lines.push('', `${org.name}`)
  return { subject, body: lines.join('\n') }
}
