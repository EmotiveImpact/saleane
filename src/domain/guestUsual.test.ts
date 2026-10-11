import { describe, expect, it } from 'vitest'
import { guestView, guestViewSchema } from './guest'
import { operations } from './operations'
import { patchTestSettings } from './patchTests'
import type { BusinessState } from './model'
import {
  SATURDAY,
  TODAY,
  addClient,
  addVisit,
  monthlyRegular,
  studio,
} from '../test/clientInsightStudio'

// Stage 5: "Book your usual" on the guest's private visit page. The page shows one visit; after a
// completed one it may also carry a link to the booking page with their usual chosen, and nothing
// about the visits that usual was worked out from.
const NOW = Date.parse(`${TODAY}T09:00:00.000Z`)
const slug = 'fernleaf-rooms'

function regular() {
  const s = studio()
  s.operations = { ...operations(s), bookingEnabled: true }
  const amelia = addClient(s, 'Amelia Carter', {
    preferences: 'Prefers the quiet room.',
    phone: '+447700900456',
  })
  const visits = monthlyRegular(s, amelia.id, SATURDAY, 6)
  return { s, amelia, visits, last: visits.at(-1)! }
}
const view = (s: BusinessState, visitId: string, withSlug = true) =>
  guestView(s, visitId, NOW, null, withSlug ? { slug } : {})

describe('Book your usual on the guest visit page', () => {
  it('links to the booking page with the usual treatment, professional and next usual day', () => {
    const { s, last } = regular()
    expect(view(s, last.id).usual).toEqual({
      path: `/book/${slug}?service=facial&staff=maya&date=2026-10-31`,
      serviceName: 'Restorative Facial',
      professional: 'Maya',
      date: '2026-10-31',
    })
  })

  it('names the location with several, and opens the page there', () => {
    const s = studio()
    s.operations = {
      ...operations(s),
      bookingEnabled: true,
      locations: [{ id: 'islington', name: 'Islington', address: '1 Upper Street, London' }],
    }
    s.staff.find((p) => p.id === 'theo')!.hours = operations(s).hours.map((h) => ({
      ...h,
      locationId: 'islington',
    }))
    const ava = addClient(s, 'Ava Williams')
    const visits = monthlyRegular(s, ava.id, SATURDAY, 5, {
      serviceId: 'massage',
      staffId: 'theo',
      locationId: 'islington',
    })
    expect(view(s, visits.at(-1)!.id).usual).toEqual({
      path: `/book/${slug}?service=massage&staff=theo&date=2026-10-31&location=islington`,
      serviceName: 'Deep Massage',
      professional: 'Theo',
      date: '2026-10-31',
      location: 'Islington',
    })
  })

  it('is offered only after a completed visit, while the studio takes bookings online', () => {
    const { s, amelia, last } = regular()
    const coming = addVisit(s, amelia.id, '2026-11-28', { status: 'confirmed' })
    // A coming visit already booked: no usual to book again, on either page.
    expect(view(s, coming.id).usual).toBeUndefined()
    expect(view(s, last.id).usual).toBeUndefined()
    s.appointments = s.appointments.filter((a) => a.id !== coming.id)
    expect(view(s, last.id).usual).toBeDefined()
    // Without the booking page's address, or with online booking off.
    expect(view(s, last.id, false).usual).toBeUndefined()
    s.operations = { ...operations(s), bookingEnabled: false }
    expect(view(s, last.id).usual).toBeUndefined()
  })

  it('counts a visit booked ahead under another record with the same email', () => {
    const { s, last } = regular()
    const online = addClient(s, 'Amelia Carter', { email: 'AMELIA@example.com' })
    addVisit(s, online.id, '2026-10-31', { status: 'confirmed', source: 'online' })
    expect(view(s, last.id).usual).toBeUndefined()
  })

  it('is not offered with no clear usual, or when the usual cannot be booked online', () => {
    const s = studio()
    s.operations = { ...operations(s), bookingEnabled: true }
    const ivy = addClient(s, 'Ivy Moss')
    const two = monthlyRegular(s, ivy.id, SATURDAY, 2)
    expect(view(s, two.at(-1)!.id).usual).toBeUndefined()
    const ava = addClient(s, 'Ava Williams')
    const colour = monthlyRegular(s, ava.id, SATURDAY, 4, { serviceId: 'colour' })
    expect(view(s, colour.at(-1)!.id).usual).toMatchObject({ serviceName: 'Gloss Colour' })
    s.operations = { ...operations(s), patchTests: { ...patchTestSettings(s), stopOnline: true } }
    expect(view(s, colour.at(-1)!.id).usual).toBeUndefined()
  })

  it('carries nothing about the visits, the client or anyone else', () => {
    const { s, amelia, visits, last } = regular()
    const without = guestView(s, last.id, NOW, null, {})
    const shown = view(s, last.id)
    // The same page, plus the link and nothing else.
    expect(Object.keys(shown).sort()).toEqual([...Object.keys(without), 'usual'].sort())
    expect({ ...shown, usual: undefined }).toEqual({ ...without, usual: undefined })
    const written = JSON.stringify(shown.usual)
    for (const secret of [
      amelia.id,
      amelia.name,
      amelia.email,
      amelia.phone,
      'quiet room',
      '£',
      ...visits.map((a) => a.id),
      ...visits.slice(0, -1).map((a) => a.date),
    ])
      expect(written).not.toContain(secret)
  })

  it('refuses anything more in the link: the schema is strict', () => {
    const { s, last } = regular()
    const shown = view(s, last.id)
    expect(guestViewSchema.safeParse(shown).success).toBe(true)
    for (const extra of [{ clientId: 'client-1' }, { visits: 6 }, { history: [] }])
      expect(
        guestViewSchema.safeParse({ ...shown, usual: { ...shown.usual, ...extra } }).success,
      ).toBe(false)
    expect(guestViewSchema.safeParse({ ...shown, usualVisits: [] }).success).toBe(false)
  })
})
