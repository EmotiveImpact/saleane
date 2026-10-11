import { describe, expect, it } from 'vitest'
import type { BusinessState } from './model'
import { seed } from './seed'
import { hoursFor, operations } from './operations'
import {
  aiBookingAction,
  aiBookingActor,
  aiBookingOn,
  assistantFrom,
  bookedAnswer,
  bookingPageOnly,
  clockMinutes,
  clockText,
  freeTimes,
  treatmentList,
} from './aiBooking'
import { channelNote } from './bookingChannel'

// Stage 5: what an AI assistant reads and is told through a studio's booking connection.
const islington = 'loc-islington'
const now = '2026-10-06T07:00:00.000Z'
const bookingUrl = 'http://127.0.0.1:5173/book/linden'
/** A studio of its own with a second location, Islington, where Maya works on Thursdays. */
function twoSites(): BusinessState {
  const s = seed('UK')
  const o = operations(s)
  return {
    ...s,
    operations: {
      ...o,
      mode: 'local',
      bookingEnabled: true,
      aiBooking: { enabled: true },
      locations: [{ id: islington, name: 'Islington', address: '1 Upper Street, London' }],
    },
    resources: s.resources.map((r) => (r.id === 'room-two' ? { ...r, locationId: islington } : r)),
    staff: s.staff.map((p) =>
      p.id === 'staff-maya'
        ? { ...p, hours: o.hours.map((h) => (h.day === 4 ? { ...h, locationId: islington } : h)) }
        : p,
    ),
    services: s.services.map((x) => ({
      ...x,
      depositMinor: x.id === 'service-restore' ? 2500 : 0,
      ...(x.id === 'service-facial'
        ? { locationPrices: [{ locationId: islington, priceMinor: 11000 }] }
        : {}),
    })),
  }
}

describe('Booking through ChatGPT or Claude, in the studio record', () => {
  it('knows which assistant connected from the names it gave', () => {
    expect(assistantFrom('openai-mcp')).toBe('chatgpt')
    expect(assistantFrom('ChatGPT')).toBe('chatgpt')
    expect(assistantFrom('claude-ai')).toBe('claude')
    expect(assistantFrom(undefined, 'Anthropic connector')).toBe('claude')
    expect(assistantFrom('mcp', undefined, 'openai-mcp/1.0.0 (ChatGPT)')).toBe('chatgpt')
    expect(assistantFrom('mcp-inspector')).toBe('assistant')
    expect(assistantFrom()).toBe('assistant')
    expect(aiBookingActor('chatgpt')).toBe('Guest, through ChatGPT')
    expect(aiBookingActor('assistant')).toBe('Guest, through an AI assistant')
    expect(aiBookingAction('claude')).toBe('ai-booking.claude')
    expect(channelNote('claude')).toBe('Booked by the guest through Claude.')
    expect(channelNote('instagram')).toBe('Booked through your Instagram link.')
  })

  it('is on only when the owner chose it and online booking is open', () => {
    const state = twoSites()
    expect(aiBookingOn(state)).toBe(true)
    const off = { ...state, operations: { ...operations(state), aiBooking: { enabled: false } } }
    expect(aiBookingOn(off)).toBe(false)
    const closed = { ...state, operations: { ...operations(state), bookingEnabled: false } }
    expect(aiBookingOn(closed)).toBe(false)
    expect(aiBookingOn(seed('UK'))).toBe(false)
  })

  it('reads and writes times on the studio’s clock', () => {
    expect(clockText(570)).toBe('09:30')
    expect(clockText(0)).toBe('00:00')
    expect(clockMinutes('09:30')).toBe(570)
    expect(clockMinutes(' 23:59 ')).toBe(1439)
    for (const wrong of ['9:30', '24:00', '09:60', '0930', 'half nine', ''])
      expect(clockMinutes(wrong)).toBeNull()
  })

  it('lists each location’s full price and keeps deposit treatments on the booking page', () => {
    const state = twoSites()
    const list = treatmentList(state, { bookingUrl })
    const treatments = list.data.treatments as {
      id: string
      locations: { id: string; price: string }[]
    }[]
    const facial = treatments.find((x) => x.id === 'service-facial')!
    expect(facial.locations.map((l) => l.id)).toEqual([state.organisation.locationId, islington])
    expect(new Set(facial.locations.map((l) => l.price)).size).toBe(2)
    expect(list.text).toMatch(/at Islington/)
    expect(treatments.map((x) => x.id)).not.toContain('service-restore')
    expect(bookingPageOnly(state)).toEqual([
      { name: state.services.find((x) => x.id === 'service-restore')!.name, reason: 'deposit' },
    ])
    expect(list.text).toMatch(/needs a deposit/)
  })

  it('finds times only where the treatment can happen, flags closed days and caps the days', () => {
    const state = twoSites()
    const found = freeTimes(
      state,
      { treatment_id: 'service-facial', location_id: islington },
      { bookingUrl, now },
    )
    if ('refused' in found) throw new Error(found.refused)
    const days = found.data.days as { date: string; closed: boolean; times: string[] }[]
    expect(days.map((d) => d.date)).toEqual([
      '2026-10-06',
      '2026-10-07',
      '2026-10-08',
      '2026-10-09',
      '2026-10-10',
      '2026-10-11',
      '2026-10-12',
    ])
    // Maya is the only one at Islington, and only on Thursdays.
    expect(days.filter((d) => d.times.length).map((d) => d.date)).toEqual(['2026-10-08'])
    for (const day of days)
      if (hoursFor(state, day.date, islington).closed) expect(day.closed).toBe(true)
    expect(found.data.location).toEqual({ id: islington, name: 'Islington' })
    const capped = freeTimes(
      state,
      { treatment_id: 'service-facial', to_date: '2027-01-31' },
      { bookingUrl, now },
    )
    if ('refused' in capped) throw new Error(capped.refused)
    expect((capped.data.days as unknown[]).length).toBe(14)
    expect(capped.data.more).toBe('Ask again from 2026-10-20 for later days.')
    expect(
      freeTimes(state, { treatment_id: 'service-restore' }, { bookingUrl, now }),
    ).toMatchObject({ refused: expect.stringContaining(bookingUrl) })
  })

  it('never says a confirmation was sent when it was only queued or in test mode', () => {
    const state = twoSites()
    const visit = state.appointments[0]
    const context = { manageUrl: 'http://127.0.0.1:5173/manage#x', now: Date.parse(now) }
    const testMode = bookedAnswer(state, visit.id, { ...context, emailsLive: false })
    expect(testMode.data.confirmation).toBe(
      'Emails are in test mode, so no confirmation email is sent. Give the guest the private link.',
    )
    const live = bookedAnswer(state, visit.id, { ...context, emailsLive: true })
    expect(live.data.confirmation).toBe(
      "The studio's usual confirmation email is queued for the guest.",
    )
    const sample = bookedAnswer(seed('UK'), visit.id, { ...context, emailsLive: true })
    expect(sample.data).toMatchObject({ sample: true })
    expect(sample.data.confirmation).toMatch(/fictional sample studio/)
    for (const answer of [testMode, live, sample]) {
      expect(answer.text).toMatch(/private link: http:\/\/127\.0\.0\.1:5173\/manage#x/)
      expect(answer.text).not.toMatch(/was sent|has been sent|is sent to/)
    }
  })
})
