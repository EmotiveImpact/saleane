import { describe, expect, it } from 'vitest'
import { dispatch, execute } from './commands'
import type { Command } from './commands'
import type { BusinessState } from './model'
import { can, permissionFor } from './operations'
import type { Role } from './operations'
import { createWorkspace } from './workspace'
import { seed } from './seed'
import { requests } from './approvals'
import { areaRefusal, areaView } from './area'
import { changeDetail, describeChange, recordNames } from './changeRecord'
import { serviceAt } from './locations'
import {
  afterApproval,
  duePrices,
  onApproval,
  refundApproval,
  refundRefusal,
  requestContext,
  requestRows,
  requestSummary,
  rotaSignOffNeeded,
  signOffRefusal,
} from './signoffs'
import type { ApprovalRequest } from './approvalsSchema'

// Stage 4: sign-offs for refunds, prices and the rota.
const now = '2026-10-06T08:00:00.000Z'
const later = (days: number, iso = now) =>
  new Date(Date.parse(iso) + days * 86_400_000).toISOString()
let sequence = 0
const run = (s: BusinessState, command: Command, at = now) =>
  execute(s, command, at, () => `signoff-${++sequence}`)
function apply(s: BusinessState, command: Command, at = now) {
  const result = run(s, command, at)
  if (!result.ok) throw new Error(result.error)
  return result.state
}
function refused(s: BusinessState, command: Command, at = now) {
  const result = run(s, command, at)
  expect(result.ok).toBe(false)
  return result.ok ? '' : result.error
}
/** A studio of our own, on its own clock, with the sample's team, rooms and treatments. */
function local(): BusinessState {
  const s = createWorkspace({ name: 'Sign-off test studio', region: 'UK' })
  const sample = seed('UK')
  for (const key of ['clients', 'services', 'staff', 'resources'] as const)
    Object.assign(s, {
      [key]: sample[key].map((row) => ({ ...row, organisationId: s.organisation.id })),
    })
  return s
}
let start = 570
/** A completed visit for Amelia, paid in cash: a £95 facial unless said otherwise. */
function visit(s: BusinessState, date = '2026-10-05') {
  start = start >= 900 ? 570 : start + 120
  s = apply(
    s,
    {
      type: 'import-appointments',
      source: 'Test',
      reviewed: true,
      appointments: [
        {
          clientId: 'client-1',
          serviceId: 'service-facial',
          staffId: 'staff-maya',
          date,
          startMinutes: start,
          priceMinor: 9500,
          depositPaidMinor: 0,
        },
      ],
    },
    `${date}T07:00:00.000Z`,
  )
  const a = s.appointments.filter((x) => x.source === 'import').at(-1)!
  s = apply(s, { type: 'arrive', appointmentId: a.id }, `${date}T16:00:00.000Z`)
  s = apply(
    s,
    { type: 'checkout', appointmentId: a.id, tipMinor: 0, method: 'cash' } as Command,
    `${date}T16:00:00.000Z`,
  )
  return { s, sale: s.sales.find((x) => x.appointmentId === a.id)! }
}
const rules = (
  general: number | null,
  manager: number | null = null,
  rota: 'off' | 'extra' | 'all' = 'off',
): Command => ({
  type: 'signoff-rules',
  generalRefundLimitMinor: general,
  managerRefundLimitMinor: manager,
  rotaSignOff: rota,
})
const refundAsk = (
  locationId: string,
  saleId: string,
  amountMinor: number,
  note = 'Skin felt tight after the peel.',
  managedRegions?: string[],
): Command => ({
  type: 'request-raise',
  input: { locationId, kind: 'refund', refund: { saleId }, amountMinor, note },
  ...(managedRegions ? { managedRegions } : {}),
})
const decide = (requestId: string, outcome: 'approved' | 'declined' = 'approved'): Command => ({
  type: 'request-decide',
  requestId,
  outcome,
})
const refund = (saleId: string, amountMinor: number, reference: string): Command => ({
  type: 'refund',
  saleId,
  amountMinor,
  reason: 'Goodwill refund',
  reference,
  method: 'cash',
})
const last = (s: BusinessState) => requests(s).at(-1)!
const after = (s: BusinessState, r: ApprovalRequest, at: string) =>
  afterApproval(r, requestContext(s, r, at))

