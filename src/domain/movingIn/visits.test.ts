import { describe, expect, it } from 'vitest'
import { execute } from '../commands'
import type { Command } from '../commands'
import type { BusinessState } from '../model'
import { createWorkspace } from '../workspace'
import { seed } from '../seed'
import { readDelimited } from './sheet'
import { reviewClients, understandFile } from './clients'
import type { MovingClient } from './clients'
import {
  durationFrom,
  moneyFrom,
  needsAnswer,
  reviewVisits,
  slotLength,
  statusKind,
  timeFrom,
  treatmentKey,
  visitRows,
  whenFrom,
} from './visits'
import type { NameChoices } from './visits'

// Moving in, stage 2: upcoming visits from the old system's own files.
// 08:00 UTC on Tuesday 6 October 2026 is 09:00 in London.
const now = '2026-10-06T08:00:00.000Z'
let n = 0
const makeId = () => `visit-move-${++n}`
function studio(): BusinessState {
  const s = createWorkspace({ name: 'Moving test studio', region: 'UK' })
  const sample = seed('UK')
  for (const key of ['clients', 'services', 'staff', 'resources'] as const)
    Object.assign(s, {
      [key]: sample[key].map((row) => ({ ...row, organisationId: s.organisation.id })),
    })
  return s
}
function apply(s: BusinessState, command: Command) {
  const result = execute(s, command, now, makeId)
  if (!result.ok) throw new Error(result.error)
  return result.state
}
const file = (name: string, lines: string[]) =>
  understandFile({ fileName: name, rows: readDelimited(name, lines.join('\n')) })
const none: NameChoices = { treatment: {}, professional: {} }

const FRESHA_HEADINGS =
  'Appt. ref.,Client,Team member,Status,Created date,Scheduled date,Cancelled date,Category,Service,Duration (mins),Appt. slot,Created by,Cancelled by,Location,Net sales,Cancellation reason,Fees charged,Upfront payments'
/** One Fresha appointments-list row. */
function fresha(
  ref: string,
  client: string,
  who: string,
  status: string,
  when: string,
  service: string,
  slot: string,
  price = '85.00',
  upfront = '0.00',
) {
  return `${ref},${client},${who},${status},"1 Oct 2026, 9:12am","${when}",,Skin,${service},1h,${slot},${who},,Main,${price},,0.00,${upfront}`
}

