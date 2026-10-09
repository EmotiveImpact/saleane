import { describe, expect, it } from 'vitest'
import { dispatch, execute, slots } from './commands'
import type { Command } from './commands'
import type { BusinessState } from './model'
import { parseState } from './model'
import { can, hoursFor, operations, permissionFor, stock } from './operations'
import { createWorkspace } from './workspace'
import { seed } from './seed'
import {
  atPlace,
  hasLocations,
  listPrice,
  places,
  roomWithPlace,
  staffLocationOn,
} from './locations'
import { heldVisit, placeImportedVisit } from './switching'
import { availableMinutes, report } from './selectors'
import { openings } from './waitlist'
import { composeMessage } from './reminders'
import { scheduleImpact } from './schedule'
import type { OperatingCommand } from './commandSchema'

// V2: several locations.
const now = '2026-10-06T08:00:00.000Z'
const thursday = '2026-10-08'
let sequence = 0
function local(): BusinessState {
  const s = createWorkspace({ name: 'Two-site studio', region: 'UK' })
  const sample = seed('UK')
  for (const key of ['clients', 'services', 'staff', 'resources'] as const)
    Object.assign(s, {
      [key]: sample[key].map((row) => ({ ...row, organisationId: s.organisation.id })),
    })
  return s
}
function run(s: BusinessState, command: Command, at = now) {
  return execute(s, command, at, () => `loc-${++sequence}`)
}
function apply(s: BusinessState, command: Command, at = now) {
  const result = run(s, command, at)
  if (!result.ok) throw new Error(result.error)
  return result.state
}
const branch = (input: Record<string, unknown> = {}, id?: string) =>
  ({
    type: 'location',
    ...(id ? { id } : {}),
    input: { name: 'Islington', address: '1 Upper Street, London', ...input },
  }) as Command
/** Maya's hours: the studio's week, at `where` on Thursdays. */
function mayaAt(s: BusinessState, where: string | undefined) {
  const maya = s.staff.find((p) => p.id === 'staff-maya')!
  const hours = operations(s).hours.map((h) => ({
    ...h,
    ...(h.day === 4 && where ? { locationId: where } : {}),
  }))
  const { id: _id, organisationId: _org, ...input } = maya
  void [_id, _org]
  return { type: 'staff', id: maya.id, input: { ...input, hours } } as Command
}
const moveRoom = (s: BusinessState, roomId: string, where?: string) => {
  const room = s.resources.find((r) => r.id === roomId)!
  return {
    type: 'resource',
    id: room.id,
    input: { name: room.name, type: room.type, ...(where ? { locationId: where } : {}) },
  } as Command
}
/** A studio with Islington open, treatment room 2 there and Maya there on Thursdays. */
function twoSites() {
  let s = apply(local(), branch())
  const islington = operations(s).locations![0].id
  s = apply(s, moveRoom(s, 'room-two', islington))
  s = apply(s, mayaAt(s, islington))
  return { s, islington }
}
const facial = (locationId?: string, staffId = 'staff-maya') =>
  ({
    type: 'book',
    input: {
      serviceId: 'service-facial',
      staffId,
      date: thursday,
      startMinutes: 600,
      clientId: 'client-1',
      source: 'desk',
      ...(locationId ? { locationId } : {}),
    },
  }) as Command

