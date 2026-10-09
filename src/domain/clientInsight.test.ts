import { describe, expect, it } from 'vitest'
import { clientInsight } from './clientInsight'
import { addDays } from './format'
import { drifting } from './insights'
import { DEMO_DATE } from './model'
import { dueClients, report, usualWeeks } from './selectors'
import { retailRevenue } from './retail'
import { recordDay } from './tillCount'
import { seed } from './seed'
import {
  SATURDAY,
  TODAY,
  addClient,
  addMembership,
  addOffer,
  addVisit,
  at,
  cancelled,
  monthlyRegular,
  patchTest,
  studio,
} from '../test/clientInsightStudio'

describe('At a glance on the client page', () => {
  it('describes a regular monthly client from their own history', () => {
    const s = studio()
    const amelia = addClient(s, 'Amelia Carter')
    const visits = monthlyRegular(s, amelia.id, SATURDAY, 13)
    // Products bought with one visit: £24 including £4 tax counts as £20, as on the Business page.
    s.sales.find((x) => x.appointmentId === visits[5].id)!.retail = {
      lines: [{ productId: 'p1', name: 'Cleanser', quantity: 1, unitMinor: 2400 }],
      subtotalMinor: 2400,
      taxMinor: 400,
      taxRateBps: 2000,
      taxInclusive: true,
      taxLabel: 'VAT',
    }
    // Their next visit, booked at checkout last Saturday.
    addVisit(s, amelia.id, addDays(SATURDAY, 28), {
      status: 'confirmed',
      rebookedFromId: visits.at(-1)!.id,
      source: 'rebook',
    })

    const insight = clientInsight(s, amelia, TODAY)
    expect(insight).toMatchObject({
      since: '2025-11-01',
      completedVisits: 13,
      isNew: false,
      usualWeeks: 4,
      booked: true,
      due: false,
      favouriteTreatment: { serviceId: 'facial', name: 'Restorative Facial', visits: 13, of: 13 },
      favouriteProfessional: { staffId: 'maya', name: 'Maya Lind', visits: 13, of: 13 },
      timing: { weekday: 6, partOfDay: 'morning', visits: 13 },
      reliability: { noShows: 0, lateCancellations: 0, kept: 13 },
      rebooking: { rebooked: 13, of: 13 },
      plans: [],
      next: null,
    })
    expect(insight.drifting).toBeUndefined()
    expect(insight.nextVisit?.date).toBe('2026-10-31')
    // Treatments and products without tips: 13 × £95 + £20.
    expect(insight.spend).toEqual({
      totalMinor: 13 * 9500 + 2000,
      treatmentsMinor: 13 * 9500,
      productsMinor: 2000,
      perVisitMinor: Math.round((13 * 9500 + 2000) / 13),
      visitsWithReceipts: 13,
    })
  })

  it('counts only the last 12 months, the same year as the page’s visit track', () => {
    const s = studio()
    const client = addClient(s, 'Ruby Taylor')
    addVisit(s, client.id, addDays(TODAY, -365)) // a day too early
    addVisit(s, client.id, addDays(TODAY, -364)) // the first day of the year
    addVisit(s, client.id, addDays(TODAY, -200))
    const insight = clientInsight(s, client, TODAY)
    expect(insight.completedVisits).toBe(3)
    expect(insight.spend).toMatchObject({ totalMinor: 2 * 9500, visitsWithReceipts: 2 })
    expect(insight.reliability).toBeUndefined()
  })

  it('notices a client drifting away exactly as Today does, and suggests inviting them back', () => {
    const s = studio()
    const charlotte = addClient(s, 'Charlotte Hayes')
    const quiet = addClient(s, 'Jamie Morgan', { marketingConsent: false })
    // Every four weeks until 8 August, eight weeks and six days ago, then nothing booked.
    monthlyRegular(s, charlotte.id, addDays(SATURDAY, -56), 6, { startMinutes: 10 * 60 + 30 })
    monthlyRegular(s, quiet.id, addDays(SATURDAY, -56), 6, { staffId: 'theo' })

    const insight = clientInsight(s, charlotte, TODAY)
    const today = drifting(s, TODAY).find((d) => d.clientId === charlotte.id)!
    expect(insight.drifting).toEqual({
      weeksSince: today.weeksSince,
      usualWeeks: today.usualWeeks,
    })
    expect(insight.drifting).toEqual({ weeksSince: 8, usualWeeks: 4 })
    expect(insight.due).toBe(true)
    expect(insight.next).toEqual({
      kind: 'invite-back',
      weeksSince: 8,
      usualWeeks: 4,
      consent: true,
      // Their usual, on the next Saturday at their usual time.
      booking: {
        serviceId: 'facial',
        staffId: 'maya',
        date: '2026-10-10',
        startMinutes: 10 * 60 + 30,
        usual: true,
      },
    })
    // Without permission for email news, the step is to book them when they are next in touch.
    expect(clientInsight(s, quiet, TODAY).next).toMatchObject({
      kind: 'invite-back',
      consent: false,
      booking: { serviceId: 'facial', staffId: 'theo' },
    })
  })

  it('does not offer a second invitation while one written since their last visit is waiting', () => {
    const s = studio()
    const client = addClient(s, 'Charlotte Hayes')
    monthlyRegular(s, client.id, addDays(SATURDAY, -56), 6)
    const message = (status: 'draft' | 'queued' | 'suppressed', createdAt: string) =>
      s.operations!.messages.push({
        id: `message-${status}-${createdAt}`,
        clientId: client.id,
        purpose: 'marketing',
        subject: 'We would love to see you, Charlotte',
        body: 'Hello Charlotte.',
        status,
        createdAt,
        actor: 'Front desk',
      })
    const invited = () => {
      const next = clientInsight(s, client, TODAY).next
      return next?.kind === 'invite-back' ? next.invited : 'not drifting'
    }
    // One from before their last visit, and one held back, do not count.
    message('queued', at('2026-07-01'))
    message('suppressed', at('2026-09-20'))
    expect(invited()).toBeUndefined()
    message('queued', at('2026-09-01'))
    expect(invited()).toBe('approved')
    message('draft', at('2026-10-01'))
    expect(invited()).toBe('draft')
  })

  it('agrees with Today’s drifting and ready-to-return lists for every sample client', () => {
    const s = seed('UK', { regulars: true })
    const drifters = new Map(drifting(s, DEMO_DATE).map((d) => [d.clientId, d]))
    const due = new Set(dueClients(s).map((c) => c.id))
    for (const client of s.clients) {
      const insight = clientInsight(s, client, DEMO_DATE)
      const today = drifters.get(client.id)
      expect(insight.drifting && { id: client.id, ...insight.drifting }).toEqual(
        today && { id: client.id, weeksSince: today.weeksSince, usualWeeks: today.usualWeeks },
      )
      expect(insight.due).toBe(due.has(client.id))
      // The same usual gap as the page heading.
      const completed = s.appointments
        .filter((a) => a.clientId === client.id && a.status === 'completed')
        .map((a) => a.date)
      expect(insight.usualWeeks).toBe(usualWeeks(completed))
    }
  })

  it('adds up to the Business page’s takings for the same year', () => {
    const s = seed('UK', { regulars: true })
    const year = report(s, 365)
    const insights = s.clients.map((c) => clientInsight(s, c, DEMO_DATE))
    const treatments = insights.reduce((sum, i) => sum + (i.spend?.treatmentsMinor ?? 0), 0)
    const products = insights.reduce((sum, i) => sum + (i.spend?.productsMinor ?? 0), 0)
    const unnamed = (s.counterSales ?? [])
      .filter((sale) => !sale.clientId && recordDay(s, sale.paidAt) >= year.from)
      .reduce((sum, sale) => sum + retailRevenue(sale), 0)
    expect(treatments).toBe(year.revenue)
    expect(products + unnamed).toBe(year.retail)
  })

  it('suggests booking their usual when they are due back but not yet drifting', () => {
    const s = studio()
    const client = addClient(s, 'Ava Williams')
    // Wednesdays every four weeks; the last was 30 days ago, past the four-week due date.
    monthlyRegular(s, client.id, addDays(TODAY, -30), 4, {
      serviceId: 'massage',
      staffId: 'theo',
    })
    const insight = clientInsight(s, client, TODAY)
    expect(insight.drifting).toBeUndefined()
    expect(insight.dueOn).toBe(addDays(TODAY, -2))
    expect(insight.next).toEqual({
      kind: 'book-usual',
      dueOn: addDays(TODAY, -2),
      // Their usual, on the next Wednesday.
      booking: {
        serviceId: 'massage',
        staffId: 'theo',
        date: '2026-10-14',
        startMinutes: 600,
        usual: true,
      },
    })
    // A treatment that sets its own return time moves the due date, as on Today.
    s.services.find((x) => x.id === 'massage')!.returnWeeks = 6
    const later = clientInsight(s, client, TODAY)
    expect(later.dueOn).toBe(addDays(TODAY, 12))
    expect(later.next).toBeNull()
  })

  it('leaves out a booking suggestion’s professional who has left or no longer does it', () => {
    const s = studio()
    const client = addClient(s, 'Ava Williams')
    monthlyRegular(s, client.id, addDays(TODAY, -30), 4, { staffId: 'theo' })
    s.staff.find((x) => x.id === 'theo')!.archived = true
    expect(clientInsight(s, client, TODAY).next).toMatchObject({
      kind: 'book-usual',
      booking: { serviceId: 'facial', usual: true },
    })
    expect(clientInsight(s, client, TODAY).next).not.toHaveProperty('booking.staffId')
    s.staff.find((x) => x.id === 'theo')!.archived = false
    s.staff.find((x) => x.id === 'theo')!.serviceIds = ['massage']
    expect(clientInsight(s, client, TODAY).next).not.toHaveProperty('booking.staffId')
  })

  it('says nothing it cannot know about a new client', () => {
    const s = studio()
    const nina = addClient(s, 'Nina Patel')
    addVisit(s, nina.id, addDays(TODAY, -10))
    const one = clientInsight(s, nina, TODAY)
    expect(one).toMatchObject({ completedVisits: 1, isNew: true, usualWeeks: null, next: null })
    for (const key of ['favouriteTreatment', 'favouriteProfessional', 'timing', 'rebooking'])
      expect(one).not.toHaveProperty(key)
    expect(one.reliability).toBeUndefined()
    expect(one.spend).toMatchObject({ totalMinor: 9500 })
    expect(one.spend).not.toHaveProperty('perVisitMinor')

    const fresh = addClient(s, 'Isabel Wilson')
    const none = clientInsight(s, fresh, TODAY)
    expect(none).toMatchObject({ completedVisits: 0, isNew: true, due: false, next: null })
    expect(none.spend).toBeUndefined()
    expect(none.dueOn).toBeUndefined()
  })

  it('counts missed visits and late cancellations kindly, over the last 12 months only', () => {
    const s = studio()
    const client = addClient(s, 'Luca Evans')
    monthlyRegular(s, client.id, addDays(TODAY, -14), 4)
    addVisit(s, client.id, addDays(TODAY, -40), { status: 'no_show' })
    addVisit(s, client.id, addDays(TODAY, -100), { status: 'no_show' })
    addVisit(s, client.id, addDays(TODAY, -400), { status: 'no_show' }) // over a year ago
    // Cancelled two days ahead: not late. Cancelled three hours before: late.
    const early = addVisit(s, client.id, addDays(TODAY, -60), { status: 'confirmed' })
    cancelled(s, early, at(addDays(TODAY, -62), '09:00'))
    const late = addVisit(s, client.id, addDays(TODAY, -80), { status: 'confirmed' })
    cancelled(s, late, at(addDays(TODAY, -80), '06:00'))
    expect(clientInsight(s, client, TODAY).reliability).toEqual({
      noShows: 2,
      lateCancellations: 1,
      kept: 4,
    })
  })

  it('reads a late cancellation on the studio’s clock when the clocks go back', () => {
    // London leaves summer time on 25 October 2026: 09:00 on the 26th is 09:00 UTC.
    const s = studio()
    const client = addClient(s, 'Zoe Miller')
    const visit = addVisit(s, client.id, '2026-10-26', { status: 'confirmed', startMinutes: 540 })
    // 24 and a half hours before. Read with summer time it would look 23 and a half.
    cancelled(s, visit, '2026-10-25T08:30:00.000Z')
    expect(clientInsight(s, client, '2026-10-27').reliability).toBeUndefined()
    s.events.at(-1)!.occurredAt = '2026-10-25T09:30:00.000Z'
    expect(clientInsight(s, client, '2026-10-27').reliability).toMatchObject({
      lateCancellations: 1,
    })
  })

  it('counts products bought at the desk on the studio’s own day at the edges of the year', () => {
    // New York, at the end of October: the year runs from 1 November 2025 to 31 October 2026.
    const s = studio({ region: 'US', timeZone: 'America/New_York' })
    const client = addClient(s, 'Grace Chen')
    const today = '2026-10-31'
    addVisit(s, client.id, '2025-10-31') // the day before the year starts
    addVisit(s, client.id, '2025-11-01') // its first day
    const sale = (id: string, paidAt: string) => ({
      id,
      organisationId: s.organisation.id,
      clientId: client.id,
      receiptNumber: id,
      currency: 'USD' as const,
      retail: {
        lines: [{ productId: 'p1', name: 'Serum', quantity: 1, unitMinor: 3000 }],
        subtotalMinor: 3000,
        taxMinor: 0,
        taxRateBps: 0,
        taxInclusive: false,
        taxLabel: 'Sales tax',
      },
      totalMinor: 3000,
      method: 'cash' as const,
      actor: 'Front desk',
      paidAt,
    })
    s.counterSales = [
      // 23:30 on 31 October 2025 in New York, though already 1 November in UTC: outside.
      sale('c1', '2025-11-01T03:30:00.000Z'),
      // 22:00 on 31 October 2026 in New York, though 1 November in UTC: inside.
      sale('c2', '2026-11-01T02:00:00.000Z'),
    ]
    expect(clientInsight(s, client, today).spend).toMatchObject({
      treatmentsMinor: 9500,
      productsMinor: 3000,
      totalMinor: 12500,
    })
  })

  it('reads the weekday and time of day from the studio’s own dates', () => {
    const s = studio({ region: 'US', timeZone: 'America/Los_Angeles' })
    const client = addClient(s, 'Sophie Martin')
    // Saturday evenings at 18:30, studio time, at month ends: a UTC reading would say Sunday.
    for (const date of ['2026-01-31', '2026-02-28', '2026-03-28', '2026-04-25', '2026-05-30'])
      addVisit(s, client.id, date, { startMinutes: 18 * 60 + 30 })
    expect(clientInsight(s, client, '2026-06-01').timing).toEqual({
      weekday: 6,
      partOfDay: 'evening',
      visits: 5,
    })
  })

  it('names a favourite only when there is a clear one', () => {
    const s = studio()
    const tied = addClient(s, 'Ellie Brooks')
    addVisit(s, tied.id, addDays(TODAY, -70), { serviceId: 'facial', staffId: 'maya' })
    addVisit(s, tied.id, addDays(TODAY, -50), { serviceId: 'massage', staffId: 'theo' })
    addVisit(s, tied.id, addDays(TODAY, -30), { serviceId: 'facial', staffId: 'theo' })
    addVisit(s, tied.id, addDays(TODAY, -10), { serviceId: 'massage', staffId: 'maya' })
    const even = clientInsight(s, tied, TODAY)
    expect(even.favouriteTreatment).toBeUndefined()
    expect(even.favouriteProfessional).toBeUndefined()
    // And no pattern of days: four visits on four different weekdays is not a habit.
    expect(even.timing?.weekday).toBeUndefined()

    addVisit(s, tied.id, addDays(TODAY, -5), { serviceId: 'facial', staffId: 'theo' })
    const leading = clientInsight(s, tied, TODAY)
    expect(leading.favouriteTreatment).toMatchObject({ serviceId: 'facial', visits: 3, of: 5 })
    expect(leading.favouriteProfessional).toMatchObject({ staffId: 'theo', visits: 3, of: 5 })

    // Leading by one among many treatments is not a favourite: two of five is under half.
    // A cancelled visit does not count towards it.
    s.services.push({ ...s.services[0], id: 'brows', name: 'Brow Shape' })
    const spread = addClient(s, 'Noor Ahmed')
    addVisit(s, spread.id, addDays(TODAY, -60), { serviceId: 'facial' })
    addVisit(s, spread.id, addDays(TODAY, -50), { serviceId: 'facial' })
    addVisit(s, spread.id, addDays(TODAY, -40), { serviceId: 'massage' })
    addVisit(s, spread.id, addDays(TODAY, -30), { serviceId: 'colour' })
    addVisit(s, spread.id, addDays(TODAY, -20), { serviceId: 'facial', status: 'cancelled' })
    addVisit(s, spread.id, addDays(TODAY, -10), { serviceId: 'brows' })
    expect(clientInsight(s, spread, TODAY).favouriteTreatment).toBeUndefined()
  })

  it('puts an unpaid membership first, even before a client drifting away', () => {
    const s = studio()
    const client = addClient(s, 'Emily Clarke')
    monthlyRegular(s, client.id, addDays(SATURDAY, -56), 6)
    const holding = addMembership(s, client.id, '2026-08-01', '2026-09-01')
    const insight = clientInsight(s, client, TODAY)
    expect(insight.plans).toEqual([
      expect.objectContaining({ holdingId: holding.id, state: 'unpaid', paidUntil: '2026-09-01' }),
    ])
    expect(insight.next).toEqual({
      kind: 'membership-unpaid',
      holdingId: holding.id,
      name: 'Glow Membership',
      paidUntil: '2026-09-01',
    })
    // Taken from a saved card each month: the step names the card, until card payments end.
    const agreement = {
      id: 'agreement-1',
      cardId: 'card-1',
      brand: 'Visa',
      last4: '0002',
      wording: 'Fictional agreement words, as read to the client at the desk.',
      agreedAt: '2026-08-01T10:00:00.000Z',
      recordedBy: 'owner',
      startsOn: '2026-09-01',
    }
    holding.cardAgreements = [agreement]
    expect(clientInsight(s, client, TODAY).next).toMatchObject({ cardLast4: '0002' })
    holding.cardAgreements = [{ ...agreement, endedAt: '2026-09-20T10:00:00.000Z' }]
    expect(clientInsight(s, client, TODAY).next).not.toHaveProperty('cardLast4')
    // Once paid it is a plain fact again and drifting away comes first.
    holding.paidUntil = '2026-11-01'
    expect(clientInsight(s, client, TODAY).next?.kind).toBe('invite-back')
  })

  it('reads a membership month that ends at the end of a month on the right day', () => {
    const s = studio()
    const client = addClient(s, 'Olivia James')
    addVisit(s, client.id, '2026-08-31')
    // Started on 31 August: its first month runs to 30 September.
    addMembership(s, client.id, '2026-08-31', '2026-09-30')
    expect(clientInsight(s, client, '2026-09-29').plans[0].state).toBe('active')
    expect(clientInsight(s, client, '2026-09-30').next).toMatchObject({
      kind: 'membership-unpaid',
      paidUntil: '2026-09-30',
    })
  })

  it('mentions a membership to a monthly client who spends more than it costs', () => {
    const s = studio()
    const client = addClient(s, 'Amelia Carter')
    const visits = monthlyRegular(s, client.id, SATURDAY, 6)
    addVisit(s, client.id, addDays(SATURDAY, 28), {
      status: 'confirmed',
      rebookedFromId: visits.at(-1)!.id,
    })
    const offer = addOffer(s, { priceMinor: 7900 })
    // Facials at £95 on 3 Oct, 5 Sept, 8 Aug and 11 July: the last three months hold three.
    expect(clientInsight(s, client, TODAY).next).toEqual({
      kind: 'mention-membership',
      offerId: offer.id,
      name: 'Glow Membership',
      priceMinor: 7900,
      monthlyMinor: 9500,
    })
    // Not when it costs more than they spend, nor when it is no longer on sale.
    offer.priceMinor = 9600
    expect(clientInsight(s, client, TODAY).next).toBeNull()
    offer.priceMinor = 7900
    offer.archived = true
    expect(clientInsight(s, client, TODAY).next).toBeNull()
    offer.archived = false
    // Nor to someone who already holds a membership.
    addMembership(s, client.id, '2026-10-01', '2026-11-01')
    expect(clientInsight(s, client, TODAY).next).toBeNull()
  })

  it('does not mention a membership to someone who comes less often than monthly', () => {
    const s = studio()
    const client = addClient(s, 'Sophie Martin')
    for (const weeks of [0, 6, 12, 18]) addVisit(s, client.id, addDays(SATURDAY, -7 * weeks))
    addVisit(s, client.id, addDays(SATURDAY, 42), { status: 'confirmed' })
    addOffer(s, { priceMinor: 1000 })
    const insight = clientInsight(s, client, TODAY)
    expect(insight.usualWeeks).toBe(6)
    expect(insight.next).toBeNull()
  })

  it('asks for a patch test before their next visit when it is not in order', () => {
    const s = studio()
    const client = addClient(s, 'Grace Chen')
    addVisit(s, client.id, addDays(TODAY, -60), { serviceId: 'colour' })
    addVisit(s, client.id, addDays(TODAY, -30), { serviceId: 'colour' })
    const next = addVisit(s, client.id, addDays(TODAY, 3), {
      serviceId: 'colour',
      status: 'confirmed',
    })
    expect(clientInsight(s, client, TODAY).next).toMatchObject({
      kind: 'patch-test',
      appointmentId: next.id,
      date: next.date,
      state: 'needed',
      earlier: false,
    })
    // A clear test well before the visit puts it in order.
    patchTest(s, client.id, at(TODAY, '08:00'), 'clear')
    const fine = clientInsight(s, client, TODAY)
    expect(fine.next).toBeNull()
    expect(fine.patchTest).toBeUndefined()
  })

  it('says a patch test has run out, without making it the next step, when nothing is booked', () => {
    const s = studio()
    const client = addClient(s, 'Luca Evans')
    patchTest(s, client.id, at('2026-01-05'), 'clear')
    for (const days of [70, 42, 14])
      addVisit(s, client.id, addDays(TODAY, -days), {
        serviceId: 'colour',
      })
    const insight = clientInsight(s, client, TODAY)
    expect(insight.patchTest).toMatchObject({ state: 'needed', earlier: true })
    expect(insight.patchTest?.appointmentId).toBeUndefined()
    expect(insight.next).toBeNull()
  })

  it('stays quick in a busy studio, reading only what belongs to the client', () => {
    const s = studio()
    const client = addClient(s, 'Amelia Carter')
    monthlyRegular(s, client.id, SATURDAY, 13)
    const other = addClient(s, 'Someone Else')
    for (let i = 0; i < 20_000; i++)
      addVisit(s, other.id, addDays(TODAY, -(i % 700)), { startMinutes: 540 + (i % 8) * 60 })
    const started = performance.now()
    const insight = clientInsight(s, client, TODAY)
    expect(insight.completedVisits).toBe(13)
    // Generous, so a busy test machine does not fail it; it takes a few milliseconds.
    expect(performance.now() - started).toBeLessThan(1000)
  })
})
