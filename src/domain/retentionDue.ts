import type { BusinessState, Client } from './model'
import { operations } from './operations'
import { addDays, fullDateLabel } from './format'
import { localDate } from './patchTests'
import { sameGuest } from './dueBack'
import { extendRetention } from './dataRetention'
import type { ExtensionUnit } from './dataRetention'
import { RETENTION_DECISIONS_KEPT, RETENTION_KINDS } from './retentionSchema'
import type {
  RetentionDecision,
  RetentionKeep,
  RetentionKind,
  RetentionRecord,
} from './retentionSchema'

/**
 * Stage 6: records that have reached the end of their keeping period (the register in
 * dataRetention.ts, decided by the owner on 7 October 2026), and the two choices an owner or
 * manager has for them: approve deleting them, or keep them longer.
 *
 * Nothing here runs by itself. A record is due on a date worked out from the studio record on the
 * studio's own day; it waits in Settings, Data & privacy until someone with the right to decide
 * (`DELETION_APPROVERS`) does. A record kept longer comes back on its new date.
 *
 * Deleting is safe and honest:
 * - A client's details go (name, email, phone, Good to remember, notes, connections, unsent
 *   messages, replies, missed calls, waitlist requests and private feedback: the "could be removed"
 *   list of the erasure review in privacy.ts). Their money records stay, because the law says they
 *   must (6 years in the UK, 7 in the US): receipts, payments, deposits, refunds, gift cards,
 *   packages and booked visit terms keep their ids and amounts under the name "Former client".
 * - A client with an active package or membership, or money still owed or held for them, is never
 *   due: the studio still has business with them.
 * - The decision is kept as who, when, which kind and how many, never what was deleted.
 */

export const FORMER_CLIENT = 'Former client'
/** Years the law keeps money records after the latest of them, by where the studio is. */
export const MONEY_YEARS = { UK: 6, US: 7 } as const

export const retentionKinds: Record<
  RetentionKind,
  { label: string; one: string; many: string; period: string }
> = {
  client: {
    label: 'Client details',
    one: 'client’s details',
    many: 'clients’ details',
    period: 'Kept 2 years after their last visit.',
  },
  feedback: {
    label: 'Private feedback',
    one: 'piece of private feedback',
    many: 'pieces of private feedback',
    period: 'Kept 2 years after it was given.',
  },
  message: {
    label: 'Unsent messages',
    one: 'unsent message',
    many: 'unsent messages',
    period: 'Drafts, queued and held back messages are kept 90 days.',
  },
  waitlist: {
    label: 'Waitlist requests',
    one: 'waitlist request',
    many: 'waitlist requests',
    period: 'Kept 90 days after the dates asked for.',
  },
}

/** "1 client’s details", "3 pieces of private feedback". */
export function retentionCount(kind: RetentionKind, count: number) {
  const words = retentionKinds[kind]
  return `${count} ${count === 1 ? words.one : words.many}`
}

export type DueRecord = {
  kind: RetentionKind
  id: string
  /** What the record is, as the owner knows it: a client's name, a message's subject. */
  title: string
  /** Why it is due, in words: "Last visit 12 March 2024." */
  why: string
  /** The day it became due: its period's end, or the day it was kept until. */
  dueOn: string
  /** When it was kept longer before, the day that ran to. */
  keptUntil?: string
}
export type DueGroup = { kind: RetentionKind; label: string; period: string; records: DueRecord[] }

const empty = (): RetentionRecord => ({ kept: [], decisions: [] })
export const retentionRecord = (s: BusinessState): RetentionRecord =>
  operations(s).retention ?? empty()

const keyOf = (kind: RetentionKind, id: string) => `${kind}:${id}`
function keptMap(s: BusinessState) {
  return new Map(retentionRecord(s).kept.map((k) => [keyOf(k.kind, k.recordId), k]))
}
const later = (a: string, b: string) => (a > b ? a : b)

/** Whether a client record has already had its details deleted. */
export const isFormerClient = (client: Pick<Client, 'erasedAt'>) => !!client.erasedAt

/**
 * The last day the studio had business with a client: their last visit (any visit booked, kept or
 * not), purchase, message or the day they joined, under any of their records with the same email,
 * since online booking can open a fresh record for the same guest.
 */