describe('several locations', () => {
  it('keeps a one-location studio exactly as it was', () => {
    const s = local()
    expect(hasLocations(s)).toBe(false)
    expect(places(s)).toHaveLength(1)
    const booked = apply(s, facial())
    expect(booked.appointments.at(-1)!.locationId).toBe(s.organisation.locationId)
  })

  it('books a person only where they work that day, in a room at that location', () => {
    const { s, islington } = twoSites()
    expect(hasLocations(s)).toBe(true)
    expect(staffLocationOn(s, 'staff-maya', thursday)).toBe(islington)
    expect(staffLocationOn(s, 'staff-maya', '2026-10-07')).toBe(s.organisation.locationId)
    // On Thursday Maya is in Islington, so the main location has no times with her.
    const main = s.organisation.locationId
    expect(slots(s, 'service-facial', 'staff-maya', thursday, now, main)).toEqual([])
    expect(run(s, facial(main)).ok).toBe(false)
    expect(slots(s, 'service-facial', 'staff-maya', thursday, now, islington)).toContain(600)
    // Without a chosen location (the desk, Ask Saleane), times and the visit follow where she works.
    expect(slots(s, 'service-facial', 'staff-maya', thursday, now)).toContain(600)
    expect(apply(s, facial()).appointments.at(-1)!.locationId).toBe(islington)
    const booked = apply(s, facial(islington)).appointments.at(-1)!
    expect(booked).toMatchObject({ locationId: islington, resourceId: 'room-two' })
    // Islington has one treatment room, so a second facial at the same time does not fit there.
    expect(run(apply(s, facial(islington)), facial(islington, 'any')).ok).toBe(false)
  })

  it('tells the guest which location to come to', () => {
    const { s: start, islington } = twoSites()
    const s = apply(start, branch({ arrivalNote: 'Ring the bell marked Saleane.' }, islington))
    const booked = apply(s, facial(islington))
    const visit = booked.appointments.at(-1)!
    const message = composeMessage(booked, visit, 'confirmation', 'email')
    expect(JSON.stringify(message)).toContain('Islington, 1 Upper Street, London')
    expect(JSON.stringify(message)).toContain('Ring the bell marked Saleane.')
    expect(roomWithPlace(booked, visit)).toBe('Treatment room 2, Islington')
    // A text has no address block, so it names the location itself.
    expect(composeMessage(booked, visit, 'reminder', 'sms').body).toContain(
      'at Islington, 1 Upper Street, London',
    )
    expect(composeMessage(local(), visit, 'reminder', 'sms').body).not.toContain('Islington')
  })

  it('carries an imported visit over to the location its professional works at that day', () => {
    const { s, islington } = twoSites()
    const row = {
      serviceId: 'service-facial',
      staffId: 'staff-maya',
      date: thursday,
      startMinutes: 600,
    }
    const placed = placeImportedVisit(s, row, now)
    expect(placed).toEqual({ resourceId: 'room-two' })
    expect(heldVisit(s, row, 'room-two', 'held-1').locationId).toBe(islington)
  })

  it('uses a location’s own opening hours when it has them', () => {
    const { s, islington } = twoSites()
    const late = operations(s).hours.map((h) => ({ ...h, open: 720 }))
    const opened = apply(s, branch({ hours: late }, islington))
    expect(hoursFor(opened, thursday, islington).open).toBe(720)
    expect(hoursFor(opened, thursday).open).not.toBe(720)
    expect(slots(opened, 'service-facial', 'staff-maya', thursday, now, islington)[0]).toBe(720)
  })

  it('refuses changes that would strand a booked visit at a location', () => {
    const { s: start, islington } = twoSites()
    const s = apply(start, facial(islington))
    // Moving the room, moving Maya's Thursday, or closing the location would each strand it.
    expect(run(s, moveRoom(s, 'room-two')).ok).toBe(false)
    expect(scheduleImpact(s, mayaAt(s, undefined) as OperatingCommand, now)[0]?.reason).toBe(
      'Maya Lewis would be working at another location that day',
    )
    const closed = run(s, branch({ archived: true }, islington))
    expect(closed.ok).toBe(false)
    if (!closed.ok) expect(closed.error).toContain('Islington would be closed')
    // Once the visit is cancelled the location can close.
    const cancelled = apply(s, {
      type: 'cancel',
      appointmentId: s.appointments.at(-1)!.id,
      reason: 'Client moved',
    } as Command)
    const shut = apply(cancelled, branch({ archived: true }, islington))
    expect(places(shut)).toHaveLength(1)
    expect(places(shut, true)).toHaveLength(2)
  })

  it('refuses a duplicate name, a room at a closed location, and non-owners', () => {
    const { s, islington } = twoSites()
    expect(run(s, branch({ address: 'Elsewhere' })).ok).toBe(false)
    expect(run(s, branch({ name: s.organisation.locationName })).ok).toBe(false)
    const shut = apply(apply(s, mayaAt(s, undefined)), moveRoom(s, 'room-two'))
    const closed = apply(shut, branch({ archived: true }, islington))
    expect(run(closed, moveRoom(closed, 'room-one', islington)).ok).toBe(false)
    expect(can('owner', permissionFor({ type: 'location' }))).toBe(true)
    for (const role of ['manager', 'reception', 'practitioner'] as const)
      expect(can(role, permissionFor({ type: 'location' }))).toBe(false)
    const result = dispatch(local(), branch(), 'Ava · owner', now)
    expect(result.ok).toBe(true)
  })

  it('rejects a visit, room or working day that names a missing location', () => {
    const { s: start, islington } = twoSites()
    const s = apply(start, facial(islington))
    const visit = structuredClone(s)
    visit.appointments.at(-1)!.locationId = 'nowhere'
    expect(() => parseState(visit, 'UK')).toThrow('missing location')
    const room = structuredClone(s)
    room.resources[0].locationId = 'nowhere'
    expect(() => parseState(room, 'UK')).toThrow('missing location')
    const day = structuredClone(s)
    day.staff.find((p) => p.id === 'staff-maya')!.hours![4].locationId = 'nowhere'
    expect(() => parseState(day, 'UK')).toThrow('missing location')
  })
})

