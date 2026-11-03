import type { Appointment, BusinessState, Client, RelationshipEvent } from './model'
import type { Command } from './commandSchema'
import { businessDate, businessMinutes, instantFor, operations } from './operations'
import { places } from './locations'
import { addDays } from './format'
import { textsStopped } from './textStop'
import { consentRecords, suppressQueuedNews, wordingFor } from './consent'
import type { ConsentRecord } from './consentSchema'
import { NEWS_LIMIT, NEWS_MONTHS } from './newsSchema'
import type { NewsInput, NewsMessage, NewsWay } from './newsSchema'

/**
 * Stage 4: one message from the studio to its clients, across the whole group or for chosen
 * locations (see newsSchema.ts for the record).
 *
 * Who receives it is worked out here, in one place, and the same rule runs three times: on the
 * draft, so the owner sees exactly how many it would reach; inside the approval itself, which goes
 * ahead only if the numbers still match what the owner saw; and again for each client just before
 * their copy leaves the outbox. A client receives it only when they agreed to news and offers
 * under every record they have, never after replying STOP to the studio's texts or asking to be
 * erased, and once only, however many records or locations they have. Texts go only to clients
 * whose agreement named texts; everyone else who agreed is emailed.
 *
 * This module must not import reminders.ts: reminders.ts imports guest.ts, which needs model.ts,
 * and model.ts checks these records through `newsProblem`.
 */

type AddEvent = (
  event: Omit<RelationshipEvent, 'id' | 'organisationId' | 'occurredAt' | 'actor'>,
) => void
type NewsCommand = Extract<
  Command,
  { type: 'news-save' | 'news-approve' | 'news-stop' | 'news-discard' | 'news-unsubscribe' }
>

/** Where the unsubscribe link goes. The outbox swaps it for a fresh private link for each client. */
export const NEWS_STOP_LINK = '{{news_stop_link}}'
/** The studio's booking page, swapped in by the outbox. The same words as BOOK_LINK in reminders.ts. */
export const NEWS_BOOK_LINK = '{{book_link}}'
/** Messages go out only between 09:00 and 19:00 on the studio's clock, as other guest messages do. */
export const NEWS_HOURS = { from: 9 * 60, to: 19 * 60 }
/** A copy that could not go within this many days of approval is not sent at all. */
export const NEWS_STALE_DAYS = 3
/** Every text says how to stop texts. */
export const NEWS_TEXT_STOP = 'Reply STOP to stop texts.'

export const newsMessages = (s: BusinessState): NewsMessage[] => operations(s).news ?? []
export const newsMessage = (s: BusinessState, id: string) =>
  newsMessages(s).find((m) => m.id === id)

export const newsWayLabel: Record<NewsWay, string> = {
  email: 'By email',
  either: 'By text where they agreed to texts, otherwise by email',
}

