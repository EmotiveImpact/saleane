import { describe, expect, it } from 'vitest'
import { dispatch, execute } from './commands'
import type { Command } from './commands'
import { parseState } from './model'
import type { BusinessState, Region } from './model'
import { SCHEDULE_HISTORY_LIMIT, defaultOperations, operations } from './operations'
import type { OperatingCommand } from './commandSchema'
import { scheduleImpact } from './schedule'
import { createWorkspace } from './workspace'
import { seed } from './seed'

const now = '2026-10-06T08:00:00.000Z'
let sequence = 0
function apply(s: BusinessState, command: Command, clock = now) {
  const result = execute(s, command, clock, () => `schedule-${++sequence}`)
  if (!result.ok) throw new Error(result.error)
  return result
}
function refusal(s: BusinessState, command: Command, clock = now) {
  const result = execute(s, command, clock, () => `schedule-${++sequence}`)
  if (result.ok) throw new Error('Expected the change to be refused.')
  return result.error
}
function local(region: Region = 'UK') {
  const s = createWorkspace({ name: 'Schedule test studio', region })
  // Open every day, as the clock changes fall on Sundays (a new studio starts closed on Sunday).
  s.operations = { ...operations(s), hours: defaultOperations().hours }
  const sample = seed(region)
  for (const key of ['clients', 'services', 'staff', 'resources'] as const)
    Object.assign(s, {
      [key]: sample[key].map((row) => ({ ...row, organisationId: s.organisation.id })),
    })
  // Everyone follows those hours, rather than the sample's own rota with its days off.
  for (const person of s.staff) delete person.hours
  return s
}
const visit = {
  serviceId: 'service-facial',
  staffId: 'staff-maya',
  date: '2026-10-06',
  startMinutes: 600,
  clientId: 'client-1',
  source: 'desk' as const,
}
/** Amelia with Maya: 10:00, 60 minutes and 15 minutes turnaround, so the room is free at 11:15. */
function booked(patch: Partial<typeof visit> = {}, region: Region = 'UK', clock = now) {
  return apply(local(region), { type: 'book', input: { ...visit, ...patch } }, clock).state
}
const week = (patch: (day: number) => Partial<ReturnType<typeof defaultOperations>['hours'][0]>) =>
  defaultOperations().hours.map((h) => ({ ...h, ...patch(h.day) }))
const tuesday = (patch: { open?: number; close?: number; closed?: boolean }) =>
  week((day) => (day === 2 ? patch : {}))
const history = (s: BusinessState) => operations(s).scheduleHistory ?? []

describe('affected visits instead of silent failure', () => {
  it('names each stranded visit and changes nothing, including the history', () => {
    const s = booked(),
      snapshot = JSON.stringify(s)
    const change: OperatingCommand = { type: 'hours', hours: tuesday({ open: 660 }) }
    expect(scheduleImpact(s, change, now)).toEqual([
      {
        appointmentId: s.appointments[0].id,
        date: '2026-10-06',
        startMinutes: 600,
        clientFirstName: 'Amelia',
        staffName: 'Maya Lewis',
        serviceName: 'Skin Renewal Facial',
        reason: 'It would start before opening',
      },
    ])
    const error = refusal(s, change)
    expect(error).toContain('This change would affect 1 upcoming visit:')
    expect(error).toContain('Tue 6 Oct 10:00, Amelia with Maya Lewis')
    expect(error).toContain('Move or cancel it first')
    expect(JSON.stringify(s)).toBe(snapshot)
    expect(history(s)).toEqual([])
  })
  it('never moves or cancels a visit, and previews nothing for unrelated commands', () => {
    const s = booked()
    expect(
      scheduleImpact(s, { type: 'tax', label: 'VAT', rateBps: 2000, inclusive: true }, now),
    ).toEqual([])
    const after = apply(s, { type: 'hours', hours: tuesday({ close: 1200 }) }).state
    expect(after.appointments).toEqual(s.appointments)
  })
  it('lists several visits in time order and summarises any beyond five', () => {
    let s = local()
    for (const [i, date] of ['2026-10-13', '2026-10-20', '2026-10-27', '2026-11-03'].entries())
      s = apply(s, { type: 'book', input: { ...visit, date, clientId: `client-${i + 2}` } }).state
    s = apply(s, { type: 'book', input: { ...visit, startMinutes: 780 } }).state
    s = apply(s, { type: 'book', input: { ...visit } }).state
    const change: OperatingCommand = { type: 'hours', hours: tuesday({ closed: true }) }
    const impact = scheduleImpact(s, change, now)
    expect(impact.map((v) => [v.date, v.startMinutes])).toEqual([
      ['2026-10-06', 600],
      ['2026-10-06', 780],
      ['2026-10-13', 600],
      ['2026-10-20', 600],
      ['2026-10-27', 600],
      ['2026-11-03', 600],
    ])
    expect(impact.every((v) => v.reason === 'The venue would be closed that day')).toBe(true)
    expect(refusal(s, change)).toMatch(
      /affect 6 upcoming visits: .*; and 1 more\. Move or cancel them/,
    )
  })
  it('does not blame a change for a visit that already did not fit', () => {
    const s = booked()
    // An older record already outside Tuesday's hours (for example from a restored backup).
    s.operations!.hours = tuesday({ open: 660 })
    expect(
      apply(s, {
        type: 'closure',
        input: { date: '2026-10-07', startMinutes: 600, endMinutes: 660, reason: 'Training' },
      }).ok,
    ).toBe(true)
  })
})

