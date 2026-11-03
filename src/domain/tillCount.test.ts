import { describe, expect, it } from 'vitest'
import { dispatch, execute } from './commands'
import type { Command } from './commands'
import { parseState } from './model'
import type { BusinessState } from './model'
import { can, permissionFor } from './operations'
import { practitionerRefusal } from './practitioner'
import { createWorkspace } from './workspace'
import { seed } from './seed'
import { cashForDay, expectedCash, tillCountsFor, tillDifference, venueDate } from './tillCount'

const now = '2026-10-06T08:00:00.000Z'
let sequence = 0
function apply(s: BusinessState, command: Command, clock = now) {
  const result = execute(s, command, clock, () => `till-${++sequence}`)
  if (!result.ok) throw new Error(result.error)
  return result
}
function local() {
  const s = createWorkspace({ name: 'Local till studio', region: 'UK' })
  const sample = seed('UK')
  for (const key of ['clients', 'services', 'staff', 'resources'] as const)
    Object.assign(s, {
      [key]: sample[key].map((row) => ({ ...row, organisationId: s.organisation.id })),
    })
  return s
}
/** A local studio with one visit checked out with the given method at `now`. */
function checkedOut(method: 'cash' | 'external_card' = 'cash', s = local(), startMinutes = 600) {
  const booked = apply(s, {
    type: 'book',
    input: {
      serviceId: 'service-facial',
      staffId: 'staff-maya',
      date: '2026-10-06',
      startMinutes,
      clientId: 'client-1',
      source: 'desk',
    },
  })
  const arrived = apply(booked.state, { type: 'arrive', appointmentId: booked.recordId })
  return apply(arrived.state, {
    type: 'checkout',
    appointmentId: booked.recordId,
    tipMinor: 500,
    method,
    ...(method === 'external_card' ? { reference: `T-${startMinutes}` } : {}),
  })
}
const count = (patch: Partial<Extract<Command, { type: 'till-count' }>> = {}): Command => ({
  type: 'till-count',
  date: '2026-10-06',
  openingFloatMinor: 10000,
  countedMinor: 18000,
  bankingMinor: 8000,
  ...patch,
})

