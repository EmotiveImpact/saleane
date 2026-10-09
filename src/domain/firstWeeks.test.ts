import { describe, expect, it } from 'vitest'
import type { BusinessState } from './model'
import { createWorkspace } from './workspace'
import { firstWeeksSteps, inFirstWeeks } from './firstWeeks'

// "Your first weeks": each step ticks itself from the record, and the list has a time limit.
const fresh = () => createWorkspace({ name: 'Fernleaf Rooms', region: 'UK' })
const done = (s: BusinessState, facts?: Parameters<typeof firstWeeksSteps>[1]) =>
  firstWeeksSteps(s, facts)
    .filter((step) => step.done)
    .map((step) => step.id)
/** Only the parts of a visit, a sale or a person these checks read. */
const visit = (source: string, createdAt: string) => ({ source, createdAt }) as never
const person = (id: string) => ({ id, archived: false }) as never

describe('your first weeks', () => {
  it('starts with nothing done except inviting a team when there is no one to invite', () => {
    expect(done(fresh())).toEqual(['team'])
    const two = { ...fresh(), staff: [person('a'), person('b')] }
    expect(done(two)).toEqual([])
  })

  it('ticks each step from the studio record, the sign-in and the team list', () => {
    const base = fresh()
    const s: BusinessState = {
      ...base,
      staff: [person('a'), person('b')],
      appointments: [visit('online', '2026-10-06T08:00:00.000Z')],
      sales: [{ id: 'sale-1' } as never],
      operations: {
        ...base.operations!,
        imports: [
          {
            id: 'batch-1',
            kind: 'clients',
            source: 'Fresha',
            createdAt: '2026-10-06T08:00:00.000Z',
            actor: 'Local operator',
            recordIds: [],
            totalMinor: 0,
          },
        ],
        reminders: {
          confirmations: true,
          reminders: true,
          hoursBefore: 24,
          email: true,
          sms: false,
        },
      },
    }
    expect(done(s, { twoStep: true, invited: true })).toEqual([
      'link',
      'clients',
      'team',
      'checkout',
      'reminders',
      'twoStep',
    ])
    // A booking taken at the desk is not a sign the link is out there.
    expect(done({ ...s, appointments: [visit('desk', '2026-10-06T08:00:00.000Z')] })).not.toContain(
      'link',
    )
  })

  it('takes starting fresh, working alone and the usual reminders as answers', () => {
    const s = { ...fresh(), staff: [person('a'), person('b')] }
    expect(done(s, { confirmed: new Set(['clients', 'team', 'reminders'] as const) })).toEqual([
      'clients',
      'team',
      'reminders',
    ])
  })

  it('shows until eight weeks after the first visit booked here', () => {
    const s = fresh()
    expect(inFirstWeeks(s, '2027-06-01T08:00:00.000Z')).toBe(true)
    const booked = { ...s, appointments: [visit('online', '2026-10-06T08:00:00.000Z')] }
    expect(inFirstWeeks(booked, '2026-11-30T08:00:00.000Z')).toBe(true)
    expect(inFirstWeeks(booked, '2026-12-01T08:00:00.000Z')).toBe(false)
    // Visits brought across from another system do not start the clock.
    const imported = { ...s, appointments: [visit('import', '2026-01-06T08:00:00.000Z')] }
    expect(inFirstWeeks(imported, '2026-12-01T08:00:00.000Z')).toBe(true)
  })
})
