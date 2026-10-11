import { describe, expect, it } from 'vitest'
import { seed } from './seed'
import { execute, slots } from './commands'
import type { Command, ExecuteOptions } from './commands'
import type { BusinessState } from './model'
import { parseState } from './model'
import { can, operations, permissionFor } from './operations'
import { defaultReminderSettings } from './reminderSettings'
import { branchRefusal } from './branch'
import { changeDetail, describeChange, recordNames } from './changeRecord'
import { draftStale, shownBody } from './cancelledTimes'
import { guestMoveBlock } from './guest'
import { receiptFor } from './receipt'
import { serviceRevenue } from './takings'
import { clientExport, clientExportText } from './privacy'
import {
  bookedOfferLine,
  offerParagraph,
  offerPriceFor,
  offersTaken,
  quietOffer,
  quietOfferSettings,
} from './quietOffers'
import { offerStanding, quietInvitation } from './quietInvites'
import { defaultQuietOffers } from './quietOffersSchema'
import type { QuietOfferSettings } from './quietOffersSchema'

// Stage 5: a lower price for a quiet time. The sample studio's clock stands at 10:45 on Tuesday 6
// October; Zoe's £95 facial with Maya is at 13:30, and Charlotte (client-13) agreed to hear from
// the studio.
const at = (minute: number) => new Date(Date.UTC(2026, 9, 6, 9, minute)).toISOString()
const now = at(0)
let sequence = 0
function run(s: BusinessState, command: Command, when = now, options: ExecuteOptions = {}) {
  return execute(s, command, when, () => `qo-${++sequence}`, options)
}
function apply(s: BusinessState, command: Command, when = now, options: ExecuteOptions = {}) {
  const result = run(s, command, when, options)
  if (!result.ok) throw new Error(result.error)
  return result.state
}
const refusal = (result: ReturnType<typeof run>) => (result.ok ? '' : result.error)
/** A free facial time with Maya later today, after Zoe's. */
const laterToday = (s: BusinessState) =>
  slots(s, 'service-facial', 'staff-maya', '2026-10-06', now).find((start) => start > 810)!

/** The sample studio, without its waitlist, with the owner's lower price for quiet times. */
function studio(settings: Partial<QuietOfferSettings> = { discount: 'percent' }) {
  const s = seed('UK')
  s.waitlist = []
  s.operations = {
    ...s.operations!,
    quietOffers: { ...defaultQuietOffers, ...settings },
  } as BusinessState['operations']
  return s
}
/** The same, with SALEANE's own invitations to a cancelled time turned off. */
function teamChooses(s: BusinessState) {
  s.operations = {
    ...s.operations!,
    reminders: { ...defaultReminderSettings, openingInvites: false },
  } as BusinessState['operations']
  return s
}
const cancelZoe = (s: BusinessState, when = now) =>
  apply(s, { type: 'cancel', appointmentId: 'visit-zoe', reason: 'Feeling unwell' }, when)
const invitations = (s: BusinessState) => operations(s).messages.filter((m) => m.opening)
const withTax = (s: BusinessState, inclusive = false) => {
  s.operations = {
    ...s.operations!,
    tax: { label: 'VAT', rateBps: 2000, inclusive },
  } as BusinessState['operations']
  return s
}
/** Zoe's time, as Charlotte would book it from her invitation. */
const zoeTime = (input: Record<string, unknown> = {}): Command =>
  ({
    type: 'book',
    input: {
      clientId: 'client-13',
      serviceId: 'service-facial',
      staffId: 'staff-maya',
      date: '2026-10-06',
      startMinutes: 810,
      source: 'online',
      ...input,
    },
  }) as Command
/** Zoe cancels, SALEANE writes Charlotte an invitation with the lower price, and it is approved. */
function approvedInvitation(s = studio(), when = now) {
  let next = cancelZoe(s, when)
  const [message] = invitations(next)
  next = apply(next, { type: 'message-queue', messageId: message.id }, when)
  return { s: next, messageId: message.id }
}

