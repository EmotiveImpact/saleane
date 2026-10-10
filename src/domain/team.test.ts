import { describe, expect, it } from 'vitest'
import { dispatch, execute } from './commands'
import type { Command } from './commands'
import type { BusinessState } from './model'
import { parseState } from './model'
import { GENERAL_ACTIONS, can, operations, permissionFor } from './operations'
import type { Role } from './operations'
import { seed } from './seed'
import { addDays } from './format'
import { branchChangeRefusal, branchRefusal, branchView } from './branch'
import { changeDetail } from './changeRecord'
import { rotaPreview, weekCopy, weekStillToCome } from './rota'
import {
  mayPlanDay,
  onTeam,
  roomRefusal,
  rotaDayRefusal,
  teamChangeRefusal,
  timeOffRefusal,
  usuallyAt,
  weekTeam,
} from './team'
import { timeOffProblem } from './timeOff'

// Stage 4: a general manager changes their own team's days, time off and rooms, at their own
// location only. The sample studio is open Monday to Saturday; its day is Tuesday 6 October.
const now = '2026-10-06T08:00:00.000Z'
const today = '2026-10-06'
let sequence = 0
function run(s: BusinessState, command: Command, actor = 'Ava Owner') {
  return dispatch(s, command, actor, now)
}
function apply(s: BusinessState, command: Command, actor = 'Ava Owner') {
  const result = run(s, command, actor)
  if (!result.ok) throw new Error(result.error)
  return result.state
}
const day = (
  staffId: string,
  date: string,
  extra: Record<string, unknown> = { working: true, open: 600, close: 960 },
) =>
  ({ type: 'rota-day', input: { staffId, date, ...extra } }) as Extract<
    Command,
    { type: 'rota-day' }
  >
const usual = (staffId: string, date: string) =>
  ({ type: 'rota-day-usual', staffId, date }) as Extract<Command, { type: 'rota-day-usual' }>
const away = (staffId: string, from: string, to: string) =>
  ({ type: 'time-off', input: { staffId, from, to, kind: 'holiday' } }) as Command

/**
 * The sample with Islington open and a room there. Nia works at Islington Monday to Wednesday and
 * at the main location Thursday to Saturday, so she is on both teams. Maya, Sophia and Theo work
 * at the main location only.
 */
function twoSites() {
  let s = apply(seed('UK'), {
    type: 'location',
    input: { name: 'Islington', address: '1 Upper Street' },
  })
  const main = s.organisation.locationId
  const islington = s.operations!.locations![0].id
  s = apply(s, {
    type: 'resource',
    input: { name: 'Islington room', type: 'treatment', locationId: islington },
  } as Command)
  s = apply(s, {
    type: 'staff',
    input: {
      name: 'Nia Fictional',
      role: 'Facialist',
      serviceIds: ['service-facial'],
      tone: 'sage',
      hours: operations(s).hours.map((h) =>
        h.day >= 1 && h.day <= 3 ? { ...h, locationId: islington } : { ...h },
      ),
    },
  } as Command)
  const nia = s.staff.find((p) => p.name === 'Nia Fictional')!.id
  const room = s.resources.find((r) => r.name === 'Islington room')!.id
  return { s, main, islington, nia, room }
}

/** A change as a general manager at `locationId` makes it: checked before and after. */
function asGeneral(s: BusinessState, locationId: string, command: Command) {
  const refusal = branchRefusal(s, locationId, command)
  if (refusal) return { ok: false as const, error: refusal }
  const result = execute(s, command, now, () => `gm-${++sequence}`)
  if (!result.ok) return result
  const after = branchChangeRefusal(s, result.state, locationId)
  return after ? { ok: false as const, error: after } : result
}

