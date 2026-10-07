import { describe, expect, it } from 'vitest'
import { execute, slots } from './commands'
import type { Command } from './commands'
import { coverPlan } from './cover'
import type { CoverPlan } from './cover'
import type { BusinessState } from './model'
import { operations } from './operations'
import { seed } from './seed'

const today = '2026-10-06'
const now = '2026-10-06T08:00:00.000Z'
let n = 0
const makeId = () => `cover-${++n}`
const theoVisits = (s: BusinessState) =>
  s.appointments.filter(
    (a) => a.staffId === 'staff-theo' && a.date === today && a.status === 'confirmed',
  )

function withSecondStylist() {
  const s = structuredClone(seed('UK'))
  const theo = s.staff.find((p) => p.id === 'staff-theo')!
  s.staff.push({ ...theo, id: 'staff-rae', name: 'Rae Moss' })
  s.resources.push({
    ...s.resources.find((r) => r.type === 'chair')!,
    id: 'chair-two',
    name: 'Second chair',
  })
  return s
}

function run(s: BusinessState, commands: CoverPlan['commands']) {
  return execute(s, { type: 'batch', label: 'Theo is off', commands }, now, makeId)
}

describe('covering for someone who is off', () => {
  it('moves each visit to someone free at the same time and closes the rest of the day', () => {
    const s = withSecondStylist()
    const visits = theoVisits(s)
    expect(visits.length).toBeGreaterThan(0)
    const plan = coverPlan(s, 'staff-theo', today, now)
    expect(plan.unplaced).toEqual([])
    expect(plan.moves.map((m) => m.toStaffId)).toEqual(visits.map(() => 'staff-rae'))
    const result = run(s, plan.commands)
    if (!result.ok) throw new Error(result.error)
    const after = result.state
    expect(after.revision).toBe(s.revision + 1)
    for (const v of visits) {
      const moved = after.appointments.find((a) => a.id === v.id)!
      expect(moved).toMatchObject({
        staffId: 'staff-rae',
        startMinutes: v.startMinutes,
        status: 'confirmed',
      })
    }
    const drafts = operations(after).messages.filter(
      (m) => !operations(s).messages.some((x) => x.id === m.id),
    )
    expect(drafts).toHaveLength(visits.length)
    expect(drafts.every((m) => m.status === 'draft')).toBe(true)
    expect(slots(after, 'service-cut', 'staff-theo', today, now)).toEqual([])
  })

  it('keeps a visit nobody can take, asks the guest for a new day and closes around it', () => {
    const s = seed('UK')
    const visits = theoVisits(s)
    const plan = coverPlan(s, 'staff-theo', today, now)
    expect(plan.moves).toEqual([])
    expect(plan.unplaced.map((a) => a.id)).toEqual(visits.map((a) => a.id))
    const result = run(s, plan.commands)
    if (!result.ok) throw new Error(result.error)
    for (const v of visits)
      expect(result.state.appointments.find((a) => a.id === v.id)?.status).toBe('confirmed')
    expect(
      operations(result.state).closures.filter((c) => c.staffId === 'staff-theo').length,
    ).toBeGreaterThan(0)
    expect(slots(result.state, 'service-cut', 'staff-theo', today, now)).toEqual([])
  })

  it('leaves visits that have already started where they are', () => {
    const s = withSecondStylist()
    const late = '2026-10-06T15:30:00.000Z'
    const plan = coverPlan(s, 'staff-theo', today, late)
    for (const m of plan.moves) expect(m.appointment.startMinutes).toBeGreaterThan(16 * 60)
  })

  it('applies a batch together or not at all, and only for desk changes', () => {
    const s = withSecondStylist()
    const plan = coverPlan(s, 'staff-theo', today, now)
    const broken = run(s, [
      ...plan.commands,
      { type: 'cancel', appointmentId: 'missing', reason: 'Test' },
    ])
    expect(broken.ok).toBe(false)
    expect(
      execute(
        s,
        {
          type: 'batch',
          label: 'Sneaky',
          commands: [{ type: 'checkout', appointmentId: 'x', tipMinor: 0, method: 'cash' }],
        } as unknown as Command,
        now,
        makeId,
      ).ok,
    ).toBe(false)
  })
})
