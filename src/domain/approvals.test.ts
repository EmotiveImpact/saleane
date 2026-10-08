import { describe, expect, it } from 'vitest'
import { dispatch, execute } from './commands'
import type { Command } from './commands'
import type { BusinessState } from './model'
import { can, permissionFor } from './operations'
import { seed } from './seed'
import { requests } from './approvals'

// V5: requests that pass up to the right person for a sign-off.
const now = '2026-10-06T15:00:00.000Z'
let sequence = 0
function apply(s: BusinessState, command: Command) {
  const result = execute(s, command, now, () => `ap-${++sequence}`)
  if (!result.ok) throw new Error(result.error)
  return result.state
}
function business() {
  let s = seed('UK')
  s = apply(s, { type: 'location', input: { name: 'Islington', address: '1 Upper Street' } })
  s = apply(s, { type: 'location', input: { name: 'Leeds', address: '2 Briggate' } })
  const [main, islington, leeds] = [
    s.organisation.locationId,
    s.operations!.locations![0].id,
    s.operations!.locations![1].id,
  ]
  s = apply(s, { type: 'region', input: { name: 'London', locationIds: [main, islington] } })
  const london = s.operations!.regions![0].id
  return { s, main, islington, leeds, london }
}
const raise = (locationId: string, amountMinor?: number, managedRegions?: string[]): Command => ({
  type: 'request-raise',
  input: { locationId, kind: amountMinor ? 'spend' : 'other', title: 'New dryer', amountMinor },
  ...(managedRegions ? { managedRegions } : {}),
})

describe('requests for sign-off', () => {
  it('go to the region’s manager, or pass up to the owner', () => {
    const { s: start, islington, leeds, london } = business()
    let s = apply(start, raise(islington, 120_00, [london]))
    s = apply(s, raise(islington, 900_00, [london]))
    s = apply(s, raise(islington, 120_00))
    s = apply(s, raise(leeds, 50_00, [london]))
    expect(requests(s).map((r) => [r.routedTo.level, r.passedUp ?? null])).toEqual([
      ['regional', null],
      // Over the £500 a regional manager may approve unless the owner says otherwise.
      ['owner', 'over-limit'],
      // London has no regional manager here, so the owner signs off.
      ['owner', 'no-manager'],
      // Leeds is in no region.
      ['owner', 'no-region'],
    ])
    s = apply(s, { type: 'approval-limit', regionalLimitMinor: 1000_00 })
    s = apply(s, raise(islington, 900_00, [london]))
    expect(requests(s).at(-1)!.routedTo).toEqual({ level: 'regional', regionId: london })
  })

  it('are decided once, with who decided and when', () => {
    const { s: start, islington, london } = business()
    let s = apply(start, raise(islington, 120_00, [london]))
    const id = requests(s)[0].id
    const result = dispatch(
      s,
      { type: 'request-decide', requestId: id, outcome: 'approved', note: 'Go ahead.' },
      'Rae Area',
      now,
    )
    if (!result.ok) throw new Error(result.error)
    s = result.state
    expect(requests(s)[0].decision).toEqual({
      outcome: 'approved',
      note: 'Go ahead.',
      at: now,
      by: 'Rae Area',
    })
    const again = execute(s, { type: 'request-decide', requestId: id, outcome: 'declined' }, now)
    expect(again.ok ? '' : again.error).toMatch(/already been decided/)
    const spend = execute(
      s,
      { type: 'request-raise', input: { locationId: islington, kind: 'spend', title: 'Paint' } },
      now,
    )
    expect(spend.ok).toBe(false)
  })

  it('are raised by managers and decided only by the owner or a regional manager', () => {
    const raiseAction = permissionFor({ type: 'request-raise' })
    const decide = permissionFor({ type: 'request-decide' })
    const limit = permissionFor({ type: 'approval-limit' })
    expect([
      can('owner', raiseAction),
      can('manager', raiseAction),
      can('regional', raiseAction),
    ]).toEqual([true, true, true])
    expect(can('reception', raiseAction)).toBe(false)
    expect([can('owner', decide), can('regional', decide)]).toEqual([true, true])
    expect([can('manager', decide), can('reception', decide)]).toEqual([false, false])
    expect([can('owner', limit), can('manager', limit), can('regional', limit)]).toEqual([
      true,
      false,
      false,
    ])
  })
})
