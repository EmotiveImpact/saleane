import type { RelationshipEvent } from '../domain/model'

/**
 * Presentation-only grouping for the relationship timeline. Stored events are never
 * changed: events that share an appointmentId become one visit entry, and everything
 * else (notes, introductions, consent, profile changes) stays a single entry.
 */
export type TimelineEntry =
  | {
      kind: 'visit'
      key: string
      appointmentId: string
      latestAt: string
      events: RelationshipEvent[]
    }
  | { kind: 'event'; key: string; latestAt: string; event: RelationshipEvent }

export function groupTimeline(events: RelationshipEvent[]): TimelineEntry[] {
  const visits = new Map<string, RelationshipEvent[]>()
  const entries: TimelineEntry[] = []
  for (const event of events) {
    if (!event.appointmentId) {
      entries.push({ kind: 'event', key: event.id, latestAt: event.occurredAt, event })
      continue
    }
    const group = visits.get(event.appointmentId)
    if (group) group.push(event)
    else visits.set(event.appointmentId, [event])
  }
  for (const [appointmentId, group] of visits) {
    const ordered = [...group].sort(
      (a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id),
    )
    entries.push({
      kind: 'visit',
      key: `visit-${appointmentId}`,
      appointmentId,
      latestAt: ordered.at(-1)!.occurredAt,
      events: ordered,
    })
  }
  return entries.sort((a, b) => b.latestAt.localeCompare(a.latestAt) || a.key.localeCompare(b.key))
}
