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
  const minutes = appointments.reduce((sum, a) => sum + a.bookedDurationMinutes, 0)
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
  const capacity = byDay.reduce((sum, day) => sum + availableMinutes(s, day.date), 0)
  return {
    from,
    revenue,
    tips,
    booked,
    completed: completed.length,
    utilisation: capacity ? minutes / capacity : 0,
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
/** Share of open professional time taken by booked service minutes on one day. */
export function bookedTimeShare(s: BusinessState, date: string) {
  const capacity = availableMinutes(s, date)
  const minutes = dayAppointments(s, date).reduce((sum, a) => sum + a.bookedDurationMinutes, 0)
  return capacity ? minutes / capacity : 0
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

export type DaySegment =
  | { kind: 'visit'; from: number; to: number; appointment: BusinessState['appointments'][number] }
  | { kind: 'free'; from: number; to: number }
  | { kind: 'closed'; from: number; to: number; reason: string }

/**
 * One professional's working day as an ordered run of visits, closures and
 * free time, so a narrow screen can show who is free without a time grid.
 * A visit's span includes its turnaround. Free gaps shorter than
 * `minimumFree` minutes are left out because nothing can be booked there.
 */
export function staffDay(s: BusinessState, staffId: string, date: string, minimumFree = 15) {
  const h = hoursFor(s, date)
  const ph = staffHoursFor(s, staffId, date)
  const visits = dayAppointments(s, date).filter((a) => a.staffId === staffId)
  const start = Math.max(h.open, ph.open)
  const end = Math.min(h.close, ph.close)
  const working = !h.closed && !ph.closed && end > start
  const busy: DaySegment[] = [
    ...visits.map((appointment) => ({
      kind: 'visit' as const,
      from: appointment.startMinutes,
      to:
        appointment.startMinutes +
        appointment.bookedDurationMinutes +
        appointment.bookedBufferMinutes,
      appointment,
    })),
    ...operations(s)
      .closures.filter(
        (c) =>
          working &&
          c.date === date &&
          (!c.staffId || c.staffId === staffId) &&
          c.startMinutes < end &&
          c.endMinutes > start,
      )
      .map((c) => ({
        kind: 'closed' as const,
        from: Math.max(start, c.startMinutes),
        to: Math.min(end, c.endMinutes),
        reason: c.reason,
      })),
  ].sort((a, b) => a.from - b.from || a.to - b.to)
  const segments: DaySegment[] = []
  let through = working ? start : Infinity
  for (const segment of busy) {
    if (working && segment.from - through >= minimumFree)
      segments.push({ kind: 'free', from: through, to: segment.from })
    segments.push(segment)
    through = Math.max(through === Infinity ? segment.to : through, segment.to)
  }
  if (working && end - through >= minimumFree)
    segments.push({ kind: 'free', from: through, to: end })
  const freeMinutes = segments
    .filter((segment) => segment.kind === 'free')
    .reduce((sum, segment) => sum + segment.to - segment.from, 0)
  return { working, start, end, segments, visits: visits.length, freeMinutes }
}
