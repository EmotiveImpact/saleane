import type { BusinessState, Staff } from './model'
import { operations } from './operations'
import type { PayRate } from './operations'
import { retailRevenue } from './retail'
import { serviceRevenue } from './selectors'
import { recordDay } from './tillCount'
import { rentalOn } from './rent'

/**
 * V2: commission and tips per person for a pay period. SALEANE works out what each person has
 * earned; it does not pay anyone. Services and products are counted without tax and after any
 * discount. Tips go in full to the person who did the visit. People renting a chair or room are
 * self-employed: their visits on rental days earn no commission here.
 */

/** The rate one person is on for a day: the latest change starting on or before it. */
export function rateFor(s: BusinessState, staffId: string, date: string): PayRate | undefined {
  let found: PayRate | undefined
  for (const rate of operations(s).payRates ?? [])
    if (rate.staffId === staffId && rate.from <= date && (!found || rate.from >= found.from))
      found = rate
  return found
}

export function rateHistory(s: BusinessState, staffId: string) {
  return (operations(s).payRates ?? [])
    .filter((rate) => rate.staffId === staffId)
    .map((rate, order) => ({ rate, order }))
    .sort((a, b) => b.rate.from.localeCompare(a.rate.from) || b.order - a.order)
    .map(({ rate }) => rate)
}

const share = (amount: number, bps = 0) => Math.round((amount * bps) / 10000)

export type PayLine = {
  kind: 'visit' | 'counter' | 'refund'
  date: string
  receipt: string
  label: string
  servicesMinor: number
  productsMinor: number
  commissionMinor: number
  tipMinor: number
}

export type PaySummary = {
  staff: Staff
  visits: number
  servicesMinor: number
  productsMinor: number
  givenBackMinor: number
  commissionMinor: number
  tipsMinor: number
  owedMinor: number
  lines: PayLine[]
}

