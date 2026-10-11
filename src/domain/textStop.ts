import type { BusinessState, Client, RelationshipEvent } from './model'
import type { Reply, ReplyKeyword, TextStop } from './inboxSchema'
import { TEXT_STOP_LIMIT } from './inboxSchema'

/**
 * Stage 1: STOP and START replies to the studio's text line.
 *
 * The phone networks (and Twilio for them) treat a text that is nothing but one of a few words as
 * an instruction. After STOP they block the studio's texts to that number until it texts START.
 * SALEANE follows the same rule, so what the client page says matches what the network does, and
 * nothing is queued to a number that asked to stop, whether or not it belongs to a client.
 *
 * The rule runs in one place: when the server keeps a text that came in (`reply-received` in
 * inbox.ts), inside the same transaction as keeping it. Only the studio's text line can send that
 * command, so nobody at the desk can make a client say STOP. Email, and email news (consent.ts),
 * are never touched: those are separate choices, and a text never grants either.
 */

/** The phone networks' opt-out words, as Twilio applies them in the UK and the US. */
export const STOP_WORDS = [
  'STOP',
  'STOPALL',
  'UNSUBSCRIBE',
  'CANCEL',
  'END',
  'QUIT',
  'OPTOUT',
  'REVOKE',
] as const
/** Words that undo a STOP. YES counts only for a number that is stopped, as the networks do. */
export const START_WORDS = ['START', 'UNSTOP', 'YES'] as const
/** The networks answer these themselves with the studio's help message. */
export const HELP_WORDS = ['HELP', 'INFO'] as const

type Word = 'stop' | 'start' | 'yes' | 'help'

/**
 * Which keyword a whole text is, or null. Case, spaces around it and punctuation after it do
 * not matter ("Stop.", " stop! "); a keyword inside a longer message never counts ("please don't
 * cancel my visit" is a message, "Cancel" alone is the networks' keyword).
 */
export function textWord(body: string): Word | null {
  const word = body
    .trim()
    .replace(/[\p{P}\s]+$/u, '')
    .toUpperCase()
  if ((STOP_WORDS as readonly string[]).includes(word)) return 'stop'
  if (word === 'YES') return 'yes'
  if ((START_WORDS as readonly string[]).includes(word)) return 'start'
  if ((HELP_WORDS as readonly string[]).includes(word)) return 'help'
  return null
}

/** The same reading of a number as the text line's matching (`textNumber` in reminders.ts). */
const textNumber = (phone: string) => {
  const compact = phone.replace(/[\s().-]/g, '')
  return /^\+[1-9]\d{7,14}$/.test(compact) ? compact : null
}

export const textStops = (s: BusinessState) => s.textStops ?? []

/** The STOP still standing for a number, or undefined when it may be texted. */
export function numberStop(s: BusinessState, number: string | null | undefined) {
  const n = number ? textNumber(number) : null
  if (!n) return undefined
  return textStops(s).find((stop) => stop.number === n && !stop.startedAt)
}
/** Whether a number replied STOP and has not texted START since. Nothing is texted to it. */
export const textsStopped = (s: BusinessState, number: string | null | undefined) =>
  !!numberStop(s, number)

/** Every client whose number is this one; a family can share a number. */
const sharing = (s: BusinessState, number: string) =>
  s.clients.filter((c) => textNumber(c.phone) === number)

type AddEvent = (
  event: Omit<RelationshipEvent, 'id' | 'organisationId' | 'occurredAt' | 'actor'>,
) => void

/** "9 October" on the studio's clock. */
export function dayMonth(s: BusinessState, iso: string) {
  return new Intl.DateTimeFormat(s.organisation.locale, {
    day: 'numeric',
    month: 'long',
    timeZone: s.organisation.timeZone,
  }).format(new Date(iso))
}

/**
 * Acts on a text the studio's line just kept, when it is only a keyword. Returns what it did, to
 * label the reply, and the clients whose timeline already says so; null for an ordinary message.
 * Called only from `reply-received` for a text (inbox.ts), so it runs once per message: a
 * provider sending the same message again is recognised before this runs.
 */
