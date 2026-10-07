import type { BusinessState, RelationshipEvent } from './model'
import {
  REPLY_LIMIT,
  REPLY_TEXT_LIMIT,
  SAVED_REPLY_LIMIT,
  savedReplyInputSchema,
} from './inboxSchema'
import type { Reply, SavedReply, noteWays } from './inboxSchema'
import { healthWordIn } from './forms'
import { operations } from './operations'

/**
 * V1.5: the inbox. Each guest's messages read as one conversation: what the studio wrote, what
 * went out on its own (confirmations, reminders and the rest) and what the guest wrote back.
 * Nothing here sends anything; sending stays with the outbox and its providers.
 */

type AddEvent = (
  event: Omit<RelationshipEvent, 'id' | 'organisationId' | 'occurredAt' | 'actor'>,
) => void

export const repliesList = (s: BusinessState) => s.replies ?? []
export const savedReplies = (s: BusinessState) => s.savedReplies ?? []
/** A number with its country code, as the text line gives it. Kept here: reminders loads the model. */
const textNumber = (phone: string) => {
  const compact = phone.replace(/[\s().-]/g, '')
  return /^\+[1-9]\d{7,14}$/.test(compact) ? compact : null
}

export const unreadReplies = (s: BusinessState) => repliesList(s).filter((r) => !r.readAt)

/** The one client an address or number belongs to, or undefined when none or several do. */
export function senderClient(s: BusinessState, channel: 'email' | 'sms', from: string) {
  const matches =
    channel === 'sms'
      ? s.clients.filter((c) => textNumber(c.phone) === textNumber(from))
      : s.clients.filter((c) => c.email.trim().toLowerCase() === from.trim().toLowerCase())
  return matches.length === 1 ? matches[0] : undefined
}

/** A reply first line for a preview or timeline, shortened at a word. */
export function snippet(text: string, max = 140) {
  const line = text.replace(/\s+/g, ' ').trim()
  if (line.length <= max) return line
  return `${line.slice(0, line.lastIndexOf(' ', max - 1) > 40 ? line.lastIndexOf(' ', max - 1) : max - 1)}…`
}

export type InboxCommand =
  | {
      type: 'reply-received'
      channel: 'email' | 'sms'
      from: string
      body: string
      providerRef?: string
    }
  | { type: 'reply-note'; clientId: string; how: (typeof noteWays)[number]; body: string }
  | { type: 'replies-read'; replyIds: string[] }
  | { type: 'reply-link'; replyId: string; clientId: string }
  | { type: 'saved-reply-save'; id?: string; input: { name: string; body: string } }
  | { type: 'saved-reply-remove'; id: string }

/** The record a repeated command points at when it would change nothing. */
export function inboxUnchanged(s: BusinessState, command: InboxCommand) {
  if (command.type === 'reply-received' && command.providerRef) {
    const seen = repliesList(s).find(
      (r) => r.channel === command.channel && r.providerRef === command.providerRef,
    )
    return seen?.id ?? null
  }
  if (command.type === 'replies-read') {
    const wanted = new Set(command.replyIds)
    const rows = repliesList(s).filter((r) => wanted.has(r.id))
    return rows.length === wanted.size && rows.every((r) => r.readAt) ? command.replyIds[0] : null
  }
  if (command.type === 'saved-reply-save' && command.id) {
    const saved = savedReplies(s).find((r) => r.id === command.id)
    const input = savedReplyInputSchema.safeParse(command.input)
    return saved &&
      input.success &&
      saved.name === input.data.name &&
      saved.body === input.data.body
      ? saved.id
      : null
  }
  return null
}

const refuseHealth = (text: string, what: string) => {
  const word = healthWordIn(text)
  if (word)
    throw new Error(
      `${what} here are for everyday words, so they cannot hold health details (“${word}”). Health details wait for the separate clinical part of SALEANE.`,
    )
}

