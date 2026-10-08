// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { workspaceView } from './projections'
import { HttpError } from './http'
import { seed } from '../src/domain/seed'
import { DEMO_DATE } from '../src/domain/model'

describe('the workspace read projection', () => {
  const state = seed('UK')
  const maya = state.staff[0].id
  it('gives desk and management roles the whole studio record', () => {
    for (const role of ['owner', 'manager'] as const)
      expect(workspaceView({ role, staffId: null }, state, DEMO_DATE)).toEqual({
        view: 'studio',
        state,
      })
    // V1.5: guests' private feedback, V2: the team's commission rates and rent, and V5: branch
    // visits, are for owners and managers only.
    const { feedback, ...rest } = state
    const {
      payRates,
      rentals: _rentals,
      rentPayments: _paid,
      checklists: _lists,
      branchVisits,
      ...operations
    } = state.operations!
    void [_rentals, _paid, _lists]
    expect(feedback?.length).toBeGreaterThan(0)
    expect(payRates?.length).toBeGreaterThan(0)
    expect(branchVisits?.length).toBeGreaterThan(0)
    expect(workspaceView({ role: 'reception', staffId: null }, state, DEMO_DATE)).toEqual({
      view: 'studio',
      state: { ...rest, operations },
    })
  })
  it('gives a practitioner only their own visits and minimal client details', () => {
    const record = workspaceView({ role: 'practitioner', staffId: maya }, state, DEMO_DATE)
    if (record.view !== 'practitioner') throw new Error('Expected a practitioner view.')
    const view = record.practitioner
    expect(view.appointments.length).toBeGreaterThan(0)
    const own = new Set(state.appointments.filter((a) => a.staffId === maya).map((a) => a.id))
    expect(view.appointments.every((a) => own.has(a.id))).toBe(true)
    const json = JSON.stringify(record)
    for (const field of ['email', 'phone', 'marketingConsent', 'priceMinor', 'sales', 'payments'])
      expect(json).not.toContain(`"${field}"`)
    for (const client of state.clients) expect(json).not.toContain(client.email)
    const served = new Set(view.appointments.map((a) => a.clientId))
    expect(view.clients.every((client) => served.has(client.id))).toBe(true)
  })
  it('refuses a practitioner without an active linked professional', () => {
    expect(() => workspaceView({ role: 'practitioner', staffId: null }, state, DEMO_DATE)).toThrow(
      HttpError,
    )
    expect(() =>
      workspaceView({ role: 'practitioner', staffId: 'staff-unknown' }, state, DEMO_DATE),
    ).toThrow(HttpError)
  })
})
