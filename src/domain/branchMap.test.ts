import { describe, expect, it } from 'vitest'
import { execute } from './commands'
import type { Command } from './commands'
import type { BusinessState } from './model'
import { seed } from './seed'
import { branchMap } from './branchMap'
import { areaView } from './area'

// V5: every location on one map, from the whole business figures.
const now = '2026-10-06T08:00:00.000Z'
const today = '2026-10-06'
let sequence = 0
function apply(s: BusinessState, command: Command) {
  const result = execute(s, command, now, () => `map-${++sequence}`)
  if (!result.ok) throw new Error(result.error)
  return result.state
}
const branch = (name: string, address: string): Command => ({
  type: 'location',
  input: { name, address },
})

/** The sample studio with Islington (N1), Notting Hill (W11) and Leeds (no sample centre). */
function studio(mode: 'sandbox' | 'local' = 'sandbox') {
  let s = seed('UK')
  s = apply(s, branch('Islington', '1 Upper Street, London N1 0PN'))
  s = apply(s, branch('Notting Hill', '12 Ledbury Road, London W11 2AA'))
  s = apply(s, branch('Leeds', '4 Briggate, Leeds LS1 6HD'))
  // Only the visits written here count.
  s = { ...s, operations: { ...s.operations!, mode }, appointments: [], sales: [] }
  const sample = seed('UK')
  const template = sample.appointments.find((a) => a.status === 'completed')!
  const sale = sample.sales.find((x) => x.appointmentId === template.id)!
  const ids = [s.organisation.locationId, ...s.operations!.locations!.map((l) => l.id)]
  let n = 0
  const visit = (locationId: string, date: string, minor: number) => {
    const id = `v${++n}`
    s.appointments.push({ ...template, id, locationId, date, status: 'completed' })
    s.sales.push({
      ...sale,
      id: `s${n}`,
      appointmentId: id,
      serviceMinor: minor,
      discountMinor: 0,
      taxMinor: 0,
      tipMinor: 0,
    })
  }
  return { s, ids, visit }
}

describe('the branch map', () => {
  it('places each location by its postcode with its takings and change', () => {
    const { s, ids, visit } = studio()
    const [main, islington, notting, leeds] = ids
    visit(main, '2026-10-01', 10000)
    visit(main, '2026-09-01', 10000)
    visit(islington, '2026-10-02', 15000)
    visit(islington, '2026-09-02', 10000)
    visit(notting, '2026-10-03', 4000)
    visit(notting, '2026-09-03', 10000)
    visit(leeds, '2026-10-03', 9000)
    const map = branchMap(s, today)
    expect(map.ready).toBe(true)
    expect(map.unplaced).toEqual(['Leeds'])
    const pin = (id: string) => map.pins.find((p) => p.locationId === id)!
    // The main sample location sits in its sample home area; the others by their postcodes.
    expect(pin(main).centre).toEqual([51.5205, -0.1475])
    expect(pin(islington).centre).toEqual([51.5385, -0.0985])
    expect(pin(notting).centre).toEqual([51.5135, -0.2045])
    expect(pin(main)).toMatchObject({ takingsMinor: 10000, trend: 'level', tag: null })
    expect(pin(islington)).toMatchObject({ takingsMinor: 15000, trend: 'up', tag: 'Doing best' })
    expect(pin(notting)).toMatchObject({ takingsMinor: 4000, trend: 'down', tag: 'Needs a look' })
  })

  it('marks a location with nothing before as new', () => {
    const { s, ids, visit } = studio()
    visit(ids[1], '2026-10-02', 5000)
    expect(branchMap(s, today).pins.find((p) => p.locationId === ids[1])!.trend).toBe('new')
  })

  it('draws nothing for a real studio until a map service is connected', () => {
    const { s } = studio('local')
    const map = branchMap(s, today)
    expect(map.ready).toBe(false)
    expect(map.pins).toEqual([])
  })

  it('needs two placed locations before drawing a map', () => {
    const s = seed('UK')
    const map = branchMap(s, today)
    expect(map.pins).toHaveLength(1)
    expect(map.ready).toBe(false)
  })

  it('shows a regional manager only their own region on the map', () => {
    let s = seed('UK')
    s = apply(s, branch('Islington', '1 Upper Street, London N1 0PN'))
    s = apply(s, branch('Notting Hill', '12 Ledbury Road, London W11 2AA'))
    const [main, islington, notting] = [
      s.organisation.locationId,
      ...s.operations!.locations!.map((l) => l.id),
    ]
    s = apply(s, { type: 'region', input: { name: 'North', locationIds: [main, islington] } })
    const view = areaView(s, s.operations!.regions![0].id, today)
    expect(view.map!.pins.map((p) => p.locationId).sort()).toEqual([main, islington].sort())
    expect(JSON.stringify(view.map)).not.toContain(notting)
    expect(view.map!.features.length).toBeGreaterThan(0)
  })
})
