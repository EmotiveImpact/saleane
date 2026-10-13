import { afterAll, describe, expect, it } from 'vitest'
import { judge } from '../lumane'
import type { TurnResult } from '../lumane'
import { aiFromEnv } from '../server/ai'
import { ASK_NAME } from '../src/assistant/name'
import { askGuest, askTeam, evalStudio } from './run'
import { GUEST_CASES, TEAM_CASES } from './saleane.cases'

// `npm run evals`: every case against the real Claude, with ANTHROPIC_API_KEY set (and
// SALEANE_AI_MODEL to try another model). Without a key every case is skipped and nothing is sent.
// The studio is the fictional sample one. A full run should cost well under a pound, and says what
// it cost at the end.
const key = process.env.ANTHROPIC_API_KEY?.trim()
const ai = key
  ? aiFromEnv({
      SALEANE_AI_PROVIDER: 'claude',
      ANTHROPIC_API_KEY: key,
      SALEANE_AI_MODEL: process.env.SALEANE_AI_MODEL,
      SALEANE_AI_PRICES: process.env.SALEANE_AI_PRICES,
    })
  : undefined
// A sample studio never reaches the AI in SALEANE itself, so the brain is asked for as a real one.
const studio = evalStudio()
const real = { ...studio, operations: { ...studio.operations!, mode: 'local' as const } }
let spent = 0
const run = async (asked: Promise<TurnResult>) => {
  const result = await asked
  if (result.status !== 'refused') spent += result.costMinor
  return result
}

describe.skipIf(!ai)(`${ASK_NAME} against the real AI (${ai?.model ?? 'no key'})`, () => {
  afterAll(() => console.log(`This run cost about ${spent.toFixed(2)} US cents.`))
  for (const c of TEAM_CASES)
    it(c.name, async () => {
      const result = await run(askTeam(c.ask, ai!.brainFor(real, 'ask')))
      expect(judge(result, c.expect), c.why).toEqual([])
    })
  for (const c of GUEST_CASES)
    it(`Guests, ${c.name}`, async () => {
      const result = await run(askGuest(c.ask, ai!.brainFor(real, 'reception')))
      expect(judge(result, c.expect), c.why).toEqual([])
    })
})
