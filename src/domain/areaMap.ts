import type { BusinessState, Region } from './model'
import { addDays } from './format'
import { operations } from './operations'
import { places } from './locations'
import { AREA_MIN_GROUP, postcodeArea } from './clientAreas'

/**
 * V5: client areas on a map. Each named area (at least `AREA_MIN_GROUP` clients) is drawn as one
 * circle at the area's centre; smaller areas never appear on the map, and no client is placed
 * anywhere. Where an area's centre is comes from a map service. None is connected yet, so only
 * sample studios have a map, drawn from the approximate sample centres below with no streets.
 */

/** Approximate centres of the sample studios' areas: [latitude, longitude]. Sample data only. */
const SAMPLE_CENTRES: Record<Region, Record<string, [number, number]>> = {
  UK: {
    W1G: [51.5205, -0.1475],
    W1U: [51.5185, -0.1555],
    W1H: [51.5175, -0.1615],
    W1W: [51.5205, -0.1405],
    W1T: [51.5195, -0.1335],
    NW1: [51.5345, -0.1405],
    NW3: [51.5525, -0.1715],
    NW8: [51.5325, -0.1725],
    W2: [51.5145, -0.1805],
    W9: [51.5275, -0.1925],
    W11: [51.5135, -0.2045],
    N1: [51.5385, -0.0985],
    N7: [51.5545, -0.1165],
    EC1V: [51.5275, -0.0965],
    WC1H: [51.5255, -0.1245],
    WC2H: [51.5135, -0.1285],
    SW1A: [51.5035, -0.1395],
    SW3: [51.4915, -0.1665],
    SW7: [51.4965, -0.1765],
    E8: [51.5435, -0.0645],
  },
  US: {
    '100': [40.7485, -73.9925],
    '101': [40.7505, -73.9855],
    '102': [40.7125, -74.0065],
    '104': [40.8445, -73.8775],
    '110': [40.7255, -73.6345],
    '112': [40.6525, -73.9495],
    '113': [40.7275, -73.8305],
    '114': [40.6915, -73.8055],
    '070': [40.7365, -74.1995],
    '073': [40.7215, -74.0565],
  },
}

export type MapFeature = {
  kind: 'park' | 'water'
  name: string
  /** A park is an outline; water is a line along the middle of the river. */
  points: [number, number][]
}

/** A few landmarks drawn under a sample studio's map, approximately. Sample data only. */
const SAMPLE_FEATURES: Record<Region, MapFeature[]> = {
  UK: [
    {
      kind: 'park',
      name: 'Regent’s Park',
      points: [
        [51.5355, -0.1585],
        [51.5357, -0.1475],
        [51.53, -0.144],
        [51.5225, -0.1455],
        [51.5215, -0.153],
        [51.525, -0.161],
        [51.532, -0.162],
      ],
    },
    {
      kind: 'park',
      name: 'Hyde Park',
      points: [
        [51.5112, -0.188],
        [51.5118, -0.159],
        [51.5095, -0.1525],
        [51.5025, -0.1525],
        [51.502, -0.1885],
      ],
    },
    {
      kind: 'park',
      name: 'Primrose Hill',
      points: [
        [51.5425, -0.1645],
        [51.5428, -0.1575],
        [51.5375, -0.1555],
        [51.5372, -0.1625],
      ],
    },
    {
      kind: 'water',
      name: 'River Thames',
      points: [
        [51.4855, -0.21],
        [51.484, -0.18],
        [51.486, -0.15],
        [51.4905, -0.128],
        [51.501, -0.122],
        [51.508, -0.115],
        [51.509, -0.098],
        [51.5075, -0.075],
        [51.505, -0.06],
      ],
    },
  ],
  US: [
    {
      kind: 'park',
      name: 'Central Park',
      points: [
        [40.7681, -73.9819],
        [40.8003, -73.9581],
        [40.7968, -73.9493],
        [40.7644, -73.973],
      ],
    },
    {
      kind: 'park',
      name: 'Prospect Park',
      points: [
        [40.6725, -73.9705],
        [40.6655, -73.9625],
        [40.6505, -73.9645],
        [40.6535, -73.9785],
        [40.6625, -73.9805],
      ],
    },
    {
      kind: 'water',
      name: 'Hudson River',
      points: [
        [40.85, -73.952],
        [40.8, -73.978],
        [40.76, -74.006],
        [40.73, -74.016],
        [40.7, -74.025],
        [40.67, -74.05],
      ],
    },
    {
      kind: 'water',
      name: 'East River',
      points: [
        [40.8, -73.93],
        [40.775, -73.94],
        [40.75, -73.964],
        [40.73, -73.972],
        [40.71, -73.98],
        [40.7, -74.005],
      ],
    },
  ],
}

/** Landmarks to draw under the map; none once a real map service draws the streets. */
export const mapFeatures = (s: BusinessState): MapFeature[] =>
  mapReady(s) ? SAMPLE_FEATURES[s.organisation.region] : []

const SAMPLE_HOME: Record<Region, string> = { UK: 'W1G', US: '100' }

/** Whether this studio can show its client areas on a map. */
export const mapReady = (s: BusinessState) => operations(s).mode === 'sandbox'

export function areaCentre(s: BusinessState, area: string): [number, number] | undefined {
  if (!mapReady(s)) return undefined
  return SAMPLE_CENTRES[s.organisation.region][area]
}

