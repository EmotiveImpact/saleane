import type { Command } from './commandSchema'
import type { BusinessState, RelationshipEvent } from './model'
import { addDays, fullDateLabel } from './format'
import { businessDate, operations } from './operations'
import { agreedEverywhere, sameGuest } from './dueBack'
import { firstName } from './news'
import { reminderSettings } from './reminders'
import { isFormerClient, pastKeepingPeriod } from './retentionDue'
import { LIFE_EVENT_LIMIT } from './followUpsSchema'
import type { FollowUpMark, LifeEvent } from './followUpsSchema'

/**
 * Birthday and life-event follow-ups (owner decision, 4 November 2026): SALEANE suggests a draft
 * around a guest's birthday or a dated life event they shared, and nothing goes until someone
 * approves it in the Inbox, which checks again that the guest agreed to hear from the studio. A
 * gentle offer is added only by the owner. Birthday emails no longer send by themselves.
 *
 * What a follow-up reads is deliberately small: the guest's first name, their agreement to hear
 * from the studio, the birthday's day and month, and the life event's own words and date. Never
 * notes, Good to remember, consultations, patch tests or visit write-ups, so health details are
 * never used to choose who hears or what they hear. Life events with health words are refused.
 */

/** How many days before the day a draft is suggested. */
export const FOLLOW_UP_DAYS_BEFORE = 7
/** How many days after a life event a "we hope it went well" draft is still suggested. */
export const FOLLOW_UP_DAYS_AFTER = 14
/** How long a gentle offer lasts, from the day it is written. */
export const OFFER_DAYS = 30

/**
 * Words that mark health or medical details, which are kept out of life events. A guest's health
 * belongs in their consultation, which marketing never reads.
 */
const HEALTH_WORDS =
  /\b(pregnan\w*|ivf|fertility|miscarri\w*|surgery|surgical|operation|op|diagnos\w*|cancer|chemo\w*|radiotherapy|tumou?r|illness|ill|sick\w*|hospital\w*|medical|medication|medicine|therapy|therapist|menopaus\w*|mental|depress\w*|anxiety|recover\w*|injur\w*|disease|condition|health|doctor|gp|clinic|scan|bereave\w*|funeral|death|died)\b/i

/** Why a life event's words cannot be kept, or null when they can. */
export function lifeEventRefusal(label: string) {
  if (HEALTH_WORDS.test(label))
    return 'Keep health, medical and bereavement details out of life events. Note those in their consultation instead, which messages never use.'
  return null
}

export const lifeEvents = (s: BusinessState): LifeEvent[] => operations(s).lifeEvents ?? []

/** A guest's life events under all their records, soonest first. */
export function lifeEventsFor(s: BusinessState, clientId: string) {
  const ids = sameGuest(s, clientId)
  return lifeEvents(s)
    .filter((e) => ids.has(e.clientId))
    .sort((a, b) => a.date.localeCompare(b.date))
}

type Message = ReturnType<typeof operations>['messages'][number]
type Occasion =
  | { kind: 'birthday'; key: string; date: string; title: string }
  | { kind: 'event'; key: string; date: string; title: string; event: LifeEvent }

/** The birthday's date this year, or next year once this year's has passed. 29 February moves. */
function nextBirthday(birthday: string, today: string) {
  const at = (year: number) => {
    const leap = new Date(Date.UTC(year, 1, 29)).getUTCMonth() === 1
    return `${year}-${birthday === '02-29' && !leap ? '02-28' : birthday}`
  }
  const year = Number(today.slice(0, 4))
  return at(year) >= today ? at(year) : at(year + 1)
}

/** The follow-up already written for this occasion, for this guest under any of their records. */
export function followUpWritten(
  s: BusinessState,
  clientId: string,
  mark: Pick<FollowUpMark, 'kind' | 'key'>,
): Message | undefined {
  const ids = sameGuest(s, clientId)
  return operations(s).messages.find(
    (m) => ids.has(m.clientId) && m.followUp?.kind === mark.kind && m.followUp.key === mark.key,
  )
}

/** Why this guest cannot be written to now, or null when they can. */
function guestRefusal(s: BusinessState, clientId: string, today: string) {
  const client = s.clients.find((c) => c.id === clientId)
  if (!client || isFormerClient(client)) return 'Client does not belong to this studio.'
  if (!agreedEverywhere(s, clientId))
    return `${client.name} has not agreed to hear from you, so no follow-up can be written.`
  if (!client.email.trim()) return `${client.name} has no email address.`
  if (pastKeepingPeriod(s, clientId, today))
    return `${client.name}’s details are past their keeping period, so they are not written to.`
  return null
}

