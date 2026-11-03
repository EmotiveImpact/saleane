import { describe, expect, it } from 'vitest'
import { execute } from './commands'
import type { Command } from './commands'
import type { BusinessState } from './model'
import { parseState } from './model'
import { can, permissionFor } from './operations'
import { createWorkspace } from './workspace'
import { seed } from './seed'
import { practitionerRefusal } from './practitioner'
import { areaRefusal } from './area'
import { branchRefusal } from './branch'
import { changeWords } from './changeRecord'
import {
  BROWSER_DRAWER,
  cashTaken,
  drawerConnected,
  drawerSummary,
  noSaleProblem,
  tillPrinter,
} from './till'

// Stage 2: how receipts print, and when the cash drawer opens by itself.
const now = '2026-10-06T13:05:00.000Z'
let sequence = 0
function local(region: 'UK' | 'US' = 'UK'): BusinessState {
  const s = createWorkspace({ name: 'Till test studio', region })
  const sample = seed(region)
  for (const key of ['clients', 'services', 'staff', 'resources'] as const)
    Object.assign(s, {
      [key]: sample[key].map((row) => ({ ...row, organisationId: s.organisation.id })),
    })
  return s
}
function run(s: BusinessState, command: Command, at = now) {
  return execute(s, command, at, () => `t-${++sequence}`)
}
function apply(s: BusinessState, command: Command, at = now) {
  const result = run(s, command, at)
  if (!result.ok) throw new Error(result.error)
  return result.state
}
const settings = (
  printer: Extract<Command, { type: 'till-settings' }>['printer'],
  extra: Partial<Extract<Command, { type: 'till-settings' }>> = {},
) => ({ type: 'till-settings', printer, ...extra }) as Command

describe('till and printer settings', () => {
  it('prints through the computer’s print window on 80 mm paper until someone chooses', () => {
    const s = local()
    expect(tillPrinter(s)).toEqual({ mode: 'browser', paper: '80', drawer: false })
    expect(drawerConnected(tillPrinter(s))).toBe(false)
  })

  it('keeps a network printer’s address and port, and the drawer choice', () => {
    const s = apply(
      local(),
      settings({ mode: 'network', paper: '58', host: ' 192.168.1.50 ', drawer: true }),
    )
    expect(tillPrinter(s)).toEqual({
      mode: 'network',
      paper: '58',
      host: '192.168.1.50',
      port: 9100,
      drawer: true,
    })
    expect(drawerConnected(tillPrinter(s))).toBe(true)
    // Choosing the print window again forgets the address and cannot keep the drawer on.
    const back = apply(s, settings({ mode: 'browser', paper: '80', drawer: true }))
    expect(tillPrinter(back)).toEqual({ mode: 'browser', paper: '80', drawer: false })
  })

  it('refuses a printer that is not on the studio’s network, an odd address or another port', () => {
    const s = local()
    const refused = (printer: Extract<Command, { type: 'till-settings' }>['printer']) => {
      const result = run(s, settings(printer))
      return result.ok ? '' : result.error
    }
    expect(refused({ mode: 'network', paper: '80', drawer: false })).toMatch(/Enter the printer/)
    expect(refused({ mode: 'network', paper: '80', host: '8.8.8.8', drawer: false })).toBe(
      'SALEANE only connects to a printer on your own network, such as 192.168.1.50.',
    )
    expect(refused({ mode: 'network', paper: '80', host: '3232235826', drawer: false })).toMatch(
      /the usual way/,
    )
    expect(
      refused({ mode: 'network', paper: '80', host: '192.168.1.5', port: 6379, drawer: false }),
    ).toMatch(/port 9100/)
    expect(refused({ mode: 'network', paper: '80', host: 'localhost', drawer: false })).toMatch(
      /this computer/,
    )
  })

  it('sets a printer for each location, and only for an open one', () => {
    let s = apply(local(), {
      type: 'location',
      input: { name: 'Marylebone', address: '3 High Street' },
    })
    const other = s.operations!.locations![0].id
    s = apply(s, settings({ mode: 'test', paper: '80', drawer: true }, { locationId: other }))
    expect(tillPrinter(s, other)).toEqual({
      mode: 'test',
      paper: '80',
      drawer: true,
      locationId: other,
    })
    expect(tillPrinter(s)).toEqual({ mode: 'browser', paper: '80', drawer: false })
    expect(s.operations!.till!.printers).toEqual([
      { mode: 'test', paper: '80', drawer: true, locationId: other },
    ])
    expect(
      run(s, settings({ mode: 'test', paper: '80', drawer: true }, { locationId: 'nowhere' })),
    ).toEqual({ ok: false, error: 'Choose an open location.' })
  })

  it('prints the VAT number or tax ID, and clears it when emptied', () => {
    let s = apply(
      local(),
      settings({ mode: 'browser', paper: '80', drawer: false }, { taxNumber: 'GB 123 4567 89' }),
    )
    expect(s.operations!.till!.taxNumber).toBe('GB 123 4567 89')
    s = apply(s, settings({ mode: 'browser', paper: '58', drawer: false }))
    expect(s.operations!.till!.taxNumber).toBe('GB 123 4567 89')
    s = apply(s, settings({ mode: 'browser', paper: '58', drawer: false }, { taxNumber: '' }))
    expect(s.operations!.till!.taxNumber).toBeUndefined()
    expect(
      run(s, settings({ mode: 'browser', paper: '80', drawer: false }, { taxNumber: '<b>' })),
    ).toEqual({
      ok: false,
      error: 'Enter the VAT number as it appears on your registration, such as GB 123 4567 89.',
    })
    const us = run(
      local('US'),
      settings({ mode: 'browser', paper: '80', drawer: false }, { taxNumber: '!' }),
    )
    expect(us.ok ? '' : us.error).toMatch(/tax ID/)
  })

  it('refuses a stored setting that breaks the rules, however it got there', () => {
    const s = apply(local(), settings({ mode: 'test', paper: '80', drawer: true }))
    const broken = (change: (x: BusinessState) => void) => {
      const copy = structuredClone(s)
      change(copy)
      return () => parseState(copy, 'UK')
    }
    expect(
      broken((x) => {
        x.operations!.till!.printers[0] = {
          mode: 'network',
          paper: '80',
          host: '8.8.8.8',
          drawer: false,
        }
      }),
    ).toThrow(/your own network/)
    expect(
      broken((x) => {
        x.operations!.till!.printers[0] = { mode: 'browser', paper: '80', drawer: true }
      }),
    ).toThrow(BROWSER_DRAWER)
    expect(
      broken((x) => {
        x.operations!.till!.printers.push({ mode: 'test', paper: '58', drawer: false })
      }),
    ).toThrow('A location has two receipt printers.')
    expect(
      broken((x) => {
        x.operations!.till!.printers[0].locationId = 'nowhere'
      }),
    ).toThrow(/does not exist/)
  })

  it('is for owners and managers; everyone else is refused, by the server’s rules too', () => {
    expect(permissionFor({ type: 'till-settings' })).toBe('till-settings')
    expect(can('owner', 'till-settings')).toBe(true)
    expect(can('manager', 'till-settings')).toBe(true)
    for (const role of ['reception', 'practitioner', 'general', 'regional'] as const)
      expect(can(role, 'till-settings'), role).toBe(false)
    const s = local()
    const command = settings({ mode: 'test', paper: '80', drawer: true })
    expect(practitionerRefusal(s, 'staff-maya', command, '2026-10-06')).toBe(
      'Your role cannot make this change.',
    )
    expect(areaRefusal(s, 'region-1', command)).toBe('Your role cannot make this change.')
    expect(branchRefusal(s, s.organisation.locationId, command)).toMatch(/whole business/)
    expect(changeWords['till-settings']).toEqual(['settings', 'Changed how receipts print'])
    expect(changeWords['till.drawer'][0]).toBe('money')
  })
})

