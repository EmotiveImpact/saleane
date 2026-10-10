import { describe, expect, it } from 'vitest'
import { execute } from './commands'
import type { Command } from './commands'
import type { BusinessState } from './model'
import { operations } from './operations'
import { bookable, readySteps } from './readiness'
import { createWorkspace } from './workspace'
import { setupFinished } from './setup'
import type { SetupPlace } from './setupSchema'
import {
  depositsAsShare,
  hoursDraft,
  hoursScreen,
  lookDraft,
  lookScreen,
  moneyDraft,
  moneyScreen,
  nextRoomName,
  openScreen,
  roomsDraft,
  roomsScreen,
  studioDraft,
  studioScreen,
  teamDraft,
  teamScreen,
  treatmentRow,
  treatmentsDraft,
  treatmentsScreen,
  usualRole,
} from './setupScreens'
import type { SetupChange } from './setupScreens'

// Each screen of "Set up your studio": what it still needs, and the changes it saves.
const now = '2026-10-06T08:00:00.000Z'
let sequence = 0
function save(s: BusinessState, next: SetupPlace, changes: SetupChange[]) {
  const result = execute(
    s,
    { type: 'setup-step', next, changes } as Command,
    now,
    () => `screen-${++sequence}`,
  )
  if (!result.ok) throw new Error(result.error)
  return result.state
}
const fresh = () => createWorkspace({ name: 'Linden Studio', region: 'UK', locationName: 'Bath' })

