import { describe, expect, it } from 'vitest'
import { execute } from './commands'
import type { Command } from './commands'
import type { BusinessState } from './model'
import { can } from './operations'
import { seed } from './seed'
import { branchChangeRefusal, branchRefusal, branchView } from './branch'

// V5: a general manager changes only what belongs to their location.
const now = '2026-10-06T15:00:00.000Z'
let sequence = 0
function apply(s: BusinessState, command: Command) {
  const result = execute(s, command, now, () => `gm-${++sequence}`)
  if (!result.ok) throw new Error(result.error)
  return result.state
}
function twoSites() {
  const s = apply(seed('UK'), {
    type: 'location',
    input: { name: 'Islington', address: '1 Upper Street' },
  })
  return { s, main: s.organisation.locationId, islington: s.operations!.locations![0].id }
}

describe('general manager', () => {
  it('may use manager actions for their location, never whole-business ones', () => {
    for (const action of ['book', 'checkout', 'stock', 'request-raise', 'note'])
      expect(can('general', action)).toBe(true)
    for (const action of [
      'catalogue',
      'hours',
      'organisation',
      'location',
      'reminders',
      'pay-rate',
      'request-decide',
      'checklist-save',
      'membership',
    ])
      expect(can('general', action)).toBe(false)
  })

  it('is refused visits, stock and requests at another location', () => {
    const { s, main, islington } = twoSites()
    const atMain = s.appointments.find((a) => a.locationId === main)!
    const cancel = { type: 'cancel', appointmentId: atMain.id, reason: 'x' } as Command
    expect(branchRefusal(s, islington, cancel)).toBe('That visit is at another location.')
    expect(branchRefusal(s, main, cancel)).toBeNull()
    const stock = (locationId?: string) =>
      ({
        type: 'stock',
        productId: 'p',
        quantity: 1,
        reason: 'adjustment',
        note: 'Counted',
        ...(locationId ? { locationId } : {}),
      }) as Command
    // No location means the main one.
    expect(branchRefusal(s, islington, stock())).not.toBeNull()
    expect(branchRefusal(s, islington, stock(islington))).toBeNull()
    expect(
      branchRefusal(s, islington, {
        type: 'note',
        clientId: s.clients[0].id,
        text: 'Hello',
      }),
    ).toBeNull()
    expect(
      branchRefusal(s, islington, {
        type: 'batch',
        label: 'Cover',
        commands: [cancel],
      } as Command),
    ).toBe('That visit is at another location.')
    // A waitlist place for another location is not theirs to remove; one for any location is.
    const waitlist = [
      { ...(s.waitlist?.[0] ?? {}), id: 'w-main', locationId: main },
      { ...(s.waitlist?.[0] ?? {}), id: 'w-any', locationId: undefined },
    ] as unknown as BusinessState['waitlist']
    const listed = { ...s, waitlist }
    expect(
      branchRefusal(listed, islington, { type: 'waitlist-remove', entryId: 'w-main', reason: 'x' }),
    ).toBe('That waitlist place is for another location.')
    expect(
      branchRefusal(listed, islington, { type: 'waitlist-remove', entryId: 'w-any', reason: 'x' }),
    ).toBeNull()
    expect(branchRefusal(s, islington, { type: 'approval-limit', regionalLimitMinor: 1 })).toBe(
      'That changes the whole business. Ask the owner or a manager.',
    )
  })

  it('clocks out only a shift clocked in at their location', () => {
    const { s, main, islington } = twoSites()
    const clocked = apply(s, { type: 'clock-in', staffId: 'staff-maya' })
    // Maya clocked in at the main location; the rota now has her at Islington.
    const moved = structuredClone(clocked)
    moved.staff.find((p) => p.id === 'staff-maya')!.hours = Array.from({ length: 7 }, (_, day) => ({
      day,
      open: 540,
      close: 1080,
      closed: false,
      locationId: islington,
    }))
    const out: Command = { type: 'clock-out', staffId: 'staff-maya', breakMinutes: 0 }
    expect(branchRefusal(moved, islington, out)).toBe('That person clocked in at another location.')
    expect(branchRefusal(moved, main, out)).toBeNull()
    // Whatever is asked, a change to hours at another location is caught once it is made.
    const after = apply(moved, out)
    expect(branchChangeRefusal(moved, after, islington)).toBe(
      'That would change hours worked at another location.',
    )
    expect(branchChangeRefusal(moved, after, main)).toBeNull()
  })

  it('books repeat visits only at their own location', () => {
    const { s, main, islington } = twoSites()
    const repeat = (locationId: string): Command => ({
      type: 'book-repeat',
      booking: {
        clientId: 'client-1',
        serviceId: 'service-facial',
        staffId: 'staff-maya',
        date: '2026-10-07',
        startMinutes: 540,
        source: 'desk',
        locationId,
      },
      everyWeeks: 4,
      visits: [{ date: '2026-11-04', startMinutes: 540 }],
    })
    expect(branchRefusal(s, islington, repeat(main))).toBe('That visit is at another location.')
    expect(branchRefusal(s, main, repeat(main))).toBeNull()
    // A later visit that falls at another location is caught once the visits are booked.
    const booked = apply(s, repeat(main))
    const later = booked.appointments.find((a) => a.date === '2026-11-04' && a.repeat)!
    const elsewhere: BusinessState = {
      ...booked,
      appointments: booked.appointments.map((a) =>
        a.id === later.id ? { ...a, locationId: islington } : a,
      ),
    }
    expect(branchChangeRefusal(s, elsewhere, main)).not.toBeNull()
  })

  it('books several people together only at their own location', () => {
    const { s, main, islington } = twoSites()
    const together = (locationId: string): Command => ({
      type: 'book-together',
      booking: {
        clientId: 'client-6',
        serviceId: 'service-facial',
        staffId: 'staff-maya',
        date: '2026-10-07',
        startMinutes: 540,
        source: 'desk',
        locationId,
      },
      guests: [
        {
          clientId: 'client-2',
          serviceId: 'service-facial',
          staffId: 'staff-sophia',
          startMinutes: 540,
        },
      ],
    })
    expect(branchRefusal(s, islington, together(main))).toBe('That visit is at another location.')
    expect(branchRefusal(s, main, together(main))).toBeNull()
  })

  it('catches a change that lands a visit at another location', () => {
    const { s, main, islington } = twoSites()
    const visit = s.appointments.find((a) => a.locationId === main)!
    const moved: BusinessState = {
      ...s,
      appointments: s.appointments.map((a) =>
        a.id === visit.id ? { ...a, locationId: islington } : a,
      ),
    }
    // Moving a main-location visit in, or one of theirs out, is refused either way.
    expect(branchChangeRefusal(s, moved, islington)).not.toBeNull()
    expect(branchChangeRefusal(moved, s, islington)).not.toBeNull()
    expect(branchChangeRefusal(s, s, islington)).toBeNull()
  })

  it('reads no pay rates and only their own branch visits', () => {
    const { s, islington } = twoSites()
    const view = branchView(s, islington)
    expect(view.operations!.payRates).toBeUndefined()
    expect(view.operations!.branchVisits ?? []).toEqual([])
    expect(s.operations!.branchVisits!.length).toBeGreaterThan(0)
  })
})
