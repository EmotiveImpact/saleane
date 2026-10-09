import { describe, expect, it } from 'vitest'
import type { BusinessState } from './model'
import { seed } from './seed'
import { operations } from './operations'
import { availabilityEntries, bookableOnGoogle, serviceFeed } from './googleFeeds'

// V4 and V2: Book with Google for a studio with a second location, Islington. Maya works there on
// Thursdays with treatment room 2, the facial costs more there and the massage is not offered there.
const islington = 'loc-islington'
const thursday = '2026-10-08'
function twoSites(): BusinessState {
  const s = seed('UK')
  const o = operations(s)
  return {
    ...s,
    operations: {
      ...o,
      // Google only ever lists a studio of its own, never a sample one.
      mode: 'local',
      locations: [{ id: islington, name: 'Islington', address: '1 Upper Street, London' }],
    },
    resources: s.resources.map((r) => (r.id === 'room-two' ? { ...r, locationId: islington } : r)),
    staff: s.staff.map((p) =>
      p.id === 'staff-maya'
        ? { ...p, hours: o.hours.map((h) => (h.day === 4 ? { ...h, locationId: islington } : h)) }
        : p,
    ),
    // Google takes no deposits, so these treatments are offered there without one.
    services: s.services.map((x) => ({
      ...x,
      depositMinor: 0,
      ...(x.id === 'service-facial'
        ? { locationPrices: [{ locationId: islington, priceMinor: 11000 }] }
        : {}),
      ...(x.id === 'service-restore' ? { notOfferedAt: [islington] } : {}),
    })),
  }
}

describe('Book with Google with several locations', () => {
  it('lists a treatment priced differently at its locations from its lowest price', () => {
    const state = twoSites()
    const feed = serviceFeed([{ id: 'org-1', slug: 'studio', state }], Date.parse(thursday))
    const facial = feed.service.find((x) => x.service_id === 'service-facial')!
    expect(facial.price).toEqual({ price_micros: 95_000_000, currency_code: 'GBP' })
    expect(facial).toMatchObject({ price_interpretation: 'STARTS_AT' })
    // The same price everywhere stays an exact price.
    const massage = feed.service.find((x) => x.service_id === 'service-lymphatic')!
    expect(massage.price).toEqual({ price_micros: 120_000_000, currency_code: 'GBP' })
    expect(massage).not.toHaveProperty('price_interpretation')
  })

  it('offers no time at a location that does not offer the treatment', () => {
    const state = twoSites()
    const times = availabilityEntries(
      { id: 'org-1', slug: 'studio', state },
      `${thursday}T06:00:00Z`,
      1,
    )
    // Maya is at Islington on Thursday, where the restore massage is not offered; Sophia is not.
    const restore = times.filter((e) => e.service_id === 'service-restore')
    expect(restore.length).toBeGreaterThan(0)
    expect(restore.every((e) => e.resources.staff_id === 'staff-sophia')).toBe(true)
    expect(
      times.some((e) => e.service_id === 'service-facial' && e.resources.staff_id === 'staff-maya'),
    ).toBe(true)
  })

  it('leaves off a treatment no open location offers, or that nobody there does', () => {
    const state = twoSites()
    const changed: BusinessState = {
      ...state,
      services: state.services.map((x) =>
        x.id === 'service-lymphatic'
          ? { ...x, notOfferedAt: [state.organisation.locationId, islington] }
          : x,
      ),
      staff: state.staff.map((p) => (p.id === 'staff-theo' ? { ...p, archived: true } : p)),
    }
    expect(bookableOnGoogle(changed).map((x) => x.id)).toEqual([
      'service-facial',
      'service-restore',
    ])
    const feed = serviceFeed([{ id: 'org-1', slug: 'studio', state: changed }], 0)
    expect(feed.service.map((x) => x.service_id)).toEqual(['service-facial', 'service-restore'])
  })
})
