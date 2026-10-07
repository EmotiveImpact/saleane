import type { BusinessState } from './model'
import { GUEST_CANCEL_CUTOFF_HOURS, visitStart } from './guest'
import { operations } from './operations'

/**
 * PILOT-02: the largest fee the studio's policy allows for a visit. Only a missed visit, or one
 * cancelled less than GUEST_CANCEL_CUTOFF_HOURS before it starts, can carry a fee; the fee is a
 * share of the booked price, less every deposit and fee already taken for that visit.
 */
export function feeAllowed(s: BusinessState, appointmentId: string) {
  const a = s.appointments.find((item) => item.id === appointmentId)
  const percent = operations(s).protection?.feePercent ?? 0
  if (!a || !percent || !['no_show', 'cancelled'].includes(a.status)) return 0
  if (a.status === 'cancelled') {
    const cancelledAt = s.events
      .filter((e) => e.appointmentId === a.id && e.type === 'cancelled')
      .map((e) => Date.parse(e.occurredAt))
      .sort((x, y) => y - x)[0]
    const cutoff = visitStart(s, a.id) - GUEST_CANCEL_CUTOFF_HOURS * 60 * 60000
    if (!cancelledAt || cancelledAt < cutoff) return 0
  }
  const taken = s.payments
    .filter((p) => p.appointmentId === a.id && p.kind !== 'settlement')
    .reduce((sum, p) => sum + p.amountMinor, 0)
  return Math.max(0, Math.floor((a.bookedPriceMinor * percent) / 100) - taken)
}