describe('the lower price for a usual price', () => {
  const settings = (more: Partial<QuietOfferSettings>) => ({ ...defaultQuietOffers, ...more })
  it('is none by default, a percentage or an amount off, never below the floor or free', () => {
    expect(offerPriceFor(defaultQuietOffers, 9500)).toBeNull()
    expect(offerPriceFor(settings({ discount: 'percent', offPercent: 20 }), 9500)).toBe(7600)
    // Rounded to the penny: 15% of £99.99 is £15.00 off.
    expect(offerPriceFor(settings({ discount: 'percent', offPercent: 15 }), 9999)).toBe(8499)
    expect(offerPriceFor(settings({ discount: 'amount', offMinor: 1000 }), 9500)).toBe(8500)
    // An amount larger than the price leaves it free, never below.
    expect(offerPriceFor(settings({ discount: 'amount', offMinor: 20000 }), 9500)).toBe(0)
    // The floor holds the price up; a floor at or above the price leaves nothing off.
    expect(
      offerPriceFor(settings({ discount: 'percent', offPercent: 50, floorMinor: 8000 }), 9500),
    ).toBe(8000)
    expect(offerPriceFor(settings({ discount: 'amount', floorMinor: 9500 }), 9500)).toBeNull()
    expect(offerPriceFor(settings({ discount: 'amount' }), 0)).toBeNull()
  })

  it('applies only while booking online is on, and never to a treatment left out', () => {
    const time = {
      serviceId: 'service-facial',
      staffId: 'staff-maya',
      date: '2026-10-08',
      startMinutes: 600,
    }
    expect(quietOffer(studio({}), time, now)).toBeNull()
    // Two days ahead, so the owner's 24 hours ends it first.
    expect(quietOffer(studio(), time, now)).toEqual({
      priceMinor: 7600,
      usualPriceMinor: 9500,
      endsAt: '2026-10-07T09:00:00.000Z',
    })
    // A time three hours away ends as it starts (sample clock 10:45, time 13:30).
    expect(
      quietOffer(
        studio({ discount: 'percent', openHours: 72 }),
        { ...time, date: '2026-10-06', startMinutes: 810 },
        now,
      )?.endsAt,
    ).toBe('2026-10-06T11:45:00.000Z')
    expect(
      quietOffer(studio({ discount: 'percent', leftOutIds: ['service-facial'] }), time, now),
    ).toBeNull()
    const off = studio()
    off.operations = { ...off.operations!, bookingEnabled: false } as BusinessState['operations']
    expect(quietOffer(off, time, now)).toBeNull()
    const archived = studio()
    archived.services = archived.services.map((x) =>
      x.id === 'service-facial' ? { ...x, archived: true } : x,
    )
    expect(quietOffer(archived, time, now)).toBeNull()
  })

  it('tells a guest the full price with any tax added on top, and when it ends', () => {
    const s = withTax(studio())
    const offer = quietOffer(
      s,
      { serviceId: 'service-facial', staffId: 'staff-maya', date: '2026-10-06', startMinutes: 810 },
      now,
    )!
    expect(offerParagraph(s, offer, now)).toBe(
      'For that time only, it is £91.20 instead of the usual £114. The lower price is open until Tuesday 6 October at 13:30.',
    )
  })
})

