import type { Command } from './commandSchema'
import type { Appointment, BusinessState, Client, RelationshipEvent } from './model'
import { availableAllocation } from './allocation'
import { addDays, dateLabel, timeLabel } from './format'
import { DEMO_MINUTES, businessDate, instantFor, operations } from './operations'
import { hasLocations, placeOf } from './locations'
import { agreedEverywhere, dueBackOn, returnWeeksFor, DEFAULT_RETURN_DAYS } from './dueBack'
import { isWaitlistOffer, openingFree, staleOffer, timeOfDay, waiting } from './waitlist'
import type { WaitlistEntry } from './waitlistSchema'
import { patchTestStanding, serviceNeedsPatchTest } from './patchTests'
import { repliesList } from './inbox'
import { BOOK_LINK, defaultReminderSettings } from './reminderSettings'

/**
 * NEXT-11: filling a cancelled time, the second half of "from cancellation to filled slot". A
 * visit cancelled ahead of time leaves its professional and room free. SALEANE finds who might
 * take it: first anyone on the waitlist it suits, then guests who agreed to hear from the studio
 * and have had this kind of treatment, best fit first. It writes invitations for the team to
 * approve in the Inbox (by itself when a visit is cancelled, if the studio leaves that on) and
 * counts whether the time was filled again. Nothing is ever sent without approval.
 */

/** How far ahead a cancelled time is worth inviting for, and how soon it must still be. */
export const FREED_DAYS_AHEAD = 14
export const FREED_NOTICE_MINUTES = 120
/** The booking grid: guests and the desk book on the quarter hour. */
const GRID = 15
/** A guest is invited to at most one time a week, so nobody is chased. */
export const INVITE_REST_DAYS = 7
/** Invitations the team can write for a time at once, and the few SALEANE writes by itself. */
export const INVITES_AT_ONCE = 5
export const AUTO_INVITES = 3
/** A guest who missed a visit this recently is not invited at short notice. */
export const MISSED_VISIT_DAYS = 90
/** The name on invitations SALEANE writes by itself when a visit is cancelled. */
export const WRITTEN_BY_SALEANE = 'SALEANE'

/** A time a cancellation freed that is still free for the same treatment and professional. */
export type FreedTime = {
  /** The cancelled visit that freed it (the latest, if the time was cancelled more than once). */
  appointmentId: string
  cancelledAt: string
  date: string
  startMinutes: number
  staffId: string
  serviceId: string
  locationId: string
  durationMinutes: number
  priceMinor: number
}
/** What an invitation is for, kept on the message so it can be checked against the diary. */
export type InvitationTime = {
  date: string
  startMinutes: number
  staffId: string
  serviceId: string
  locationId?: string
}
export type Suggestion = {
  clientId: string
  name: string
  /** A few short, plain reasons, best first: "Was due back on 2 October", "Has seen Maya before". */
  reasons: string[]
  score: number
}

type InviteCommand = Extract<Command, { type: 'opening-invite' }>
type AddEvent = (
  event: Omit<RelationshipEvent, 'id' | 'organisationId' | 'occurredAt' | 'actor'>,
) => void
type Message = ReturnType<typeof operations>['messages'][number]

export const timeKey = (t: Pick<InvitationTime, 'date' | 'startMinutes' | 'staffId'>) =>
  `${t.date}|${t.startMinutes}|${t.staffId}`

/** When the visit was last cancelled, from its history. Visits carried over cancelled have none. */
export function cancelledOn(s: BusinessState, appointmentId: string) {
  return s.events.filter((e) => e.appointmentId === appointmentId && e.type === 'cancelled').at(-1)
    ?.occurredAt
}

/**
 * Minutes from now until a time on the studio's clock. A sample studio's clock stands still at
 * 10:45 on its sample day, as its diary does.
 */
