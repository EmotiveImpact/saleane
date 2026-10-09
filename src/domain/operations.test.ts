import { describe, expect, it } from 'vitest'
import { availableResource, commandSchema, depositPaid, dispatch, execute, slots } from './commands'
import type { Command } from './commands'
import { parseState } from './model'
import type { BusinessState } from './model'
import {
  businessDate,
  can,
  defaultOperations,
  instantFor,
  operations,
  permissionFor,
  stock,
} from './operations'
import { createWorkspace } from './workspace'
import { seed } from './seed'
import { report, serviceRevenue } from './selectors'

const now = '2026-10-06T08:00:00.000Z'
let sequence = 0
function apply(s: BusinessState, command: Command, clock = now) {
  const result = execute(s, command, clock, () => `test-${++sequence}`)
  if (!result.ok) throw new Error(result.error)
  return result
}
function local() {
  const s = createWorkspace({ name: 'Local test studio', region: 'UK' })
  const sample = seed('UK')
  for (const key of ['clients', 'services', 'staff', 'resources'] as const)
    Object.assign(s, {
      [key]: sample[key].map((row) => ({ ...row, organisationId: s.organisation.id })),
    })
  return s
}
const input = {
  serviceId: 'service-facial',
  staffId: 'staff-maya',
  date: '2026-10-06',
  startMinutes: 600,
  clientId: 'client-1',
  source: 'desk' as const,
}
function booked(s = local(), patch: Partial<typeof input> = {}) {
  return apply(s, { type: 'book', input: { ...input, ...patch } })
}
function completed() {
  const b = booked()
  const a = apply(b.state, { type: 'arrive', appointmentId: b.recordId })
  return apply(a.state, {
    type: 'checkout',
    appointmentId: b.recordId,
    tipMinor: 0,
    method: 'cash',
  })
}

describe('local workspace and venue time', () => {
  it('creates independent empty local workspaces while retaining the old sample format', () => {
    const first = createWorkspace({ name: 'First venue', region: 'US' })
    const second = createWorkspace({ name: 'Second venue', region: 'US' })
    expect(first.organisation.id).not.toBe(second.organisation.id)
    expect(first.clients).toEqual([])
    expect(first.services).toEqual([])
    expect(operations(first).mode).toBe('local')
    expect(operations(parseState(seed('UK'), 'UK')).mode).toBe('sandbox')
    expect(businessDate(seed('UK'), '2030-01-01T12:00:00Z')).toBe('2026-10-06')
  })
  it('starts a new studio closed on Sunday, taking no online bookings until switched on', () => {
    const fresh = operations(createWorkspace({ name: 'New venue', region: 'UK' }))
    expect(fresh.bookingEnabled).toBe(false)
    expect(fresh.hours.filter((day) => day.closed).map((day) => day.day)).toEqual([0])
    expect(fresh.hours.find((day) => day.day === 1)).toMatchObject({ open: 540, close: 1080 })
    // A studio saved before this, without settings of its own, keeps taking bookings every day.
    const older = operations({
      ...createWorkspace({ name: 'Older venue', region: 'UK' }),
      operations: undefined,
    })
    expect(older.bookingEnabled).toBe(true)
    expect(older.hours.every((day) => !day.closed)).toBe(true)
  })
  it('uses the venue civil date on either side of midnight', () => {
    const us = createWorkspace({ name: 'New York venue', region: 'US' })
    expect(businessDate(us, '2026-10-06T00:30:00Z')).toBe('2026-10-05')
    expect(businessDate(local(), '2026-10-05T23:30:00Z')).toBe('2026-10-06')
    expect(() =>
      createWorkspace({ name: 'Bad timezone', region: 'US', timeZone: 'made/up' }),
    ).toThrow('time zone')
  })
  it.each([
    ['UK', '2027-03-28', 90],
    ['UK', '2026-10-25', 90],
    ['US', '2027-03-14', 150],
    ['US', '2026-11-01', 90],
  ] as const)(
    'rejects nonexistent or ambiguous civil times in %s on %s',
    (region, date, minute) => {
      const s = createWorkspace({ name: 'Time test venue', region })
      expect(() => instantFor(s, date, minute)).toThrow('clocks change')
    },
  )
  it('converts regular civil times without silently using the machine timezone', () => {
    expect(instantFor(local(), '2026-10-06', 540)).toBe('2026-10-06T08:00:00.000Z')
    expect(
      instantFor(createWorkspace({ name: 'US studio', region: 'US' }), '2026-10-06', 540),
    ).toBe('2026-10-06T13:00:00.000Z')
  })
  it('uses one clock for offered slots and committed allocations', () => {
    const s = local(),
      later = '2026-10-06T12:00:00Z'
    expect(slots(s, 'service-facial', 'staff-maya', input.date, later)).not.toContain(600)
    expect(execute(s, { type: 'book', input }, later).ok).toBe(false)
    expect(slots(s, 'service-facial', 'staff-maya', input.date, now)).toContain(600)
  })
})