describe('buffer, break and room boundaries', () => {
  it('lets closing time meet the end of turnaround but not cut into it', () => {
    const s = booked()
    expect(scheduleImpact(s, { type: 'hours', hours: tuesday({ close: 675 }) }, now)).toEqual([])
    expect(apply(s, { type: 'hours', hours: tuesday({ close: 675 }) }).ok).toBe(true)
    expect(
      scheduleImpact(s, { type: 'hours', hours: tuesday({ close: 670 }) }, now)[0].reason,
    ).toBe('Its turnaround would run past closing')
    expect(
      scheduleImpact(s, { type: 'hours', hours: tuesday({ close: 655 }) }, now)[0].reason,
    ).toBe('It would end after closing')
    const closure = (startMinutes: number): OperatingCommand => ({
      type: 'closure',
      input: { date: visit.date, startMinutes, endMinutes: 720, reason: 'Deep clean' },
    })
    expect(scheduleImpact(s, closure(675), now)).toEqual([])
    expect(scheduleImpact(s, closure(670), now)[0].reason).toBe(
      'It would overlap a venue closure (Deep clean)',
    )
    expect(refusal(s, closure(670))).toContain('Amelia with Maya Lewis')
  })
  it('treats a staff-specific closure as a break for that professional only', () => {
    const s = booked()
    const lunch = (staffId: string): OperatingCommand => ({
      type: 'closure',
      input: { date: visit.date, staffId, startMinutes: 630, endMinutes: 660, reason: 'Lunch' },
    })
    expect(scheduleImpact(s, lunch('staff-maya'), now)[0].reason).toBe(
      "It would overlap Maya Lewis's time away (Lunch)",
    )
    expect(refusal(s, lunch('staff-maya'))).toContain('Amelia with Maya Lewis')
    const sophia = apply(s, lunch('staff-sophia')).state
    expect(history(sophia).at(-1)).toMatchObject({
      kind: 'closure-added',
      summary: 'Time away added: Sophia Reed away Tuesday 6 October, 10:30 to 11:00 (Lunch).',
      before: null,
      after: { staffId: 'staff-sophia', startMinutes: 630, endMinutes: 660 },
    })
  })
  it('refuses to strand a visit through a professional’s own hours or qualifications', () => {
    const s = booked()
    const maya = s.staff.find((p) => p.id === 'staff-maya')!
    const input = { ...maya } // Unknown keys such as the id are dropped by the command schema.
    const later: OperatingCommand = {
      type: 'staff',
      id: maya.id,
      input: { ...input, hours: tuesday({ open: 720 }) },
    }
    expect(scheduleImpact(s, later, now)[0].reason).toBe('It would start before Maya Lewis begins')
    expect(refusal(s, later)).toContain('Amelia with Maya Lewis')
    expect(
      scheduleImpact(s, { type: 'staff', id: maya.id, input: { ...input, archived: true } }, now)[0]
        .reason,
    ).toBe('Maya Lewis would be archived')
    expect(
      scheduleImpact(s, { type: 'staff', id: maya.id, input: { ...input, serviceIds: [] } }, now)[0]
        .reason,
    ).toBe('Maya Lewis would no longer offer Skin Renewal Facial')
  })
  it('keeps room continuity: an occupied room cannot be archived or changed in kind', () => {
    const s = booked()
    const room = s.appointments[0].resourceId
    const name = s.resources.find((r) => r.id === room)!.name
    const archive: OperatingCommand = {
      type: 'resource',
      id: room,
      input: { name, type: 'treatment', archived: true },
    }
    expect(scheduleImpact(s, archive, now)[0].reason).toBe(`${name} would be archived`)
    expect(refusal(s, archive)).toMatch(/1 upcoming visit: Tue 6 Oct 10:00, Amelia with Maya Lewis/)
    expect(
      scheduleImpact(s, { type: 'resource', id: room, input: { name, type: 'chair' } }, now)[0]
        .reason,
    ).toBe(`${name} would no longer suit Skin Renewal Facial`)
    const other = s.resources.find((r) => r.type === 'treatment' && r.id !== room)!
    const after = apply(s, {
      type: 'resource',
      id: other.id,
      input: { name: other.name, type: other.type, archived: true },
    }).state
    expect(history(after).at(-1)).toMatchObject({
      kind: 'resource-archived',
      subjectId: other.id,
      before: { archived: false },
      after: { archived: true },
    })
  })
})

