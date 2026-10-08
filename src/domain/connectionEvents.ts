import type { BusinessState } from './model'

/**
 * V5: what other software connected to a studio is told. Events are worked out by comparing the
 * studio record before and after each change, so every path (the desk, the booking page, a
 * guest's own link, the phone line) is covered the same way. Guest details travel only when the
 * owner chose to share them for that connection.
 */

export const connectionEventTypes = [
  'appointment.booked',
  'appointment.moved',
  'appointment.cancelled',
  'appointment.completed',
  'appointment.no_show',
  'client.created',
] as const
export type ConnectionEventType = (typeof connectionEventTypes)[number]

export const connectionEventLabels: Record<ConnectionEventType, string> = {
  'appointment.booked': 'A visit is booked',
  'appointment.moved': 'A visit moves',
  'appointment.cancelled': 'A visit is cancelled',
  'appointment.completed': 'A visit is checked out',
  'appointment.no_show': 'A guest does not come',
  'client.created': 'A new client is added',
}

export type ConnectionEvent = {
  type: ConnectionEventType
  /** The record it is about, so one change gives one event per record. */
  recordId: string
  clientId: string
}

/** Every event one change to the studio record gives, in a stable order. */
export function connectionEvents(before: BusinessState, after: BusinessState): ConnectionEvent[] {
  const events: ConnectionEvent[] = []
  const known = new Set(before.clients.map((c) => c.id))
  for (const client of after.clients)
    if (!known.has(client.id))
      events.push({ type: 'client.created', recordId: client.id, clientId: client.id })
  const was = new Map(before.appointments.map((a) => [a.id, a]))
  for (const a of after.appointments) {
    const old = was.get(a.id)
    const add = (type: ConnectionEventType) =>
      events.push({ type, recordId: a.id, clientId: a.clientId })
    if (!old) {
      if (a.status === 'confirmed' || a.status === 'arrived') add('appointment.booked')
      continue
    }
    if (old.status !== a.status) {
      if (a.status === 'cancelled') add('appointment.cancelled')
      else if (a.status === 'completed') add('appointment.completed')
      else if (a.status === 'no_show') add('appointment.no_show')
    }
    if (
      a.status === 'confirmed' &&
      (old.date !== a.date || old.startMinutes !== a.startMinutes || old.staffId !== a.staffId)
    )
      add('appointment.moved')
  }
  return events
}

const hhmm = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`

/**
 * The body sent for one event. Times are the studio's local date and time with its time zone
 * named. Guest names and contact details only when `shareContact` is set for the connection.
 */
export function connectionPayload(
  s: BusinessState,
  event: ConnectionEvent,
  meta: { id: string; occurredAt: string; shareContact: boolean },
) {
  const client = s.clients.find((c) => c.id === event.clientId)
  const guest = {
    id: event.clientId,
    ...(meta.shareContact && client
      ? { name: client.name, email: client.email, phone: client.phone }
      : {}),
  }
  const a =
    event.type === 'client.created'
      ? undefined
      : s.appointments.find((x) => x.id === event.recordId)
  const service = a && s.services.find((x) => x.id === a.serviceId)
  return {
    id: meta.id,
    type: event.type,
    apiVersion: '2026-10-08',
    occurredAt: meta.occurredAt,
    studio: { id: s.organisation.id, name: s.organisation.name, timeZone: s.organisation.timeZone },
    client: guest,
    ...(a
      ? {
          appointment: {
            id: a.id,
            status: a.status,
            date: a.date,
            start: hhmm(a.startMinutes),
            durationMinutes: a.bookedDurationMinutes,
            service: a.bookedServiceName ?? service?.name ?? null,
            professional: s.staff.find((p) => p.id === a.staffId)?.name ?? null,
            source: a.source,
          },
        }
      : {}),
  }
}
