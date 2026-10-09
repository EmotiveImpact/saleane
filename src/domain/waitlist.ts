import type { Command } from './commandSchema'
import type { Appointment, BusinessState, RelationshipEvent } from './model'
import { availableAllocation } from './allocation'
import { addDays, dateLabel, timeLabel } from './format'
import { businessDate, hoursFor, operations, staffHoursFor } from './operations'
import { WAITLIST_MAX_DAYS, WAITLIST_MAX_OFFERS } from './waitlistSchema'
import type { WaitlistEntry, WaitlistInput, WaitlistTime } from './waitlistSchema'
import { placeOf, staffLocationOn } from './locations'

/**
 * V1.5: the waitlist, the first half of "from cancellation to filled slot". Openings are read live
 * from the diary, so a cancellation shows at once as a time someone waiting could take. The team
 * either books it for them, moves the guest's own later visit into it, or writes an offer that waits
 * in the Inbox for approval; SALEANE never contacts anyone by itself here.
 */
type WaitlistCommand = Extract<
  Command,
  {
    type: 'waitlist-add' | 'waitlist-remove' | 'waitlist-offer' | 'waitlist-join' | 'waitlist-leave'
  }
>
type AddEvent = (
  event: Omit<RelationshipEvent, 'id' | 'organisationId' | 'occurredAt' | 'actor'>,
) => void

export type Opening = { date: string; startMinutes: number; staffId: string }

const LABEL: Record<WaitlistTime, string> = {
  morning: 'mornings',
  afternoon: 'afternoons',
  evening: 'evenings',
}

export const waitlistList = (s: BusinessState) => s.waitlist ?? []

/**
 * The last day a time could suit: the end of the window and, for a guest asking to come in sooner,
 * the day before their visit as it stands now (the desk may have moved it since they asked).
 */
export function lastDay(s: BusinessState, entry: WaitlistEntry) {
  if (!entry.appointmentId) return entry.toDate
  const visit = s.appointments.find((a) => a.id === entry.appointmentId)
  if (!visit || visit.status !== 'confirmed') return ''
  const before = addDays(visit.date, -1)
  return before < entry.toDate ? before : entry.toDate
}

/**
 * Still waiting: not booked or taken off, and with days left that could suit. A request whose
 * dates have passed keeps its record but no longer counts, so the client can ask again.
 */
export function isOpen(s: BusinessState, entry: WaitlistEntry, now = new Date().toISOString()) {
  return entry.status === 'waiting' && lastDay(s, entry) >= businessDate(s, now)
}
export const waiting = (s: BusinessState, now = new Date().toISOString()) =>
  waitlistList(s).filter((e) => isOpen(s, e, now))

/**
 * The treatment a request is for, as the client knows it: a guest asking to come in sooner sees
 * the name their visit was booked under, even if the menu has since been renamed.
 */
export function serviceLabel(s: BusinessState, entry: WaitlistEntry) {
  const booked = s.appointments.find((a) => a.id === entry.appointmentId)
  // V2: a request for one location says which, as "Skin Renewal Facial at Islington".
  const where = entry.locationId
    ? ` at ${placeOf(s, entry.locationId)?.name ?? 'another location'}`
    : ''
  return (
    (booked?.bookedServiceName ??
      s.services.find((item) => item.id === entry.serviceId)?.name ??
      'Service') + where
  )
}

/** Morning is before noon, afternoon until 5pm, evening after. */
export function timeOfDay(startMinutes: number): WaitlistTime {
  return startMinutes < 720 ? 'morning' : startMinutes < 1020 ? 'afternoon' : 'evening'
}
export function timesLabel(times: readonly WaitlistTime[]) {
  if (!times.length || times.length === 3) return 'any time'
  return times.map((t) => LABEL[t]).join(' or ')
}

/**
 * Whether the entry's service fits at this time. For a guest asking to come in sooner, it is their
 * own visit that would move, so it is checked with that visit's booked length, buffer and room
 * type, ignoring the visit's current place, exactly as the reschedule will be.
 */