/** The occasion a follow-up is about, if it falls in the window now. */
function occasionFor(s: BusinessState, clientId: string, about: string, today: string) {
  if (about === 'birthday') {
    const ids = sameGuest(s, clientId)
    // One guest with several records gets one birthday follow-up, from the first record with it.
    const holder = s.clients
      .filter((c) => ids.has(c.id) && c.birthday)
      .sort((a, b) => a.id.localeCompare(b.id))[0]
    if (!holder?.birthday) return null
    const date = nextBirthday(holder.birthday, today)
    if (date > addDays(today, FOLLOW_UP_DAYS_BEFORE)) return null
    return { kind: 'birthday', key: date.slice(0, 4), date, title: 'Birthday' } as Occasion
  }
  const event = lifeEventsFor(s, clientId).find((e) => e.id === about)
  if (!event) return null
  if (event.date > addDays(today, FOLLOW_UP_DAYS_BEFORE)) return null
  if (event.date < addDays(today, -FOLLOW_UP_DAYS_AFTER)) return null
  return { kind: 'event', key: event.id, date: event.date, title: event.label, event } as Occasion
}

export type FollowUpSuggestion = {
  clientId: string
  name: string
  /** 'birthday' or the life event's id, as the draft command takes it. */
  about: string
  kind: 'birthday' | 'event'
  title: string
  date: string
  /** The draft already written for it, if any. */
  messageId?: string
  status?: Message['status']
}

/**
 * The birthdays and life events coming up (or just past, for life events) that a follow-up could
 * mark, for guests who agreed to hear from the studio. Birthdays only while the studio's birthday
 * switch is on. Soonest first.
 */
export function followUpsDue(s: BusinessState, now: string): FollowUpSuggestion[] {
  const today = businessDate(s, now)
  const found: FollowUpSuggestion[] = []
  const seen = new Set<string>()
  const add = (clientId: string, about: string) => {
    if (guestRefusal(s, clientId, today)) return
    const occasion = occasionFor(s, clientId, about, today)
    if (!occasion) return
    const key = `${[...sameGuest(s, clientId)].sort()[0]} ${occasion.kind} ${occasion.key}`
    if (seen.has(key)) return
    seen.add(key)
    const written = followUpWritten(s, clientId, occasion)
    found.push({
      clientId,
      name: s.clients.find((c) => c.id === clientId)!.name,
      about,
      kind: occasion.kind,
      title: occasion.title,
      date: occasion.date,
      ...(written ? { messageId: written.id, status: written.status } : {}),
    })
  }
  if (reminderSettings(s).birthday !== false)
    for (const client of s.clients) if (client.birthday) add(client.id, 'birthday')
  for (const event of lifeEvents(s)) add(event.clientId, event.id)
  return found.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name))
}

/** "your wedding", keeping capitals that look like a name ("your Paris trip"). */
function yours(label: string) {
  const words = label.trim()
  const lower = /^[A-Z][a-z]/.test(words) && !/^[A-Z][a-z]+\s+[A-Z]/.test(words)
  return `your ${lower ? words.charAt(0).toLowerCase() + words.slice(1) : words}`
}

/** The follow-up a guest would receive. The same words are shown before it is written. */
export function followUpDraft(
  s: BusinessState,
  clientId: string,
  about: string,
  now: string,
  percent?: number,
) {
  const today = businessDate(s, now)
  const client = s.clients.find((c) => c.id === clientId)
  const occasion = client && occasionFor(s, clientId, about, today)
  if (!client || !occasion) return null
  const name = firstName(client.name)
  const studio = s.organisation.name
  const locale = s.organisation.locale
  const until = percent ? addDays(today, OFFER_DAYS) : undefined
  const offer = percent
    ? `As a small gift from us, take ${percent}% off your next treatment when you book by ${fullDateLabel(until!, locale)}. Just mention this email when you book.`
    : ''
  const opening =
    occasion.kind === 'birthday'
      ? {
          subject: `Happy birthday, ${name}`,
          line: `Everyone at ${studio} wishes you a very happy birthday. We hope the day is a lovely one.`,
        }
      : occasion.date >= today
        ? {
            subject: `Thinking of you, ${name}`,
            line: `We remembered ${yours(occasion.title)} on ${fullDateLabel(occasion.date, locale)}, and wanted to wish you a wonderful day.`,
          }
        : {
            subject: `We hope it went beautifully, ${name}`,
            line: `We remembered ${yours(occasion.title)} on ${fullDateLabel(occasion.date, locale)}, and hope it went beautifully.`,
          }
  const body = [
    `Hello ${name},`,
    '',
    opening.line,
    ...(offer ? ['', offer] : []),
    '',
    'You are hearing this because you said we could keep in touch. To stop these, reply to this email or tell us at your next visit.',
    '',
    studio,
  ].join('\n')
  const mark: FollowUpMark = {
    kind: occasion.kind,
    key: occasion.key,
    ...(percent ? { percent, until } : {}),
  }
  return { subject: opening.subject, body, mark }
}

