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
    // V1.5: guests' private feedback, V2: the team's commission rates and rent, Stage 3: rates
    // for treatments and products, steps by takings and targets, and V5: branch visits, are for
    // owners and managers only. Rentals stay without their terms, so the desk's figures can leave
    // a renter's own takings out.
    const { feedback, ...rest } = state
    const {
      payRates,
      rentals,
      rentPayments: _paid,
      commissionRates,
      commissionSteps,
      staffTargets,
      checklists: _lists,
      branchVisits,
      // Stage 4: requests for a sign-off and the owner's rules are not the desk's either.
      requests,
      approvals: _rules,
      ...operations
    } = state.operations!
    void [_paid, _lists, _rules]
    expect(requests?.length).toBeGreaterThan(0)
    expect(feedback?.length).toBeGreaterThan(0)
    expect(payRates?.length).toBeGreaterThan(0)
    expect(commissionRates?.length).toBeGreaterThan(0)
    expect(commissionSteps?.length).toBeGreaterThan(0)
    expect(staffTargets?.length).toBeGreaterThan(0)
    expect(branchVisits?.length).toBeGreaterThan(0)
    const terms = rentals!.map((rental) => {
      const { percentBps: _share, ...kept } = rental
      void _share
      return { ...kept, amountMinor: 0 }
    })
    expect(rentals!.some((rental) => rental.amountMinor > 0 && rental.percentBps)).toBe(true)
    expect(workspaceView({ role: 'reception', staffId: null }, state, DEMO_DATE)).toEqual({
      view: 'studio',
      state: { ...rest, operations: { ...operations, rentals: terms } },
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