function free(
  s: BusinessState,
  entry: WaitlistEntry,
  staffId: string,
  date: string,
  start: number,
  now: string,
) {
  const visit = entry.appointmentId
    ? s.appointments.find((a) => a.id === entry.appointmentId && a.status === 'confirmed')
    : undefined
  if (visit) {
    const room = s.resources.find((r) => r.id === visit.resourceId)
    return room
      ? availableAllocation(
          s,
          visit.serviceId,
          staffId,
          date,
          start,
          visit.bookedDurationMinutes,
          visit.bookedBufferMinutes,
          visit.bookedResourceType ?? room.type,
          visit.id,
          now,
          undefined,
          undefined,
          visit.locationId,
        )
      : null
  }
  if (entry.appointmentId) return null
  const service = s.services.find((item) => item.id === entry.serviceId)
  return service && !service.archived
    ? availableAllocation(
        s,
        entry.serviceId,
        staffId,
        date,
        start,
        service.durationMinutes,
        service.bufferMinutes,
        service.resourceType,
        undefined,
        now,
        undefined,
        undefined,
        entry.locationId,
      )
    : null
}

/**
 * The earliest times this client could take, from today or the window's first day to its last,
 * with the professional they asked for or anyone who offers the service.
 */
export function openings(s: BusinessState, entry: WaitlistEntry, now: string, limit = 3) {
  const found: Opening[] = []
  if (!isOpen(s, entry, now)) return found
  const today = businessDate(s, now)
  const last = lastDay(s, entry)
  const first = entry.fromDate > today ? entry.fromDate : today
  const team = s.staff.filter(
    (person) =>
      !person.archived &&
      person.serviceIds.includes(entry.serviceId) &&
      (!entry.staffId || person.id === entry.staffId),
  )
  // The whole window is searched (at most WAITLIST_MAX_DAYS), stopping at the first `limit` times.
  for (let day = 0; day < WAITLIST_MAX_DAYS && found.length < limit; day++) {
    const date = addDays(first, day)
    if (date > last) break
    // Only the hours someone on the team is working that day are tried, so a full diary over a long
    // window costs a few thousand checks rather than every quarter hour of every day.
    // V2: each person works at one location a day; a request for one location only looks there.
    const working = team
      .map((p) => {
        const place = staffLocationOn(s, p.id, date)
        return { p, place, h: staffHoursFor(s, p.id, date), studio: hoursFor(s, date, place) }
      })
      .filter(
        ({ h, studio, place }) =>
          h &&
          !h.closed &&
          studio &&
          !studio.closed &&
          (!entry.locationId || entry.locationId === place),
      )
      .map(({ p, h, studio }) => ({
        p,
        open: Math.max(studio!.open, h.open),
        close: Math.min(studio!.close, h.close),
      }))
      .filter((w) => w.open < w.close)
    if (!working.length) continue
    const from = Math.ceil(Math.min(...working.map((w) => w.open)) / 15) * 15
    const to = Math.max(...working.map((w) => w.close))
    for (let start = from; start < to && found.length < limit; start += 15) {
      if (entry.times.length && !entry.times.includes(timeOfDay(start))) continue
      const person = working.find(
        (w) => start >= w.open && start < w.close && free(s, entry, w.p.id, date, start, now),
      )?.p
      if (person) found.push({ date, startMinutes: start, staffId: person.id })
    }
  }
  return found
}

/** Whether this exact time is still free for the entry's service with that professional. */
export function openingFree(s: BusinessState, entry: WaitlistEntry, opening: Opening, now: string) {
  return (
    isOpen(s, entry, now) &&
    opening.date >= entry.fromDate &&
    opening.date <= lastDay(s, entry) &&
    (!entry.staffId || entry.staffId === opening.staffId) &&
    (!entry.times.length || entry.times.includes(timeOfDay(opening.startMinutes))) &&
    !!free(s, entry, opening.staffId, opening.date, opening.startMinutes, now)
  )
}

