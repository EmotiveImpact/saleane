import { describe, expect, it } from 'vitest'
import { seed } from './seed'
import { execute } from './commands'
import type { Command } from './commands'
import type { BusinessState } from './model'
import { can, defaultOperations, permissionFor } from './operations'
import {
  BOOK_LINK,
  birthdayDue,
  birthdayIn,
  composeClientMessage,
  missYouDue,
  missYouFrom,
  planMessages,
} from './reminders'
import type { RecordedMessage } from './reminders'

// V1.5: a birthday email and a "we miss you" email, for guests who agreed to hear.
let sequence = 0
function run(s: BusinessState, command: Command) {
  return execute(s, command, '2026-10-06T12:00:00.000Z', () => `kit-${++sequence}`)
}
function local() {
  const state = seed('UK')
  state.operations = { ...defaultOperations('local'), hours: defaultOperations().hours }
  return state
}
const noor = (s: BusinessState) => s.clients.find((c) => c.id === 'client-1')!
// 9 October 2026, 10:00 in London.
const birthday = '2026-10-09T09:00:00.000Z'
const kinds = (s: BusinessState, at: string, recorded: RecordedMessage[] = []) =>
  planMessages(s, at, recorded)
    .filter((m) => m.kind === 'birthday' || m.kind === 'miss_you')
    .map((m) => `${m.clientId}:${m.kind}:${m.slot}`)

describe('birthday email', () => {
  it('moves 29 February to the 28th outside leap years', () => {
    expect(birthdayIn('02-29', 2027)).toBe('2027-02-28')
    expect(birthdayIn('02-29', 2028)).toBe('2028-02-29')
    expect(birthdayIn('10-09', 2026)).toBe('2026-10-09')
  })

  it('goes once on the day, in the daytime, to a guest who agreed', () => {
    const s = local()
    expect(birthdayDue(s, noor(s), '2026-10-08T12:00:00.000Z')).toBe(false)
    expect(birthdayDue(s, noor(s), '2026-10-09T06:00:00.000Z')).toBe(false)
    const plan = planMessages(s, birthday, []).filter((m) => m.kind === 'birthday')
    expect(plan.map((m) => [m.clientId, m.slot, m.appointmentId])).toEqual([
      ['client-1', '2026', ''],
    ])
    expect(plan[0].subject).toBe(`Happy birthday from ${s.organisation.name}`)
    expect(plan[0].body).toContain('To stop these, reply to this email')
    const recorded: RecordedMessage[] = plan.map((m) => ({ ...m, status: 'skipped' }))
    expect(kinds(s, '2026-10-09T12:00:00.000Z', recorded)).not.toContain('client-1:birthday:2026')
  })

  it('needs agreement on every record, the setting, and one record per guest', () => {
    const s = local()
    const off = structuredClone(s)
    off.operations!.reminders = { ...off.operations!.reminders!, birthday: false }
    expect(birthdayDue(off, noor(off), birthday)).toBe(false)
    const declined = structuredClone(s)
    declined.clients.push({ ...noor(s), id: 'client-z', marketingConsent: false })
    expect(birthdayDue(declined, noor(declined), birthday)).toBe(false)
    const twin = structuredClone(s)
    twin.clients.push({ ...noor(s), id: 'client-z' })
    expect(kinds(twin, birthday).filter((k) => k.includes('birthday'))).toEqual([
      'client-1:birthday:2026',
    ])
  })

  it('lets reception record a birthday, month and day only, and refuses a date that cannot exist', () => {
    const s = seed('UK')
    const set = run(s, { type: 'client-birthday', clientId: 'client-2', birthday: '02-29' })
    if (!set.ok) throw new Error(set.error)
    expect(set.state.clients.find((c) => c.id === 'client-2')!.birthday).toBe('02-29')
    expect(set.state.events.at(-1)).toMatchObject({ title: 'Birthday recorded' })
    const again = run(set.state, {
      type: 'client-birthday',
      clientId: 'client-2',
      birthday: '02-29',
    })
    if (!again.ok) throw new Error(again.error)
    expect(again.state.events).toHaveLength(set.state.events.length)
    expect(run(s, { type: 'client-birthday', clientId: 'client-2', birthday: '02-30' }).ok).toBe(
      false,
    )
    expect(
      run(s, { type: 'client-birthday', clientId: 'client-2', birthday: '1990-02-01' }).ok,
    ).toBe(false)
    const cleared = run(set.state, {
      type: 'client-birthday',
      clientId: 'client-2',
      birthday: null,
    })
    if (!cleared.ok) throw new Error(cleared.error)
    expect(cleared.state.clients.find((c) => c.id === 'client-2')).not.toHaveProperty('birthday')
    const action = permissionFor({ type: 'client-birthday' })
    expect(can('reception', action)).toBe(true)
    expect(can('practitioner', action)).toBe(false)
  })
})