describe('invitations with a lower price', () => {
  it('fixes the price on an invitation to a cancelled time as it is written', () => {
    const next = cancelZoe(studio())
    const [message] = invitations(next)
    expect(message).toMatchObject({
      status: 'draft',
      subject: 'A time has opened at Atelier House, at a lower price',
      offer: { priceMinor: 7600, usualPriceMinor: 9500, endsAt: '2026-10-06T11:45:00.000Z' },
    })
    expect(message.body).toContain(
      'For that time only, it is £76 instead of the usual £95. The lower price is open until Tuesday 6 October at 13:30.',
    )
    expect(message.body).toContain('&start=810{{offer_link}} It is not held for you')
    expect(shownBody(message.body)).toContain(
      'book it here: [a private link to book this time at its lower price] It is not held',
    )
    expect(next.events.at(-1)!.detail).toContain('at a quiet-time price of £76 instead of £95')
    // Without the setting the invitation is as it always was.
    const plain = invitations(cancelZoe(studio({})))[0]
    expect(plain.offer).toBeUndefined()
    expect(plain.subject).toBe('A time has opened at Atelier House')
    expect(plain.body).not.toContain('{{offer_link}}')
  })

  it('never changes an invitation already written when the setting changes', () => {
    let next = cancelZoe(studio())
    const [before] = invitations(next)
    next = apply(next, {
      type: 'quiet-offers',
      settings: { ...defaultQuietOffers, discount: 'amount', offMinor: 3000 },
    })
    expect(quietOfferSettings(next).discount).toBe('amount')
    expect(invitations(next)[0]).toEqual(before)
    next = apply(next, { type: 'quiet-offers', settings: defaultQuietOffers })
    expect(invitations(next)[0]).toEqual(before)
    // It can still be approved as written.
    next = apply(next, { type: 'message-queue', messageId: before.id })
    expect(invitations(next)[0]).toMatchObject({ status: 'queued', offer: before.offer })
  })

  it('cannot be approved once its lower price ends or the usual price changes', () => {
    const next = cancelZoe(studio())
    const [message] = invitations(next)
    // The sample studio's clock stands still, so the time itself never passes there.
    expect(draftStale(next, message.id, at(165))).toBe(
      'The lower price in this invitation ended on Tuesday 6 October at 13:30.',
    )
    expect(refusal(run(next, { type: 'message-queue', messageId: message.id }, at(165)))).toBe(
      'The lower price in this invitation ended on Tuesday 6 October at 13:30.',
    )
    // The usual price goes up: the lower price no longer holds.
    const dearer = {
      ...next,
      services: next.services.map((x) =>
        x.id === 'service-facial' ? { ...x, priceMinor: 10500 } : x,
      ),
    }
    expect(draftStale(dearer, message.id, at(5))).toBe(
      'The treatment’s usual price has changed since this invitation was written, so its lower price no longer holds.',
    )
    expect(refusal(run(dearer, { type: 'message-queue', messageId: message.id }, at(5)))).toBe(
      'The treatment’s usual price has changed since this invitation was written, so its lower price no longer holds.',
    )
  })

  it('writes an invitation to one of Today’s open times with its lower price', () => {
    const s = studio()
    const date = '2026-10-07'
    const [start] = slots(s, 'service-facial', 'staff-maya', date, now)
    const command = {
      type: 'offer-invite',
      clientId: 'client-13',
      serviceId: 'service-facial',
      staffId: 'staff-maya',
      date,
      startMinutes: start,
    } as Command
    const preview = quietInvitation(s, { ...command, type: undefined } as never, now)!
    expect(preview.subject).toBe('A time for you tomorrow, Charlotte, at a lower price')
    const next = apply(s, command)
    const message = operations(next).messages.at(-1)!
    expect(message).toMatchObject({
      clientId: 'client-13',
      purpose: 'marketing',
      channel: 'email',
      status: 'draft',
      actor: 'Local operator',
      subject: preview.subject,
      body: preview.body,
      offer: { priceMinor: 7600, usualPriceMinor: 9500 },
      opening: { date, startMinutes: start, staffId: 'staff-maya', serviceId: 'service-facial' },
    })
    expect(message.body).toContain('It has been a little while. Maya has tomorrow at')
    expect(message.body).toContain('For that time only, it is £76 instead of the usual £95.')
    expect(next.events.at(-1)).toMatchObject({ title: 'Invitation written' })
    expect(next.events.at(-1)!.detail).toContain('delivery is unconfigured')
    // Writing it again changes nothing.
    const again = run(next, command)
    expect(again.ok && again.state).toBe(next)
    // With no lower price, there is nothing to offer: an ordinary invitation is written instead.
    expect(refusal(run(studio({}), command))).toBe(
      'The lower price for quiet times is off, or does not apply to this treatment, so there is nothing to offer. Write an ordinary invitation instead.',
    )
    // Only to a guest who agreed to hear from the studio.
    expect(refusal(run(s, { ...command, clientId: 'client-4' } as Command))).toContain(
      'has not agreed to hear from you',
    )
    // Only to a time still free.
    expect(
      refusal(run(s, { ...command, date: '2026-10-06', startMinutes: 660 } as Command, now)),
    ).toBe('That time is no longer free. Look again for an open time.')
  })
})

