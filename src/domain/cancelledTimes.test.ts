import { describe, expect, it } from 'vitest'
import { seed } from './seed'
import { dispatch, execute } from './commands'
import type { Command } from './commands'
import type { Appointment, BusinessState } from './model'
import { operations } from './operations'
import { defaultReminderSettings } from './reminderSettings'
import { branchRefusal } from './branch'
import {
  draftStale,
  freedSummary,
  freedTimes,
  invitationState,
  invitationsFor,
  namesATime,
  shownBody,
  suggestionsFor,
  waitingFor,
} from './cancelledTimes'

// NEXT-11: filling a time a cancelled visit left free. The sample studio's clock stands at 10:45
// on Tuesday 6 October; Zoe's facial with Maya is at 13:30.
const at = (minute: number) => new Date(Date.UTC(2026, 9, 6, 9, minute)).toISOString()
const now = at(0)
let sequence = 0
function apply(s: BusinessState, command: Command, when = now) {
  const result = execute(s, command, when, () => `ct-${++sequence}`)
  if (!result.ok) throw new Error(result.error)
  return result.state
}
const run = (s: BusinessState, command: Command, when = now) =>
  execute(s, command, when, () => `ct-${++sequence}`)
/** The sample studio without its waitlist: Charlotte there is waiting for just this time. */
function studio() {
  const s = seed('UK')
  s.waitlist = []
  return s
}
const cancelZoe = (s = studio(), when = now) =>
  apply(s, { type: 'cancel', appointmentId: 'visit-zoe', reason: 'Feeling unwell' }, when)
const invitations = (s: BusinessState) => operations(s).messages.filter((m) => m.opening)
/** The sample studio with SALEANE's own invitations turned off, so the team chooses. */
function quiet(s = studio()) {
  s.operations = {
    ...s.operations!,
    reminders: { ...defaultReminderSettings, openingInvites: false },
  } as BusinessState['operations']
  return s
}
const facial = (clientId: string, date: string, staffId = 'staff-maya', start = 600) =>
  ({
    id: `history-${clientId}-${date}`,
    organisationId: 'org-atelier-london',
    locationId: 'loc-london',
    clientId,
    serviceId: 'service-facial',
    staffId,
    resourceId: 'room-one',
    date,
    startMinutes: start,
    status: 'completed',
    source: 'desk',
    createdAt: '2026-01-01T09:00:00.000Z',
    bookedPriceMinor: 9500,
    bookedDepositMinor: 0,
    bookedDurationMinutes: 60,
    bookedBufferMinutes: 15,
  }) as Appointment

