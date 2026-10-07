import { describe, expect, it } from 'vitest'
import { seed } from './seed'
import { defaultOperations } from './operations'
import { MANAGE_LINK, composeMessage, planMessages, textNumber, visitSlot } from './reminders'
import type { RecordedMessage } from './reminders'

// PILOT-01: the plan is pure, so the same records and time always give the same messages.
function localStudio() {
  const state = seed('UK')
  state.operations = { ...defaultOperations('local'), hours: defaultOperations().hours }
  const visit = state.appointments.find((a) => a.id === 'visit-noor')!
  visit.date = '2026-10-08'
  visit.createdAt = '2026-10-06T07:00:00.000Z'
  return { state, visit }
}

describe('appointment message plan', () => {
  it('accepts only numbers with a country code for texts', () => {
    expect(textNumber('+44 7700 900 333')).toBe('+447700900333')
    expect(textNumber('+1 (212) 555-0100')).toBe('+12125550100')
    expect(textNumber('07700 900333')).toBeNull()
    expect(textNumber('')).toBeNull()
  })

  it('plans nothing for the sample studio', () => {
    const state = seed('UK')
    expect(planMessages(state, '2026-10-06T07:00:00.000Z', [])).toEqual([])
  })

  it('confirms a recent booking on every allowed channel, and only once', () => {
    const { state, visit } = localStudio()
    state.clients.find((c) => c.id === visit.clientId)!.phone = '+44 7700 900333'
    const plan = planMessages(state, '2026-10-06T08:00:00.000Z', [])
    const mine = plan.filter((m) => m.appointmentId === visit.id)
    expect(mine.map((m) => `${m.kind}:${m.channel}`).sort()).toEqual([
      'confirmation:email',
      'confirmation:sms',
    ])
    const recorded: RecordedMessage[] = mine.map((m) => ({ ...m, status: 'test' }))
    expect(
      planMessages(state, '2026-10-06T08:05:00.000Z', recorded).filter(
        (m) => m.appointmentId === visit.id,
      ),
    ).toEqual([])
  })

  it('does not back-fill confirmations for visits booked long ago', () => {
    const { state, visit } = localStudio()
    visit.createdAt = '2026-09-01T07:00:00.000Z'
    const plan = planMessages(state, '2026-10-06T08:00:00.000Z', [])
    expect(plan.filter((m) => m.appointmentId === visit.id)).toEqual([])
  })

  it('skips a reminder too close to the visit to help', () => {
    const { state, visit } = localStudio()
    visit.createdAt = '2026-09-01T07:00:00.000Z'
    // 11:00 BST on the 8th is 10:00Z; 30 minutes before is too late.
    const late = planMessages(state, '2026-10-08T09:30:00.000Z', [])
    expect(late.filter((m) => m.appointmentId === visit.id)).toEqual([])
    const due = planMessages(state, '2026-10-07T11:00:00.000Z', [])
    expect(due.find((m) => m.appointmentId === visit.id)?.kind).toBe('reminder')
  })

  it('writes plain, honest words with a place for the private link', () => {
    const { state, visit } = localStudio()
    const email = composeMessage(state, visit, 'reminder', 'email')
    expect(email.body).toContain(MANAGE_LINK)
    expect(email.body).toContain('24 hours before')
    const text = composeMessage(state, visit, 'cancelled', 'sms')
    expect(text.body).not.toContain(MANAGE_LINK)
    expect(text.body).toContain('Reply STOP')
    expect(visitSlot(visit)).toBe(`2026-10-08T0660@${visit.staffId}`)
  })
})