describe('booking at a quiet-time price', () => {
  it('books the visit at the lower price, with the deposit and the usual price kept on it', () => {
    const { s, messageId } = approvedInvitation()
    expect(offerStanding(s, messageId, at(5))).toMatchObject({ ok: true })
    const next = apply(s, zoeTime(), at(5), { offer: { messageId } })
    const visit = next.appointments.at(-1)!
    expect(visit).toMatchObject({
      bookedPriceMinor: 7600,
      bookedDepositMinor: 2500,
      bookedOffer: { messageId, usualPriceMinor: 9500 },
    })
    expect(next.events.find((e) => e.appointmentId === visit.id)!.detail).toContain(
      'Booked at a quiet-time price of £76 instead of £95, from an invitation.',
    )
    expect(bookedOfferLine(next, visit)).toBe('Quiet-time price, £19 off £95')
    // The sample studio simulates the deposit from the price booked.
    expect(next.payments.at(-1)).toMatchObject({ kind: 'deposit', amountMinor: 2500 })
    // Used once: it no longer stands.
    expect(offerStanding(next, messageId, at(6))).toEqual({
      ok: false,
      problem: 'This quiet-time price has already been used to book.',
    })
  })

  it('never asks a deposit above the lower price', () => {
    const { s, messageId } = approvedInvitation(studio({ discount: 'amount', offMinor: 9000 }))
    const visit = apply(s, zoeTime(), at(5), { offer: { messageId } }).appointments.at(-1)!
    expect(visit).toMatchObject({ bookedPriceMinor: 500, bookedDepositMinor: 500 })
  })

  it('refuses, in words for the guest, an offer that does not stand or another time', () => {
    const usual = ' You can still book this time at the usual price.'
    // Not approved yet.
    const draft = cancelZoe(studio())
    const draftId = invitations(draft)[0].id
    expect(refusal(run(draft, zoeTime(), at(5), { offer: { messageId: draftId } }))).toBe(
      `This quiet-time price is no longer open.${usual}`,
    )
    const { s, messageId } = approvedInvitation()
    // Another time.
    expect(
      refusal(run(s, zoeTime({ startMinutes: laterToday(s) }), at(5), { offer: { messageId } })),
    ).toBe(`This quiet-time price is for Tuesday 6 October at 13:30 with Maya only.${usual}`)
    // Not from the guest's own link.
    expect(refusal(run(s, zoeTime({ source: 'desk' }), at(5), { offer: { messageId } }))).toBe(
      'A quiet-time price is booked only from the guest’s own link.',
    )
    // Ended.
    expect(refusal(run(s, zoeTime(), at(170), { offer: { messageId } }))).toContain(
      'This quiet-time price ended on Tuesday 6 October at 13:30.',
    )
    // Used, then the visit cancelled: it is still used.
    let used = apply(s, zoeTime(), at(5), { offer: { messageId } })
    used = apply(
      used,
      { type: 'cancel', appointmentId: used.appointments.at(-1)!.id, reason: 'Changed plans' },
      at(6),
    )
    expect(refusal(run(used, zoeTime(), at(7), { offer: { messageId } }))).toBe(
      `This quiet-time price has already been used to book.${usual}`,
    )
    // Booking the same time without it is at the usual price.
    expect(apply(used, zoeTime(), at(7)).appointments.at(-1)!.bookedPriceMinor).toBe(9500)
  })

  it('is charged, taxed and counted at the lower price at checkout and on the receipt', () => {
    const { s, messageId } = approvedInvitation(withTax(studio()))
    let next = apply(s, zoeTime(), at(5), { offer: { messageId } })
    const visit = next.appointments.at(-1)!
    next = apply(next, { type: 'arrive', appointmentId: visit.id }, at(6))
    next = apply(
      next,
      { type: 'checkout', appointmentId: visit.id, tipMinor: 0, method: 'demo_card' } as Command,
      at(7),
    )
    const sale = next.sales.find((x) => x.appointmentId === visit.id)!
    expect(sale).toMatchObject({ serviceMinor: 7600, taxMinor: 1520, totalMinor: 9120 })
    // Takings, and the commission worked out from them, follow what was charged.
    expect(serviceRevenue(sale)).toBe(7600)
    const receipt = receiptFor(next, { kind: 'visit', id: sale.id })!
    expect(receipt.lines[0]).toMatchObject({
      amountMinor: 7600,
      detail: 'Quiet-time price, £19 off £95',
    })
    expect(offersTaken(next, at(0))).toEqual({ taken: 1, givenMinor: 1900 })
  })

  it('stays with the visit when the studio moves it; the guest cannot move it online', () => {
    const { s, messageId } = approvedInvitation()
    let next = apply(s, zoeTime(), at(5), { offer: { messageId } })
    const visit = next.appointments.at(-1)!
    const later = laterToday(next)
    expect(guestMoveBlock(next, visit.id, Date.parse('2026-10-05T09:00:00Z'))).toBe('offer')
    next = apply(
      next,
      {
        type: 'reschedule',
        appointmentId: visit.id,
        date: '2026-10-06',
        startMinutes: later,
        staffId: 'staff-maya',
      },
      at(6),
    )
    expect(next.appointments.find((a) => a.id === visit.id)).toMatchObject({
      startMinutes: later,
      bookedPriceMinor: 7600,
      bookedOffer: { messageId, usualPriceMinor: 9500 },
    })
    expect(next.events.at(-1)!.detail).toContain('The quiet-time price stays with the visit.')
  })

  it('counts offers taken, leaving out visits cancelled since', () => {
    const { s, messageId } = approvedInvitation()
    const next = apply(s, zoeTime(), at(5), { offer: { messageId } })
    expect(offersTaken(next, at(0))).toEqual({ taken: 1, givenMinor: 1900 })
    const cancelled = apply(
      next,
      { type: 'cancel', appointmentId: next.appointments.at(-1)!.id, reason: 'Changed plans' },
      at(6),
    )
    expect(offersTaken(cancelled, at(0))).toEqual({ taken: 0, givenMinor: 0 })
  })

  it('keeps the record honest: below the usual price, once, on an invitation to one time', () => {
    const { s, messageId } = approvedInvitation()
    const next = apply(s, zoeTime(), at(5), { offer: { messageId } })
    const visit = next.appointments.at(-1)!
    const raised = structuredClone(next)
    raised.appointments.at(-1)!.bookedOffer!.usualPriceMinor = 7600
    expect(() => parseState(raised, 'UK')).toThrow(
      'A quiet-time price must be below the usual price.',
    )
    const twice = structuredClone(next)
    twice.appointments.push({
      ...structuredClone(visit),
      id: 'visit-copy',
      startMinutes: laterToday(next),
    })
    expect(() => parseState(twice, 'UK')).toThrow('A quiet-time price is booked once only.')
    const loose = structuredClone(next)
    delete operations(loose).messages.find((m) => m.id === messageId)!.opening
    expect(() => parseState(loose, 'UK')).toThrow(
      'A quiet-time price belongs to an invitation to one time.',
    )
  })

  it('shows in the guest’s own copy of their record', () => {
    const { s, messageId } = approvedInvitation()
    const next = apply(s, zoeTime(), at(5), { offer: { messageId } })
    const file = clientExport(next, 'client-13', {
      exportedAt: at(6),
      exportedBy: 'Ada Owner',
    } as never)
    expect(file.visits.at(-1)).toMatchObject({
      bookedPriceMinor: 7600,
      quietTimeUsualPriceMinor: 9500,
    })
    expect(clientExportText(file)).toContain(
      'booked at £76.00, a quiet-time price (usually £95.00)',
    )
  })
})

