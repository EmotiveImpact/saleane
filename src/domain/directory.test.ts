import { describe, expect, it } from 'vitest'
import { seed } from './seed'
import { dueClients } from './selectors'
import { directoryRows, queryDirectory } from './directory'
import type { BusinessState } from './model'

function withClients(count: number): BusinessState {
  const s = seed('UK')
  const extra = Array.from({ length: count }, (_, i) => ({
    ...s.clients[0],
    id: `client-extra-${i}`,
    name: `Guest ${String(i).padStart(3, '0')}`,
    email: `guest.${i}@example.com`,
    phone: `+44 7700 9${String(10000 + i)}`,
    createdAt: '2026-10-02T10:00:00.000Z',
  }))
  return { ...s, clients: [...s.clients, ...extra] }
}

describe('the client directory', () => {
  it('pages hundreds of clients 25 at a time', () => {
    const rows = directoryRows(withClients(397))
    const first = queryDirectory(rows, {})
    expect(first.total).toBe(412)
    expect(first.rows).toHaveLength(25)
    expect([first.from, first.to, first.pages]).toEqual([1, 25, 17])
    const last = queryDirectory(rows, { page: 17 })
    expect([last.from, last.to]).toEqual([401, 412])
    expect(last.rows).toHaveLength(12)
    // A page beyond the end settles on the last page rather than showing nothing.
    expect(queryDirectory(rows, { page: 99 }).page).toBe(17)
  })

  it('searches by name, email or phone, whatever the spacing', () => {
    const rows = directoryRows(seed('UK'))
    expect(queryDirectory(rows, { query: 'amelia' }).rows.map((r) => r.client.name)).toEqual([
      'Amelia Carter',
    ])
    expect(queryDirectory(rows, { query: 'olivia.james@' }).total).toBe(1)
    expect(queryDirectory(rows, { query: '07700 900003' }).rows[0].client.name).toBe('Ellie Brooks')
    expect(queryDirectory(rows, { query: '7700 900003' }).rows[0].client.name).toBe('Ellie Brooks')
  })

  it('agrees with Today on who is ready to return, and counts each segment', () => {
    const s = withClients(3)
    const result = queryDirectory(directoryRows(s), { segment: 'due' })
    expect(result.rows.map((r) => r.client.id).sort()).toEqual(
      dueClients(s)
        .map((c) => c.id)
        .sort(),
    )
    expect(result.counts.all).toBe(18)
    expect(result.counts.new).toBe(3)
  })

  it('sorts by name, visits and spend', () => {
    const rows = directoryRows(seed('UK'))
    const names = queryDirectory(rows, { sort: 'name' }).rows.map((r) => r.client.name)
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)))
    const spend = queryDirectory(rows, { sort: 'spend' }).rows.map((r) => r.spend)
    expect(spend).toEqual([...spend].sort((a, b) => b - a))
    const visits = queryDirectory(rows, { sort: 'visits' }).rows.map((r) => r.visits)
    expect(visits).toEqual([...visits].sort((a, b) => b - a))
  })
})
