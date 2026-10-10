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

  it('answers how to do something from the help guides, for the person asking', async () => {
    const owner = await ask('How do I refund a payment?')
    expect(owner.text).toMatch(/^Refund a payment: 1\. Open Business, then Money/)
    expect(owner.text).toContain('The guide is also in Help')
    // Reception cannot refund, so it is given the nearest guide it can use instead.
    const desk = await ask('How do I refund a payment?', 'reception')
    expect(desk.text).not.toMatch(/^Refund a payment/)
    const unknown = await ask('How do I launch a rocket?')
    expect(unknown.text).toMatch(/^I could not find a guide for that\. Open Help/)
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

  it('mentions only what is unusual: in the sample studio, one product running low', async () => {
    expect((await ask('Anything unusual?')).text).toBe(
      'Enzyme Peel, professional size is running low: At or below the level where you reorder.',
    )
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

describe("A manager's day through Ask Saleane", () => {
  it('answers "who is my 10 o\'clock" with the guest and what to know', async () => {
    const result = await ask("Who's my 10 o'clock?")
    expect(result.text).toMatch(/^09:30: Amelia Carter, Skin Renewal Facial with Maya\./)
    expect(result.text).toMatch(/Preferences:/)
  })

  it('offers open times, then prepares a booking for approval', async () => {
    const options = await ask('Book Jamie in with Maya for a facial on Thursday afternoon')
    expect(options.text).toMatch(/^Free on Thursday 8 October: Maya at 12:00, 13:00/)
    const booking = await ask('Book Jamie in with Maya for a facial on Thursday at 3pm')
    if (booking.status !== 'answered') throw new Error('refused')
    expect(booking.proposals[0].summary).toMatch(
      /^Book Jamie Morgan for Skin Renewal Facial with Maya Lewis on Thursday 8 October at 15:00/,
    )
    const done = dispatch(s, commandSchema.parse(booking.proposals[0].effect), 'Owner', at)
    expect(done.ok).toBe(true)
  })

  it('prepares a cancellation, and nothing changes until it is approved', async () => {
    const result = await ask('Cancel Nina Patel')
    if (result.status !== 'answered') throw new Error('refused')
    expect(result.proposals[0].summary).toMatch(/^Cancel Nina Patel's Deep Restore Massage/)
    const nina = s.clients.find((c) => c.name === 'Nina Patel')!
    expect(s.appointments.some((a) => a.clientId === nina.id && a.status === 'cancelled')).toBe(
      false,
    )
  })

  it('plans cover for someone who is off as one approval, for managers only', async () => {
    const result = await ask('Theo is off sick today')
    if (result.status !== 'answered') throw new Error('refused')
    expect(result.proposals[0].summary).toMatch(/^Cover for Theo on Tuesday 6 October:/)
    const command = commandSchema.parse(result.proposals[0].effect)
    expect(command.type).toBe('batch')
    expect(dispatch(s, command, 'Owner', at).ok).toBe(true)
    expect((await ask('Theo is off sick today', 'reception')).text).toBe(
      'That is for owners and managers.',
    )
  })

  it('closes the day and reviews the week with reasons', async () => {
    expect((await ask('How did we do today?')).text).toMatch(
      /^£195 in treatments from 2 visits, against about £151 on a usual Tuesday\./,
    )
    expect((await ask('How was the week?')).text).toMatch(
      /^The last seven days: £195 from 2 visits/,
    )
    expect((await ask('How did we do today?', 'reception')).text).toBe(
      'That is for owners and managers.',
    )
  })

  it('understands short follow-ups from the conversation so far', async () => {
    const follow = (history: { from: 'you' | 'saleane'; text: string }[], text: string) =>
      askSaleane({ state: s, role: 'owner', personId: 'p1', text, history, usage: undefined, at })
    const first = await ask("What's on today?")
    const tomorrow = await follow(
      [
        { from: 'you', text: "What's on today?" },
        { from: 'saleane', text: first.text },
      ],
      'and tomorrow?',
    )
    expect(tomorrow.text).toMatch(/Wednesday 7 October/)
    const two = await ask("Who's my 2pm?")
    expect(two.text).toMatch(/After that, Sophia has Isabel Wilson at 16:00\./)
    const after = await follow(
      [
        { from: 'you', text: "Who's my 2pm?" },
        { from: 'saleane', text: two.text },
      ],
      'and after her?',
    )
    expect(after.text).toMatch(/^16:00: Isabel Wilson/)
  })

  it('lists who is waiting with their first free time, and writes an offer only once approved', async () => {
    const list = await ask('Anyone on the waitlist?')
    expect(list.text).toMatch(/^3 waiting: Charlotte Hayes, Skin Renewal Facial with Maya/)
    const offer = await ask('Offer Emily Wednesday at 9am')
    if (offer.status !== 'answered') throw new Error('refused')
    expect(offer.proposals[0].summary).toMatch(
      /^Offer Emily Clarke Deep Restore Massage on Wednesday 7 October at 09:00 with .*nothing is sent/,
    )
    const done = dispatch(s, commandSchema.parse(offer.proposals[0].effect), 'Owner', at)
    if (!done.ok) throw new Error(done.error)
    const drafts = (state: typeof s) => (state.operations?.messages ?? []).length
    expect(drafts(done.state)).toBe(drafts(s) + 1)
    expect(done.state.operations?.messages.at(-1)?.status).toBe('draft')
    expect((await ask('Offer Emily Friday at 6pm')).text).toMatch(/^That time is not free/)
    expect((await ask('Anyone on the waitlist?', 'practitioner')).text).toBe(
      'Your role cannot see the waitlist.',
    )
  })

  it('leaves a reminder once approved, and brings it up in the morning brief', async () => {
    const result = await ask('Remind me today to order more towels')
    if (result.status !== 'answered') throw new Error('refused')
    expect(result.proposals[0].summary).toBe(
      'Remind the team on Tuesday 6 October: Order more towels',
    )
    const done = dispatch(s, commandSchema.parse(result.proposals[0].effect), 'Owner', at)
    if (!done.ok) throw new Error(done.error)
    const brief = await askSaleane({
      state: done.state,
      role: 'owner',
      personId: 'p1',
      text: 'Give me my morning brief',
      usage: undefined,
      at,
    })
    expect(brief.text).toMatch(/Reminders for today: Order more towels\./)
  })

  it('follows up what it mentioned first with one tap', async () => {
    const offer = await ask('Offer Charlotte today at 12:15')
    if (offer.status !== 'answered') throw new Error('refused')
    expect(offer.proposals[0].summary).toMatch(
      /^Offer Charlotte Hayes Skin Renewal Facial on Tuesday 6 October at 12:15 with Maya Lewis/,
    )
  })
})