describe('refund limits', () => {
  it('stop a general manager, or a manager when the owner chooses, over the limit on one receipt', () => {
    const visited = visit(apply(local(), rules(50_00)))
    const sale = visited.sale
    let s = visited.s
    const target = { saleId: sale.id }
    expect(refundRefusal(s, 'general', target, 50_00, now)).toBeNull()
    expect(refundRefusal(s, 'general', target, 60_00, now)).toBe(
      'This is over the £50.00 you can give back without a sign-off. Ask for a sign-off from the receipt first.',
    )
    // Managers need none until the owner sets one; the owner never does.
    for (const role of ['owner', 'manager'] as Role[])
      expect(refundRefusal(s, role, target, 95_00, now)).toBeNull()
    s = apply(s, rules(50_00, 30_00))
    expect(refundRefusal(s, 'manager', target, 40_00, now)).toMatch(/over the £30.00/)
    // Splitting a refund does not get round it: the receipt's refunds are counted together.
    s = apply(s, refund(sale.id, 30_00, 'R-1'))
    expect(refundRefusal(s, 'general', target, 20_00, now)).toBeNull()
    expect(refundRefusal(s, 'general', target, 25_00, now)).toBe(
      'This would take the money given back on this receipt to £55.00, over the £50.00 you can give back without a sign-off. Ask for a sign-off from the receipt first.',
    )
    // The server's check is the same one.
    expect(signOffRefusal(s, 'general', refund(sale.id, 25_00, 'R-2'), now)).toMatch(
      /over the £50.00/,
    )
  })

  it('are the owner’s to set, kept beside the regional limit', () => {
    let s = apply(local(), { type: 'approval-limit', regionalLimitMinor: 800_00 })
    s = apply(s, rules(50_00, null, 'extra'))
    expect(s.operations!.approvals).toEqual({
      regionalLimitMinor: 800_00,
      generalRefundLimitMinor: 50_00,
      rotaSignOff: 'extra',
    })
    s = apply(s, { type: 'approval-limit', regionalLimitMinor: 900_00 })
    expect(s.operations!.approvals).toMatchObject({
      regionalLimitMinor: 900_00,
      rotaSignOff: 'extra',
    })
    // Saved together from the rules form, with the regional limit when the studio has regions.
    s = apply(s, { ...rules(40_00, 20_00, 'all'), regionalLimitMinor: 700_00 } as Command)
    expect(s.operations!.approvals).toEqual({
      regionalLimitMinor: 700_00,
      generalRefundLimitMinor: 40_00,
      managerRefundLimitMinor: 20_00,
      rotaSignOff: 'all',
    })
    const action = permissionFor({ type: 'signoff-rules' })
    expect(
      (['owner', 'manager', 'general', 'regional'] as Role[]).map((r) => can(r, action)),
    ).toEqual([true, false, false, false])
    // An approved price starts only from the server, never from a screen.
    const start = permissionFor({ type: 'request-start' })
    expect(
      (['owner', 'manager', 'general', 'regional', 'reception'] as Role[]).some((r) =>
        can(r, start),
      ),
    ).toBe(false)
  })
})

