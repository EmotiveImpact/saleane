import { describe, expect, it } from 'vitest'
import { availableResource, depositPaid, execute, slots } from './commands'
import type { BookingInput, CommandResult } from './commands'
import { seed } from './seed'
import { DEMO_DATE, parseState } from './model'
import type { BusinessState } from './model'
import { addDays, money, timeLabel } from './format'
import { clientStats, dayAppointments, dueClients, report } from './selectors'

const tomorrow = addDays(DEMO_DATE, 1)
const booking: BookingInput = {
  clientId: 'client-1',
  serviceId: 'service-facial',
  staffId: 'staff-maya',
  date: tomorrow,
  startMinutes: 540,
  source: 'desk',
}
function ok(result: CommandResult): asserts result is Extract<CommandResult, { ok: true }> {
  expect(result.ok).toBe(true)
}
function book(s: BusinessState, input = booking) {
  const result = execute(s, { type: 'book', input })
  ok(result)
  return result
}

describe('the shared appointment model', () => {
  it('books a linked client, room, price snapshot, deposit and relationship event', () => {
    const s = seed('UK')
    const result = book(s)
    const appointment = result.state.appointments.find((a) => a.id === result.recordId)!
    expect(appointment).toMatchObject({
      clientId: 'client-1',
      resourceId: 'room-one',
      bookedPriceMinor: 9500,
      bookedBufferMinutes: 15,
      status: 'confirmed',
    })
    expect(depositPaid(result.state, result.recordId)).toBe(2500)
    expect(result.state.events.find((e) => e.appointmentId === result.recordId)?.type).toBe(
      'booked',
    )
    expect(dayAppointments(result.state, tomorrow)).toHaveLength(1)
    expect(clientStats(result.state, 'client-1').next?.id).toBe(result.recordId)
    expect(s.appointments.some((a) => a.id === result.recordId)).toBe(false)
  })
  it('reserves turnaround time as well as treatment time', () => {
    const s = book(seed('UK')).state
    expect(availableResource(s, 'service-facial', 'staff-maya', tomorrow, 600)).toBeNull()
    expect(availableResource(s, 'service-facial', 'staff-maya', tomorrow, 615)).toBe('room-one')
  })
  it('rejects staff overlap even when another room is free', () => {
    const s = book(seed('UK')).state
    expect(execute(s, { type: 'book', input: { ...booking, startMinutes: 570 } }).ok).toBe(false)
  })
  it('rejects exhausted shared resources for an otherwise free professional', () => {
    let s = book(seed('UK')).state
    s = book(s, { ...booking, serviceId: 'service-lymphatic', staffId: 'staff-sophia' }).state
    s.staff.find((staff) => staff.id === 'staff-theo')!.serviceIds.push('service-facial')
    expect(availableResource(s, 'service-facial', 'staff-theo', tomorrow, 540)).toBeNull()
  })
  it.each([
    ['unqualified professional', { staffId: 'staff-theo' }],
    ['past date', { date: addDays(DEMO_DATE, -1) }],
    ['late finish', { startMinutes: 1020 }],
    ['off-grid time', { startMinutes: 541 }],
    ['foreign client', { clientId: 'foreign-client' }],
  ])('rejects %s without mutating the workspace', (_, patch) => {
    const s = seed('UK')
    const snapshot = JSON.stringify(s)
    expect(execute(s, { type: 'book', input: { ...booking, ...patch } }).ok).toBe(false)
    expect(JSON.stringify(s)).toBe(snapshot)
  })
  it('creates a public client only after successful availability validation', () => {
    const s = seed('UK')
    const result = execute(s, {
      type: 'book',
      input: {
        ...booking,
        clientId: undefined,
        date: DEMO_DATE,
        startMinutes: 570,
        contact: {
          name: 'Alex Demo',
          email: 'alex@example.com',
          phone: '+44 7700 900111',
          marketingConsent: false,
        },
        source: 'online',
      },
    })
    expect(result.ok).toBe(false)
    expect(s.clients).toHaveLength(15)
  })
  it('keeps online marketing opt-in independent of the booking', () => {
    const result = book(seed('UK'), {
      ...booking,
      clientId: undefined,
      source: 'online',
      contact: {
        name: 'Alex Demo',
        email: 'alex@example.com',
        phone: '+44 7700 900111',
        marketingConsent: false,
      },
    })
    const appointment = result.state.appointments.find((a) => a.id === result.recordId)!
    expect(result.state.clients.find((c) => c.id === appointment.clientId)?.marketingConsent).toBe(
      false,
    )
  })
  it('does not silently merge clients with a shared email address', () => {
    const s = seed('UK')
    const result = book(s, {
      ...booking,
      clientId: undefined,
      source: 'online',
      contact: {
        name: 'Another Carter',
        email: s.clients[0].email,
        phone: '+44 7700 900112',
        marketingConsent: false,
      },
    })
    expect(result.state.clients.filter((c) => c.email === s.clients[0].email)).toHaveLength(2)
  })
  it('omits booked times from the offered slots', () => {
    const s = book(seed('UK')).state
    expect(slots(s, 'service-facial', 'staff-maya', tomorrow)).not.toContain(540)
    expect(slots(s, 'service-facial', 'staff-maya', tomorrow)).toContain(630)
  })
})