describe('moves to another location in their view', () => {
  it("keeps their own team's moves and anyone moving in, and leaves out other locations'", () => {
    const { s, islington } = twoSites()
    let moved = apply(s, {
      type: 'location',
      input: { name: 'Shoreditch', address: '2 Rivington Street' },
    })
    const shoreditch = operations(moved).locations!.find((l) => l.name === 'Shoreditch')!.id
    // Maya moves to Islington and Sophia to Shoreditch, both from Monday 19 October.
    for (const [staffId, to] of [
      ['staff-maya', islington],
      ['staff-sophia', shoreditch],
    ])
      moved = apply(moved, {
        type: 'staff-move',
        input: { staffId, to, date: '2026-10-19', note: 'Covering the new team' },
        keepBooked: true,
      })
    const kept = operations(branchView(moved, islington, today)).staffMoves ?? []
    expect(kept.map((m) => m.staffId)).toEqual(['staff-maya'])
    // The view still reads as a whole studio record.
    expect(() =>
      parseState(structuredClone(branchView(moved, islington, today)), 'UK'),
    ).not.toThrow()
  })
})

describe('their own team', () => {
  it('is the people who usually work there, and anyone the rota sends there that day', () => {
    const { s, main, islington, nia } = twoSites()
    expect(weekTeam(s, islington, '2026-10-12').map((p) => p.id)).toEqual([nia])
    expect(weekTeam(s, main, '2026-10-12').map((p) => p.id)).toEqual([
      'staff-maya',
      'staff-sophia',
      'staff-theo',
      nia,
    ])
    // The owner sends Maya to Islington on Wednesday 14 October, for that day only.
    const sent = apply(
      s,
      day('staff-maya', '2026-10-14', {
        working: true,
        open: 600,
        close: 960,
        locationId: islington,
      }),
    )
    expect(weekTeam(sent, islington, '2026-10-12').map((p) => p.id)).toEqual(['staff-maya', nia])
    expect(onTeam(sent, islington, 'staff-maya', '2026-10-14')).toBe(true)
    expect(onTeam(sent, islington, 'staff-maya', '2026-10-15')).toBe(false)
    expect(usuallyAt(sent, 'staff-maya', islington, '2026-10-14')).toBe(false)
    // Nobody archived is on a team.
    const gone = structuredClone(s)
    gone.staff.find((p) => p.id === nia)!.archived = true
    expect(onTeam(gone, islington, nia, '2026-10-12')).toBe(false)
  })
})