describe('the cash a change records', () => {
  function visitToday(s: BusinessState) {
    s = apply(s, {
      type: 'import-appointments',
      source: 'Test',
      reviewed: true,
      appointments: [
        {
          clientId: 'client-1',
          serviceId: 'service-facial',
          staffId: 'staff-maya',
          date: '2026-10-06',
          startMinutes: 900,
          priceMinor: 9500,
          depositPaidMinor: 0,
        },
      ],
    })
    const a = s.appointments.at(-1)!
    return { s: apply(s, { type: 'arrive', appointmentId: a.id }), a }
  }

  it('finds cash taken at checkout, and nothing for a card or a visit fully paid by a plan', () => {
    const { s, a } = visitToday(local())
    const cash = apply(s, { type: 'checkout', appointmentId: a.id, tipMinor: 500, method: 'cash' })
    const sale = cash.sales.at(-1)!
    expect(cashTaken(s, cash)).toEqual([
      {
        cause: 'cash',
        receipt: `visit:${sale.id}`,
        kind: 'visit',
        number: sale.receiptNumber,
        locationId: s.organisation.locationId,
        amountMinor: 10000,
      },
    ])
    const card = apply(s, {
      type: 'checkout',
      appointmentId: a.id,
      tipMinor: 0,
      method: 'external_card',
      reference: 'T-1',
    })
    expect(cashTaken(s, card)).toEqual([])
    // Saving again changes nothing, so nothing opens twice.
    expect(cashTaken(cash, cash)).toEqual([])
  })

  it('finds cash for walk-in sales, gift cards, plans, deposits, and cash handed back', () => {
    let s = local()
    s = apply(s, {
      type: 'product',
      input: { name: 'Balm', sku: 'B', priceMinor: 1200, reorderAt: 0, archived: false },
    })
    const productId = s.operations!.products[0].id
    s = apply(s, { type: 'stock', productId, quantity: 5, reason: 'received', note: 'Delivery' })
    let next = apply(s, {
      type: 'counter-sale',
      products: [{ productId, quantity: 1 }],
      method: 'cash',
    })
    const walkIn = next.counterSales![0]
    expect(cashTaken(s, next)).toMatchObject([
      { cause: 'cash', receipt: `walk-in:${walkIn.id}`, number: 'SC-1', amountMinor: 1200 },
    ])
    s = next
    next = apply(s, {
      type: 'refund',
      counterSaleId: walkIn.id,
      amountMinor: 1200,
      reason: 'Changed mind',
      reference: 'R-1',
      method: 'cash',
    })
    expect(cashTaken(s, next)).toMatchObject([
      { cause: 'refund', receipt: `walk-in:${walkIn.id}`, amountMinor: 1200 },
    ])
    s = next
    next = apply(s, {
      type: 'gift-card-sell',
      input: {
        kind: 'money',
        valueMinor: 3000,
        purchaserName: 'Ada',
        recipientName: '',
        message: '',
      },
      method: 'cash',
    })
    expect(cashTaken(s, next)).toMatchObject([
      { cause: 'cash', kind: 'gift-card', number: 'GC-1', amountMinor: 3000 },
    ])
    s = next
    s = apply(s, {
      type: 'offer',
      input: {
        kind: 'membership',
        name: 'Glow Club',
        serviceIds: ['service-facial'],
        visits: 1,
        priceMinor: 4000,
        discountPercent: 0,
        validMonths: 1,
        archived: false,
      },
    })
    next = apply(s, {
      type: 'plan-sell',
      offerId: s.offers![0].id,
      clientId: 'client-1',
      method: 'cash',
    })
    const holding = next.holdings![0]
    expect(cashTaken(s, next)).toEqual([
      {
        cause: 'cash',
        receipt: `plan:${holding.id}:${holding.payments[0].id}`,
        kind: 'plan',
        number: 'PL-1',
        locationId: s.organisation.locationId,
        amountMinor: 4000,
      },
    ])
    s = next
    next = apply(s, { type: 'plan-renew', holdingId: holding.id, method: 'cash' })
    expect(cashTaken(s, next)).toMatchObject([{ number: 'PL-1-2', amountMinor: 4000 }])
    s = next
    next = apply(s, {
      type: 'plan-cancel',
      holdingId: holding.id,
      reason: 'Moving away',
      refundMinor: 4000,
      method: 'cash',
      reference: 'R-2',
    })
    expect(cashTaken(s, next)).toMatchObject([{ cause: 'refund', kind: 'plan', amountMinor: 4000 }])
  })

  it('opens for simulated cash in a sample studio, where everything is pretend', () => {
    const s = seed('UK')
    const a = s.appointments.find((x) => x.status === 'arrived')!
    const after = apply(s, {
      type: 'checkout',
      appointmentId: a.id,
      tipMinor: 0,
      method: 'demo_cash',
    })
    expect(cashTaken(s, after)).toHaveLength(1)
  })
})

