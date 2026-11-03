import { afterEach, describe, expect, it, vi } from 'vitest'
import { MAP_PLACEHOLDER_NOTE, setMapAdapter, studioMap, testMapAdapter } from './maps'

describe('the map adapter', () => {
  afterEach(() => {
    setMapAdapter(testMapAdapter)
  })
  it('draws an honest placeholder in test mode and never calls a map service', () => {
    const fetch = vi.spyOn(globalThis, 'fetch')
    expect(testMapAdapter.live).toBe(false)
    expect(studioMap('  24 Devonshire Place, London W1G ')).toEqual({
      kind: 'placeholder',
      address: '24 Devonshire Place, London W1G',
      note: 'Map shown when a map service is connected.',
    })
    expect(MAP_PLACEHOLDER_NOTE).toBe('Map shown when a map service is connected.')
    expect(fetch).not.toHaveBeenCalled()
    fetch.mockRestore()
  })
  it('shows nothing when the studio gave no address', () => {
    expect(studioMap('   ')).toBeNull()
  })
  it('swaps to a connected map service without changing the page', () => {
    const previous = setMapAdapter({
      live: true,
      view: (address) => ({
        kind: 'map',
        src: `https://maps.example.com/static?q=${encodeURIComponent(address)}`,
        alt: `A map of ${address}`,
        credit: 'Map by Example Maps',
      }),
    })
    expect(previous).toBe(testMapAdapter)
    expect(studioMap('12 Example Mews')).toMatchObject({
      kind: 'map',
      alt: 'A map of 12 Example Mews',
    })
  })
})