type FollowUpCommand = Extract<
  Command,
  { type: 'life-event' | 'life-event-remove' | 'follow-up-draft' }
>
type AddEvent = (
  event: Omit<RelationshipEvent, 'id' | 'organisationId' | 'occurredAt' | 'actor'>,
) => void

/** The same life event recorded again, or a follow-up already written the same way: no change. */
export function followUpUnchanged(s: BusinessState, command: FollowUpCommand, now: string) {
  if (command.type === 'life-event')
    return lifeEvents(s).find(
      (e) =>
        e.clientId === command.clientId &&
        e.date === command.date &&
        e.label.toLowerCase() === command.label.trim().toLowerCase(),
    )?.id
  if (command.type === 'follow-up-draft') {
    const draft = followUpDraft(s, command.clientId, command.about, now, command.percent)
    if (!draft) return undefined
    const written = followUpWritten(s, command.clientId, draft.mark)
    // Approved, or held back, it is settled: writing it again changes nothing.
    if (written && written.status !== 'draft') return written.id
    if (written && (written.followUp?.percent ?? 0) === (command.percent ?? 0)) return written.id
  }
  return undefined
}

export function runFollowUpCommand(
  next: BusinessState,
  command: FollowUpCommand,
  now: string,
  makeId: () => string,
  addEvent: AddEvent,
) {
  const today = businessDate(next, now)
  next.operations = structuredClone(operations(next))
  const o = next.operations
  if (command.type === 'life-event') {
    const client = next.clients.find((c) => c.id === command.clientId)
    if (!client || isFormerClient(client)) throw new Error('Client does not belong to this studio.')
    const refusal = lifeEventRefusal(command.label)
    if (refusal) throw new Error(refusal)
    if (command.date < addDays(today, -FOLLOW_UP_DAYS_AFTER) || command.date > addDays(today, 730))
      throw new Error('Choose a date from the last two weeks up to two years ahead.')
    const list = o.lifeEvents ?? []
    if (list.length >= LIFE_EVENT_LIMIT)
      throw new Error('The studio has as many life events as it can keep. Remove some past ones.')
    const event: LifeEvent = {
      id: makeId(),
      clientId: client.id,
      label: command.label.trim(),
      date: command.date,
      addedAt: now,
      actor: 'Local operator',
    }
    o.lifeEvents = [...list, event]
    addEvent({
      clientId: client.id,
      type: 'profile',
      title: 'Life event recorded',
      detail: `${event.label}, ${fullDateLabel(event.date, next.organisation.locale)}.`,
    })
    return event.id
  }
  if (command.type === 'life-event-remove') {
    const event = (o.lifeEvents ?? []).find((e) => e.id === command.eventId)
    if (!event) throw new Error('That life event is not on record.')
    o.lifeEvents = (o.lifeEvents ?? []).filter((e) => e.id !== event.id)
    // A draft for it not yet approved goes with it; anything approved stays on record.
    o.messages = o.messages.filter(
      (m) => !(m.followUp?.kind === 'event' && m.followUp.key === event.id && !m.approvedAt),
    )
    addEvent({
      clientId: event.clientId,
      type: 'profile',
      title: 'Life event removed',
      detail: event.label,
    })
    return event.id
  }
  const refusal = guestRefusal(next, command.clientId, today)
  if (refusal) throw new Error(refusal)
  if (command.about === 'birthday' && reminderSettings(next).birthday === false)
    throw new Error('Birthday follow-ups are switched off in Marketing, Automatic messages.')
  const draft = followUpDraft(next, command.clientId, command.about, now, command.percent)
  if (!draft)
    throw new Error(
      `A follow-up can be written from ${FOLLOW_UP_DAYS_BEFORE} days before the day, and for a life event up to ${FOLLOW_UP_DAYS_AFTER} days after.`,
    )
  const written = followUpWritten(next, command.clientId, draft.mark)
  if (written && written.status !== 'draft')
    throw new Error('A follow-up for this has already been approved.')
  const message: Message = {
    id: written?.id ?? makeId(),
    clientId: command.clientId,
    purpose: 'marketing',
    channel: 'email',
    subject: draft.subject,
    body: draft.body,
    status: 'draft',
    createdAt: written?.createdAt ?? now,
    actor: 'Local operator',
    followUp: draft.mark,
  }
  o.messages = written
    ? o.messages.map((m) => (m.id === written.id ? message : m))
    : [...o.messages, message]
  addEvent({
    clientId: command.clientId,
    type: 'message',
    title: written ? 'Follow-up rewritten' : 'Follow-up drafted',
    detail: `${draft.subject}${draft.mark.percent ? `, with ${draft.mark.percent}% off` : ''}. A draft until approved in the Inbox.`,
  })
  return message.id
}