describe('who sets and writes a lower price', () => {
  it('lets only the owner set it, and everyone who writes invitations write one', () => {
    expect(can('owner', 'quiet-offers')).toBe(true)
    for (const role of ['manager', 'reception', 'practitioner', 'general', 'regional'] as const)
      expect(can(role, 'quiet-offers')).toBe(false)
    const invite = {
      type: 'offer-invite',
      clientId: 'client-13',
      serviceId: 'service-facial',
      staffId: 'staff-maya',
      date: '2026-10-07',
      startMinutes: 600,
    } as Command
    expect(permissionFor(invite)).toBe('message')
    expect(can('reception', 'message')).toBe(true)
    expect(can('reception', 'message.queue')).toBe(false)
    expect(can('general', 'message')).toBe(true)
    expect(can('practitioner', 'message')).toBe(false)
    // A general manager writes and approves only for a time at their own location.
    const s = studio()
    expect(branchRefusal(s, 'loc-london', invite)).toBeNull()
    expect(branchRefusal(s, 'loc-other', invite)).toBe('That time is at another location.')
    const next = cancelZoe(s)
    const queue = { type: 'message-queue', messageId: invitations(next)[0].id } as Command
    expect(branchRefusal(next, 'loc-london', queue)).toBeNull()
    expect(branchRefusal(next, 'loc-other', queue)).toBe(
      'That invitation is for a time at another location.',
    )
    // The owner's setting is the whole business's.
    expect(
      branchRefusal(s, 'loc-london', { type: 'quiet-offers', settings: defaultQuietOffers }),
    ).toBe('That changes the whole business. Ask the owner or a manager.')
  })

  it('refuses treatments the studio does not have, and keeps who changed what', () => {
    const s = teamChooses(studio({}))
    expect(
      refusal(
        run(s, {
          type: 'quiet-offers',
          settings: { ...defaultQuietOffers, leftOutIds: ['service-unknown'] },
        }),
      ),
    ).toBe('Choose treatments from this studio to leave out.')
    const settings = { ...defaultQuietOffers, discount: 'percent' as const, offPercent: 25 }
    const after = apply(s, { type: 'quiet-offers', settings })
    const detail = changeDetail(s, after, 'quiet-offers', after.organisation.id)
    expect(detail?.fields).toEqual([
      { f: 'discount', from: 'none', to: 'percent' },
      { f: 'offPercent', from: 20, to: 25 },
    ])
    const entry = describeChange(after, recordNames(after), {
      id: 'change-1',
      action: 'quiet-offers',
      recordId: after.organisation.id,
      occurredAt: 0,
      actor: 'Ada Owner',
      account: null,
      detail: JSON.stringify(detail),
    })
    expect(entry).toMatchObject({
      group: 'settings',
      what: 'Changed the lower price for quiet times',
      lines: [
        { what: 'lower price for quiet times', from: 'no lower price', to: 'a percentage off' },
        { what: 'percentage off', from: '20%', to: '25%' },
      ],
    })
  })
})
