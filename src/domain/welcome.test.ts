import { describe, expect, it } from 'vitest'
import type { Role } from './operations'
import { welcomeFor } from './welcome'

// The welcome for someone who has just joined: three lines, three places and a way in, by role.
const roles: Role[] = ['owner', 'manager', 'reception', 'practitioner', 'general', 'regional']

describe('the welcome for a new team member', () => {
  it('gives every role three things it does, three places and a button to open', () => {
    for (const role of roles) {
      const welcome = welcomeFor(role)
      expect(welcome.does).toHaveLength(3)
      expect(welcome.day.places).toHaveLength(3)
      expect(welcome.open).toMatch(/^Open /)
      // Plain words: no dashes standing in for punctuation.
      const words = [
        welcome.day.heading,
        ...welcome.does,
        ...welcome.day.places.flatMap(Object.values),
      ]
      for (const line of words) expect(line).not.toMatch(/[—–]/)
    }
  })

  it('names the place a general or regional manager looks after', () => {
    expect(welcomeFor('general', 'Frome').day.heading).toBe('Running Frome')
    expect(welcomeFor('general', 'Frome').does[0]).toBe('Run Frome: its calendar, till and team.')
    expect(welcomeFor('regional', 'the South West').does[0]).toBe(
      'See how each location in the South West is doing.',
    )
  })

  it('tells a practitioner they see their own guests only, and opens their day', () => {
    const welcome = welcomeFor('practitioner')
    expect(welcome.day.places.map((p) => p.name)).toContain('Only your guests')
    expect(welcome.open).toBe('Open your day')
  })

  it('tells a manager what stays with the owner', () => {
    expect(welcomeFor('manager').day.places[2].detail).toMatch(/stay with the owner/)
    expect(welcomeFor('owner').day.places[2].detail).not.toMatch(/stay with the owner/)
  })
})
