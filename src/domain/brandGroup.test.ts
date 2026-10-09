import { describe, expect, it } from 'vitest'
import { seed } from './seed'
import { brandFigures, brandGroup } from './brandGroup'
import type { BrandFigures } from './brandGroup'
import { wholeBusiness } from './group'

// V5: one owner's brands side by side.
const brand = (name: string, now: number, before: number, currency: 'GBP' | 'USD' = 'GBP') =>
  ({
    id: name,
    slug: name,
    name,
    currency,
    locale: currency === 'GBP' ? 'en-GB' : 'en-US',
    sample: false,
    today: '2026-10-06',
    locations: 1,
    clients: 10,
    takingsMinor: now,
    previousMinor: before,
    growth: before ? (now - before) / before : null,
    visits: 4,
    rebookRate: 0.5,
    month: { takenMinor: now, bookedMinor: 1000, targetMinor: null },
  }) satisfies BrandFigures

describe('brands together', () => {
  it('takes each brand from its own Business figures', () => {
    const s = seed('UK')
    const figures = brandFigures({ id: 'o1', slug: 'one', state: s })
    const whole = wholeBusiness(s, figures.today)
    expect(figures.takingsMinor).toBe(whole.total.takingsMinor)
    expect(figures.month).toEqual(whole.total.month)
    expect(figures.sample).toBe(true)
    expect(figures.clients).toBe(s.clients.length)
  })

  it('names the brand ahead and the one behind, and never adds pounds to dollars', () => {
    const g = brandGroup([
      brand('Ash', 12_000, 10_000),
      brand('Birch', 9_000, 10_000),
      brand('Cedar', 15_000, 10_000, 'USD'),
      brand('Damson', 5_000, 0),
    ])
    expect(g.best?.name).toBe('Cedar')
    expect(g.weakest?.name).toBe('Birch')
    expect(g.totals.map((t) => [t.currency, t.takingsMinor])).toEqual([
      ['GBP', 26_000],
      ['USD', 15_000],
    ])
    expect(g.summary).toEqual([
      'Across 3 brands, completed visits took £260 in the last 28 days, up 30% on the 28 days before.',
      'Across 1 brand, completed visits took $150 in the last 28 days, up 50% on the 28 days before.',
      'Cedar is doing best (up 50%). Birch needs a look (down 10%).',
    ])
  })

  it('ranks nobody when brands are level or there is only one to compare', () => {
    expect(brandGroup([brand('Ash', 11_000, 10_000), brand('Birch', 11_000, 10_000)]).best).toBe(
      null,
    )
    expect(brandGroup([brand('Ash', 11_000, 10_000), brand('Birch', 1, 0)]).best).toBe(null)
    // Growing more slowly than another brand is not a reason to look.
    const both = brandGroup([brand('Ash', 13_000, 10_000), brand('Birch', 11_000, 10_000)])
    expect(both.best?.name).toBe('Ash')
    expect(both.weakest).toBe(null)
    // The brand clearly ahead is named even when every brand fell.
    const falling = brandGroup([brand('Ash', 9_500, 10_000), brand('Birch', 8_000, 10_000)])
    expect([falling.best?.name, falling.weakest?.name]).toEqual(['Ash', 'Birch'])
  })

  it('never ranks a sample studio against a real one', () => {
    const sample = { ...brand('Sample', 50_000, 10_000), sample: true }
    const g = brandGroup([sample, brand('Ash', 11_000, 10_000), brand('Birch', 9_000, 10_000)])
    expect([g.best?.name, g.weakest?.name]).toEqual(['Ash', 'Birch'])
    const samples = brandGroup([sample, { ...brand('Other', 9_000, 10_000), sample: true }])
    expect(samples.best?.name).toBe('Sample')
  })
})
