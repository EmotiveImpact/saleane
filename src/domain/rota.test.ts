import { describe, expect, it } from 'vitest'
import {
  availableProfessionals,
  availableResource,
  dispatch,
  execute,
  rescheduleResource,
  slots,
} from './commands'
import type { Command } from './commands'
import type { BusinessState } from './model'
import { parseState } from './model'
import {
  can,
  operations,
  permissionFor,
  rotaChangeOn,
  staffHoursFor,
  usualHoursFor,
} from './operations'
import type { Role } from './operations'
import { createWorkspace } from './workspace'
import { seed } from './seed'
import { availableMinutes, staffDay } from './selectors'
import { staffLocationOn, staffPlaces } from './locations'
import { coverPlan } from './cover'
import { openings } from './waitlist'
import { availabilityEntries } from './googleFeeds'
import { practitionerRefusal, practitionerView } from './practitioner'
import { areaRefusal } from './area'
import { branchRefusal } from './branch'
import { holidaySummary, workingDaysAway } from './timeOff'
import { hoursPeriod } from './hours'
import { moveSampleDay } from './sampleDay'
import { changeDetail, describeChange, recordNames } from './changeRecord'
import {
  outsideVisits,
  rotaPreview,
  rotaProblem,
  rotaWeek,
  weekCopy,
  weekStillToCome,
} from './rota'
import type { RotaCommand } from './rota'