describe('configurable protected scheduling', () => {
  it('retains the exact resource validated by the transactional API', () => {
    const result = apply(local(), { type: 'book', input: { ...input, resourceId: 'room-two' } })
    expect(result.state.appointments[0].resourceId).toBe('room-two')
    const moved = apply(result.state, {
      type: 'reschedule',
      appointmentId: result.recordId,
      date: input.date,
      staffId: input.staffId,
      startMinutes: input.startMinutes,
      resourceId: 'room-one',
    })
    expect(moved.state.appointments[0].resourceId).toBe('room-one')
    expect(
      execute(local(), { type: 'book', input: { ...input, resourceId: 'chair-one' } }, now).ok,
    ).toBe(false)
    expect(
      execute(local(), { type: 'book', input: { ...input, resourceId: 'foreign-resource' } }, now)
        .ok,
    ).toBe(false)
  })
  it('refuses treatment durations that cross a clock change even when the endpoints exist', () => {
    const s = local()
    s.operations!.hours = defaultOperations().hours.map((h) => ({ ...h, open: 0, close: 240 }))
    s.services[0].durationMinutes = 180
    s.services[0].bufferMinutes = 0
    expect(availableResource(s, input.serviceId, input.staffId, '2027-03-28', 0, now)).toBeNull()
  })
  it('requires the explicit rebooking relationship instead of inventing a source label', () => {
    expect(execute(local(), { type: 'book', input: { ...input, source: 'rebook' } }, now).ok).toBe(
      false,
    )
  })

  it('assigns no preference inside the command and never stores an imaginary professional', () => {
    let s = booked().state
    const result = booked(s, { staffId: 'any' })
    expect(result.state.appointments.find((a) => a.id === result.recordId)?.staffId).toBe(
      'staff-sophia',
    )
    s = result.state
    expect(execute(s, { type: 'book', input: { ...input, staffId: 'any' } }, now).ok).toBe(false)
  })
  it('respects closures, staff-specific breaks, and normal opening hours', () => {
    let s = local()
    s = apply(s, {
      type: 'closure',
      input: {
        date: input.date,
        staffId: 'staff-maya',
        startMinutes: 600,
        endMinutes: 660,
        reason: 'Lunch break',
      },
    }).state
    expect(availableResource(s, input.serviceId, 'staff-maya', input.date, 600, now)).toBeNull()
    expect(slots(s, input.serviceId, 'any', input.date, now)).toContain(600)
    s = apply(s, {
      type: 'closure',
      input: { date: input.date, startMinutes: 600, endMinutes: 660, reason: 'Venue closure' },
    }).state
    expect(slots(s, input.serviceId, 'any', input.date, now)).not.toContain(600)
    const hours = defaultOperations().hours.map((h) => ({ ...h, closed: h.day === 2 }))
    s = apply(s, { type: 'hours', hours }).state
    expect(slots(s, input.serviceId, 'any', input.date, now)).toEqual([])
  })
  it('offers quarter-hour openings and includes turnaround inside shifts', () => {
    const s = local()
    s.staff[0].hours = defaultOperations().hours.map((h) => ({ ...h, open: 555, close: 660 }))
    expect(slots(s, input.serviceId, 'staff-maya', input.date, now)).toContain(555)
    expect(availableResource(s, input.serviceId, 'staff-maya', input.date, 600, now)).toBeNull()
  })
  it('refuses schedule edits that strand already confirmed visits', () => {
    const s = booked().state,
      snapshot = JSON.stringify(s)
    const hours = defaultOperations().hours.map((h) => ({ ...h, open: 660 }))
    expect(execute(s, { type: 'hours', hours }, now).ok).toBe(false)
    expect(
      execute(
        s,
        {
          type: 'closure',
          input: {
            date: input.date,
            startMinutes: 660,
            endMinutes: 675,
            reason: 'Turnaround conflict',
          },
        },
        now,
      ).ok,
    ).toBe(false)
    expect(
      execute(s, { type: 'staff', id: 'staff-maya', input: { ...s.staff[0], serviceIds: [] } }, now)
        .ok,
    ).toBe(false)
    expect(
      execute(
        s,
        {
          type: 'resource',
          id: 'room-one',
          input: { name: 'Archived room', type: 'treatment', archived: true },
        },
        now,
      ).ok,
    ).toBe(false)
    expect(JSON.stringify(s)).toBe(snapshot)
  })
  it('preserves resource category and service snapshots through catalogue changes', () => {
    const b = booked(),
      original = b.state.appointments[0]
    let s = apply(b.state, {
      type: 'service',
      id: input.serviceId,
      input: {
        ...b.state.services[0],
        name: 'New version',
        priceMinor: 12000,
        resourceType: 'chair',
        archived: true,
      },
    }).state
    expect(execute(s, { type: 'book', input: { ...input, date: '2026-10-07' } }, now).ok).toBe(
      false,
    )
    s = apply(s, {
      type: 'reschedule',
      appointmentId: b.recordId,
      date: '2026-10-07',
      staffId: 'staff-maya',
      startMinutes: 600,
    }).state
    expect(s.appointments[0]).toMatchObject({
      bookedPriceMinor: original.bookedPriceMinor,
      bookedServiceName: 'Skin Renewal Facial',
      bookedResourceType: 'treatment',
      resourceId: 'room-one',
    })
  })
  it('refuses duplicated weekdays and public bookings while disabled', () => {
    const s = local()
    expect(
      execute(s, { type: 'hours', hours: Array(7).fill(defaultOperations().hours[0]) }, now).ok,
    ).toBe(false)
    s.operations!.bookingEnabled = false
    expect(execute(s, { type: 'book', input: { ...input, source: 'online' } }, now).ok).toBe(false)
    expect(execute(s, { type: 'book', input }, now).ok).toBe(true)
  })
})

