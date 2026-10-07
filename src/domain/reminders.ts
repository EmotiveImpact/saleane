import type { Appointment, BusinessState, Client } from './model'
import { instantFor, operations } from './operations'
import { dateLabel, timeLabel } from './format'
import { GUEST_CANCEL_CUTOFF_HOURS } from './guest'
import { defaultReminderSettings } from './reminderSettings'
import type { ReminderSettings } from './reminderSettings'

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

export const messageKinds = ['confirmation', 'changed', 'reminder', 'cancelled'] as const
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
    if (start <= now) continue
    const slot = visitSlot(a)
    const rows = byVisit.get(a.id) ?? []
    const moved = lastMoved(s, a.id)
    const add = (kind: MessageKind, channel: MessageChannel) => {
      const recipient = channel === 'email' ? client.email : textNumber(client.phone)
      if (!recipient) return
      const text = composeMessage(s, a, kind, channel)
      plan.push({
        dedupeKey: `${a.id}:${kind}:${channel}:${slot}`,
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
        else if (now - Date.parse(a.createdAt) < RECENT_MS) add('confirmation', channel)
      }
      if (settings.reminders && !mine.some((row) => row.kind === 'reminder' && row.slot === slot)) {
        const opens = start - settings.hoursBefore * HOUR
        // Booked or moved after the reminder time: the confirmation already did this job.
        const settled = Math.max(Date.parse(a.createdAt), moved)
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
  const arrival = org.arrivalNote?.trim()
  const prep = s.services.find((x) => x.id === a.serviceId)?.prepNote?.trim()
  const policy = `If your plans change, please let us know at least ${GUEST_CANCEL_CUTOFF_HOURS} hours before.`
  if (channel === 'sms') {
    const lead = {
      confirmation: `${org.name}: you're booked for ${service}${withWhom}, ${when}.`,
      changed: `${org.name}: your visit has moved to ${when}, ${service}${withWhom}.`,
      reminder: `${org.name}: a reminder of ${service}${withWhom}, ${when}.`,
      cancelled: `${org.name}: your ${service} on ${when} is cancelled.`,
    }[kind]
    const tail =
      kind === 'cancelled' ? ' We hope to see you soon.' : ` Manage your visit: ${MANAGE_LINK}`
    return { subject: '', body: `${lead}${tail} Reply STOP to stop texts.` }
  }
  const subject = {
    confirmation: `Your visit to ${org.name} is booked`,
    changed: `Your visit to ${org.name} has moved`,
    reminder: `See you soon at ${org.name}`,
    cancelled: `Your visit to ${org.name} is cancelled`,
  }[kind]
  const opening = {
    confirmation: `Thank you for booking. Here are your details.`,
    changed: `Your visit has a new time. Here are the updated details.`,
    reminder: `A gentle reminder of your visit.`,
    cancelled: `Your visit below has been cancelled. Nothing else is needed from you.`,
  }[kind]
  const lines = [
    greeting,
    '',
    opening,
    '',
    `${service}${withWhom}`,
    when,
    [org.locationName, org.address].filter(Boolean).join(', '),
  ]
  if (kind !== 'cancelled') {
    if (arrival) lines.push('', `Before you arrive: ${arrival}`)
    if (prep) lines.push('', prep)
    lines.push('', policy, `View, add to your calendar or cancel: ${MANAGE_LINK}`)
  }
  lines.push('', `${org.name}`)
  return { subject, body: lines.join('\n') }
}
