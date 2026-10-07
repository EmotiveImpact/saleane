import { describe, expect, it } from 'vitest'
import { dispatch, execute, slots } from './commands'
import type { Command } from './commands'
import type { BusinessState } from './model'
import { parseState } from './model'
import { can, hoursFor, operations, permissionFor } from './operations'
import { createWorkspace } from './workspace'
import { seed } from './seed'
import { hasLocations, places, roomWithPlace, staffLocationOn } from './locations'
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
    expect(slots(s, 'service-facial', 'staff-maya', thursday, now)).toEqual([])
    expect(slots(s, 'service-facial', 'staff-maya', thursday, now, islington)).toContain(600)
    expect(run(s, facial()).ok).toBe(false)
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