describe('a general manager changing days on the rota', () => {
  it('changes and adds days for their team at their location', () => {
    const { s, islington, nia } = twoSites()
    // Different hours on one of Nia's Islington days, and an extra day on a Monday.
    const hours = day(nia, '2026-10-13', {
      working: true,
      open: 600,
      close: 900,
      locationId: islington,
    })
    expect(rotaDayRefusal(s, islington, hours)).toBeNull()
    const changed = asGeneral(s, islington, hours)
    expect(changed.ok).toBe(true)
    // With no location named, the day is where they usually work that day.
    const unnamed = day(nia, '2026-10-12', { working: true, open: 600, close: 900 })
    expect(asGeneral(s, islington, unnamed).ok).toBe(true)
    const off = day(nia, '2026-10-14', { working: false })
    expect(asGeneral(s, islington, off).ok).toBe(true)
    // The change names who made it.
    const named = apply(s, hours, 'Gia General')
    expect(operations(named).rotaChanges!.at(-1)!.actor).toBe('Gia General')
    // And can be put back to usual.
    expect(asGeneral(named, islington, usual(nia, '2026-10-13')).ok).toBe(true)
  })

  it('never sends someone elsewhere, and never touches a day at another location', () => {
    const { s, main, islington, nia } = twoSites()
    const toMain = day(nia, '2026-10-13', {
      working: true,
      open: 600,
      close: 900,
      locationId: main,
    })
    expect(asGeneral(s, islington, toMain)).toEqual({
      ok: false,
      error:
        'You plan days at Islington only. Ask the owner or a manager to send Nia to another location.',
    })
    // Thursday is one of Nia's days at the main location.
    const thursday = day(nia, '2026-10-15', {
      working: true,
      open: 600,
      close: 900,
      locationId: islington,
    })
    const elsewhere =
      'Nia works at another location that day, so only the owner or a manager can change it.'
    expect(asGeneral(s, islington, thursday)).toEqual({ ok: false, error: elsewhere })
    expect(asGeneral(s, islington, day(nia, '2026-10-15', { working: false }))).toEqual({
      ok: false,
      error: elsewhere,
    })
    // Maya works at the main location only.
    expect(asGeneral(s, islington, day('staff-maya', '2026-10-13'))).toEqual({
      ok: false,
      error:
        'Maya is not on the team at Islington. Ask the owner or a manager to change their day.',
    })
    // The main location's general manager has the other half of Nia's week.
    expect(asGeneral(s, main, thursday).ok).toBe(false)
    expect(
      asGeneral(s, main, day(nia, '2026-10-15', { working: true, open: 600, close: 900 })).ok,
    ).toBe(true)
    expect(asGeneral(s, main, day(nia, '2026-10-13', { working: false })).ok).toBe(false)
    // A day the owner moved to the main location is the main location's.
    const moved = apply(s, toMain)
    expect(asGeneral(moved, islington, usual(nia, '2026-10-13'))).toEqual({
      ok: false,
      error: elsewhere,
    })
    expect(mayPlanDay(moved, islington, nia, '2026-10-13')).toBe(false)
    expect(mayPlanDay(moved, main, nia, '2026-10-13')).toBe(true)
  })

  it('lets them change the hours of someone sent to them, but not take the day from their own location', () => {
    const { s, islington } = twoSites()
    // Wednesday is one of Maya's usual days at the main location; Saturday is not.
    const sent = apply(
      apply(
        s,
        day('staff-maya', '2026-10-14', {
          working: true,
          open: 600,
          close: 960,
          locationId: islington,
        }),
      ),
      day('staff-maya', '2026-10-17', {
        working: true,
        open: 600,
        close: 960,
        locationId: islington,
      }),
    )
    const shorter = day('staff-maya', '2026-10-14', {
      working: true,
      open: 600,
      close: 840,
      locationId: islington,
    })
    expect(asGeneral(sent, islington, shorter).ok).toBe(true)
    expect(asGeneral(sent, islington, day('staff-maya', '2026-10-14', { working: false }))).toEqual(
      {
        ok: false,
        error:
          'Maya usually works at another location that day, so only the owner or a manager can give them the day off.',
      },
    )
    expect(asGeneral(sent, islington, usual('staff-maya', '2026-10-14'))).toEqual({
      ok: false,
      error:
        'Back to usual would have Maya working at another location that day, so only the owner or a manager can put it back.',
    })
    // An extra day at Islington on a day Maya does not usually work can be put back.
    expect(asGeneral(sent, islington, usual('staff-maya', '2026-10-17')).ok).toBe(true)
  })

  it('copies and clears a week for their team at their location only', () => {
    const { s, main, islington, nia } = twoSites()
    let week = apply(
      s,
      day(nia, '2026-10-07', { working: true, open: 600, close: 900, locationId: islington }),
    )
    week = apply(week, day('staff-sophia', '2026-10-07', { working: true, open: 600, close: 900 }))
    week = apply(
      week,
      day(nia, '2026-10-08', { working: true, open: 600, close: 900, locationId: main }),
    )
    // The sample's own changes are Maya's Friday and Saturday at the main location.
    const mine = weekCopy(week, '2026-10-12', today, islington)
    expect(mine.copies.map((c) => [c.from.staffId, c.date])).toEqual([[nia, '2026-10-14']])
    expect(mine.skipped).toEqual([])
    expect(weekCopy(week, '2026-10-12', today).copies).toHaveLength(5)
    // On the server the location is always named, and must be theirs.
    const copy = { type: 'rota-week-copy', monday: '2026-10-12' } as Command
    expect(asGeneral(week, islington, copy)).toEqual({
      ok: false,
      error: 'Copy and clear weeks at your own location only.',
    })
    expect(asGeneral(week, islington, { ...copy, locationId: main } as Command).ok).toBe(false)
    const copied = asGeneral(week, islington, { ...copy, locationId: islington } as Command)
    expect(copied.ok).toBe(true)
    const after = copied.ok ? copied.state : week
    const added = operations(after).rotaChanges!.filter((c) => c.date >= '2026-10-12')
    expect(added.map((c) => [c.staffId, c.date])).toEqual([[nia, '2026-10-14']])
    // The owner copies the rest; the general manager clears only their own.
    const all = apply(after, { type: 'rota-week-copy', monday: '2026-10-12' } as Command)
    expect(weekStillToCome(all, '2026-10-12', today, islington).map((c) => c.staffId)).toEqual([
      nia,
    ])
    const clear = {
      type: 'rota-week-clear',
      monday: '2026-10-12',
      locationId: islington,
    } as Command
    const cleared = asGeneral(all, islington, clear)
    expect(cleared.ok).toBe(true)
    const left = operations(cleared.ok ? cleared.state : all).rotaChanges!.filter(
      (c) => !c.ended && c.date >= '2026-10-12',
    )
    expect(left.map((c) => c.staffId).sort()).toEqual(
      ['staff-maya', 'staff-maya', 'staff-sophia', nia].sort(),
    )
    // The owner's day for Nia at the main location stays (the main location is left unnamed).
    expect(left.find((c) => c.staffId === nia)!.locationId).toBeUndefined()
  })

  it('previews their limits on the screen as the server checks them', () => {
    const { s, main, islington, nia } = twoSites()
    const toMain = day(nia, '2026-10-13', {
      working: true,
      open: 600,
      close: 900,
      locationId: main,
    })
    expect(rotaPreview(s, toMain, now, islington).error).toMatch(/^You plan days at Islington/)
    expect(rotaPreview(s, toMain, now).error).toBeNull()
    expect(
      rotaPreview(s, { type: 'rota-week-clear', monday: '2026-10-05' }, now, islington).error,
    ).toBe('Copy and clear weeks at your own location only.')
  })
})

