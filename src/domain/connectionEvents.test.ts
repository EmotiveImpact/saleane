import { describe, expect, it } from 'vitest'
import { seed } from './seed'
import type { BusinessState } from './model'
import { connectionEvents, connectionPayload } from './connectionEvents'

// V5: what connected software is told, worked out from the record before and after a change.
const change = (s: BusinessState, edit: (next: BusinessState) => void) => {
  const next = structuredClone(s)
  edit(next)
  return next
}

describe('connection events', () => {
  const s = seed('UK')
  const visit = s.appointments.find((a) => a.status === 'confirmed')!

  it('names a booking, a move, a cancellation, a check-out, a no-show and a new client', () => {
    const booked = change(s, (n) => n.appointments.push({ ...visit, id: 'new-visit' }))
    expect(connectionEvents(s, booked)).toEqual([
      { type: 'appointment.booked', recordId: 'new-visit', clientId: visit.clientId },
    ])
    const moved = change(s, (n) => {
      n.appointments.find((a) => a.id === visit.id)!.startMinutes += 30
    })
    expect(connectionEvents(s, moved).map((e) => e.type)).toEqual(['appointment.moved'])
    for (const [status, type] of [
      ['cancelled', 'appointment.cancelled'],
      ['completed', 'appointment.completed'],
      ['no_show', 'appointment.no_show'],
    ] as const) {
      const next = change(s, (n) => {
        n.appointments.find((a) => a.id === visit.id)!.status = status
      })
      expect(connectionEvents(s, next).map((e) => e.type)).toEqual([type])
    }
    const client = change(s, (n) => n.clients.push({ ...n.clients[0], id: 'new-client' }))
    expect(connectionEvents(s, client)).toEqual([
      { type: 'client.created', recordId: 'new-client', clientId: 'new-client' },
    ])
  })

  it('names nothing for a change connected software is not told about', () => {
    const noted = change(s, (n) => {
      n.clients[0].preferences = 'Prefers mornings'
    })
    expect(connectionEvents(s, noted)).toEqual([])
    expect(connectionEvents(s, s)).toEqual([])
  })

  it('sends guest details only when the connection shares them, with the studio time named', () => {
    const event = {
      type: 'appointment.booked' as const,
      recordId: visit.id,
      clientId: visit.clientId,
    }
    const plain = connectionPayload(s, event, {
      id: 'evt_1',
      occurredAt: 'now',
      shareContact: false,
    })
    expect(plain.client).toEqual({ id: visit.clientId })
    expect(plain.studio.timeZone).toBe('Europe/London')
    expect(plain.appointment).toMatchObject({ id: visit.id, date: visit.date })
    expect(plain.appointment!.start).toMatch(/^\d\d:\d\d$/)
    const shared = connectionPayload(s, event, {
      id: 'evt_1',
      occurredAt: 'now',
      shareContact: true,
    })
    expect(shared.client).toMatchObject({
      name: s.clients.find((c) => c.id === visit.clientId)!.name,
    })
  })
})
