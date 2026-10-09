import type { BusinessState, Region } from './model'
import { addDays } from './format'

/**
 * V5: where clients come from, by postcode area only. A client may have the first half of their
 * postcode recorded (UK "N1", "SW1A"; US the first three digits of a ZIP code, "100"), never the
 * full postcode or an address. Areas are shown grouped, and an area with fewer than
 * `AREA_MIN_GROUP` clients is folded into "Other areas", so no one person can be picked out.
 */
export const AREA_MIN_GROUP = 3
/** Clients counted: anyone with a visit in the past year or booked ahead. */
export const AREA_WINDOW_DAYS = 365

const UK_FULL = /^([A-Z]{1,2}\d[A-Z\d]?)(\d[A-Z]{2})$/
const UK_OUTWARD = /^[A-Z]{1,2}\d[A-Z\d]?$/

/**
 * The postcode area to keep from what was typed, or null when it is not one. A full postcode is
 * cut to its first half, so the rest is never stored.
 */
export function postcodeArea(raw: string, region: Region): string | null {
  const value = raw.toUpperCase().replace(/\s+/g, '')
  if (region === 'UK') {
    const full = UK_FULL.exec(value)
    if (full) return full[1]
    return UK_OUTWARD.test(value) ? value : null
  }
  const zip = /^(\d{3})(\d{2})?(-?\d{4})?$/.exec(value)
  return zip && (zip[2] || !zip[3]) ? zip[1] : null
}

export const areaHint = (region: Region) =>
  region === 'UK'
    ? 'Enter the first half of a postcode, such as N1 or SW1A.'
    : 'Enter a ZIP code, such as 10001. Only the first three digits are kept.'

export type AreaGroup = { area: string; clients: number; share: number }
export type ClientAreas = {
  /** Clients counted at the chosen location (or everywhere). */
  total: number
  /** Areas with at least AREA_MIN_GROUP clients, largest first. */
  groups: AreaGroup[]
  /** Clients in smaller areas, counted together. */
  other: number
  /** Clients with no area recorded. */
  unknown: number
}

/** Clients with a visit in the past year or booked ahead, at one location or all, by area. */
export function clientAreas(
  s: BusinessState,
  today: string,
  locationId: string | 'all' = 'all',
  days = AREA_WINDOW_DAYS,
): ClientAreas {
  const from = addDays(today, -days)
  const ids = new Set(
    s.appointments
      .filter(
        (a) =>
          a.date >= from &&
          a.status !== 'cancelled' &&
          a.status !== 'no_show' &&
          (locationId === 'all' || a.locationId === locationId),
      )
      .map((a) => a.clientId),
  )
  const counts = new Map<string, number>()
  let unknown = 0
  for (const client of s.clients) {
    if (!ids.has(client.id)) continue
    if (!client.postcodeArea) unknown += 1
    else counts.set(client.postcodeArea, (counts.get(client.postcodeArea) ?? 0) + 1)
  }
  const total = [...counts.values()].reduce((sum, n) => sum + n, unknown)
  const groups: AreaGroup[] = []
  let other = 0
  for (const [area, clients] of counts) {
    if (clients >= AREA_MIN_GROUP) groups.push({ area, clients, share: clients / total })
    else other += clients
  }
  groups.sort((a, b) => b.clients - a.clients || a.area.localeCompare(b.area))
  return { total, groups, other, unknown }
}
