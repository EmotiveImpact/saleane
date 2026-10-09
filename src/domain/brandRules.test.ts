import { describe, expect, it } from 'vitest'
import { execute } from './commands'
import type { Command } from './commands'
import type { BusinessState } from './model'
import { can } from './operations'
import { seed } from './seed'
import { houseRuleNote, priceRange, ruleBreaches, serviceRuleRefusal } from './brandRules'
import { branchRefusal } from './branch'

// V5: the studio's colours and the house rules every location follows.
const now = '2026-10-06T15:00:00.000Z'
let sequence = 0
const run = (s: BusinessState, command: Command) =>
  execute(s, command, now, () => `brand-${++sequence}`)
function apply(s: BusinessState, command: Command) {
  const result = run(s, command)
  if (!result.ok) throw new Error(result.error)
  return result.state
}
function twoSites() {
  const s = apply(seed('UK'), {
    type: 'location',
    input: { name: 'Islington', address: '1 Upper Street' },
  })
  return { s, islington: s.operations!.locations![0].id, service: s.services[0] }
}

describe('house rules', () => {
  it('works out the prices a band allows', () => {
    expect(priceRange(100_00, 10)).toEqual({ min: 90_00, max: 110_00 })
    expect(priceRange(95_00, 0)).toEqual({ min: 95_00, max: 95_00 })
    expect(priceRange(33_33, 5)).toEqual({ min: 31_67, max: 34_99 })
  })

  it('records only what is chosen, and only treatments on the menu', () => {
    const { s, service } = twoSites()
    const set = apply(s, {
      type: 'house-rules',
      priceBandPercent: 0,
      coreServiceIds: [service.id, service.id],
    })
    expect(set.operations!.houseRules).toEqual({
      priceBandPercent: 0,
      coreServiceIds: [service.id],
    })
    const cleared = apply(set, { type: 'house-rules', priceBandPercent: null, coreServiceIds: [] })
    expect(cleared.operations!.houseRules).toBeUndefined()
    const unknown = run(s, { type: 'house-rules', priceBandPercent: 5, coreServiceIds: ['nope'] })
    expect(unknown.ok).toBe(false)
  })

  it('refuses a treatment priced outside the band or dropped from a core menu', () => {
    const { s, islington, service } = twoSites()
    const ruled = apply(s, {
      type: 'house-rules',
      priceBandPercent: 10,
      coreServiceIds: [service.id],
    })
    const price = (priceMinor: number) => ({
      ...service,
      locationPrices: [{ locationId: islington, priceMinor }],
    })
    expect(serviceRuleRefusal(ruled, price(Math.round(service.priceMinor * 1.1)))).toBeNull()
    expect(serviceRuleRefusal(ruled, price(Math.round(service.priceMinor * 0.85)))).toContain(
      'within 10% of the house price',
    )
    expect(serviceRuleRefusal(ruled, { ...service, notOfferedAt: [islington] })).toContain(
      'core treatment',
    )
    // An archived treatment is on no menu, so the rules ask nothing of it.
    expect(
      serviceRuleRefusal(ruled, { ...service, notOfferedAt: [islington], archived: true }),
    ).toBeNull()
    const same = apply(s, { type: 'house-rules', priceBandPercent: 0, coreServiceIds: [] })
    expect(serviceRuleRefusal(same, price(service.priceMinor + 1))).toContain(
      'the same at every location',
    )
  })

  it('lists treatments not yet in line, and changes nothing for them', () => {
    const { s, islington, service } = twoSites()
    const { id, ...input } = service
    const varied = apply(s, {
      type: 'service',
      id,
      input: {
        ...input,
        locationPrices: [{ locationId: islington, priceMinor: service.priceMinor * 2 }],
      },
    })
    const ruled = apply(varied, { type: 'house-rules', priceBandPercent: 20, coreServiceIds: [] })
    expect(ruled.services.find((x) => x.id === id)!.locationPrices).toEqual([
      { locationId: islington, priceMinor: service.priceMinor * 2 },
    ])
    expect(ruleBreaches(ruled)).toEqual([
      {
        serviceId: id,
        service: service.name,
        problem:
          'The price at Islington must stay within 20% of the house price under the house rules.',
      },
    ])
    expect(houseRuleNote(ruled, id)).toBe('House rules: prices stay within 20% of the house price.')
    // Saving the treatment again must bring it into line.
    expect(
      run(ruled, {
        type: 'service',
        id,
        input: {
          ...input,
          locationPrices: [{ locationId: islington, priceMinor: service.priceMinor * 2 }],
        },
      }).ok,
    ).toBe(false)
  })

  it('are the owner’s alone; colours are for owners and managers', () => {
    expect(can('owner', 'house-rules')).toBe(true)
    for (const role of ['manager', 'reception', 'practitioner', 'regional', 'general'] as const)
      expect(can(role, 'house-rules')).toBe(false)
    expect(can('owner', 'studio-look')).toBe(true)
    expect(can('manager', 'studio-look')).toBe(true)
    for (const role of ['reception', 'practitioner', 'regional', 'general'] as const)
      expect(can(role, 'studio-look')).toBe(false)
    const { s, islington } = twoSites()
    expect(
      branchRefusal(s, islington, { type: 'house-rules', priceBandPercent: 0, coreServiceIds: [] }),
    ).toContain('whole business')
  })
})

describe('studio colours', () => {
  it('keeps the chosen pair with the studio', () => {
    const look = { first: '#a35f4b', second: '#8c9a5b' } as const
    expect(apply(seed('UK'), { type: 'studio-look', look }).operations!.look).toEqual(look)
  })
})