/** The postcode area in a location's address, such as W1G in "24 Devonshire Place, London W1G". */
export function addressArea(address: string, region: Region) {
  const words = address.toUpperCase().replace(/,/g, ' ').split(/\s+/).filter(Boolean)
  for (let i = words.length - 1; i >= 0; i -= 1) {
    const pair = i > 0 ? postcodeArea(`${words[i - 1]}${words[i]}`, region) : null
    if (region === 'UK' && pair && /\d[A-Z]{2}$/.test(words[i])) return pair
    const one = postcodeArea(words[i], region)
    if (one && (region === 'UK' || /^\d{5}/.test(words[i]))) return one
  }
  return null
}

export type MapArea = {
  area: string
  clients: number
  share: number
  /** Clients from this area in the window before, for the change; null when that is too few. */
  before: number | null
  visits: number
  /** Treatment sales from these visits, before any refunds. */
  salesMinor: number
  centre: [number, number] | null
}
export type MapPlace = { id: string; name: string; centre: [number, number] | null }

/**
 * Named areas with their visits and sales in the window, and how many clients came from each in
 * the same length of time before it. Counts below `AREA_MIN_GROUP` are never returned.
 */
export function mapAreas(
  s: BusinessState,
  today: string,
  locationId: string | 'all',
  days = 365,
): { total: number; areas: MapArea[]; places: MapPlace[] } {
  const from = addDays(today, -days)
  const earlier = addDays(from, -days)
  const here = (a: BusinessState['appointments'][number]) =>
    a.status !== 'cancelled' &&
    a.status !== 'no_show' &&
    (locationId === 'all' || a.locationId === locationId)
  const area = new Map(s.clients.map((c) => [c.id, c.postcodeArea]))
  const now = s.appointments.filter((a) => here(a) && a.date >= from)
  const then = s.appointments.filter((a) => here(a) && a.date >= earlier && a.date < from)
  const sales = new Map(s.sales.map((x) => [x.appointmentId, x]))
  const rows = new Map<
    string,
    { clients: Set<string>; before: Set<string>; visits: number; salesMinor: number }
  >()
  const row = (key: string) => {
    let r = rows.get(key)
    if (!r) rows.set(key, (r = { clients: new Set(), before: new Set(), visits: 0, salesMinor: 0 }))
    return r
  }
  const counted = new Set(now.map((a) => a.clientId))
  for (const a of now) {
    const key = area.get(a.clientId)
    if (!key) continue
    const r = row(key)
    r.clients.add(a.clientId)
    if (a.date <= today) r.visits += 1
    const sale = sales.get(a.id)
    if (sale) r.salesMinor += sale.serviceMinor - (sale.discountMinor ?? 0)
  }
  for (const a of then) {
    const key = area.get(a.clientId)
    if (key && rows.has(key)) row(key).before.add(a.clientId)
  }
  const total = counted.size
  const areas: MapArea[] = [...rows]
    .filter(([, r]) => r.clients.size >= AREA_MIN_GROUP)
    .map(([key, r]) => ({
      area: key,
      clients: r.clients.size,
      share: total ? r.clients.size / total : 0,
      before: r.before.size >= AREA_MIN_GROUP ? r.before.size : null,
      visits: r.visits,
      salesMinor: r.salesMinor,
      centre: areaCentre(s, key) ?? null,
    }))
    .sort((a, b) => b.clients - a.clients || a.area.localeCompare(b.area))
  const region = s.organisation.region
  const sites = places(s).filter((p) => locationId === 'all' || p.id === locationId)
  return {
    total,
    areas,
    places: sites.map((p) => {
      // A sample studio's main location sits in its sample home area when its address has none.
      const key =
        addressArea(p.address, region) ??
        (mapReady(s) && p.id === s.organisation.locationId ? SAMPLE_HOME[region] : null)
      return { id: p.id, name: p.name, centre: (key && areaCentre(s, key)) || null }
    }),
  }
}

/** Web Mercator: a latitude and longitude as a point on a square world of `size` units. */
export function project([lat, lng]: [number, number], size: number) {
  const sin = Math.sin((lat * Math.PI) / 180)
  return {
    x: ((lng + 180) / 360) * size,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * size,
  }
}

/** Miles to the map's units at a latitude, for distance rings. */
export function milesAcross(miles: number, lat: number, size: number) {
  const metresPerUnit = (40_075_016.7 * Math.cos((lat * Math.PI) / 180)) / size
  return (miles * 1609.344) / metresPerUnit
}

/** Straight-line miles between two points, for "within a mile". */
export function milesBetween(a: [number, number], b: [number, number]) {
  const rad = Math.PI / 180
  const dLat = (b[0] - a[0]) * rad
  const dLng = (b[1] - a[1]) * rad
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLng / 2) ** 2
  return 2 * 3958.8 * Math.asin(Math.sqrt(h))
}

/** How an area has changed since the same length of time before. */
export function areaChange(a: MapArea) {
  if (a.before === null) return { label: 'No earlier figure to compare', growing: false }
  const diff = a.clients - a.before
  if (diff > 0) return { label: `Up ${diff} on the period before`, growing: true }
  if (diff < 0) return { label: `Down ${-diff} on the period before`, growing: false }
  return { label: 'The same as the period before', growing: false }
}