export function lastActivity(s: BusinessState, clientId: string) {
  const records = sameGuest(s, clientId)
  let last = ''
  for (const c of s.clients) if (records.has(c.id)) last = later(last, localDate(s, c.createdAt))
  for (const a of s.appointments) if (records.has(a.clientId)) last = later(last, a.date)
  for (const sale of s.counterSales ?? [])
    if (sale.clientId && records.has(sale.clientId)) last = later(last, localDate(s, sale.paidAt))
  for (const r of s.replies ?? [])
    if (r.clientId && records.has(r.clientId)) last = later(last, localDate(s, r.receivedAt))
  for (const h of s.holdings ?? [])
    if (records.has(h.clientId))
      last = later(last, [h.startedOn, h.paidUntil ?? '', h.endsOn ?? ''].reduce(later))
  return last
}

/** Why a client is not due however long ago they visited, or null. */
export function clientHeld(s: BusinessState, clientId: string): string | null {
  const records = sameGuest(s, clientId)
  if ((s.holdings ?? []).some((h) => records.has(h.clientId) && h.status === 'active'))
    return 'They have an active package or membership.'
  if ((operations(s).balances ?? []).some((b) => records.has(b.clientId) && !b.settled))
    return 'Money carried over from the previous system is still open for them.'
  return null
}

/** The day each record's period ends, before anyone keeps it longer. */
function naturalDue(s: BusinessState, kind: RetentionKind, id: string): string | null {
  if (kind === 'client') {
    const client = s.clients.find((c) => c.id === id)
    if (!client || isFormerClient(client) || clientHeld(s, id)) return null
    return extendRetention(lastActivity(s, id), 2, 'years')
  }
  if (kind === 'feedback') {
    const f = (s.feedback ?? []).find((x) => x.id === id)
    return f ? extendRetention(localDate(s, f.createdAt), 2, 'years') : null
  }
  if (kind === 'message') {
    const m = operations(s).messages.find((x) => x.id === id)
    // Approved for sending, it may have gone out: what the studio sent stays on record.
    return m && !m.approvedAt ? addDays(localDate(s, m.createdAt), 90) : null
  }
  const e = (s.waitlist ?? []).find((x) => x.id === id)
  return e ? addDays(e.toDate, 90) : null
}

/**
 * Whether a client's keeping period has ended (or their details are already gone), however long
 * they are kept for a decision. Lists that suggest getting in touch leave them out: the studio no
 * longer has a reason to contact them.
 */
export function pastKeepingPeriod(s: BusinessState, clientId: string, today: string) {
  const client = s.clients.find((c) => c.id === clientId)
  if (!client || isFormerClient(client)) return true
  const due = naturalDue(s, 'client', clientId)
  return due !== null && due <= today
}

/** When a record is due, counting any decision to keep it longer, or null if it never is. */
export function dueOn(s: BusinessState, kind: RetentionKind, id: string, kept = keptMap(s)) {
  const natural = naturalDue(s, kind, id)
  if (!natural) return null
  const keep = kept.get(keyOf(kind, id))
  return keep ? later(natural, keep.until) : natural
}

const ids = (s: BusinessState, kind: RetentionKind): string[] =>
  kind === 'client'
    ? s.clients.map((c) => c.id)
    : kind === 'feedback'
      ? (s.feedback ?? []).map((f) => f.id)
      : kind === 'message'
        ? operations(s).messages.map((m) => m.id)
        : (s.waitlist ?? []).map((e) => e.id)

