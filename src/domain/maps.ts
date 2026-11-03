/**
 * Stage 6: the map on a guest's visit page, behind a swappable adapter. Maps are a live service
 * that is not connected yet, so the only adapter is the test one: it never calls a map service
 * and asks the page to draw an honest placeholder (the address, a pin and a line saying a map is
 * shown once a map service is connected). A real adapter would return a picture of the map for
 * the address; the Directions link stays either way.
 */
export type StudioMapView =
  | {
      kind: 'map'
      /** A picture of the map, from the connected map service. */
      src: string
      alt: string
      /** Who drew the map, as the service asks to be credited. */
      credit: string
    }
  | { kind: 'placeholder'; address: string; note: string }

export type MapAdapter = {
  /** True only for a connected map service. */
  readonly live: boolean
  view(address: string): StudioMapView
}

export const MAP_PLACEHOLDER_NOTE = 'Map shown when a map service is connected.'

/** The test adapter: no network, no map service, only the address it was given. */
export const testMapAdapter: MapAdapter = {
  live: false,
  view: (address) => ({ kind: 'placeholder', address, note: MAP_PLACEHOLDER_NOTE }),
}

let adapter: MapAdapter = testMapAdapter

/** Swaps the map adapter, for a connected service or a test. Returns the one it replaced. */
export function setMapAdapter(next: MapAdapter) {
  const previous = adapter
  adapter = next
  return previous
}

/** The map for a studio's address, or null when the studio gave no address to show. */
export function studioMap(address: string): StudioMapView | null {
  const trimmed = address.trim()
  return trimmed ? adapter.view(trimmed) : null
}