export function minutesUntil(s: BusinessState, date: string, start: number, now: string) {
  if (operations(s).mode === 'sandbox') {
    const days = Math.round(
      (Date.parse(`${date}T12:00:00Z`) - Date.parse(`${businessDate(s, now)}T12:00:00Z`)) /
        86_400_000,
    )
    return days * 1440 + start - DEMO_MINUTES
  }
  try {
    return Math.floor((Date.parse(instantFor(s, date, start)) - Date.parse(now)) / 60000)
  } catch {
    return -1
  }
}

/** Whether the treatment can still be booked at this time with this professional, as it is now. */
export function timeStillFree(s: BusinessState, time: InvitationTime, now: string) {
  const service = s.services.find((item) => item.id === time.serviceId)
  if (!service || service.archived) return false
  if (minutesUntil(s, time.date, time.startMinutes, now) < 0) return false
  return !!availableAllocation(
    s,
    service.id,
    time.staffId,
    time.date,
    time.startMinutes,
    service.durationMinutes,
    service.bufferMinutes,
    service.resourceType,
    undefined,
    now,
    undefined,
    GRID,
    time.locationId,
  )
}

/** The time a cancelled visit left, if it is still free, at least two hours and at most 14 days away. */
export function freedTimeOf(
  s: BusinessState,
  visit: Appointment | undefined,
  now: string,
): FreedTime | null {
  if (!visit || visit.status !== 'cancelled') return null
  const cancelledAt = cancelledOn(s, visit.id)
  if (!cancelledAt) return null
  const today = businessDate(s, now)
  if (visit.date < today || visit.date > addDays(today, FREED_DAYS_AHEAD)) return null
  const service = s.services.find((item) => item.id === visit.serviceId)
  // A visit carried over from another system may start off the booking grid, at 10:05 say, which
  // nobody can book again; the nearest bookable time after it, or else before it, stands in.
  const starts =
    visit.startMinutes % GRID
      ? [Math.ceil(visit.startMinutes / GRID) * GRID, Math.floor(visit.startMinutes / GRID) * GRID]
      : [visit.startMinutes]
  for (const startMinutes of starts) {
    if (minutesUntil(s, visit.date, startMinutes, now) < FREED_NOTICE_MINUTES) continue
    const time = {
      appointmentId: visit.id,
      cancelledAt,
      date: visit.date,
      startMinutes,
      staffId: visit.staffId,
      serviceId: visit.serviceId,
      locationId: visit.locationId,
      durationMinutes: service?.durationMinutes ?? visit.bookedDurationMinutes,
      priceMinor: service?.priceMinor ?? visit.bookedPriceMinor,
    }
    if (timeStillFree(s, time, now)) return time
  }
  return null
}

/** Times freed by cancellations that are still free, soonest first. */
export function freedTimes(s: BusinessState, now: string): FreedTime[] {
  const today = businessDate(s, now)
  const last = addDays(today, FREED_DAYS_AHEAD)
  const latest = new Map<string, Appointment>()
  for (const visit of s.appointments) {
    if (visit.status !== 'cancelled' || visit.date < today || visit.date > last) continue
    const key = timeKey(visit)
    const known = latest.get(key)
    if (!known || (cancelledOn(s, visit.id) ?? '') > (cancelledOn(s, known.id) ?? ''))
      latest.set(key, visit)
  }
  return [...latest.values()]
    .map((visit) => freedTimeOf(s, visit, now))
    .filter((time): time is FreedTime => !!time)
    .sort((a, b) => a.date.localeCompare(b.date) || a.startMinutes - b.startMinutes)
}

