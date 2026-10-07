import { describe, expect, it } from 'vitest'
import { seed } from './seed'
import { execute } from './commands'
import type { Command } from './commands'
import type { BusinessState } from './model'
import { parseState } from './model'
import { can, operations } from './operations'
import { openings, timeOfDay, waiting, waitlistSummary } from './waitlist'
import type { WaitlistInput } from './waitlistSchema'
import { guestView } from './guest'
import { clientExport, erasureReview, previewClientExport } from './privacy'
import { RETENTION_REGISTER } from './dataRetention'

// V1.5: the waitlist.
const now = '2026-10-06T08:00:00.000Z'
let sequence = 0
function apply(s: BusinessState, command: Command) {
  const result = execute(s, command, now, () => `wl-${++sequence}`)
  if (!result.ok) throw new Error(result.error)
  return result.state
}
const run = (s: BusinessState, command: Command) =>
  execute(s, command, now, () => `wl-${++sequence}`)
const wish: WaitlistInput = {
  clientId: 'client-1',
  serviceId: 'service-facial',
  fromDate: '2026-10-07',
  toDate: '2026-10-20',
  times: ['morning'],
  note: ' Short notice is fine ',
}
/** Amelia's facial with Maya next week, for a guest who would like to come in sooner. */
function withLaterVisit(s = seed('UK')) {
  const next = apply(s, {
    type: 'book',
    input: {
      clientId: 'client-1',
      serviceId: 'service-facial',
      staffId: 'staff-maya',
      date: '2026-10-16',
      startMinutes: 600,
      source: 'desk',
    },
  })
  return { s: next, visit: next.appointments.at(-1)! }
}