describe('refund requests', () => {
  it('describe the receipt without the client, and refuse a reason that names them', () => {
    const { s: start, sale } = visit(apply(local(), rules(50_00)))
    const main = start.organisation.locationId
    expect(refused(start, refundAsk(main, sale.id, 60_00, 'Amelia was unhappy'))).toBe(
      'Leave the client’s name and details out of the reason. The person deciding sees the receipt, not the client.',
    )
    expect(
      refused(start, refundAsk(main, sale.id, 60_00, 'Emailed amelia.carter@example.com')),
    ).toMatch(/Leave the client’s name/)
    expect(refused(start, refundAsk(main, sale.id, 96_00))).toBe(
      'This receipt has £95.00 left to give back.',
    )
    let s = apply(start, refundAsk(main, sale.id, 60_00))
    const request = last(s)
    expect(request).toMatchObject({
      kind: 'refund',
      title: `Refund on ${sale.receiptNumber}`,
      amountMinor: 60_00,
      note: 'Skin felt tight after the peel.',
      routedTo: { level: 'owner' },
      passedUp: 'no-region',
      refund: {
        saleId: sale.id,
        receipt: sale.receiptNumber,
        what: 'Skin Renewal Facial',
        paidMinor: 95_00,
        refundedMinor: 0,
      },
    })
    expect(JSON.stringify(request)).not.toMatch(/Amelia|amelia|client-1|7700/)
    // One refund at a time on a receipt.
    expect(refused(s, refundAsk(main, sale.id, 70_00))).toMatch(/already has a refund waiting/)
    s = apply(s, decide(request.id, 'declined'))
    s = apply(s, refundAsk(main, sale.id, 70_00))
    expect(last(s).amountMinor).toBe(70_00)
  })

  it('can be given back once, for that receipt and amount only, and approving moves no money', () => {
    const visited = visit(apply(local(), rules(50_00)))
    const sale = visited.sale
    let s = visited.s
    const other = visit(s)
    s = other.s
    const main = s.organisation.locationId
    s = apply(s, refundAsk(main, sale.id, 60_00))
    const id = last(s).id
    expect(refundRefusal(s, 'general', { saleId: sale.id }, 60_00, now)).toBe(
      'A refund on this receipt is waiting for a sign-off. It can be given back once it is approved.',
    )
    const approved = dispatch(s, decide(id), 'Rae Area', now)
    if (!approved.ok) throw new Error(approved.error)
    s = approved.state
    expect(s.operations!.refunds).toHaveLength(0)
    expect(last(s).decision).toMatchObject({ outcome: 'approved', by: 'Rae Area', at: now })
    expect(refundApproval(s, last(s), now)).toBe('ready')
    expect(refundRefusal(s, 'general', { saleId: sale.id }, 60_00, now)).toBeNull()
    expect(refundRefusal(s, 'general', { saleId: sale.id }, 70_00, now)).toBe(
      'The sign-off for this receipt is for exactly £60.00. Give back that amount, or ask again.',
    )
    expect(refundRefusal(s, 'general', { saleId: other.sale.id }, 60_00, now)).toMatch(
      /over the £50.00/,
    )
    const given = dispatch(s, refund(sale.id, 60_00, 'R-9'), 'Gia General', later(1))
    if (!given.ok) throw new Error(given.error)
    s = given.state
    const refundId = s.operations!.refunds.at(-1)!.id
    expect(last(s).carriedOut).toEqual({ at: later(1), by: 'Gia General', recordId: refundId })
    expect(after(s, last(s), later(1))).toBe('Given back on Wednesday 7 October.')
    // Used up: the same refund again is over the limit with nothing to allow it.
    expect(refundRefusal(s, 'general', { saleId: sale.id }, 35_00, later(1))).toMatch(/to £95.00/)
    // A replay of the same refund changes nothing.
    const again = run(s, refund(sale.id, 60_00, 'R-9'), later(1))
    expect(again.ok && again.state.operations!.refunds).toHaveLength(1)
  })

  it('lapse after seven of the studio’s days, or when more goes back on the receipt', () => {
    const visited = visit(apply(local(), rules(50_00)))
    const sale = visited.sale
    let s = visited.s
    const main = s.organisation.locationId
    s = apply(s, refundAsk(main, sale.id, 60_00))
    s = apply(s, decide(last(s).id))
    const request = last(s)
    // Approved on Tuesday 6 October: ready until the end of Tuesday 13 October in London.
    expect(refundApproval(s, request, '2026-10-13T22:59:00.000Z')).toBe('ready')
    expect(refundApproval(s, request, '2026-10-13T23:00:00.000Z')).toBe('expired')
    expect(refundRefusal(s, 'general', { saleId: sale.id }, 60_00, later(8))).toBe(
      'The sign-off for this refund has lapsed. Ask for a sign-off again from the receipt.',
    )
    expect(after(s, request, later(8))).toBe('Lapsed: it was not given back by Tuesday 13 October.')
    // A card refund started before it lapsed still uses it when the card company answers.
    const late = run(s, refund(sale.id, 60_00, 'R-card'), later(9))
    expect(late.ok && requests(late.state).at(-1)!.carriedOut).toBeUndefined()
    const asOf = execute(s, refund(sale.id, 60_00, 'R-card'), later(9), () => 'refund-card', {
      refundApprovalAsOf: later(2),
    })
    expect(asOf.ok && requests(asOf.state).at(-1)!.carriedOut?.recordId).toBe('refund-card')
    // Anything else given back on the receipt meanwhile ends it.
    s = apply(s, refund(sale.id, 5_00, 'R-5'))
    expect(refundApproval(s, last(s), now)).toBe('changed')
    expect(refundRefusal(s, 'general', { saleId: sale.id }, 60_00, now)).toMatch(/has lapsed/)
  })

  it('go to the region’s manager, or the owner over the regional limit, and never to their own raiser', () => {
    let s = apply(local(), {
      type: 'location',
      input: { name: 'Islington', address: '1 Upper St' },
    })
    const main = s.organisation.locationId
    const islington = s.operations!.locations![0].id
    s = apply(s, { type: 'region', input: { name: 'London', locationIds: [main, islington] } })
    const london = s.operations!.regions![0].id
    const { s: paid, sale } = visit(s)
    s = apply(paid, refundAsk(main, sale.id, 60_00, undefined, [london]))
    expect(last(s).routedTo).toEqual({ level: 'regional', regionId: london })
    // Raised at a location the receipt is not from.
    expect(refused(s, refundAsk(islington, sale.id, 10_00, undefined, [london]))).toBe(
      'That receipt is from another location.',
    )
    s = apply(s, decide(last(s).id, 'declined'))
    s = apply(s, { type: 'approval-limit', regionalLimitMinor: 50_00 })
    s = apply(s, refundAsk(main, sale.id, 60_00, undefined, [london]))
    expect(last(s)).toMatchObject({ routedTo: { level: 'owner' }, passedUp: 'over-limit' })
    // A regional manager asks for spending or anything else, not refunds, prices or rota days.
    expect(areaRefusal(s, london, refundAsk(main, sale.id, 10_00), 'account-rae')).toBe(
      'Refunds, prices and rota changes are asked for by the location’s team.',
    )
    // What a regional manager reads: the receipt, amount and treatment, never the client.
    const area = areaView(s, london, '2026-10-06')
    const view = JSON.stringify(area.requests)
    expect(view).toContain(sale.receiptNumber!)
    expect(view).toContain('Skin Renewal Facial')
    expect(view).not.toMatch(/Amelia|Carter|amelia|7700 900|client-1/)
    // The area's screen describes it from the request alone.
    const asked = area.requests.at(-1)!
    const words = { org: area.organisation, today: area.today, place: 'Islington' }
    expect(requestSummary(asked, words)).toBe(
      `${sale.receiptNumber} · Skin Renewal Facial · £60.00 back of £95.00 paid`,
    )
    expect(requestRows(asked, words).map((row) => row.value)).toEqual([
      sale.receiptNumber,
      'Skin Renewal Facial',
      '£95.00',
      '£0.00',
      '£60.00',
    ])
    expect(onApproval(asked, words, 'Gia')).toBe(
      'Approving moves no money. Gia can then give back £60.00 from this receipt once, within 7 days.',
    )
    const approved = { ...asked, decision: { outcome: 'approved' as const, at: now } }
    expect(afterApproval(approved, words)).toBe(
      'Can be given back once, from the receipt, until Tuesday 13 October.',
    )
    expect(afterApproval(approved, { ...words, today: '2026-10-14' })).toMatch(/^Lapsed/)
  })
})