describe('filling a cancelled time', () => {
  it('frees the time and writes invitations for the team to approve, nothing sent', () => {
    const s = studio()
    const result = dispatch(
      s,
      { type: 'cancel', appointmentId: 'visit-zoe', reason: 'Feeling unwell' },
      'Ada Owner',
      now,
    )
    if (!result.ok) throw new Error(result.error)
    const next = result.state
    expect(freedTimes(next, now)).toEqual([
      expect.objectContaining({
        appointmentId: 'visit-zoe',
        date: '2026-10-06',
        startMinutes: 810,
        staffId: 'staff-maya',
        serviceId: 'service-facial',
      }),
    ])
    // Amelia and Isabel are coming today, Noor has not agreed to hear, and Zoe cancelled it.
    const written = invitations(next)
    expect(written.map((m) => m.clientId)).toEqual(['client-13'])
    const [message] = written
    expect(message).toMatchObject({
      purpose: 'marketing',
      channel: 'email',
      status: 'draft',
      actor: 'SALEANE',
      subject: 'A time has opened at Atelier House',
      opening: {
        date: '2026-10-06',
        startMinutes: 810,
        staffId: 'staff-maya',
        serviceId: 'service-facial',
      },
    })
    expect(message.approvedAt).toBeUndefined()
    expect(message.body).toContain('Hello Charlotte,')
    expect(message.body).toContain(
      'A time has just opened for Skin Renewal Facial with Maya on Tuesday 6 October at 13:30, and we thought of you.',
    )
    expect(message.body).toContain(
      '{{book_link}}?service=service-facial&staff=staff-maya&date=2026-10-06&start=810 It is not held for you, so the first to book it gets it.',
    )
    expect(message.body).toContain('You are hearing this because you said we could keep in touch.')
    expect(shownBody(message.body)).toContain(
      'If you would like it, book it here: [a link to book this time] It is not held',
    )
    expect(next.events.at(-1)).toMatchObject({
      clientId: 'client-13',
      type: 'message',
      title: 'Invitation written by SALEANE',
      actor: 'Ada Owner',
    })
    expect(next.events.at(-1)!.detail).toContain('Waiting in the Inbox for approval')
    expect(namesATime(next, message.id)).toBe(true)
    expect(draftStale(next, message.id, now)).toBeNull()
    // The same cancellation again changes nothing.
    const again = run(next, { type: 'cancel', appointmentId: 'visit-zoe', reason: 'Twice' })
    expect(again.ok && again.state).toBe(next)
  })

  it('writes none by itself when the studio turns it off, or from a cover plan', () => {
    expect(invitations(cancelZoe(quiet()))).toEqual([])
    const plan = apply(studio(), {
      type: 'batch',
      label: 'Maya is off',
      commands: [{ type: 'cancel', appointmentId: 'visit-zoe', reason: 'Maya is off' }],
    } as Command)
    expect(invitations(plan)).toEqual([])
    expect(freedTimes(plan, now)).toHaveLength(1)
  })

  it('suggests the best fit first, with plain reasons, and leaves out who should not be asked', () => {
    const s = quiet()
    s.appointments.push(
      // Emily has had a morning facial with Sophia, and massages with Maya; due back in twelve days.
      facial('client-14', '2026-09-20', 'staff-sophia'),
      // Olivia had one last week: too soon for another.
      facial('client-2', '2026-09-29'),
      // Jamie missed a visit last month.
      facial('client-15', '2026-08-01'),
      { ...facial('client-15', '2026-09-10'), id: 'missed-jamie', status: 'no_show' },
      // Ellie has had a facial but already has one booked next week.
      facial('client-3', '2026-08-01'),
      { ...facial('client-3', '2026-10-13'), id: 'ellie-next', status: 'confirmed' },
    )
    // A second record for Grace made by online booking, without her agreement.
    s.appointments.push(facial('client-6', '2026-08-01'))
    s.clients.push({ ...s.clients.find((c) => c.id === 'client-6')!, id: 'client-6b' })
    s.clients.find((c) => c.id === 'client-6b')!.marketingConsent = false
    // Priya has only had massages.
    s.clients.push({
      ...s.clients.find((c) => c.id === 'client-14')!,
      id: 'client-16',
      name: 'Priya Shah',
      email: 'priya.shah@example.com',
    })
    s.appointments.push({ ...facial('client-16', '2026-08-01'), serviceId: 'service-restore' })
    const next = cancelZoe(s)
    const [time] = freedTimes(next, now)
    expect(suggestionsFor(next, time, now)).toEqual([
      {
        clientId: 'client-13',
        name: 'Charlotte Hayes',
        reasons: [
          'Was due back on Tuesday 15 September',
          'Has seen Maya before',
          'Usually comes in the afternoons',
        ],
        score: 10,
      },
      {
        clientId: 'client-14',
        name: 'Emily Clarke',
        reasons: ['Due back on Sunday 18 October', 'Has seen Maya before'],
        score: 7,
      },
    ])
    // The team cannot invite someone the suggestions leave out.
    const why = (clientId: string) => {
      const result = run(next, {
        type: 'opening-invite',
        appointmentId: 'visit-zoe',
        clientIds: [clientId],
      })
      return result.ok ? 'invited' : result.error
    }
    expect(why('client-7')).toBe('Zoe Miller cannot be invited. They cancelled this time.')
    expect(why('client-4')).toBe(
      'Noor Ahmed cannot be invited. They have not agreed to hear from you.',
    )
    expect(why('client-1')).toBe(
      'Amelia Carter cannot be invited. They are already coming that day.',
    )
    expect(why('client-2')).toBe(
      'Olivia James cannot be invited. They had this treatment too recently.',
    )
    expect(why('client-15')).toBe(
      'Jamie Morgan cannot be invited. They missed a visit in the last three months.',
    )
    expect(why('client-3')).toBe(
      'Ellie Brooks cannot be invited. They already have this treatment booked.',
    )
    expect(why('client-6')).toBe(
      'Grace Chen cannot be invited. They have not agreed to hear from you.',
    )
    expect(why('client-16')).toBe(
      'Priya Shah cannot be invited. They have not had a skin treatment here.',
    )
  })

  it('of two guests as likely, puts the one due back sooner first', () => {
    const s = quiet()
    // Two guests with a morning facial with Sophia and a massage with Maya: Mia is due back on the
    // 12th, Emily on the 18th. Both are due within a fortnight of the time, so they score the same.
    s.clients.push({
      ...s.clients.find((c) => c.id === 'client-14')!,
      id: 'client-17',
      name: 'Mia Stone',
      email: 'mia.stone@example.com',
    })
    s.appointments.push(
      facial('client-14', '2026-09-20', 'staff-sophia'),
      facial('client-17', '2026-09-14', 'staff-sophia'),
      { ...facial('client-17', '2026-07-01'), id: 'mia-massage', serviceId: 'service-restore' },
    )
    const next = cancelZoe(s)
    const [time] = freedTimes(next, now)
    const found = suggestionsFor(next, time, now).filter((x) =>
      ['client-14', 'client-17'].includes(x.clientId),
    )
    expect(found.map((x) => [x.name, x.score, x.reasons[0]])).toEqual([
      ['Mia Stone', found[0].score, 'Due back on Monday 12 October'],
      ['Emily Clarke', found[0].score, 'Due back on Sunday 18 October'],
    ])
  })

  it('puts people waiting on the list first and writes nothing by itself for them', () => {
    // In the sample studio Charlotte is waiting for a facial with Maya in the afternoon.
    const s = seed('UK')
    s.appointments.push(facial('client-14', '2026-09-01'))
    const next = cancelZoe(s)
    const [time] = freedTimes(next, now)
    expect(waitingFor(next, time, now).map((e) => e.clientId)).toEqual(['client-13'])
    expect(suggestionsFor(next, time, now).map((x) => x.clientId)).toEqual(['client-14'])
    expect(invitations(next)).toEqual([])
    const invite = run(next, {
      type: 'opening-invite',
      appointmentId: 'visit-zoe',
      clientIds: ['client-13'],
    })
    expect(invite.ok ? '' : invite.error).toBe(
      'Charlotte Hayes cannot be invited. They are waiting for a time like this on the list.',
    )
  })

  it('lets the team invite, asks for approval, and refuses once the time is booked', () => {
    const s = quiet()
    s.appointments.push(facial('client-14', '2026-09-01'))
    let next = cancelZoe(s)
    next = apply(next, {
      type: 'opening-invite',
      appointmentId: 'visit-zoe',
      clientIds: ['client-13', 'client-14'],
    })
    const [charlotte, emily] = invitations(next)
    expect([charlotte.clientId, emily.clientId]).toEqual(['client-13', 'client-14'])
    expect(charlotte).toMatchObject({ status: 'draft', actor: 'Local operator' })
    expect(next.events.at(-1)!.title).toBe('Invitation written')
    // Asking again for the same people changes nothing.
    const again = run(next, {
      type: 'opening-invite',
      appointmentId: 'visit-zoe',
      clientIds: ['client-13', 'client-14'],
    })
    expect(again.ok && again.state).toBe(next)
    // Its words are checked against the time, so they are not edited by hand.
    const edit = run(next, {
      type: 'message',
      id: charlotte.id,
      input: {
        clientId: 'client-13',
        purpose: 'marketing',
        channel: 'email',
        subject: 'Changed',
        body: 'Changed',
      },
    })
    expect(edit.ok ? '' : edit.error).toBe(
      'An invitation cannot be edited. Write a new one from the waitlist page.',
    )
    next = apply(next, { type: 'message-queue', messageId: charlotte.id }, at(5))
    expect(invitationState(next, invitationsFor(next, charlotte.opening!)[0], at(5))).toBe(
      'approved',
    )
    // Olivia rings and takes the time.
    next = apply(
      next,
      {
        type: 'book',
        input: {
          clientId: 'client-2',
          serviceId: 'service-facial',
          staffId: 'staff-maya',
          date: '2026-10-06',
          startMinutes: 810,
          source: 'desk',
        },
      },
      at(10),
    )
    expect(freedTimes(next, at(10))).toEqual([])
    expect(draftStale(next, emily.id, at(10))).toBe(
      'That time has been booked or has passed since this invitation was written.',
    )
    const approve = run(next, { type: 'message-queue', messageId: emily.id }, at(11))
    expect(approve.ok ? '' : approve.error).toBe(
      'That time has been booked or has passed since this invitation was written.',
    )
    expect(invitationState(next, invitationsFor(next, emily.opening!)[1], at(11))).toBe('stale')
    const late = run(
      next,
      { type: 'opening-invite', appointmentId: 'visit-zoe', clientIds: ['client-1'] },
      at(12),
    )
    expect(late.ok ? '' : late.error).toContain('That time is no longer free')
  })

  it('counts times freed, filled again, and filled by someone invited', () => {
    const s = quiet()
    let next = cancelZoe(s, at(0))
    next = apply(
      next,
      { type: 'opening-invite', appointmentId: 'visit-zoe', clientIds: ['client-13'] },
      at(1),
    )
    const [invite] = invitations(next)
    next = apply(next, { type: 'message-queue', messageId: invite.id }, at(2))
    // Ruby's massage with Maya at 15:00 is cancelled too, and nobody takes it.
    next = apply(next, { type: 'cancel', appointmentId: 'visit-ruby', reason: 'Away' }, at(3))
    next = apply(
      next,
      {
        type: 'book',
        input: {
          clientId: 'client-13',
          serviceId: 'service-facial',
          staffId: 'staff-maya',
          date: '2026-10-06',
          startMinutes: 810,
          source: 'desk',
        },
      },
      at(30),
    )
    expect(invitationState(next, invitationsFor(next, invite.opening!)[0], at(31))).toBe('booked')
    const price = next.appointments.at(-1)!.bookedPriceMinor
    expect(freedSummary(next, at(-60))).toEqual({
      freed: 2,
      filled: 1,
      invited: 1,
      waitlist: 0,
      valueMinor: price,
    })
  })

  it('leaves out times too soon or too far ahead, and lets a general manager invite only at home', () => {
    let s = seed('UK')
    // Ava's massage at 11:00 is fifteen minutes away on the sample clock: too soon to invite for.
    s = apply(s, { type: 'cancel', appointmentId: 'visit-ava', reason: 'Running late' })
    expect(freedTimes(s, now)).toEqual([])
    // A visit three weeks ahead is too far: plenty of time for the diary to fill by itself.
    s = apply(s, {
      type: 'book',
      input: {
        clientId: 'client-1',
        serviceId: 'service-facial',
        staffId: 'staff-maya',
        date: '2026-10-27',
        startMinutes: 600,
        source: 'desk',
      },
    })
    const far = s.appointments.at(-1)!.id
    s = apply(s, { type: 'cancel', appointmentId: far, reason: 'Away' })
    expect(freedTimes(s, now)).toEqual([])
    s = cancelZoe(s)
    const command: Command = {
      type: 'opening-invite',
      appointmentId: 'visit-zoe',
      clientIds: ['client-13'],
    }
    expect(branchRefusal(s, 'loc-london', command)).toBeNull()
    expect(branchRefusal(s, 'loc-islington', command)).toBe('That visit is at another location.')
  })
})
