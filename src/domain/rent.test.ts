import { describe, expect, it } from 'vitest'
import { execute } from './commands'
import type { Command } from './commands'
import type { BusinessState } from './model'
import { parseState } from './model'
import { can, permissionFor } from './operations'
import { createWorkspace } from './workspace'
import { seed } from './seed'
import { addMonths, isPeriodStart, rentPeriods, rentReceived, rentStatement } from './rent'
import { payPeriod } from './pay'

// V2: chair and room rental.
const now = '2026-10-06T08:00:00.000Z'
let sequence = 0
function local(): BusinessState {
  const s = createWorkspace({ name: 'Rent test studio', region: 'UK' })
  const sample = seed('UK')
  for (const key of ['clients', 'services', 'staff', 'resources'] as const)
    Object.assign(s, {
      [key]: sample[key].map((row) => ({ ...row, organisationId: s.organisation.id })),
    })
  return s
}
function run(s: BusinessState, command: Command, at = now) {
  return execute(s, command, at, () => `rent-${++sequence}`)
}
function apply(s: BusinessState, command: Command, at = now) {
  const result = run(s, command, at)
  if (!result.ok) throw new Error(result.error)
  return result.state
}
const weekly = (from = '2026-09-14') =>
  ({
    type: 'rental',
    input: {
      staffId: 'staff-theo',
      space: 'chair',
      resourceId: 'chair-one',
      amountMinor: 18000,
      every: 'week',
      from,
    },
  }) as Command
const pay = (rentalId: string, periodStart: string, amountMinor = 18000, method = 'cash') =>
  ({ type: 'rent-payment', rentalId, periodStart, amountMinor, method }) as Command

describe('chair and room rent', () => {
  it('works out weekly rent due and what is still owed', () => {
    let s = apply(local(), weekly())
    const rental = s.operations!.rentals![0]
    expect(rentPeriods(rental, '2026-10-06').map((p) => p.start)).toEqual([
      '2026-09-14',
      '2026-09-21',
      '2026-09-28',
      '2026-10-05',
    ])
    s = apply(s, pay(rental.id, '2026-09-14'))
    s = apply(s, pay(rental.id, '2026-09-21', 10000))
    const statement = rentStatement(s, s.operations!.rentals![0], '2026-10-06')
    expect(statement.map((p) => p.owedMinor)).toEqual([0, 8000, 18000, 18000])
    expect(rentReceived(s, '2026-10-01', '2026-10-31')).toBe(28000)
  })

  it('counts rent on the studio’s own day, not the day in London or UTC', () => {
    const studio = createWorkspace({ name: 'Rent test studio', region: 'US' })
    const sample = seed('US')
    for (const key of ['clients', 'services', 'staff', 'resources'] as const)
      Object.assign(studio, {
        [key]: sample[key].map((row) => ({ ...row, organisationId: studio.organisation.id })),
      })
    expect(studio.organisation.timeZone).toBe('America/New_York')
    let s = apply(studio, weekly('2026-10-26'), '2026-10-26T14:00:00.000Z')
    const rental = s.operations!.rentals![0]
    // 21:00 in New York on 31 October is already 1 November in UTC.
    s = apply(s, pay(rental.id, '2026-10-26'), '2026-11-01T01:00:00.000Z')
    expect(s.operations!.rentPayments![0].paidAt).toBe('2026-11-01T01:00:00.000Z')
    expect(rentReceived(s, '2026-10-01', '2026-10-31')).toBe(18000)
    expect(rentReceived(s, '2026-11-01', '2026-11-30')).toBe(0)
  })

  it('refuses more than is due, a period that is not one, and rent not yet due', () => {
    const s = apply(local(), weekly())
    const id = s.operations!.rentals![0].id
    expect(run(s, pay(id, '2026-09-14', 18001)).ok).toBe(false)
    expect(run(s, pay(id, '2026-09-15')).ok).toBe(false)
    expect(run(s, pay(id, '2026-10-12')).ok).toBe(false)
    // A transfer needs its reference.
    expect(run(s, pay(id, '2026-09-14', 18000, 'bank_transfer')).ok).toBe(false)
    const paid = apply(s, pay(id, '2026-09-14', 9000))
    expect(run(paid, pay(id, '2026-09-14', 9001)).ok).toBe(false)
    expect(run(paid, pay(id, '2026-09-14', 9000)).ok).toBe(true)
  })

  it('keeps monthly rent on the same day, within shorter months', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonths('2026-01-31', 2, 31)).toBe('2026-03-31')
    expect(addMonths('2026-11-15', 2)).toBe('2027-01-15')
    const s = apply(local(), {
      type: 'rental',
      input: {
        staffId: 'staff-maya',
        space: 'room',
        amountMinor: 60000,
        every: 'month',
        from: '2026-01-31',
      },
    } as Command)
    const rental = s.operations!.rentals![0]
    expect(rentPeriods(rental, '2026-04-30').map((p) => p.start)).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
    ])
    expect(isPeriodStart(rental, '2026-02-28')).toBe(true)
    expect(isPeriodStart(rental, '2026-03-28')).toBe(false)
  })

  it('allows one rental at a time, and ending keeps it on record', () => {
    let s = apply(local(), weekly())
    expect(run(s, weekly('2026-11-02')).ok).toBe(false)
    const id = s.operations!.rentals![0].id
    s = apply(s, pay(id, '2026-09-28'))
    expect(run(s, { type: 'end-rental', rentalId: id, to: '2026-09-20' }).ok).toBe(false)
    s = apply(s, { type: 'end-rental', rentalId: id, to: '2026-10-04' })
    expect(rentPeriods(s.operations!.rentals![0], '2026-12-31')).toHaveLength(3)
    expect(run(s, weekly('2026-10-12')).ok).toBe(true)
    // A chair rental must name a chair.
    expect(
      run(local(), {
        type: 'rental',
        input: { ...(weekly() as { input: object }).input, resourceId: 'room-one' },
      } as Command).ok,
    ).toBe(false)
  })

  it('pays no commission on a renter’s days', () => {
    const s = seed('UK')
    const theo = (from: string, to: string) =>
      payPeriod(s, from, to).find((row) => row.staff.id === 'staff-theo')!
    // Theo rents the chair from 21 September; his visits from then earn no commission.
    expect(theo('2026-09-21', '2026-09-30').commissionMinor).toBe(0)
    expect(theo('2026-09-01', '2026-09-20').commissionMinor).toBeGreaterThan(0)
  })

  it('lets owners and managers manage rent, not reception', () => {
    for (const type of ['rental', 'end-rental', 'rent-payment']) {
      expect(can('manager', permissionFor({ type }))).toBe(true)
      expect(can('reception', permissionFor({ type }))).toBe(false)
      expect(can('practitioner', permissionFor({ type }))).toBe(false)
    }
  })

  it('rejects rent recorded beyond what was due in the ledger', () => {
    for (const region of ['UK', 'US'] as const) expect(() => seed(region)).not.toThrow()
    const s = seed('UK')
    const tampered = structuredClone(s)
    tampered.operations!.rentPayments![0].amountMinor += 1
    expect(() => parseState(tampered, 'UK')).toThrow('More rent')
    const shifted = structuredClone(s)
    shifted.operations!.rentPayments![0].periodStart = '2026-09-08'
    expect(() => parseState(shifted, 'UK')).toThrow('rental periods')
  })
})