describe('a general manager changing time off', () => {
  it('adds, changes and cancels time off on their own location’s days', () => {
    const { s, islington, nia } = twoSites()
    // Monday 12 to Wednesday 14 October are Nia's Islington days.
    const added = asGeneral(s, islington, away(nia, '2026-10-12', '2026-10-14'))
    expect(added.ok).toBe(true)
    const withAway = apply(s, away(nia, '2026-10-12', '2026-10-14'), 'Gia General')
    const record = operations(withAway).timeOff!.at(-1)!
    expect(record.actor).toBe('Gia General')
    const change = {
      type: 'time-off-change',
      timeOffId: record.id,
      input: { from: '2026-10-12', to: '2026-10-13', kind: 'sick', note: 'Flu' },
    } as Command
    expect(asGeneral(withAway, islington, change).ok).toBe(true)
    const changed = apply(withAway, change, 'Gia General')
    const list = operations(changed).timeOff!
    const old = list.find((t) => t.id === record.id)!
    const next = list.find((t) => t.changedFrom === record.id)!
    expect(old).toMatchObject({ cancelledBy: 'Gia General', changedTo: next.id })
    expect(next).toMatchObject({
      staffId: nia,
      from: '2026-10-12',
      to: '2026-10-13',
      kind: 'sick',
      note: 'Flu',
      actor: 'Gia General',
    })
    expect(() => parseState(changed, 'UK')).not.toThrow()
    expect(changeDetail(withAway, changed, 'time-off-change', next.id)).toEqual({
      fields: [
        { f: 'lastDay', from: '2026-10-14', to: '2026-10-13' },
        { f: 'timeOffKind', from: 'Holiday', to: 'Sick' },
        { f: 'note' },
      ],
    })
    expect(
      asGeneral(changed, islington, { type: 'cancel-time-off', timeOffId: next.id } as Command).ok,
    ).toBe(true)
  })

  it('refuses time off that covers a day at another location, or someone not on their team', () => {
    const { s, islington, nia } = twoSites()
    expect(asGeneral(s, islington, away(nia, '2026-10-12', '2026-10-15'))).toEqual({
      ok: false,
      error:
        'Nia works at another location on Thursday 15 October. Time off that covers a day at another location is for the owner or a manager.',
    })
    expect(asGeneral(s, islington, away('staff-maya', '2026-10-12', '2026-10-12'))).toEqual({
      ok: false,
      error:
        'Maya is not on the team at Islington on Monday 12 October. Ask the owner or a manager.',
    })
    // Sophia's holiday, changed by the owner in the sample, is the main location's.
    const sophia = operations(s).timeOff!.find(
      (t) => t.staffId === 'staff-sophia' && !t.cancelledAt,
    )!
    expect(
      asGeneral(s, islington, { type: 'cancel-time-off', timeOffId: sophia.id } as Command).ok,
    ).toBe(false)
    expect(
      asGeneral(s, islington, {
        type: 'time-off-change',
        timeOffId: sophia.id,
        input: { from: sophia.from, to: sophia.to, kind: 'other' },
      } as Command).ok,
    ).toBe(false)
    // Changing their own time off onto a day elsewhere is refused too.
    const withAway = apply(s, away(nia, '2026-10-12', '2026-10-13'))
    const record = operations(withAway).timeOff!.at(-1)!
    expect(
      asGeneral(withAway, islington, {
        type: 'time-off-change',
        timeOffId: record.id,
        input: { from: '2026-10-12', to: '2026-10-16', kind: 'holiday' },
      } as Command).ok,
    ).toBe(false)
    // Someone sent to them for a day they do not usually work can be away that day only.
    const sent = apply(
      s,
      day('staff-maya', '2026-10-17', {
        working: true,
        open: 600,
        close: 960,
        locationId: islington,
      }),
    )
    expect(
      timeOffRefusal(sent, islington, {
        staffId: 'staff-maya',
        from: '2026-10-17',
        to: '2026-10-17',
      }),
    ).toBeNull()
    expect(
      timeOffRefusal(sent, islington, {
        staffId: 'staff-maya',
        from: '2026-10-16',
        to: '2026-10-17',
      }),
    ).toMatch(/^Maya is not on the team at Islington on Friday 16 October/)
  })

  it('keeps changed time off whole in the ledger', () => {
    const { s, nia } = twoSites()
    const withAway = apply(s, away(nia, '2026-10-12', '2026-10-13'))
    const record = operations(withAway).timeOff!.at(-1)!
    const change = (input: Record<string, unknown>) =>
      run(withAway, { type: 'time-off-change', timeOffId: record.id, input } as Command)
    expect(change({ from: '2026-10-12', to: '2026-10-13', kind: 'holiday' })).toMatchObject({
      ok: false,
      error: 'Nothing has changed.',
    })
    expect(
      run(s, {
        type: 'time-off-change',
        timeOffId: 'missing',
        input: { from: '2026-10-12', to: '2026-10-13', kind: 'holiday' },
      } as Command),
    ).toMatchObject({ ok: false, error: 'Time off not found.' })
    // A change may overlap the days it replaces, but not other time off.
    expect(change({ from: '2026-10-12', to: '2026-10-14', kind: 'holiday' }).ok).toBe(true)
    const twice = apply(withAway, away(nia, '2026-10-19', '2026-10-19'))
    expect(
      run(twice, {
        type: 'time-off-change',
        timeOffId: record.id,
        input: { from: '2026-10-12', to: '2026-10-19', kind: 'holiday' },
      } as Command),
    ).toMatchObject({ ok: false, error: 'This overlaps time off already recorded for them.' })
    const done = apply(withAway, {
      type: 'time-off-change',
      timeOffId: record.id,
      input: { from: '2026-10-13', to: '2026-10-13', kind: 'holiday' },
    } as Command)
    expect(
      run(done, {
        type: 'time-off-change',
        timeOffId: record.id,
        input: { from: '2026-10-12', to: '2026-10-12', kind: 'holiday' },
      } as Command),
    ).toMatchObject({
      ok: false,
      error: 'This time off has already been changed. Change the newer one instead.',
    })
    // A broken link between the two records is refused.
    const broken = structuredClone(done)
    broken.operations!.timeOff!.at(-1)!.changedFrom = 'missing'
    expect(timeOffProblem(broken)).toBe('Invalid changed time off.')
    expect(() => parseState(broken, 'UK')).toThrow('Invalid changed time off.')
    const open = structuredClone(done)
    delete open.operations!.timeOff!.find((t) => t.id === record.id)!.cancelledAt
    expect(timeOffProblem(open)).toBe('Invalid changed time off.')
  })
})

