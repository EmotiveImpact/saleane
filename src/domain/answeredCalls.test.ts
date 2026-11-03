import { describe, expect, it } from 'vitest'
import { seed } from './seed'
import { operations } from './operations'
import { callLength, markCallDone, openAnsweredCalls, recordAnsweredCall } from './answeredCalls'
import { ANSWERED_CALL_LIMIT } from './answeredCallsSchema'
import { clientExport } from './privacy'
import { allowanceFor, PHONE_MINUTES } from './pricing'
import { monthBill } from './billing'

// NEXT-17: calls the AI receptionist answered, kept for the desk.
const now = '2026-10-06T10:00:00.000Z'
const call = (number?: string, extra = {}) => ({
  ...(number ? { number } : {}),
  startedAt: now,
  seconds: 95.4,
  turns: [{ from: 'guest' as const, text: 'When are you open?' }],
  texted: [],
  ...extra,
})
let n = 0
const id = () => `call-${++n}`

describe('answered calls', () => {
  it('matches the caller to one client and lists messages first, newest after', () => {
    const state = seed('UK')
    const rosa = state.clients[0]
    const known = recordAnsweredCall(
      state,
      call(rosa.phone.replace(/^0/, '+44').replace(/ /g, '')),
      id,
    )
    const withheld = recordAnsweredCall(
      state,
      call(undefined, {
        startedAt: '2026-10-06T10:05:00.000Z',
        message: { name: 'Ana', contact: 'ana@example.invalid', message: 'Please call me.' },
      }),
      id,
    )
    const stored = operations(state).answeredCalls!
    expect(stored.find((c) => c.id === known)).toMatchObject({ seconds: 95 })
    expect(stored.find((c) => c.id === withheld)?.number).toBeUndefined()
    const open = openAnsweredCalls(state, now).map((c) => c.id)
    expect(open.indexOf(withheld)).toBeLessThan(open.indexOf(known))
    markCallDone(state, withheld, now)
    expect(openAnsweredCalls(state, now).map((c) => c.id)).not.toContain(withheld)
    // Saying so twice changes nothing.
    const done = stored.find((c) => c.id === withheld)!.doneAt
    markCallDone(state, withheld, '2026-10-07T10:00:00.000Z')
    expect(stored.find((c) => c.id === withheld)!.doneAt).toBe(done)
  })

  it('refuses a call rather than dropping older ones when the list is full', () => {
    const state = seed('UK')
    operations(state).answeredCalls = Array.from({ length: ANSWERED_CALL_LIMIT }, (_, i) => ({
      id: `old-${i}`,
      at: now,
      seconds: 60,
      turns: [],
      texted: [],
    }))
    expect(() => recordAnsweredCall(state, call('+447700900111'), id)).toThrow(/full/)
    expect(operations(state).answeredCalls).toHaveLength(ANSWERED_CALL_LIMIT)
  })

  it('gives a client their answered calls in their export', () => {
    const state = seed('UK')
    const file = clientExport(state, 'client-14', {
      generatedAt: now,
      generatedBy: 'Owner',
    }) as unknown as { answeredCalls: unknown[] }
    expect(file.answeredCalls).toEqual([])
    operations(state).answeredCalls![0].clientId = 'client-14'
    const again = clientExport(state, 'client-14', {
      generatedAt: now,
      generatedBy: 'Owner',
    }) as unknown as { answeredCalls: Record<string, unknown>[] }
    expect(again.answeredCalls[0]).toMatchObject({
      seconds: 160,
      textedLinks: ['Skin Renewal Facial with Maya Lewis, Saturday 10 October at 10:30'],
      messageForTeam: { name: 'Hannah Cole' },
    })
  })

  it('says how long a call lasted', () => {
    expect(callLength(42)).toBe('under a minute')
    expect(callLength(80)).toBe('1 minute')
    expect(callLength(160)).toBe('3 minutes')
  })
})

describe('the phone receptionist add-on', () => {
  it('gives minutes of calls and more spending room only when chosen, for each location', () => {
    expect(allowanceFor({ locations: 2, plus: false }).monthly.phoneSeconds).toBe(0)
    const phone = allowanceFor({ locations: 2, plus: false, phone: true })
    expect(phone.monthly.phoneSeconds).toBe(PHONE_MINUTES * 60 * 2)
    expect(phone.monthlySpendCeilingMinor).toBe(
      allowanceFor({ locations: 2, plus: false }).monthlySpendCeilingMinor + 5000,
    )
    expect(allowanceFor({ locations: 2, plus: false, phone: true, paused: true }).monthly).toEqual({
      typed: 0,
      talkSeconds: 0,
      guestChats: 0,
      phoneSeconds: 0,
    })
  })

  it('adds its own line to the monthly bill', () => {
    const bill = monthBill('UK', 2, true, 3, true)
    expect(bill.lines.map((l) => [l.text, l.amountMinor])).toEqual([
      ['SALEANE, 2 locations', 11800],
      ['Plus, 2 locations', 7800],
      ['Phone receptionist, 2 locations', 15800],
    ])
  })
})