function checkInput(s: BusinessState, input: WaitlistInput, now: string) {
  const client = s.clients.find((c) => c.id === input.clientId)
  if (!client) throw new Error('Client does not belong to this workspace.')
  const service = s.services.find((item) => item.id === input.serviceId)
  // A guest asking to come in sooner keeps their booked visit even if the service has since been
  // taken off the menu; only a new request from the desk needs a service still offered.
  if (!service || (service.archived && !input.appointmentId))
    throw new Error('Choose a service offered here.')
  if (input.staffId) {
    const person = s.staff.find((p) => p.id === input.staffId)
    if (!person || person.archived || !person.serviceIds.includes(service.id))
      throw new Error('Choose someone who offers this service, or anyone.')
  }
  if (input.locationId) {
    const site = placeOf(s, input.locationId)
    if (!site || site.archived) throw new Error('Choose one of your open locations, or any.')
  }
  const today = businessDate(s, now)
  if (input.fromDate < today) throw new Error('The window cannot start in the past.')
  if (input.toDate < input.fromDate) throw new Error('The last day must be on or after the first.')
  if (input.toDate > addDays(input.fromDate, WAITLIST_MAX_DAYS - 1))
    throw new Error(`Keep the window to ${WAITLIST_MAX_DAYS} days or fewer.`)
  if (input.appointmentId) {
    const visit = s.appointments.find((a) => a.id === input.appointmentId)
    if (
      !visit ||
      visit.clientId !== client.id ||
      visit.status !== 'confirmed' ||
      visit.serviceId !== service.id
    )
      throw new Error('Choose an upcoming visit of this client for this service.')
    if (input.toDate >= visit.date) throw new Error('The window must end before their visit.')
  }
  return { client, service }
}

function add(
  next: BusinessState,
  input: WaitlistInput,
  source: WaitlistEntry['source'],
  now: string,
  makeId: () => string,
  addEvent: AddEvent,
) {
  const { client, service } = checkInput(next, input, now)
  next.waitlist ??= []
  if (
    next.waitlist.some(
      (e) =>
        isOpen(next, e, now) && e.clientId === input.clientId && e.serviceId === input.serviceId,
    )
  )
    throw new Error(
      `${client.name} is already waiting for ${input.appointmentId ? 'an earlier time for this visit' : service.name}. Change or remove that first.`,
    )
  const entry: WaitlistEntry = {
    ...input,
    note: input.note.trim(),
    id: makeId(),
    organisationId: next.organisation.id,
    createdAt: now,
    source,
    status: 'waiting',
  }
  next.waitlist.push(entry)
  const locale = next.organisation.locale
  const who = input.staffId
    ? ` with ${next.staff.find((p) => p.id === input.staffId)!.name}`
    : ' with anyone'
  addEvent({
    clientId: client.id,
    appointmentId: input.appointmentId,
    type: 'waitlist',
    title: source === 'guest' ? 'Asked to come in sooner' : 'Added to the waitlist',
    detail: `${serviceLabel(next, entry)}${who}, ${dateLabel(input.fromDate, locale)} to ${dateLabel(input.toDate, locale)}, ${timesLabel(input.times)}. Nobody is contacted until the team chooses to.`,
  })
  return entry.id
}

function entryFor(next: BusinessState, entryId: string) {
  const entry = next.waitlist?.find((e) => e.id === entryId)
  if (!entry) throw new Error('This waitlist entry is not in the studio record.')
  return entry
}

/**
 * When a request ends, offers written for it that are not yet sent are withdrawn, so nobody can
 * approve a time the client no longer wants (or already has).
 */
function retireOffers(next: BusinessState, entry: WaitlistEntry) {
  const ids = new Set((entry.offers ?? []).map((o) => o.messageId))
  if (!ids.size || !next.operations) return
  for (const message of next.operations.messages)
    if (ids.has(message.id) && message.status !== 'suppressed') message.status = 'suppressed'
}

/** Whether a message was written as a waitlist offer (its wording names one checked time). */
export function isWaitlistOffer(s: BusinessState, messageId: string) {
  return waitlistList(s).some((e) => e.offers?.some((o) => o.messageId === messageId))
}

/** Whether a message is an offer from a request that has since ended (approving it is refused). */
export function withdrawnOffer(s: BusinessState, messageId: string) {
  return waitlistList(s).some(
    (e) => e.status !== 'waiting' && e.offers?.some((o) => o.messageId === messageId),
  )
}