function describe(s: BusinessState, kind: RetentionKind, id: string) {
  const day = (date: string) => fullDateLabel(date, s.organisation.locale)
  const clientName = (clientId?: string) =>
    s.clients.find((c) => c.id === clientId)?.name ?? 'A guest'
  if (kind === 'client') {
    const last = lastActivity(s, id)
    const visited = s.appointments.some((a) => sameGuest(s, id).has(a.clientId))
    return {
      title: clientName(id),
      why: `${visited ? 'Last visit' : 'Last in touch'} ${day(last)}.`,
    }
  }
  if (kind === 'feedback') {
    const f = (s.feedback ?? []).find((x) => x.id === id)!
    return { title: clientName(f.clientId), why: `Given ${day(localDate(s, f.createdAt))}.` }
  }
  if (kind === 'message') {
    const m = operations(s).messages.find((x) => x.id === id)!
    const state =
      m.status === 'draft' ? 'Draft' : m.status === 'suppressed' ? 'Held back' : 'Queued'
    return {
      title: `${m.subject} to ${clientName(m.clientId)}`,
      why: `${state} since ${day(localDate(s, m.createdAt))}, never sent.`,
    }
  }
  const e = (s.waitlist ?? []).find((x) => x.id === id)!
  const service = s.services.find((x) => x.id === e.serviceId)?.name ?? 'A treatment'
  return {
    title: `${clientName(e.clientId)}, ${service}`,
    why: `Asked for ${day(e.fromDate)} to ${day(e.toDate)}.`,
  }
}

/** Every record waiting for a decision on the studio's day `today`, grouped by kind. */
export function dueRecords(s: BusinessState, today: string): DueGroup[] {
  const kept = keptMap(s)
  return RETENTION_KINDS.map((kind) => {
    const records: DueRecord[] = []
    for (const id of ids(s, kind)) {
      const due = dueOn(s, kind, id, kept)
      if (!due || due > today) continue
      const keep = kept.get(keyOf(kind, id))
      records.push({
        kind,
        id,
        dueOn: due,
        ...describe(s, kind, id),
        ...(keep ? { keptUntil: keep.until } : {}),
      })
    }
    records.sort((a, b) => a.dueOn.localeCompare(b.dueOn) || a.title.localeCompare(b.title))
    return { kind, ...retentionKinds[kind], records }
  }).filter((group) => group.records.length)
}

/** Records kept longer whose new date has not come yet, soonest first. */
export function keptRecords(s: BusinessState, today: string) {
  return retentionRecord(s)
    .kept.filter((k) => {
      const due = dueOn(s, k.kind, k.recordId)
      return due !== null && due > today
    })
    .map((k) => ({ ...k, ...describe(s, k.kind, k.recordId) }))
    .sort((a, b) => a.until.localeCompare(b.until))
}

/**
 * The day the law lets a client's money records go: 6 years (UK) or 7 years (US) after the latest
 * receipt, payment, deposit, refund or purchase, or null when they have none.
 */
export function moneyKeptUntil(s: BusinessState, clientId: string): string | null {
  const visits = new Set(s.appointments.filter((a) => a.clientId === clientId).map((a) => a.id))
  const sales = s.sales.filter((x) => visits.has(x.appointmentId))
  const payments = s.payments.filter((p) => visits.has(p.appointmentId))
  const saleIds = new Set(sales.map((x) => x.id))
  const paymentIds = new Set(payments.map((p) => p.id))
  const counter = (s.counterSales ?? []).filter((x) => x.clientId === clientId)
  const counterIds = new Set(counter.map((x) => x.id))
  const instants = [
    ...sales.map((x) => x.paidAt),
    ...payments.map((p) => p.recordedAt),
    ...counter.map((x) => x.paidAt),
    ...operations(s)
      .refunds.filter(
        (r) =>
          (r.saleId && saleIds.has(r.saleId)) ||
          (r.paymentId && paymentIds.has(r.paymentId)) ||
          (r.counterSaleId && counterIds.has(r.counterSaleId)),
      )
      .map((r) => r.createdAt),
    ...(s.holdings ?? [])
      .filter((h) => h.clientId === clientId)
      .flatMap((h) => [
        ...h.payments.map((p) => p.recordedAt),
        ...h.refunds.map((r) => r.createdAt),
      ]),
    ...(s.giftCards ?? []).filter((c) => c.clientId === clientId).map((c) => c.soldAt),
  ]
  if (!instants.length) return null
  const latest = instants.map((at) => localDate(s, at)).reduce(later)
  return extendRetention(latest, MONEY_YEARS[s.organisation.region], 'years')
}

