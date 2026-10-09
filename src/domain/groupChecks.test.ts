import { describe, expect, it } from 'vitest'
import { execute } from './commands'
import type { Command } from './commands'
import type { BusinessState } from './model'
import { seed } from './seed'
import { createWorkspace } from './workspace'
import { can } from './operations'
import { groupAlerts, groupCheckSettings } from './groupChecks'
import { areaView } from './area'

// V5: automatic checks across every location.
const now = '2026-10-20T08:00:00.000Z'
const today = '2026-10-20'
let sequence = 0
function apply(s: BusinessState, command: Command) {
  const result = execute(s, command, now, () => `grp-${++sequence}`)
  if (!result.ok) throw new Error(result.error)
  return result.state
}
const refuse = (s: BusinessState, command: Command) => {
  const result = execute(s, command, now, () => `grp-${++sequence}`)
  if (result.ok) throw new Error('Expected a refusal')
  return result.error
}
const branch = (name: string): Command => ({
  type: 'location',
  input: { name, address: `1 ${name} Street` },
})

/** A business with three locations and only the visits written here. */
function business() {
  const sample = seed('UK')
  let s = createWorkspace({ name: 'Group studio', region: 'UK' })
  for (const key of ['clients', 'services', 'staff', 'resources'] as const)
    Object.assign(s, {
      [key]: sample[key].map((row) => ({ ...row, organisationId: s.organisation.id })),
    })
  const template = {
    ...sample.appointments.find((a) => a.status === 'completed')!,
    organisationId: s.organisation.id,
  }
  const sale = {
    ...sample.sales.find((x) => x.appointmentId === template.id)!,
    organisationId: s.organisation.id,
  }
  s = apply(s, branch('Islington'))
  s = apply(s, branch('Leeds'))
  const [main, islington, leeds] = [
    s.organisation.locationId,
    s.operations!.locations![0].id,
    s.operations!.locations![1].id,
  ]
  let n = 0
  const visit = (
    locationId: string,
    date: string,
    takenMinor: number,
    status: 'completed' | 'confirmed' = 'completed',
  ) => {
    const id = `visit-${++n}`
    s.appointments.push({ ...template, id, locationId, date, status, bookedPriceMinor: takenMinor })
    if (status === 'completed')
      s.sales.push({
        ...sale,
        id: `sale-${n}`,
        appointmentId: id,
        serviceMinor: takenMinor,
        discountMinor: 0,
        taxMinor: 0,
        tipMinor: 0,
      })
  }
  return { s, visit, main, islington, leeds }
}

