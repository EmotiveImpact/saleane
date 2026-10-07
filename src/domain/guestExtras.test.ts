import { describe, expect, it } from 'vitest'
import { execute } from './commands'
import type { Command } from './commands'
import { parseState } from './model'
import { can, permissionFor } from './operations'
import { seed } from './seed'
import { bookingChannel, channelLabel, channelLink } from './bookingChannel'
import { guestView } from './guest'

const now = '2026-10-06T08:00:00.000Z'
const contact = {
  name: 'Channel Guest',
  email: 'channel.guest@example.invalid',
  phone: '+44 7700 900333',
  marketingConsent: false,
}
function apply(command: Command, state = seed('UK')) {
  return execute(state, command, now, () => crypto.randomUUID())
}
const booking = (extra: object = {}): Command => {
  const s = seed('UK')
  const service = s.services[0]
  const staff = s.staff.find((person) => person.serviceIds.includes(service.id))!
  return {
    type: 'book',
    input: {
      serviceId: service.id,
      staffId: staff.id,
      date: '2026-10-08',
      startMinutes: 600,
      contact,
      source: 'online',
      ...extra,
    },
  } as Command
}

describe('before you arrive notes', () => {
  it('saves the studio and service notes in one change, and an empty note removes it', () => {
    const s = seed('UK')
    const [first, second] = s.services
    const saved = apply({
      type: 'guest-notes',
      arrivalNote: '  Ring the bell at the blue door. Allow ten minutes.  ',
      prepNotes: [
        { serviceId: first.id, note: 'Come with clean skin.' },
        { serviceId: second.id, note: '' },
      ],
    })
    if (!saved.ok) throw new Error(saved.error)
    expect(saved.state.organisation.arrivalNote).toBe(
      'Ring the bell at the blue door. Allow ten minutes.',
    )
    expect(saved.state.services[0].prepNote).toBe('Come with clean skin.')
    expect('prepNote' in saved.state.services[1]).toBe(false)
    const cleared = apply(
      { type: 'guest-notes', arrivalNote: '', prepNotes: [{ serviceId: first.id, note: '' }] },
      saved.state,
    )
    if (!cleared.ok) throw new Error(cleared.error)
    expect('arrivalNote' in cleared.state.organisation).toBe(false)
    expect('prepNote' in cleared.state.services[0]).toBe(false)
  })

  it('refuses notes over the limit and services from elsewhere, changing nothing', () => {
    const s = seed('UK')
    expect(apply({ type: 'guest-notes', arrivalNote: 'x'.repeat(401), prepNotes: [] }).ok).toBe(
      false,
    )
    const foreign = apply({
      type: 'guest-notes',
      arrivalNote: 'Allowed',
      prepNotes: [{ serviceId: 'service-elsewhere', note: 'Not here' }],
    })
    expect(foreign).toEqual({ ok: false, error: 'Service does not belong to this workspace.' })
    expect(s.organisation.arrivalNote).toBeUndefined()
  })

  it('lets owners and managers edit the notes, not reception or practitioners', () => {
    const action = permissionFor({ type: 'guest-notes' })
    expect(action).toBe('catalogue')
    expect(can('owner', action)).toBe(true)
    expect(can('manager', action)).toBe(true)
    expect(can('reception', action)).toBe(false)
    expect(can('practitioner', action)).toBe(false)
  })

  it('loads an older saved studio that has no notes or channels', () => {
    const old = structuredClone(seed('UK'))
    expect(() => parseState(old, 'UK')).not.toThrow()
    const long = structuredClone(old)
    long.organisation.arrivalNote = 'x'.repeat(401)
    expect(() => parseState(long, 'UK')).toThrow()
  })

  it('puts only the notes, address and a calendar UID into the guest view', () => {
    const noted = apply({
      type: 'guest-notes',
      arrivalNote: 'Park on Elm Street.',
      prepNotes: [{ serviceId: seed('UK').services[0].id, note: 'Come with clean skin.' }],
    })
    if (!noted.ok) throw new Error(noted.error)
    const booked = apply(booking(), noted.state)
    if (!booked.ok) throw new Error(booked.error)
    const view = guestView(booked.state, booked.recordId, Date.parse(now))
    expect(view.arrival).toEqual({
      studioNote: 'Park on Elm Street.',
      serviceNote: 'Come with clean skin.',
    })
    expect(view.organisation.address).toBe(booked.state.organisation.address)
    expect(view.visit.calendarUid).toMatch(/^visit-[0-9a-f]{16}@saleane$/)
    expect(JSON.stringify(view)).not.toContain(booked.recordId)
  })
})

describe('booking source from a shared link', () => {
  it('accepts only the studio’s own channels', () => {
    expect(bookingChannel('google')).toBe('google')
    expect(bookingChannel(' Instagram ')).toBe('instagram')
    for (const value of ['facebook', '', 'google; drop', undefined, null, 42, ['google']])
      expect(bookingChannel(value)).toBeUndefined()
    expect(channelLabel('google')).toBe('Google')
    expect(channelLink('http://127.0.0.1:5175/book/studio', 'instagram')).toBe(
      'http://127.0.0.1:5175/book/studio?from=instagram',
    )
    expect(channelLink('http://127.0.0.1:5175/book/studio')).toBe(
      'http://127.0.0.1:5175/book/studio',
    )
  })

  it('records the channel on an online visit and in its history', () => {
    const result = apply(booking({ channel: 'google' }))
    if (!result.ok) throw new Error(result.error)
    const visit = result.state.appointments.find((a) => a.id === result.recordId)!
    expect(visit.channel).toBe('google')
    expect(result.state.events.at(-1)?.detail).toMatch(/Booked through your Google link\.$/)
    const plain = apply(booking())
    if (!plain.ok) throw new Error(plain.error)
    expect('channel' in plain.state.appointments.find((a) => a.id === plain.recordId)!).toBe(false)
  })

  it('refuses a channel on a desk booking or an unknown channel', () => {
    expect(apply(booking({ source: 'desk', channel: 'google' })).ok).toBe(false)
    expect(apply(booking({ channel: 'facebook' })).ok).toBe(false)
  })
})