/** What deleting a group means, in plain words, for the confirmation. */
export function deletionMeaning(s: BusinessState, kind: RetentionKind, recordIds: string[]) {
  if (kind === 'client') {
    const until = recordIds
      .map((id) => moneyKeptUntil(s, id))
      .filter((d): d is string => !!d)
      .reduce<string | null>((a, b) => (a && a > b ? a : b), null)
    return {
      goes: 'Names, email addresses, phone numbers, Good to remember, notes, client connections, unsent messages, replies, missed calls, waitlist requests and private feedback.',
      stays: until
        ? `Receipts, payments, deposits, refunds, gift cards, packages and booked visit terms stay under the name ${FORMER_CLIENT}, as the law requires, until at least ${fullDateLabel(until, s.organisation.locale)}.`
        : `Booked visit terms stay under the name ${FORMER_CLIENT}. There are no receipts or payments.`,
    }
  }
  const goes =
    kind === 'feedback'
      ? 'The ratings and comments. Feedback averages stop counting them.'
      : kind === 'message'
        ? 'The messages. None of them was ever sent.'
        : 'The requests and the times asked for.'
  return { goes, stays: 'The client and their visits are not changed.' }
}

/** Whether a record is still there to decide about: a former client's details are already gone. */
function exists(s: BusinessState, kind: RetentionKind, id: string) {
  if (kind === 'client') {
    const client = s.clients.find((c) => c.id === id)
    return !!client && !isFormerClient(client)
  }
  return ids(s, kind).includes(id)
}

/** Why a decision cannot go ahead, or null: every record must still be due, and only once. */
function stillDue(s: BusinessState, kind: RetentionKind, recordIds: string[], today: string) {
  const due = new Set(
    dueRecords(s, today)
      .find((g) => g.kind === kind)
      ?.records.map((r) => r.id),
  )
  if (recordIds.every((id) => due.has(id))) return null
  return recordIds.some((id) => !exists(s, kind, id))
    ? 'Some of these records have already been deleted. Reload to see what is still waiting.'
    : 'Some of these records are not due for a decision. Reload to see what is still waiting.'
}

/** A unique address that can never receive mail (.invalid is reserved), so no guest matches it. */
const formerEmail = (clientId: string) =>
  `former.${clientId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 60)}@erased.invalid`

/**
 * Deletes one client's details and keeps their money records under "Former client". Mutates
 * `next`, a copy the command is building.
 */
export function eraseClient(next: BusinessState, clientId: string, now: string) {
  const client = next.clients.find((c) => c.id === clientId)!
  const before = client.name
  const first = before.split(/\s+/)[0]
  Object.assign(client, {
    name: FORMER_CLIENT,
    email: formerEmail(client.id),
    phone: '',
    preferences: '',
    marketingConsent: false,
    noEmailReminders: true,
    noTextReminders: true,
    erasedAt: now,
  })
  for (const field of ['birthday', 'postcodeArea', 'textsStoppedAt', 'textsAskedAt'] as const)
    delete client[field]
  // Connections go; the other person's timeline no longer names them.
  const others = new Set(
    next.relationships
      .filter((r) => r.fromClientId === clientId || r.toClientId === clientId)
      .map((r) => (r.fromClientId === clientId ? r.toClientId : r.fromClientId)),
  )
  next.relationships = next.relationships.filter(
    (r) => r.fromClientId !== clientId && r.toClientId !== clientId,
  )
  const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const names = [before, first].filter((n) => n.length >= 2).map(escape)
  const named = new RegExp(`\\b(${names.join('|')})\\b`, 'g')
  next.events = next.events.filter(
    (e) => e.clientId !== clientId || (e.type !== 'note' && e.type !== 'relationship'),
  )
  for (const e of next.events)
    if (others.has(e.clientId) && e.type === 'relationship') {
      e.title = e.title.replace(named, 'a former client')
      e.detail = e.detail.replace(named, 'a former client')
    }
  const ops = operations(next)
  next.operations = {
    ...ops,
    // Unsent messages go; any approved marketing still queued is held back, as when consent is
    // withdrawn. Messages approved for sending may have gone out, so they stay on record.
    messages: ops.messages
      .filter((m) => m.clientId !== clientId || m.approvedAt)
      .map((m) =>
        m.clientId === clientId && m.purpose === 'marketing' && m.status === 'queued'
          ? { ...m, status: 'suppressed' as const }
          : m,
      ),
    ...(ops.missedCalls
      ? { missedCalls: ops.missedCalls.filter((c) => c.clientId !== clientId) }
      : {}),
  }
  if (next.replies) next.replies = next.replies.filter((r) => r.clientId !== clientId)
  if (next.socialAnswers)
    next.socialAnswers = next.socialAnswers.filter((a) => a.clientId !== clientId)
  if (next.waitlist) next.waitlist = next.waitlist.filter((e) => e.clientId !== clientId)
  if (next.feedback) next.feedback = next.feedback.filter((f) => f.clientId !== clientId)
  // A gift card they bought stays, as money held for whoever has it, without their name.
  for (const card of next.giftCards ?? [])
    if (card.clientId === clientId) card.purchaserName = FORMER_CLIENT
}