/** Earnings for every person, active or not, who earned something or is on the team. */
export function payPeriod(s: BusinessState, from: string, to: string): PaySummary[] {
  const inPeriod = (date: string) => date >= from && date <= to
  const lines = new Map<string, PayLine[]>()
  const push = (staffId: string, line: PayLine) =>
    lines.set(staffId, [...(lines.get(staffId) ?? []), line])
  const visitCount = new Map<string, number>()
  const services = new Map(s.services.map((service) => [service.id, service.name]))

  const visitOf = (saleId: string) => {
    const sale = s.sales.find((x) => x.id === saleId)
    const appointment = sale && s.appointments.find((a) => a.id === sale.appointmentId)
    return sale && appointment ? { sale, appointment } : undefined
  }

  for (const sale of s.sales) {
    const appointment = s.appointments.find((a) => a.id === sale.appointmentId)
    if (!appointment || appointment.status !== 'completed' || !inPeriod(appointment.date)) continue
    // Someone renting a chair or room is self-employed and keeps their own takings.
    if (rentalOn(s, appointment.staffId, appointment.date)) continue
    const rate = rateFor(s, appointment.staffId, appointment.date)
    const servicesMinor = serviceRevenue(sale)
    const productsMinor = retailRevenue(sale)
    visitCount.set(appointment.staffId, (visitCount.get(appointment.staffId) ?? 0) + 1)
    push(appointment.staffId, {
      kind: 'visit',
      date: appointment.date,
      receipt: sale.receiptNumber ?? '',
      label: appointment.bookedServiceName ?? services.get(appointment.serviceId) ?? 'Appointment',
      servicesMinor,
      productsMinor,
      commissionMinor:
        share(servicesMinor, rate?.serviceBps) + share(productsMinor, rate?.productBps),
      tipMinor: sale.tipMinor,
    })
  }

  for (const sale of s.counterSales ?? []) {
    const date = recordDay(s, sale.paidAt)
    if (!sale.staffId || !inPeriod(date) || rentalOn(s, sale.staffId, date)) continue
    const rate = rateFor(s, sale.staffId, date)
    const productsMinor = retailRevenue(sale)
    push(sale.staffId, {
      kind: 'counter',
      date,
      receipt: sale.receiptNumber,
      label: 'Products without a visit',
      servicesMinor: 0,
      productsMinor,
      commissionMinor: share(productsMinor, rate?.productBps),
      tipMinor: 0,
    })
  }

  // Money given back comes off in this period, in proportion to what the receipt was for and at
  // the rate the person earned it on. Tips are left with the person.
  for (const refund of operations(s).refunds) {
    const date = recordDay(s, refund.createdAt)
    if (!inPeriod(date)) continue
    let staffId: string | undefined
    let earnedOn = date
    let servicesMinor = 0
    let productsMinor = 0
    let total = 0
    let receipt = ''
    if (refund.saleId) {
      const visit = visitOf(refund.saleId)
      if (!visit) continue
      staffId = visit.appointment.staffId
      earnedOn = visit.appointment.date
      if (rentalOn(s, staffId, earnedOn)) continue
      servicesMinor = serviceRevenue(visit.sale)
      productsMinor = retailRevenue(visit.sale)
      total = visit.sale.totalMinor
      receipt = visit.sale.receiptNumber ?? ''
    } else if (refund.counterSaleId) {
      const sale = (s.counterSales ?? []).find((x) => x.id === refund.counterSaleId)
      if (!sale?.staffId) continue
      staffId = sale.staffId
      earnedOn = recordDay(s, sale.paidAt)
      if (rentalOn(s, staffId, earnedOn)) continue
      productsMinor = retailRevenue(sale)
      total = sale.totalMinor
      receipt = sale.receiptNumber
    }
    if (!staffId || total <= 0) continue
    const rate = rateFor(s, staffId, earnedOn)
    const backServices = Math.round((refund.amountMinor * servicesMinor) / total)
    const backProducts = Math.round((refund.amountMinor * productsMinor) / total)
    push(staffId, {
      kind: 'refund',
      date,
      receipt,
      label: 'Money given back',
      servicesMinor: -backServices,
      productsMinor: -backProducts,
      commissionMinor: -(
        share(backServices, rate?.serviceBps) + share(backProducts, rate?.productBps)
      ),
      tipMinor: 0,
    })
  }

  return s.staff
    .filter((person) => !person.archived || lines.has(person.id))
    .map((staff) => {
      const rows = (lines.get(staff.id) ?? []).sort(
        (a, b) => a.date.localeCompare(b.date) || a.receipt.localeCompare(b.receipt),
      )
      const sum = (pick: (line: PayLine) => number, back = false) =>
        rows
          .filter((line) => (line.kind === 'refund') === back)
          .reduce((total, line) => total + pick(line), 0)
      const commissionMinor = rows.reduce((total, line) => total + line.commissionMinor, 0)
      const tipsMinor = rows.reduce((total, line) => total + line.tipMinor, 0)
      return {
        staff,
        visits: visitCount.get(staff.id) ?? 0,
        servicesMinor: sum((line) => line.servicesMinor),
        productsMinor: sum((line) => line.productsMinor),
        givenBackMinor: -sum((line) => line.servicesMinor + line.productsMinor, true),
        commissionMinor,
        tipsMinor,
        owedMinor: commissionMinor + tipsMinor,
        lines: rows,
      }
    })
}

/** A plain spreadsheet for payroll or the accountant. */
export function payCsv(rows: PaySummary[], from: string, to: string, currency: string) {
  const amount = (minor: number) => (minor / 100).toFixed(2)
  // A leading = + - or @ would run as a formula in a spreadsheet, so it is kept as text.
  const cell = (raw: string) => {
    const value = /^[=+\-@]/.test(raw) ? `'${raw}` : raw
    return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
  }
  const header = [
    'Person',
    'From',
    'To',
    'Visits',
    `Services (${currency}, before tax)`,
    `Products (${currency}, before tax)`,
    `Given back (${currency})`,
    `Commission (${currency})`,
    `Tips (${currency})`,
    `Owed (${currency})`,
  ]
  const body = rows.map((row) =>
    [
      cell(row.staff.name),
      from,
      to,
      String(row.visits),
      amount(row.servicesMinor),
      amount(row.productsMinor),
      amount(row.givenBackMinor),
      amount(row.commissionMinor),
      amount(row.tipsMinor),
      amount(row.owedMinor),
    ].join(','),
  )
  return [header.join(','), ...body].join('\n') + '\n'
}

/** Commission rates and chair rent are for owners and managers; reception reads the studio without them. */
export function withoutPayRates(s: BusinessState): BusinessState {
  const o = s.operations
  if (!o?.payRates && !o?.rentals && !o?.rentPayments) return s
  const { payRates: _rates, rentals: _rentals, rentPayments: _paid, ...operations } = o
  void [_rates, _rentals, _paid]
  return { ...s, operations }
}
