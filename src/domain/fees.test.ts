import { describe, expect, it } from 'vitest'
import { seed } from './seed'
import { defaultOperations } from './operations'
import { feeAllowed } from './fees'
import { cardPolicy, guestPayment } from './guest'

// PILOT-02: the fee rule and what a guest is offered come from the studio's own settings.
function studio(feePercent: number) {
  const state = seed('UK')
  state.operations = {
    ...defaultOperations('local'),
    hours: defaultOperations().hours,
    protection: { saveCard: true, feePercent },
  }
  const visit = state.appointments.find((a) => a.id === 'visit-noor')!
  visit.date = '2026-10-08'
  visit.bookedPriceMinor = 10000
  visit.bookedDepositMinor = 2000
  state.payments = state.payments.filter((p) => p.appointmentId !== visit.id)
  return { state, visit }
}
const cancelledAt = (s: ReturnType<typeof studio>, at: string) => {
  s.visit.status = 'cancelled'
  s.state.events.push({
    id: 'cancel-event',
    organisationId: s.state.organisation.id,
    clientId: s.visit.clientId,
    appointmentId: s.visit.id,
    type: 'cancelled',
    title: 'Appointment cancelled',
    detail: 'Fictional',
    occurredAt: at,
    actor: 'Test',
  })
}

describe('missed visit fees', () => {
  it('allows none without a policy, or for an upcoming visit', () => {
    expect(feeAllowed(studio(0).state, 'visit-noor')).toBe(0)
    expect(feeAllowed(studio(50).state, 'visit-noor')).toBe(0)
  })

  it('allows the policy share for a missed visit, less what was already taken', () => {
    const s = studio(50)
    s.visit.status = 'no_show'
    expect(feeAllowed(s.state, 'visit-noor')).toBe(5000)
    s.state.payments.push({
      id: 'deposit-1',
      organisationId: s.state.organisation.id,
      appointmentId: s.visit.id,
      kind: 'deposit',
      amountMinor: 2000,
      currency: 'GBP',
      recordedAt: '2026-10-01T10:00:00.000Z',
      method: 'cash',
    })
    expect(feeAllowed(s.state, 'visit-noor')).toBe(3000)
  })

  it('allows a fee only for a cancellation inside 24 hours', () => {
    const early = studio(100)
    // The visit starts at 11:00 BST on the 8th, which is 10:00Z.
    cancelledAt(early, '2026-10-07T09:00:00.000Z')
    expect(feeAllowed(early.state, 'visit-noor')).toBe(0)
    const late = studio(100)
    cancelledAt(late, '2026-10-07T11:00:00.000Z')
    expect(feeAllowed(late.state, 'visit-noor')).toBe(10000)
  })
})

describe('guest payment offer', () => {
  it('asks for the unpaid deposit and offers to save a card under plain terms', () => {
    const { state } = studio(50)
    const offer = guestPayment(state, 'visit-noor', Date.parse('2026-10-06T07:00:00.000Z'), {
      testMode: true,
      savedCard: null,
      pending: false,
    })
    expect(offer).toMatchObject({ depositDueMinor: 2000, saveCardOffered: true, testMode: true })
    expect(cardPolicy(state)).toContain('up to 50% of the booked price')
  })

  it('offers nothing for a sample studio or a visit that has started', () => {
    const sample = seed('UK')
    expect(
      guestPayment(sample, 'visit-noor', Date.parse('2026-10-06T07:00:00.000Z'), {
        testMode: true,
        savedCard: null,
        pending: false,
      }),
    ).toBeNull()
    const { state } = studio(50)
    expect(
      guestPayment(state, 'visit-noor', Date.parse('2026-10-08T10:30:00.000Z'), {
        testMode: true,
        savedCard: null,
        pending: false,
      }),
    ).toBeNull()
  })
})