describe('honest manual money and immutable receipts', () => {
  it('creates no collected deposit or sale when a local appointment is booked', () => {
    const b = booked()
    expect(depositPaid(b.state, b.recordId)).toBe(0)
    expect(b.state.sales).toEqual([])
    expect(b.state.events.at(-1)?.detail).toContain('No payment collected')
  })
  it('requires payment provenance, an external reference, and a bounded deposit', () => {
    const b = booked(),
      command = {
        type: 'deposit' as const,
        appointmentId: b.recordId,
        amountMinor: 2500,
        method: 'external_card' as const,
      }
    expect(execute(b.state, command, now).ok).toBe(false)
    expect(execute(b.state, { ...command, method: 'demo_card' }, now).ok).toBe(false)
    const paid = apply(b.state, { ...command, reference: 'Terminal receipt 123' })
    expect(depositPaid(paid.state, b.recordId)).toBe(2500)
    const repeat = apply(paid.state, { ...command, reference: 'Terminal receipt 123' })
    expect(repeat.recordId).toBe(paid.recordId)
    expect(repeat.state.payments).toHaveLength(1)
    expect(execute(repeat.state, { ...command, method: 'cash', amountMinor: 1 }, now).ok).toBe(
      false,
    )
  })
  it('calculates inclusive tax, a bounded discount, tips and deposit application in minor units', () => {
    const b = booked(
      apply(local(), { type: 'tax', label: 'Configured VAT', rateBps: 2000, inclusive: true })
        .state,
    )
    let s = apply(b.state, {
      type: 'deposit',
      appointmentId: b.recordId,
      amountMinor: 2500,
      method: 'cash',
    }).state
    s = apply(s, { type: 'arrive', appointmentId: b.recordId }).state
    const settled = apply(s, {
      type: 'checkout',
      appointmentId: b.recordId,
      discountMinor: 1000,
      tipMinor: 500,
      method: 'external_card',
      reference: 'Terminal 456',
    })
    const sale = settled.state.sales[0]
    expect(sale).toMatchObject({
      serviceMinor: 9500,
      discountMinor: 1000,
      taxMinor: 1417,
      tipMinor: 500,
      totalMinor: 9000,
      depositAppliedMinor: 2500,
      balanceMinor: 6500,
      receiptNumber: 'SL-1',
    })
    expect(serviceRevenue(sale)).toBe(7083)
    expect(sale.method).toBe('external_card')
    expect(settled.state.events.at(-1)?.detail).toContain('did not process')
    const changed = apply(settled.state, {
      type: 'tax',
      label: 'Changed',
      rateBps: 1000,
      inclusive: false,
    })
    expect(changed.state.sales[0]).toEqual(sale)
  })
  it('adds exclusive tax once and never taxes tips', () => {
    const b = booked(
      apply(local(), {
        type: 'tax',
        label: 'Configured sales tax',
        rateBps: 825,
        inclusive: false,
      }).state,
    )
    const s = apply(b.state, { type: 'arrive', appointmentId: b.recordId }).state
    const sale = apply(s, {
      type: 'checkout',
      appointmentId: b.recordId,
      tipMinor: 1000,
      method: 'cash',
    }).state.sales[0]
    expect(sale.taxMinor).toBe(784)
    expect(sale.totalMinor).toBe(11284)
    expect(serviceRevenue(sale)).toBe(9500)
  })
  it('settles a visit at the tax basis it was booked under, whatever changes later', () => {
    // Booked with no tax, then the studio adds 8.25% sales tax: the guest pays what they were shown.
    const before = booked()
    let s = apply(before.state, {
      type: 'tax',
      label: 'Sales tax',
      rateBps: 825,
      inclusive: false,
    }).state
    // A visit booked after the change carries the new basis.
    const after = booked(s, { startMinutes: input.startMinutes + 120 })
    s = after.state
    s = apply(s, { type: 'arrive', appointmentId: before.recordId }).state
    s = apply(s, { type: 'arrive', appointmentId: after.recordId }).state
    s = apply(s, {
      type: 'checkout',
      appointmentId: before.recordId,
      tipMinor: 0,
      method: 'cash',
    }).state
    s = apply(s, {
      type: 'checkout',
      appointmentId: after.recordId,
      tipMinor: 0,
      method: 'cash',
    }).state
    const [first, second] = s.sales
    expect(first.taxMinor).toBe(0)
    expect(first.totalMinor).toBe(first.serviceMinor)
    expect(second.taxMinor).toBe(784)
    // Visits saved before the snapshot existed still follow the current setting.
    const legacy = structuredClone(after.state)
    delete legacy.appointments.find((a) => a.id === before.recordId)!.bookedTax
    const arrived = apply(legacy, { type: 'arrive', appointmentId: before.recordId }).state
    const sale = apply(arrived, {
      type: 'checkout',
      appointmentId: before.recordId,
      tipMinor: 0,
      method: 'cash',
    }).state.sales[0]
    expect(sale.taxMinor).toBe(784)
  })
  it('rejects refunds beyond the original total and repeated references never duplicate funds', () => {
    const done = completed(),
      sale = done.state.sales[0],
      before = structuredClone(sale)
    const refund = {
      type: 'refund' as const,
      saleId: sale.id,
      amountMinor: 3000,
      reason: 'Service adjustment',
      reference: 'External refund 1',
    }
    const first = apply(done.state, refund)
    const repeat = apply(first.state, refund)
    expect(repeat.recordId).toBe(first.recordId)
    expect(operations(repeat.state).refunds).toHaveLength(1)
    expect(
      execute(repeat.state, { ...refund, reference: 'External refund 2', amountMinor: 6501 }, now)
        .ok,
    ).toBe(false)
    expect(repeat.state.sales[0]).toEqual(before)
    expect(repeat.state.payments).toEqual(done.state.payments)
  })
  it('rejects restored ledger corruption and simulated money inside a local workspace', () => {
    const s = completed().state
    s.payments[0].amountMinor--
    expect(() => parseState(s, 'UK')).toThrow('ledger')
    const sample = seed('UK')
    sample.operations = defaultOperations('local')
    expect(() => parseState(sample, 'UK')).toThrow('not valid for this studio')
  })
})