/** People on the waitlist this time suits. They asked, so they come before anyone invited. */
export function waitingFor(s: BusinessState, time: FreedTime, now: string): WaitlistEntry[] {
  return waiting(s, now)
    .filter((entry) => openingFree(s, entry, time, now))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

type Guest = {
  key: string
  /** The record the invitation goes to: the one with the latest visit, or the first. */
  client: Client
  ids: Set<string>
  completed: Appointment[]
  ahead: Appointment[]
  lastMissed?: string
}
const guestCache = new WeakMap<BusinessState, Map<string, Guest>>()
const guestKey = (c: Client) => c.email.trim().toLowerCase() || `id:${c.id}`

/**
 * Each guest once, however many records online booking made for them (records with the same
 * email are one guest), with their visits. Built once per studio record.
 */
function guests(s: BusinessState) {
  const known = guestCache.get(s)
  if (known) return known
  const byKey = new Map<string, Guest>()
  const keyOf = new Map<string, string>()
  for (const client of s.clients) {
    const key = guestKey(client)
    keyOf.set(client.id, key)
    const guest = byKey.get(key)
    if (guest) guest.ids.add(client.id)
    else byKey.set(key, { key, client, ids: new Set([client.id]), completed: [], ahead: [] })
  }
  for (const visit of s.appointments) {
    const guest = byKey.get(keyOf.get(visit.clientId) ?? '')
    if (!guest) continue
    if (visit.status === 'completed') guest.completed.push(visit)
    else if (visit.status === 'confirmed' || visit.status === 'arrived') guest.ahead.push(visit)
    else if (visit.status === 'no_show' && (!guest.lastMissed || visit.date > guest.lastMissed))
      guest.lastMissed = visit.date
  }
  for (const guest of byKey.values()) {
    guest.completed.sort((a, b) => a.date.localeCompare(b.date) || a.startMinutes - b.startMinutes)
    const latest = guest.completed.at(-1)
    if (latest) guest.client = s.clients.find((c) => c.id === latest.clientId) ?? guest.client
  }
  guestCache.set(s, byKey)
  return byKey
}
const guestOf = (s: BusinessState, clientId: string) => {
  const client = s.clients.find((c) => c.id === clientId)
  return client ? guests(s).get(guestKey(client)) : undefined
}

/** Invitations written for a time, oldest first. */
export function invitationsFor(
  s: BusinessState,
  time: Pick<InvitationTime, 'date' | 'startMinutes' | 'staffId'>,
) {
  const key = timeKey(time)
  return operations(s)
    .messages.filter((m) => m.opening && timeKey(m.opening) === key)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

/** Whether a message is an invitation to a freed time (its wording names that time). */
export function isInvitation(s: BusinessState, messageId: string) {
  return !!operations(s).messages.find((m) => m.id === messageId)?.opening
}

/** Why an invitation can no longer be approved or sent, or null while its time is still free. */
export function staleInvitation(s: BusinessState, messageId: string, now: string) {
  const opening = operations(s).messages.find((m) => m.id === messageId)?.opening
  if (!opening || timeStillFree(s, opening, now)) return null
  return 'That time has been booked or has passed since this invitation was written.'
}

/** Whether any of the guest's records has a patch test that counts for a visit at this time. */
function patchTestClear(s: BusinessState, guest: Guest, time: FreedTime) {
  try {
    const start = instantFor(s, time.date, time.startMinutes)
    return [...guest.ids].some((id) => patchTestStanding(s, id, start).state === 'clear')
  } catch {
    return false
  }
}

const titleCase = (category: string) => category.toLowerCase()
const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name

/**
 * Whether a guest could be invited to this time, with why or why not. Only guests who agreed to
 * hear from the studio under every record, with an email address, who have had this treatment or
 * another of its kind, are free that day, have nothing of this treatment booked, are not waiting
 * for it on the list, have not been invited in the last week, have not missed a visit lately,
 * have a clear patch test when the treatment needs one, and (with several locations) have come to
 * this one.
 */
function assess(
  s: BusinessState,
  time: FreedTime,
  guest: Guest,
  now: string,
  listed: Set<string>,
): (Suggestion & { dueOn?: string }) | string {
  const client = guest.client
  if (!client.email.trim()) return 'They have no email address.'
  if (!agreedEverywhere(s, client.id)) return 'They have not agreed to hear from you.'
  const cancelled = s.appointments.find((a) => a.id === time.appointmentId)
  if (cancelled && guest.ids.has(cancelled.clientId)) return 'They cancelled this time.'
  const today = businessDate(s, now)
  if (guest.ahead.some((a) => a.date === time.date)) return 'They are already coming that day.'
  if (guest.ahead.some((a) => a.serviceId === time.serviceId && a.date >= today))
    return 'They already have this treatment booked.'
  if ([...guest.ids].some((id) => listed.has(id)))
    return 'They are waiting for a time like this on the list.'
  if (guest.lastMissed && guest.lastMissed >= addDays(today, -MISSED_VISIT_DAYS))
    return 'They missed a visit in the last three months.'
  const key = timeKey(time)
  const rest = Date.parse(now) - INVITE_REST_DAYS * 86_400_000
  const invited = operations(s).messages.filter(
    (m) => m.opening && m.status !== 'suppressed' && guest.ids.has(m.clientId),
  )
  if (invited.some((m) => timeKey(m.opening!) === key)) return 'They have been invited already.'
  if (invited.some((m) => Date.parse(m.createdAt) >= rest))
    return 'They were invited to another time in the last week.'
  const service = s.services.find((item) => item.id === time.serviceId)
  if (!service) return 'This treatment is no longer offered.'
  const same = guest.completed.filter((a) => a.serviceId === time.serviceId)
  const kind = guest.completed.filter(
    (a) => s.services.find((item) => item.id === a.serviceId)?.category === service.category,
  )
  if (!kind.length) return `They have not had a ${titleCase(service.category)} treatment here.`
  if (hasLocations(s) && !guest.completed.some((a) => a.locationId === time.locationId))
    return 'They have not been to this location.'
  if (serviceNeedsPatchTest(s, time.serviceId)) {
    if (!patchTestClear(s, guest, time)) return 'They need a patch test first.'
  }
  const locale = s.organisation.locale
  const reasons: string[] = []
  let score = 0
  const lastSame = same.at(-1)
  const due = lastSame && dueBackOn(s, lastSame)
  if (lastSame && due) {
    const gap = (returnWeeksFor(s, lastSame) ?? DEFAULT_RETURN_DAYS / 7) * 7
    // Too soon after the last one to want another.
    if (time.date < addDays(lastSame.date, Math.ceil(gap / 2)))
      return 'They had this treatment too recently.'
    score += 4
    if (due <= today) {
      score += 3
      reasons.push(due === today ? 'Due back today' : `Was due back on ${dateLabel(due, locale)}`)
    } else if (due <= time.date) {
      score += 3
      reasons.push(
        due === time.date ? 'Due back that day' : `Due back on ${dateLabel(due, locale)}`,
      )
    } else if (due <= addDays(time.date, 14)) {
      score += 1
      reasons.push(`Due back on ${dateLabel(due, locale)}`)
    } else reasons.push(`Last had it on ${dateLabel(lastSame.date, locale)}`)
  } else reasons.push(`Has had other ${titleCase(service.category)} treatments`)
  const person = s.staff.find((p) => p.id === time.staffId)
  if (person && guest.completed.some((a) => a.staffId === time.staffId)) {
    score += 2
    reasons.push(`Has seen ${firstName(person.name)} before`)
  }
  const when = timeOfDay(time.startMinutes)
  const usual = guest.completed.filter((a) => timeOfDay(a.startMinutes) === when).length
  if (guest.completed.length >= 2 && usual * 2 > guest.completed.length) {
    score += 1
    reasons.push(`Usually comes in the ${when}s`)
  }
  return { clientId: client.id, name: client.name, reasons, score, dueOn: due || undefined }
}

/**
 * Guests who might like a freed time, best fit first: due back for this treatment, then those who
 * have seen this professional and usually come at this time of day; then the most regular.
 */
export function suggestionsFor(
  s: BusinessState,
  time: FreedTime,
  now: string,
  limit = INVITES_AT_ONCE,
): Suggestion[] {
  const listed = new Set(waitingFor(s, time, now).map((e) => e.clientId))
  const found: { suggestion: Suggestion & { dueOn?: string }; guest: Guest }[] = []
  for (const guest of guests(s).values()) {
    const result = assess(s, time, guest, now, listed)
    if (typeof result !== 'string') found.push({ suggestion: result, guest })
  }
  return found
    .sort(
      (a, b) =>
        b.suggestion.score - a.suggestion.score ||
        // Of two as likely, the one due back sooner comes first.
        (a.suggestion.dueOn ?? '9999').localeCompare(b.suggestion.dueOn ?? '9999') ||
        b.guest.completed.length - a.guest.completed.length ||
        (b.guest.completed.at(-1)?.date ?? '').localeCompare(
          a.guest.completed.at(-1)?.date ?? '',
        ) ||
        a.suggestion.name.localeCompare(b.suggestion.name),
    )
    .slice(0, limit)
    .map(({ suggestion: { clientId, name, reasons, score } }) => ({
      clientId,
      name,
      reasons,
      score,
    }))
}

/** The booking line of an invitation: the studio's page with this time already chosen. */
function bookingLine(s: BusinessState, time: FreedTime) {
  if (!operations(s).bookingEnabled) return 'If you would like it, reply to this email or call us.'
  const params = new URLSearchParams({
    service: time.serviceId,
    staff: time.staffId,
    date: time.date,
    start: String(time.startMinutes),
  })
  if (hasLocations(s)) params.set('location', time.locationId)
  return `If you would like it, book it here: ${BOOK_LINK}?${params}`
}

/** How a time is named in invitations and on screen: "Saturday 10 October at 10:00". */
export function freedWhen(s: BusinessState, time: Pick<InvitationTime, 'date' | 'startMinutes'>) {
  const locale = s.organisation.locale
  return `${dateLabel(time.date, locale)} at ${timeLabel(time.startMinutes, locale)}`
}

/** Writes invitations as drafts for the team to approve. Returns the first message's id. */
function draft(
  next: BusinessState,
  time: FreedTime,
  clients: Client[],
  now: string,
  makeId: () => string,
  addEvent: AddEvent,
  actor: string,
) {
  const org = next.organisation
  const service = next.services.find((item) => item.id === time.serviceId)!
  const person = next.staff.find((p) => p.id === time.staffId)!
  const where = hasLocations(next) ? ` at ${placeOf(next, time.locationId)?.name}` : ''
  const when = freedWhen(next, time)
  next.operations = structuredClone(operations(next))
  const opening: InvitationTime = {
    date: time.date,
    startMinutes: time.startMinutes,
    staffId: time.staffId,
    serviceId: time.serviceId,
    ...(hasLocations(next) ? { locationId: time.locationId } : {}),
  }
  const ids: string[] = []
  for (const client of clients) {
    const message: Message = {
      id: makeId(),
      clientId: client.id,
      purpose: 'marketing',
      channel: 'email',
      subject: `A time has opened at ${org.name}`,
      body: [
        `Hello ${firstName(client.name)},`,
        '',
        `A time has just opened for ${service.name} with ${firstName(person.name)}${where} on ${when}, and we thought of you.`,
        '',
        `${bookingLine(next, time)} It is not held for you, so the first to book it gets it.`,
        '',
        'You are hearing this because you said we could keep in touch. To stop these, reply to this email or tell us at your next visit.',
        '',
        org.name,
      ].join('\n'),
      status: 'draft',
      createdAt: now,
      actor,
      opening,
    }
    next.operations.messages.push(message)
    ids.push(message.id)
    addEvent({
      clientId: client.id,
      type: 'message',
      title: actor === WRITTEN_BY_SALEANE ? 'Invitation written by SALEANE' : 'Invitation written',
      detail: `${service.name} with ${person.name}${where}, ${when}, a time freed by a cancellation. Waiting in the Inbox for approval; delivery is unconfigured.`,
    })
  }
  return ids[0]
}

/** The team chooses who to invite to a freed time. Repeating it for the same people changes nothing. */
export function invitesUnchanged(s: BusinessState, command: InviteCommand) {
  const visit = s.appointments.find((a) => a.id === command.appointmentId)
  if (!visit) return undefined
  const invited = invitationsFor(s, visit).filter((m) => m.status !== 'suppressed')
  const mine = command.clientIds.map((id) => invited.find((m) => m.clientId === id))
  return mine.every(Boolean) ? mine[0]!.id : undefined
}

export function runInviteCommand(
  next: BusinessState,
  command: InviteCommand,
  now: string,
  makeId: () => string,
  addEvent: AddEvent,
) {
  const visit = next.appointments.find((a) => a.id === command.appointmentId)
  if (!visit || visit.status !== 'cancelled')
    throw new Error('Choose a time a cancelled visit left free.')
  const time = freedTimeOf(next, visit, now)
  if (!time)
    throw new Error(
      'That time is no longer free, or is too soon or too far ahead to invite anyone. Look again.',
    )
  const listed = new Set(waitingFor(next, time, now).map((e) => e.clientId))
  const invited = new Set(
    invitationsFor(next, time)
      .filter((m) => m.status !== 'suppressed')
      .map((m) => m.clientId),
  )
  const chosen: Client[] = []
  for (const id of command.clientIds) {
    if (invited.has(id)) continue
    const client = next.clients.find((c) => c.id === id)
    const guest = guestOf(next, id)
    if (!client || !guest) throw new Error('Client does not belong to this studio.')
    // The invitation goes to the record that was suggested, which is the guest's latest.
    if (guest.client.id !== id)
      throw new Error(`Invite ${client.name} from the record with their latest visit.`)
    const result = assess(next, time, guest, now, listed)
    if (typeof result === 'string') throw new Error(`${client.name} cannot be invited. ${result}`)
    chosen.push(client)
  }
  if (!chosen.length) throw new Error('Everyone chosen has been invited already.')
  return draft(next, time, chosen, now, makeId, addEvent, 'Local operator')
}

/**
 * Called inside `execute` after visits are cancelled: unless the studio has turned it off, SALEANE
 * writes invitations for each freed time to the few guests who fit best, as drafts for the team
 * to approve. Not when someone on the waitlist could take it (they asked first), nor when the time
 * already has invitations.
 */
export function inviteForCancelled(
  next: BusinessState,
  appointmentIds: string[],
  now: string,
  makeId: () => string,
  addEvent: AddEvent,
) {
  const settings = operations(next).reminders ?? defaultReminderSettings
  if (settings.openingInvites === false) return
  for (const id of appointmentIds) {
    const time = freedTimeOf(
      next,
      next.appointments.find((a) => a.id === id),
      now,
    )
    if (!time || waitingFor(next, time, now).length) continue
    if (invitationsFor(next, time).some((m) => m.status !== 'suppressed')) continue
    const picks = suggestionsFor(next, time, now, AUTO_INVITES)
      .map((p) => next.clients.find((c) => c.id === p.clientId)!)
      .filter(Boolean)
    if (picks.length) draft(next, time, picks, now, makeId, addEvent, WRITTEN_BY_SALEANE)
  }
}

export type InvitationState = 'draft' | 'stale' | 'approved' | 'replied' | 'booked' | 'withdrawn'

/** Where one invitation stands, for the list under its time. */
export function invitationState(s: BusinessState, message: Message, now: string): InvitationState {
  const guest = guestOf(s, message.clientId)
  const opening = message.opening!
  const booked = s.appointments.some(
    (a) =>
      guest?.ids.has(a.clientId) &&
      a.staffId === opening.staffId &&
      a.date === opening.date &&
      a.startMinutes === opening.startMinutes &&
      a.status !== 'cancelled' &&
      a.createdAt >= message.createdAt,
  )
  if (booked) return 'booked'
  if (message.status === 'suppressed') return 'withdrawn'
  if (message.status === 'draft') return staleInvitation(s, message.id, now) ? 'stale' : 'draft'
  if (
    message.approvedAt &&
    repliesList(s).some(
      (r) => r.clientId && guest?.ids.has(r.clientId) && r.receivedAt >= message.approvedAt!,
    )
  )
    return 'replied'
  return 'approved'
}

/**
 * For the waitlist page: times freed by cancellations since `since` (cancelled before they were
 * due to start), how many were booked again, how many of those by someone invited to that time
 * and how many from the waitlist, and what the visits that filled them were booked at.
 */
export function freedSummary(s: BusinessState, since: string) {
  const latest = new Map<string, { visit: Appointment; at: string }>()
  for (const visit of s.appointments) {
    if (visit.status !== 'cancelled') continue
    const at = cancelledOn(s, visit.id)
    if (!at || at < since) continue
    let start: number
    try {
      start = Date.parse(instantFor(s, visit.date, visit.startMinutes))
    } catch {
      continue
    }
    // A sample studio's clock stands still on its sample day, so each cancellation there counts.
    if (operations(s).mode !== 'sandbox' && Date.parse(at) >= start) continue
    const key = timeKey(visit)
    if ((latest.get(key)?.at ?? '') < at) latest.set(key, { visit, at })
  }
  // When each visit came to its time: booked then, or moved there since.
  const entered = new Map<string, string>()
  for (const visit of s.appointments) entered.set(visit.id, visit.createdAt)
  for (const event of s.events)
    if (event.type === 'rescheduled' && event.appointmentId)
      entered.set(event.appointmentId, event.occurredAt)
  const fillers = new Set<string>()
  let invited = 0
  let waitlist = 0
  for (const { visit, at } of latest.values()) {
    const end = visit.startMinutes + visit.bookedDurationMinutes
    const filler = s.appointments.find(
      (a) =>
        a.id !== visit.id &&
        a.staffId === visit.staffId &&
        a.date === visit.date &&
        (a.status === 'confirmed' || a.status === 'arrived' || a.status === 'completed') &&
        (entered.get(a.id) ?? a.createdAt) > at &&
        a.startMinutes < end &&
        a.startMinutes + a.bookedDurationMinutes > visit.startMinutes,
    )
    if (!filler || fillers.has(filler.id)) continue
    fillers.add(filler.id)
    const guest = guestOf(s, filler.clientId)
    if (
      invitationsFor(s, visit).some(
        (m) =>
          m.approvedAt &&
          m.approvedAt <= (entered.get(filler.id) ?? filler.createdAt) &&
          guest?.ids.has(m.clientId),
      )
    )
      invited++
    if ((s.waitlist ?? []).some((e) => e.outcomeAppointmentId === filler.id)) waitlist++
  }
  const filled = [...fillers].map((id) => s.appointments.find((a) => a.id === id)!)
  return {
    freed: latest.size,
    filled: filled.length,
    invited,
    waitlist,
    valueMinor: filled.reduce((sum, a) => sum + a.bookedPriceMinor, 0),
  }
}

/** Why a waitlist offer or an invitation can no longer be approved, or null while it still can. */
export function draftStale(s: BusinessState, messageId: string, now: string) {
  return staleOffer(s, messageId, now) ?? staleInvitation(s, messageId, now)
}

/** Whether a draft names a time, so its wording is not changed by hand. */
export function namesATime(s: BusinessState, messageId: string) {
  return isWaitlistOffer(s, messageId) || isInvitation(s, messageId)
}

/**
 * A message as people read it before it goes: the booking link is filled in only as it is sent,
 * so it is named in words rather than shown as a placeholder.
 */
export function shownBody(body: string) {
  return body.replace(/\{\{book_link\}\}(\?\S+)?/g, (_, time?: string) =>
    time ? '[a link to book this time]' : '[a link to your booking page]',
  )
}