describe('end-of-day till count', () => {
  it('expects the float plus cash recorded that day, less cash refunds, and ignores card', () => {
    const cash = checkedOut('cash')
    const sale = cash.state.sales[0]
    const both = checkedOut('external_card', cash.state, 720)
    const refunded = apply(both.state, {
      type: 'refund',
      saleId: sale.id,
      amountMinor: 250,
      reason: 'Goodwill adjustment',
      reference: 'Cash returned at desk',
    })
    // Refunds against the card receipt are not cash.
    const cardSale = refunded.state.sales.find((s) => s.method === 'external_card')!
    const both2 = apply(refunded.state, {
      type: 'refund',
      saleId: cardSale.id,
      amountMinor: 1000,
      reason: 'Card refund at terminal',
      reference: 'Terminal refund 1',
    })
    expect(cashForDay(both2.state, '2026-10-06')).toEqual({
      cashIn: sale.balanceMinor,
      cashRefunded: 250,
    })
    expect(expectedCash(both2.state, '2026-10-06', 10000).expected).toBe(
      10000 + sale.balanceMinor - 250,
    )
    expect(cashForDay(both2.state, '2026-10-05')).toEqual({ cashIn: 0, cashRefunded: 0 })
  })

  it('follows how each refund was returned, whatever the receipt was paid with', () => {
    const cash = checkedOut('cash')
    const card = checkedOut('external_card', cash.state, 720)
    const cashSale = card.state.sales.find((s) => s.method === 'cash')!
    const cardSale = card.state.sales.find((s) => s.method === 'external_card')!
    // Money back on a card receipt, handed over from the till.
    let s = apply(card.state, {
      type: 'refund',
      saleId: cardSale.id,
      amountMinor: 700,
      reason: 'Returned in cash',
      reference: 'Cash at desk 1',
      method: 'cash',
    }).state
    // Money back on a cash receipt, sent by bank transfer.
    s = apply(s, {
      type: 'refund',
      saleId: cashSale.id,
      amountMinor: 300,
      reason: 'Sent by bank transfer',
      reference: 'Bank transfer 1',
      method: 'external_card',
    }).state
    expect(cashForDay(s, '2026-10-06').cashRefunded).toBe(700)
    expect(s.operations?.refunds.map((r) => r.method)).toEqual(['cash', 'external_card'])
  })

  it('refuses a simulated refund method in a local studio', () => {
    const cash = checkedOut('cash')
    const result = execute(
      cash.state,
      {
        type: 'refund',
        saleId: cash.state.sales[0].id,
        amountMinor: 100,
        reason: 'Wrong method',
        reference: 'Wrong 1',
        method: 'demo_cash',
      },
      now,
    )
    expect(result.ok).toBe(false)
  })

  it('uses the studio time zone for the day boundary', () => {
    const s = checkedOut('cash').state
    // 23:30 UTC on 5 October is 00:30 on 6 October in London (BST).
    s.payments[0].recordedAt = '2026-10-05T23:30:00.000Z'
    expect(venueDate('Europe/London', s.payments[0].recordedAt)).toBe('2026-10-06')
    expect(cashForDay(s, '2026-10-06').cashIn).toBe(s.payments[0].amountMinor)
    const ny = { ...s, organisation: { ...s.organisation, timeZone: 'America/New_York' } }
    expect(cashForDay(ny, '2026-10-05').cashIn).toBe(s.payments[0].amountMinor)
    expect(cashForDay(ny, '2026-10-06').cashIn).toBe(0)
  })

  it('records a count with its snapshot, and a recount supersedes it while history is kept', () => {
    const s = checkedOut('cash').state
    const balance = s.sales[0].balanceMinor
    const first = dispatch(s, count({ note: '  Till drawer A  ' }), 'Amira Front', now)
    if (!first.ok) throw new Error(first.error)
    expect(first.state.tillCounts).toEqual([
      expect.objectContaining({
        id: first.recordId,
        organisationId: s.organisation.id,
        date: '2026-10-06',
        cashInMinor: balance,
        cashRefundedMinor: 0,
        expectedMinor: 10000 + balance,
        note: 'Till drawer A',
        actor: 'Amira Front',
        recordedAt: now,
      }),
    ])
    const later = '2026-10-06T17:40:00.000Z'
    const second = dispatch(first.state, count({ countedMinor: 18500 }), 'Sam Manager', later)
    if (!second.ok) throw new Error(second.error)
    const day = tillCountsFor(second.state, '2026-10-06')
    expect(day.map((c) => c.id)).toEqual([second.recordId, first.recordId])
    expect(day[0]).toMatchObject({ countedMinor: 18500, actor: 'Sam Manager' })
    expect(second.state.tillCounts).toHaveLength(2)
    expect(second.state.events).toEqual(first.state.events)
    expect(second.state.payments).toEqual(s.payments)
  })

  it('counts simulated cash in the sample studio', () => {
    const s = seed('UK')
    const demoCash = s.payments.find((p) => p.method === 'demo_card')!
    demoCash.method = 'demo_cash'
    demoCash.recordedAt = '2026-10-06T10:00:00.000Z'
    const result = apply(s, count({ countedMinor: 0, bankingMinor: 0 }))
    expect(result.state.tillCounts![0].cashInMinor).toBe(demoCash.amountMinor)
    // The demo clock stands still: simulated cash recorded in a later session is the demo day's.
    demoCash.recordedAt = '2027-01-15T10:00:00.000Z'
    expect(cashForDay(s, '2026-10-06').cashIn).toBe(demoCash.amountMinor)
  })

  it('refuses impossible counts and a future day', () => {
    const s = local()
    expect(execute(s, count({ bankingMinor: 18001 }), now).ok).toBe(false)
    expect(execute(s, count({ date: '2026-10-07' }), now).ok).toBe(false)
    expect(execute(s, count({ countedMinor: -1 }), now).ok).toBe(false)
    expect(execute(s, count({ openingFloatMinor: 10.5 }), now).ok).toBe(false)
    expect(execute(s, count({ date: '6 October' }), now).ok).toBe(false)
    expect(execute(s, count({ date: '2026-10-01' }), now).ok).toBe(true)
  })

  it('loads older records without till counts and rejects corrupt or foreign counts', () => {
    const old = local()
    delete old.tillCounts
    expect(parseState(old, 'UK').tillCounts).toBeUndefined()
    const s = apply(checkedOut('cash').state, count()).state
    const corrupt = (change: (c: Record<string, unknown>) => void) => {
      const copy = structuredClone(s)
      change(copy.tillCounts![0] as unknown as Record<string, unknown>)
      return () => parseState(copy, 'UK')
    }
    expect(corrupt(() => {})).not.toThrow()
    expect(corrupt((c) => (c.organisationId = 'another-studio'))).toThrow('another studio')
    expect(corrupt((c) => (c.countedMinor = -100))).toThrow()
    expect(corrupt((c) => (c.bankingMinor = 1.5))).toThrow()
    expect(corrupt((c) => (c.date = '2026-13-01'))).toThrow()
    expect(corrupt((c) => (c.expectedMinor = 1))).toThrow('till count')
    expect(corrupt((c) => (c.bankingMinor = 999999))).toThrow('till count')
    const duplicate = structuredClone(s)
    duplicate.tillCounts!.push(duplicate.tillCounts![0])
    expect(() => parseState(duplicate, 'UK')).toThrow('Duplicate')
  })

  it('says plainly whether the till is short or over', () => {
    const uk = { locale: 'en-GB', currency: 'GBP' } as const
    expect(tillDifference(12250, 12500, uk)).toBe('£2.50 short')
    expect(tillDifference(12600, 12500, uk)).toBe('£1.00 over')
    expect(tillDifference(12500, 12500, uk)).toBe('Matches the expected cash')
    expect(tillDifference(500, 750, { locale: 'en-US', currency: 'USD' })).toBe('$2.50 short')
  })

  it('belongs to the desk, managers and owners, never practitioners', () => {
    const permission = permissionFor({ type: 'till-count' })
    expect(can('owner', permission)).toBe(true)
    expect(can('manager', permission)).toBe(true)
    expect(can('reception', permission)).toBe(true)
    expect(can('practitioner', permission)).toBe(false)
    expect(practitionerRefusal(seed('UK'), 'staff-maya', count(), '2026-10-06')).toMatch('cannot')
  })
})
