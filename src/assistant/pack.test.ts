import { describe, expect, it } from 'vitest'
import { CORE_RULES, packProblems } from '../../lumane'
import type { Pack } from '../../lumane'
import { seed } from '../domain/seed'
import { askSaleane } from './ask'
import { ASK_NAME } from './name'
import { SALEANE_PACK } from './pack'
import { RECEPTION_INSTRUCTIONS, receptionistSkills } from './receptionist'
import { INSTRUCTIONS, askSaleaneSkills } from './saleane'

describe("SALEANE's pack for LUMANE", () => {
  it('is ready, and names the assistant Ask SALEANE', () => {
    expect(packProblems(SALEANE_PACK as unknown as Pack)).toEqual([])
    expect(ASK_NAME).toBe('Ask SALEANE')
    expect(INSTRUCTIONS.startsWith('You are Ask SALEANE, the assistant inside SALEANE')).toBe(true)
  })

  it('opens the team’s pathways to the team and the receptionist’s to guests', () => {
    const names = (skills: { name: string }[]) => skills.map((s) => s.name)
    const { team, guests } = SALEANE_PACK.audiences
    expect(names(team.skills())).toEqual(names(askSaleaneSkills()))
    expect(names(guests.skills())).toEqual(names(receptionistSkills()))
    expect(team.instructions).toBe(INSTRUCTIONS)
    expect(guests.instructions).toBe(RECEPTION_INSTRUCTIONS)
    expect([team.meter, guests.meter]).toEqual(['typed', 'guestChats'])
  })

  it('counts the three kinds of use SALEANE sells, with the labels its usage meter shows', () => {
    expect(SALEANE_PACK.meters).toEqual({
      typed: { label: 'Questions typed to Ask SALEANE', unit: 'uses' },
      talkSeconds: { label: 'Talking to Ask SALEANE', unit: 'seconds' },
      guestChats: { label: 'Guest chats with the AI receptionist', unit: 'uses' },
    })
  })

  it('leaves to LUMANE the rules every app shares', () => {
    for (const instructions of [INSTRUCTIONS, RECEPTION_INSTRUCTIONS])
      expect(instructions).not.toContain(CORE_RULES)
    expect(RECEPTION_INSTRUCTIONS).not.toMatch(/Say you are an AI/)
  })

  it('answers a typed question through the pack, counted as a typed question', async () => {
    const state = seed('UK')
    const at = '2026-10-11T09:00:00.000Z'
    const result = await askSaleane({
      state,
      role: 'owner',
      personId: 'p1',
      text: 'Who is in today?',
      usage: undefined,
      at,
    })
    expect(result.status).toBe('answered')
    if (result.status === 'answered') expect(result.usage.used).toMatchObject({ typed: 1 })
  })
})
