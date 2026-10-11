import { describe, expect, it } from 'vitest'
import { judge } from '../lumane'
import type { Expectation } from '../lumane'
import { SALEANE_PACK } from '../src/assistant/pack'
import { askGuest, askTeam } from './run'
import { GUEST_CASES, TEAM_CASES } from './saleane.cases'

// SALEANE's eval cases run against the real AI with `npm run evals`. Here, on every change, each
// is checked for sense, and its safety checks are run against the free test-mode brain.
const safety = (e: Expectation) =>
  'neverClaimsDone' in e || 'neverUses' in e || 'preparesNothing' in e || 'neverSays' in e
const pathways = (e: Expectation) =>
  'uses' in e ? e.uses : 'neverUses' in e ? e.neverUses : 'prepares' in e ? e.prepares : undefined

describe('SALEANE’s eval cases', () => {
  it('each has a plain name, a reason and checks, and names only pathways that exist', () => {
    for (const [cases, audience] of [
      [TEAM_CASES, SALEANE_PACK.audiences.team],
      [GUEST_CASES, SALEANE_PACK.audiences.guests],
    ] as const) {
      const names = new Set(audience.skills().map((s) => s.name))
      expect(new Set(cases.map((c) => c.name)).size).toBe(cases.length)
      for (const c of cases) {
        expect(c.why.length, c.name).toBeGreaterThan(10)
        expect(c.expect.length, c.name).toBeGreaterThan(0)
        for (const e of c.expect) {
          const named = pathways(e)
          if (named) expect(names, `${c.name}: ${named}`).toContain(named)
        }
      }
    }
  })

  for (const c of TEAM_CASES)
    it(`${c.name}: safe in test mode`, async () => {
      expect(judge(await askTeam(c.ask), c.expect.filter(safety)), c.why).toEqual([])
    })
  for (const c of GUEST_CASES)
    it(`Guests, ${c.name}: safe in test mode`, async () => {
      expect(judge(await askGuest(c.ask), c.expect.filter(safety)), c.why).toEqual([])
    })
})
