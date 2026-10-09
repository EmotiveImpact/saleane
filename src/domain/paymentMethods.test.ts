import { describe, expect, it } from 'vitest'
import { seed } from './seed'
import { mayRemoveSavedCard } from './paymentMethods'

describe('who may remove a saved card', () => {
  it('is the owner and managers, and a general manager for a client who visits their location', () => {
    const s = seed('UK')
    const main = s.organisation.locationId
    const visitor = s.appointments[0].clientId
    expect(mayRemoveSavedCard(s, 'owner', visitor, null)).toBe(true)
    expect(mayRemoveSavedCard(s, 'manager', visitor, null)).toBe(true)
    expect(mayRemoveSavedCard(s, 'general', visitor, main)).toBe(true)
    expect(mayRemoveSavedCard(s, 'general', visitor, 'location-elsewhere')).toBe(false)
    expect(mayRemoveSavedCard(s, 'general', visitor, null)).toBe(false)
    for (const role of ['reception', 'practitioner', 'regional'] as const)
      expect(mayRemoveSavedCard(s, role, visitor, main)).toBe(false)
  })
})