describe('we miss you', () => {
  /** Noor's only visit is a completed facial on the given date; nothing is booked. */
  function lapsed(date: string) {
    const s = local()
    const visit = s.appointments.find((a) => a.status === 'completed')!
    s.appointments = s.appointments.filter((a) => a.clientId !== 'client-1')
    s.appointments.push({
      ...visit,
      id: 'visit-last',
      clientId: 'client-1',
      date,
      serviceId: 'service-facial',
    })
    delete s.appointments.at(-1)!.bookedServiceName
    return s
  }

  it('goes once, from three months after the last visit, for a month', () => {
    const s = lapsed('2026-07-01')
    expect(missYouFrom(s, s.appointments.at(-1)!)).toBe('2026-09-29')
    expect(missYouDue(s, noor(s), '2026-09-28T10:00:00.000Z')).toBe(false)
    const plan = planMessages(s, '2026-09-29T10:00:00.000Z', []).filter(
      (m) => m.kind === 'miss_you',
    )
    expect(plan.map((m) => [m.clientId, m.slot])).toEqual([['client-1', 'visit-last']])
    expect(plan[0].subject).toBe(`We miss you at ${s.organisation.name}`)
    expect(plan[0].body).toContain(BOOK_LINK)
    const recorded: RecordedMessage[] = plan.map((m) => ({ ...m, status: 'test' }))
    expect(kinds(s, '2026-10-01T10:00:00.000Z', recorded)).toEqual([])
    // A long-lapsed guest is not swept up when the studio first switches it on.
    expect(missYouDue(s, noor(s), '2026-10-29T10:00:00.000Z')).toBe(false)
  })

  it('waits for nothing booked, agreement and the setting, and follows the chosen gap', () => {
    const s = lapsed('2026-07-01')
    const at = '2026-09-30T10:00:00.000Z'
    expect(missYouDue(s, noor(s), at)).toBe(true)
    const booked = structuredClone(s)
    booked.appointments.push({
      ...s.appointments.at(-1)!,
      id: 'visit-next',
      date: '2026-10-20',
      status: 'confirmed',
    })
    expect(missYouDue(booked, noor(booked), at)).toBe(false)
    const declined = structuredClone(s)
    noor(declined).marketingConsent = false
    expect(missYouDue(declined, noor(declined), at)).toBe(false)
    const off = structuredClone(s)
    off.operations!.reminders = { ...off.operations!.reminders!, missYou: false }
    expect(missYouDue(off, noor(off), at)).toBe(false)
    const sooner = structuredClone(s)
    sooner.operations!.reminders = { ...sooner.operations!.reminders!, missYouDays: 60 }
    expect(missYouFrom(sooner, sooner.appointments.at(-1)!)).toBe('2026-08-30')
  })

  it('never lands while a due back note could still be on its way', () => {
    const s = lapsed('2026-07-01')
    s.services.find((x) => x.id === 'service-facial')!.returnWeeks = 12
    // Due back on 23 September, tried until 7 October; "we miss you" waits two more weeks.
    expect(missYouFrom(s, s.appointments.at(-1)!)).toBe('2026-10-21')
  })

  it('asks the guest to get in touch when online booking is off', () => {
    const s = local()
    s.operations!.bookingEnabled = false
    for (const kind of ['birthday', 'miss_you'] as const)
      expect(composeClientMessage(s, noor(s), kind).body).not.toContain(BOOK_LINK)
  })
})