describe('reading visits as old systems write them', () => {
  it('reads times, slots and lengths', () => {
    expect(timeFrom('14:30')).toBe(870)
    expect(timeFrom('2:30pm')).toBe(870)
    expect(timeFrom('2:30 P.M.')).toBe(870)
    expect(timeFrom('12.05am')).toBe(5)
    expect(timeFrom('12pm')).toBe(720)
    expect(timeFrom('10:30:00-11:30:00')).toBe(630)
    expect(timeFrom('1899-12-30 10:30')).toBe(630)
    expect(timeFrom('0.4375')).toBe(630)
    expect(timeFrom('25:00')).toBeNull()
    expect(timeFrom('soon')).toBeNull()
    expect(slotLength('10:30:00-11:45:00')).toBe(75)
    expect(slotLength('10:30')).toBeNull()
    expect(durationFrom('1h 30min')).toBe(90)
    expect(durationFrom('1h30min')).toBe(90)
    expect(durationFrom('45min')).toBe(45)
    expect(durationFrom('90')).toBe(90)
    expect(durationFrom('1:15')).toBe(75)
    expect(durationFrom('1.5 hours')).toBe(90)
    expect(durationFrom('long')).toBeNull()
  })

  it('reads dates in every system’s style, with the time when the cell has one', () => {
    expect(whenFrom('14 Oct 2026, 10:30am', '', 'dayFirst')).toEqual({
      date: '2026-10-14',
      start: 630,
    })
    expect(whenFrom('14 Oct 2026, 10:30am', '10:30:00-11:30:00', 'dayFirst')?.start).toBe(630)
    expect(whenFrom('2026-10-14 15:05', '', 'dayFirst')).toEqual({ date: '2026-10-14', start: 905 })
    expect(whenFrom('14/10/2026', '9:00', 'dayFirst')).toEqual({ date: '2026-10-14', start: 540 })
    expect(whenFrom('10/14/2026 2:30 PM', '', 'monthFirst')).toEqual({
      date: '2026-10-14',
      start: 870,
    })
    expect(whenFrom('October 14, 2026 10:00', '', 'monthFirst')?.start).toBe(600)
    expect(whenFrom('Wed 14th Oct 2026', '11am', 'dayFirst')).toEqual({
      date: '2026-10-14',
      start: 660,
    })
    expect(whenFrom('14/10/26', '', 'dayFirst')).toEqual({ date: '2026-10-14', start: null })
    expect(whenFrom('31/02/2026', '', 'dayFirst')).toBeNull()
    expect(whenFrom('next Tuesday', '', 'dayFirst')).toBeNull()
  })

  it('reads money, statuses and treatment names', () => {
    expect(moneyFrom('£1,250.50')).toBe(125050)
    expect(moneyFrom('85')).toBe(8500)
    expect(moneyFrom('85,00')).toBe(8500)
    expect(moneyFrom('(12.00)')).toBe(-1200)
    expect(moneyFrom('Free')).toBe(0)
    expect(moneyFrom('Variable')).toBeNull()
    expect(statusKind('Confirmed')).toBe('active')
    expect(statusKind('New')).toBe('active')
    expect(statusKind('Cancelled')).toBe('cancelled')
    expect(statusKind('CANCELED')).toBe('cancelled')
    expect(statusKind('No Show')).toBe('missed')
    expect(statusKind('Requested')).toBe('request')
    expect(treatmentKey('Gloss & Tone (45 mins)')).toBe('gloss and tone')
    expect(treatmentKey('Signature cut and finish - 1h 30min')).toBe('signature cut and finish')
  })

  it('recognises a Fresha appointments list and every column without asking', () => {
    const f = file('report_appointment-list_2026-10-06.csv', [
      FRESHA_HEADINGS,
      fresha(
        'A1',
        'Amelia Carter',
        'Maya Lewis',
        'Confirmed',
        '8 Oct 2026, 10:05am',
        'Skin Renewal Facial',
        '10:05:00-11:05:00',
      ),
    ])
    expect(f).toMatchObject({ system: 'fresha', kind: 'visits', report: 'appointments list' })
    const fields = Object.fromEntries(f.visitMatches.map((m) => [m.heading, m.field]))
    expect(fields).toMatchObject({
      'Appt. ref.': 'reference',
      Client: 'client',
      'Team member': 'professional',
      'Scheduled date': 'date',
      'Appt. slot': 'time',
      Service: 'treatment',
      'Net sales': 'price',
      'Upfront payments': 'deposit',
      'Created date': null,
      Location: null,
    })
    expect(f.visitMatches.filter((m) => m.confidence === 'low')).toEqual([])
  })

  it('reads a file it has no layout for by its words and what is inside', () => {
    const own = file('visits.csv', [
      'date,time,service,professional,email,name,phone,price,deposit_paid,reference',
      '08/10/2026,10:05,Skin Renewal Facial,Maya Lewis,amelia.carter@example.com,,,85.00,20.00,BK-1',
    ])
    expect(own.kind).toBe('visits')
    expect(Object.fromEntries(own.visitMatches.map((m) => [m.heading, m.field]))).toEqual({
      date: 'date',
      time: 'time',
      service: 'treatment',
      professional: 'professional',
      email: 'email',
      name: 'client',
      phone: 'phone',
      price: 'price',
      deposit_paid: 'deposit',
      reference: 'reference',
    })
    // Acuity has every client column too, but its times make it visits.
    const acuity = file('schedule.csv', [
      'Start Time,End Time,First Name,Last Name,Phone,Email,Type,Calendar,Price,Paid,Amount Paid Online,Date Scheduled,Appointment ID',
      '"October 8, 2026 10:00","October 8, 2026 11:00",Amelia,Carter,07700 900001,amelia.carter@example.com,Facial,Maya Lewis,95,yes,25,"October 1, 2026",1001',
    ])
    expect(acuity.kind).toBe('visits')
    const fields = Object.fromEntries(acuity.visitMatches.map((m) => [m.heading, m.field]))
    expect(fields).toMatchObject({
      'Start Time': 'date',
      'End Time': null,
      'First Name': 'firstName',
      'Last Name': 'lastName',
      Type: 'treatment',
      Calendar: 'professional',
      'Amount Paid Online': 'deposit',
      'Date Scheduled': null,
      'Appointment ID': 'reference',
    })
  })
})

