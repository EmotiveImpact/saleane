import { describe, expect, it } from 'vitest'
import { dispatch, execute } from './commands'
import type { Command } from './commands'
import type { BusinessState } from './model'
import { can, operations } from './operations'
import { createWorkspace } from './workspace'
import { seed } from './seed'
import { importStanding } from './switching'
import { planMessages } from './reminders'
import { clientExport } from './privacy'
import { guestPayment } from './guest'
import { cashForDay } from './tillCount'
import { csvMoney, previewBalancesCsv, previewServicesCsv } from '../components/switchingCsv'

// PILOT-03: a studio moving across from its previous booking system.
const now = '2026-10-06T08:00:00.000Z'
let sequence = 0
function local(): BusinessState {
  const s = createWorkspace({ name: 'Switching test studio', region: 'UK' })
  const sample = seed('UK')
  for (const key of ['clients', 'services', 'staff', 'resources'] as const)
    Object.assign(s, {
      [key]: sample[key].map((row) => ({ ...row, organisationId: s.organisation.id })),
    })
  return s
}
function apply(s: BusinessState, command: Command) {
  const result = execute(s, command, now, () => `switch-${++sequence}`)
  if (!result.ok) throw new Error(result.error)
  return result.state
}
const visit = {
  serviceId: 'service-facial',
  staffId: 'staff-maya',
  date: '2026-10-08',
  startMinutes: 605,
  priceMinor: 8500,
  depositPaidMinor: 2000,
}

describe('reading old system files', () => {
  it('reads money the way old systems export it', () => {
    expect(csvMoney('£1,250.50')).toBe(125050)
    expect(csvMoney('$40')).toBe(4000)
    expect(csvMoney('-5')).toBeNaN()
    expect(csvMoney('', 0)).toBe(0)
  })

  it('previews services, flagging names already here and unknown professionals', () => {
    const s = local()
    const preview = previewServicesCsv(
      [
        'name,duration,price,deposit,category,professionals',
        'Brow shape,30,25.00,,Skin,Maya Lewis',
        'Skin Renewal Facial,60,95,20,Skin,',
        'Gloss,45,60,,Hair,Someone New',
        'Gloss two,45,60,70,Hair,',
      ].join('\n'),
      s,
    )
    expect(preview.rows.map((r) => r.status)).toEqual(['ready', 'duplicate', 'problem', 'problem'])
    expect(preview.rows[0].value).toMatchObject({
      name: 'Brow shape',
      priceMinor: 2500,
      depositMinor: 0,
      resourceType: 'treatment',
      staffIds: ['staff-maya'],
    })
    expect(preview.rows[3].detail).toContain('more than the price')
  })

  it('previews balances and refuses a second open one for the same client', () => {
    const s = local()
    const preview = previewBalancesCsv(
      [
        'email,amount,type,note',
        'amelia.carter@example.com,25.00,credit,Gift card',
        'olivia.james@example.com,10,owed,',
        'amelia.carter@example.com,5,credit,',
        'ellie.brooks@example.com,0,credit,',
      ].join('\n'),
      s,
    )
    expect(preview.rows.map((r) => r.status)).toEqual(['ready', 'ready', 'duplicate', 'problem'])
  })
})

