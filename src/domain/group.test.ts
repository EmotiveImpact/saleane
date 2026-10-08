import { describe, expect, it } from 'vitest'
import { execute } from './commands'
import type { Command } from './commands'
import type { BusinessState } from './model'
import { can, permissionFor } from './operations'
import { seed } from './seed'
import { createWorkspace } from './workspace'
import { wholeBusiness } from './group'

// V5: regions, monthly targets and the whole-business view.
const now = '2026-10-20T08:00:00.000Z'
const today = '2026-10-20'
let sequence = 0
function apply(s: BusinessState, command: Command) {
  const result = execute(s, command, now, () => `grp-${++sequence}`)
  if (!result.ok) throw new Error(result.error)
  return result.state
}
const refuse = (s: BusinessState, command: Command) => {
  const result = execute(s, command, now, () => `grp-${++sequence}`)
  if (result.ok) throw new Error('Expected a refusal')
  return result.error
}
const branch = (name: string): Command => ({
  type: 'location',
  input: { name, address: `1 ${name} Street` },
})

/** A business with three locations and only the visits written here. */
function business() {
  const sample = seed('UK')
  let s = createWorkspace({ name: 'Group studio', region: 'UK' })
  for (const key of ['clients', 'services', 'staff', 'resources'] as const)
    Object.assign(s, {
      [key]: sample[key].map((row) => ({ ...row, organisationId: s.organisation.id })),
    })
  const template = {
    ...sample.appointments.find((a) => a.status === 'completed')!,
    organisationId: s.organisation.id,
  }
  const sale = {
    ...sample.sales.find((x) => x.appointmentId === template.id)!,
    organisationId: s.organisation.id,
  }
  s = apply(s, branch('Islington'))
  s = apply(s, branch('Leeds'))
  const [main, islington, leeds] = [
    s.organisation.locationId,
    s.operations!.locations![0].id,
    s.operations!.locations![1].id,
  ]
  let n = 0
  const visit = (
    locationId: string,
    date: string,
    takenMinor: number,
    status: 'completed' | 'confirmed' = 'completed',
  ) => {
    const id = `visit-${++n}`
    s.appointments.push({ ...template, id, locationId, date, status, bookedPriceMinor: takenMinor })
    if (status === 'completed')
      s.sales.push({
        ...sale,
        id: `sale-${n}`,
        appointmentId: id,
        serviceMinor: takenMinor,
        discountMinor: 0,
        taxMinor: 0,
        tipMinor: 0,
      })
  }
  return { s, visit, main, islington, leeds }
}

