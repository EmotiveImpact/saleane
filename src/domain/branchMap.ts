import type { BusinessState } from './model'
import { businessDate } from './operations'
import { places } from './locations'
import { mapReady, placeCentre } from './areaMap'
import { wholeBusiness } from './group'

/**
 * V5: every location on one map, each pin sized by its last 28 days' takings and coloured by how
 * those compare with the 28 days before. The figures are the same as the whole business list;
 * the map only places them. Like client areas, it is drawn only where a map is ready.
 */

export type BranchPin = {
  locationId: string
  name: string
  centre: [number, number]
  takingsMinor: number
  growth: number | null
  trend: 'up' | 'level' | 'down' | 'new'
  tag: 'Doing best' | 'Needs a look' | null
}

export function branchMap(s: BusinessState, today = businessDate(s), only?: ReadonlySet<string>) {
  const view = wholeBusiness(s, today, only)
  const where = new Map(places(s).map((p) => [p.id, placeCentre(s, p)]))
  const pins: BranchPin[] = []
  const unplaced: string[] = []
  for (const p of view.places) {
    const centre = where.get(p.locationId)
    if (!centre) {
      unplaced.push(p.name)
      continue
    }
    const whole = p.growth === null ? null : Math.round(p.growth * 100)
    pins.push({
      locationId: p.locationId,
      name: p.name,
      centre,
      takingsMinor: p.takingsMinor,
      growth: p.growth,
      trend: whole === null ? 'new' : whole > 0 ? 'up' : whole < 0 ? 'down' : 'level',
      tag:
        p.locationId === view.best?.locationId
          ? 'Doing best'
          : p.locationId === view.weakest?.locationId
            ? 'Needs a look'
            : null,
    })
  }
  return {
    /** A map is drawn only when one is ready and at least two locations can be placed on it. */
    ready: mapReady(s) && pins.length > 1,
    pins,
    unplaced,
  }
}