export function applyTextKeyword(
  next: BusinessState,
  reply: Reply,
  now: string,
  addEvent: AddEvent,
): { keyword: ReplyKeyword; told: Set<string> } | null {
  const word = textWord(reply.body)
  if (!word) return null
  const told = new Set<string>()
  if (word === 'help') return { keyword: 'help', told }
  const number = textNumber(reply.from)
  const clients = number ? sharing(next, number) : []
  const standing = number ? numberStop(next, number) : undefined
  if (word === 'stop') {
    if (number && !standing) {
      const stops = (next.textStops ??= [])
      const known = stops.find((stop) => stop.number === number)
      if (known) {
        known.stoppedAt = now
        known.replyId = reply.id
        delete known.startedAt
        delete known.startReplyId
      } else if (stops.length < TEXT_STOP_LIMIT)
        stops.push({ number, stoppedAt: now, replyId: reply.id })
      // A full list (fifty thousand numbers) still turns the clients' own texts off below.
    }
    for (const client of clients) {
      const wasOn = !client.noTextReminders
      if (wasOn) {
        client.noTextReminders = true
        client.textsStoppedAt = now
      }
      delete client.textsAskedAt
      told.add(client.id)
      addEvent({
        clientId: client.id,
        type: 'consent',
        title: wasOn ? 'Texts turned off' : 'Replied STOP by text',
        detail: wasOn
          ? 'Replied STOP by text. No texts from the studio until they text START. Emails and email news unchanged.'
          : 'Replied STOP by text. Texts were already off. Emails and email news unchanged.',
      })
    }
    return { keyword: 'stop', told }
  }
  // YES is an everyday answer, so it undoes a STOP only where there is one to undo.
  if (word === 'yes' && !standing && !clients.some((c) => c.noTextReminders && c.textsStoppedAt))
    return null
  if (standing) {
    standing.startedAt = now
    standing.startReplyId = reply.id
  }
  let changed = !!standing
  let asked = false
  for (const client of clients) {
    if (!client.noTextReminders) continue
    told.add(client.id)
    if (client.textsStoppedAt) {
      const since = dayMonth(next, client.textsStoppedAt)
      delete client.noTextReminders
      delete client.textsStoppedAt
      delete client.textsAskedAt
      changed = true
      addEvent({
        clientId: client.id,
        type: 'consent',
        title: 'Texts turned back on',
        detail: `Replied START by text, after their STOP on ${since}. Emails and email news unchanged.`,
      })
    } else {
      // The desk turned texts off: their record stands, and the team decides.
      client.textsAskedAt = now
      asked = true
      addEvent({
        clientId: client.id,
        type: 'consent',
        title: 'Asked for texts again',
        detail:
          'Replied START by text. Texts stay off, as recorded at the desk, until the team turns them on.',
      })
    }
  }
  return { keyword: asked ? 'asked' : changed ? 'start' : 'already', told }
}

/** Short words for what a keyword reply did, for the Inbox. */
export const keywordLabel: Record<ReplyKeyword, string> = {
  stop: 'Turned texts off',
  start: 'Turned texts back on',
  asked: 'Asked for texts again',
  already: 'Asked for texts',
  help: 'Asked for help',
}
/** A sentence under the label, saying what follows from it. */
export const keywordNote: Record<ReplyKeyword, string> = {
  stop: 'SALEANE will not text this number until they text START. No answer is needed.',
  start: 'Texts can go to this number again. No answer is needed.',
  asked:
    'Texts were turned off at the desk, so they stay off. Turn them on from the client’s page if they want them.',
  already: 'Texts were not turned off. No answer is needed.',
  help: 'Their phone network sends its own help answer. SALEANE does not answer it automatically.',
}
/** A keyword reply that needs nobody to answer it. */
export const settledKeyword = (reply: Pick<Reply, 'keyword'>) =>
  reply.keyword === 'stop' || reply.keyword === 'start' || reply.keyword === 'already'

/** Where a client's texts stand because of a STOP or START reply, for their page. */
export type TextStopState =
  /** Texts are off and they replied STOP. `blocked`: their network blocks the current number. */
  | { kind: 'stopped'; at: string; blocked: boolean }
  /** Texts are off as the desk set them, and they texted START. */
  | { kind: 'asked'; at: string }
  /** Texts are on in their record, but their number replied STOP and has not texted START. */
  | { kind: 'number'; at: string }

export function textStopState(s: BusinessState, client: Client): TextStopState | null {
  const stop = numberStop(s, client.phone)
  if (client.noTextReminders) {
    if (stop) return { kind: 'stopped', at: stop.stoppedAt, blocked: true }
    if (client.textsStoppedAt) return { kind: 'stopped', at: client.textsStoppedAt, blocked: false }
    if (client.textsAskedAt) return { kind: 'asked', at: client.textsAskedAt }
    return null
  }
  return stop ? { kind: 'number', at: stop.stoppedAt } : null
}

/**
 * Whether turning a client's texts back on at the desk needs the team to confirm the client asked:
 * their texts are off and they replied STOP.
 */
export const needsAskedAfterStop = (s: BusinessState, client: Client) =>
  textStopState(s, client)?.kind === 'stopped'

/** parseState checks for the numbers that replied STOP. */
export function textStopProblem(s: BusinessState) {
  const stops: TextStop[] = textStops(s)
  if (stops.length > TEXT_STOP_LIMIT) return 'Too many numbers that replied STOP.'
  if (new Set(stops.map((stop) => stop.number)).size !== stops.length)
    return 'A number that replied STOP was recorded twice.'
  for (const stop of stops)
    if (stop.startedAt && stop.startedAt < stop.stoppedAt)
      return 'A START is recorded before its STOP.'
  return null
}
