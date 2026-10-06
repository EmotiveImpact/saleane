import type { RelationshipEvent } from './model'

/** Event types that describe one visit's life: booking, changes, arrival, money. */
export const VISIT_EVENT_TYPES: readonly RelationshipEvent['type'][] = [
  'booked',
  'arrived',
  'checkout',
  'rescheduled',
  'cancelled',
  'no_show',
  'deposit',
  'refund',
]

export type TimelineEntry =
  | { kind: 'event'; id: string; occurredAt: string; event: RelationshipEvent }
  | {
      kind: 'visit'
      id: string
      occurredAt: string
      appointmentId: string
      /** Oldest first, so a visit reads as booked, arrived, checked out. */
      events: RelationshipEvent[]
    }

/**
 * Folds a client's events into one entry per visit, newest activity first.
 * Each visit's booking, moves, arrival, checkout, deposits and refunds sit
 * inside a single entry; notes, consent and relationships stay standalone.
 */
export function groupTimeline(
  events: RelationshipEvent[],
  /** When the visit itself happens (ISO), so an upcoming or current visit is not ordered by its booking date. */
  visitTime: (appointmentId: string) => string | undefined = () => undefined,
): TimelineEntry[] {
  const visits = new Map<string, RelationshipEvent[]>()
  const entries: TimelineEntry[] = []
  for (const event of events) {
    if (event.appointmentId && VISIT_EVENT_TYPES.includes(event.type)) {
      const group = visits.get(event.appointmentId)
      if (group) group.push(event)
      else visits.set(event.appointmentId, [event])
    } else {
      entries.push({ kind: 'event', id: event.id, occurredAt: event.occurredAt, event })
    }
  }
  for (const [appointmentId, group] of visits) {
    group.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))
    const latest = group[group.length - 1].occurredAt
    const visit = visitTime(appointmentId)
    entries.push({
      kind: 'visit',
      id: `visit-${appointmentId}`,
      appointmentId,
      occurredAt: visit && visit > latest ? visit : latest,
      events: group,
    })
  }
  return entries.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
}
