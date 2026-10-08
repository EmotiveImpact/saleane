import { describe, expect, it } from 'vitest'
import { seed } from '../domain/seed'
import type { BusinessState } from '../domain/model'
import { askReceptionist } from './receptionist'
import type { ReceptionEffect, ReceptionTurn } from './receptionist'
import { dateIn, timeIn } from './receptionistBrain'

// V4: the AI receptionist in test mode. It answers from the studio's records, offers times for
// the guest to book on the page, and prepares messages for the team only for the guest to send.
const base = seed('UK')
const on = (s: BusinessState, handOver = true): BusinessState => ({
  ...s,
  operations: { ...s.operations!, receptionist: { enabled: true, handOver } },
})
const today = '2026-10-06'
const now = '2026-10-06T08:00:00.000Z'
async function chat(text: string, history: ReceptionTurn[] = [], state = on(base)) {
  const result = await askReceptionist({
    state,
    today,
    now,
    visitorId: 'v1',
    text,
    history,
    usage: undefined,
  })
  if (result.status !== 'answered') throw new Error(result.text)
  return result
}

describe('the AI receptionist in test mode', () => {
  it('says it is an AI and what it can do', async () => {
    const result = await chat('Hello')
    expect(result.text).toMatch(/AI receptionist/)
    expect(result.usage.used.guestChats).toBe(1)
    expect(result.costMinor).toBe(0)
  })

  it('gives prices from the menu, including the full price', async () => {
    const result = await chat('How much is the Skin Renewal Facial?')
    expect(result.text).toMatch(/^Skin Renewal Facial: £\d+ for \d+ minutes/)
    expect(result.proposals).toEqual([])
  })

  it('gives the opening hours', async () => {
    const result = await chat('When are you open?')
    expect(result.text).toMatch(/Atelier House is open:\nMonday: /)
  })

  it('finds free times and offers one only as something to finish booking on the page', async () => {
    const times = await chat('Any times for a facial on Thursday?')
    expect(times.text).toMatch(/^Skin Renewal Facial on Thursday 8 October: /)
    const first = /: (\d{2}:\d{2})/.exec(times.text)![1]
    const history: ReceptionTurn[] = [
      { from: 'guest', text: 'Any times for a facial on Thursday?' },
      { from: 'receptionist', text: times.text },
    ]
    const offered = await chat(`Book ${first} please`, history)
    expect(offered.text).toMatch(/Nothing is booked until you confirm/)
    expect(offered.proposals).toHaveLength(1)
    expect(offered.proposals[0].effect).toEqual<ReceptionEffect>({
      kind: 'time',
      serviceId: 'service-facial',
      staffId: 'any',
      date: '2026-10-08',
      startMinutes: Number(first.slice(0, 2)) * 60 + Number(first.slice(3)),
    })
    expect(offered.proposals[0].summary).toMatch(/Skin Renewal Facial, Thursday 8 October at/)
  })

  it('carries on looking for times when the guest answers with just a treatment', async () => {
    const asked = await chat('Any times tomorrow?')
    expect(asked.text).toMatch(/^Which treatment would you like\?/)
    const times = await chat('Skin Renewal Facial', [
      { from: 'guest', text: 'Any times tomorrow?' },
      { from: 'receptionist', text: asked.text },
    ])
    expect(times.text).toMatch(/^Skin Renewal Facial on Wednesday 7 October: /)
  })

  it('lets a chat already counted carry on when the month is used up, but starts no new one', async () => {
    const full = {
      period: '2026-10',
      used: { typed: 0, talkSeconds: 0, guestChats: 200 },
      spendByDay: {},
      recent: {},
    }
    const ask = (continuing: boolean) =>
      askReceptionist({
        state: on(base),
        today,
        now,
        visitorId: 'v1',
        text: 'Hello',
        continuing,
        usage: full,
      })
    expect((await ask(false)).status).toBe('refused')
    const going = await ask(true)
    expect(going.status).toBe('answered')
    if (going.status === 'answered') expect(going.usage.used.guestChats).toBe(200)
  })

  it('does not offer a time that is not free', async () => {
    const result = await chat('Can I book a facial on Thursday at 3am?')
    expect(result.proposals).toEqual([])
    expect(result.text).toMatch(/not free|Which would you like|nothing free/)
  })

  it('asks for contact details, then prepares a message for the guest to send', async () => {
    const asked = await chat('Can someone call me about a group booking?')
    expect(asked.text).toMatch(/your name, and an email address or phone number/)
    const history: ReceptionTurn[] = [
      { from: 'guest', text: 'Can someone call me about a group booking?' },
      { from: 'receptionist', text: asked.text },
    ]
    const prepared = await chat("I'm Rosa Field, 07700 900456", history)
    expect(prepared.proposals).toHaveLength(1)
    expect(prepared.proposals[0].effect).toMatchObject({
      kind: 'message',
      name: 'Rosa Field',
      contact: '07700 900456',
    })
    expect((prepared.proposals[0].effect as { message: string }).message).toMatch(/group booking/)
    expect(prepared.text).toMatch(/Nothing is sent until you do/)
  })

  it('never takes health details, and offers no messages when the studio turned them off', async () => {
    const health = await chat('Is the facial safe if I am pregnant?')
    expect(health.text).toMatch(/cannot help with health or medical questions/)
    expect(health.proposals).toEqual([])
    const closed = await chat(
      'Can someone call me? Rosa, rosa@example.invalid',
      [],
      on(base, false),
    )
    expect(closed.text).toMatch(/cannot pass on messages/)
    expect(closed.proposals).toEqual([])
  })

  it('reads dates and times the way guests write them', () => {
    expect(dateIn('tomorrow', today)).toBe('2026-10-07')
    expect(dateIn('on Tuesday', today)).toBe('2026-10-06')
    expect(dateIn('12th October', today)).toBe('2026-10-12')
    expect(dateIn('March 3', today)).toBe('2027-03-03')
    expect(dateIn('31 February', today)).toBeNull()
    expect(dateIn('whenever', today)).toBeNull()
    expect(timeIn('2.30pm')).toBe('14:30')
    expect(timeIn('at 3')).toBe('15:00')
    expect(timeIn('10am')).toBe('10:00')
    expect(timeIn('no time')).toBeNull()
  })
})