describe('bringing records across', () => {
  it('imports services and gives them to the named professionals', () => {
    const s = apply(local(), {
      type: 'import-services',
      source: 'Fresha',
      reviewed: true,
      services: [
        {
          name: 'Brow shape',
          description: '',
          category: 'Skin',
          durationMinutes: 30,
          bufferMinutes: 0,
          priceMinor: 2500,
          depositMinor: 0,
          resourceType: 'treatment',
          staffIds: ['staff-maya'],
        },
      ],
    })
    const service = s.services.find((x) => x.name === 'Brow shape')!
    expect(s.staff.find((p) => p.id === 'staff-maya')!.serviceIds).toContain(service.id)
    expect(operations(s).imports).toMatchObject([
      { kind: 'services', source: 'Fresha', recordIds: [service.id], totalMinor: 2500 },
    ])
    const again = execute(s, {
      type: 'import-services',
      source: 'Fresha',
      reviewed: true,
      services: [{ ...service, name: 'brow shape', staffIds: [] }],
    })
    expect(again).toMatchObject({ ok: false, error: expect.stringContaining('already exists') })
  })

  it('carries an upcoming visit over at its old price with the deposit already paid', () => {
    const s = apply(local(), {
      type: 'import-appointments',
      source: 'Fresha',
      reviewed: true,
      appointments: [{ ...visit, clientId: 'client-1', reference: 'BK-1' }],
    })
    const a = s.appointments.find((x) => x.source === 'import')!
    expect(a).toMatchObject({
      startMinutes: 605,
      bookedPriceMinor: 8500,
      bookedDepositMinor: 2000,
      status: 'confirmed',
    })
    expect(s.payments).toEqual([
      expect.objectContaining({
        appointmentId: a.id,
        kind: 'deposit',
        method: 'previous_system',
        amountMinor: 2000,
        reference: 'Paid to Fresha before switching · BK-1',
      }),
    ])
    const batch = operations(s).imports![0]
    expect(batch).toMatchObject({ kind: 'appointments', totalMinor: 8500, depositsMinor: 2000 })
    expect(importStanding(s, batch)).toEqual({ upcoming: 1, changed: 0 })
    // The guest's own page asks for nothing more: the deposit is already paid.
    expect(
      guestPayment(s, a.id, Date.parse(now), { testMode: true, savedCard: null, pending: false }),
    ).toBeNull()
    // The guest was confirmed by the old system, so only reminders follow.
    expect(planMessages(s, now, []).map((m) => m.kind)).not.toContain('confirmation')
  })

  it('adds a new guest once, however many visits they bring', () => {
    const contact = {
      name: 'New Guest',
      email: 'new.guest@example.com',
      phone: '+44 7700 900999',
      marketingConsent: false,
    }
    const s = apply(local(), {
      type: 'import-appointments',
      source: 'Phorest',
      reviewed: true,
      appointments: [
        { ...visit, depositPaidMinor: 0, contact },
        { ...visit, depositPaidMinor: 0, date: '2026-10-09', contact },
      ],
    })
    expect(s.clients.filter((c) => c.email === 'new.guest@example.com')).toHaveLength(1)
    expect(s.appointments.filter((a) => a.source === 'import')).toHaveLength(2)
  })

  it('refuses a visit that clashes, is in the past, or repeats one already here', () => {
    const base = apply(local(), {
      type: 'import-appointments',
      source: 'Fresha',
      reviewed: true,
      appointments: [{ ...visit, clientId: 'client-1' }],
    })
    const clash = execute(base, {
      type: 'import-appointments',
      source: 'Fresha',
      reviewed: true,
      appointments: [{ ...visit, clientId: 'client-2' }],
    })
    expect(clash.ok).toBe(false)
    const repeat = execute(base, {
      type: 'import-appointments',
      source: 'Fresha',
      reviewed: true,
      appointments: [{ ...visit, clientId: 'client-1', staffId: 'staff-sophia' }],
    })
    expect(repeat).toMatchObject({ ok: false, error: expect.stringContaining('already has') })
    const past = execute(local(), {
      type: 'import-appointments',
      source: 'Fresha',
      reviewed: true,
      appointments: [{ ...visit, clientId: 'client-1', date: '2026-10-05' }],
    })
    expect(past.ok).toBe(false)
    expect(
      execute(local(), {
        type: 'import-appointments',
        source: 'Fresha',
        reviewed: true,
        appointments: [{ ...visit, clientId: 'client-1', depositPaidMinor: 9000 }],
      }).ok,
    ).toBe(false)
  })

  it('applies a carried-over deposit at checkout and keeps it out of the till', () => {
    let s = apply(local(), {
      type: 'import-appointments',
      source: 'Fresha',
      reviewed: true,
      appointments: [{ ...visit, date: '2026-10-06', startMinutes: 600, clientId: 'client-1' }],
    })
    const a = s.appointments.find((x) => x.source === 'import')!
    s = apply(s, { type: 'arrive', appointmentId: a.id })
    s = apply(s, {
      type: 'checkout',
      appointmentId: a.id,
      tipMinor: 0,
      method: 'cash',
    })
    const sale = s.sales.find((x) => x.appointmentId === a.id)!
    expect(sale).toMatchObject({
      serviceMinor: 8500,
      depositAppliedMinor: 2000,
      balanceMinor: 6500,
    })
    expect(cashForDay(s, '2026-10-06').cashIn).toBe(6500)
  })

  it('keeps the quoted price as the full bill when the studio adds tax on top', () => {
    let s = apply(local(), { type: 'tax', label: 'VAT', rateBps: 2000, inclusive: false })
    s = apply(s, {
      type: 'import-appointments',
      source: 'Fresha',
      reviewed: true,
      appointments: [{ ...visit, date: '2026-10-06', startMinutes: 600, clientId: 'client-1' }],
    })
    const a = s.appointments.find((x) => x.source === 'import')!
    s = apply(s, { type: 'arrive', appointmentId: a.id })
    s = apply(s, { type: 'checkout', appointmentId: a.id, tipMinor: 0, method: 'cash' })
    expect(s.sales.find((x) => x.appointmentId === a.id)).toMatchObject({
      totalMinor: 8500,
      taxInclusive: true,
    })
  })

  it('reminds a guest whose visit arrives inside the reminder window', () => {
    const s = apply(local(), {
      type: 'import-appointments',
      source: 'Fresha',
      reviewed: true,
      // Imported at 08:00 UTC, exactly when the 24-hour reminder for 09:00 London opened.
      appointments: [{ ...visit, date: '2026-10-07', startMinutes: 540, clientId: 'client-1' }],
    })
    const plan = planMessages(s, '2026-10-06T10:00:00.000Z', [])
    expect(plan.map((m) => m.kind)).toContain('reminder')
    expect(plan.map((m) => m.kind)).not.toContain('confirmation')
  })

  it('never lets the old system be used as a payment method at the desk', () => {
    const s = apply(local(), {
      type: 'import-appointments',
      source: 'Fresha',
      reviewed: true,
      appointments: [{ ...visit, depositPaidMinor: 0, clientId: 'client-1' }],
    })
    const a = s.appointments.find((x) => x.source === 'import')!
    const result = execute(s, {
      type: 'deposit',
      appointmentId: a.id,
      amountMinor: 1000,
      method: 'previous_system',
      reference: 'Fake',
    })
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('reviewed import') })
  })

  it('keeps carried-over balances until staff close them with a note', () => {
    let s = apply(local(), {
      type: 'import-balances',
      source: 'Fresha',
      reviewed: true,
      balances: [
        { clientId: 'client-1', kind: 'credit', amountMinor: 2500, note: 'Gift card' },
        { clientId: 'client-2', kind: 'owed', amountMinor: 1000, note: '' },
      ],
    })
    const [credit] = operations(s).balances!
    expect(
      execute(s, {
        type: 'import-balances',
        source: 'Fresha',
        reviewed: true,
        balances: [{ clientId: 'client-1', kind: 'credit', amountMinor: 100, note: '' }],
      }).ok,
    ).toBe(false)
    const closed = dispatch(
      s,
      { type: 'balance-settle', balanceId: credit.id, note: 'Taken off a facial' },
      'Reception Ria',
      now,
    )
    if (!closed.ok) throw new Error(closed.error)
    s = closed.state
    expect(operations(s).balances!.length).toBe(2)
    expect(operations(s).balances![0].settled).toMatchObject({
      note: 'Taken off a facial',
      actor: 'Reception Ria',
    })
    expect(importStanding(s, operations(s).imports![0])).toEqual({ upcoming: 1, changed: 1 })
    expect(clientExport(s, 'client-1', {} as never).carriedOver).toEqual([
      expect.objectContaining({
        kind: 'credit',
        amountMinor: 2500,
        closedNote: 'Taken off a facial',
      }),
    ])
  })

  it('logs a client import with the others', () => {
    const s = apply(local(), {
      type: 'import-clients',
      source: 'Fresha clients.csv',
      reviewed: true,
      contacts: [
        {
          name: 'Brand New',
          email: 'brand.new@example.com',
          phone: '+44 7700 900888',
          marketingConsent: false,
        },
      ],
    })
    expect(operations(s).imports).toMatchObject([
      { kind: 'clients', source: 'Fresha clients.csv', recordIds: [expect.any(String)] },
    ])
  })

  it('leaves imports to owners and managers, and closing a balance to the desk too', () => {
    for (const action of ['import-services', 'import-appointments', 'import-balances']) {
      expect(can('manager', action)).toBe(true)
      expect(can('reception', action)).toBe(false)
      expect(can('practitioner', action)).toBe(false)
    }
    expect(can('reception', 'balance-settle')).toBe(true)
    expect(can('practitioner', 'balance-settle')).toBe(false)
  })
})