describe('the whole business', () => {
  it('compares each location with its last 28 days and names the best and the weakest', () => {
    const { s, visit, main, islington, leeds } = business()
    // Main: 10000 now against 10000 before. Islington: 15000 against 10000. Leeds: 5000 against 10000.
    visit(main, '2026-10-10', 10000)
    visit(main, '2026-09-10', 10000)
    visit(islington, '2026-10-15', 15000)
    visit(islington, '2026-09-15', 10000)
    visit(leeds, '2026-10-05', 5000)
    visit(leeds, '2026-09-05', 10000)
    // Booked for later this month: booked, not taken.
    visit(leeds, '2026-10-28', 8000, 'confirmed')
    // Next month's booking is left out of this month.
    visit(leeds, '2026-11-02', 9000, 'confirmed')
    const view = wholeBusiness(s, today)
    expect(view.from).toBe('2026-09-23')
    const by = (id: string) => view.places.find((p) => p.locationId === id)!
    expect(by(islington)).toMatchObject({ takingsMinor: 15000, previousMinor: 10000, growth: 0.5 })
    expect(by(leeds)).toMatchObject({ takingsMinor: 5000, growth: -0.5 })
    expect(by(leeds).month).toEqual({ takenMinor: 5000, bookedMinor: 8000, targetMinor: null })
    expect(view.best?.locationId).toBe(islington)
    expect(view.weakest?.locationId).toBe(leeds)
    expect(view.total).toMatchObject({ takingsMinor: 30000, previousMinor: 30000, growth: 0 })
    expect(view.summary[0]).toBe(
      'Across 3 locations, completed visits took £300 in the last 28 days, level with the 28 days before.',
    )
    expect(view.summary[1]).toBe('Islington is doing best (up 50%). Leeds needs a look (down 50%).')
    expect(view.summary[2]).toMatch(/£300 taken, with £80 more booked but not yet taken\.$/)
  })

  it('never ranks locations that are level with each other', () => {
    const { s, visit, main, islington, leeds } = business()
    for (const [id, now, then] of [
      [main, 10000, 10000],
      [islington, 10000, 10000],
      [leeds, 5000, 10000],
    ] as const) {
      visit(id, '2026-10-10', now)
      visit(id, '2026-09-10', then)
    }
    let view = wholeBusiness(s, today)
    // Two locations level at the top: neither is "doing best"; Leeds is still clearly behind.
    expect(view.best).toBeNull()
    expect(view.weakest?.locationId).toBe(leeds)
    expect(view.summary[1]).toBe('Leeds needs a look (down 50%).')
    visit(leeds, '2026-10-11', 5000)
    view = wholeBusiness(s, today)
    expect([view.best, view.weakest]).toEqual([null, null])
    expect(view.summary).toHaveLength(2)
  })

  it('groups locations into regions with their own totals, and targets add up only when all are set', () => {
    const { s: start, visit, main, islington, leeds } = business()
    let s = apply(start, {
      type: 'region',
      input: { name: 'London', locationIds: [main, islington] },
    })
    s = apply(s, {
      type: 'targets',
      month: '2026-10',
      set: [{ locationId: main, takingsMinor: 40000 }],
    })
    const partly = s
    s = apply(s, {
      type: 'targets',
      month: '2026-10',
      set: [{ locationId: islington, takingsMinor: 60000 }],
    })
    // Visits are added last, straight into the record, to keep these figures exact.
    visit(main, '2026-10-10', 10000)
    visit(islington, '2026-10-12', 20000)
    const at = (state: BusinessState) =>
      wholeBusiness({ ...state, appointments: start.appointments, sales: start.sales }, today)
    let view = at(partly)
    expect(view.regions.map((r) => r.name)).toEqual(['London', 'Not in a region'])
    expect(view.regions[0]).toMatchObject({ takingsMinor: 30000 })
    expect(view.regions[0].month.targetMinor).toBeNull()
    view = at(s)
    expect(view.regions[0].month.targetMinor).toBe(100000)
    expect(view.summary.at(-1)).toMatch(/£300 taken\b/)
    // A target can be taken away again.
    s = apply(s, {
      type: 'targets',
      month: '2026-10',
      set: [{ locationId: main, takingsMinor: null }],
    })
    expect(at(s).places.find((p) => p.locationId === main)!.month.targetMinor).toBeNull()
    // A location answers to one region only.
    expect(
      refuse(s, { type: 'region', input: { name: 'North', locationIds: [leeds, islington] } }),
    ).toMatch(/already in London/)
    s = apply(s, { type: 'region', input: { name: 'North', locationIds: [leeds] } })
    expect(refuse(s, { type: 'region', input: { name: 'north', locationIds: [main] } })).toMatch(
      /already has that name/,
    )
    expect(
      refuse(s, { type: 'region', input: { name: 'South', locationIds: ['nowhere'] } }),
    ).toMatch(/not in this business/)
    const north = s.operations!.regions!.find((r) => r.name === 'North')!
    s = apply(s, { type: 'region-remove', regionId: north.id })
    expect(s.operations!.regions!.map((r) => r.name)).toEqual(['London'])
  })

  it('lets only the owner set regions and targets', () => {
    for (const type of ['region', 'region-remove', 'targets']) {
      const action = permissionFor({ type })
      expect(can('owner', action)).toBe(true)
      expect(can('manager', action)).toBe(false)
      expect(can('reception', action)).toBe(false)
    }
  })
})
