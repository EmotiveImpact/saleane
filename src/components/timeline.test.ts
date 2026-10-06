import { describe, expect, it } from 'vitest'
import { seed } from '../domain/seed'
import type { RelationshipEvent } from '../domain/model'
import { groupTimeline } from './timeline'

function event(
  id: string,
  occurredAt: string,
  type: RelationshipEvent['type'],
  appointmentId?: string,
): RelationshipEvent {
  const base = seed('UK').events[0]
  return {
    ...base,
    id,
    type,
    appointmentId,
    saleId: undefined,
    title: id,
    detail: '',
    occurredAt: `${occurredAt}T09:00:00.000Z`,
  }
}

describe('relationship timeline grouping', () => {
  it('shows one entry per visit with its events in the order they happened', () => {
    const entries = groupTimeline([
      event('completed', '2026-10-03', 'checkout', 'visit-a'),
      event('note', '2026-10-02', 'note'),
      event('arrived', '2026-10-03', 'arrived', 'visit-a'),
      event('booked', '2026-09-20', 'booked', 'visit-a'),
    ])
    expect(entries.map((e) => e.key)).toEqual(['visit-visit-a', 'note'])
    const visit = entries[0]
    expect(visit.kind === 'visit' && visit.events.map((e) => e.id)).toEqual([
      'booked',
      'arrived',
      'completed',
    ])
    expect(visit.latestAt).toBe('2026-10-03T09:00:00.000Z')
  })
  it('keeps notes, introductions and consent as separate entries', () => {
    const entries = groupTimeline([
      event('consent', '2026-10-01', 'consent'),
      event('note-1', '2026-09-01', 'note'),
      event('note-2', '2026-09-01', 'note'),
      event('referral', '2026-08-01', 'relationship'),
    ])
    expect(entries.every((e) => e.kind === 'event')).toBe(true)
    expect(entries).toHaveLength(4)
  })
  it('places a visit by its most recent event, so an old booking later completed moves up', () => {
    const entries = groupTimeline([
      event('note', '2026-09-15', 'note'),
      event('booked', '2026-09-01', 'booked', 'visit-a'),
      event('completed', '2026-10-01', 'checkout', 'visit-a'),
      event('booked-b', '2026-09-10', 'booked', 'visit-b'),
    ])
    expect(entries.map((e) => e.key)).toEqual(['visit-visit-a', 'note', 'visit-visit-b'])
  })
  it('groups every seeded visit into a single entry without altering stored events', () => {
    const s = seed('UK')
    const client = s.events.find((e) => e.appointmentId)!.clientId
    const events = s.events.filter((e) => e.clientId === client)
    const snapshot = JSON.stringify(events)
    const entries = groupTimeline(events)
    const visitIds = new Set(events.filter((e) => e.appointmentId).map((e) => e.appointmentId))
    expect(entries.filter((e) => e.kind === 'visit')).toHaveLength(visitIds.size)
    expect(entries.reduce((sum, e) => sum + (e.kind === 'visit' ? e.events.length : 1), 0)).toBe(
      events.length,
    )
    expect(JSON.stringify(events)).toBe(snapshot)
  })
})