describe('checkout, rebooking and reports', () => {
  it.each(['UK', 'US'] as const)('counts deposits once and separates tips in %s', (region) => {
    const s = seed(region)
    const a = s.appointments.find((a) => a.id === 'visit-amelia')!
    const before = report(s, 7)
    const result = execute(s, {
      type: 'checkout',
      appointmentId: a.id,
      tipMinor: 1425,
      method: 'demo_card',
    })
    ok(result)
    const sale = result.state.sales.find((sale) => sale.id === result.recordId)!
    expect(sale.balanceMinor).toBe(a.bookedPriceMinor + 1425 - 2500)
    expect(
      result.state.payments
        .filter((p) => p.appointmentId === a.id)
        .reduce((sum, p) => sum + p.amountMinor, 0),
    ).toBe(sale.totalMinor)
    expect(report(result.state, 7).revenue - before.revenue).toBe(a.bookedPriceMinor)
    expect(report(result.state, 7).tips - before.tips).toBe(1425)
    expect(result.state.events.find((e) => e.saleId === sale.id)?.clientId).toBe(a.clientId)
  })
  it('makes repeated checkout idempotent', () => {
    const first = execute(seed('UK'), {
      type: 'checkout',
      appointmentId: 'visit-amelia',
      tipMinor: 0,
      method: 'demo_card',
    })
    ok(first)
    const repeated = execute(first.state, {
      type: 'checkout',
      appointmentId: 'visit-amelia',
      tipMinor: 999,
      method: 'demo_cash',
    })
    ok(repeated)
    expect(repeated.state).toBe(first.state)
    expect(repeated.recordId).toBe(first.recordId)
  })
  it('requires arrival before settlement', () => {
    expect(
      execute(seed('UK'), {
        type: 'checkout',
        appointmentId: 'visit-noor',
        tipMinor: 0,
        method: 'demo_card',
      }).ok,
    ).toBe(false)
  })
  it.each([-1, 1.5, Infinity, 19001])('rejects invalid tip %s', (tipMinor) => {
    expect(
      execute(seed('UK'), {
        type: 'checkout',
        appointmentId: 'visit-amelia',
        tipMinor,
        method: 'demo_card',
      }).ok,
    ).toBe(false)
  })
  it('keeps the booked price after catalogue prices change', () => {
    const s = seed('UK')
    s.services[0].priceMinor = 25000
    const result = execute(s, {
      type: 'checkout',
      appointmentId: 'visit-amelia',
      tipMinor: 0,
      method: 'demo_card',
    })
    ok(result)
    expect(result.state.sales.find((sale) => sale.id === result.recordId)?.serviceMinor).toBe(9500)
  })
  it('links a next visit to the completed visit and changes the rebooking cohort', () => {
    const paid = execute(seed('UK'), {
      type: 'checkout',
      appointmentId: 'visit-amelia',
      tipMinor: 0,
      method: 'demo_card',
    })
    ok(paid)
    const result = book(paid.state, {
      ...booking,
      source: 'rebook',
      rebookedFromId: 'visit-amelia',
    })
    expect(result.state.appointments.find((a) => a.id === result.recordId)?.rebookedFromId).toBe(
      'visit-amelia',
    )
    expect(report(result.state, 7).rebookRate).toBeGreaterThan(0)
  })
  it('rejects rebooking a different client or an uncompleted visit', () => {
    expect(
      execute(seed('UK'), { type: 'book', input: { ...booking, rebookedFromId: 'visit-amelia' } })
        .ok,
    ).toBe(false)
    expect(
      execute(seed('UK'), { type: 'book', input: { ...booking, rebookedFromId: 'visit-olivia' } })
        .ok,
    ).toBe(false)
  })
  it('offers arrival only on the demo day and preserves completed states', () => {
    const future = book(seed('UK'))
    expect(execute(future.state, { type: 'arrive', appointmentId: future.recordId }).ok).toBe(false)
    expect(execute(seed('UK'), { type: 'arrive', appointmentId: 'visit-olivia' }).ok).toBe(false)
  })
  it('finds return opportunities from visit history and scheduled visits', () => {
    const s = seed('UK')
    expect(dueClients(s).map((c) => c.id)).toEqual(['client-13', 'client-14', 'client-15'])
    const next = book(s, { ...booking, clientId: 'client-13' })
    expect(dueClients(next.state)).toHaveLength(2)
  })
  it('formats region currency and local clock conventions', () => {
    expect(money(9500, seed('UK').organisation)).toBe('£95')
    expect(money(12500, seed('US').organisation)).toBe('$125')
    expect(timeLabel(570, 'en-GB')).toBe('09:30')
    expect(timeLabel(570, 'en-US')).toContain('AM')
  })
})

describe('relationship integrity', () => {
  it('creates an explicit referral edge with events on both client timelines', () => {
    const result = execute(seed('UK'), {
      type: 'client',
      contact: {
        name: 'Alex Demo',
        email: 'alex@example.com',
        phone: '+44 7700 900111',
        marketingConsent: false,
      },
      referredById: 'client-1',
    })
    ok(result)
    expect(
      result.state.relationships.some(
        (e) => e.fromClientId === 'client-1' && e.toClientId === result.recordId,
      ),
    ).toBe(true)
    expect(
      result.state.events.filter(
        (e) => e.type === 'relationship' && e.clientId === result.recordId,
      ),
    ).toHaveLength(1)
  })
  it('records consent withdrawal without changing visits or sending messages', () => {
    const s = seed('UK')
    const result = execute(s, { type: 'consent', clientId: 'client-1', consent: false })
    ok(result)
    expect(result.state.clients[0].marketingConsent).toBe(false)
    expect(result.state.events.at(-1)?.type).toBe('consent')
    expect(result.state.appointments).toEqual(s.appointments)
  })
  it('rejects cross-workspace or broken relationship data on load', () => {
    const s = seed('UK')
    s.clients[0].organisationId = 'org-another-business'
    expect(() => parseState(s, 'UK')).toThrow('Foreign workspace record')
    expect(() => parseState(seed('US'), 'UK')).toThrow('Workspace region mismatch')
  })
})
