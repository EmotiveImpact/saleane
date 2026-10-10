import { describe, expect, it } from 'vitest'
import { execute, slots } from './commands'
import type { Command } from './commands'
import type { BusinessState } from './model'
import { can, operations, permissionFor } from './operations'
import { createWorkspace } from './workspace'
import { seed } from './seed'
import { readySteps } from './readiness'
import { places, staffLocationOn, serviceAt } from './locations'
import { resumeStep, setupFinished, setupPassed, suggestedRooms } from './setup'

const now = '2026-10-06T08:00:00.000Z'
const thursday = '2026-10-08'
let sequence = 0
function run(s: BusinessState, command: Command) {
  return execute(s, command, now, () => `setup-${++sequence}`)
}
function apply(s: BusinessState, command: Command) {
  const result = run(s, command)
  if (!result.ok) throw new Error(result.error)
  return result.state
}
const fresh = () => createWorkspace({ name: 'Linden Studio', region: 'UK', locationName: 'Bath' })
const step = (next: string, changes: unknown[] = []) =>
  ({ type: 'setup-step', next, changes }) as Command
const treatment = (name: string, input: Record<string, unknown> = {}) => ({
  type: 'service',
  input: {
    name,
    description: '',
    category: 'Skin',
    durationMinutes: 60,
    bufferMinutes: 15,
    priceMinor: 8500,
    depositMinor: 0,
    resourceType: 'treatment',
    archived: false,
    ...input,
  },
})

describe('set up your studio', () => {
  it('saves a screen’s changes together and remembers where the owner reached', () => {
    const start = fresh()
    expect(resumeStep(start)).toBe('studio')
    const s = apply(
      start,
      step('treatments', [treatment('Signature facial'), treatment('Express facial')]),
    )
    expect(s.services.map((x) => x.name)).toEqual(['Signature facial', 'Express facial'])
    expect(s.revision).toBe(start.revision + 1)
    expect(operations(s).setup).toEqual({ next: 'treatments' })
    expect(resumeStep(s)).toBe('treatments')
  })

  it('saves nothing when one change is refused', () => {
    const start = fresh()
    const result = run(
      start,
      step('team', [
        treatment('Signature facial'),
        treatment('Too dear a deposit', { depositMinor: 9000 }),
      ]),
    )
    expect(result).toEqual({
      ok: false,
      error: 'The deposit cannot be more than the treatment price.',
    })
  })

  it('refuses anything Settings does not make, and incomplete changes', () => {
    const start = fresh()
    expect(run(start, step('hours', [{ type: 'checkout', appointmentId: 'x' }])).ok).toBe(false)
    expect(run(start, step('hours', [{ type: 'service', input: { name: 'Facial' } }])).ok).toBe(
      false,
    )
  })

  it('never moves the owner back when they return to an earlier screen', () => {
    let s = apply(fresh(), step('rooms'))
    s = apply(s, step('hours'))
    expect(resumeStep(s)).toBe('rooms')
    s = apply(s, step('done'))
    expect(setupFinished(s)).toBe(true)
    expect(operations(s).setup?.finishedAt).toBe(now)
    // Looking through again after finishing starts at the first screen and stays finished.
    expect(resumeStep(s)).toBe('studio')
    expect(apply(s, step('team'))).toBe(s)
  })

  it('leaves the studio untouched when nothing changed', () => {
    const s = apply(fresh(), step('team'))
    expect(run(s, step('team'))).toMatchObject({ ok: true, state: s })
  })

  it('ticks the opening hours and deposit steps once the owner has been past them', () => {
    const tick = (s: BusinessState) =>
      Object.fromEntries(readySteps(s).map((x) => [x.id, x.done])) as Record<string, boolean>
    let s = fresh()
    expect(tick(s)).toMatchObject({ hours: false, deposits: false })
    s = apply(s, step('treatments'))
    expect(setupPassed(s, 'hours')).toBe(true)
    expect(tick(s)).toMatchObject({ hours: true, deposits: false })
    s = apply(s, step('open'))
    expect(tick(s)).toMatchObject({ hours: true, deposits: true, online: false })
  })

  it('is for the owner, and needs the right to make each change', () => {
    const setup = step('team', [treatment('Facial')])
    expect(permissionFor(setup)).toBe('setup-step')
    expect(can('owner', 'setup-step')).toBe(true)
    for (const role of ['manager', 'reception', 'practitioner', 'general', 'regional'] as const)
      expect(can(role, 'setup-step')).toBe(false)
  })

  it('suggests a room or chair for each kind of treatment the studio has no space for yet', () => {
    const facial = { resourceType: 'treatment' as const }
    const cut = { resourceType: 'chair' as const }
    expect(suggestedRooms([facial, cut], [])).toEqual([
      { type: 'treatment', name: 'Treatment room 1' },
      { type: 'chair', name: 'Styling chair 1' },
    ])
    expect(suggestedRooms([facial, cut], [{ type: 'chair' }])).toEqual([
      { type: 'treatment', name: 'Treatment room 1' },
    ])
    expect(suggestedRooms([{ ...cut, archived: true }], [])).toEqual([])
  })
})

/** A local studio with the sample menu, team and rooms. */
function studio(): BusinessState {
  const s = createWorkspace({ name: 'Two-site studio', region: 'UK' })
  const sample = seed('UK')
  for (const key of ['clients', 'services', 'staff', 'resources'] as const)
    Object.assign(s, {
      [key]: sample[key].map((row) => ({ ...row, organisationId: s.organisation.id })),
    })
  return s
}
const opening = (input: Record<string, unknown> = {}) =>
  ({
    type: 'location-open',
    location: { name: 'Islington', address: '1 Upper Street, London' },
    rooms: [{ name: 'Islington room 1', type: 'treatment' }],
    team: [{ staffId: 'staff-maya', days: [4] }],
    newTeam: [],
    notOffered: [],
    prices: [],
    ...input,
  }) as Command