describe('finishing several locations', () => {
  const wednesday = '2026-10-07'
  const facialOn = (date: string, locationId?: string) =>
    ({
      type: 'book',
      input: {
        serviceId: 'service-facial',
        staffId: 'staff-maya',
        date,
        startMinutes: 600,
        clientId: 'client-1',
        source: 'desk',
        ...(locationId ? { locationId } : {}),
      },
    }) as Command

  it('moves a visit to another location, keeping its price, and says so on the timeline', () => {
    const { s: start, islington } = twoSites()
    const s = apply(start, facialOn(wednesday))
    const visit = s.appointments.at(-1)!
    expect(visit.locationId).toBe(s.organisation.locationId)
    const move = (locationId?: string) =>
      ({
        type: 'reschedule',
        appointmentId: visit.id,
        date: thursday,
        startMinutes: 600,
        staffId: 'staff-maya',
        ...(locationId ? { locationId } : {}),
      }) as Command
    // On Thursday Maya is in Islington, so the visit can only follow her there.
    expect(run(s, move()).ok).toBe(false)
    const moved = apply(s, move(islington))
    const after = moved.appointments.find((a) => a.id === visit.id)!
    expect(after).toMatchObject({ locationId: islington, resourceId: 'room-two' })
    expect(after.bookedPriceMinor).toBe(visit.bookedPriceMinor)
    const event = moved.events.at(-1)!
    expect(event.detail).toContain('at Islington')
    expect(event.allocationChange?.to.locationId).toBe(islington)
    expect(() => parseState(moved, 'UK')).not.toThrow()
  })

  it('keeps stock at each location, moves it between them and sells from the right shelf', () => {
    const { s: start, islington } = twoSites()
    const main = start.organisation.locationId
    let s = apply(start, {
      type: 'product',
      input: { name: 'Calming balm', sku: 'CB', priceMinor: 3200, reorderAt: 1, archived: false },
    } as Command)
    const balm = operations(s).products.at(-1)!.id
    s = apply(s, {
      type: 'stock',
      productId: balm,
      quantity: 5,
      reason: 'received',
      note: 'Delivery',
    } as Command)
    expect(stock(s, balm, main)).toBe(5)
    expect(stock(s, balm, islington)).toBe(0)
    const moveStock = (quantity: number, from = main, to = islington) =>
      ({ type: 'stock-move', productId: balm, from, to, quantity }) as Command
    s = apply(s, moveStock(2))
    expect([stock(s, balm, main), stock(s, balm, islington), stock(s, balm)]).toEqual([3, 2, 5])
    expect(run(s, moveStock(3, islington, main)).ok).toBe(false)
    expect(run(s, moveStock(1, main, main)).ok).toBe(false)
    const sell = (quantity: number) =>
      run(s, {
        type: 'counter-sale',
        locationId: islington,
        products: [{ productId: balm, quantity }],
        method: 'cash',
      } as Command)
    const short = sell(3)
    expect(short.ok).toBe(false)
    if (!short.ok) expect(short.error).toContain('at Islington')
    const sold = sell(2)
    expect(sold.ok).toBe(true)
    if (!sold.ok) return
    expect(stock(sold.state, balm, islington)).toBe(0)
    expect(stock(sold.state, balm, main)).toBe(3)
    expect(sold.state.counterSales!.at(-1)!.locationId).toBe(islington)
    // A move that does not balance is rejected by the ledger.
    const broken = structuredClone(sold.state)
    broken.operations!.movements.find((m) => m.reason === 'moved' && m.quantity > 0)!.quantity = 3
    expect(() => parseState(broken, 'UK')).toThrow('Invalid stock move')
    // Reception cannot move stock, as with deliveries and counts.
    expect(can('reception', permissionFor({ type: 'stock-move' }))).toBe(false)
  })

  it('charges a location’s own price and leaves a treatment off a location’s menu', () => {
    const { s, islington } = twoSites()
    const facial = s.services.find((x) => x.id === 'service-facial')!
    const { id: _id, organisationId: _org, ...input } = facial
    void [_id, _org]
    const edit = (more: Record<string, unknown>) =>
      ({ type: 'service', id: facial.id, input: { ...input, ...more } }) as Command
    const priced = apply(
      s,
      edit({ locationPrices: [{ locationId: islington, priceMinor: 12000 }] }),
    )
    expect(apply(priced, facialOn(thursday)).appointments.at(-1)!.bookedPriceMinor).toBe(12000)
    expect(apply(priced, facialOn(wednesday)).appointments.at(-1)!.bookedPriceMinor).toBe(
      facial.priceMinor,
    )
    const main = s.organisation.locationId
    expect(run(s, edit({ locationPrices: [{ locationId: main, priceMinor: 1 }] })).ok).toBe(false)
    expect(run(s, edit({ notOfferedAt: [main, islington] })).ok).toBe(false)
    // A list price comes only from places a guest can book: "From" only when those differ.
    expect(
      listPrice(
        priced.services.find((x) => x.id === facial.id)!,
        [main],
      ),
    ).toEqual({
      priceMinor: facial.priceMinor,
      from: false,
    })
    expect(
      listPrice(
        priced.services.find((x) => x.id === facial.id)!,
        [main, islington],
      ),
    ).toEqual({ priceMinor: Math.min(12000, facial.priceMinor), from: true })
    const offMenu = apply(s, edit({ notOfferedAt: [islington] }))
    expect(slots(offMenu, 'service-facial', 'staff-maya', thursday, now)).toEqual([])
    expect(slots(offMenu, 'service-facial', 'staff-maya', wednesday, now)).toContain(600)
  })

  it('remembers which location a waitlist request is for', () => {
    const { s: start, islington } = twoSites()
    const s = apply(start, {
      type: 'waitlist-add',
      input: {
        clientId: 'client-1',
        serviceId: 'service-facial',
        fromDate: wednesday,
        toDate: '2026-10-10',
        times: [],
        note: '',
        locationId: islington,
      },
    } as Command)
    const entry = s.waitlist!.at(-1)!
    expect(entry.locationId).toBe(islington)
    const found = openings(s, entry, now, 5)
    expect(found.length).toBeGreaterThan(0)
    for (const opening of found)
      expect(staffLocationOn(s, opening.staffId, opening.date)).toBe(islington)
  })

  it('splits figures and open time by location', () => {
    const { s: start, islington } = twoSites()
    const s = apply(start, facialOn(thursday))
    const main = s.organisation.locationId
    expect(availableMinutes(s, thursday, islington)).toBeGreaterThan(0)
    expect(availableMinutes(s, thursday, islington) + availableMinutes(s, thursday, main)).toBe(
      availableMinutes(s, thursday),
    )
    expect(atPlace(s, islington).appointments.every((a) => a.locationId === islington)).toBe(true)
    expect(atPlace(s, main).appointments.some((a) => a.locationId === islington)).toBe(false)
  })

  it('counts gift cards, packages and memberships at the location that sold them', () => {
    const { s: start, islington } = twoSites()
    const main = start.organisation.locationId
    const card = (valueMinor: number, locationId?: string) =>
      ({
        type: 'gift-card-sell',
        input: {
          kind: 'money',
          valueMinor,
          purchaserName: 'Ada Lovelace',
          recipientName: 'Grace',
          message: '',
        },
        method: 'cash',
        ...(locationId ? { locationId } : {}),
      }) as Command
    let s = apply(start, card(5000, islington))
    s = apply(s, card(3000))
    s = apply(s, card(2000, main))
    s = apply(s, {
      type: 'offer',
      input: {
        kind: 'package',
        name: 'Five facials',
        serviceIds: ['service-facial'],
        visits: 5,
        priceMinor: 40000,
        discountPercent: 0,
        validMonths: 6,
        archived: false,
      },
    })
    const offerId = s.offers![0].id
    const sell = (clientId: string, locationId?: string) =>
      ({
        type: 'plan-sell',
        offerId,
        clientId,
        method: 'cash',
        ...(locationId ? { locationId } : {}),
      }) as Command
    s = apply(s, sell('client-1', islington))
    s = apply(s, sell('client-2'))
    // Islington is named on its own sales; the main location stays unnamed, as before.
    expect(s.giftCards!.map((c) => c.locationId)).toEqual([islington, undefined, undefined])
    expect(s.holdings!.map((h) => h.locationId)).toEqual([islington, undefined])
    // An old sale without a location counts at the main location.
    const figures = (where?: string) => {
      const data = report(s, 7, where)
      return [data.giftCardsSold, data.plansSold]
    }
    expect(figures(islington)).toEqual([5000, 40000])
    expect(figures(main)).toEqual([5000, 40000])
    expect(figures()).toEqual([10000, 80000])
    expect(atPlace(s, islington).giftCards!.map((c) => c.valueMinor)).toEqual([5000])
    // A closed or unknown location is refused.
    expect(run(s, card(1000, 'nowhere')).ok).toBe(false)
    expect(run(s, sell('client-3', 'nowhere')).ok).toBe(false)
    s = apply(s, branch({ archived: true }, islington))
    expect(run(s, card(1000, islington)).ok).toBe(false)
    expect(run(s, sell('client-3', islington)).ok).toBe(false)
  })

  it('records location changes in the schedule history', () => {
    const { s, islington } = twoSites()
    const history = operations(s).scheduleHistory ?? []
    expect(
      history.some((h) => h.kind === 'resource-moved' && h.summary.includes('Islington')),
    ).toBe(true)
    expect(
      history.some(
        (h) => h.kind === 'staff-hours' && h.summary.includes('Thursday at Islington, was'),
      ),
    ).toBe(true)
    void islington
  })
})