describe('set up your studio, screen by screen', () => {
  it('takes a new owner from an empty studio to taking bookings', () => {
    let s = fresh()
    expect(bookable(s)).toBe(false)

    // Where guests find you: the address is the one thing it insists on.
    const studio = studioDraft(s)
    expect(studioScreen(s, studio).problem).toBe('Add your address so guests can find you.')
    const where = studioScreen(s, { ...studio, address: '12 Milsom Street, Bath', phone: '' })
    expect(where.problem).toBeNull()
    s = save(s, 'hours', where.changes)
    expect(s.organisation.address).toBe('12 Milsom Street, Bath')

    // Hours: unchanged hours save nothing but still move the owner on.
    const hours = hoursScreen(s, hoursDraft(s))
    expect(hours).toEqual({ problem: null, changes: [] })
    s = save(s, 'treatments', hours.changes)

    // Treatments: a starter has no price until the owner types one.
    const facial = treatmentRow('a', 'Skin', 'Signature facial', 60)
    const cut = treatmentRow('b', 'Hair', 'Cut and finish', 60)
    expect(facial.place).toBe('treatment')
    expect(cut.place).toBe('chair')
    const unpriced = treatmentsScreen(s, { rows: [facial, cut], removed: [] })
    expect(unpriced).toEqual({ problem: 'Add a price for Signature facial.', changes: [] })
    const menu = treatmentsScreen(s, {
      rows: [
        { ...facial, price: '85' },
        { ...cut, price: '60.50' },
      ],
      removed: [],
    })
    expect(menu.problem).toBeNull()
    s = save(s, 'team', menu.changes)
    expect(s.services.map((x) => [x.name, x.priceMinor, x.resourceType])).toEqual([
      ['Signature facial', 8500, 'treatment'],
      ['Cut and finish', 6050, 'chair'],
    ])
    expect(usualRole(s)).toBe('Therapist')

    // Team: someone has to give a treatment.
    const ids = s.services.map((x) => x.id)
    const amara = { key: 'p1', name: 'Amara Okafor', role: 'Owner', serviceIds: [] as string[] }
    expect(teamScreen(s, { rows: [amara], removed: [] }).problem).toBe(
      'Tick the treatments Amara Okafor gives.',
    )
    const team = teamScreen(s, { rows: [{ ...amara, serviceIds: ids }], removed: [] })
    s = save(s, 'rooms', team.changes)
    expect(s.staff.map((p) => [p.name, p.serviceIds])).toEqual([['Amara Okafor', ids]])

    // Rooms: one of each kind the menu needs is suggested.
    const rooms = roomsDraft(s)
    expect(rooms.rows.map((r) => [r.name, r.type])).toEqual([
      ['Treatment room 1', 'treatment'],
      ['Styling chair 1', 'chair'],
    ])
    expect(roomsScreen(s, { ...rooms, rows: rooms.rows.slice(0, 1) }).problem).toBe(
      'Some treatments take place at a styling chair. Add one.',
    )
    s = save(s, 'look', roomsScreen(s, rooms).changes)
    expect(s.resources).toHaveLength(2)
    expect(bookable(s)).toBe(true)

    // Look: keeping the house colours still records the choice.
    const look = lookScreen(s, lookDraft(s))
    expect(look.changes).toEqual([{ type: 'studio-look', look: lookDraft(s) }])
    s = save(s, 'deposits', look.changes)
    expect(lookScreen(s, lookDraft(s)).changes).toEqual([])

    // Deposits, fees and tax: VAT is never assumed.
    const money = moneyDraft(s)
    expect(money.taxed).toBeNull()
    expect(moneyScreen(s, money).problem).toBe('Choose whether you charge VAT.')
    const deposits = depositsAsShare(s, 20)
    expect(Object.values(deposits)).toEqual(['17.00', '12.00'])
    const charged = moneyScreen(s, { ...money, deposits, feePercent: 50, taxed: false })
    expect(charged.problem).toBeNull()
    s = save(s, 'open', charged.changes)
    expect(s.services.map((x) => x.depositMinor)).toEqual([1700, 1200])
    expect(operations(s).protection).toEqual({ saveCard: false, feePercent: 50 })
    expect(operations(s).tax).toMatchObject({ label: 'VAT', rateBps: 0 })

    // Open: switching on online booking finishes setup.
    s = save(s, 'done', openScreen(s, true).changes)
    expect(operations(s).bookingEnabled).toBe(true)
    expect(setupFinished(s)).toBe(true)
    expect(
      readySteps(s)
        .filter((step) => !step.done)
        .map((step) => step.id),
    ).toEqual(['contact'])
  })

  it('names what each screen still needs', () => {
    const s = fresh()
    const studio = { ...studioDraft(s), address: '1 High Street' }
    expect(studioScreen(s, { ...studio, name: ' ' }).problem).toBe('Add your business name.')
    expect(studioScreen(s, { ...studio, phone: '12' }).problem).toMatch(/phone/i)
    expect(studioScreen(s, { ...studio, email: 'hello' }).problem).toMatch(/email address/)

    const closed = hoursDraft(s).map((h) => ({ ...h, closed: true }))
    expect(hoursScreen(s, closed).problem).toBe('Open on one day at least.')
    const late = hoursDraft(s).map((h) => (h.day === 3 ? { ...h, close: h.open } : h))
    expect(hoursScreen(s, late).problem).toBe('On Wednesday, closing must come after opening.')

    expect(treatmentsScreen(s, treatmentsDraft(s)).problem).toBe('Add one treatment at least.')
    expect(teamScreen(s, teamDraft(s)).problem).toBe(
      'Add one person at least. If you work on your own, add yourself.',
    )
    expect(
      teamScreen(s, { rows: [{ key: 'x', name: 'Sam', role: '', serviceIds: [] }], removed: [] })
        .problem,
    ).toBe('Say what Sam does, such as Stylist or Therapist.')
    expect(roomsScreen(s, { rows: [], removed: [] }).problem).toBe('Add a room or a chair.')
  })

  it('changes and removes what was saved before, when the owner comes back', () => {
    let s = fresh()
    s = save(
      s,
      'team',
      treatmentsScreen(s, {
        rows: [
          { ...treatmentRow('a', 'Skin', 'Facial', 60), price: '80' },
          { ...treatmentRow('b', 'Skin', 'Brow tint', 30), price: '20' },
        ],
        removed: [],
      }).changes,
    )
    const draft = treatmentsDraft(s)
    const [facial, brow] = draft.rows
    const again = treatmentsScreen(s, {
      rows: [{ ...facial, price: '90' }],
      removed: [brow.id!],
    })
    s = save(s, 'team', again.changes)
    expect(s.services.map((x) => [x.name, x.priceMinor, !!x.archived])).toEqual([
      ['Facial', 9000, false],
      ['Brow tint', 2000, true],
    ])
    // Nothing changed means nothing to save.
    expect(treatmentsScreen(s, treatmentsDraft(s)).changes).toEqual([])
  })

  it('refuses a deposit above the price and an unreadable tax rate', () => {
    let s = fresh()
    s = save(
      s,
      'team',
      treatmentsScreen(s, {
        rows: [{ ...treatmentRow('a', 'Skin', 'Facial', 60), price: '80' }],
        removed: [],
      }).changes,
    )
    const id = s.services[0].id
    const money = { ...moneyDraft(s), taxed: true }
    expect(moneyScreen(s, { ...money, deposits: { [id]: '90' } }).problem).toBe(
      'The deposit for Facial is more than its price.',
    )
    expect(moneyScreen(s, { ...money, deposits: { [id]: 'ten' } }).problem).toMatch(/as an amount/)
    expect(moneyScreen(s, { ...money, rate: '' }).problem).toBe('Enter your VAT rate, such as 20.')
    const vat = moneyScreen(s, money)
    expect(vat.changes).toContainEqual({
      type: 'tax',
      label: 'VAT',
      rateBps: 2000,
      inclusive: true,
    })
  })

  it('numbers new rooms after the ones already there', () => {
    const rows = [
      { name: 'Treatment room 1', type: 'treatment' as const },
      { name: 'Treatment room 2', type: 'treatment' as const },
    ]
    expect(nextRoomName(rows, 'treatment')).toBe('Treatment room 3')
    expect(nextRoomName(rows, 'chair')).toBe('Styling chair 1')
    expect(nextRoomName([], 'chair', 'Islington')).toBe('Islington chair 1')
  })
})