// Stage 3: one day on the rota changed or added, for that date only.
const now = '2026-10-06T08:00:00.000Z' // Tuesday 6 October, 09:00 in London.
const today = '2026-10-06'
const friday = '2026-10-09'
const saturday = '2026-10-10' // Maya does not usually work Saturdays.
const monday = '2026-10-12'
const thisMonday = '2026-10-05'
let sequence = 0
function local(): BusinessState {
  const s = createWorkspace({ name: 'Rota studio', region: 'UK' })
  const sample = seed('UK')
  for (const key of ['clients', 'services', 'staff', 'resources'] as const)
    Object.assign(s, {
      [key]: sample[key].map((row) => ({ ...row, organisationId: s.organisation.id })),
    })
  return s
}
function run(s: BusinessState, command: Command, at = now) {
  return execute(s, command, at, () => `rota-test-${++sequence}`)
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
const day = (input: Record<string, unknown> = {}, keepBooked?: true) =>
  ({
    type: 'rota-day',
    input: { staffId: 'staff-maya', date: friday, working: true, open: 540, close: 900, ...input },
    ...(keepBooked ? { keepBooked } : {}),
  }) as Command
const usual = (date = friday, keepBooked?: true) =>
  ({
    type: 'rota-day-usual',
    staffId: 'staff-maya',
    date,
    ...(keepBooked ? { keepBooked } : {}),
  }) as Command
const facial = (date: string, startMinutes: number, staffId = 'staff-maya') =>
  ({
    type: 'book',
    input: {
      serviceId: 'service-facial',
      staffId,
      date,
      startMinutes,
      clientId: 'client-1',
      source: 'desk',
    },
  }) as Command
const facialLength = (s: BusinessState) => {
  const service = s.services.find((x) => x.id === 'service-facial')!
  return service.durationMinutes + service.bufferMinutes
}

describe('changing one day on the rota', () => {
  it('changes the hours for that date only and leaves their usual hours as they are', () => {
    const before = local()
    const s = apply(before, day())
    expect(staffHoursFor(s, 'staff-maya', friday)).toMatchObject({
      open: 540,
      close: 900,
      closed: false,
    })
    // The next Friday and Maya's weekly hours are untouched.
    expect(staffHoursFor(s, 'staff-maya', '2026-10-16')).toMatchObject({ open: 540, close: 1080 })
    expect(s.staff.find((p) => p.id === 'staff-maya')).toEqual(
      before.staff.find((p) => p.id === 'staff-maya'),
    )
    expect(usualHoursFor(s, 'staff-maya', friday)).toEqual(
      usualHoursFor(before, 'staff-maya', friday),
    )
    // Times are offered only within the new hours, and a booking after them is refused.
    const latest = Math.max(...slots(s, 'service-facial', 'staff-maya', friday, now))
    expect(latest + facialLength(s)).toBeLessThanOrEqual(900)
    expect(Math.max(...slots(before, 'service-facial', 'staff-maya', friday, now))).toBeGreaterThan(
      latest,
    )
    expect(run(s, facial(friday, 960)).ok).toBe(false)
    expect(run(s, facial(friday, 600)).ok).toBe(true)
    expect(operations(s).rotaChanges).toEqual([
      expect.objectContaining({
        staffId: 'staff-maya',
        date: friday,
        working: true,
        open: 540,
        close: 900,
        createdAt: now,
      }),
    ])
  })

  it('adds an extra day someone does not usually work', () => {
    const before = local()
    expect(slots(before, 'service-facial', 'staff-maya', saturday, now)).toEqual([])
    const s = apply(before, day({ date: saturday, open: 600, close: 960, note: 'Covering' }))
    const times = slots(s, 'service-facial', 'staff-maya', saturday, now)
    expect(times[0]).toBe(600)
    expect(Math.max(...times) + facialLength(s)).toBeLessThanOrEqual(960)
    expect(apply(s, facial(saturday, 600)).appointments.at(-1)).toMatchObject({
      staffId: 'staff-maya',
      date: saturday,
      startMinutes: 600,
    })
    const maya = rotaWeek(s, thisMonday, now).find((row) => row.person.id === 'staff-maya')!
    expect(maya.days[5]).toMatchObject({ state: 'working', open: 600, close: 960, kind: 'extra' })
    expect(maya.days[4]).toMatchObject({ state: 'working', open: 540, close: 1080 })
    expect(maya.days[4]).not.toHaveProperty('kind')
  })

  it('takes one usual day off without touching the next week', () => {
    const before = local()
    const s = apply(
      before,
      day({ date: monday, working: false, open: undefined, close: undefined }),
    )
    expect(staffHoursFor(s, 'staff-maya', monday).closed).toBe(true)
    expect(slots(s, 'service-facial', 'staff-maya', monday, now)).toEqual([])
    expect(availableMinutes(s, monday)).toBe(availableMinutes(before, monday) - 540)
    expect(staffHoursFor(s, 'staff-maya', '2026-10-19').closed).toBe(false)
    const maya = rotaWeek(s, monday, now).find((row) => row.person.id === 'staff-maya')!
    expect(maya.days[0]).toMatchObject({ state: 'off', kind: 'off' })
  })

  it('replaces a change for the same day, keeping the earlier one on record', () => {
    let s = apply(local(), day())
    s = apply(s, day({ open: 600, close: 1020 }))
    const list = operations(s).rotaChanges!
    expect(list).toHaveLength(2)
    expect(list[0].ended).toMatchObject({ how: 'replaced', at: now })
    expect(rotaChangeOn(s, 'staff-maya', friday)).toMatchObject({ open: 600, close: 1020 })
    expect(staffHoursFor(s, 'staff-maya', friday)).toMatchObject({ open: 600, close: 1020 })
    // Saving the same again is not a change.
    expect(refusal(s, day({ open: 600, close: 1020 }))).toBe('That day already has these hours.')
  })

  it('puts a day back to usual hours and keeps the change on record', () => {
    let s = apply(local(), day())
    const id = operations(s).rotaChanges![0].id
    const result = dispatch(s, usual(), 'Ava Owner', now)
    if (!result.ok) throw new Error(result.error)
    s = result.state
    expect(rotaChangeOn(s, 'staff-maya', friday)).toBeUndefined()
    expect(staffHoursFor(s, 'staff-maya', friday)).toMatchObject({ open: 540, close: 1080 })
    expect(operations(s).rotaChanges!.find((c) => c.id === id)!.ended).toEqual({
      at: now,
      actor: 'Ava Owner',
      how: 'usual',
    })
    expect(refusal(s, usual())).toBe('That day already follows their usual hours.')
  })

  it('puts the signed-in name on changes made and ended', () => {
    const result = dispatch(local(), day(), 'Ava Owner', now)
    if (!result.ok) throw new Error(result.error)
    expect(operations(result.state).rotaChanges![0].actor).toBe('Ava Owner')
  })
})

describe('server-side checks for a changed day', () => {
  it('checks the times, the day and the person', () => {
    const s = local()
    expect(refusal(s, day({ open: 900, close: 840 }))).toBe('Choose a finish time after the start.')
    expect(refusal(s, day({ open: 480 }))).toBe(
      'The studio is open 09:00 to 18:00 that day. Choose times within those hours.',
    )
    expect(refusal(s, day({ close: 1140 }))).toContain('Choose times within those hours.')
    // Times off the five-minute step are refused by the schema.
    expect(run(s, day({ open: 541 })).ok).toBe(false)
    expect(refusal(s, day({ open: undefined }))).toBe('Choose when they start and finish.')
    expect(refusal(s, day({ working: false }))).toBe('A day off has no hours or location.')
    expect(refusal(s, day({ date: '2026-10-05' }))).toBe(
      'That day has passed. The rota keeps what was planned for it.',
    )
    expect(refusal(s, day({ date: '2027-10-08' }))).toBe('Change days up to a year ahead.')
    expect(run(s, day({ date: today })).ok).toBe(true)
    expect(refusal(s, day({ date: '2026-10-11' }))).toBe(
      'The studio is closed that day. Change the opening hours in Settings first.',
    )
    expect(refusal(s, day({ staffId: 'nobody' }))).toBe('Choose someone on the team.')
    expect(
      refusal(s, day({ date: saturday, working: false, open: undefined, close: undefined })),
    ).toBe('Maya does not usually work that day, so there is nothing to take off.')
    expect(refusal(s, day({ close: 1080 }))).toBe(
      'Those are their usual hours for that day. Choose As usual to put the day back instead.',
    )
    expect(run(s, day({ note: 'x'.repeat(101) })).ok).toBe(false)
  })

  it('refuses a change on a day someone is away', () => {
    const s = apply(local(), {
      type: 'time-off',
      input: { staffId: 'staff-maya', from: friday, to: friday, kind: 'holiday' },
    })
    expect(refusal(s, day())).toBe(
      'Maya is away that day (holiday). Cancel the time off first if they are working.',
    )
  })

  it('checks the location is open and offers their treatments', () => {
    let s = apply(local(), {
      type: 'location',
      input: { name: 'Islington', address: '1 Upper Street, London' },
    })
    const islington = operations(s).locations![0].id
    expect(refusal(s, day({ locationId: 'nowhere' }))).toBe('Choose an open location.')
    // Islington offers none of Maya's treatments, so she cannot be sent there.
    s = {
      ...s,
      services: s.services.map((x) =>
        ['service-facial', 'service-restore'].includes(x.id)
          ? { ...x, notOfferedAt: [islington] }
          : x,
      ),
    }
    expect(refusal(s, day({ locationId: islington }))).toBe(
      "Islington does not offer any of Maya's treatments. Choose another location.",
    )
  })

  it('refuses two changes in force for one person on one day in the record', () => {
    const s = apply(local(), day())
    const twice = structuredClone(s)
    twice.operations!.rotaChanges!.push({ ...twice.operations!.rotaChanges![0], id: 'copy' })
    expect(rotaProblem(twice)).toBe('Two changes apply to one person on one day.')
    expect(() => parseState(twice, 'UK')).toThrow('Two changes apply to one person on one day.')
    const stranger = structuredClone(s)
    stranger.operations!.rotaChanges![0].staffId = 'missing'
    expect(() => parseState(stranger, 'UK')).toThrow('A rota change names someone not on the team.')
    const nowhere = structuredClone(s)
    nowhere.operations!.rotaChanges![0].locationId = s.organisation.locationId
    expect(() => parseState(nowhere, 'UK')).toThrow('A rota change names a missing location.')
    const backwards = structuredClone(s)
    Object.assign(backwards.operations!.rotaChanges![0], { open: 900, close: 540 })
    expect(() => parseState(backwards, 'UK')).toThrow()
  })

  it('lets only owners and managers change the rota', () => {
    for (const type of ['rota-day', 'rota-day-usual', 'rota-week-copy', 'rota-week-clear']) {
      const permission = permissionFor({ type })
      expect(permission).toBe('hours')
      const allowed = (['owner', 'manager'] as Role[]).every((role) => can(role, permission))
      const refused = (['reception', 'practitioner', 'regional', 'general'] as Role[]).every(
        (role) => !can(role, permission),
      )
      expect(allowed && refused).toBe(true)
    }
    const s = local()
    const command = day() as Extract<Command, { type: 'rota-day' }>
    expect(practitionerRefusal(s, 'staff-maya', command, today)).toBe(
      'Your role cannot make this change.',
    )
    expect(areaRefusal(s, 'region-1', command)).toBe('Your role cannot make this change.')
    expect(branchRefusal(s, s.organisation.locationId, command)).toBe(
      'That changes the whole business. Ask the owner or a manager.',
    )
  })
})

describe('everywhere that works out who is free follows the changed day', () => {
  /** Maya works an extra Saturday; Sophia has a facial booked that Saturday morning. */
  function saturdayWithMaya() {
    let s = local()
    s = apply(s, facial(saturday, 660, 'staff-sophia'))
    return { without: s, with: apply(s, day({ date: saturday, open: 600, close: 960 })) }
  }

  it('the desk, the guest booking page, the receptionist and Book with Google', () => {
    const { without, with: s } = saturdayWithMaya()
    // The desk and the guest page both ask for a room at a time.
    expect(
      availableResource(without, 'service-facial', 'staff-maya', saturday, 600, now),
    ).toBeNull()
    expect(availableResource(s, 'service-facial', 'staff-maya', saturday, 600, now)).not.toBeNull()
    expect(slots(s, 'service-facial', 'any', saturday, now)).toContain(600)
    // The receptionist offers anyone free at a time.
    expect(
      availableProfessionals(s, 'service-facial', saturday, 600, now).map((p) => p.id),
    ).toContain('staff-maya')
    // Book with Google lists each free start time per professional.
    const free = (state: BusinessState) =>
      availabilityEntries(
        {
          id: 'merchant',
          slug: 'rota',
          state: {
            ...state,
            services: state.services.map((x) => ({ ...x, depositMinor: 0 })),
          },
        },
        now,
        7,
      ).filter(
        (e) =>
          e.resources.staff_id === 'staff-maya' &&
          new Date(e.start_sec * 1000).toISOString().startsWith(saturday),
      ).length
    expect(free(without)).toBe(0)
    expect(free(s)).toBeGreaterThan(0)
  })

  it('moving a visit, waitlist offers, cover plans and gaps', () => {
    const { without, with: s } = saturdayWithMaya()
    const sophias = s.appointments.at(-1)!
    // Moving Sophia's visit to Maya that Saturday.
    expect(rescheduleResource(without, sophias.id, 'staff-maya', saturday, 600, now)).toBeNull()
    expect(rescheduleResource(s, sophias.id, 'staff-maya', saturday, 600, now)).not.toBeNull()
    // A waitlist request for Maya on that Saturday only.
    const wish = {
      type: 'waitlist-add',
      input: {
        clientId: 'client-2',
        serviceId: 'service-facial',
        staffId: 'staff-maya',
        fromDate: saturday,
        toDate: saturday,
        times: [],
        note: '',
      },
    } as Command
    const entry = (state: BusinessState) => apply(state, wish).waitlist!.at(-1)!
    expect(openings(apply(without, wish), entry(without), now)).toEqual([])
    expect(openings(apply(s, wish), entry(s), now)[0]).toMatchObject({
      date: saturday,
      staffId: 'staff-maya',
      startMinutes: 600,
    })
    // Sophia is off sick that Saturday: Maya, in on her extra day, can take her visit.
    expect(coverPlan(without, 'staff-sophia', saturday, now).moves).toEqual([])
    expect(coverPlan(s, 'staff-sophia', saturday, now).moves).toEqual([
      expect.objectContaining({ toStaffId: 'staff-maya' }),
    ])
    // Gaps: Maya's free time that day.
    expect(staffDay(without, 'staff-maya', saturday).working).toBe(false)
    expect(staffDay(s, 'staff-maya', saturday)).toMatchObject({
      working: true,
      start: 600,
      end: 960,
      freeMinutes: 360,
    })
  })

  it("Today's team, the practitioner's own day and where they work", () => {
    const { with: s } = saturdayWithMaya()
    expect(
      availableMinutes({ ...s, staff: s.staff.filter((p) => p.id === 'staff-maya') }, saturday),
    ).toBe(360)
    const view = practitionerView(s, 'staff-maya', today, Date.parse(now))
    expect(view.plan?.find((d) => d.date === saturday)).toEqual({
      date: saturday,
      working: true,
      open: 600,
      close: 960,
      change: 'extra',
    })
    expect(view.plan?.find((d) => d.date === friday)).toEqual({
      date: friday,
      working: true,
      open: 540,
      close: 1080,
    })
    // Nobody else's days: Sophia's own view says nothing of Maya's extra day.
    const sophia = practitionerView(s, 'staff-sophia', today, Date.parse(now))
    expect(sophia.plan?.some((d) => d.change)).toBe(false)
  })

  it('sends someone to another location for one day', () => {
    let s = apply(local(), {
      type: 'location',
      input: { name: 'Islington', address: '1 Upper Street, London' },
    })
    const islington = operations(s).locations![0].id
    s = apply(s, {
      type: 'resource',
      id: 'room-two',
      input: { name: 'Treatment room 2', type: 'treatment', locationId: islington },
    })
    expect(staffPlaces(s, 'staff-maya', now)).toEqual([s.organisation.locationId])
    s = apply(s, day({ close: 1080, locationId: islington }))
    expect(staffLocationOn(s, 'staff-maya', friday)).toBe(islington)
    expect(staffLocationOn(s, 'staff-maya', '2026-10-16')).toBe(s.organisation.locationId)
    expect(staffPlaces(s, 'staff-maya', now)).toContain(islington)
    // Once the day has passed it no longer counts as a place they work.
    expect(staffPlaces(s, 'staff-maya', '2026-10-10T08:00:00.000Z')).toEqual([
      s.organisation.locationId,
    ])
    // Booked there that day, in Islington's room; not at the main location.
    const booked = apply(s, facial(friday, 600))
    expect(booked.appointments.at(-1)).toMatchObject({
      locationId: islington,
      resourceId: 'room-two',
    })
    expect(
      availableResource(
        s,
        'service-facial',
        'staff-maya',
        friday,
        600,
        now,
        undefined,
        s.organisation.locationId,
      ),
    ).toBeNull()
    const maya = rotaWeek(s, thisMonday, now).find((row) => row.person.id === 'staff-maya')!
    expect(maya.days[4]).toMatchObject({ state: 'working', locationId: islington, kind: 'hours' })
  })
})

describe('booked visits outside the new hours', () => {
  it('refuses until a choice is made, naming each visit by time, first name and treatment', () => {
    const s = apply(local(), facial(friday, 960))
    const error = refusal(s, day())
    expect(error).toBe(
      'A booked visit would be outside the new hours: Fri 9 Oct 16:00, Amelia, Skin Renewal Facial. Move it first, or choose to keep it booked as it is.',
    )
    // The screen shows the same before anyone saves.
    const preview = rotaPreview(s, day() as RotaCommand, now)
    expect(preview.error).toBeNull()
    expect(preview.affected).toEqual([
      expect.objectContaining({ startMinutes: 960, clientFirstName: 'Amelia' }),
    ])
  })

  it('keeps them booked as they are when asked, with a warning that stays on the rota', () => {
    const booked = apply(local(), facial(friday, 960))
    const visit = booked.appointments.at(-1)!
    const s = apply(booked, day({}, true))
    // The visit is untouched: same time, same person, still booked. Nothing is queued.
    expect(s.appointments.find((a) => a.id === visit.id)).toEqual(visit)
    expect(operations(s).messages).toEqual(operations(booked).messages)
    expect(rotaChangeOn(s, 'staff-maya', friday)!.kept).toEqual([visit.id])
    expect(outsideVisits(s, 'staff-maya', friday, now).map((a) => a.id)).toEqual([visit.id])
    const maya = rotaWeek(s, thisMonday, now).find((row) => row.person.id === 'staff-maya')!
    expect(maya.days[4]).toMatchObject({ state: 'working', kind: 'hours' })
    expect(maya.days[4].state === 'working' && maya.days[4].outside.map((a) => a.id)).toEqual([
      visit.id,
    ])
    // Moving the visit inside the hours clears the warning.
    const moved = apply(s, {
      type: 'reschedule',
      appointmentId: visit.id,
      date: friday,
      startMinutes: 600,
      staffId: 'staff-maya',
    })
    expect(outsideVisits(moved, 'staff-maya', friday, now)).toEqual([])
    // Other schedule changes are not held up by a visit already kept outside the hours.
    expect(
      run(s, {
        type: 'time-off',
        input: { staffId: 'staff-maya', from: '2026-10-20', to: '2026-10-20', kind: 'sick' },
      }).ok,
    ).toBe(true)
  })

  it('checks putting a day back to usual too', () => {
    let s = apply(local(), day({ date: saturday, open: 600, close: 960 }))
    s = apply(s, facial(saturday, 600))
    expect(refusal(s, usual(saturday))).toContain('A booked visit would be outside the new hours')
    s = apply(s, usual(saturday, true))
    const ended = operations(s).rotaChanges![0]
    expect(ended.ended).toMatchObject({ how: 'usual', kept: [s.appointments.at(-1)!.id] })
    const maya = rotaWeek(s, thisMonday, now).find((row) => row.person.id === 'staff-maya')!
    expect(maya.days[5]).toMatchObject({ state: 'off' })
    expect(maya.days[5].state === 'off' && maya.days[5].outside).toHaveLength(1)
  })

  it('never counts a visit that has already happened', () => {
    let s = apply(local(), facial(today, 600))
    // Later on the same day the visit is over, so finishing early strands nothing.
    s = apply(s, day({ date: today, open: 540, close: 720 }), '2026-10-06T13:00:00.000Z')
    expect(rotaChangeOn(s, 'staff-maya', today)!.kept).toBeUndefined()
  })
})

describe('a whole week at once', () => {
  it("copies last week's changes onto the same days, leaving out what cannot be copied", () => {
    let s = apply(local(), day({ date: today, open: 600, close: 1080 }))
    s = apply(s, day({ date: friday }))
    s = apply(s, day({ date: saturday, open: 600, close: 960 }))
    s = apply(s, {
      type: 'time-off',
      input: { staffId: 'staff-maya', from: '2026-10-16', to: '2026-10-16', kind: 'holiday' },
    })
    const plan = weekCopy(s, monday, today)
    expect(plan.copies.map((c) => c.date)).toEqual(['2026-10-13', '2026-10-17'])
    expect(plan.skipped).toEqual([
      expect.objectContaining({
        date: '2026-10-16',
        reason: 'Maya is away that day (holiday). Cancel the time off first if they are working.',
      }),
    ])
    s = apply(s, { type: 'rota-week-copy', monday })
    expect(staffHoursFor(s, 'staff-maya', '2026-10-13')).toMatchObject({ open: 600, close: 1080 })
    expect(staffHoursFor(s, 'staff-maya', '2026-10-17')).toMatchObject({ open: 600, close: 960 })
    // Nothing to copy into the week after that one from an empty week.
    expect(refusal(s, { type: 'rota-week-copy', monday: '2026-10-26' })).toBe(
      'Last week has no changed days to copy.',
    )
    expect(refusal(s, { type: 'rota-week-copy', monday: '2026-10-13' })).toBe(
      'Choose the Monday the week starts on.',
    )
  })

  it("clears only this week's changes still to come", () => {
    let s = apply(local(), day({ date: today, open: 600, close: 1080 }))
    s = apply(s, day({ date: friday }))
    s = apply(s, day({ date: monday, working: false, open: undefined, close: undefined }))
    // Tomorrow, today's change has passed and stays as it was.
    const tomorrow = '2026-10-07T08:00:00.000Z'
    expect(weekStillToCome(s, thisMonday, '2026-10-07').map((c) => c.date)).toEqual([friday])
    s = apply(s, { type: 'rota-week-clear', monday: thisMonday }, tomorrow)
    expect(rotaChangeOn(s, 'staff-maya', today)).toBeDefined()
    expect(rotaChangeOn(s, 'staff-maya', friday)).toBeUndefined()
    expect(rotaChangeOn(s, 'staff-maya', monday)).toBeDefined()
    expect(refusal(s, { type: 'rota-week-clear', monday: thisMonday }, tomorrow)).toBe(
      'This week has no changed days still to come.',
    )
  })

  it('asks about booked visits for the whole week too', () => {
    let s = apply(local(), day({ date: saturday, open: 600, close: 960 }))
    s = apply(s, facial(saturday, 600))
    expect(refusal(s, { type: 'rota-week-clear', monday: thisMonday })).toContain(
      'Sat 10 Oct 10:00, Amelia, Skin Renewal Facial',
    )
    s = apply(s, { type: 'rota-week-clear', monday: thisMonday, keepBooked: true })
    expect(outsideVisits(s, 'staff-maya', saturday, now)).toHaveLength(1)
  })
})

describe('the plan and the record', () => {
  it('counts holiday against the days planned, extra days included', () => {
    let s = apply(local(), day({ date: saturday, open: 600, close: 960 }))
    const away = { staffId: 'staff-maya', from: '2026-10-09', to: '2026-10-11' }
    expect(workingDaysAway(local(), away)).toBe(1)
    expect(workingDaysAway(s, away)).toBe(2)
    s = apply(s, { type: 'time-off', input: { ...away, kind: 'holiday' } })
    expect(holidaySummary(s, 'staff-maya', 2026).booked).toBe(2)
  })

  it('leaves hours worked for payroll as they were clocked', () => {
    const sample = seed('UK')
    const changed = apply(sample, {
      type: 'rota-day',
      input: { staffId: 'staff-theo', date: today, working: false },
      keepBooked: true,
    })
    expect(hoursPeriod(changed, '2026-09-22', today)).toEqual(
      hoursPeriod(sample, '2026-09-22', today),
    )
  })

  it('says in plain words who changed which day', () => {
    const before = local()
    const result = dispatch(before, day(), 'Ava Owner', now)
    if (!result.ok) throw new Error(result.error)
    const detail = changeDetail(before, result.state, 'rota-day', result.recordId)
    const entry = describeChange(result.state, recordNames(result.state), {
      id: 'audit-1',
      action: 'rota-day',
      recordId: result.recordId,
      occurredAt: Date.parse(now),
      actor: 'Ava Owner',
      account: null,
      detail: JSON.stringify(detail),
    })
    expect(entry).toMatchObject({
      what: 'Changed a day on the rota',
      about: 'Maya Lewis',
      group: 'team',
      lines: [
        { what: 'date', to: '9 October 2026' },
        { what: 'hours that day', from: 'their usual hours', to: '09:00 to 15:00' },
      ],
    })
    const back = dispatch(result.state, usual(), 'Ava Owner', now)
    if (!back.ok) throw new Error(back.error)
    expect(changeDetail(result.state, back.state, 'rota-day-usual', back.recordId)).toEqual({
      fields: [
        { f: 'date', to: friday },
        { f: 'shift', from: '540-900', to: 'usual' },
      ],
    })
  })
})

describe('the sample studio', () => {
  it('shows a changed shift and an extra day in the sample week', () => {
    const s = seed('UK')
    const maya = rotaWeek(s, thisMonday, now).find((row) => row.person.id === 'staff-maya')!
    expect(maya.days[4]).toMatchObject({ state: 'working', open: 540, close: 900, kind: 'hours' })
    expect(maya.days[5]).toMatchObject({ state: 'working', open: 600, close: 960, kind: 'extra' })
    // Every booked visit stays inside the hours, with and without the regulars.
    for (const studio of [s, seed('UK', { regulars: true }), seed('US', { regulars: true })])
      for (const date of [friday, saturday])
        expect(outsideVisits(studio, 'staff-maya', date, now)).toEqual([])
  })

  it('keeps the changed days on the same days of the week when the sample moves', () => {
    const moved = moveSampleDay(seed('UK'), '2026-11-03')
    expect(rotaChangeOn(moved, 'staff-maya', '2026-11-06')).toMatchObject({ close: 900 })
    expect(rotaChangeOn(moved, 'staff-maya', '2026-11-07')).toMatchObject({ open: 600 })
    expect(staffHoursFor(moved, 'staff-maya', '2026-11-07').closed).toBe(false)
    // Moved onto a Thursday, the weekly hours turn with the days, so the changes keep their kind.
    const thursday = moveSampleDay(seed('UK'), '2026-10-08')
    const maya = rotaWeek(thursday, '2026-10-05', '2026-10-08T08:00:00.000Z').find(
      (row) => row.person.id === 'staff-maya',
    )!
    expect(maya.days.find((d) => d.date === '2026-10-11')).toMatchObject({
      state: 'working',
      open: 540,
      close: 900,
      kind: 'hours',
    })
    const after = rotaWeek(thursday, '2026-10-12', '2026-10-08T08:00:00.000Z').find(
      (row) => row.person.id === 'staff-maya',
    )!
    expect(after.days[0]).toMatchObject({ state: 'working', open: 600, close: 960, kind: 'extra' })
  })
})