/**
 * Why an offer can no longer be approved, or null if it still can: its request has ended (or its
 * dates passed), or its time has gone since it was written, since an offer holds nothing.
 */
export function staleOffer(s: BusinessState, messageId: string, now: string) {
  const entry = waitlistList(s).find((e) => e.offers?.some((o) => o.messageId === messageId))
  if (!entry) return null
  if (!isOpen(s, entry, now)) return 'This waitlist offer was withdrawn when the request ended.'
  const offer = entry.offers!.find((o) => o.messageId === messageId)!
  return openingFree(s, entry, offer, now)
    ? null
    : 'That time has gone since this offer was written. Write a new one from the waitlist.'
}

/**
 * After the desk moves a guest's visit to another professional, a request to come in sooner with
 * "their" professional follows the visit, so it matches what the guest's page shows.
 */
export function followMovedVisit(
  before: BusinessState,
  next: BusinessState,
  appointment: Appointment,
  now: string,
) {
  // Only a request still open before the move follows it; a closed one keeps what the guest chose.
  const open = new Set(
    waitlistList(before)
      .filter((e) => isOpen(before, e, now))
      .map((e) => e.id),
  )
  for (const entry of next.waitlist ?? [])
    if (
      open.has(entry.id) &&
      entry.status === 'waiting' &&
      entry.appointmentId === appointment.id &&
      entry.staffId &&
      entry.staffId !== appointment.staffId
    )
      entry.staffId = appointment.staffId
}

function remove(
  next: BusinessState,
  entry: WaitlistEntry,
  reason: string,
  now: string,
  addEvent: AddEvent,
) {
  if (entry.status === 'removed') return entry.id
  if (entry.status !== 'waiting') throw new Error('This entry has already been booked.')
  entry.status = 'removed'
  entry.closedAt = now
  entry.removedReason = reason
  retireOffers(next, entry)
  addEvent({
    clientId: entry.clientId,
    appointmentId: entry.appointmentId,
    type: 'waitlist',
    title: 'Taken off the waitlist',
    detail: reason,
  })
  return entry.id
}

/**
 * The entry a repeated request would leave exactly as it is, so `execute` can return the state
 * untouched (no new revision) for a retry or a double tap.
 */
export function waitlistUnchanged(s: BusinessState, command: WaitlistCommand, now: string) {
  const rows = waitlistList(s)
  if (command.type === 'waitlist-remove')
    return rows.find((e) => e.id === command.entryId && e.status === 'removed')?.id
  if (command.type === 'waitlist-leave')
    return rows.some((e) => isOpen(s, e, now) && e.appointmentId === command.appointmentId)
      ? undefined
      : command.appointmentId
  const input = command.type === 'waitlist-add' ? command.input : joinInput(s, command, now)
  if (!input) return undefined
  return rows.find(
    (e) =>
      isOpen(s, e, now) &&
      e.clientId === input.clientId &&
      e.serviceId === input.serviceId &&
      e.appointmentId === input.appointmentId &&
      e.staffId === input.staffId &&
      e.fromDate === input.fromDate &&
      e.toDate === input.toDate &&
      e.times.join() === input.times.join() &&
      e.note === input.note.trim(),
  )?.id
}

/** What a guest's "tell me if something sooner comes up" asks for, or null if it cannot apply. */
function joinInput(
  s: BusinessState,
  command: { type: string; appointmentId?: string; anyone?: boolean; times?: WaitlistTime[] },
  now: string,
): WaitlistInput | null {
  if (command.type !== 'waitlist-join') return null
  const visit = s.appointments.find((a) => a.id === command.appointmentId)
  if (!visit || visit.status !== 'confirmed') return null
  const today = businessDate(s, now)
  const last = addDays(visit.date, -1)
  const cap = addDays(today, WAITLIST_MAX_DAYS - 1)
  if (last < today) return null
  return {
    clientId: visit.clientId,
    serviceId: visit.serviceId,
    ...(command.anyone ? {} : { staffId: visit.staffId }),
    fromDate: today,
    toDate: last > cap ? cap : last,
    times: command.times ?? [],
    note: '',
    appointmentId: visit.id,
  }
}