describe('which visits count as upcoming', () => {
  it('ignores past days, finished visits earlier today, and cancelled visits', () => {
    const yesterday = booked({ date: '2026-10-05' }, 'UK', '2026-10-04T08:00:00.000Z')
    expect(
      scheduleImpact(yesterday, { type: 'hours', hours: week(() => ({ closed: true })) }, now),
    ).toEqual([])
    const s = booked()
    const closeEarly: OperatingCommand = { type: 'hours', hours: tuesday({ close: 600 }) }
    // 11:20 in London, after the 10:00 visit and its turnaround have finished.
    expect(scheduleImpact(s, closeEarly, '2026-10-06T10:20:00.000Z')).toEqual([])
    expect(apply(s, closeEarly, '2026-10-06T10:20:00.000Z').ok).toBe(true)
    // 11:10 in London: the turnaround is still running, so the visit is protected.
    expect(scheduleImpact(s, closeEarly, '2026-10-06T10:10:00.000Z')).toHaveLength(1)
    const cancelled = apply(s, {
      type: 'cancel',
      appointmentId: s.appointments[0].id,
      reason: 'Client asked',
    }).state
    expect(scheduleImpact(cancelled, closeEarly, now)).toEqual([])
  })
  // Each case books 10:00 venue time on a clock-change day, then asks just before and
  // just after the visit and its turnaround end. Using the wrong UTC offset gets one of them wrong.
  it.each([
    ['UK', '2027-03-28', 600, '2027-03-28T10:10:00.000Z', '2027-03-28T10:20:00.000Z'],
    ['UK', '2026-10-25', 600, '2026-10-25T11:10:00.000Z', '2026-10-25T11:20:00.000Z'],
    ['US', '2027-03-14', 600, '2027-03-14T15:10:00.000Z', '2027-03-14T15:20:00.000Z'],
    ['US', '2026-11-01', 600, '2026-11-01T16:10:00.000Z', '2026-11-01T16:20:00.000Z'],
  ] as const)(
    'uses venue time on the %s clock change of %s',
    (region, date, startMinutes, during, after) => {
      const s = booked({ date, startMinutes }, region)
      const day = new Date(`${date}T12:00:00Z`).getUTCDay()
      const close: OperatingCommand = {
        type: 'hours',
        hours: week((d) => (d === day ? { close: startMinutes } : {})),
      }
      expect(scheduleImpact(s, close, during)).toHaveLength(1)
      expect(execute(s, close, during).ok).toBe(false)
      expect(scheduleImpact(s, close, after)).toEqual([])
      expect(execute(s, close, after).ok).toBe(true)
    },
  )
})

