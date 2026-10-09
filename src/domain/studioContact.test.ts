import { describe, expect, it } from 'vitest'
import { seed } from './seed'
import { execute } from './commands'
import type { Command } from './commands'
import type { BusinessState } from './model'
import { parseState } from './model'
import { operations } from './operations'
import { guestView } from './guest'
import { directionsLink, emailProblem, phoneLink, phoneProblem } from './studioContact'

// Item 7: guests are told how to reach the studio, so "contact the studio" never leads nowhere.
const NOW = '2026-10-06T08:00:00.000Z'
let sequence = 0
function run(s: BusinessState, command: Command) {
  return execute(s, command, NOW, () => `contact-${++sequence}`)
}
function apply(s: BusinessState, command: Command) {
  const result = run(s, command)
  if (!result.ok) throw new Error(result.error)
  return result.state
}
function studio() {
  const s = seed('UK')
  delete s.organisation.phone
  delete s.organisation.email
  return s
}
const details = (s: BusinessState, contact: { phone?: string; email?: string }): Command => ({
  type: 'organisation',
  name: s.organisation.name,
  locationName: s.organisation.locationName,
  address: s.organisation.address,
  timeZone: s.organisation.timeZone,
  bookingEnabled: true,
  ...contact,
})

describe('studio phone numbers and email addresses', () => {
  it('accepts a number as guests in the studio’s country would dial it, or with a country code', () => {
    for (const phone of [
      '020 7946 0123',
      '07700 900123',
      '+44 20 7946 0123',
      '+44 (0)20 7946 0123',
    ])
      expect(phoneProblem(phone, 'UK'), phone).toBeNull()
    for (const phone of ['(212) 555-0123', '212-555-0123', '1 212 555 0123', '+1 212 555 0123'])
      expect(phoneProblem(phone, 'US'), phone).toBeNull()
    for (const phone of ['12345', '020 7946', 'call us', '+0 20 7946 0123', '020 7946 0123 ext 4'])
      expect(phoneProblem(phone, 'UK'), phone).toMatch(/like 020 7946 0123/)
    expect(phoneProblem('020 7946 0123', 'US')).toMatch(/like \(212\) 555-0123/)
    expect(emailProblem('hello@studio.example')).toBeNull()
    for (const email of ['hello', 'hello@', 'hello studio@example.com'])
      expect(emailProblem(email), email).toMatch(/in full/)
  })

  it('links a call from anywhere and directions to the address', () => {
    expect(phoneLink('020 7946 0123', 'UK')).toBe('tel:+442079460123')
    expect(phoneLink('+44 (0)20 7946 0123', 'UK')).toBe('tel:+442079460123')
    expect(phoneLink('(212) 555-0123', 'US')).toBe('tel:+12125550123')
    expect(phoneLink('1 212 555 0123', 'US')).toBe('tel:+12125550123')
    expect(phoneLink('+1 212 555 0123', 'UK')).toBe('tel:+12125550123')
    expect(directionsLink(' 24 Devonshire Place, London W1G ')).toBe(
      'https://www.google.com/maps/search/?api=1&query=24%20Devonshire%20Place%2C%20London%20W1G',
    )
  })

  it('is set, kept and removed with the studio details, and checked first', () => {
    const s = studio()
    const set = apply(s, details(s, { phone: ' 020 7946 0123 ', email: 'hello@atelier.example' }))
    expect(set.organisation).toMatchObject({
      phone: '020 7946 0123',
      email: 'hello@atelier.example',
    })
    // Saving the details without the fields leaves them alone; an empty one removes it.
    expect(apply(set, details(set, {})).organisation).toMatchObject({ phone: '020 7946 0123' })
    const cleared = apply(set, details(set, { phone: '', email: '' })).organisation
    expect(cleared.phone).toBeUndefined()
    expect(cleared.email).toBeUndefined()
    const badPhone = run(set, details(set, { phone: '12345' }))
    expect(badPhone).toMatchObject({ ok: false, error: expect.stringMatching(/dial it/) })
    const badEmail = run(set, details(set, { email: 'hello' }))
    expect(badEmail).toMatchObject({ ok: false, error: expect.stringMatching(/in full/) })
    // An email that is not an address never loads from a saved record.
    expect(() =>
      parseState({ ...set, organisation: { ...set.organisation, email: 'nobody' } }, 'UK'),
    ).toThrow()
  })

  it('lets a location have its own, and shows guests the one for their visit', () => {
    const s = apply(studio(), details(studio(), { phone: '020 7946 0123' }))
    const input = { name: 'Islington', address: '9 Upper Street, London N1' }
    const bad = run(s, { type: 'location', input: { ...input, phone: 'call us' } })
    expect(bad).toMatchObject({ ok: false, error: expect.stringMatching(/dial it/) })
    const added = apply(s, {
      type: 'location',
      input: { ...input, phone: '020 7946 0999', email: 'islington@atelier.example' },
    })
    const place = operations(added).locations!.at(-1)!
    expect(place).toMatchObject({ phone: '020 7946 0999', email: 'islington@atelier.example' })
    // Editing without them removes them, like the note for guests.
    const edited = apply(added, { type: 'location', id: place.id, input })
    expect(operations(edited).locations!.at(-1)).not.toHaveProperty('phone')

    const visit = added.appointments.find((a) => a.status === 'confirmed' && a.date > '2026-10-06')!
    const there = structuredClone(added)
    there.appointments.find((a) => a.id === visit.id)!.locationId = place.id
    expect(guestView(there, visit.id, Date.parse(NOW)).organisation).toMatchObject({
      locationName: 'Islington',
      phone: '020 7946 0999',
      email: 'islington@atelier.example',
    })
    // Without its own, a location shows the studio's; with neither, nothing is invented.
    const plain = structuredClone(edited)
    plain.appointments.find((a) => a.id === visit.id)!.locationId = place.id
    const view = guestView(plain, visit.id, Date.parse(NOW)).organisation
    expect(view.phone).toBe('020 7946 0123')
    expect(view).not.toHaveProperty('email')
    const none = structuredClone(added)
    delete none.organisation.phone
    expect(guestView(none, visit.id, Date.parse(NOW)).organisation).not.toHaveProperty('phone')
  })
})