describe('a general manager looking after rooms', () => {
  it('adds, renames and archives rooms at their location only', () => {
    const { s, main, islington, room } = twoSites()
    const add = (locationId?: string) =>
      ({
        type: 'resource',
        input: { name: 'Second room', type: 'treatment', ...(locationId ? { locationId } : {}) },
      }) as Extract<Command, { type: 'resource' }>
    expect(asGeneral(s, islington, add(islington)).ok).toBe(true)
    expect(asGeneral(s, islington, add())).toEqual({
      ok: false,
      error: 'Add rooms and chairs at Islington only.',
    })
    expect(asGeneral(s, islington, add(main)).ok).toBe(false)
    const rename = {
      type: 'resource',
      id: room,
      input: { name: 'The quiet room', type: 'treatment', locationId: islington, restMinutes: 15 },
    } as Extract<Command, { type: 'resource' }>
    expect(asGeneral(s, islington, rename).ok).toBe(true)
    expect(
      asGeneral(s, islington, { ...rename, input: { ...rename.input, archived: true } }).ok,
    ).toBe(true)
    expect(
      asGeneral(s, islington, { ...rename, input: { ...rename.input, locationId: main } }),
    ).toEqual({
      ok: false,
      error: 'Rooms and chairs stay at their location. Ask the owner or a manager to move one.',
    })
    const mainRoom = {
      type: 'resource',
      id: 'room-one',
      input: { name: 'Renamed', type: 'treatment' },
    } as Extract<Command, { type: 'resource' }>
    expect(roomRefusal(s, islington, mainRoom)).toBe('That room or chair is at another location.')
    expect(roomRefusal(s, main, mainRoom)).toBeNull()
  })
})

