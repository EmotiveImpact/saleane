import { describe, expect, it } from 'vitest'
import { seed } from './seed'
import { DEMO_DATE } from './model'
import { practitionerView } from './practitioner'
import { addDays } from './format'
import { firstName, nextUp, previousWithYou, untilLabel, venueMinutes } from './pocket'

const record = practitionerView(seed('UK'), 'staff-maya', DEMO_DATE)
const today = record.appointments.filter((a) => a.date === DEMO_DATE)
const visitFor = (clientId: string, date = DEMO_DATE) =>
  record.appointments.find((a) => a.clientId === clientId && a.date === date)!
const clientFor = (id: string) => record.clients.find((c) => c.id === id)!

describe('the pocket view helpers', () => {
  it('reads the venue wall clock, not the phone’s', () => {
    expect(venueMinutes('Europe/London', Date.parse('2026-10-06T09:45:00Z'))).toBe(645)
    expect(venueMinutes('America/New_York', Date.parse('2026-10-06T14:05:00Z'))).toBe(605)
  })

  it('puts the visit still to come or under way first', () => {
    // Amelia (09:30, welcomed) is under way at 10:00, then Noor (11:00) is next.
    expect(nextUp(today, 600)?.clientId).toBe('client-1')
    expect(nextUp(today, 645)?.clientId).toBe('client-4')
    expect(nextUp(today, 23 * 60)).toBeUndefined()
    const finished = today.map((a) => ({ ...a, status: 'completed' as const }))
    expect(nextUp(finished, 0)).toBeUndefined()
  })

  it('says how long until a start in plain words', () => {
    expect(untilLabel(660, 645)).toBe('In 15 min')
    expect(untilLabel(660, 540)).toBe('In 2 hr')
    expect(untilLabel(660, 520)).toBe('In 2 hr 20 min')
    expect(untilLabel(660, 660)).toBe('Now')
    expect(untilLabel(660, 700)).toBe('Now')
  })

  it('finds the last visit together, inside the window or from the server beyond it', () => {
    // Ruby's last massage with Maya was a fortnight ago, inside the window.
    const ruby = previousWithYou(record, visitFor('client-10'), clientFor('client-10'))
    expect(ruby).toEqual({ date: addDays(DEMO_DATE, -14), serviceName: 'Deep Restore Massage' })
    // Amelia last saw Maya three weeks ago, before the window; only the server field knows.
    const amelia = clientFor('client-1')
    expect(amelia.previousVisit?.date).toBe(addDays(DEMO_DATE, -21))
    expect(previousWithYou(record, visitFor('client-1'), amelia)).toEqual(amelia.previousVisit)
    // With no earlier visit on record the answer is a definite none.
    expect(previousWithYou(record, visitFor('client-1'), { ...amelia, previousVisit: null })).toBe(
      null,
    )
  })

  it('admits when an earlier day’s history lies before the window', () => {
    const oldest = record.appointments.find(
      (a) => a.date === record.window.from && a.status === 'completed',
    )!
    const client = clientFor(oldest.clientId)
    expect(client.previousVisit).not.toBeNull()
    expect(previousWithYou(record, oldest, client)).toBeUndefined()
  })

  it('uses a first name for a glance', () => {
    expect(firstName('Noor Ahmed')).toBe('Noor')
    expect(firstName('  Cher ')).toBe('Cher')
  })
})
