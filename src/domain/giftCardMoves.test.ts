import { describe, expect, it } from 'vitest'
import { dispatch, execute } from './commands'
import type { Command } from './commands'
import type { BusinessState } from './model'
import { parseState } from './model'
import { can, GENERAL_ACTIONS, operations, permissionFor } from './operations'
import type { Role } from './operations'
import { createWorkspace } from './workspace'
import { seed } from './seed'
import { giftCards, giftCardsProblem, giftStanding, heldByHome } from './giftCards'
import { giftHome } from './locations'
import { report } from './selectors'
import { cashForDay } from './tillCount'
import { cashTaken } from './till'
import { branchRefusal } from './branch'
import { areaRefusal } from './area'
import { practitionerRefusal } from './practitioner'
import { changeDetail, describeChange, recordNames } from './changeRecord'
import { otherReceipts } from './receipt'

// Stage 4: moving a gift card to another location.
const now = '2026-10-06T08:00:00.000Z'
const later = '2026-10-08T15:00:00.000Z'
let sequence = 0
/** A real studio with the sample team, a second location (Shoreditch) and a room there. */
function studio() {
  let s = createWorkspace({ name: 'Gift moves studio', region: 'UK', locationName: 'Marylebone' })
  const sample = seed('UK')
  for (const key of ['clients', 'services', 'staff', 'resources'] as const)
    Object.assign(s, {
      [key]: sample[key].map((row) => ({ ...row, organisationId: s.organisation.id })),
    })
  s = apply(s, {
    type: 'location',
    input: { name: 'Shoreditch', address: '1 Curtain Road, London' },
  } as Command)
  const shoreditch = operations(s).locations![0].id
  s = apply(s, {
    type: 'resource',
    input: { name: 'Shoreditch room', type: 'treatment', locationId: shoreditch },
  } as Command)
  return { s, main: s.organisation.locationId, shoreditch }
}
function run(s: BusinessState, command: Command, at = now) {
  return execute(s, command, at, () => `card-move-${++sequence}`)
}
function apply(s: BusinessState, command: Command, at = now) {
  const result = run(s, command, at)
  if (!result.ok) throw new Error(result.error)
  return result.state
}
function refusal(s: BusinessState, command: Command, at = now) {
  const result = run(s, command, at)
  if (result.ok) throw new Error('Expected a refusal.')
  return result.error
}
const sell = (valueMinor: number, locationId?: string) =>
  ({
    type: 'gift-card-sell',
    input: {
      kind: 'money',
      valueMinor,
      clientId: 'client-1',
      purchaserName: 'Amelia Hart',
      recipientName: 'Grace',
      message: 'Happy birthday',
    },
    method: 'cash',
    ...(locationId ? { locationId } : {}),
  }) as Command
const moveCard = (giftCardId: string, locationId: string, reason = 'Grace lives in Shoreditch') =>
  ({ type: 'gift-card-move', giftCardId, locationId, reason }) as Command

