import { describe, expect, it } from 'vitest'
import { seed } from './seed'
import { groupTimeline } from './timeline'
import type { RelationshipEvent } from './model'

const base = { organisationId: 'org', clientId: 'c1', detail: '', actor: 'Front desk' }
const event = (
  id: string,
  type: RelationshipEvent['type'],
  occurredAt: string,
  appointmentId?: string,
) => ({ ...base, id, type, title: id, occurredAt, appointmentId }) as RelationshipEvent

describe('client timeline grouping', () => {
  it('shows each visit once, with its steps oldest first', () => {
    const entries = groupTimeline([
      event('checkout', 'checkout', '2026-10-01T11:00:00.000Z', 'a1'),
      event('note', 'note', '2026-10-02T09:00:00.000Z'),
      event('booked', 'booked', '2026-09-20T09:00:00.000Z', 'a1'),
      event('arrived', 'arrived', '2026-10-01T09:55:00.000Z', 'a1'),
      event('next', 'booked', '2026-10-01T11:05:00.000Z', 'a2'),
    ])
    expect(entries.map((e) => e.id)).toEqual(['note', 'visit-a2', 'visit-a1'])
    const visit = entries[2]
    expect(visit.kind === 'visit' && visit.events.map((e) => e.id)).toEqual([
      'booked',
      'arrived',
      'checkout',
    ])
    expect(visit.occurredAt).toBe('2026-10-01T11:00:00.000Z')
  })
  it('orders a visit by when it happens once that is later than its records', () => {
    const entries = groupTimeline(
      [
        event('booked-today', 'booked', '2026-09-29T09:00:00.000Z', 'today'),
        event('done', 'checkout', '2026-10-01T11:00:00.000Z', 'earlier'),
      ],
      (id) => (id === 'today' ? '2026-10-06T09:30:00.000Z' : undefined),
    )
    expect(entries.map((e) => e.id)).toEqual(['visit-today', 'visit-earlier'])
  })
  it('keeps notes, consent and relationships standalone even when linked to a visit', () => {
    const entries = groupTimeline([
      event('message', 'message', '2026-10-01T08:00:00.000Z', 'a1'),
      event('booked', 'booked', '2026-09-20T09:00:00.000Z', 'a1'),
    ])
    expect(entries.map((e) => e.kind)).toEqual(['event', 'visit'])
  })
  it('shortens a seeded client history by folding each visit into one entry', () => {
    const state = seed('UK')
    const clientId = state.appointments.find((a) => a.status === 'completed')!.clientId
    const events = state.events.filter((e) => e.clientId === clientId)
    const visits = new Set(events.filter((e) => e.appointmentId).map((e) => e.appointmentId))
    const grouped = groupTimeline(events).filter((e) => e.kind === 'visit')
    expect(grouped).toHaveLength(visits.size)
    expect(events.length).toBeGreaterThan(groupTimeline(events).length)
  })
})
