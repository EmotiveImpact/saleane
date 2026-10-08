import type { BusinessState, RelationshipEvent } from './model'
import {
  REPLY_LIMIT,
  REPLY_TEXT_LIMIT,
  SAVED_REPLY_LIMIT,
  SOCIAL_ANSWER_COUNT_LIMIT,
  SOCIAL_ANSWER_LIMIT,
  SOCIAL_WINDOW_MS,
  isSocialChannel,
  savedReplyInputSchema,
  socialLabel,
} from './inboxSchema'
import type { Reply, SavedReply, SocialAnswer, SocialChannel, noteWays } from './inboxSchema'
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
export const socialAnswers = (s: BusinessState) => s.socialAnswers ?? []
/** The channels a guest's reply can arrive on from outside, rather than be noted by the team. */
export type ArrivalChannel = 'email' | 'sms' | 'chat' | SocialChannel
/** A number with its country code, as the text line gives it. Kept here: reminders loads the model. */
const textNumber = (phone: string) => {
  const compact = phone.replace(/[\s().-]/g, '')
  return /^\+[1-9]\d{7,14}$/.test(compact) ? compact : null
}

export const unreadReplies = (s: BusinessState) => repliesList(s).filter((r) => !r.readAt)

/** The one client an address or number belongs to, or undefined when none or several do. */
export function senderClient(s: BusinessState, channel: ArrivalChannel, from: string) {
  // Instagram and Facebook give only an id of their own, so the team matches those by hand.
  if (channel === 'instagram' || channel === 'facebook') return undefined
  // A chat leaves an email or a number, whichever the guest gave; WhatsApp gives the number.
  const by =
    channel === 'chat'
      ? from.includes('@')
        ? 'email'
        : 'sms'
      : channel === 'whatsapp'
        ? 'sms'
        : channel
  const matches =
    by === 'sms'
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

/**
 * V4: until when the studio can answer a sender on Instagram, Facebook or WhatsApp: a day after
 * their latest message there. Null when they never wrote on that app.
 */
export function socialWindowEnds(
  s: BusinessState,
  channel: SocialChannel,
  from: string,
  account: string | undefined,
) {
  // A sender's id belongs to the studio account they wrote to, so only messages there count.
  const last = repliesList(s)
    .filter((r) => r.channel === channel && r.from === from && r.account === account)
    .reduce((latest, r) => Math.max(latest, Date.parse(r.receivedAt)), 0)
  return last ? last + SOCIAL_WINDOW_MS : null
}

export type InboxCommand =
  | {
      type: 'reply-received'
      channel: ArrivalChannel
      from: string
      body: string
      providerRef?: string
      /** V4: the name Instagram, Facebook or WhatsApp gave the sender. */
      name?: string
      /** V4: the studio's account it was sent to. */
      account?: string
    }
  | { type: 'social-answer'; replyId: string; body: string }
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
  if (command.type === 'social-answer') {
    const reply = repliesList(next).find((r) => r.id === command.replyId)
    if (!reply || !isSocialChannel(reply.channel))
      throw new Error('That message did not come in on Instagram, Facebook or WhatsApp.')
    const channel = reply.channel
    const app = socialLabel[channel]
    if (!reply.account) throw new Error('This message does not say which account it came to.')
    const ends = socialWindowEnds(next, channel, reply.from, reply.account)
    if (!ends || Date.parse(now) >= ends)
      throw new Error(
        `${app} lets a business answer only within a day of the guest's last message. Answer another way, or wait for them to write again.`,
      )
    const body = command.body.trim()
    if (!body) throw new Error('Write an answer first.')
    if (body.length > SOCIAL_ANSWER_LIMIT)
      throw new Error(`Keep an answer under ${SOCIAL_ANSWER_LIMIT} characters.`)
    refuseHealth(body, 'Answers')
    const answers = (next.socialAnswers ??= [])
    if (answers.length >= SOCIAL_ANSWER_COUNT_LIMIT)
      throw new Error('The studio cannot keep more answers. Please contact support.')
    const answer: SocialAnswer = {
      id: makeId(),
      organisationId: next.organisation.id,
      ...(reply.clientId ? { clientId: reply.clientId } : {}),
      channel,
      to: reply.from,
      account: reply.account,
      body,
      answeredAt: now,
      actor: '',
    }
    answers.push(answer)
    // Answering is reading: everything they sent on that app is now seen.
    for (const r of next.replies ?? [])
      if (r.channel === channel && r.from === reply.from && !r.readAt)
        Object.assign(r, { readAt: now, readBy: '' })
    if (reply.clientId)
      addEvent({
        clientId: reply.clientId,
        type: 'message',
        title: `Answered on ${app}`,
        detail: snippet(body, 120),
      })
    return answer.id
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
    for (const a of next.socialAnswers ?? [])
      if (!a.clientId && a.channel === reply.channel && a.to === reply.from) a.clientId = client.id
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
  const from =
    (command.channel !== 'email' && !command.from.includes('@')
      ? textNumber(command.from)
      : null) ?? command.from.trim()
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
    ...(command.name?.trim() ? { name: command.name.trim().slice(0, 100) } : {}),
    ...(command.account ? { account: command.account.slice(0, 200) } : {}),
    actor: '',
  }
  list.push(reply)
  if (client)
    addEvent({
      clientId: client.id,
      type: 'message',
      title: isSocialChannel(command.channel)
        ? `${socialLabel[command.channel]} message received`
        : command.channel === 'sms'
          ? 'Text received'
          : command.channel === 'chat'
            ? 'Message left with the AI receptionist'
            : 'Email received',
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
  const answered = new Set(socialAnswers(before).map((a) => a.id))
  for (const a of socialAnswers(after)) if (!answered.has(a.id)) a.actor = actor
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
  const answers = socialAnswers(s)
  if (answers.length > SOCIAL_ANSWER_COUNT_LIMIT) return 'Too many answers.'
  if (new Set(answers.map((a) => a.id)).size !== answers.length) return 'Duplicate answer IDs.'
  for (const a of answers) {
    if (a.organisationId !== s.organisation.id) return 'Foreign workspace record.'
    if (a.clientId && !clients.has(a.clientId)) return 'An answer does not match its client.'
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
  channel: 'email' | 'sms' | SocialChannel
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
  /** V4: for an answer on Instagram, Facebook or WhatsApp, its id in the studio record. */
  answerId?: string
}

type Message = ReturnType<typeof operations>['messages'][number]
export type ThreadItem =
  | { kind: 'reply'; at: string; reply: Reply }
  | { kind: 'message'; at: string; message: Message; delivery?: Delivery }
  | { kind: 'sent'; at: string; sent: SentItem }
  | { kind: 'answer'; at: string; answer: SocialAnswer; delivery?: Delivery }

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
    if (row.messageId || row.answerId) {
      deliveries.set((row.messageId ?? row.answerId)!, {
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
  for (const answer of socialAnswers(s)) {
    const delivery = deliveries.get(answer.id)
    thread(answer.clientId, answer.to).items.push({
      kind: 'answer',
      at: answer.answeredAt,
      answer,
      ...(delivery ? { delivery } : {}),
    })
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