describe('automatic checks', () => {
  it('names a location whose week fell by the chosen share or more', () => {
    const { s, visit, main, islington, leeds } = business()
    // Last 7 days (14 to 20 October) against 7 to 13 October.
    visit(main, '2026-10-15', 10000)
    visit(main, '2026-10-08', 10000)
    visit(islington, '2026-10-16', 8100)
    visit(islington, '2026-10-09', 10000)
    visit(leeds, '2026-10-17', 7000)
    visit(leeds, '2026-10-10', 10000)
    // A fall just under the setting is not rounded up into it: 19.5% stays under 20%.
    const nearly = business()
    nearly.visit(nearly.main, '2026-10-15', 8050)
    nearly.visit(nearly.main, '2026-10-08', 10000)
    expect(groupAlerts(nearly.s, today).some((a) => a.kind === 'takings-drop')).toBe(false)
    const alerts = groupAlerts(s, today).filter((a) => a.kind === 'takings-drop')
    // The default is 20%: Leeds (down 30%) is named, Islington (down 19%) is not.
    expect(alerts.map((a) => a.locationId)).toEqual([leeds])
    expect(alerts[0].title).toBe('Leeds is down 30% this week')
    expect(alerts[0].detail).toBe(
      '£70 from completed visits in the last 7 days, against £100 the 7 days before.',
    )
    // The owner can tighten it, or switch it off.
    const checks = (groupChecks: object) => ({
      ...s,
      operations: { ...s.operations!, groupChecks },
    })
    const tighter = checks({ takingsDropPct: 10 })
    expect(
      groupAlerts(tighter, today)
        .filter((a) => a.kind === 'takings-drop')
        .map((a) => a.locationId),
    ).toEqual([islington, leeds])
    const off = checks({ takingsDropPct: null })
    expect(groupAlerts(off, today).some((a) => a.kind === 'takings-drop')).toBe(false)
    expect(groupCheckSettings(off)).toEqual({
      takingsDropPct: null,
      targetShortPct: 10,
      visitDueDays: 30,
      requestWaitDays: 3,
    })
  })

  it('warns when the month-end estimate is short of the target, from the 7th', () => {
    const { s: start, visit, islington } = business()
    visit(islington, '2026-10-02', 10000)
    const s = {
      ...start,
      operations: {
        ...start.operations!,
        targets: [{ locationId: islington, month: '2026-10', takingsMinor: 100000 }],
      },
    }
    const short = groupAlerts(s, today).filter((a) => a.kind === 'target-short')
    expect(short.map((a) => a.locationId)).toEqual([islington])
    expect(short[0].detail).toMatch(/against a target of £1,000\. This is an estimate/)
    expect(groupAlerts(s, '2026-10-06').some((a) => a.kind === 'target-short')).toBe(false)
  })

  it('lists branch visits due only once there is a checklist', () => {
    const { s: start, main } = business()
    expect(groupAlerts(start, today).some((a) => a.kind === 'visit-due')).toBe(false)
    let s = apply(start, {
      type: 'checklist-save',
      input: { name: 'Quick look', items: [{ text: 'Door glass is clean' }] },
    })
    expect(groupAlerts(s, today).filter((a) => a.kind === 'visit-due')).toHaveLength(3)
    const list = s.operations!.checklists!.find((c) => c.name === 'Quick look')!
    s = apply(s, {
      type: 'branch-visit',
      input: {
        locationId: main,
        checklistId: list.id,
        date: '2026-10-01',
        answers: [{ itemId: list.items[0].id, answer: 'yes' }],
      },
    })
    const due = groupAlerts(s, today).filter((a) => a.kind === 'visit-due')
    expect(due.map((a) => a.locationId)).not.toContain(main)
    expect(due).toHaveLength(2)
    expect(due[0].detail).toBe('Not visited yet.')
    // Thirty days on, the main location is due again.
    expect(
      groupAlerts(s, '2026-10-31')
        .filter((a) => a.kind === 'visit-due')
        .map((a) => a.locationId),
    ).toContain(main)
  })

  it('names a request left waiting, and gives a regional manager only their own', () => {
    const { s: start, islington, leeds } = business()
    let s = apply(start, { type: 'region', input: { name: 'North', locationIds: [leeds] } })
    s = apply(s, { type: 'region', input: { name: 'London', locationIds: [islington] } })
    const north = s.operations!.regions!.find((r) => r.name === 'North')!.id
    for (const locationId of [islington, leeds]) {
      const raised = execute(
        s,
        {
          type: 'request-raise',
          input: { locationId, kind: 'spend', title: 'New basin', amountMinor: 20000 },
          managedRegions: [],
        },
        '2026-10-16T09:00:00.000Z',
        () => `grp-${++sequence}`,
      )
      if (!raised.ok) throw new Error(raised.error)
      s = raised.state
    }
    const waiting = groupAlerts(s, today).filter((a) => a.kind === 'request-waiting')
    expect(waiting).toHaveLength(2)
    expect(waiting[0].title).toMatch(/has waited 4 days$/)
    expect(waiting[0].detail).toBe('“New basin”, waiting for the owner.')
    expect(groupAlerts(s, '2026-10-17').some((a) => a.kind === 'request-waiting')).toBe(false)
    const area = areaView(s, north, today)
    expect(area.alerts.map((a) => a.locationId)).toEqual([leeds])
    // With no checklist in use, the regional summary names no branch visit as due either.
    expect(area.summary.some((line) => line.startsWith('Due a branch visit'))).toBe(false)
    // The day a request was raised is the studio's own day: 23:30 UTC is 00:30 the next day in London.
    const late = execute(
      s,
      {
        type: 'request-raise',
        input: { locationId: leeds, kind: 'spend', title: 'Late basin', amountMinor: 20000 },
        managedRegions: [],
      },
      '2026-10-16T23:30:00.000Z',
      () => `grp-${++sequence}`,
    )
    if (!late.ok) throw new Error(late.error)
    const lateAlert = groupAlerts(late.state, today).find((a) => a.detail.includes('Late basin'))!
    expect(lateAlert.title).toMatch(/has waited 3 days$/)
  })

  it('only lets the owner change the checks, within sensible numbers', () => {
    const { s } = business()
    expect(can('owner', 'group-checks')).toBe(true)
    expect(can('manager', 'group-checks')).toBe(false)
    expect(can('regional', 'group-checks')).toBe(false)
    refuse(s, { type: 'group-checks', checks: { visitDueDays: 3 } })
    const saved = apply(s, { type: 'group-checks', checks: { visitDueDays: 14 } })
    // Settings not chosen keep their defaults.
    expect(groupCheckSettings(saved)).toEqual({
      takingsDropPct: 20,
      targetShortPct: 10,
      visitDueDays: 14,
      requestWaitDays: 3,
    })
  })
})