describe('add a location', () => {
  it('opens the location with its rooms, team days and menu together', () => {
    const start = studio()
    const result = run(
      start,
      opening({
        newTeam: [
          {
            name: 'Ines Duarte',
            role: 'Hair & styling',
            tone: 'blue',
            serviceIds: ['service-cut'],
            days: [5, 6],
          },
        ],
        rooms: [
          { name: 'Islington room 1', type: 'treatment' },
          { name: 'Islington chair', type: 'chair', restMinutes: 10 },
        ],
        notOffered: ['service-lymphatic'],
        prices: [
          { serviceId: 'service-facial', priceMinor: 10500 },
          // The house price again is not a price of its own.
          { serviceId: 'service-cut', priceMinor: 7500 },
        ],
      }),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const s = result.state
    const islington = places(s).find((p) => p.name === 'Islington')!
    expect(result.recordId).toBe(islington.id)
    expect(s.revision).toBe(start.revision + 1)
    expect(s.resources.filter((r) => r.locationId === islington.id)).toMatchObject([
      { name: 'Islington room 1', type: 'treatment' },
      { name: 'Islington chair', type: 'chair', restMinutes: 10 },
    ])
    // Maya works Thursdays in Islington and keeps her usual times; every other day is unchanged.
    expect(staffLocationOn(s, 'staff-maya', thursday)).toBe(islington.id)
    expect(staffLocationOn(s, 'staff-maya', '2026-10-07')).toBe(s.organisation.locationId)
    const ines = s.staff.find((p) => p.name === 'Ines Duarte')!
    expect(ines.hours!.filter((h) => !h.closed).map((h) => [h.day, h.locationId])).toEqual([
      [5, islington.id],
      [6, islington.id],
    ])
    const facial = s.services.find((x) => x.id === 'service-facial')!
    expect(serviceAt(facial, islington.id).priceMinor).toBe(10500)
    expect(s.services.find((x) => x.id === 'service-cut')!.locationPrices).toBeUndefined()
    expect(s.services.find((x) => x.id === 'service-lymphatic')!.notOfferedAt).toEqual([
      islington.id,
    ])
    // A guest can now book a facial with Maya in Islington on Thursday.
    expect(slots(s, 'service-facial', 'staff-maya', thursday, now, islington.id)).toContain(600)
  })

  it('refuses a location where nobody working there gives a treatment on its menu', () => {
    const result = run(
      studio(),
      opening({
        team: [{ staffId: 'staff-theo', days: [4] }],
        notOffered: ['service-cut', 'service-gloss'],
      }),
    )
    expect(result).toEqual({
      ok: false,
      error:
        'Nobody working at Islington gives a treatment on its menu, so guests could not book there. Choose someone who does.',
    })
    // Someone new who gives a facial there is enough.
    const opened = run(
      studio(),
      opening({
        team: [],
        newTeam: [
          {
            name: 'Ines Duarte',
            role: 'Skin',
            tone: 'blue',
            serviceIds: ['service-facial'],
            days: [5],
          },
        ],
      }),
    )
    expect(opened.ok).toBe(true)
  })
  it('gives someone the location’s hours on a day they had off', () => {
    const start = studio()
    // Theo works Tuesday to Saturday, so Monday is a day off.
    const s = apply(
      start,
      opening({
        location: {
          name: 'Islington',
          address: '1 Upper Street',
          hours: operations(start).hours.map((h) => ({ ...h, open: 600, close: 960 })),
        },
        team: [{ staffId: 'staff-theo', days: [1] }],
      }),
    )
    const monday = s.staff.find((p) => p.id === 'staff-theo')!.hours!.find((h) => h.day === 1)!
    expect(monday).toMatchObject({ open: 600, close: 960, closed: false })
  })

  it('saves nothing when any part is refused', () => {
    const start = studio()
    for (const [input, error] of [
      [{ team: [{ staffId: 'staff-maya', days: [0] }] }, 'Islington is closed on Sundays.'],
      [{ team: [{ staffId: 'nobody', days: [1] }] }, 'Choose someone on the team.'],
      [
        { location: { name: start.organisation.locationName, address: '' } },
        'Another location already has that name.',
      ],
      [{ notOffered: ['service-unknown'] }, 'Choose treatments on your menu.'],
    ] as const) {
      const result = run(start, opening(input))
      expect(result).toEqual({ ok: false, error })
    }
  })

  it('keeps the house rules and the visits already booked', () => {
    const ruled = apply(studio(), {
      type: 'house-rules',
      priceBandPercent: 10,
      coreServiceIds: ['service-facial'],
    } as Command)
    expect(run(ruled, opening({ notOffered: ['service-facial'] }))).toMatchObject({ ok: false })
    expect(
      run(ruled, opening({ prices: [{ serviceId: 'service-cut', priceMinor: 9900 }] })),
    ).toMatchObject({ ok: false })
    // Maya has a facial booked at the main location on Thursday, so she cannot move there that day.
    const booked = run(studio(), {
      type: 'book',
      input: {
        serviceId: 'service-facial',
        staffId: 'staff-maya',
        date: thursday,
        startMinutes: 600,
        clientId: 'client-1',
        source: 'desk',
      },
    } as Command)
    if (!booked.ok) throw new Error(booked.error)
    const result = run(booked.state, opening())
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('working at another location that day')
  })

  it('is for the owner', () => {
    expect(permissionFor(opening())).toBe('location')
    expect(can('owner', 'location')).toBe(true)
    expect(can('manager', 'location')).toBe(false)
  })
})
