import { describe, expect, it } from 'vitest'
import {
  availableResource,
  depositPaid,
  execute,
  rescheduleResource,
  rescheduleSlots,
  slots,
} from './commands'
import type { BookingInput, Command, CommandResult } from './commands'
import { seed } from './seed'
import { DEMO_DATE, parseState } from './model'
import type { BusinessState } from './model'
import { addDays, money, timeLabel } from './format'
import {
  availableMinutes,
  clientStats,
  dayAppointments,
  dueClients,
  report,
  utilisation,
} from './selectors'

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

describe('appointment lifecycle integrity', () => {
  it.each(['UK', 'US'] as const)(
    'moves the original allocation without repricing or recollecting its deposit in %s',
    (region) => {
      const booked = book(seed(region), {
        ...booking,
        clientId: 'client-13',
        source: 'rebook',
        rebookedFromId: 'history-return-13',
      })
      const s = booked.state
      const original = structuredClone(s.appointments.find((a) => a.id === booked.recordId)!)
      const service = s.services.find((item) => item.id === original.serviceId)!
      Object.assign(service, {
        priceMinor: 25000,
        depositMinor: 5000,
        durationMinutes: 180,
        bufferMinutes: 45,
        resourceType: 'chair',
      })
      const date = addDays(tomorrow, 1)
      expect(availableResource(s, service.id, 'staff-sophia', date, 990)).toBeNull()
      expect(rescheduleSlots(s, original.id, 'staff-sophia', date)).toContain(990)
      const result = execute(s, {
        type: 'reschedule',
        appointmentId: original.id,
        staffId: 'staff-sophia',
        date,
        startMinutes: 990,
      })
      ok(result)
      expect(result.recordId).toBe(original.id)
      expect(result.state.appointments.find((a) => a.id === original.id)).toEqual({
        ...original,
        date,
        startMinutes: 990,
        staffId: 'staff-sophia',
        resourceId: 'room-one',
      })
      expect(result.state.appointments).toHaveLength(s.appointments.length)
      expect(result.state.payments).toEqual(s.payments)
      expect(result.state.sales).toEqual(s.sales)
      expect(depositPaid(result.state, original.id)).toBe(original.bookedDepositMinor)
      expect(result.state.events.slice(0, -1)).toEqual(s.events)
      expect(result.state.events.at(-1)).toMatchObject({
        type: 'rescheduled',
        clientId: original.clientId,
        appointmentId: original.id,
        allocationChange: {
          from: {
            date: original.date,
            startMinutes: original.startMinutes,
            staffId: original.staffId,
            resourceId: original.resourceId,
          },
          to: { date, startMinutes: 990, staffId: 'staff-sophia', resourceId: 'room-one' },
        },
      })
      expect(clientStats(result.state, original.clientId).next?.date).toBe(date)
      expect(dayAppointments(result.state, tomorrow)).toHaveLength(0)
      expect(s.appointments.find((a) => a.id === original.id)).toEqual(original)
      expect(result.state.revision).toBe(s.revision + 1)
    },
  )
  it('excludes only its own allocation, including when moving over part of the original slot', () => {
    const first = book(seed('UK'))
    expect(rescheduleSlots(first.state, first.recordId, 'staff-maya', tomorrow)).toContain(540)
    const result = execute(first.state, {
      type: 'reschedule',
      appointmentId: first.recordId,
      staffId: 'staff-maya',
      date: tomorrow,
      startMinutes: 570,
    })
    ok(result)
    expect(result.state.appointments.find((a) => a.id === first.recordId)?.startMinutes).toBe(570)
    expect(
      availableResource(result.state, 'service-facial', 'staff-maya', tomorrow, 540),
    ).toBeNull()
  })
  it('rejects another staff allocation including its buffer, then permits the exact adjacent boundary', () => {
    const first = book(seed('UK'))
    const second = book(first.state, { ...booking, startMinutes: 630 })
    const before = structuredClone(second.state)
    expect(
      execute(second.state, {
        type: 'reschedule',
        appointmentId: first.recordId,
        staffId: 'staff-maya',
        date: tomorrow,
        startMinutes: 600,
      }).ok,
    ).toBe(false)
    expect(second.state).toEqual(before)
    expect(rescheduleResource(second.state, first.recordId, 'staff-maya', tomorrow, 555)).toBe(
      'room-one',
    )
    const result = execute(second.state, {
      type: 'reschedule',
      appointmentId: first.recordId,
      staffId: 'staff-maya',
      date: tomorrow,
      startMinutes: 555,
    })
    ok(result)
  })
  it('rejects exhausted treatment rooms even when the requested professional is free', () => {
    const first = book(seed('UK'))
    let s = book(first.state, {
      ...booking,
      serviceId: 'service-lymphatic',
      staffId: 'staff-sophia',
      startMinutes: 630,
    }).state
    s.staff.find((person) => person.id === 'staff-theo')!.serviceIds.push('service-facial')
    s = book(s, { ...booking, staffId: 'staff-theo', startMinutes: 630 }).state
    const snapshot = structuredClone(s)
    expect(
      execute(s, {
        type: 'reschedule',
        appointmentId: first.recordId,
        staffId: 'staff-maya',
        date: tomorrow,
        startMinutes: 630,
      }).ok,
    ).toBe(false)
    expect(s).toEqual(snapshot)
  })
  it.each([
    ['unqualified professional', { staffId: 'staff-theo' }],
    ['foreign professional', { staffId: 'foreign-staff' }],
    ['invalid date', { date: '2026-02-30' }],
    ['past date', { date: addDays(DEMO_DATE, -1) }],
    ['off-grid time', { startMinutes: 541 }],
    ['fractional time', { startMinutes: 540.5 }],
    ['buffer after closing', { startMinutes: 1020 }],
    ['unknown appointment', { appointmentId: 'foreign-appointment' }],
  ])('rejects rescheduling with %s without any partial change', (_, patch) => {
    const first = book(seed('UK'))
    const snapshot = structuredClone(first.state)
    expect(
      execute(first.state, {
        type: 'reschedule',
        appointmentId: first.recordId,
        staffId: 'staff-maya',
        date: tomorrow,
        startMinutes: 540,
        ...patch,
      }).ok,
    ).toBe(false)
    expect(first.state).toEqual(snapshot)
  })
  it('treats saving the same allocation as a no-op', () => {
    const first = book(seed('UK'))
    const result = execute(first.state, {
      type: 'reschedule',
      appointmentId: first.recordId,
      staffId: 'staff-maya',
      date: tomorrow,
      startMinutes: 540,
    })
    ok(result)
    expect(result.state).toBe(first.state)
    expect(result.recordId).toBe(first.recordId)
  })
  it.each(['cancel', 'no-show'] as const)(
    '%s retains ledger/history and removes a visit from active metrics without creating a sale',
    (type) => {
      const s = seed('UK')
      const original = s.appointments.find((a) => a.id === 'visit-noor')!
      const before = report(s, 7)
      const stats = clientStats(s, original.clientId)
      const result = execute(s, {
        type,
        appointmentId: original.id,
        reason: 'Client unable to attend',
      })
      ok(result)
      expect(result.state.appointments.find((a) => a.id === original.id)?.status).toBe(
        type === 'cancel' ? 'cancelled' : 'no_show',
      )
      expect(result.state.payments).toEqual(s.payments)
      expect(result.state.sales).toEqual(s.sales)
      expect(depositPaid(result.state, original.id)).toBe(depositPaid(s, original.id))
      expect(result.state.events.slice(0, -1)).toEqual(s.events)
      expect(result.state.events.at(-1)).toMatchObject({
        type: type === 'cancel' ? 'cancelled' : 'no_show',
        clientId: original.clientId,
        appointmentId: original.id,
      })
      expect(dayAppointments(result.state).some((a) => a.id === original.id)).toBe(false)
      expect(
        availableResource(
          result.state,
          original.serviceId,
          original.staffId,
          original.date,
          original.startMinutes,
        ),
      ).toBe(original.resourceId)
      expect(clientStats(result.state, original.clientId)).toMatchObject({
        visits: stats.visits,
        spend: stats.spend,
        next: undefined,
      })
      const after = report(result.state, 7)
      expect(after).toMatchObject({
        revenue: before.revenue,
        tips: before.tips,
        completed: before.completed,
        booked: before.booked - original.bookedPriceMinor,
      })
      expect(after.utilisation).toBeCloseTo(
        before.utilisation - original.bookedDurationMinutes / (7 * s.staff.length * 540),
      )
      const repeated = execute(result.state, {
        type,
        appointmentId: original.id,
        reason: 'Repeated request',
      })
      ok(repeated)
      expect(repeated.state).toBe(result.state)
      expect(repeated.recordId).toBe(original.id)
      expect(s.appointments.find((a) => a.id === original.id)?.status).toBe('confirmed')
    },
  )
  it('restores a return opportunity when a future next visit is cancelled', () => {
    const first = book(seed('UK'), { ...booking, clientId: 'client-13' })
    expect(dueClients(first.state).some((client) => client.id === 'client-13')).toBe(false)
    const result = execute(first.state, {
      type: 'cancel',
      appointmentId: first.recordId,
      reason: 'Plans changed',
    })
    ok(result)
    expect(dueClients(result.state).some((client) => client.id === 'client-13')).toBe(true)
  })
  it('rejects a future no-show and a missing reason without altering the workspace', () => {
    const first = book(seed('UK'))
    const snapshot = structuredClone(first.state)
    expect(
      execute(first.state, {
        type: 'no-show',
        appointmentId: first.recordId,
        reason: 'Did not arrive',
      }).ok,
    ).toBe(false)
    expect(
      execute(first.state, { type: 'cancel', appointmentId: first.recordId, reason: ' ' }).ok,
    ).toBe(false)
    expect(
      execute(first.state, {
        type: 'cancel',
        appointmentId: first.recordId,
        reason: 'x'.repeat(301),
      }).ok,
    ).toBe(false)
    expect(first.state).toEqual(snapshot)
  })
  it.each(['arrived', 'completed', 'cancelled', 'no_show'] as const)(
    'protects %s visits from another lifecycle transition, arrival or settlement',
    (status) => {
      const s = seed('UK')
      const appointmentId =
        status === 'arrived'
          ? 'visit-amelia'
          : status === 'completed'
            ? 'visit-olivia'
            : 'visit-noor'
      if (status === 'cancelled' || status === 'no_show')
        s.appointments.find((a) => a.id === appointmentId)!.status = status
      const snapshot = structuredClone(s)
      const commands: Command[] = [
        {
          type: 'reschedule',
          appointmentId,
          staffId: 'staff-maya',
          date: tomorrow,
          startMinutes: 540,
        },
        ...(status !== 'cancelled'
          ? [{ type: 'cancel' as const, appointmentId, reason: 'Plans changed' }]
          : []),
        ...(status !== 'no_show'
          ? [{ type: 'no-show' as const, appointmentId, reason: 'Did not arrive' }]
          : []),
      ]
      if (status === 'cancelled' || status === 'no_show')
        commands.push(
          { type: 'arrive', appointmentId },
          { type: 'checkout', appointmentId, tipMinor: 0, method: 'demo_card' },
        )
      for (const command of commands) expect(execute(s, command).ok).toBe(false)
      expect(s).toEqual(snapshot)
    },
  )
  it.each(['cancel', 'no-show'] as const)('stops counting a linked next visit after %s', (type) => {
    const s = seed('UK')
    const baseline = report(s, 7).rebookRate
    const first = book(s, {
      ...booking,
      clientId: 'client-2',
      date: DEMO_DATE,
      startMinutes: 1080 - 75,
      source: 'rebook',
      rebookedFromId: 'visit-olivia',
    })
    expect(report(first.state, 7).rebookRate).toBeGreaterThan(baseline!)
    const result = execute(first.state, {
      type,
      appointmentId: first.recordId,
      reason: 'Unable to attend',
    })
    ok(result)
    expect(report(result.state, 7).rebookRate).toBe(baseline)
    expect(result.state.appointments.find((a) => a.id === first.recordId)?.rebookedFromId).toBe(
      'visit-olivia',
    )
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

describe('one utilisation definition', () => {
  it('measures today from active booked service minutes over open professional minutes', () => {
    const s = seed('UK')
    const today = utilisation(s, 1)
    const booked = dayAppointments(s).reduce((sum, a) => sum + a.bookedDurationMinutes, 0)
    expect(today).toMatchObject({
      from: DEMO_DATE,
      to: DEMO_DATE,
      bookedMinutes: booked,
      openMinutes: availableMinutes(s, DEMO_DATE),
      period: 'Today',
    })
    expect(today.ratio).toBeCloseTo(booked / availableMinutes(s, DEMO_DATE))
    expect(today.percent).toBe(Math.round(today.ratio * 100))
  })
  it('is the same figure the business report uses for the same period', () => {
    const s = seed('UK')
    for (const days of [1, 7, 28]) {
      expect(report(s, days).utilisation).toBe(utilisation(s, days).ratio)
    }
    expect(utilisation(s, 7)).toMatchObject({ from: addDays(DEMO_DATE, -6), period: 'Last 7 days' })
    expect(utilisation(s, 7).openMinutes).toBe(
      Array.from({ length: 7 }, (_, i) => availableMinutes(s, addDays(DEMO_DATE, i - 6))).reduce(
        (sum, minutes) => sum + minutes,
        0,
      ),
    )
  })
  it('excludes cancelled visits and turnaround buffers from booked time', () => {
    const s = seed('UK')
    const original = s.appointments.find((a) => a.id === 'visit-noor')!
    const before = utilisation(s, 1)
    const result = execute(s, {
      type: 'cancel',
      appointmentId: original.id,
      reason: 'Client unable to attend',
    })
    ok(result)
    const after = utilisation(result.state, 1)
    expect(after.bookedMinutes).toBe(before.bookedMinutes - original.bookedDurationMinutes)
    expect(after.openMinutes).toBe(before.openMinutes)
  })
  it('adds up across professionals when measured one person at a time', () => {
    const s = seed('UK')
    const people = s.staff.filter((p) => !p.archived)
    const each = people.map((p) => utilisation(s, 1, p.id))
    expect(each.reduce((sum, u) => sum + u.bookedMinutes, 0)).toBe(utilisation(s, 1).bookedMinutes)
    expect(each.reduce((sum, u) => sum + u.openMinutes, 0)).toBe(utilisation(s, 1).openMinutes)
  })
  it('reports zero rather than dividing by zero when nothing is open', () => {
    const s = seed('UK')
    const closed = { ...s, staff: [] }
    expect(utilisation(closed, 7)).toMatchObject({ openMinutes: 0, ratio: 0, percent: 0 })
  })
})