describe('reviewing upcoming visits', () => {
  it('brings ready visits across and says plainly why any other one stays behind', () => {
    const s = studio()
    const first = file('report_appointment-list_2026-10-06.csv', [
      FRESHA_HEADINGS,
      // Ready: an existing client, with the deposit they paid to Fresha.
      fresha(
        'A1',
        'Amelia Carter',
        'Maya Lewis',
        'Confirmed',
        '8 Oct 2026, 10:05am',
        'Skin Renewal Facial',
        '10:05:00-11:05:00',
        '85.00',
        '20.00',
      ),
      fresha(
        'A2',
        'Olivia James',
        'Maya Lewis',
        'Cancelled',
        '8 Oct 2026, 1:00pm',
        'Skin Renewal Facial',
        '13:00:00-14:00:00',
      ),
      fresha(
        'A3',
        'Olivia James',
        'Maya Lewis',
        'Completed',
        '1 Oct 2026, 1:00pm',
        'Skin Renewal Facial',
        '13:00:00-14:00:00',
      ),
      // Ready: the treatment's length in its name and a first name only for the professional.
      fresha(
        'A4',
        'Ellie Brooks',
        'Theo',
        'New',
        '9 Oct 2026, 2:00pm',
        'Gloss and tone (45 mins)',
        '14:00:00-14:45:00',
        '65.00',
      ),
      fresha(
        'A5',
        'Noor Ahmed',
        'Maya Lewis',
        'Confirmed',
        '9 Oct 2026, 9:30am',
        'Brow lamination',
        '09:30:00-10:00:00',
        '40.00',
      ),
      fresha(
        'A6',
        'Ava Williams',
        'Maya Lewis',
        'Confirmed',
        '9 Oct 2026, 11:00am',
        'Lymphatic Massage',
        '11:00:00-12:15:00',
        '120.00',
      ),
      fresha(
        'A7',
        'Zoe Miller',
        'Sophia Reed',
        'Confirmed',
        '11 Oct 2026, 11:00am',
        'Deep Restore Massage',
        '11:00:00-12:00:00',
        '90.00',
      ),
      fresha(
        'A8',
        'Walk-In',
        'Sophia Reed',
        'Confirmed',
        '8 Oct 2026, 3:00pm',
        'Deep Restore Massage',
        '15:00:00-16:00:00',
        '90.00',
      ),
      fresha(
        'A9',
        'Nina Patel',
        'Sophia Reed',
        'Confirmed',
        '8 Oct 2026, 10:00am',
        'Deep Restore Massage',
        '10:00:00-11:00:00',
        '90.00',
        '95.00',
      ),
      fresha(
        'A10',
        'Nobody Known',
        'Sophia Reed',
        'Confirmed',
        '8 Oct 2026, 12:00pm',
        'Deep Restore Massage',
        '12:00:00-13:00:00',
        '90.00',
      ),
      // Clashes with A1: Maya is already with Amelia then.
      fresha(
        'A11',
        'Grace Chen',
        'Maya Lewis',
        'Confirmed',
        '8 Oct 2026, 10:30am',
        'Skin Renewal Facial',
        '10:30:00-11:30:00',
      ),
      fresha(
        'A12',
        'Luca Evans',
        'Theo Bennett',
        'Confirmed',
        '12 Oct 2026, 10:00am',
        'Signature Cut & Finish',
        '10:00:00-11:00:00',
        '75.00',
      ),
    ])
    // The same appointments list run again for a longer range repeats A1.
    const second = file('report_appointment-list_2026-10-06 (1).csv', [
      FRESHA_HEADINGS,
      fresha(
        'A1',
        'Amelia Carter',
        'Maya Lewis',
        'Confirmed',
        '8 Oct 2026, 10:05am',
        'Skin Renewal Facial',
        '10:05:00-11:05:00',
        '85.00',
        '20.00',
      ),
    ])
    const review = reviewVisits([first, second], s, [], none, 'fresha', now)
    const by = (line: number) =>
      review.rows.find((r) => r.fileName === first.fileName && r.line === line)!
    expect(review.rows.map((r) => r.status)).toEqual([
      'ready',
      'cancelled',
      'past',
      'ready',
      'problem',
      'problem',
      'problem',
      'problem',
      'problem',
      'problem',
      'problem',
      'problem',
      'combined',
    ])
    expect(by(6).detail).toBe('Choose which of your treatments “Brow lamination” is.')
    expect(by(7).detail).toBe(
      'Maya Lewis is not set up to give Lymphatic Massage in SALEANE. Turn it on in Team, then check again.',
    )
    expect(by(8).detail).toBe('The studio is closed on Sundays in SALEANE.')
    expect(by(9).detail).toContain('walk-in')
    expect(by(10).detail).toBe('The deposit paid (£95.00) is more than the price (£90.00).')
    expect(by(11)).toMatchObject({
      label: expect.stringContaining('Nobody Known'),
      detail: expect.stringContaining('This client is not in SALEANE'),
    })
    expect(by(12).detail).toBe('Maya Lewis already has a visit then.')
    expect(by(13).detail).toBe('Theo Bennett does not work on Mondays in SALEANE.')
    // Only the unsure names are asked about: Theo is likely Theo Bennett; Brow lamination is unknown.
    expect(review.treatments.filter(needsAnswer).map((m) => [m.name, m.how])).toEqual([
      ['Brow lamination', 'none'],
    ])
    expect(review.professionals.filter(needsAnswer).map((m) => [m.name, m.how, m.id])).toEqual([
      ['Theo', 'suggested', 'staff-theo'],
    ])
    expect(review.ready).toEqual([
      {
        client: { id: 'client-1' },
        serviceId: 'service-facial',
        staffId: 'staff-maya',
        date: '2026-10-08',
        startMinutes: 605,
        priceMinor: 8500,
        depositPaidMinor: 2000,
        reference: 'A1',
      },
      {
        client: { id: 'client-3' },
        serviceId: 'service-gloss',
        staffId: 'staff-theo',
        date: '2026-10-09',
        startMinutes: 840,
        priceMinor: 6500,
        depositPaidMinor: 0,
        reference: 'A4',
      },
    ])
    expect(review).toMatchObject({
      valueMinor: 15000,
      depositsMinor: 2000,
      first: '2026-10-08',
      last: '2026-10-09',
    })
    // Fresha's one-hour slot is longer than SALEANE's 45-minute Gloss & Tone: the owner is told.
    expect(by(5).notes.join(' ')).toContain('Booked for 1 hour in Fresha')
  })

  it('follows the owner’s answers: a treatment chosen, a name confirmed, visits left behind', () => {
    const s = studio()
    const f = file('appointments.csv', [
      FRESHA_HEADINGS,
      fresha(
        'B1',
        'Noor Ahmed',
        'Maya Lewis',
        'Confirmed',
        '9 Oct 2026, 9:30am',
        'Brow lamination',
        '09:30:00-10:00:00',
        '40.00',
      ),
      fresha(
        'B2',
        'Ellie Brooks',
        'Theo',
        'Confirmed',
        '9 Oct 2026, 2:00pm',
        'Hair spa',
        '14:00:00-15:00:00',
        '50.00',
      ),
    ])
    const review = reviewVisits(
      [f],
      s,
      [],
      {
        treatment: { 'brow lamination': 'service-facial', 'hair spa': null },
        professional: { theo: 'staff-theo' },
      },
      'fresha',
      now,
    )
    expect(review.rows.map((r) => r.status)).toEqual(['ready', 'skipped'])
    expect(review.rows[1].detail).toBe('You chose to leave “Hair spa” visits behind.')
    expect([...review.treatments, ...review.professionals].filter(needsAnswer)).toEqual([])
    expect(review.ready[0]).toMatchObject({ serviceId: 'service-facial', priceMinor: 4000 })
  })

  it('matches visits to clients coming across in the same move, and adds clients a file names', () => {
    const s = studio()
    const clients = understandFile({
      fileName: 'export_customer_list.csv',
      rows: readDelimited(
        'export_customer_list.csv',
        [
          'First name,Last name,Mobile number,Email,Accepts marketing,Accepts SMS marketing',
          'Grace,Mensah,07700 900201,grace.mensah@example.com,Yes,No',
          'Kofi,Owusu,,,No,No',
        ].join('\n'),
      ),
    })
    const clientReview = reviewClients([clients], s, 'fresha')
    const arriving: MovingClient[] = clientReview.ready
    const visits = file('visits.csv', [
      'date,time,service,professional,email,name,phone,price,deposit_paid,reference',
      '08/10/2026,14:00,Skin Renewal Facial,Maya Lewis,,Grace Mensah,,95.00,,',
      '08/10/2026,16:00,Skin Renewal Facial,Maya Lewis,new.guest@example.com,New Guest,+44 7700 900999,,,',
      '09/10/2026,16:00,Skin Renewal Facial,Maya Lewis,new.guest@example.com,New G.,,,,',
      '09/10/2026,10:00,Skin Renewal Facial,Maya Lewis,,Kofi Owusu,,,,',
      '09/10/2026,12:00,Skin Renewal Facial,Maya Lewis,grace.mensah@example.com,Ama Mensah,,,,',
    ])
    const review = reviewVisits(
      [visits],
      s,
      arriving,
      none,
      'other',
      now,
      clientReview.rows.flatMap((r) => r.name ?? []),
    )
    expect(review.rows.map((r) => r.status)).toEqual([
      'ready',
      'ready',
      'ready',
      'problem',
      'problem',
    ])
    expect(review.ready[0].client).toEqual({
      arriving: { name: 'Grace Mensah', email: 'grace.mensah@example.com', phone: '+447700900201' },
    })
    // One new client however the file spells their name, with marketing off.
    expect(review.newClients).toEqual([
      {
        name: 'New Guest',
        email: 'new.guest@example.com',
        phone: '+447700900999',
        marketingConsent: false,
      },
    ])
    expect(review.ready[1].client).toEqual(review.ready[2].client)
    expect(review.rows[3].detail).toBe(
      'This client is in your client list without an email or phone, so neither they nor this visit can come across.',
    )
    expect(review.rows[4].detail).toBe(
      'The email belongs to Grace Mensah, but this visit is for Ama Mensah. Book it by hand.',
    )

    // Once the clients are saved, each visit finds the client the server made for it.
    let saved = apply(s, {
      type: 'import-clients',
      source: 'Fresha client list',
      contacts: [...arriving, ...review.newClients],
      reviewed: true,
    })
    const { rows, lost } = visitRows(review.ready, saved)
    expect(lost).toBe(0)
    saved = apply(saved, {
      type: 'import-appointments',
      source: 'Fresha',
      appointments: rows,
      reviewed: true,
    })
    const grace = saved.clients.find((c) => c.name === 'Grace Mensah')!
    const guest = saved.clients.find((c) => c.name === 'New Guest')!
    const moved = saved.appointments.filter((a) => a.source === 'import')
    expect(moved.map((a) => [a.clientId, a.date, a.startMinutes])).toEqual([
      [grace.id, '2026-10-08', 840],
      [guest.id, '2026-10-08', 960],
      [guest.id, '2026-10-09', 960],
    ])
    expect(guest.marketingConsent).toBe(false)
    // Reviewing again after the move finds every visit already here.
    const again = reviewVisits([visits], saved, [], none, 'other', now)
    expect(again.counts.here).toBe(3)
    expect(again.ready).toEqual([])
  })

  it('reads SALEANE’s own visits file: a client by email however their name is spelt, and clashes inside the file', () => {
    const s = studio()
    const own = file('visits.csv', [
      'date,time,service,professional,email,name,phone,price,deposit_paid,reference',
      '08/10/2026,10:05,Skin Renewal Facial,Maya Lewis,amelia.carter@example.com,Amelia Carter-Jones,,85.00,20.00,BK-1',
      '08/10/2026,10:30,Skin Renewal Facial,Maya Lewis,olivia.james@example.com,,,,,',
      '08/10/2026,13:00,Skin Renewal Facial,Maya Lewis,new.guest@example.com,New Guest,+44 7700 900999,,,',
      '08/10/2026,15:00,Skin Renewal Facial,Maya Lewis,nobody@example.com,,,,,',
      '01/10/2026,10:00,Skin Renewal Facial,Maya Lewis,amelia.carter@example.com,,,,,',
    ])
    const review = reviewVisits([own], s, [], none, 'other', now)
    expect(review.rows.map((r) => [r.status, r.detail])).toEqual([
      ['ready', 'Skin Renewal Facial with Maya Lewis.'],
      ['problem', 'Maya Lewis already has a visit then.'],
      ['ready', 'Skin Renewal Facial with Maya Lewis.'],
      [
        'problem',
        'No client in SALEANE or in your client list has this email or phone, and the file gives no name to add them by.',
      ],
      ['past', 'A past visit.'],
    ])
    expect(review.ready[0]).toEqual({
      client: { id: 'client-1' },
      serviceId: 'service-facial',
      staffId: 'staff-maya',
      date: '2026-10-08',
      startMinutes: 605,
      priceMinor: 8500,
      depositPaidMinor: 2000,
      reference: 'BK-1',
    })
    // No price in the file: the guest keeps the treatment's own price, and the owner is told.
    expect(review.ready[1]).toMatchObject({
      client: { arriving: { name: 'New Guest', email: 'new.guest@example.com' } },
      priceMinor: 9500,
      depositPaidMinor: 0,
    })
    expect(review.rows[2].notes).toContain(
      'The file gives no price, so it keeps Skin Renewal Facial’s price of £95.00.',
    )
  })

  it('names a file’s missing column and leaves requests for the owner to accept', () => {
    const s = studio()
    const noClient = file('bookings.csv', [
      'Date,Time,Service,Staff,Price',
      '14/10/2026,10:00,Skin Renewal Facial,Maya Lewis,95',
    ])
    const vagaro = file('AppointmentSummary.xlsx', [
      'Customer Name,Appointment Date,Status,Service Name,Employee,Amount',
      'Amelia Carter,10/14/2026 10:00 AM,Requested,Skin Renewal Facial,Maya Lewis,95',
    ])
    expect(noClient.kind).toBe('visits')
    expect(vagaro).toMatchObject({ system: 'vagaro', kind: 'visits' })
    const review = reviewVisits([noClient, vagaro], s, [], none, 'vagaro', now)
    expect(review.missing).toEqual([{ fileName: 'bookings.csv', fields: ['client'] }])
    expect(review.rows[0].detail).toBe(
      'SALEANE could not find the client in bookings.csv. Choose it under “How each column was read”.',
    )
    expect(review.rows[1].detail).toBe(
      'Still a request in Vagaro. Book it by hand if you accept it.',
    )
  })
})