describe('moving a gift card to another location', () => {
  it('keeps its code, balance, last day and history, and records the move', () => {
    const { s: start, main, shoreditch } = studio()
    const sold = apply(start, sell(15000))
    const card = giftCards(sold)[0]
    expect(giftHome(sold, card)).toBe(main)
    const moved = apply(sold, moveCard(card.id, shoreditch), later)
    const after = giftCards(moved)[0]
    // Everything about the card is as it was, where it was sold included.
    const { moves, ...rest } = after
    expect(rest).toEqual(card)
    expect(moves).toEqual([
      {
        id: expect.any(String),
        from: main,
        to: shoreditch,
        reason: 'Grace lives in Shoreditch',
        at: later,
        actor: '',
      },
    ])
    expect(giftHome(moved, after)).toBe(shoreditch)
    expect(giftStanding(after, '2026-10-08')).toEqual(giftStanding(card, '2026-10-08'))
    // The client's timeline says so in plain words.
    const event = moved.events.at(-1)!
    expect(event).toMatchObject({
      clientId: 'client-1',
      type: 'gift_card',
      title: 'Gift card moved',
      detail: `${card.code} moved from Marylebone to Shoreditch. Its balance, last day and history are unchanged, and it can still be spent at any location.`,
    })
    expect(() => parseState(moved, 'UK')).not.toThrow()
    // It can move again, and back; each move follows on from the last.
    const back = apply(moved, moveCard(card.id, main, 'Grace moved back'), later)
    expect(giftCards(back)[0].moves!.map((m) => [m.from, m.to])).toEqual([
      [main, shoreditch],
      [shoreditch, main],
    ])
    expect(giftHome(back, giftCards(back)[0])).toBe(main)
    expect(() => parseState(back, 'UK')).not.toThrow()
  })

  it('leaves money already taken and spent where it happened', () => {
    const { s: start, main, shoreditch } = studio()
    let s = apply(start, sell(15000))
    // Spent in part on a visit at the main location before the move.
    s = apply(s, {
      type: 'book',
      input: {
        serviceId: 'service-facial',
        staffId: 'staff-maya',
        date: '2026-10-06',
        startMinutes: 600,
        clientId: 'client-1',
        source: 'desk',
      },
    } as Command)
    const visit = s.appointments.at(-1)!
    s = apply(s, { type: 'arrive', appointmentId: visit.id } as Command)
    s = apply(s, {
      type: 'checkout',
      appointmentId: visit.id,
      tipMinor: 0,
      method: 'cash',
      giftCardId: giftCards(s)[0].id,
      giftCardMinor: 5000,
    } as Command)
    const before = s
    const moved = apply(s, moveCard(giftCards(s)[0].id, shoreditch), later)
    // Every figure, for each location and for the whole studio, is exactly as it was.
    for (const place of [main, shoreditch, undefined])
      expect(report(moved, 30, place), place).toEqual(report(before, 30, place))
    expect(report(moved, 30, main).giftCardsSold).toBe(15000)
    expect(report(moved, 30, shoreditch).giftCardsSold).toBe(0)
    for (const day of ['2026-10-06', '2026-10-08'])
      expect(cashForDay(moved, day)).toEqual(cashForDay(before, day))
    expect(otherReceipts(moved)).toEqual(otherReceipts(before))
    // No money moved: a move takes nothing in and gives nothing back.
    expect(cashTaken(before, moved)).toEqual([])
    expect(moved.payments).toEqual(before.payments)
    expect(moved.sales).toEqual(before.sales)
    // What is still to be spent now belongs to Shoreditch.
    expect([...heldByHome(before, '2026-10-08')]).toEqual([[main, 10000]])
    expect([...heldByHome(moved, '2026-10-08')]).toEqual([[shoreditch, 10000]])
  })

  it('can still be spent at any location after it moves', () => {
    const { s: start, main, shoreditch } = studio()
    let s = apply(start, sell(15000))
    s = apply(s, moveCard(giftCards(s)[0].id, shoreditch))
    // Spent on a visit at Marylebone, where it no longer belongs.
    s = apply(s, {
      type: 'book',
      input: {
        serviceId: 'service-facial',
        staffId: 'staff-maya',
        date: '2026-10-06',
        startMinutes: 600,
        clientId: 'client-1',
        source: 'desk',
      },
    } as Command)
    const visit = s.appointments.at(-1)!
    expect(visit.locationId).toBe(main)
    s = apply(s, { type: 'arrive', appointmentId: visit.id } as Command)
    s = apply(s, {
      type: 'checkout',
      appointmentId: visit.id,
      tipMinor: 0,
      method: 'cash',
      giftCardId: giftCards(s)[0].id,
      giftCardMinor: 9500,
    } as Command)
    expect(giftStanding(giftCards(s)[0], '2026-10-06').balanceMinor).toBe(5500)
    // The visit's takings count where the visit was, as always.
    expect(report(s, 30, main).completed).toBe(1)
    expect(report(s, 30, shoreditch).completed).toBe(0)
    expect([...heldByHome(s, '2026-10-06')]).toEqual([[shoreditch, 5500]])
  })

  it('returns cash from the drawer where the card belongs when it is cancelled later', () => {
    const { s: start, main, shoreditch } = studio()
    const sold = apply(start, sell(8000))
    const moved = apply(sold, moveCard(giftCards(sold)[0].id, shoreditch))
    const cancelled = apply(
      moved,
      {
        type: 'gift-card-cancel',
        giftCardId: giftCards(moved)[0].id,
        reason: 'Grace asked for her money back',
        refundMinor: 8000,
        method: 'cash',
        reference: 'R-1',
      } as Command,
      later,
    )
    expect(cashTaken(moved, cancelled)).toEqual([
      expect.objectContaining({ cause: 'refund', locationId: shoreditch, amountMinor: 8000 }),
    ])
    // The sale's own cash stayed in the drawer that took it.
    expect(cashTaken(start, sold)).toEqual([
      expect.objectContaining({ cause: 'cash', locationId: main, amountMinor: 8000 }),
    ])
  })

  it('refuses a card that is used up, expired, cancelled or already there', () => {
    const { s: start, main, shoreditch } = studio()
    let s = apply(start, sell(5000))
    const card = giftCards(s)[0]
    expect(refusal(s, moveCard(card.id, main))).toBe(
      `Gift card ${card.code} already belongs to Marylebone.`,
    )
    expect(refusal(s, moveCard(card.id, 'nowhere'))).toBe('Choose an open location.')
    expect(refusal(s, moveCard('gift-unknown', shoreditch))).toBe(
      'This gift card was not sold here.',
    )
    // A reason is needed, as for cancelling.
    expect(run(s, moveCard(card.id, shoreditch, ' ')).ok).toBe(false)
    // An archived location is closed to new cards.
    const { id: placeId, ...place } = operations(s).locations![0]
    const closed = apply(s, {
      type: 'location',
      id: placeId,
      input: { ...place, archived: true },
    } as Command)
    expect(refusal(closed, moveCard(card.id, shoreditch))).toBe('Choose an open location.')
    // Expired.
    const expired = structuredClone(s)
    expired.giftCards![0].expiresOn = '2026-10-05'
    expect(refusal(expired, moveCard(card.id, shoreditch))).toBe(
      `Gift card ${card.code} expired on 5 October 2026. Give it more time first if it is still to be spent.`,
    )
    // Used up.
    const used = structuredClone(s)
    used.giftCards![0].redemptions.push({
      id: 'r-1',
      saleId: 's-1',
      appointmentId: 'a-1',
      amountMinor: 5000,
      at: now,
    })
    expect(refusal(used, moveCard(card.id, shoreditch))).toBe(
      `Gift card ${card.code} has been used up, so there is nothing to move.`,
    )
    // Cancelled, with and without money returned.
    const cancel = (refundMinor: number) =>
      ({
        type: 'gift-card-cancel',
        giftCardId: card.id,
        reason: 'Bought by mistake',
        refundMinor,
        ...(refundMinor ? { method: 'cash', reference: `R-${refundMinor}` } : {}),
      }) as Command
    expect(refusal(apply(s, cancel(5000)), moveCard(card.id, shoreditch))).toBe(
      `Gift card ${card.code} was cancelled and its money returned, so it cannot move.`,
    )
    expect(refusal(apply(s, cancel(0)), moveCard(card.id, shoreditch))).toBe(
      `Gift card ${card.code} was cancelled, so it cannot move.`,
    )
    s = apply(s, moveCard(card.id, shoreditch))
    expect(refusal(s, moveCard(card.id, shoreditch))).toBe(
      `Gift card ${card.code} already belongs to Shoreditch.`,
    )
    // A card's history of moves is kept within bounds, with a plain reason.
    const busy = structuredClone(s)
    const first = busy.giftCards![0].moves![0]
    busy.giftCards![0].moves = Array.from({ length: 50 }, (_, i) => ({
      ...first,
      id: `move-${i}`,
      ...(i % 2 ? { from: shoreditch, to: main } : { from: main, to: shoreditch }),
    }))
    expect(refusal(busy, moveCard(card.id, shoreditch))).toBe(
      `Gift card ${card.code} has moved as often as one card can. Ask SALEANE support to look at it.`,
    )
  })

  it('names who moved it, for the card and for who changed what', () => {
    const { s: start, main, shoreditch } = studio()
    const sold = apply(start, sell(15000))
    const card = giftCards(sold)[0]
    const result = dispatch(sold, moveCard(card.id, shoreditch), 'Amara Owner', later)
    if (!result.ok) throw new Error(result.error)
    expect(giftCards(result.state)[0].moves![0].actor).toBe('Amara Owner')
    // A later change leaves the earlier move's name alone.
    const again = dispatch(
      result.state,
      moveCard(card.id, main, 'Back to Marylebone'),
      'Bea Manager',
      later,
    )
    if (!again.ok) throw new Error(again.error)
    expect(giftCards(again.state)[0].moves!.map((m) => m.actor)).toEqual([
      'Amara Owner',
      'Bea Manager',
    ])
    const detail = changeDetail(sold, result.state, 'gift-card-move', card.id)
    expect(detail).toEqual({ fields: [{ f: 'locationId', from: main, to: shoreditch }] })
    // The reason is typed wording, so it stays on the card and is not copied into the record.
    expect(JSON.stringify(detail)).not.toContain('Grace')
    expect(
      describeChange(result.state, recordNames(result.state), {
        id: 'a',
        action: 'gift-card-move',
        recordId: card.id,
        occurredAt: Date.parse(later),
        actor: 'Amara Owner',
        account: null,
        detail: JSON.stringify(detail),
      }),
    ).toMatchObject({
      what: 'Moved a gift card to another location',
      about: '£150 gift card',
      lines: [{ what: 'location', from: 'Marylebone', to: 'Shoreditch' }],
    })
  })

  it('checks every move follows on from where the card belonged', () => {
    const { s: start, main, shoreditch } = studio()
    const s = apply(start, sell(5000))
    const moved = apply(s, moveCard(giftCards(s)[0].id, shoreditch))
    expect(giftCardsProblem(moved)).toBeNull()
    const broken = structuredClone(moved)
    broken.giftCards![0].moves![0].from = shoreditch
    expect(giftCardsProblem(broken)).toBe(
      'A gift card move does not follow on from where the card belonged.',
    )
    const early = structuredClone(moved)
    early.giftCards![0].moves![0].at = '2026-10-01T08:00:00.000Z'
    expect(giftCardsProblem(early)).toBe(
      'A gift card move does not follow on from where the card belonged.',
    )
    const twice = structuredClone(moved)
    twice.giftCards![0].moves!.push({
      ...twice.giftCards![0].moves![0],
      from: shoreditch,
      to: main,
    })
    expect(giftCardsProblem(twice)).toBe('Duplicate gift card move IDs.')
    const nowhere = structuredClone(moved)
    nowhere.giftCards![0].moves![0].to = 'loc-gone'
    expect(() => parseState(nowhere, 'UK')).toThrow()
  })

  it('is for owners and managers, and a general manager for cards that belong to their location', () => {
    const { s: start, main, shoreditch } = studio()
    let s = apply(start, sell(5000))
    s = apply(s, sell(7000, shoreditch))
    const [here, there] = giftCards(s)
    const roles: Role[] = ['owner', 'manager', 'reception', 'practitioner', 'regional', 'general']
    expect(permissionFor({ type: 'gift-card-move' })).toBe('gift-card-move')
    expect(roles.filter((role) => can(role, 'gift-card-move'))).toEqual([
      'owner',
      'manager',
      'general',
    ])
    expect((GENERAL_ACTIONS as readonly string[]).includes('gift-card-move')).toBe(true)
    // A general manager at Marylebone may pass on Marylebone's card, not Shoreditch's.
    expect(branchRefusal(s, main, moveCard(here.id, shoreditch))).toBeNull()
    expect(branchRefusal(s, main, moveCard(there.id, main))).toBe(
      'That gift card belongs to another location. Ask its general manager, the owner or a manager.',
    )
    expect(branchRefusal(s, shoreditch, moveCard(there.id, main))).toBeNull()
    // Once passed on, it is no longer theirs to move back.
    const passed = apply(s, moveCard(here.id, shoreditch))
    expect(branchRefusal(passed, main, moveCard(here.id, main))).not.toBeNull()
    expect(branchRefusal(passed, shoreditch, moveCard(here.id, main))).toBeNull()
    expect(branchRefusal(s, main, moveCard('gift-unknown', shoreditch))).not.toBeNull()
    // A practitioner and a regional manager are refused by their own rules too.
    expect(practitionerRefusal(s, 'staff-maya', moveCard(here.id, shoreditch), '2026-10-06')).toBe(
      'Your role cannot make this change.',
    )
    expect(areaRefusal(s, 'region', moveCard(here.id, shoreditch))).toBe(
      'Your role cannot make this change.',
    )
  })
})