/** Who a message is for, in words. */
export function newsScopeLabel(s: BusinessState, message: Pick<NewsMessage, 'locationIds'>) {
  if (!message.locationIds?.length) return 'Every client of the studio'
  const names = message.locationIds.map(
    (id) => places(s, true).find((p) => p.id === id)?.name ?? 'a location no longer listed',
  )
  return `Clients of ${names.length < 2 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`}`
}

/** The rule for "clients of a location", as the screen says it. */
export const NEWS_LOCATION_RULE = `A client of a location had a visit there in the last ${NEWS_MONTHS} months, or has one booked there.`

/** A message only for this location, which a general manager there may see and look after. */
export const newsOnlyAt = (message: Pick<NewsMessage, 'locationIds'>, locationId: string) =>
  message.locationIds?.length === 1 && message.locationIds[0] === locationId

/** The same reading of a number as the outbox's (`textNumber` in reminders.ts). */
function textNumber(phone: string) {
  const compact = phone.replace(/[\s().-]/g, '')
  return /^\+[1-9]\d{7,14}$/.test(compact) ? compact : null
}
/** The same day some months earlier or later, or the month's last day when it is shorter. */
function addMonths(date: string, months: number) {
  const [year, month, day] = date.split('-').map(Number)
  const last = new Date(Date.UTC(year, month - 1 + months + 1, 0)).getUTCDate()
  return new Date(Date.UTC(year, month - 1 + months, Math.min(day, last)))
    .toISOString()
    .slice(0, 10)
}
export function firstName(name: string) {
  return name.trim().split(/\s+/)[0] || name
}
/** One guest under all their records: online booking can open a new record with the same email. */
const guestKey = (c: Pick<Client, 'id' | 'email'>) => c.email.trim().toLowerCase() || `id:${c.id}`

/** Words that show an agreement covered texts, such as "by email or text". */
const TEXT_WORDS = /\b(texts?|text messages?|sms)\b/i
function newestRecords(s: BusinessState) {
  const newest = new Map<string, ConsentRecord>()
  for (const r of consentRecords(s)) newest.set(r.clientId, r)
  return newest
}
/** Whether the words this client last agreed to named texts as well as email. */
function agreedToTexts(s: BusinessState, record: ConsentRecord | undefined) {
  if (!record?.given || !record.wordingVersion) return false
  const words = wordingFor(s, record.wordingVersion)
  return !!words && TEXT_WORDS.test(words.text)
}
export function newsByTextAgreed(s: BusinessState, clientId: string) {
  const rows = consentRecords(s)
  for (let i = rows.length - 1; i >= 0; i -= 1)
    if (rows[i].clientId === clientId) return agreedToTexts(s, rows[i])
  return false
}

export const newsReasons = ['erased', 'not-agreed', 'stopped'] as const
export type NewsReason = (typeof newsReasons)[number]
export const newsReasonLabel: Record<NewsReason, string> = {
  erased: 'Asked to have their details erased',
  'not-agreed': 'Have not agreed to news and offers',
  stopped: 'Replied STOP to the studio’s texts',
}
export type NewsRecipient = {
  clientId: string
  channel: 'email' | 'sms'
  /** The location they belong to for this message, or null for no recent visit. */
  locationId: string | null
}
export type NewsAudience = {
  recipients: NewsRecipient[]
  email: number
  text: number
  total: number
  byLocation: { locationId: string | null; email: number; text: number }[]
  leftOut: { reason: NewsReason; count: number }[]
  leftOutTotal: number
  /** Sent an email because their agreement did not name texts, when texts were asked for. */
  emailNotText: number
}

const past = (a: Appointment) => a.status === 'completed' || a.status === 'arrived'
const later = (a: Appointment, b: Appointment) =>
  a.date !== b.date
    ? a.date > b.date
    : a.startMinutes !== b.startMinutes
      ? a.startMinutes > b.startMinutes
      : a.id > b.id

/**
 * Who a message would reach right now, and who would be left out and why. Pure: the same records,
 * time and erasure requests always give the same answer, in the same order.
 */
export function newsAudience(
  s: BusinessState,
  message: Pick<NewsInput, 'by' | 'locationIds'>,
  at: { now: string; erased?: readonly string[] },
): NewsAudience {
  const today = businessDate(s, at.now)
  const from = addMonths(today, -NEWS_MONTHS)
  const chosen = message.locationIds?.length ? new Set(message.locationIds) : null
  const erased = new Set(at.erased ?? [])
  const keyOf = new Map<string, string>()
  const members = new Map<string, Client[]>()
  for (const c of s.clients) {
    const key = guestKey(c)
    keyOf.set(c.id, key)
    members.set(key, [...(members.get(key) ?? []), c])
  }
  // For each guest: their latest visit within the window, and failing that their next booked one.
  const lastVisit = new Map<string, Appointment>()
  const nextVisit = new Map<string, Appointment>()
  for (const a of s.appointments) {
    const key = keyOf.get(a.clientId)
    if (!key || (chosen && !chosen.has(a.locationId))) continue
    if (past(a) && a.date >= from && a.date <= today) {
      const best = lastVisit.get(key)
      if (!best || later(a, best)) lastVisit.set(key, a)
    } else if (a.status === 'confirmed' && a.date >= today) {
      const best = nextVisit.get(key)
      if (!best || later(best, a)) nextVisit.set(key, a)
    }
  }
  const newest = newestRecords(s)
  const usedNumbers = new Set<string>()
  const recipients: NewsRecipient[] = []
  const left = new Map<NewsReason, number>()
  let emailNotText = 0
  for (const key of [...members.keys()].sort()) {
    const visit = lastVisit.get(key) ?? nextVisit.get(key)
    if (chosen && !visit) continue
    const records = members.get(key)!
    const primary =
      (visit && records.find((c) => c.id === visit.clientId)) ??
      [...records].sort((a, b) => a.id.localeCompare(b.id))[0]
    const reason: NewsReason | null = records.some((c) => erased.has(c.id))
      ? 'erased'
      : !records.every((c) => c.marketingConsent)
        ? 'not-agreed'
        : records.some((c) => textsStopped(s, c.phone))
          ? 'stopped'
          : null
    if (reason) {
      left.set(reason, (left.get(reason) ?? 0) + 1)
      continue
    }
    let channel: NewsRecipient['channel'] = 'email'
    if (message.by === 'either') {
      const number = textNumber(primary.phone)
      if (
        agreedToTexts(s, newest.get(primary.id)) &&
        !primary.noTextReminders &&
        number &&
        !usedNumbers.has(number)
      ) {
        channel = 'sms'
        usedNumbers.add(number)
      } else emailNotText += 1
    }
    recipients.push({ clientId: primary.id, channel, locationId: visit?.locationId ?? null })
  }
  const order = places(s, true).map((p) => p.id)
  const groups = new Map<string | null, { email: number; text: number }>()
  for (const r of recipients) {
    const group = groups.get(r.locationId) ?? { email: 0, text: 0 }
    if (r.channel === 'sms') group.text += 1
    else group.email += 1
    groups.set(r.locationId, group)
  }
  const rank = (id: string | null) => (id === null ? order.length : order.indexOf(id))
  const email = recipients.filter((r) => r.channel === 'email').length
  const leftOut = newsReasons
    .filter((reason) => left.has(reason))
    .map((reason) => ({ reason, count: left.get(reason)! }))
  return {
    recipients,
    email,
    text: recipients.length - email,
    total: recipients.length,
    byLocation: [...groups]
      .map(([locationId, n]) => ({ locationId, ...n }))
      .sort((a, b) => rank(a.locationId) - rank(b.locationId)),
    leftOut,
    leftOutTotal: leftOut.reduce((sum, l) => sum + l.count, 0),
    emailNotText,
  }
}

/** The numbers alone, which is all any screen shows. Never a list of who. */
export function newsSummary(audience: NewsAudience) {
  const { recipients: _who, ...numbers } = audience
  void _who
  return numbers
}
export type NewsSummary = ReturnType<typeof newsSummary>

/**
 * Whether one client may still receive their copy now, and where it goes, checked just before it
 * leaves the outbox: the message is still approved, and the client still agreed under every
 * record, has not replied STOP, has not asked to be erased, and can be reached the same way.
 */
export function newsStillFor(
  s: BusinessState,
  messageId: string,
  clientId: string,
  channel: string,
  erased: readonly string[] = [],
): { to: string } | { skip: string } {
  const message = newsMessage(s, messageId)
  if (!message || message.status !== 'approved' || message.sample)
    return { skip: 'Stopped before it went out.' }
  const client = s.clients.find((c) => c.id === clientId)
  if (!client) return { skip: 'The client is no longer in the studio record.' }
  const key = guestKey(client)
  const records = s.clients.filter((c) => guestKey(c) === key)
  const gone = new Set(erased)
  if (records.some((c) => gone.has(c.id)))
    return { skip: 'They asked to have their details erased before it went out.' }
  if (!records.every((c) => c.marketingConsent))
    return { skip: 'News and offers were no longer agreed before it went out.' }
  if (records.some((c) => textsStopped(s, c.phone)))
    return { skip: 'They replied STOP to the studio’s texts before it went out.' }
  if (channel === 'sms') {
    const number = textNumber(client.phone)
    if (!number || client.noTextReminders || !newsByTextAgreed(s, client.id))
      return { skip: 'Texts were no longer possible for this client before it went out.' }
    return { to: number }
  }
  if (channel !== 'email') return { skip: 'This message goes by email or text only.' }
  const email = client.email.trim()
  return email ? { to: email } : { skip: 'The client has no email address now.' }
}

/** Curly quotes and the like would make every part of a text hold 70 characters, not 160. */
function plainForText(text: string) {
  return text
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/…/g, '...')
    .replace(/[\u2010-\u2015]/g, '-')
}

/**
 * The email one client receives. Placeholders are filled by the outbox as it goes. A preview passes
 * the words to greet with instead of a client, such as "[first name]".
 */
export function newsEmail(
  s: BusinessState,
  message: Pick<NewsMessage, 'subject' | 'body' | 'bookLink'>,
  to?: Pick<Client, 'name'> | { greet: string },
) {
  const studio = s.organisation.name
  const hello = !to ? 'there' : 'greet' in to ? to.greet : firstName(to.name)
  const lines = [`Hello ${hello},`, '', message.body.trim()]
  if (message.bookLink) lines.push('', `Book when it suits you: ${NEWS_BOOK_LINK}`)
  lines.push(
    '',
    `You are hearing from ${studio} because you agreed to news and offers. To stop them, use this link: ${NEWS_STOP_LINK}`,
    '',
    studio,
  )
  return { subject: message.subject.trim(), body: lines.join('\n') }
}

/** The text one client receives: the studio's name first, and how to stop texts last. */
export function newsText(s: BusinessState, message: Pick<NewsMessage, 'body' | 'bookLink'>) {
  const lines = [`${s.organisation.name}: ${message.body.trim()}`]
  if (message.bookLink) lines.push(`Book: ${NEWS_BOOK_LINK}`)
  lines.push(NEWS_TEXT_STOP)
  return plainForText(lines.join('\n'))
}

const GSM =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà'
const GSM_EXTRA = '^{}\\[~]|€\f'
/**
 * How long a text is and how many parts it is sent in. Plain characters fit 160 to a text, or 153
 * a part once it is split; a character outside that set (an emoji, most accents) makes it 70, or
 * 67 a part. A few characters, such as € and square brackets, take two places.
 */
export function textParts(text: string) {
  let length = 0
  for (const ch of text) {
    if (GSM.includes(ch)) length += 1
    else if (GSM_EXTRA.includes(ch)) length += 2
    else {
      const units = text.length
      return { characters: units, parts: units <= 70 ? 1 : Math.ceil(units / 67), plain: false }
    }
  }
  return { characters: length, parts: length <= 160 ? 1 : Math.ceil(length / 153), plain: true }
}

/** Whether it is daytime on the studio's clock, when a message may go. */
export function newsDaytime(s: BusinessState, at: number) {
  const minutes = businessMinutes(s, new Date(at).toISOString())
  return minutes >= NEWS_HOURS.from && minutes < NEWS_HOURS.to
}
/** The first moment from `at` a message may go: now in the daytime, otherwise 09:00 next. */
export function newsSendFrom(s: BusinessState, at: number) {
  if (newsDaytime(s, at)) return at
  const iso = new Date(at).toISOString()
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: s.organisation.timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(at))
  const today = parts.slice(0, 10)
  const day = businessMinutes(s, iso) < NEWS_HOURS.from ? today : addDays(today, 1)
  return Date.parse(instantFor(s, day, NEWS_HOURS.from))
}

const locationProblem = (s: BusinessState, ids: readonly string[] | undefined) => {
  if (!ids) return null
  const open = new Set(places(s).map((p) => p.id))
  return ids.every((id) => open.has(id)) ? null : 'Choose locations the studio has open.'
}
const sameInput = (m: NewsMessage, input: NewsInput) =>
  m.subject === input.subject &&
  m.body === input.body &&
  m.by === input.by &&
  JSON.stringify(m.locationIds ?? null) === JSON.stringify(input.locationIds ?? null) &&
  !!m.bookLink === !!input.bookLink

/** Every record of the guest this client is, by email. */
const guestRecords = (s: BusinessState, client: Client) =>
  s.clients.filter((c) => guestKey(c) === guestKey(client))

/** The record a repeated request points at when it would change nothing. */
export function newsUnchanged(s: BusinessState, command: NewsCommand) {
  if (command.type === 'news-unsubscribe') {
    const client = s.clients.find((c) => c.id === command.clientId)
    return client && guestRecords(s, client).every((c) => !c.marketingConsent) ? client.id : null
  }
  const id = command.type === 'news-save' ? command.id : command.messageId
  const message = id ? newsMessage(s, id) : undefined
  if (!message) return null
  if (command.type === 'news-save')
    return message.status === 'draft' && sameInput(message, command.input) ? message.id : null
  // Approving again, from a second tab or a repeated tap, queues nothing more.
  if (command.type === 'news-approve')
    return message.status === 'approved' || message.status === 'stopped' ? message.id : null
  if (command.type === 'news-stop') return message.status === 'stopped' ? message.id : null
  return message.status === 'discarded' ? message.id : null
}

/** What the client's timeline says, without the message itself. */
function timelineDetail(s: BusinessState, message: NewsMessage, channel: 'email' | 'sms') {
  const way = channel === 'sms' ? 'by text' : 'by email'
  return operations(s).mode === 'sandbox'
    ? `“${message.subject}”, ${way}. A sample studio, so nothing was queued or sent.`
    : `“${message.subject}”, ${way}. Queued to go out, not sent yet. Whether it went shows with their messages.`
}

export function runNewsCommand(
  next: BusinessState,
  command: NewsCommand,
  now: string,
  makeId: () => string,
  addEvent: AddEvent,
) {
  const o = (next.operations ??= operations(next))
  const list = (o.news ??= [])
  if (command.type === 'news-save') {
    const problem = locationProblem(next, command.input.locationIds)
    if (problem) throw new Error(problem)
    const fields = {
      subject: command.input.subject,
      body: command.input.body,
      by: command.input.by,
      ...(command.input.locationIds ? { locationIds: command.input.locationIds } : {}),
      ...(command.input.bookLink ? { bookLink: true as const } : {}),
    }
    if (command.id) {
      const old = list.find((m) => m.id === command.id)
      if (!old) throw new Error('This message is not in the studio record.')
      if (old.status === 'discarded') throw new Error('This draft was put aside. Write a new one.')
      if (old.status !== 'draft')
        throw new Error('This message is approved, so it can no longer be changed.')
      delete old.locationIds
      delete old.bookLink
      Object.assign(old, fields, { editedAt: now, editedBy: '' })
      return old.id
    }
    if (list.length >= NEWS_LIMIT)
      throw new Error(
        'The studio cannot keep more messages to clients. Put old drafts aside first.',
      )
    const message: NewsMessage = {
      id: makeId(),
      ...fields,
      status: 'draft',
      createdAt: now,
      actor: 'Local operator',
    }
    list.push(message)
    return message.id
  }
  if (command.type === 'news-unsubscribe') {
    const client = next.clients.find((c) => c.id === command.clientId)
    if (!client) throw new Error('This client is not in the studio record.')
    if (!list.some((m) => m.id === command.messageId && m.approvedAt))
      throw new Error('This message is not in the studio record.')
    // One person, however many records: news stops under every one of them.
    for (const c of guestRecords(next, client)) {
      c.marketingConsent = false
      suppressQueuedNews(next, c.id)
    }
    addEvent({
      clientId: client.id,
      type: 'consent',
      title: 'Email marketing withdrawn',
      detail: 'Stopped from the link in a message to clients. No message sent.',
    })
    return client.id
  }
  const message = list.find((m) => m.id === command.messageId)
  if (!message) throw new Error('This message is not in the studio record.')
  if (command.type === 'news-discard') {
    if (message.status !== 'draft') throw new Error('Only a draft can be put aside.')
    Object.assign(message, { status: 'discarded', discardedAt: now, discardedBy: '' })
    return message.id
  }
  if (command.type === 'news-stop') {
    if (message.status !== 'approved') throw new Error('Only an approved message can be stopped.')
    Object.assign(message, { status: 'stopped', stoppedAt: now, stoppedBy: '' })
    return message.id
  }
  // news-approve: the numbers are worked out again now, and must be the ones the owner saw.
  if (message.status !== 'draft') throw new Error('Only a draft can be approved.')
  const audience = newsAudience(next, message, { now, erased: command.erased })
  if (!audience.total)
    throw new Error(
      'Nobody can receive this message yet: no client of these locations has agreed to news and offers.',
    )
  if (audience.email !== command.expect.email || audience.text !== command.expect.text)
    throw new Error(
      `The numbers changed since you looked. It would now go to ${clients(audience.total)}: ${audience.email} by email and ${audience.text} by text. Check them and approve again.`,
    )
  Object.assign(message, {
    status: 'approved',
    approvedAt: now,
    approvedBy: '',
    toEmail: audience.email,
    toText: audience.text,
    leftOut: audience.leftOutTotal,
    ...(o.mode === 'sandbox' ? { sample: true } : {}),
  })
  for (const r of audience.recipients)
    addEvent({
      clientId: r.clientId,
      type: 'message',
      title: 'Message to clients',
      detail: timelineDetail(next, message, r.channel),
    })
  return message.id
}

export const clients = (n: number) =>
  `${n.toLocaleString('en-GB')} ${n === 1 ? 'client' : 'clients'}`

/** Fills in who wrote, changed, approved, stopped or put aside each message. */
export function stampNewsActors(before: BusinessState, after: BusinessState, actor: string) {
  const was = new Map(newsMessages(before).map((m) => [m.id, m]))
  for (const m of newsMessages(after)) {
    const old = was.get(m.id)
    if (!old) m.actor = actor
    if (m.editedAt && m.editedAt !== old?.editedAt) m.editedBy = actor
    if (m.approvedAt && !old?.approvedAt) m.approvedBy = actor
    if (m.stoppedAt && !old?.stoppedAt) m.stoppedBy = actor
    if (m.discardedAt && !old?.discardedAt) m.discardedBy = actor
  }
}

/** parseState checks: ids unique, and each message's dates agree with where it stands. */
export function newsProblem(s: BusinessState) {
  const list = newsMessages(s)
  if (new Set(list.map((m) => m.id)).size !== list.length) return 'Duplicate message ids.'
  for (const m of list) {
    const approved = !!m.approvedAt && m.toEmail !== undefined && m.toText !== undefined
    if (m.status === 'draft' && (m.approvedAt || m.stoppedAt || m.discardedAt))
      return 'A draft message carries a later step.'
    if (m.status === 'approved' && (!approved || m.stoppedAt || m.discardedAt))
      return 'An approved message is missing its approval.'
    if (m.status === 'stopped' && (!approved || !m.stoppedAt))
      return 'A stopped message is missing its approval or stop.'
    if (m.status === 'discarded' && (!m.discardedAt || m.approvedAt))
      return 'A message put aside carries an approval.'
  }
  return null
}

/** A general manager reads only the messages for their own location. */
export function newsAt(s: BusinessState, locationId: string): NewsMessage[] {
  return newsMessages(s).filter((m) => newsOnlyAt(m, locationId))
}
/** The front desk does not write to clients in bulk, so it does not receive these drafts. */
export function withoutNews(s: BusinessState): BusinessState {
  if (!s.operations?.news) return s
  const { news: _news, ...rest } = s.operations
  void _news
  return { ...s, operations: rest }
}