describe('the drawer in the till count', () => {
  it('reads as one plain sentence, telling test openings and silent printers apart', () => {
    const cash = { cause: 'cash' as const, status: 'sent' as const, actorName: 'Ana' }
    expect(
      drawerSummary([
        cash,
        cash,
        cash,
        { cause: 'no_sale', status: 'sent', actorName: 'Maya', reason: 'Change for a £20' },
      ]),
    ).toBe('The drawer opened 4 times: 3 cash payments, 1 no sale by Maya: change for a £20.')
    expect(drawerSummary([{ ...cash, status: 'test' }])).toBe(
      'The test drawer would have opened once: 1 cash payment.',
    )
    expect(
      drawerSummary([
        { ...cash, cause: 'refund' },
        { cause: 'no_sale', status: 'sent', actorName: 'Maya', reason: 'Float top-up' },
        { cause: 'no_sale', status: 'sent', actorName: 'Tom', reason: 'ATM run' },
        { ...cash, status: 'failed' },
      ]),
    ).toBe(
      'The drawer opened 3 times: 1 cash refund, 2 no sales (Maya: float top-up; Tom: ATM run). Once the printer did not answer, so the drawer may not have opened.',
    )
    expect(drawerSummary([])).toBe('The drawer has not been opened through SALEANE.')
    expect(drawerSummary([{ ...cash, status: 'skipped' }])).toBe(
      'The drawer has not been opened through SALEANE.',
    )
  })

  it('asks for a short reason for a no-sale opening', () => {
    expect(noSaleProblem('Change for a £20')).toBeNull()
    expect(noSaleProblem(' ')).toMatch(/Say briefly why/)
    expect(noSaleProblem('x'.repeat(81))).toMatch(/up to 80/)
  })
})