describe('price change requests', () => {
  function twoSites() {
    const s = apply(local(), {
      type: 'location',
      input: { name: 'Islington', address: '1 Upper St' },
    })
    return { s, main: s.organisation.locationId, islington: s.operations!.locations![0].id }
  }
  const ask = (locationId: string, priceMinor: number, startsOn: string): Command => ({
    type: 'request-raise',
    input: {
      locationId,
      kind: 'price',
      price: { serviceId: 'service-facial', priceMinor, startsOn },
    },
  })
  const facial = (s: BusinessState) => s.services.find((x) => x.id === 'service-facial')!

  it('start on approval when their day has come, with the price before and after kept', () => {
    const sites = twoSites()
    const islington = sites.islington
    let s = sites.s
    s = apply(s, ask(islington, 105_00, '2026-10-06'))
    expect(last(s)).toMatchObject({
      title: 'New price for Skin Renewal Facial',
      price: { fromMinor: 95_00, toMinor: 105_00, startsOn: '2026-10-06' },
      routedTo: { level: 'owner' },
    })
    expect(onApproval(last(s), requestContext(s, last(s), now))).toMatch(
      /^The price at Islington changes/,
    )
    const before = s
    s = apply(s, decide(last(s).id))
    expect(serviceAt(facial(s), islington).priceMinor).toBe(105_00)
    expect(facial(s).priceMinor).toBe(95_00)
    expect(last(s).carriedOut?.recordId).toBe('service-facial')
    // Who changed what keeps the treatment, location, and price before and after.
    expect(changeDetail(before, s, 'request-decide', last(s).id)).toEqual({
      fields: [
        { f: 'outcome', to: 'approved' },
        { f: 'serviceId', to: 'service-facial' },
        { f: 'locationId', to: islington },
        { f: 'priceMinor', from: 95_00, to: 105_00 },
        { f: 'startsOn', to: '2026-10-06' },
      ],
    })
  })

  it('wait for their day, then start by themselves; visits already booked keep their price', () => {
    const sites = twoSites()
    const { main, islington } = sites
    let s = sites.s
    const book = (state: BusinessState, date: string, at = now) =>
      apply(
        state,
        {
          type: 'book',
          input: {
            clientId: 'client-2',
            serviceId: 'service-facial',
            staffId: 'staff-maya',
            date,
            startMinutes: 600,
            source: 'desk',
          },
        },
        at,
      )
    s = book(s, '2026-11-03')
    s = apply(s, ask(main, 99_00, '2026-11-01'))
    s = apply(s, decide(last(s).id))
    expect(facial(s).priceMinor).toBe(95_00)
    expect(after(s, last(s), now)).toBe('Starts by itself on Sunday 1 November.')
    expect(duePrices(s, '2026-10-31T23:59:00.000Z')).toEqual([])
    // Midnight in London on 1 November.
    const day = '2026-11-01T00:00:00.000Z'
    expect(duePrices(s, day).map((r) => r.id)).toEqual([last(s).id])
    const started = dispatch(s, { type: 'request-start', requestId: last(s).id }, 'SALEANE', day)
    if (!started.ok) throw new Error(started.error)
    const before = s
    s = started.state
    // The house price changes; Islington keeps the price it had.
    expect(facial(s).priceMinor).toBe(99_00)
    expect(serviceAt(facial(s), islington).priceMinor).toBe(95_00)
    expect(last(s).carriedOut).toMatchObject({ at: day, by: 'SALEANE' })
    expect(duePrices(s, day)).toEqual([])
    const entry = describeChange(s, recordNames(s), {
      id: 'audit-1',
      action: 'request-start',
      recordId: last(s).id,
      occurredAt: Date.parse(day),
      actor: null,
      account: null,
      detail: JSON.stringify(changeDetail(before, s, 'request-start', last(s).id)),
    })
    expect(entry).toMatchObject({
      who: 'SALEANE',
      what: 'Started a new price that was signed off',
      lines: expect.arrayContaining([{ what: 'price', from: '£95.00', to: '£99.00' }]),
    })
    // The visit booked before keeps £95; one booked now takes £99.
    expect(s.appointments.find((a) => a.date === '2026-11-03')!.bookedPriceMinor).toBe(95_00)
    s = book(s, '2026-11-04', day)
    expect(s.appointments.find((a) => a.date === '2026-11-04')!.bookedPriceMinor).toBe(99_00)
  })

  it('do not start when the price was changed by hand meanwhile, and say why', () => {
    const sites = twoSites()
    const islington = sites.islington
    let s = sites.s
    s = apply(s, ask(islington, 105_00, '2026-10-20'))
    s = apply(s, decide(last(s).id))
    const { id: _id, organisationId: _org, ...input } = facial(s)
    void [_id, _org]
    s = apply(s, {
      type: 'service',
      id: 'service-facial',
      input: { ...input, locationPrices: [{ locationId: islington, priceMinor: 98_00 }] },
    } as Command)
    s = apply(s, { type: 'request-start', requestId: last(s).id }, '2026-10-20T08:00:00.000Z')
    expect(serviceAt(facial(s), islington).priceMinor).toBe(98_00)
    expect(last(s).notStarted?.reason).toBe(
      'The price of Skin Renewal Facial at Islington has changed since this was asked, to £98.00.',
    )
    expect(after(s, last(s), now)).toMatch(/^It did not start on Tuesday 20 October/)
  })

  it('are refused when they break a house rule, start in the past, or leave the deposit above the price', () => {
    const sites = twoSites()
    const islington = sites.islington
    let s = sites.s
    expect(refused(s, ask(islington, 105_00, '2026-10-05'))).toBe(
      'Choose today or a day still to come.',
    )
    expect(refused(s, ask(islington, 95_00, '2026-10-10'))).toMatch(/is £95.00 there already/)
    expect(refused(s, ask(islington, 10_00, '2026-10-10'))).toMatch(/The deposit for/)
    s = apply(s, { type: 'house-rules', priceBandPercent: 0, coreServiceIds: [] } as Command)
    expect(refused(s, ask(islington, 105_00, '2026-10-10'))).toMatch(/same at every location/)
  })
})