describe('after the change, every touched day, time off and room is checked again', () => {
  it('refuses anything that changed at another location', () => {
    const { s, main, islington } = twoSites()
    const rota = apply(s, day('staff-maya', '2026-10-13'))
    expect(teamChangeRefusal(s, rota, islington)).toBe(
      'That would change a day on the rota at another location.',
    )
    expect(teamChangeRefusal(s, rota, main)).toBeNull()
    const time = apply(s, away('staff-maya', '2026-10-13', '2026-10-13'))
    expect(branchChangeRefusal(s, time, islington)).toBe(
      'That would change time off at another location.',
    )
    const room = apply(s, {
      type: 'resource',
      id: 'room-one',
      input: { name: 'Renamed room', type: 'treatment' },
    } as Command)
    expect(branchChangeRefusal(s, room, islington)).toBe(
      'That would change a room at another location.',
    )
  })
})

describe('what a general manager reads (branchView)', () => {
  it('carries no other location’s team, hours, time off or rooms', () => {
    const sites = twoSites()
    const { islington, nia, room } = sites
    const s = apply(sites.s, { type: 'leave-allowance', staffId: nia, days: 25 } as Command)
    const view = branchView(s, islington, today)
    expect(() => parseState(structuredClone(view), 'UK')).not.toThrow()
    for (const id of ['staff-maya', 'staff-sophia', 'staff-theo']) {
      const person = view.staff.find((p) => p.id === id)!
      // Only the name the visits and records show, archived so no screen offers them.
      expect(person).toMatchObject({ archived: true, serviceIds: [] })
      expect(person.hours!.every((h) => h.closed)).toBe(true)
    }
    const o = operations(view)
    expect(o.timeOff!.map((t) => t.staffId)).toEqual([])
    expect(o.leaveAllowances!.map((a) => a.staffId)).toEqual([nia])
    expect(o.rotaChanges).toEqual([])
    expect(view.resources.filter((r) => !r.archived).map((r) => r.id)).toEqual([room])
    expect(view.resources.find((r) => r.id === 'room-two')).not.toHaveProperty('forTwo')
    // Nia's days at the main location carry the place only, never the times.
    const niaHours = view.staff.find((p) => p.id === nia)!.hours!
    expect(niaHours.filter((h) => h.locationId === islington).map((h) => h.day)).toEqual([1, 2, 3])
    for (const h of niaHours.filter((x) => x.locationId !== islington))
      expect([h.open, h.close]).toEqual([0, 1440])
    // The studio's own record is untouched.
    expect(operations(s).timeOff!.length).toBeGreaterThan(0)
    expect(s.staff.find((p) => p.id === 'staff-maya')!.archived).toBeUndefined()
  })

  it('keeps someone sent to them for those days only, without their hours elsewhere', () => {
    const { s, main, islington } = twoSites()
    let sent = apply(
      s,
      day('staff-maya', '2026-10-14', {
        working: true,
        open: 600,
        close: 960,
        locationId: islington,
      }),
    )
    sent = apply(sent, away('staff-theo', '2026-10-13', '2026-10-13'))
    const view = branchView(sent, islington, today)
    const maya = view.staff.find((p) => p.id === 'staff-maya')!
    expect(maya.archived).toBeUndefined()
    expect(maya.hours!.every((h) => h.open === 0 && h.close === 1440)).toBe(true)
    // Her day at Islington, but not the sample's Friday and Saturday at the main location.
    expect(operations(view).rotaChanges!.map((c) => c.date)).toEqual(['2026-10-14'])
    expect(operations(view).timeOff!.map((t) => t.staffId)).toEqual([])
    // The main location's general manager sees the main team whole, and Islington only as names.
    const home = branchView(sent, main, today)
    expect(home.staff.find((p) => p.id === 'staff-maya')!.hours).toEqual(
      sent.staff.find((p) => p.id === 'staff-maya')!.hours,
    )
    expect(operations(home).timeOff!.some((t) => t.staffId === 'staff-theo')).toBe(true)
    expect(home.resources.find((r) => r.name === 'Islington room')!.archived).toBe(true)
  })

  it('reads every rule the same on the view as on the whole record', () => {
    const { s, main, islington, nia } = twoSites()
    let full = apply(
      s,
      day('staff-maya', '2026-10-14', {
        working: true,
        open: 600,
        close: 960,
        locationId: islington,
      }),
    )
    full = apply(
      full,
      day('staff-maya', '2026-10-17', {
        working: true,
        open: 600,
        close: 960,
        locationId: islington,
      }),
    )
    full = apply(
      full,
      day(nia, '2026-10-13', { working: true, open: 600, close: 900, locationId: main }),
    )
    full = apply(
      full,
      day(nia, '2026-10-16', { working: true, open: 600, close: 900, locationId: islington }),
    )
    full = apply(full, day(nia, '2026-10-12', { working: false }))
    full = apply(full, away('staff-theo', '2026-10-15', '2026-10-15'))
    const people = ['staff-maya', 'staff-sophia', 'staff-theo', nia]
    for (const here of [islington, main]) {
      const view = branchView(full, here, today)
      expect(() => parseState(structuredClone(view), 'UK')).not.toThrow()
      for (let i = 0; i < 14; i += 1) {
        const date = addDays('2026-10-12', i)
        for (const staffId of people) {
          for (const command of [
            day(staffId, date, { working: true, open: 600, close: 900, locationId: here }),
            day(staffId, date, { working: false }),
            usual(staffId, date),
          ])
            expect(rotaDayRefusal(view, here, command), `${staffId} ${date}`).toBe(
              rotaDayRefusal(full, here, command),
            )
          expect(timeOffRefusal(view, here, { staffId, from: date, to: addDays(date, 2) })).toBe(
            timeOffRefusal(full, here, { staffId, from: date, to: addDays(date, 2) }),
          )
        }
      }
      expect(weekStillToCome(view, '2026-10-12', today, here)).toEqual(
        weekStillToCome(full, '2026-10-12', today, here),
      )
      for (const monday of ['2026-10-12', '2026-10-19'])
        expect(weekTeam(view, here, monday).map((p) => p.id)).toEqual(
          weekTeam(full, here, monday).map((p) => p.id),
        )
      for (const staffId of people)
        for (let i = 0; i < 14; i += 1)
          expect(mayPlanDay(view, here, staffId, addDays('2026-10-12', i))).toBe(
            mayPlanDay(full, here, staffId, addDays('2026-10-12', i)),
          )
    }
  })
})

