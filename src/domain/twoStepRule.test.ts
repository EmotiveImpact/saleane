import { describe, expect, it } from 'vitest'
import { seed } from './seed'
import { execute } from './commands'
import type { Command } from './commands'
import { parseState } from './model'
import { GENERAL_ACTIONS, can, permissionFor } from './operations'
import type { Role } from './operations'
import { practitionerRefusal } from './practitioner'
import { areaRefusal } from './area'
import { changeDetail } from './changeRecord'
import { commandSchema } from './commandSchema'
import { listNames, studiosAsking, twoStepForEveryone, twoStepHeldMessage } from './twoStepRule'

// Stage 6: the owner's switch to ask everyone in the studio to use two-step sign-in.
const now = '2026-10-06T09:00:00.000Z'
const ask = (forEveryone: boolean): Command => ({ type: 'two-step-rule', forEveryone })
const run = (s: ReturnType<typeof seed>, command: Command) =>
  execute(s, command, now, () => 'two-step-id')

describe('asking everyone to use two-step sign-in', () => {
  it('is off until the owner switches it on, and kept through a reload', () => {
    const s = seed('UK')
    expect(twoStepForEveryone(s)).toBe(false)
    const on = run(s, ask(true))
    expect(on.ok).toBe(true)
    if (!on.ok) return
    expect(twoStepForEveryone(on.state)).toBe(true)
    expect(on.state.revision).toBe(s.revision + 1)
    expect(twoStepForEveryone(parseState(JSON.parse(JSON.stringify(on.state)), 'UK'))).toBe(true)
    const off = run(on.state, ask(false))
    expect(off.ok && twoStepForEveryone(off.state)).toBe(false)
  })

  it('changes nothing when asked for what is already set', () => {
    const s = seed('UK')
    const same = run(s, ask(false))
    expect(same.ok && same.state).toBe(s)
  })

  it('is the owner’s alone', () => {
    const action = permissionFor(ask(true))
    const roles: Role[] = ['owner', 'manager', 'reception', 'practitioner', 'regional', 'general']
    expect(roles.filter((role) => can(role, action))).toEqual(['owner'])
    expect(GENERAL_ACTIONS as readonly string[]).not.toContain('two-step-rule')
    const s = seed('UK')
    expect(practitionerRefusal(s, s.staff[0].id, ask(true), '2026-10-06')).toBe(
      'Your role cannot make this change.',
    )
    expect(areaRefusal(s, 'any-region', ask(true))).toBe('Your role cannot make this change.')
  })

  it('accepts only a plain yes or no', () => {
    expect(commandSchema.safeParse(ask(true)).success).toBe(true)
    expect(commandSchema.safeParse({ type: 'two-step-rule', forEveryone: 'yes' }).success).toBe(
      false,
    )
    expect(
      commandSchema.safeParse({ type: 'two-step-rule', forEveryone: true, by: 'someone' }).success,
    ).toBe(false)
  })

  it('records the switch in the change record, from off', () => {
    const s = seed('UK')
    const on = run(s, ask(true))
    if (!on.ok) throw new Error(on.error)
    expect(changeDetail(s, on.state, 'two-step-rule', s.organisation.id)).toEqual({
      fields: [{ f: 'forEveryone', from: false, to: true }],
    })
  })

  it('names the studio when it holds someone', () => {
    expect(twoStepHeldMessage('Fernleaf Rooms')).toBe(
      'Fernleaf Rooms asks everyone to use two-step sign-in. Set it up to open the studio.',
    )
  })

  it('lists names in plain words', () => {
    expect(listNames(['Maya'])).toBe('Maya')
    expect(listNames(['Maya', 'Theo', 'Ines'])).toBe('Maya, Theo and Ines')
    expect(studiosAsking(['Fernleaf Rooms'])).toBe('Fernleaf Rooms asks')
    expect(studiosAsking(['Fernleaf Rooms', 'Willow House'])).toBe(
      'Fernleaf Rooms and Willow House ask',
    )
  })
})