describe('waitlist', () => {
  it('seeds people waiting, and shows times that suit each of them', () => {
    const s = seed('UK')
    expect(parseState(structuredClone(s), 'UK')).toBeTruthy()
    expect(waiting(s)).toHaveLength(3)
    for (const entry of waiting(s)) {
      const found = openings(s, entry, now)
      expect(found.length).toBeGreaterThan(0)
      for (const o of found) {
        expect(o.date >= entry.fromDate && o.date <= entry.toDate).toBe(true)
        if (entry.staffId) expect(o.staffId).toBe(entry.staffId)
        if (entry.times.length) expect(entry.times).toContain(timeOfDay(o.startMinutes))
      }
    }
  })

  it('adds a request once, with sensible limits', () => {
    const s = seed('UK')
    const next = apply(s, { type: 'waitlist-add', input: wish })
    const entry = next.waitlist!.at(-1)!
    expect(entry).toMatchObject({ status: 'waiting', source: 'desk', note: 'Short notice is fine' })
    expect(next.events.at(-1)).toMatchObject({ type: 'waitlist', clientId: 'client-1' })
    // A retry changes nothing, not even the revision; a second request for the same service is refused.
    expect(apply(next, { type: 'waitlist-add', input: wish })).toBe(next)
    expect(run(next, { type: 'waitlist-add', input: { ...wish, toDate: '2026-10-21' } }).ok).toBe(
      false,
    )
    const refused: Partial<WaitlistInput>[] = [
      { fromDate: '2026-10-05' },
      { toDate: '2026-10-06' },
      { toDate: '2027-01-30' },
      { staffId: 'staff-theo' },
      { clientId: 'client-unknown' },
    ]
    for (const change of refused)
      expect(run(s, { type: 'waitlist-add', input: { ...wish, ...change } }).ok).toBe(false)
  })

  it('books an opening for them and counts what it filled', () => {
    const s = apply(seed('UK'), { type: 'waitlist-add', input: wish })
    const entry = s.waitlist!.at(-1)!
    const [first] = openings(s, entry, now)
    expect(timeOfDay(first.startMinutes)).toBe('morning')
    const next = apply(s, {
      type: 'book',
      input: {
        clientId: 'client-1',
        serviceId: 'service-facial',
        source: 'desk',
        waitlistId: entry.id,
        ...first,
      },
    })
    const booked = next.waitlist!.find((e) => e.id === entry.id)!
    const visit = next.appointments.at(-1)!
    expect(booked).toMatchObject({ status: 'booked', outcomeAppointmentId: visit.id })
    expect(waitlistSummary(next, '2026-10-01T00:00:00.000Z')).toMatchObject({
      waiting: 3,
      filled: 1,
      valueMinor: visit.bookedPriceMinor,
    })
    // Someone else cannot fill this request, and a filled one cannot be filled twice.
    const other = run(s, {
      type: 'book',
      input: {
        clientId: 'client-2',
        serviceId: 'service-facial',
        source: 'desk',
        waitlistId: entry.id,
        ...first,
      },
    })
    expect(other.ok).toBe(false)
    const second = openings(s, entry, now)[1]
    expect(
      run(next, {
        type: 'book',
        input: {
          clientId: 'client-1',
          serviceId: 'service-facial',
          source: 'desk',
          waitlistId: entry.id,
          ...second,
        },
      }).ok,
    ).toBe(false)
  })

  it('writes an offer as an Inbox draft and never sends it', () => {
    const s = seed('UK')
    const entry = waiting(s)[0]
    const opening = openings(s, entry, now)[0]
    const next = apply(s, { type: 'waitlist-offer', entryId: entry.id, ...opening })
    const message = operations(next).messages.at(-1)!
    expect(message).toMatchObject({
      status: 'draft',
      clientId: entry.clientId,
      purpose: 'appointment',
    })
    expect(message.body).toContain('not held for you')
    expect(next.waitlist!.find((e) => e.id === entry.id)!.offers).toHaveLength(1)
    expect(next.events.at(-1)!.detail).toContain('delivery is unconfigured')
    // A time that is not free for them cannot be offered.
    expect(
      run(s, { type: 'waitlist-offer', entryId: entry.id, ...opening, startMinutes: 1430 }).ok,
    ).toBe(false)
  })

  it('takes someone off the list, keeping the request and the reason', () => {
    const s = seed('UK')
    const entry = waiting(s)[0]
    const command: Command = {
      type: 'waitlist-remove',
      entryId: entry.id,
      reason: 'Booked elsewhere',
    }
    const next = apply(s, command)
    expect(next.waitlist!.find((e) => e.id === entry.id)).toMatchObject({
      status: 'removed',
      removedReason: 'Booked elsewhere',
    })
    expect(apply(next, command)).toBe(next)
    expect(
      openings(
        next,
        next.waitlist!.find((e) => e.id === entry.id)!,
        now,
      ),
    ).toEqual([])
  })

  it('lets a guest ask to come in sooner, change their mind and leave', () => {
    const { s, visit } = withLaterVisit()
    const join: Command = {
      type: 'waitlist-join',
      appointmentId: visit.id,
      anyone: false,
      times: [],
    }
    const joined = apply(s, join)
    const entry = joined.waitlist!.at(-1)!
    expect(entry).toMatchObject({
      source: 'guest',
      staffId: 'staff-maya',
      fromDate: '2026-10-06',
      toDate: '2026-10-15',
      appointmentId: visit.id,
    })
    expect(apply(joined, join)).toBe(joined)
    expect(guestView(joined, visit.id, Date.parse(now)).waitlist).toEqual({
      joined: { anyone: false, times: [] },
    })
    // Changing their answer replaces the request rather than adding another.
    const changed = apply(joined, { ...join, anyone: true, times: ['evening'] } as Command)
    expect(waiting(changed).filter((e) => e.appointmentId === visit.id)).toHaveLength(1)
    expect(waiting(changed).find((e) => e.appointmentId === visit.id)!.staffId).toBeUndefined()
    const left = apply(changed, { type: 'waitlist-leave', appointmentId: visit.id })
    expect(waiting(left).some((e) => e.appointmentId === visit.id)).toBe(false)
    expect(guestView(left, visit.id, Date.parse(now)).waitlist).toEqual({ joined: null })
    // Only the guest's private link may do this; no staff role can act for them.
    for (const role of ['owner', 'manager', 'reception', 'practitioner'] as const) {
      expect(can(role, 'waitlist-join')).toBe(false)
      expect(can(role, 'waitlist-leave')).toBe(false)
    }
    expect(can('reception', 'waitlist-add')).toBe(true)
    expect(can('practitioner', 'waitlist-add')).toBe(false)
  })

  it('moves the guest’s own visit earlier rather than booking a second one', () => {
    const { s, visit } = withLaterVisit()
    const joined = apply(s, {
      type: 'waitlist-join',
      appointmentId: visit.id,
      anyone: false,
      times: [],
    })
    const entry = joined.waitlist!.at(-1)!
    const opening = openings(joined, entry, now)[0]
    expect(
      run(joined, {
        type: 'book',
        input: {
          clientId: 'client-1',
          serviceId: 'service-facial',
          source: 'desk',
          waitlistId: entry.id,
          ...opening,
        },
      }).ok,
    ).toBe(false)
    const moved = apply(joined, {
      type: 'reschedule',
      appointmentId: visit.id,
      waitlistId: entry.id,
      ...opening,
    })
    expect(moved.appointments.find((a) => a.id === visit.id)).toMatchObject({
      date: opening.date,
      startMinutes: opening.startMinutes,
    })
    expect(moved.waitlist!.find((e) => e.id === entry.id)).toMatchObject({
      status: 'booked',
      outcomeAppointmentId: visit.id,
    })
  })

  it('ends a guest’s request when their visit is cancelled', () => {
    const { s, visit } = withLaterVisit()
    const joined = apply(s, {
      type: 'waitlist-join',
      appointmentId: visit.id,
      anyone: true,
      times: [],
    })
    const cancelled = apply(joined, { type: 'cancel', appointmentId: visit.id, reason: 'Away' })
    expect(cancelled.waitlist!.find((e) => e.appointmentId === visit.id)).toMatchObject({
      status: 'removed',
      removedReason: 'Their visit was cancelled.',
    })
    expect(guestView(cancelled, visit.id, Date.parse(now)).waitlist).toBeUndefined()
  })

  it('keeps each studio’s requests to itself', () => {
    const s = seed('UK')
    const broken = structuredClone(s)
    broken.waitlist![0].organisationId = 'org-atelier-new-york'
    expect(() => parseState(broken, 'UK')).toThrow(/waitlist/i)
    const stranger = structuredClone(s)
    stranger.waitlist![0].clientId = 'client-unknown'
    expect(() => parseState(stranger, 'UK')).toThrow(/waitlist/i)
  })

  it('appears in the client’s export, erasure review and the retention register', () => {
    const s = seed('UK')
    const entry = waiting(s)[0]
    const file = clientExport(s, entry.clientId, {} as never)
    expect(file.waitlist).toHaveLength(1)
    expect(previewClientExport(file).sections).toContainEqual(
      expect.objectContaining({ label: 'Waitlist requests', count: 1 }),
    )
    expect(JSON.stringify(erasureReview(s, entry.clientId, '2026-10-06'))).toContain('Waitlist')
    expect(RETENTION_REGISTER.some((r) => r.record === 'Waitlist requests')).toBe(true)
  })
})