describe('purpose-bound communications, profiles and stock', () => {
  it('keeps messages local, checks marketing consent at queue time, and suppresses queued marketing on withdrawal', () => {
    let s = local()
    s.clients[0].marketingConsent = false
    const draft = apply(s, {
      type: 'message',
      input: {
        clientId: 'client-1',
        purpose: 'marketing',
        subject: 'Return invitation',
        body: 'A draft invitation.',
      },
    })
    expect(execute(draft.state, { type: 'message-queue', messageId: draft.recordId }, now).ok).toBe(
      false,
    )
    s = apply(draft.state, { type: 'consent', clientId: 'client-1', consent: true }).state
    s = apply(s, { type: 'message-queue', messageId: draft.recordId }).state
    expect(operations(s).messages[0].status).toBe('queued')
    s = apply(s, { type: 'consent', clientId: 'client-1', consent: false }).state
    expect(operations(s).messages[0].status).toBe('suppressed')
    expect(operations(s).messages[0]).not.toHaveProperty('sentAt')
    const update = apply(s, {
      type: 'message',
      input: {
        clientId: 'client-1',
        purpose: 'appointment',
        subject: 'Visit update',
        body: 'An operational visit update.',
      },
    })
    expect(
      apply(update.state, {
        type: 'message-queue',
        messageId: update.recordId,
      }).state.operations?.messages.at(-1)?.status,
    ).toBe('queued')
  })
  it('edits drafts while preserving identity and refuses edits after queueing', () => {
    const input = {
      clientId: 'client-1',
      purpose: 'appointment' as const,
      subject: 'Visit update',
      body: 'First draft.',
    }
    const first = apply(local(), { type: 'message', input })
    const edited = apply(first.state, {
      type: 'message',
      id: first.recordId,
      input: { ...input, body: 'Improved draft.' },
    })
    expect(operations(edited.state).messages).toHaveLength(1)
    expect(edited.recordId).toBe(first.recordId)
    const queued = apply(edited.state, { type: 'message-queue', messageId: first.recordId })
    expect(execute(queued.state, { type: 'message', id: first.recordId, input }, now).ok).toBe(
      false,
    )
  })
  it('applies reviewed contact imports atomically and leaves marketing off', () => {
    const contact = {
      name: 'New client',
      email: 'new@example.com',
      phone: '+44 7700 900888',
      marketingConsent: false,
    }
    const s = local(),
      snapshot = JSON.stringify(s)
    expect(
      execute(s, { type: 'import-clients', reviewed: true, contacts: [contact, contact] }, now).ok,
    ).toBe(false)
    expect(JSON.stringify(s)).toBe(snapshot)
    expect(
      execute(
        s,
        {
          type: 'import-clients',
          reviewed: true,
          contacts: [{ ...contact, marketingConsent: true }],
        },
        now,
      ).ok,
    ).toBe(false)
    expect(
      apply(s, { type: 'import-clients', reviewed: true, contacts: [contact] }).state.clients.at(-1)
        ?.marketingConsent,
    ).toBe(false)
    expect(
      commandSchema.safeParse({ type: 'import-clients', reviewed: false, contacts: [contact] })
        .success,
    ).toBe(false)
  })
  it('records signed stock movements without manufacturing retail revenue or negative stock', () => {
    const product = apply(local(), {
      type: 'product',
      input: { name: 'Body oil', sku: 'OIL-1', priceMinor: 3200, reorderAt: 2, archived: false },
    })
    let s = apply(product.state, {
      type: 'stock',
      productId: product.recordId,
      quantity: 5,
      reason: 'received',
      note: 'Opening stock count',
    }).state
    s = apply(s, {
      type: 'stock',
      productId: product.recordId,
      quantity: -2,
      reason: 'consumed',
      note: 'Used for studio treatments',
    }).state
    expect(stock(s, product.recordId)).toBe(3)
    expect(s.sales).toEqual([])
    expect(
      execute(
        s,
        {
          type: 'stock',
          productId: product.recordId,
          quantity: -4,
          reason: 'retail',
          note: 'Impossible removal',
        },
        now,
      ).ok,
    ).toBe(false)
    expect(
      execute(
        s,
        {
          type: 'stock',
          productId: product.recordId,
          quantity: -1,
          reason: 'received',
          note: 'Wrong direction',
        },
        now,
      ).ok,
    ).toBe(false)
  })
  it('stamps authenticated actors and provides enforceable command permissions', () => {
    const result = dispatch(
      local(),
      { type: 'note', clientId: 'client-1', text: 'Ordinary preference' },
      'Verified operator',
      now,
    )
    expect(result.ok && result.state.events.at(-1)?.actor).toBe('Verified operator')
    expect(can('reception', permissionFor({ type: 'refund' }))).toBe(false)
    expect(can('reception', permissionFor({ type: 'checkout' }))).toBe(true)
    expect(can('manager', permissionFor({ type: 'hours' }))).toBe(true)
    expect(can('practitioner', permissionFor({ type: 'organisation' }))).toBe(false)
    expect(report(local(), 7).utilisation).toBe(0)
  })
})