describe('permissions', () => {
  it('widens a general manager by the rota and rooms only', () => {
    expect(GENERAL_ACTIONS.slice(-2)).toEqual(['rota', 'rooms'])
    for (const type of ['rota-day', 'rota-day-usual', 'rota-week-copy', 'rota-week-clear']) {
      expect(permissionFor({ type })).toBe('rota')
    }
    for (const type of ['time-off', 'cancel-time-off', 'time-off-change'])
      expect(permissionFor({ type })).toBe('rota')
    expect(permissionFor({ type: 'resource' })).toBe('rooms')
    // Opening hours, closures, holiday allowances, the team's records and treatments stay with
    // the owner and managers.
    for (const type of [
      'hours',
      'closure',
      'remove-closure',
      'leave-allowance',
      'staff',
      'service',
      'location',
    ])
      expect(can('general', permissionFor({ type })), type).toBe(false)
    for (const role of ['owner', 'manager', 'general'] as Role[])
      for (const action of ['rota', 'rooms']) expect(can(role, action)).toBe(true)
    for (const role of ['reception', 'practitioner', 'regional'] as Role[])
      for (const action of ['rota', 'rooms']) expect(can(role, action), role).toBe(false)
    // Everything a general manager could do before is unchanged (V5, as on the Stage 3 base),
    // with passing on a gift card from Stage 4.
    expect(GENERAL_ACTIONS).toEqual([
      ...['read', 'clock', 'book', 'reschedule', 'cancel', 'no-show', 'arrive', 'checkout'],
      ...['deposit', 'fee', 'refund', 'note', 'client', 'client-edit', 'client-birthday'],
      ...['client-area', 'consent', 'contact-preferences', 'consultation', 'patch-test'],
      ...['patch-test-result', 'message', 'message.queue', 'gift-card-sell'],
      // Stage 4: passing on a gift card that belongs to their location (the server checks where).
      'gift-card-move',
      'plan-sell',
      ...['plan-renew', 'plan-card', 'balance-settle', 'task', 'missed-call', 'waitlist-add'],
      ...['waitlist-offer', 'waitlist-remove', 'counter-sale', 'stock', 'purchase-order'],
      ...['receive-order', 'cancel-order', 'branch-visit', 'branch-visit-fix', 'request-raise'],
      'rota',
      'rooms',
    ])
  })
})
