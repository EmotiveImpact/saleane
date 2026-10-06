import { businessDate, hoursFor, operations, staffHoursFor } from './operations'
import type { BusinessState, Client } from './model'
import { addDays } from './format'

export function dayAppointments(s: BusinessState, date = businessDate(s)) {
  return s.appointments
    .filter((a) => a.date === date && a.status !== 'cancelled' && a.status !== 'no_show')
    .sort((a, b) => a.startMinutes - b.startMinutes)
}
export function clientStats(s: BusinessState, clientId: string) {
  const visits = s.appointments.filter((a) => a.clientId === clientId && a.status === 'completed')
  const next = s.appointments
    .filter((a) => a.clientId === clientId && a.date >= businessDate(s) && a.status === 'confirmed')
    .sort((a, b) => a.date.localeCompare(b.date) || a.startMinutes - b.startMinutes)[0]
  const last = [...visits].sort((a, b) => b.date.localeCompare(a.date))[0]
  const spend = s.sales
    .filter((sale) => visits.some((a) => a.id === sale.appointmentId))
    .reduce((sum, sale) => sum + serviceRevenue(sale), 0)
  return { visits: visits.length, spend, next, last }
}
export function dueClients(s: BusinessState): Client[] {
  return s.clients.filter((c) => {
    const stats = clientStats(s, c.id)
    return (
      stats.last &&
      stats.last.date <= addDays(businessDate(s), -28) &&
      !stats.next &&
      !s.appointments.some((a) => a.clientId === c.id && a.status === 'arrived')
    )
  })
}
export function report(s: BusinessState, days: number) {
  const from = addDays(businessDate(s), 1 - days)
  const appointments = s.appointments.filter(
    (a) =>
      a.date >= from &&
      a.date <= businessDate(s) &&
      a.status !== 'cancelled' &&
      a.status !== 'no_show',
  )
  const completed = appointments.filter((a) => a.status === 'completed')
  const sales = s.sales.filter((sale) => completed.some((a) => a.id === sale.appointmentId))
  const revenue = sales.reduce((sum, sale) => sum + serviceRevenue(sale), 0)
  const tips = sales.reduce((sum, sale) => sum + sale.tipMinor, 0)
  const booked = appointments.reduce((sum, a) => sum + a.bookedPriceMinor, 0)
  const rebooked = completed.filter((a) =>
    s.appointments.some(
      (next) =>
        next.rebookedFromId === a.id && next.status !== 'cancelled' && next.status !== 'no_show',
    ),
  ).length
  const byDay = Array.from({ length: days }, (_, i) => {
    const date = addDays(from, i)
    return {
      date,
      revenue: sales
        .filter((sale) => s.appointments.find((a) => a.id === sale.appointmentId)?.date === date)
        .reduce((sum, sale) => sum + serviceRevenue(sale), 0),
    }
  })
  const byService = s.services.map((service) => ({
    service,
    revenue: sales
      .filter(
        (sale) => s.appointments.find((a) => a.id === sale.appointmentId)?.serviceId === service.id,
      )
      .reduce((sum, sale) => sum + serviceRevenue(sale), 0),
    visits: completed.filter((a) => a.serviceId === service.id).length,
  }))
  const byStaff = s.staff.map((staff) => ({
    staff,
    revenue: sales
      .filter(
        (sale) => s.appointments.find((a) => a.id === sale.appointmentId)?.staffId === staff.id,
      )
      .reduce((sum, sale) => sum + serviceRevenue(sale), 0),
    visits: completed.filter((a) => a.staffId === staff.id).length,
  }))
  return {
    from,
    revenue,
    tips,
    booked,
    completed: completed.length,
    utilisation: utilisation(s, days).ratio,
    tax: sales.reduce((sum, sale) => sum + (sale.taxMinor ?? 0), 0),
    refunds: operations(s)
      .refunds.filter((refund) => sales.some((sale) => sale.id === refund.saleId))
      .reduce((sum, refund) => sum + refund.amountMinor, 0),
    rebookRate: completed.length ? rebooked / completed.length : null,
    byDay,
    byService,
    byStaff,
  }
}

export function serviceRevenue(sale: BusinessState['sales'][number]) {
  return (
    sale.serviceMinor - (sale.discountMinor ?? 0) - (sale.taxInclusive ? (sale.taxMinor ?? 0) : 0)
  )
}
export function availableMinutes(s: BusinessState, date: string) {
  const h = hoursFor(s, date)
  if (!h || h.closed) return 0
  return s.staff
    .filter((person) => !person.archived)
    .reduce((sum, person) => {
      const ph = staffHoursFor(s, person.id, date)
      const start = Math.max(h.open, ph.open),
        end = Math.min(h.close, ph.close)
      if (ph.closed || end <= start) return sum
      const intervals = operations(s)
        .closures.filter(
          (c) =>
            c.date === date &&
            (!c.staffId || c.staffId === person.id) &&
            c.startMinutes < end &&
            c.endMinutes > start,
        )
        .map((c) => [Math.max(start, c.startMinutes), Math.min(end, c.endMinutes)])
        .sort((a, b) => a[0] - b[0])
      let unavailable = 0,
        through = start
      for (const [from, to] of intervals) {
        unavailable += Math.max(0, to - Math.max(from, through))
        through = Math.max(through, to)
      }
      return sum + end - start - unavailable
    }, 0)
}

/** The single label for utilisation, shared by Today and Business. */
export const UTILISATION_LABEL = 'Professional time booked'
/** Plain-language definition shown beneath every utilisation figure. */
export const UTILISATION_DEFINITION = 'booked service time ÷ open professional hours'

/**
 * One definition of utilisation for every screen: booked service minutes on active
 * (not cancelled or missed) appointments, divided by open professional minutes, over the
 * `days` ending on the business date. Turnaround buffers are excluded from booked time.
 * Pass `staffId` to measure one professional.
 */
export function utilisation(s: BusinessState, days = 1, staffId?: string) {
  const to = businessDate(s)
  const from = addDays(to, 1 - days)
  const bookedMinutes = s.appointments
    .filter(
      (a) =>
        a.date >= from &&
        a.date <= to &&
        a.status !== 'cancelled' &&
        a.status !== 'no_show' &&
        (!staffId || a.staffId === staffId),
    )
    .reduce((sum, a) => sum + a.bookedDurationMinutes, 0)
  const scoped = staffId ? { ...s, staff: s.staff.filter((p) => p.id === staffId) } : s
  const openMinutes = Array.from({ length: days }, (_, i) => addDays(from, i)).reduce(
    (sum, date) => sum + availableMinutes(scoped, date),
    0,
  )
  return {
    from,
    to,
    days,
    bookedMinutes,
    openMinutes,
    ratio: openMinutes ? bookedMinutes / openMinutes : 0,
    percent: Math.round(openMinutes ? (bookedMinutes / openMinutes) * 100 : 0),
    period: days === 1 ? 'Today' : `Last ${days} days`,
  }
}