export function runWaitlistCommand(
  next: BusinessState,
  command: WaitlistCommand,
  now: string,
  makeId: () => string,
  addEvent: AddEvent,
) {
  if (command.type === 'waitlist-add')
    return add(next, command.input, 'desk', now, makeId, addEvent)
  if (command.type === 'waitlist-join') {
    // From the guest's own visit page: the same service, before their visit, from today.
    const input = joinInput(next, command, now)
    if (!input) {
      const visit = next.appointments.find((a) => a.id === command.appointmentId)
      throw new Error(
        visit?.status === 'confirmed'
          ? 'Your visit is too soon for an earlier time.'
          : 'The waitlist is open for upcoming visits only.',
      )
    }
    // Changing their answer replaces the earlier one.
    const earlier = (next.waitlist ?? []).find(
      (e) => isOpen(next, e, now) && e.appointmentId === input.appointmentId,
    )
    if (earlier) remove(next, earlier, 'The guest changed what times suit them.', now, addEvent)
    return add(next, input, 'guest', now, makeId, addEvent)
  }
  if (command.type === 'waitlist-leave') {
    const entry = (next.waitlist ?? []).find(
      (e) => isOpen(next, e, now) && e.appointmentId === command.appointmentId,
    )
    if (!entry) throw new Error('You are not on the waitlist for this visit.')
    return remove(next, entry, 'The guest no longer wants an earlier time.', now, addEvent)
  }
  const entry = entryFor(next, command.entryId)
  if (command.type === 'waitlist-remove') return remove(next, entry, command.reason, now, addEvent)
  // waitlist-offer: a draft for the team to approve in the Inbox; nothing is sent from here.
  const opening = {
    date: command.date,
    startMinutes: command.startMinutes,
    staffId: command.staffId,
  }
  if ((entry.offers?.length ?? 0) >= WAITLIST_MAX_OFFERS)
    throw new Error(
      `This request has already had ${WAITLIST_MAX_OFFERS} offers. Take it off the waitlist and add it again to keep offering.`,
    )
  if (!openingFree(next, entry, opening, now))
    throw new Error('That time is no longer free for this request. Choose another.')
  const client = next.clients.find((c) => c.id === entry.clientId)!
  // A guest asking to come in sooner is offered the visit they booked, under its booked name.
  const serviceName = serviceLabel(next, entry)
  const person = next.staff.find((p) => p.id === opening.staffId)!
  const org = next.organisation
  const when = `${dateLabel(opening.date, org.locale)} at ${timeLabel(opening.startMinutes, org.locale)}`
  next.operations = structuredClone(operations(next))
  const message = {
    id: makeId(),
    clientId: client.id,
    ...(entry.appointmentId ? { appointmentId: entry.appointmentId } : {}),
    purpose: 'appointment' as const,
    subject: `A time has opened at ${org.name}`,
    body: `Hello ${client.name.split(' ')[0]},\n\nYou asked us to let you know if a time opened for ${serviceName}. ${person.name} is free on ${when}.${entry.appointmentId ? ' We can move your visit to this time if you would like.' : ''}\n\nReply to this message or call us to take it. It is not held for you, so the first to answer gets it.\n\n${org.name}`,
    status: 'draft' as const,
    createdAt: now,
    actor: 'Local operator',
  }
  next.operations.messages.push(message)
  entry.offers = [...(entry.offers ?? []), { at: now, ...opening, messageId: message.id }]
  addEvent({
    clientId: client.id,
    appointmentId: entry.appointmentId,
    type: 'message',
    title: 'Waitlist offer drafted',
    detail: `${serviceName} with ${person.name}, ${when}. Waiting in the Inbox for approval; delivery is unconfigured.`,
  })
  return message.id
}

/**
 * Closes a waiting entry when its client is booked into a time, or their own later visit is moved
 * earlier, from the waitlist. Called inside `execute` after the visit is saved.
 */