export function runInboxCommand(
  next: BusinessState,
  command: InboxCommand,
  now: string,
  makeId: () => string,
  addEvent: AddEvent,
) {
  if (command.type === 'saved-reply-save') {
    const input = savedReplyInputSchema.parse(command.input)
    refuseHealth(`${input.name}\n${input.body}`, 'Saved replies')
    const list = (next.savedReplies ??= [])
    if (list.some((r) => r.id !== command.id && r.name.toLowerCase() === input.name.toLowerCase()))
      throw new Error('A saved reply already has this name.')
    if (command.id) {
      const saved = list.find((r) => r.id === command.id)
      if (!saved) throw new Error('That saved reply is not in this studio.')
      Object.assign(saved, input)
      return saved.id
    }
    if (list.length >= SAVED_REPLY_LIMIT)
      throw new Error(
        `Keep up to ${SAVED_REPLY_LIMIT} saved replies. Remove one you no longer use.`,
      )
    const saved: SavedReply = { id: makeId(), ...input }
    list.push(saved)
    return saved.id
  }
  if (command.type === 'saved-reply-remove') {
    const list = next.savedReplies ?? []
    if (!list.some((r) => r.id === command.id))
      throw new Error('That saved reply is not in this studio.')
    next.savedReplies = list.filter((r) => r.id !== command.id)
    return command.id
  }
  const list = (next.replies ??= [])
  if (command.type === 'replies-read') {
    const wanted = new Set(command.replyIds)
    const rows = list.filter((r) => wanted.has(r.id))
    if (rows.length !== wanted.size) throw new Error('That reply is not in this studio.')
    for (const r of rows) if (!r.readAt) Object.assign(r, { readAt: now, readBy: '' })
    return command.replyIds[0]
  }
  if (command.type === 'reply-link') {
    const reply = list.find((r) => r.id === command.replyId)
    if (!reply) throw new Error('That reply is not in this studio.')
    if (reply.clientId) throw new Error('This reply is already with a client.')
    const client = next.clients.find((c) => c.id === command.clientId)
    if (!client) throw new Error('Client does not belong to this workspace.')
    // Every reply from the same address or number goes with it, so the conversation stays whole.
    for (const r of list)
      if (!r.clientId && r.channel === reply.channel && r.from === reply.from)
        r.clientId = client.id
    addEvent({
      clientId: client.id,
      type: 'message',
      title: 'Reply matched to this client',
      detail: `From ${reply.from}. ${snippet(reply.body, 120)}`,
    })
    return reply.id
  }
  if (list.length >= REPLY_LIMIT)
    throw new Error('The studio cannot keep more replies. Please contact support.')
  if (command.type === 'reply-note') {
    const client = next.clients.find((c) => c.id === command.clientId)
    if (!client) throw new Error('Client does not belong to this workspace.')
    const body = command.body.trim()
    refuseHealth(body, 'Notes')
    const reply: Reply = {
      id: makeId(),
      organisationId: next.organisation.id,
      clientId: client.id,
      channel: 'desk',
      from: command.how,
      body,
      receivedAt: now,
      actor: '',
      // The person noting it has read it.
      readAt: now,
      readBy: '',
    }
    list.push(reply)
    addEvent({
      clientId: client.id,
      type: 'message',
      title: 'Reply noted',
      detail: `Answered ${command.how === 'elsewhere' ? 'another way' : `by ${command.how === 'phone' ? 'phone' : 'in person'}`}. ${snippet(body, 120)}`,
    })
    return reply.id
  }
  // A guest's own words, as they arrived. Over-long ones are kept to the limit, never refused.
  const from = (command.channel === 'sms' ? textNumber(command.from) : null) ?? command.from.trim()
  const body = command.body.trim().slice(0, REPLY_TEXT_LIMIT) || '(No words, perhaps a picture.)'
  // A sender matched to a client before stays with them, even if their profile has other details.
  const earlier = list
    .filter((r) => r.channel === command.channel && r.from === from.slice(0, 200) && r.clientId)
    .at(-1)
  const client =
    (earlier && next.clients.find((c) => c.id === earlier.clientId)) ??
    senderClient(next, command.channel, from)
  const reply: Reply = {
    id: makeId(),
    organisationId: next.organisation.id,
    ...(client ? { clientId: client.id } : {}),
    channel: command.channel,
    from: from.slice(0, 200),
    body,
    receivedAt: now,
    ...(command.providerRef ? { providerRef: command.providerRef.slice(0, 200) } : {}),
    actor: '',
  }
  list.push(reply)
  if (client)
    addEvent({
      clientId: client.id,
      type: 'message',
      title: command.channel === 'sms' ? 'Text received' : 'Email received',
      detail: snippet(body, 120),
    })
  return reply.id
}

/** Fills in who noted each new reply, and who read each one. */
export function stampInboxActors(before: BusinessState, after: BusinessState, actor: string) {
  const known = new Map(repliesList(before).map((r) => [r.id, r]))
  for (const r of repliesList(after)) {
    const old = known.get(r.id)
    if (!old) r.actor = actor
    if (r.readAt && !old?.readAt) r.readBy = actor
  }
}

