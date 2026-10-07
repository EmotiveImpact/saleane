import { describe, expect, it } from 'vitest'
import { seed } from './seed'
import { execute } from './commands'
import type { Command } from './commands'
import type { BusinessState } from './model'
import { parseState } from './model'
import { addDays } from './format'
import { can, operations } from './operations'
import { openingFree, openings, timeOfDay, waiting, waitlistSummary } from './waitlist'
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

  it('finds nothing in a long window when the professional is away throughout', () => {
    let s = seed('UK')
    for (let day = 0; day < 90; day++)
      s = apply(s, {
        type: 'closure',
        input: {
          date: addDays('2026-10-07', day),
          staffId: 'staff-theo',
          startMinutes: 0,
          endMinutes: 1440,
          reason: 'Away',
        },
      })
    s = apply(s, {
      type: 'waitlist-add',
      input: {
        ...wish,
        clientId: 'client-2',
        serviceId: 'service-cut',
        staffId: 'staff-theo',
        toDate: addDays('2026-10-07', 89),
        times: [],
      },
    })
    expect(openings(s, s.waitlist!.at(-1)!, now)).toEqual([])
  })

  it('searches the whole window, not only the first month', () => {
    let s = seed('UK')
    // Theo is away for the first 40 days; the only times are later in the window.
    for (let day = 0; day < 40; day++)
      s = apply(s, {
        type: 'closure',
        input: {
          date: addDays('2026-10-07', day),
          staffId: 'staff-theo',
          startMinutes: 0,
          endMinutes: 1440,
          reason: 'Away',
        },
      })
    s = apply(s, {
      type: 'waitlist-add',
      input: {
        ...wish,
        clientId: 'client-2',
        serviceId: 'service-cut',
        staffId: 'staff-theo',
        toDate: '2026-12-05',
        times: [],
      },
    })
    const found = openings(s, s.waitlist!.at(-1)!, now)
    expect(found).toHaveLength(3)
    expect(found[0].date).toBe(addDays('2026-10-07', 40))
  })

  it('offers a guest only times their own booked visit fits, ignoring its current place', () => {
    const { s: booked, visit } = withLaterVisit()
    // The visit was booked at three hours; the service has since become shorter.
    const s = structuredClone(booked)
    s.appointments.find((a) => a.id === visit.id)!.bookedDurationMinutes = 180
    const joined = apply(s, {
      type: 'waitlist-join',
      appointmentId: visit.id,
      anyone: false,
      times: [],
    })
    const entry = joined.waitlist!.at(-1)!
    const found = openings(joined, entry, now, 10)
    expect(found.length).toBeGreaterThan(0)
    for (const opening of found) {
      expect(openingFree(joined, entry, opening, now)).toBe(true)
      expect(
        run(joined, {
          type: 'reschedule',
          appointmentId: visit.id,
          waitlistId: entry.id,
          ...opening,
        }).ok,
      ).toBe(true)
    }
  })

  it('counts a request as filled only by a time it asked for', () => {
    const s = apply(seed('UK'), { type: 'waitlist-add', input: { ...wish, staffId: 'staff-maya' } })
    const entry = s.waitlist!.at(-1)!
    const book = (change: { date: string; startMinutes: number; staffId: string }) =>
      run(s, {
        type: 'book',
        input: {
          clientId: 'client-1',
          serviceId: 'service-facial',
          source: 'desk',
          waitlistId: entry.id,
          ...change,
        },
      })
    // Outside the dates, with someone else, or in the afternoon when only mornings suit.
    expect(book({ date: '2026-10-22', startMinutes: 600, staffId: 'staff-maya' }).ok).toBe(false)
    expect(book({ date: '2026-10-08', startMinutes: 600, staffId: 'staff-sophia' }).ok).toBe(false)
    expect(book({ date: '2026-10-08', startMinutes: 840, staffId: 'staff-maya' }).ok).toBe(false)
    expect(book({ date: '2026-10-08', startMinutes: 600, staffId: 'staff-maya' }).ok).toBe(true)
    // An unrelated visit of the same client cannot be moved to fill a request made at the desk.
    const { s: other, visit } = withLaterVisit(s)
    expect(
      run(other, {
        type: 'reschedule',
        appointmentId: visit.id,
        waitlistId: entry.id,
        date: '2026-10-08',
        startMinutes: 600,
        staffId: 'staff-maya',
      }).ok,
    ).toBe(false)
  })

  it('stops counting a request once its dates have passed, keeping the record', () => {
    const s = seed('UK')
    const entry = s.waitlist![0]
    entry.toDate = '2026-10-05'
    expect(waiting(s).map((e) => e.id)).not.toContain(entry.id)
    expect(openings(s, entry, now)).toEqual([])
    expect(waitlistSummary(s, '2026-10-01T00:00:00.000Z').waiting).toBe(2)
    // The client can ask again for the same service.
    const again = apply(s, {
      type: 'waitlist-add',
      input: { ...wish, clientId: entry.clientId, serviceId: entry.serviceId },
    })
    expect(again.waitlist!.find((e) => e.id === entry.id)!.status).toBe('waiting')
    expect(waiting(again).filter((e) => e.clientId === entry.clientId)).toHaveLength(1)
  })

  it('never moves a guest later, even after the desk moved their visit earlier', () => {
    const { s, visit } = withLaterVisit()
    const joined = apply(s, {
      type: 'waitlist-join',
      appointmentId: visit.id,
      anyone: false,
      times: [],
    })
    const entry = joined.waitlist!.at(-1)!
    // The desk moves the visit from 16 to 9 October without using the waitlist.
    const moved = apply(joined, {
      type: 'reschedule',
      appointmentId: visit.id,
      date: '2026-10-09',
      startMinutes: 600,
      staffId: 'staff-maya',
    })
    const found = openings(moved, entry, now, 20)
    expect(found.length).toBeGreaterThan(0)
    expect(found.every((o) => o.date < '2026-10-09')).toBe(true)
    expect(
      run(moved, {
        type: 'reschedule',
        appointmentId: visit.id,
        waitlistId: entry.id,
        date: '2026-10-12',
        startMinutes: 600,
        staffId: 'staff-maya',
      }).ok,
    ).toBe(false)
  })

  it('withdraws unsent offers when a request ends, and refuses to approve them', () => {
    const s = seed('UK')
    const entry = waiting(s)[0]
    const offered = apply(s, {
      type: 'waitlist-offer',
      entryId: entry.id,
      ...openings(s, entry, now)[0],
    })
    const messageId = offered.waitlist!.find((e) => e.id === entry.id)!.offers![0].messageId
    const removed = apply(offered, {
      type: 'waitlist-remove',
      entryId: entry.id,
      reason: 'Found a time elsewhere',
    })
    expect(operations(removed).messages.find((m) => m.status === 'suppressed')!.status).toBe(
      'suppressed',
    )
    expect(run(removed, { type: 'message-queue', messageId }).ok).toBe(false)
    // While the request is open the offer can be approved as usual.
    expect(run(offered, { type: 'message-queue', messageId }).ok).toBe(true)
  })

  it('lets a guest ask to come in sooner after their service leaves the menu', () => {
    const { s, visit } = withLaterVisit()
    const archived = structuredClone(s)
    archived.services.find((item) => item.id === visit.serviceId)!.archived = true
    const joined = apply(archived, {
      type: 'waitlist-join',
      appointmentId: visit.id,
      anyone: false,
      times: [],
    })
    expect(waiting(joined).some((e) => e.appointmentId === visit.id)).toBe(true)
    // A new request from the desk still needs a service that is offered.
    expect(
      run(archived, { type: 'waitlist-add', input: { ...wish, clientId: 'client-2' } }).ok,
    ).toBe(false)
  })

  it('offers a guest’s own visit under the name it was booked with', () => {
    const { s, visit } = withLaterVisit()
    const joined = apply(s, {
      type: 'waitlist-join',
      appointmentId: visit.id,
      anyone: true,
      times: [],
    })
    joined.services.find((item) => item.id === visit.serviceId)!.name = 'Renamed facial'
    const entry = waiting(joined).find((e) => e.appointmentId === visit.id)!
    const offered = apply(joined, {
      type: 'waitlist-offer',
      entryId: entry.id,
      ...openings(joined, entry, now)[0],
    })
    const body = operations(offered).messages.at(-1)!.body
    expect(body).toContain(visit.bookedServiceName!)
    expect(body).not.toContain('Renamed facial')
  })

  it('stops offering once a request has had the most offers it can keep', () => {
    const s = seed('UK')
    const entry = waiting(s)[0]
    const opening = openings(s, entry, now)[0]
    const full = structuredClone(s)
    full.waitlist!.find((e) => e.id === entry.id)!.offers = Array.from({ length: 50 }, (_, i) => ({
      at: now,
      ...opening,
      messageId: `old-${i}`,
    }))
    const result = run(full, { type: 'waitlist-offer', entryId: entry.id, ...opening })
    expect(result.ok).toBe(false)
    expect(!result.ok && result.error).toMatch(/already had 50 offers/)
  })

  it('keeps a guest’s chosen professional in step when the desk moves their visit to someone else', () => {
    const { s, visit } = withLaterVisit()
    const joined = apply(s, {
      type: 'waitlist-join',
      appointmentId: visit.id,
      anyone: false,
      times: [],
    })
    const moved = apply(joined, {
      type: 'reschedule',
      appointmentId: visit.id,
      date: visit.date,
      startMinutes: visit.startMinutes,
      staffId: 'staff-sophia',
    })
    expect(waiting(moved).find((e) => e.appointmentId === visit.id)!.staffId).toBe('staff-sophia')

    // A request whose dates have passed keeps the professional the guest chose.
    const ended = structuredClone(joined)
    const request = ended.waitlist!.find((e) => e.appointmentId === visit.id)!
    request.toDate = '2026-10-05'
    const chosen = request.staffId
    const movedLater = apply(ended, {
      type: 'reschedule',
      appointmentId: visit.id,
      date: visit.date,
      startMinutes: visit.startMinutes,
      staffId: 'staff-sophia',
    })
    expect(movedLater.waitlist!.find((e) => e.id === request.id)!.staffId).toBe(chosen)
  })

  it('checks an offer again when it is approved, and exports a withdrawn one honestly', () => {
    const s = seed('UK')
    const entry = waiting(s)[0]
    const opening = openings(s, entry, now)[0]
    const offered = apply(s, { type: 'waitlist-offer', entryId: entry.id, ...opening })
    const messageId = offered.waitlist!.find((e) => e.id === entry.id)!.offers![0].messageId
    // Someone else books that time first.
    const taken = apply(offered, {
      type: 'book',
      input: { clientId: 'client-1', serviceId: entry.serviceId, source: 'desk', ...opening },
    })
    const refused = run(taken, { type: 'message-queue', messageId })
    expect(refused.ok).toBe(false)
    if (!refused.ok) expect(refused.error).toContain('time has gone')
    // A request whose dates have passed cannot have its offer approved either.
    const expired = structuredClone(offered)
    expired.waitlist!.find((e) => e.id === entry.id)!.toDate = '2026-10-05'
    expect(run(expired, { type: 'message-queue', messageId }).ok).toBe(false)
    // In the client's export a withdrawn offer is not described as a consent change.
    const removed = apply(offered, {
      type: 'waitlist-remove',
      entryId: entry.id,
      reason: 'No longer needed',
    })
    const sent = clientExport(removed, entry.clientId, {} as never).messages.find(
      (m) => m.status === 'suppressed',
    )!
    expect(sent.delivery).toContain('waitlist request')
    expect(sent.delivery).not.toContain('consent')
  })

  it('counts a visit moved earlier twice once in the summary', () => {
    const { s, visit } = withLaterVisit()
    let next = s
    for (const date of ['2026-10-12', '2026-10-09']) {
      next = apply(next, {
        type: 'waitlist-join',
        appointmentId: visit.id,
        anyone: false,
        times: [],
      })
      const entry = next.waitlist!.at(-1)!
      next = apply(next, {
        type: 'reschedule',
        appointmentId: visit.id,
        waitlistId: entry.id,
        date,
        startMinutes: 600,
        staffId: 'staff-maya',
      })
    }
    expect(next.waitlist!.filter((e) => e.status === 'booked')).toHaveLength(2)
    expect(waitlistSummary(next, '2026-10-01T00:00:00.000Z')).toMatchObject({
      filled: 1,
      valueMinor: visit.bookedPriceMinor,
    })
  })

  it('keeps an offer’s wording tied to the time it was checked for', () => {
    const s = seed('UK')
    const entry = waiting(s)[0]
    const offered = apply(s, {
      type: 'waitlist-offer',
      entryId: entry.id,
      ...openings(s, entry, now)[0],
    })
    const message = operations(offered).messages.at(-1)!
    const edit = run(offered, {
      type: 'message',
      id: message.id,
      input: {
        clientId: message.clientId,
        purpose: message.purpose,
        subject: message.subject,
        body: 'Another time entirely.',
        ...(message.appointmentId ? { appointmentId: message.appointmentId } : {}),
      },
    })
    expect(edit.ok).toBe(false)
    if (!edit.ok) expect(edit.error).toContain('cannot be edited')
  })
})
