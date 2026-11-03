import { describe, expect, it } from 'vitest'
import { availableResource, dispatch, execute, slots } from './commands'
import type { Command } from './commands'
import type { BusinessState } from './model'
import { parseState } from './model'
import { can, operations, permissionFor, staffHoursFor, usualHoursFor } from './operations'
import type { Role } from './operations'
import { createWorkspace } from './workspace'
import { seed } from './seed'
import { availableMinutes, report } from './selectors'
import { staffLocationOn, staffPlaces } from './locations'
import { coverPlan } from './cover'
import { practitionerRefusal, practitionerView } from './practitioner'
import { areaRefusal } from './area'
import { branchRefusal } from './branch'
import { moveSampleDay } from './sampleDay'
import { changeDetail, describeChange, recordNames } from './changeRecord'
import { outsideVisits, rotaWeek } from './rota'
import {
  comingMove,
  moveDestinations,
  moveWords,
  staffMovePreview,
  staffMoves,
  staffMovesProblem,
  usualSites,
  weekdaysWords,
} from './staffMoves'
import type { StaffMoveCommand } from './staffMoves'

// Stage 4: moving someone to another location from a date.
const now = '2026-10-06T08:00:00.000Z' // Tuesday 6 October, 09:00 in London.
const today = '2026-10-06'
const monday = '2026-10-12' // The move starts here.
let sequence = 0
/** A real studio with the sample team, a second location (Shoreditch) and a room there. */
function studio(): { s: BusinessState; main: string; shoreditch: string } {
  let s = createWorkspace({ name: 'Moves studio', region: 'UK', locationName: 'Marylebone' })
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
  return execute(s, command, at, () => `move-test-${++sequence}`)
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
const move = (to: string, input: Record<string, unknown> = {}, keepBooked?: true) =>
  ({
    type: 'staff-move',
    input: { staffId: 'staff-maya', date: monday, to, ...input },
    ...(keepBooked ? { keepBooked } : {}),
  }) as StaffMoveCommand
const facial = (date: string, startMinutes: number, locationId?: string) =>
  ({
    type: 'book',
    input: {
      serviceId: 'service-facial',
      staffId: 'staff-maya',
      date,
      startMinutes,
      clientId: 'client-1',
      source: 'desk',
      ...(locationId ? { locationId } : {}),
    },
  }) as Command

describe('moving someone to another location from a date', () => {
  it('keeps their days and hours, and answers where they work before and after the date', () => {
    const { s: before, main, shoreditch } = studio()
    const s = apply(before, move(shoreditch, { note: 'Leading the new team' }))
    const [made] = staffMoves(s)
    expect(made).toMatchObject({
      staffId: 'staff-maya',
      date: monday,
      to: shoreditch,
      note: 'Leading the new team',
      createdAt: now,
    })
    // Maya works Monday to Friday; every weekday, worked or not, was at the main location.
    expect(made.days.map((d) => d.from)).toEqual(Array(7).fill(main))
    for (const date of ['2026-10-05', today, '2026-10-09', '2026-10-11'])
      expect(staffLocationOn(s, 'staff-maya', date), date).toBe(main)
    for (const date of [monday, '2026-10-16', '2026-11-30', '2027-06-01'])
      expect(staffLocationOn(s, 'staff-maya', date), date).toBe(shoreditch)
    // Her hours are exactly as they were, before and after.
    for (const date of ['2026-10-09', monday, '2026-10-17']) {
      const { locationId: _a, ...was } = usualHoursFor(before, 'staff-maya', date)
      const { locationId: _b, ...is } = usualHoursFor(s, 'staff-maya', date)
      void [_a, _b]
      expect(is, date).toEqual(was)
      expect(staffHoursFor(s, 'staff-maya', date).closed).toBe(
        staffHoursFor(before, 'staff-maya', date).closed,
      )
    }
    // Her weekly hours now hold where she works from the move on.
    expect(s.staff.find((p) => p.id === 'staff-maya')!.hours!.every((h) => h.locationId)).toBe(true)
    // Nobody else moved.
    expect(s.staff.filter((p) => p.id !== 'staff-maya')).toEqual(
      before.staff.filter((p) => p.id !== 'staff-maya'),
    )
    // She works at both this week and from the move, so both places offer her for now.
    expect(staffPlaces(s, 'staff-maya', now)).toEqual([main, shoreditch])
    expect(staffPlaces(s, 'staff-maya', '2026-10-12T08:00:00.000Z')).toEqual([shoreditch])
    expect(comingMove(s, 'staff-maya', today)?.id).toBe(made.id)
    expect(moveWords(s, made, today)).toBe(
      'Moves from Marylebone to Shoreditch on Monday 12 October',
    )
    expect(moveWords(s, made, monday)).toBe(
      'Moved from Marylebone to Shoreditch on Monday 12 October',
    )
  })

  it('is followed by booking, availability, figures and cover plans on each side of the date', () => {
    const { s: before, main, shoreditch } = studio()
    const s = apply(before, move(shoreditch))
    const thursday = '2026-10-08'
    const nextThursday = '2026-10-15'
    // Before the move she is booked at the main location only; from it, at Shoreditch only.
    const room = (date: string, place: string) =>
      availableResource(s, 'service-facial', 'staff-maya', date, 600, now, undefined, place)
    expect(room(thursday, main)).toBeTruthy()
    expect(room(thursday, shoreditch)).toBeNull()
    expect(room(nextThursday, shoreditch)).toBe(
      s.resources.find((r) => r.name === 'Shoreditch room')!.id,
    )
    expect(room(nextThursday, main)).toBeNull()
    expect(slots(s, 'service-facial', 'staff-maya', nextThursday, now, main)).toEqual([])
    expect(slots(s, 'service-facial', 'staff-maya', nextThursday, now, shoreditch)).toContain(600)
    // A desk booking with no location lands where she works that day.
    const booked = apply(s, facial(nextThursday, 600))
    expect(booked.appointments.at(-1)!.locationId).toBe(shoreditch)
    expect(apply(s, facial(thursday, 600)).appointments.at(-1)!.locationId).toBe(main)
    // Open time counts at each location on its own side of the date; past days are unchanged.
    expect(availableMinutes(s, '2026-10-05', main)).toBe(
      availableMinutes(before, '2026-10-05', main),
    )
    expect(availableMinutes(s, thursday, main)).toBe(availableMinutes(before, thursday, main))
    expect(availableMinutes(s, nextThursday, main)).toBeLessThan(
      availableMinutes(before, nextThursday, main),
    )
    expect(availableMinutes(s, nextThursday, shoreditch)).toBe(
      availableMinutes(before, nextThursday, main) - availableMinutes(s, nextThursday, main),
    )
    // Takings and visits already reported stay exactly where they were.
    // (The figures name each person, whose weekly hours now hold the move, so compare by id.)
    const figures = (state: BusinessState) => {
      const r = report(state, 30, main)
      return { ...r, byStaff: r.byStaff.map(({ staff, ...rest }) => ({ id: staff.id, ...rest })) }
    }
    expect(figures(s)).toEqual(figures(before))
    // A cover plan for her day after the move looks for cover at Shoreditch.
    const withVisit = apply(booked, {
      type: 'staff',
      input: {
        name: 'Nia Fictional',
        role: 'Facialist',
        serviceIds: ['service-facial'],
        tone: 'sage',
        hours: operations(booked).hours.map((h) => ({ ...h, locationId: shoreditch })),
      },
    } as Command)
    const plan = coverPlan(withVisit, 'staff-maya', nextThursday, now)
    expect(plan.moves.map((m) => withVisit.staff.find((p) => p.id === m.toStaffId)?.name)).toEqual([
      'Nia Fictional',
    ])
  })

  it('names booked visits left at the old location, and keeps them only when asked', () => {
    const { s: start, main, shoreditch } = studio()
    let s = apply(start, facial('2026-10-09', 600)) // Before the move: stays as it is.
    s = apply(s, facial('2026-10-13', 600))
    s = apply(s, facial('2026-10-20', 660))
    const later = s.appointments.slice(-2)
    expect(later.every((a) => a.locationId === main)).toBe(true)
    expect(refusal(s, move(shoreditch))).toBe(
      'Two booked visits with Maya would be at a location where they no longer work: Tue 13 Oct 10:00, Amelia, Skin Renewal Facial; Tue 20 Oct 11:00, Amelia, Skin Renewal Facial. Move them first, or choose to keep them booked as they are.'.replace(
        'Two',
        '2',
      ),
    )
    const preview = staffMovePreview(s, move(shoreditch), now)
    expect(preview.error).toBeNull()
    expect(preview.affected.map((v) => v.appointmentId)).toEqual(later.map((a) => a.id))
    const kept = apply(s, move(shoreditch, {}, true))
    // Nothing is moved, cancelled or messaged.
    expect(kept.appointments).toEqual(s.appointments)
    expect(operations(kept).messages).toEqual(operations(s).messages)
    expect(staffMoves(kept)[0].kept).toEqual(later.map((a) => a.id))
    // The rota warns on those days until they are moved.
    expect(outsideVisits(kept, 'staff-maya', '2026-10-13', now).map((a) => a.id)).toEqual([
      later[0].id,
    ])
    const week = rotaWeek(kept, monday, now).find((row) => row.person.id === 'staff-maya')!
    expect(week.days[1]).toMatchObject({ state: 'working', locationId: shoreditch })
    expect('outside' in week.days[1] && week.days[1].outside.map((a) => a.id)).toEqual([
      later[0].id,
    ])
  })

  it('says which of their treatments the new location does not offer, and refuses one with none', () => {
    const { s: start, shoreditch } = studio()
    const offer = (ids: string[]) => ({
      ...start,
      services: start.services.map((x) =>
        ids.includes(x.id) ? { ...x, notOfferedAt: [shoreditch] } : x,
      ),
    })
    const some = offer(['service-facial'])
    expect(staffMovePreview(some, move(shoreditch), now).notOffered).toEqual([
      'Skin Renewal Facial',
    ])
    expect(run(some, move(shoreditch)).ok).toBe(true)
    const none = offer(['service-facial', 'service-restore'])
    expect(refusal(none, move(shoreditch))).toBe(
      "Shoreditch does not offer any of Maya's treatments. Choose another location.",
    )
  })

  it('lists days already changed on the rota, which keep sending them to the old location', () => {
    const { s: start, main, shoreditch } = studio()
    const s = apply(start, {
      type: 'rota-day',
      input: { staffId: 'staff-maya', date: '2026-10-16', working: true, open: 540, close: 900 },
    })
    const changed = operations(s).rotaChanges![0]
    expect(staffMovePreview(s, move(shoreditch), now).rotaDays.map((c) => c.id)).toEqual([
      changed.id,
    ])
    const moved = apply(s, move(shoreditch))
    expect(staffMoves(moved)[0].rotaKept).toEqual([changed.id])
    // That Friday stays as changed, at the main location; the Thursday before it has moved.
    expect(staffLocationOn(moved, 'staff-maya', '2026-10-16')).toBe(main)
    expect(staffLocationOn(moved, 'staff-maya', '2026-10-15')).toBe(shoreditch)
    expect(operations(moved).rotaChanges).toEqual(operations(s).rotaChanges)
  })

  it('shows their week at the new location, and the days it is closed', () => {
    const { s: start, shoreditch } = studio()
    // Shoreditch keeps its own hours: closed on Mondays and open 10:00 to 19:00 otherwise.
    const s = apply(start, {
      type: 'location',
      id: shoreditch,
      input: {
        name: 'Shoreditch',
        address: '1 Curtain Road, London',
        hours: operations(start).hours.map((h) =>
          h.day === 1 ? { ...h, closed: true } : { ...h, open: 600, close: 1140 },
        ),
      },
    } as Command)
    const { week } = staffMovePreview(s, move(shoreditch), now)
    expect(week.map((d) => d.day)).toEqual([1, 2, 3, 4, 5, 6, 0])
    expect(week[0]).toEqual({ day: 1, working: false, locationId: shoreditch, closed: true })
    expect(week[1]).toEqual({
      day: 2,
      working: true,
      open: 600,
      close: 1080,
      locationId: shoreditch,
    })
    // Saturday is not one of her days, so it is simply not worked.
    expect(week[5]).toEqual({ day: 6, working: false, locationId: shoreditch })
  })

  it('refuses what cannot be a move, in plain words', () => {
    const { s, main, shoreditch } = studio()
    expect(refusal(s, move(shoreditch, { date: '2026-10-05' }))).toBe(
      'That day has passed. Days before a move stay where they were.',
    )
    expect(refusal(s, move(shoreditch, { date: '2027-10-08' }))).toBe(
      'Move someone up to a year ahead.',
    )
    expect(refusal(s, move('nowhere'))).toBe('Choose an open location.')
    expect(refusal(s, move(main))).toBe(
      'Maya already works at Marylebone every day of their usual week.',
    )
    expect(refusal(s, move(shoreditch, { staffId: 'nobody' }))).toBe('Choose someone on the team.')
    expect(refusal(s, move(shoreditch, { from: shoreditch }))).toBe(
      'Choose a different location to move them to.',
    )
    const elsewhere = apply(s, {
      type: 'location',
      input: { name: 'Islington', address: '1 Upper Street' },
    } as Command)
    const islington = operations(elsewhere).locations![1].id
    expect(refusal(elsewhere, move(shoreditch, { from: islington }))).toBe(
      'Maya does not work at Islington in their usual week.',
    )
    const closed = apply(elsewhere, {
      type: 'location',
      id: islington,
      input: { name: 'Islington', address: '1 Upper Street', archived: true },
    } as Command)
    expect(refusal(closed, move(islington))).toBe('Choose an open location.')
    // One move at a time: a second one must start after a move already planned.
    const moved = apply(s, move(shoreditch))
    expect(refusal(moved, move(main, { date: '2026-10-09' }))).toBe(
      'Maya already moves to Shoreditch on Monday 12 October. Choose a day after that, or cancel that move first.',
    )
    expect(refusal(moved, move(shoreditch))).toMatch(/^Maya already moves to Shoreditch/)
    expect(() => parseState(structuredClone(moved), 'UK')).not.toThrow()
  })

  it('moves only the days at the chosen location for someone who works at two', () => {
    const { s: start, main, shoreditch } = studio()
    let s = apply(start, {
      type: 'location',
      input: { name: 'Islington', address: '1 Upper Street' },
    } as Command)
    const islington = operations(s).locations![1].id
    const theo = s.staff.find((p) => p.id === 'staff-theo')!
    // Theo works Tuesday and Wednesday in Islington, Thursday to Saturday at the main location.
    s = apply(s, {
      type: 'staff',
      id: theo.id,
      input: {
        name: theo.name,
        role: theo.role,
        serviceIds: theo.serviceIds,
        tone: theo.tone,
        hours: theo.hours!.map((h) =>
          h.day === 2 || h.day === 3 ? { ...h, locationId: islington } : h,
        ),
      },
    } as Command)
    expect(usualSites(s, theo.id)).toEqual([
      { locationId: islington, days: [2, 3] },
      { locationId: main, days: [4, 5, 6] },
    ])
    expect(moveDestinations(s, theo.id).map((p) => p.name)).toEqual([
      'Marylebone',
      'Shoreditch',
      'Islington',
    ])
    const moved = apply(s, {
      type: 'staff-move',
      input: { staffId: theo.id, date: monday, to: shoreditch, from: main },
    })
    expect(staffMoves(moved)[0].days.map((d) => d.day)).toEqual([0, 1, 4, 5, 6])
    const where = (state: BusinessState, date: string) => staffLocationOn(state, theo.id, date)
    expect([where(moved, '2026-10-13'), where(moved, '2026-10-15')]).toEqual([
      islington,
      shoreditch,
    ])
    expect([where(moved, '2026-10-06'), where(moved, '2026-10-08')]).toEqual([islington, main])
    // This week is as it was; the weekly hours already hold the move.
    expect(usualSites(moved, theo.id, today)).toEqual(usualSites(s, theo.id))
    expect(usualSites(moved, theo.id, monday)).toEqual(usualSites(moved, theo.id))
    expect(usualSites(moved, theo.id)).toEqual([
      { locationId: islington, days: [2, 3] },
      { locationId: shoreditch, days: [4, 5, 6] },
    ])
    // Without a choice, every day not already there moves.
    const all = apply(s, {
      type: 'staff-move',
      input: { staffId: theo.id, date: monday, to: shoreditch },
    })
    expect([where(all, '2026-10-13'), where(all, '2026-10-15')]).toEqual([shoreditch, shoreditch])
    expect([where(all, '2026-10-06'), where(all, '2026-10-08')]).toEqual([islington, main])
  })

  it('gives someone who followed the opening hours their own, and moves again later on', () => {
    const { s: start, main, shoreditch } = studio()
    const sophia = start.staff.find((p) => p.id === 'staff-sophia')!
    let s = apply(start, {
      type: 'staff',
      id: sophia.id,
      input: {
        name: sophia.name,
        role: sophia.role,
        serviceIds: sophia.serviceIds,
        tone: sophia.tone,
      },
    } as Command)
    expect(s.staff.find((p) => p.id === sophia.id)!.hours).toBeUndefined()
    s = apply(s, {
      type: 'staff-move',
      input: { staffId: sophia.id, date: monday, to: shoreditch },
    })
    expect(staffMoves(s)[0].madeOwnHours).toBe(true)
    expect(s.staff.find((p) => p.id === sophia.id)!.hours).toEqual(
      operations(s).hours.map((h) => ({ ...h, locationId: shoreditch })),
    )
    expect(staffLocationOn(s, sophia.id, '2026-10-08')).toBe(main)
    // And on to Islington from the 26th: each date answers with where she was then.
    s = apply(s, {
      type: 'location',
      input: { name: 'Islington', address: '1 Upper Street' },
    } as Command)
    const islington = operations(s).locations![1].id
    s = apply(s, {
      type: 'staff-move',
      input: { staffId: sophia.id, date: '2026-10-26', to: islington },
    })
    expect(
      ['2026-10-08', '2026-10-15', '2026-10-27'].map((d) => staffLocationOn(s, sophia.id, d)),
    ).toEqual([main, shoreditch, islington])
    // The earlier move cannot be cancelled while a later one stands.
    expect(refusal(s, { type: 'staff-move-cancel', moveId: staffMoves(s)[0].id })).toBe(
      'Sophia moves again later. Cancel that move first.',
    )
    s = apply(s, { type: 'staff-move-cancel', moveId: staffMoves(s)[1].id })
    s = apply(s, { type: 'staff-move-cancel', moveId: staffMoves(s)[0].id })
    // Back to following the opening hours, as before, and every date is at the main location.
    expect(s.staff.find((p) => p.id === sophia.id)!.hours).toBeUndefined()
    expect(['2026-10-08', '2026-10-27'].map((d) => staffLocationOn(s, sophia.id, d))).toEqual([
      main,
      main,
    ])
    expect(staffMoves(s).every((m) => m.cancelled)).toBe(true)
  })

  it('cancels a move still to come, and only one still to come', () => {
    const { s: start, main, shoreditch } = studio()
    const s = apply(start, move(shoreditch))
    const [made] = staffMoves(s)
    // Booked at Shoreditch after the date, the visit would be left behind by cancelling.
    const booked = apply(s, facial('2026-10-13', 600))
    expect(booked.appointments.at(-1)!.locationId).toBe(shoreditch)
    expect(refusal(booked, { type: 'staff-move-cancel', moveId: made.id })).toMatch(
      /^A booked visit with Maya would be at a location where they no longer work: Tue 13 Oct 10:00/,
    )
    const back = apply(booked, { type: 'staff-move-cancel', moveId: made.id, keepBooked: true })
    expect(staffMoves(back)[0].cancelled).toMatchObject({
      at: now,
      kept: [booked.appointments.at(-1)!.id],
    })
    expect(staffLocationOn(back, 'staff-maya', '2026-10-13')).toBe(main)
    expect(back.staff.find((p) => p.id === 'staff-maya')!.hours).toEqual(
      start.staff.find((p) => p.id === 'staff-maya')!.hours,
    )
    expect(back.appointments).toEqual(booked.appointments)
    expect(refusal(back, { type: 'staff-move-cancel', moveId: made.id })).toBe(
      'That move has already been cancelled.',
    )
    expect(refusal(back, { type: 'staff-move-cancel', moveId: 'nothing' })).toBe(
      'That move is not on record.',
    )
    // Once the day has come, a move stands; moving back is a new move.
    expect(
      refusal(s, { type: 'staff-move-cancel', moveId: made.id }, '2026-10-12T08:00:00.000Z'),
    ).toBe('Maya has already moved. To bring them back, move them again from a day still to come.')
    const again = apply(s, move(main, { date: '2026-10-19' }), '2026-10-12T08:00:00.000Z')
    expect(
      ['2026-10-09', '2026-10-13', '2026-10-20'].map((d) =>
        staffLocationOn(again, 'staff-maya', d),
      ),
    ).toEqual([main, shoreditch, main])
  })

  it('keeps a history of the weekly hours, and who did it', () => {
    const { s: start, shoreditch } = studio()
    const result = dispatch(start, move(shoreditch), 'Amara Owner', now)
    if (!result.ok) throw new Error(result.error)
    const [made] = staffMoves(result.state)
    expect(made.actor).toBe('Amara Owner')
    const entry = operations(result.state).scheduleHistory!.at(-1)!
    expect(entry).toMatchObject({
      kind: 'staff-hours',
      subjectId: 'staff-maya',
      actor: 'Amara Owner',
      summary:
        'Maya Lewis moves from Marylebone to Shoreditch on 12 October 2026: Monday to Friday.',
    })
    const cancelled = dispatch(
      result.state,
      { type: 'staff-move-cancel', moveId: made.id },
      'Bea Manager',
      now,
    )
    if (!cancelled.ok) throw new Error(cancelled.error)
    expect(staffMoves(cancelled.state)[0].cancelled).toEqual({ at: now, actor: 'Bea Manager' })
    // Who changed what: the day, from where to where, how many days moved.
    const detail = changeDetail(start, result.state, 'staff-move', made.id)
    expect(detail).toEqual({
      fields: [
        { f: 'date', to: monday },
        { f: 'locationId', from: start.organisation.locationId, to: shoreditch },
        { f: 'daysMoved', to: 7 },
      ],
    })
    const entryWords = describeChange(result.state, recordNames(result.state), {
      id: 'a',
      action: 'staff-move',
      recordId: made.id,
      occurredAt: Date.parse(now),
      actor: 'Amara Owner',
      account: null,
      detail: JSON.stringify(detail),
    })
    expect(entryWords).toMatchObject({
      what: 'Moved someone to another location',
      about: 'Maya Lewis',
      lines: [
        { what: 'date', to: '12 October 2026' },
        { what: 'location', from: 'Marylebone', to: 'Shoreditch' },
        { what: 'days of the week moved', to: '7' },
      ],
    })
    expect(changeDetail(result.state, cancelled.state, 'staff-move-cancel', made.id)).toEqual({
      fields: [
        { f: 'date', to: monday },
        { f: 'locationId', from: shoreditch, to: start.organisation.locationId },
      ],
    })
  })

  it('turns its weekdays with a sample studio moved onto another date', () => {
    const sample = seed('UK')
    const s = {
      ...sample,
      operations: {
        ...operations(sample),
        locations: [{ id: 'loc-east', name: 'Shoreditch', address: '1 Curtain Road' }],
        staffMoves: [
          {
            id: 'move-1',
            staffId: 'staff-maya',
            date: '2026-10-12',
            to: 'loc-east',
            days: [{ day: 1, from: sample.organisation.locationId }],
            createdAt: '2026-10-05T09:00:00.000Z',
            actor: 'Owner',
          },
        ],
      },
      staff: sample.staff.map((p) =>
        p.id === 'staff-maya'
          ? {
              ...p,
              hours: p.hours!.map((h) => (h.day === 1 ? { ...h, locationId: 'loc-east' } : h)),
            }
          : p,
      ),
    }
    // Two days on: Monday 12 becomes Wednesday 14 and keeps being the day Maya moved.
    const moved = moveSampleDay(parseState(s, 'UK'), '2026-10-08')
    expect(staffMoves(moved)[0]).toMatchObject({ date: '2026-10-14', days: [{ day: 3 }] })
    expect(staffLocationOn(moved, 'staff-maya', '2026-10-07')).toBe(sample.organisation.locationId)
    expect(staffLocationOn(moved, 'staff-maya', '2026-10-14')).toBe('loc-east')
  })

  it('checks the record: someone on the team, a real change, one move a day', () => {
    const { s: start, shoreditch } = studio()
    const s = apply(start, move(shoreditch))
    expect(staffMovesProblem(s)).toBeNull()
    const broken = (change: (state: BusinessState) => void) => {
      const copy = structuredClone(s)
      change(copy)
      return staffMovesProblem(copy)
    }
    expect(broken((x) => (x.operations!.staffMoves![0].staffId = 'nobody'))).toBe(
      'A move names someone not on the team.',
    )
    expect(broken((x) => (x.operations!.staffMoves![0].days[0].from = shoreditch))).toBe(
      'A move does not change where its days are.',
    )
    expect(
      broken((x) => x.operations!.staffMoves!.push({ ...x.operations!.staffMoves![0], id: 'two' })),
    ).toBe('Two moves start on one day for one person.')
    expect(broken((x) => x.operations!.staffMoves!.push({ ...x.operations!.staffMoves![0] }))).toBe(
      'Duplicate move IDs.',
    )
    const unknown = structuredClone(s)
    unknown.operations!.staffMoves![0].to = 'nowhere'
    expect(() => parseState(unknown, 'UK')).toThrow()
  })
})

describe('who may move someone', () => {
  it('is owners and managers only, checked on the server for everyone else', () => {
    const roles: Role[] = ['owner', 'manager', 'reception', 'practitioner', 'general', 'regional']
    const cancel: Command = { type: 'staff-move-cancel', moveId: 'x' }
    expect(permissionFor(cancel)).toBe('staff-move')
    expect(roles.filter((role) => can(role, 'staff-move'))).toEqual(['owner', 'manager'])
    const { s, main, shoreditch } = studio()
    const command = move(shoreditch)
    expect(practitionerRefusal(s, 'staff-maya', command, today)).toBe(
      'Your role cannot make this change.',
    )
    expect(areaRefusal(s, 'region', command)).toBe('Your role cannot make this change.')
    expect(branchRefusal(s, main, command)).toBe(
      'That changes the whole business. Ask the owner or a manager.',
    )
    expect(branchRefusal(s, main, cancel)).toBe(
      'That changes the whole business. Ask the owner or a manager.',
    )
  })

  it('shows a practitioner their own days at the new location from the date', () => {
    const { s: start, shoreditch } = studio()
    const s = apply(start, move(shoreditch))
    const view = practitionerView(s, 'staff-maya', today, Date.parse(now))
    const plan = new Map(view.plan!.map((d) => [d.date, d.place]))
    expect([plan.get('2026-10-09'), plan.get('2026-10-13')]).toEqual(['Marylebone', 'Shoreditch'])
  })

  it('reads weekdays in a calm list', () => {
    expect(weekdaysWords([1, 2, 3, 4, 5])).toBe('Monday to Friday')
    expect(weekdaysWords([0, 6, 2, 3])).toBe('Tuesday, Wednesday, Saturday and Sunday')
    expect(weekdaysWords([1, 2, 3, 5, 6, 0])).toBe('Monday to Wednesday and Friday to Sunday')
    expect(weekdaysWords([4])).toBe('Thursday')
  })
})