describe('rota sign-offs', () => {
  const extraMonday: Command = {
    type: 'rota-day',
    input: {
      staffId: 'staff-theo',
      date: '2026-10-12',
      working: true,
      open: 600,
      close: 960,
      note: 'Colour launch',
    },
  }
  const shorterTuesday: Command = {
    type: 'rota-day',
    input: { staffId: 'staff-maya', date: '2026-10-13', working: true, open: 600, close: 900 },
  }

  it('are needed for a general manager’s extra days, or every change, as the owner chooses', () => {
    let s = local()
    expect(rotaSignOffNeeded(s, extraMonday, now)).toBe(false)
    s = apply(s, rules(null, null, 'extra'))
    expect(rotaSignOffNeeded(s, extraMonday, now)).toBe(true)
    expect(rotaSignOffNeeded(s, shorterTuesday, now)).toBe(false)
    expect(signOffRefusal(s, 'general', extraMonday, now)).toBe(
      'This change to the rota needs a sign-off. Choose Ask for a sign-off to send it up.',
    )
    // Only a general manager's changes; managers and the owner change the rota as before.
    expect(signOffRefusal(s, 'manager', extraMonday, now)).toBeNull()
    s = apply(s, rules(null, null, 'all'))
    expect(rotaSignOffNeeded(s, shorterTuesday, now)).toBe(true)
    expect(
      signOffRefusal(s, 'general', { type: 'rota-week-clear', monday: '2026-10-12' }, now),
    ).toMatch(/^Copying or clearing a week/)
  })

  it('weigh only the days a copied week would make at that location', () => {
    let s = apply(local(), {
      type: 'location',
      input: { name: 'Islington', address: '1 Upper St' },
    })
    const main = s.organisation.locationId
    const islington = s.operations!.locations![0].id
    s = apply(s, rules(null, null, 'extra'))
    // The owner gives Theo an extra Monday at the main location; copying that week brings it on.
    s = apply(s, extraMonday)
    const copy = (locationId: string): Command => ({
      type: 'rota-week-copy',
      monday: '2026-10-19',
      locationId,
    })
    expect(rotaSignOffNeeded(s, copy(main), now)).toBe(true)
    expect(rotaSignOffNeeded(s, copy(islington), now)).toBe(false)
  })

  it('apply exactly the change asked for once approved, and only at their own location', () => {
    let s = apply(local(), {
      type: 'location',
      input: { name: 'Islington', address: '1 Upper St' },
    })
    const main = s.organisation.locationId
    const islington = s.operations!.locations![0].id
    expect(
      refused(s, {
        type: 'request-raise',
        input: { locationId: islington, kind: 'rota', rota: extraMonday },
      } as Command),
    ).toBe(
      'Theo would not be working at Islington that day, before or after. Ask for days at Islington only.',
    )
    s = apply(s, {
      type: 'request-raise',
      input: { locationId: main, kind: 'rota', rota: extraMonday, note: 'Busy Monday' },
    } as Command)
    expect(last(s)).toMatchObject({
      title: 'Rota: Theo, Mon 12 Oct',
      rota: {
        staffName: 'Theo',
        date: '2026-10-12',
        before: 'off',
        after: '600-960',
        change: 'extra',
      },
    })
    expect(s.operations!.rotaChanges ?? []).toHaveLength(0)
    const approved = dispatch(s, decide(last(s).id), 'Rae Area', now)
    if (!approved.ok) throw new Error(approved.error)
    const before = s
    s = approved.state
    const change = s.operations!.rotaChanges!.at(-1)!
    expect(change).toMatchObject({
      staffId: 'staff-theo',
      date: '2026-10-12',
      working: true,
      open: 600,
      close: 960,
      note: 'Colour launch',
      actor: 'Rae Area',
    })
    expect(last(s).carriedOut).toEqual({ at: now, by: 'Rae Area', recordId: change.id })
    expect(changeDetail(before, s, 'request-decide', last(s).id)).toEqual({
      fields: [
        { f: 'outcome', to: 'approved' },
        { f: 'staffId', to: 'staff-theo' },
        { f: 'date', to: '2026-10-12' },
        { f: 'shift', from: 'off', to: '600-960' },
      ],
    })
  })

  it('cannot be approved once the change can no longer be made, but can be declined', () => {
    let s = local()
    const main = s.organisation.locationId
    s = apply(s, {
      type: 'request-raise',
      input: { locationId: main, kind: 'rota', rota: extraMonday },
    } as Command)
    const id = last(s).id
    s = apply(s, extraMonday)
    expect(refused(s, decide(id))).toBe('That day already has these hours.')
    s = apply(s, decide(id, 'declined'))
    expect(last(s).decision?.outcome).toBe('declined')
    expect(s.operations!.rotaChanges).toHaveLength(1)
  })
})

describe('the sample studio', () => {
  it('has a request of each kind waiting for the owner, and a refund limit', () => {
    const s = seed('UK')
    expect(s.operations!.approvals).toMatchObject({
      generalRefundLimitMinor: 50_00,
      rotaSignOff: 'extra',
    })
    const waiting = requests(s).filter((r) => !r.decision)
    expect(waiting.map((r) => r.kind).sort()).toEqual(['price', 'refund', 'rota'])
    for (const r of waiting)
      expect(r).toMatchObject({ routedTo: { level: 'owner' }, raisedBy: 'Nadia Ross' })
    const refundAsked = waiting.find((r) => r.kind === 'refund')!
    expect(refundAsked.amountMinor).toBe(60_00)
    expect(refundAsked.refund?.what).toMatch(/^Skin Renewal Facial/)
    expect(refundAsked.refund?.receipt).toMatch(/^SL-\d+$/)
  })
})