export function fillFromWaitlist(
  next: BusinessState,
  waitlistId: string,
  appointment: Appointment,
  now: string,
  how: 'book' | 'move',
  /** For a move, the visit's date before it moved: a request to come in sooner never moves it later. */
  previousDate?: string,
) {
  const entry = entryFor(next, waitlistId)
  if (entry.status !== 'waiting') throw new Error('This waitlist entry is no longer waiting.')
  if (entry.clientId !== appointment.clientId || entry.serviceId !== appointment.serviceId)
    throw new Error('This waitlist entry is for another client or service.')
  if (how === 'book' && entry.appointmentId)
    throw new Error('This guest already has a visit; move it rather than booking another.')
  if (how === 'move' && entry.appointmentId !== appointment.id)
    throw new Error('Only the visit this request was made for can be moved to fill it.')
  if (how === 'move' && previousDate && appointment.date >= previousDate)
    throw new Error('A request to come in sooner can only move the visit to an earlier day.')
  // Counted as filled only when the time is one the client asked for.
  if (
    appointment.date < entry.fromDate ||
    appointment.date > entry.toDate ||
    (entry.staffId && entry.staffId !== appointment.staffId) ||
    (entry.times.length && !entry.times.includes(timeOfDay(appointment.startMinutes)))
  )
    throw new Error('That time is outside what this client asked for on the waitlist.')
  entry.status = 'booked'
  entry.closedAt = now
  entry.outcomeAppointmentId = appointment.id
  retireOffers(next, entry)
}

/** A guest's wish to come in sooner ends if the visit it was for is cancelled. */
export function closeForCancelledVisit(
  before: BusinessState,
  next: BusinessState,
  appointmentId: string,
  now: string,
) {
  // Judged before the cancellation: a request whose dates had already passed keeps that history.
  const open = new Set(
    waitlistList(before)
      .filter((e) => isOpen(before, e, now))
      .map((e) => e.id),
  )
  for (const entry of next.waitlist ?? [])
    if (open.has(entry.id) && entry.status === 'waiting' && entry.appointmentId === appointmentId) {
      entry.status = 'removed'
      entry.closedAt = now
      entry.removedReason = 'Their visit was cancelled.'
      retireOffers(next, entry)
    }
}

/** parseState check: entries match the studio's clients, services and visits. */
export function waitlistProblem(s: BusinessState) {
  const rows = waitlistList(s)
  if (new Set(rows.map((r) => r.id)).size !== rows.length) return 'Duplicate waitlist IDs.'
  for (const row of rows) {
    if (
      row.organisationId !== s.organisation.id ||
      !s.clients.some((c) => c.id === row.clientId) ||
      !s.services.some((item) => item.id === row.serviceId) ||
      (row.staffId && !s.staff.some((p) => p.id === row.staffId))
    )
      return 'A waitlist entry does not match the studio record.'
    if (
      row.appointmentId &&
      !s.appointments.some((a) => a.id === row.appointmentId && a.clientId === row.clientId)
    )
      return 'A waitlist entry does not match its visit.'
    if (row.status === 'booked') {
      const visit = s.appointments.find((a) => a.id === row.outcomeAppointmentId)
      if (!visit || visit.clientId !== row.clientId) return 'A filled waitlist entry has no visit.'
    }
  }
  return null
}

/** For the waitlist page: who is waiting, and how many times it has filled since `since`. */
export function waitlistSummary(s: BusinessState, since: string, now = new Date().toISOString()) {
  const filled = waitlistList(s).filter((e) => e.status === 'booked' && (e.closedAt ?? '') >= since)
  // A visit moved earlier twice fills two requests but is still one visit, counted once.
  const visits = [...new Set(filled.map((e) => e.outcomeAppointmentId))]
    .map((id) => s.appointments.find((a) => a.id === id))
    .filter((a): a is Appointment => !!a && a.status !== 'cancelled' && a.status !== 'no_show')
  return {
    waiting: waiting(s, now).length,
    filled: visits.length,
    valueMinor: visits.reduce((sum, a) => sum + a.bookedPriceMinor, 0),
  }
}
