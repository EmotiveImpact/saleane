import { describe, expect, it } from 'vitest'
import { commandSchema, dispatch } from '../domain/commands'
import { seed } from '../domain/seed'
import { askSaleane } from './ask'

const s = seed('UK')
const at = '2026-10-06T09:00:00.000Z'
const ask = (text: string, role: 'owner' | 'reception' | 'practitioner' = 'owner') =>
  askSaleane({ state: s, role, personId: 'p1', text, usage: undefined, at })

describe('Ask Saleane in test mode', () => {
  it('answers what is on today from the diary and counts one typed request', async () => {
    const result = await ask("What's on today?")
    expect(result.status).toBe('answered')
    if (result.status !== 'answered') return
    expect(result.text).toMatch(/visits? on Tuesday 6 October/)
    expect(result.usage.used.typed).toBe(1)
    expect(result.costMinor).toBe(0)
  })

  it('answers takings for owners but not reception', async () => {
    const owner = await ask('How much did we take this week?')
    expect(owner.text).toMatch(/£/)
    const desk = await ask('How much did we take this week?', 'reception')
    expect(desk.text).toBe('That is for owners and managers.')
  })

  it('briefs on a client by name', async () => {
    const client = s.clients[0]
    const result = await ask(`Tell me about ${client.name.split(' ')[0]}`)
    expect(result.text).toContain(client.name)
  })

  it('prepares an invitation as a proposal that saves an unsent draft once approved', async () => {
    const client = s.clients.find((c) => c.marketingConsent)!
    const result = await ask(`Invite ${client.name} back`)
    if (result.status !== 'answered') throw new Error('refused')
    expect(result.text).toMatch(/Nothing has been sent/)
    expect(result.proposals).toHaveLength(1)
    const command = commandSchema.parse(result.proposals[0].effect)
    const applied = dispatch(s, command, 'Owner', at)
    expect(applied.ok).toBe(true)
  })

  it('refuses an invitation to a client who has not agreed to marketing', async () => {
    const client = s.clients.find((c) => !c.marketingConsent)!
    const result = await ask(`Invite ${client.name} back`)
    if (result.status !== 'answered') throw new Error('refused')
    expect(result.proposals).toHaveLength(0)
    expect(result.text).toMatch(/not agreed to marketing/)
  })

  it('gives practitioners nothing from the whole studio', async () => {
    const result = await ask("What's on today?", 'practitioner')
    expect(result.text).not.toMatch(/visits? on/)
  })

  it('offers help for a question it does not know', async () => {
    expect((await ask('What is the weather like?')).text).toMatch(/In test mode/)
  })
})

describe('Smart insights through Ask Saleane', () => {
  it('gives the morning brief, with takings only for managers', async () => {
    const owner = await ask('Give me my morning brief')
    expect(owner.text).toMatch(/^Tuesday 6 October: 12 visits/)
    expect(owner.text).toMatch(/Yesterday took £/)
    const desk = await ask('Give me my morning brief', 'reception')
    expect(desk.text).toMatch(/^Tuesday 6 October: 12 visits/)
    expect(desk.text).not.toMatch(/£/)
  })

  it('lists clients drifting away', async () => {
    expect((await ask('Who is drifting away?')).text).toMatch(
      /clients are drifting away: Jamie Morgan/,
    )
  })

  it('says when nothing looks unusual', async () => {
    expect((await ask('Anything unusual?')).text).toBe('Nothing looks unusual right now.')
  })
})

describe('Specials through Ask Saleane', () => {
  it('suggests specials for owners and managers only', async () => {
    const owner = await ask('Any specials we should run?')
    expect(owner.text).toMatch(/^Specials to consider\./)
    expect(owner.text).toMatch(/Idea:/)
    expect((await ask('Any specials we should run?', 'reception')).text).toBe(
      'That is for owners and managers.',
    )
  })

  it('prepares a named special for approval, and approving it only records it', async () => {
    const result = await ask('Plan the Diwali special')
    if (result.status !== 'answered') throw new Error('refused')
    expect(result.text).toMatch(/Nothing is sent and no prices change/)
    expect(result.proposals).toHaveLength(1)
    expect(result.proposals[0].summary).toMatch(/^Plan "Diwali"/)
    const command = commandSchema.parse(result.proposals[0].effect)
    const done = dispatch(s, command, 'Owner', at)
    if (!done.ok) throw new Error(done.error)
    expect(done.state.specials).toHaveLength(1)
    expect(done.state.services).toEqual(s.services)
    const after = await askSaleane({
      state: done.state,
      role: 'owner',
      personId: 'p1',
      text: 'How did our specials go?',
      usage: undefined,
      at,
    })
    expect(after.text).toMatch(/^Diwali: Starts .*Nothing has been sent/)
  })
})
