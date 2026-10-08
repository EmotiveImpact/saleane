import { describe, expect, it } from 'vitest'
import { execute } from './commands'
import type { Command } from './commands'
import type { BusinessState } from './model'
import { can } from './operations'
import { seed } from './seed'
import { AREA_MIN_GROUP, clientAreas, postcodeArea } from './clientAreas'
import { clientExport } from './privacy'

// V5: where clients come from, by postcode area only, in groups.
const now = '2026-10-06T15:00:00.000Z'
const today = '2026-10-06'
let sequence = 0
function run(s: BusinessState, command: Command) {
  return execute(s, command, now, () => `area-${++sequence}`)
}
function apply(s: BusinessState, command: Command) {
  const result = run(s, command)
  if (!result.ok) throw new Error(result.error)
  return result.state
}
/** A studio whose clients each have one visit on `date`, with the areas given (null for none). */
function studio(areas: (string | null)[], date = today): BusinessState {
  const base = seed('UK')
  const template = base.appointments[0]
  const clients = areas.map((area, i) => ({
    ...base.clients[i % base.clients.length],
    id: `c${i}`,
    ...(area ? { postcodeArea: area } : { postcodeArea: undefined }),
  }))
  return {
    ...base,
    clients,
    appointments: clients.map((c, i) => ({
      ...template,
      id: `a${i}`,
      clientId: c.id,
      date,
      status: 'confirmed' as const,
    })),
  }
}

describe('postcode area', () => {
  it('keeps only the first half of a UK postcode', () => {
    expect(postcodeArea('n1 9gu', 'UK')).toBe('N1')
    expect(postcodeArea('SW1A 1AA', 'UK')).toBe('SW1A')
    expect(postcodeArea('w1g8aq', 'UK')).toBe('W1G')
    expect(postcodeArea(' NW8 ', 'UK')).toBe('NW8')
    expect(postcodeArea('EC1V', 'UK')).toBe('EC1V')
  })
  it('keeps the first three digits of a ZIP code', () => {
    expect(postcodeArea('10001', 'US')).toBe('100')
    expect(postcodeArea('11201-1234', 'US')).toBe('112')
    expect(postcodeArea('070', 'US')).toBe('070')
  })
  it('refuses anything that is not a postcode area', () => {
    for (const raw of ['', 'London', '12', 'N1 9G', '1N', 'SW1A 1AA 1'])
      expect(postcodeArea(raw, 'UK')).toBeNull()
    for (const raw of ['N1', '1000', '100-1234', 'abcde'])
      expect(postcodeArea(raw, 'US')).toBeNull()
  })
})

describe('client areas', () => {
  it('names only areas with enough clients and folds the rest together', () => {
    const view = clientAreas(studio(['N1', 'N1', 'N1', 'W2', 'W2', 'E8', null]), today)
    expect(AREA_MIN_GROUP).toBe(3)
    expect(view.total).toBe(7)
    expect(view.groups).toEqual([{ area: 'N1', clients: 3, share: 3 / 7 }])
    expect(view.other).toBe(3)
    expect(view.unknown).toBe(1)
  })
  it('counts only clients seen in the past year or booked ahead', () => {
    expect(clientAreas(studio(['N1', 'N1', 'N1'], '2025-09-01'), today).total).toBe(0)
    expect(clientAreas(studio(['N1', 'N1', 'N1'], '2026-12-01'), today).groups).toHaveLength(1)
    const cancelled = studio(['N1', 'N1', 'N1'])
    cancelled.appointments = cancelled.appointments.map((a) => ({ ...a, status: 'cancelled' }))
    expect(clientAreas(cancelled, today).total).toBe(0)
  })
  it('counts a client once however many visits they have', () => {
    const s = studio(['N1', 'N1', 'N1'])
    s.appointments = [...s.appointments, ...s.appointments.map((a) => ({ ...a, id: `${a.id}x` }))]
    expect(clientAreas(s, today).groups[0].clients).toBe(3)
  })
  it('counts one location or all of them', () => {
    const s = studio(['N1', 'N1', 'N1', 'W2'])
    s.appointments[3] = { ...s.appointments[3], locationId: 'elsewhere' }
    expect(clientAreas(s, today, s.organisation.locationId).total).toBe(3)
    expect(clientAreas(s, today, 'elsewhere').total).toBe(1)
    expect(clientAreas(s, today).total).toBe(4)
  })
})

describe('recording a client area', () => {
  it('cuts a full postcode to its first half, and can remove it', () => {
    const s = seed('UK')
    const clientId = s.clients[s.clients.length - 1].id
    const saved = apply(s, { type: 'client-area', clientId, area: 'sw1a 1aa' })
    const client = saved.clients.find((c) => c.id === clientId)!
    expect(client.postcodeArea).toBe('SW1A')
    expect(JSON.stringify(saved)).not.toContain('1AA')
    expect(clientExport(saved, clientId, { generatedAt: now, generatedBy: 'Owner' })).toMatchObject(
      {
        subject: { postcodeArea: 'SW1A' },
      },
    )
    const removed = apply(saved, { type: 'client-area', clientId, area: null })
    expect(removed.clients.find((c) => c.id === clientId)!.postcodeArea).toBeUndefined()
  })
  it('refuses what is not a postcode area', () => {
    const s = seed('US')
    const result = run(s, { type: 'client-area', clientId: s.clients[0].id, area: 'Brooklyn' })
    expect(result.ok).toBe(false)
  })
  it('is for the desk and leads, not practitioners', () => {
    for (const role of ['owner', 'manager', 'reception', 'general'] as const)
      expect(can(role, 'client-area')).toBe(true)
    expect(can('practitioner', 'client-area')).toBe(false)
  })
})