describe('schedule change history', () => {
  it('records actor, time and plain before and after for hours and closures', () => {
    let s = booked()
    let result = dispatch(
      s,
      {
        type: 'hours',
        hours: week((d) => (d === 3 ? { close: 1020 } : d === 0 ? { closed: true } : {})),
      },
      'Ada Owner',
      now,
    )
    if (!result.ok) throw new Error(result.error)
    s = result.state
    expect(history(s)).toEqual([
      expect.objectContaining({
        kind: 'hours',
        actor: 'Ada Owner',
        occurredAt: now,
        summary:
          'Opening hours changed: Wednesday 09:00 to 18:00 became 09:00 to 17:00; Sunday 09:00 to 18:00 became closed.',
      }),
    ])
    expect(history(s)[0].before).toEqual(defaultOperations().hours)
    result = dispatch(
      s,
      {
        type: 'closure',
        input: {
          date: '2026-10-08',
          startMinutes: 540,
          endMinutes: 1080,
          reason: 'Staff training',
        },
      },
      'Bea Manager',
      now,
    )
    if (!result.ok) throw new Error(result.error)
    s = result.state
    const closureId = result.recordId
    result = dispatch(s, { type: 'remove-closure', closureId }, 'Ada Owner', now)
    if (!result.ok) throw new Error(result.error)
    s = result.state
    expect(history(s).map((h) => [h.kind, h.actor, h.subjectId])).toEqual([
      ['hours', 'Ada Owner', undefined],
      ['closure-added', 'Bea Manager', closureId],
      ['closure-removed', 'Ada Owner', closureId],
    ])
    expect(history(s)[2]).toMatchObject({
      summary:
        'Time away removed: Venue closed Thursday 8 October, 09:00 to 18:00 (Staff training).',
      before: { id: closureId, reason: 'Staff training' },
      after: null,
    })
    expect(parseState(JSON.parse(JSON.stringify(s)), 'UK')).toEqual(s)
  })
  it('records a professional’s own hours, archiving and restoring, but not a rename', () => {
    let s = booked()
    const theo = s.staff.find((p) => p.id === 'staff-theo')!
    const input = { ...theo }
    s = apply(s, {
      type: 'staff',
      id: theo.id,
      input: { ...input, hours: tuesday({ open: 720 }) },
    }).state
    s = apply(s, { type: 'staff', id: theo.id, input: { ...input, name: 'Theo B. Bennett' } }).state
    s = apply(s, { type: 'staff', id: theo.id, input: { ...input, archived: true } }).state
    s = apply(s, { type: 'staff', id: theo.id, input: { ...input, archived: false } }).state
    expect(history(s).map((h) => [h.kind, h.summary])).toEqual([
      [
        'staff-hours',
        "Theo Bennett's working hours changed: Tuesday 09:00 to 18:00 became 12:00 to 18:00. They previously followed the venue opening hours.",
      ],
      [
        'staff-hours',
        "Theo B. Bennett's working hours changed: Tuesday 12:00 to 18:00 became 09:00 to 18:00. They now follow the venue opening hours.",
      ],
      ['staff-archived', 'Theo Bennett archived for future bookings. Their history is kept.'],
      ['staff-restored', 'Theo Bennett restored for future bookings.'],
    ])
    expect(history(s)[0]).toMatchObject({ subjectId: theo.id, before: null })
    expect(s.staff.find((p) => p.id === theo.id)!.hours).toBeUndefined()
  })
  it('keeps the latest 500 changes and still loads records saved without any history', () => {
    const s = local()
    expect(
      parseState(JSON.parse(JSON.stringify(s)), 'UK').operations?.scheduleHistory,
    ).toBeUndefined()
    const old = Array.from({ length: SCHEDULE_HISTORY_LIMIT }, (_, i) => ({
      id: `old-${i}`,
      occurredAt: now,
      actor: 'Earlier operator',
      kind: 'hours' as const,
      summary: 'Opening hours changed.',
      before: defaultOperations().hours,
      after: defaultOperations().hours,
    }))
    s.operations!.scheduleHistory = old
    const after = apply(s, { type: 'hours', hours: tuesday({ close: 1020 }) }).state
    expect(history(after)).toHaveLength(SCHEDULE_HISTORY_LIMIT)
    expect(history(after)[0].id).toBe('old-1')
    expect(history(after).at(-1)?.kind).toBe('hours')
    const tooMany = structuredClone(after)
    tooMany.operations!.scheduleHistory!.push({ ...old[0], id: 'one-more' })
    expect(() => parseState(tooMany, 'UK')).toThrow()
  })
  it('rejects schedule history that has lost its professional or its shape', () => {
    const s = apply(local(), {
      type: 'resource',
      id: 'room-two',
      input: { name: 'Treatment room 2', type: 'treatment', archived: true },
    }).state
    const orphan = structuredClone(s)
    orphan.operations!.scheduleHistory![0].subjectId = 'room-elsewhere'
    expect(() => parseState(orphan, 'UK')).toThrow('Invalid schedule history.')
    const misshapen = structuredClone(s)
    misshapen.operations!.scheduleHistory![0].after = null
    expect(() => parseState(misshapen, 'UK')).toThrow('Invalid schedule history.')
    const duplicate = structuredClone(s)
    duplicate.operations!.scheduleHistory!.push(duplicate.operations!.scheduleHistory![0])
    expect(() => parseState(duplicate, 'UK')).toThrow('Duplicate schedule history IDs.')
  })
})

describe('historical terms', () => {
  it('keeps booked duration, turnaround, price and deposit when the service or hours change', () => {
    const s = booked()
    const original = structuredClone(s.appointments[0])
    const service = s.services.find((x) => x.id === visit.serviceId)!
    const input = { ...service }
    let after = apply(s, {
      type: 'service',
      id: service.id,
      input: {
        ...input,
        name: 'Renamed facial',
        durationMinutes: 90,
        bufferMinutes: 30,
        priceMinor: input.priceMinor + 2500,
        depositMinor: input.depositMinor + 500,
      },
    }).state
    after = apply(after, { type: 'hours', hours: tuesday({ close: 1200 }) }).state
    expect(after.appointments[0]).toEqual(original)
    expect(after.appointments[0]).toMatchObject({
      bookedDurationMinutes: 60,
      bookedBufferMinutes: 15,
      bookedServiceName: 'Skin Renewal Facial',
    })
    // The schedule check uses the booked terms, not the new 90 + 30 minute catalogue entry.
    expect(scheduleImpact(after, { type: 'hours', hours: tuesday({ close: 675 }) }, now)).toEqual(
      [],
    )
  })
})
