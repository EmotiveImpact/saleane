import { visitPlace } from './locations'
import type { Appointment, BusinessState, Client } from './model'
import { instantFor, operations } from './operations'
import { dateLabel, timeLabel } from './format'
import { GUEST_CANCEL_CUTOFF_HOURS } from './guest'
import { FEEDBACK_WINDOW_MS } from './feedback'
import { defaultReminderSettings } from './reminderSettings'
import type { ReminderSettings } from './reminderSettings'
import { countsForVisit, patchTestSettings, patchTests, visitPatchTest } from './patchTests'

/**
 * PILOT-01: appointment confirmations and reminders by email and text.
 *
 * This module only decides what should be sent and what it says. The server's outbox records each
 * message once, hands it to whichever provider is configured, and keeps the provider's answer.
 * With no provider configured the outbox runs in test mode: messages are written down and nothing
 * leaves the computer. A message is called delivered only when a provider receipt says so.
 */
export {
  defaultReminderSettings,
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
] as const
export type MessageKind = (typeof messageKinds)[number]
export const messageChannels = ['email', 'sms'] as const
export type MessageChannel = (typeof messageChannels)[number]
/** Where a link to manage the visit goes. The outbox swaps it for a fresh private link. */
export const MANAGE_LINK = '{{manage_link}}'

/** A message the outbox has already recorded, enough to avoid sending it twice. */
export type RecordedMessage = {
  appointmentId: string
  kind: MessageKind
  channel: MessageChannel
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
  channel: MessageChannel
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
  if (settings.sms && !client.noTextReminders && textNumber(client.phone)) channels.push('sms')
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
    // V1.5: once a visit is complete, one private feedback request, a little after checkout.
    if (a.status === 'completed') {
      if (!feedbackDue(s, a, start, now)) continue
      // Email only: a text adds cost for a request the guest may ignore.
      if (!channelsFor(s, client).includes('email') || !client.email) continue
      if ((byVisit.get(a.id) ?? []).some((row) => row.kind === 'feedback')) continue
      plan.push({
        dedupeKey: `${a.id}:feedback:email:${slot}`,
        appointmentId: a.id,
        clientId: client.id,
        kind: 'feedback',
        channel: 'email',
        slot,
        recipient: client.email,
        ...composeMessage(s, a, 'feedback', 'email'),
      })
      continue
    }
    if (start <= now) continue
    const rows = byVisit.get(a.id) ?? []
    const moved = lastMoved(s, a.id)
    const add = (kind: MessageKind, channel: MessageChannel, attempt = 0) => {
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
    for (const channel of channelsFor(s, client)) {
      const mine = rows.filter((row) => row.channel === channel)
      const told = mine.filter((row) => row.kind === 'confirmation' || row.kind === 'changed')
      const reached = mine.filter((row) => !['skipped', 'failed'].includes(row.status))
      if (a.status === 'cancelled') {
        // Only a guest who was told about the visit is told it is off.
        if (reached.length && !mine.some((row) => row.kind === 'cancelled' && row.slot === slot))
          add('cancelled', channel)
        continue
      }
      if (a.status !== 'confirmed') continue
      if (settings.confirmations && !told.some((row) => row.slot === slot)) {
        if (told.length || (moved && now - moved < RECENT_MS)) add('changed', channel)
        // A visit carried over from another system was confirmed there already (PILOT-03).
        else if (a.source !== 'import' && now - Date.parse(a.createdAt) < RECENT_MS)
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
  return plan
}

function firstName(name: string) {
  return name.trim().split(/\s+/)[0] ?? name
}

/** The words of each message. Practical and warm, with nothing clinical and no marketing. */
export function composeMessage(
  s: BusinessState,
  a: Appointment,
  kind: MessageKind,
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
  const policy = `If your plans change, please let us know at least ${GUEST_CANCEL_CUTOFF_HOURS} hours before.`
  if (channel === 'sms') {
    const lead = {
      confirmation: `${org.name}: you're booked for ${service}${withWhom}, ${when}.`,
      changed: `${org.name}: your visit has moved to ${when}, ${service}${withWhom}.`,
      reminder: `${org.name}: a reminder of ${service}${withWhom}, ${when}.`,
      cancelled: `${org.name}: your ${service} on ${when} is cancelled.`,
      feedback: `${org.name}: thank you for visiting. How was it? Tell us privately:`,
      patch_test: `${org.name}: your ${service} on ${when} needs a quick patch test at least ${patchTestSettings(s).hoursBefore} hours before. Please call or pop in to arrange one.`,
    }[kind]
    const tail =
      kind === 'cancelled'
        ? ' We hope to see you soon.'
        : kind === 'feedback'
          ? ` ${MANAGE_LINK}`
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
  }[kind]
  const opening = {
    confirmation: `Thank you for booking. Here are your details.`,
    changed: `Your visit has a new time. Here are the updated details.`,
    reminder: `A gentle reminder of your visit.`,
    cancelled: `Your visit below has been cancelled. Nothing else is needed from you.`,
    feedback: `Thank you for visiting us. We would love to know how it went.`,
    patch_test: `Your treatment below needs a quick patch test at least ${patchTestSettings(s).hoursBefore} hours before, and we need a new one for you. It takes a few minutes: please call us or pop in to arrange it.`,
  }[kind]
  const lines = [
    greeting,
    '',
    opening,
    '',
    `${service}${withWhom}`,
    when,
    [place.name, place.address].filter(Boolean).join(', '),
  ]
  if (kind === 'feedback') {
    lines.push(
      '',
      `Rate your visit${professional ? ` and ${professional}` : ''}, and add a note if you like. Only the studio's owner and managers read what you write: ${MANAGE_LINK}`,
    )
  } else if (kind !== 'cancelled') {
    if (arrival) lines.push('', `Before you arrive: ${arrival}`)
    if (prep) lines.push('', prep)
    lines.push('', policy, `View, add to your calendar or cancel: ${MANAGE_LINK}`)
  }
  lines.push('', `${org.name}`)
  return { subject, body: lines.join('\n') }
}