function remove(next: BusinessState, kind: RetentionKind, recordIds: Set<string>, now: string) {
  if (kind === 'client') for (const id of recordIds) eraseClient(next, id, now)
  else if (kind === 'feedback')
    next.feedback = (next.feedback ?? []).filter((f) => !recordIds.has(f.id))
  else if (kind === 'message') {
    const ops = operations(next)
    next.operations = { ...ops, messages: ops.messages.filter((m) => !recordIds.has(m.id)) }
  } else next.waitlist = (next.waitlist ?? []).filter((e) => !recordIds.has(e.id))
}

export type RetentionCommand =
  | { type: 'retention-delete'; kind: RetentionKind; ids: string[] }
  | {
      type: 'retention-keep'
      kind: RetentionKind
      ids: string[]
      amount: number
      unit: ExtensionUnit
      reason: string
    }

/** The day a record kept now runs to: from today, since only due records are decided. */
export function keepUntil(today: string, amount: number, unit: ExtensionUnit) {
  return extendRetention(today, amount, unit)
}

/**
 * Applies an approved decision to `next` (a copy of `s`) and returns the decision's id. Throws
 * when any record is not due on the studio's day, so nothing is deleted twice or without its
 * period having ended.
 */
export function runRetentionCommand(
  s: BusinessState,
  next: BusinessState,
  command: RetentionCommand,
  today: string,
  now: string,
  makeId: () => string,
) {
  const refusal = stillDue(s, command.kind, command.ids, today)
  if (refusal) throw new Error(refusal)
  const chosen = new Set(command.ids)
  const record = retentionRecord(s)
  const decision: RetentionDecision = {
    id: makeId(),
    choice: command.type === 'retention-delete' ? 'delete' : 'keep',
    kind: command.kind,
    count: command.ids.length,
    at: now,
    actor: '',
  }
  let kept: RetentionKeep[]
  if (command.type === 'retention-delete') {
    remove(next, command.kind, chosen, now)
    // A deleted client takes their other records with them, so no keep is left pointing at them.
    kept = record.kept.filter((k) => exists(next, k.kind, k.recordId))
  } else {
    if (command.amount > (command.unit === 'years' ? 10 : 120))
      throw new Error('Keep records for up to 10 years at a time.')
    const until = keepUntil(today, command.amount, command.unit)
    decision.until = until
    const fresh: RetentionKeep[] = command.ids.map((recordId) => ({
      kind: command.kind,
      recordId,
      until,
      amount: command.amount,
      unit: command.unit,
      reason: command.reason.trim(),
      at: now,
      actor: '',
    }))
    kept = [
      ...record.kept.filter((k) => !(k.kind === command.kind && chosen.has(k.recordId))),
      ...fresh,
    ]
  }
  next.operations = {
    ...operations(next),
    retention: {
      kept,
      decisions: [...record.decisions, decision].slice(-RETENTION_DECISIONS_KEPT),
    },
  }
  return decision.id
}

/** Names the person on decisions a command just added. */
export function stampRetentionActors(before: BusinessState, after: BusinessState, actor: string) {
  const known = new Set(retentionRecord(before).decisions.map((d) => d.id))
  const record = operations(after).retention
  if (!record) return
  // Only a decision just made has no name yet.
  for (const d of record.decisions) if (!known.has(d.id) && !d.actor) d.actor = actor
  for (const k of record.kept) if (!k.actor) k.actor = actor
}

/** The decision a change was about, for Who changed what. */
export function retentionDecision(s: BusinessState, id: string) {
  return retentionRecord(s).decisions.find((d) => d.id === id)
}