/** parseState checks for replies and saved replies. */
export function inboxProblem(s: BusinessState) {
  const list = repliesList(s)
  if (list.length > REPLY_LIMIT) return 'Too many replies.'
  if (new Set(list.map((r) => r.id)).size !== list.length) return 'Duplicate reply IDs.'
  const refs = list.filter((r) => r.providerRef).map((r) => `${r.channel}:${r.providerRef}`)
  if (new Set(refs).size !== refs.length) return 'A reply was recorded twice.'
  const clients = new Set(s.clients.map((c) => c.id))
  for (const r of list) {
    if (r.organisationId !== s.organisation.id) return 'Foreign workspace record.'
    if (r.clientId && !clients.has(r.clientId)) return 'A reply does not match its client.'
    if (r.channel === 'desk' && !r.clientId) return 'A noted reply must be with a client.'
  }
  const saved = savedReplies(s)
  if (saved.length > SAVED_REPLY_LIMIT) return 'Too many saved replies.'
  if (new Set(saved.map((r) => r.id)).size !== saved.length) return 'Duplicate saved reply IDs.'
  return null
}

/** What happened to an approved message once the outbox took it, when the server says. */
export type Delivery = {
  status: 'pending' | 'test' | 'accepted' | 'delivered' | 'failed' | 'unknown' | 'skipped'
  provider: string | null
  detail: string | null
  updatedAt: string
}
/** A message that went out on its own, as the outbox lists it. */
export type SentItem = {
  id: string
  clientId: string
  kind: string
  channel: 'email' | 'sms'
  recipient: string
  subject: string
  body: string
  status: Delivery['status']
  provider: string | null
  detail: string | null
  createdAt: string
  updatedAt: string
  /** For a message the studio wrote in the inbox, its id in the studio record. */
  messageId?: string
}

type Message = ReturnType<typeof operations>['messages'][number]
export type ThreadItem =
  | { kind: 'reply'; at: string; reply: Reply }
  | { kind: 'message'; at: string; message: Message; delivery?: Delivery }
  | { kind: 'sent'; at: string; sent: SentItem }

export type Conversation = {
  /** `client:<id>` for a guest, `from:<address>` for a sender who matches no client. */
  key: string
  clientId?: string
  from?: string
  items: ThreadItem[]
  lastAt: string
  unread: number
  drafts: number
}

/**
 * Every guest's conversation, the newest first. `sent` is the outbox's list when the server
 * gives one; a message the studio wrote is shown once, with what the outbox did with it.
 */
export function conversations(s: BusinessState, sent: SentItem[] = []): Conversation[] {
  const threads = new Map<string, Conversation>()
  const thread = (clientId: string | undefined, from?: string) => {
    const key = clientId ? `client:${clientId}` : `from:${from}`
    let t = threads.get(key)
    if (!t) {
      t = {
        key,
        ...(clientId ? { clientId } : { from }),
        items: [],
        lastAt: '',
        unread: 0,
        drafts: 0,
      }
      threads.set(key, t)
    }
    return t
  }
  const deliveries = new Map<string, Delivery>()
  for (const row of sent) {
    if (row.messageId) {
      deliveries.set(row.messageId, {
        status: row.status,
        provider: row.provider,
        detail: row.detail,
        updatedAt: row.updatedAt,
      })
      continue
    }
    thread(row.clientId || undefined, row.recipient).items.push({
      kind: 'sent',
      at: row.createdAt,
      sent: row,
    })
  }
  for (const message of operations(s).messages) {
    const t = thread(message.clientId)
    const delivery = deliveries.get(message.id)
    t.items.push({
      kind: 'message',
      at: message.createdAt,
      message,
      ...(delivery ? { delivery } : {}),
    })
    if (message.status === 'draft') t.drafts += 1
  }
  for (const reply of repliesList(s)) {
    const t = thread(reply.clientId, reply.from)
    t.items.push({ kind: 'reply', at: reply.receivedAt, reply })
    if (!reply.readAt) t.unread += 1
  }
  const all = [...threads.values()]
  for (const t of all) {
    t.items.sort((a, b) => a.at.localeCompare(b.at))
    t.lastAt = t.items[t.items.length - 1]?.at ?? ''
  }
  return all.sort((a, b) => b.lastAt.localeCompare(a.lastAt))
}
