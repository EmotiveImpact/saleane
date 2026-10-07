import { describe, expect, it } from 'vitest'
import { seed } from './seed'
import { execute } from './commands'
import type { Command } from './commands'
import type { Appointment, BusinessState } from './model'
import { isReviewUrl, parseState } from './model'
import { availableAllocation } from './allocation'
import { guestView } from './guest'
import { composeMessage } from './reminders'

// V1.5: a neutral public review link, and resting time for rooms.
const NOW = '2026-10-06T08:00:00.000Z'
// A Tuesday a week ahead, when the studio is open.
const DAY = '2026-10-13'
let sequence = 0
function apply(s: BusinessState, command: Command) {
  const result = execute(s, command, NOW, () => `rr-${++sequence}`)
  if (!result.ok) throw new Error(result.error)
  return result.state
}
const organisation = (s: BusinessState, reviewUrl?: string): Command => ({
  type: 'organisation',
  name: s.organisation.name,
  locationName: s.organisation.locationName,
  address: s.organisation.address,
  timeZone: s.organisation.timeZone,
  bookingEnabled: true,
  ...(reviewUrl === undefined ? {} : { reviewUrl }),
})

describe('public review link', () => {
  it('accepts only a plain https address', () => {
    expect(isReviewUrl('https://g.page/r/atelier/review')).toBe(true)
    expect(isReviewUrl('http://g.page/r/atelier/review')).toBe(false)
    expect(isReviewUrl('https://user:pass@g.page/review')).toBe(false)
    expect(isReviewUrl('javascript:alert(1)')).toBe(false)
    expect(isReviewUrl('not a link')).toBe(false)
  })

  it('is set, kept, and removed from business details', () => {
    const s = seed('UK')
    delete s.organisation.reviewUrl
    const set = apply(s, organisation(s, ' https://reviews.example.com/us '))
    expect(set.organisation.reviewUrl).toBe('https://reviews.example.com/us')
    // Saving the details without the field leaves the link alone.
    expect(apply(set, organisation(set)).organisation.reviewUrl).toBe(
      'https://reviews.example.com/us',
    )
    expect(apply(set, organisation(set, '')).organisation.reviewUrl).toBeUndefined()
    const refused = execute(set, organisation(set, 'http://reviews.example.com'), NOW, () => 'x')
    expect(refused.ok).toBe(false)
    if (!refused.ok) expect(refused.error).toMatch(/https:\/\//)
    // A stored link that is not https never loads.
    expect(() =>
      parseState(
        { ...set, organisation: { ...set.organisation, reviewUrl: 'ftp://x.example' } },
        'UK',
      ),
    ).toThrow()
  })

  it('offers the same link to every guest after a completed visit, whatever they rated', () => {
    const s = seed('UK')
    const done = s.appointments.filter((a) => a.status === 'completed')
    expect(done.length).toBeGreaterThan(1)
    const at = Date.parse(NOW)
    const rated = new Set(s.feedback?.map((f) => f.appointmentId))
    for (const a of done)
      expect(guestView(s, a.id, at).review).toEqual({ url: s.organisation.reviewUrl })
    expect(done.some((a) => rated.has(a.id))).toBe(true)
    const upcoming = s.appointments.find((a) => a.status === 'confirmed')!
    expect(guestView(s, upcoming.id, at).review).toBeUndefined()
    delete s.organisation.reviewUrl
    expect(guestView(s, done[0].id, at).review).toBeUndefined()
  })

  it('adds the same line to every feedback email, and only when a link is set', () => {
    const s = seed('UK')
    const visit = s.appointments.find((a) => a.status === 'completed')!
    const line = `you can also leave a public review: ${s.organisation.reviewUrl}`
    expect(composeMessage(s, visit, 'feedback', 'email').body).toContain(line)
    expect(composeMessage(s, visit, 'reminder', 'email').body).not.toContain('public review')
    delete s.organisation.reviewUrl
    expect(composeMessage(s, visit, 'feedback', 'email').body).not.toContain('public review')
  })
})

describe('room resting time', () => {
  /** An empty diary with one hour-long facial for Maya at 10:00 in treatment room 1. */
  function diary(rest?: number) {
    const s = seed('UK')
    const template = s.appointments[0]
    const visit: Appointment = {
      ...template,
      id: 'rest-visit',
      serviceId: 'service-facial',
      staffId: 'staff-maya',
      resourceId: 'room-one',
      date: DAY,
      startMinutes: 600,
      bookedDurationMinutes: 60,
      bookedBufferMinutes: 0,
      status: 'confirmed',
    }
    s.appointments = [visit]
    s.resources = s.resources.map((r) =>
      r.id === 'room-one' && rest ? { ...r, restMinutes: rest } : r,
    )
    return s
  }
  const room = (s: BusinessState, start: number, preferred?: string) =>
    availableAllocation(
      s,
      'service-facial',
      'staff-sophia',
      DAY,
      start,
      60,
      0,
      'treatment',
      undefined,
      NOW,
      preferred,
    )

  it('keeps a room free straight after a visit without resting time', () => {
    expect(room(diary(), 660, 'room-one')).toBe('room-one')
  })

  it('keeps a resting room empty after each visit, and finds another room instead', () => {
    const s = diary(30)
    expect(room(s, 660, 'room-one')).toBeNull()
    expect(room(s, 660)).toBe('room-two')
    expect(room(s, 690, 'room-one')).toBe('room-one')
  })

  it('leaves the rest before the next visit too', () => {
    const s = diary(30)
    s.appointments[0].startMinutes = 720
    // 10:30 to 11:30 leaves the room 30 minutes before the visit at 12:00: just enough.
    expect(room(s, 630, 'room-one')).toBe('room-one')
    // 10:45 to 11:45 would leave only 15.
    expect(room(s, 645, 'room-one')).toBeNull()
  })

  it('rests the room, not the professional', () => {
    const s = diary(30)
    // Maya can go straight on to her next guest in another room.
    expect(
      availableAllocation(
        s,
        'service-facial',
        'staff-maya',
        DAY,
        660,
        60,
        0,
        'treatment',
        undefined,
        NOW,
      ),
    ).toBe('room-two')
    // With no other room, nobody can use the resting one.
    s.resources = s.resources.map((r) => (r.id === 'room-two' ? { ...r, archived: true } : r))
    expect(room(s, 660)).toBeNull()
  })

  it('accepts resting time only in five-minute steps up to two hours', () => {
    const s = seed('UK')
    const resource = s.resources[0]
    const save = (restMinutes: number) =>
      execute(
        s,
        {
          type: 'resource',
          id: resource.id,
          input: { name: resource.name, type: resource.type, restMinutes },
        },
        NOW,
        () => 'x',
      ).ok
    expect(save(15)).toBe(true)
    expect(save(7)).toBe(false)
    expect(save(180)).toBe(false)
  })
})
