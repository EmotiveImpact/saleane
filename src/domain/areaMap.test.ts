import { describe, expect, it } from 'vitest'
import type { BusinessState } from './model'
import { seed } from './seed'
import {
  addressArea,
  areaChange,
  mapAreas,
  mapFeatures,
  mapReady,
  milesAcross,
  milesBetween,
  project,
} from './areaMap'

// V5: client areas on a map, grouped areas only.
const today = '2026-10-06'
/** A sample studio whose clients each have one visit on each date given, with these areas. */
function studio(areas: (string | null)[], dates = [today], mode: 'sandbox' | 'local' = 'sandbox') {
  const base = seed('UK')
  const template = base.appointments[0]
  const clients = areas.map((area, i) => ({
    ...base.clients[i % base.clients.length],
    id: `c${i}`,
    ...(area ? { postcodeArea: area } : { postcodeArea: undefined }),
  }))
  const s: BusinessState = {
    ...base,
    operations: { ...base.operations!, mode },
    clients,
    sales: [],
    appointments: clients.flatMap((c, i) =>
      dates.map((date, d) => ({
        ...template,
        id: `a${i}-${d}`,
        clientId: c.id,
        date,
        status: 'confirmed' as const,
      })),
    ),
  }
  return s
}

describe('client area map', () => {
  it('finds the postcode area in an address', () => {
    expect(addressArea('24 Devonshire Place, London W1G 8AB', 'UK')).toBe('W1G')
    expect(addressArea('24 Devonshire Place, London W1G', 'UK')).toBe('W1G')
    expect(addressArea('1 Upper Street, London N1 0PN', 'UK')).toBe('N1')
    expect(addressArea('1 Upper Street, London', 'UK')).toBeNull()
    expect(addressArea('48 Mercer Street, New York, NY 10012', 'US')).toBe('100')
    expect(addressArea('48 Mercer Street, New York, NY', 'US')).toBeNull()
  })

  it('draws only areas with at least three clients, at their centres', () => {
    const map = mapAreas(studio(['W1G', 'W1G', 'W1G', 'W2', 'W2', null]), today, 'all')
    expect(map.total).toBe(6)
    expect(map.areas.map((a) => [a.area, a.clients])).toEqual([['W1G', 3]])
    expect(map.areas[0].centre).toEqual([51.5205, -0.1475])
    // The sample's main location has no postcode in its address, so it sits in its home area.
    expect(map.places[0].centre).toEqual([51.5205, -0.1475])
  })

  it('compares with the same length of time before, only when that is enough clients', () => {
    const grown = studio(['N1', 'N1', 'N1', 'N1'], [today])
    grown.appointments.push(
      ...['c0', 'c1', 'c2'].map((clientId, i) => ({
        ...grown.appointments[0],
        id: `old${i}`,
        clientId,
        date: '2025-06-01',
      })),
    )
    const [area] = mapAreas(grown, today, 'all').areas
    expect(area.before).toBe(3)
    expect(areaChange(area)).toEqual({ label: 'Up 1 on the period before', growing: true })
    const fresh = mapAreas(studio(['N1', 'N1', 'N1']), today, 'all').areas[0]
    expect(fresh.before).toBeNull()
    expect(areaChange(fresh).label).toBe('No earlier figure to compare')
  })

  it('leaves bookings ahead out of the change and included tax out of sales', () => {
    const s = studio(['N1', 'N1', 'N1', 'N1'], [today])
    s.appointments.push(
      ...['c0', 'c1', 'c2'].map((clientId, i) => ({
        ...s.appointments[0],
        id: `old${i}`,
        clientId,
        date: '2025-06-01',
      })),
    )
    // The fourth client is only booked in for next week, so has not been seen yet.
    s.appointments.find((a) => a.id === 'a3-0')!.date = '2026-10-13'
    s.sales = [
      {
        ...seed('UK').sales[0],
        appointmentId: 'a0-0',
        serviceMinor: 12_000,
        discountMinor: 0,
        taxMinor: 2_000,
        taxInclusive: true,
      },
    ]
    const [area] = mapAreas(s, today, 'all').areas
    expect(area.clients).toBe(4)
    expect(area.seen).toBe(3)
    expect(areaChange(area).label).toBe('The same as the period before')
    expect(area.salesMinor).toBe(10_000)
  })

  it('has no map, centres or landmarks for a real studio until a map service is connected', () => {
    const real = studio(['W1G', 'W1G', 'W1G'], [today], 'local')
    expect(mapReady(real)).toBe(false)
    expect(mapFeatures(real)).toEqual([])
    const map = mapAreas(real, today, 'all')
    expect(map.areas[0].centre).toBeNull()
    expect(map.places[0].centre).toBeNull()
  })

  it('measures distance on the map', () => {
    expect(milesBetween([51.5205, -0.1475], [51.5205, -0.1475])).toBe(0)
    expect(milesBetween([51.5205, -0.1475], [51.5345, -0.1405])).toBeCloseTo(1.01, 1)
    const a = project([51.5, -0.1], 1)
    const b = project([51.5, 0.1], 1)
    expect(b.x - a.x).toBeCloseTo(0.2 / 360, 6)
    expect(milesAcross(1, 0, 1)).toBeCloseTo(1609.344 / 40_075_016.7, 9)
  })
})
