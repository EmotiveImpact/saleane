import type { BusinessState } from './model'
import type { Command } from './commands'
import { businessDate, operations } from './operations'
import { places, staffLocationOn } from './locations'
import { branchVisits } from './branchVisits'
import { withoutPayRates } from './pay'
import { shifts, shiftsAt } from './hours'

/**
 * V5: a general manager runs one location ('general', with the location in their access). They
 * read the studio record as a manager does, less the team's pay rates and other locations' branch
 * visits and requests, and change only what belongs to their location: its visits and takings,
 * its stock and orders, its branch visits and requests, and the clients they look after. Anything
 * that changes the whole business (treatments, prices, the team, hours, settings) stays with the
 * owner and managers. Permissions are in `GENERAL_ACTIONS` (operations.ts).
 */
/** Changes that concern a client rather than a location; any general manager may make them. */
const CLIENT_COMMANDS = new Set([
  'client',
  'client-edit',
  'client-birthday',
  'client-area',
  'note',
  'consent',
  'contact-preferences',
  'consultation-save',
  'patch-test',
  'patch-test-result',
  'reply-note',
  'replies-read',
  'reply-link',
  'social-answer',
  'gift-card-sell',
  'plan-sell',
  'plan-renew',
  'balance-settle',
  'task-add',
  'task-done',
  'missed-call',
  'missed-call-done',
])
const VISIT_COMMANDS = new Set(['cancel', 'no-show', 'arrive', 'checkout', 'deposit', 'fee'])
const ELSEWHERE = 'That visit is at another location.'
const WHOLE_BUSINESS = 'That changes the whole business. Ask the owner or a manager.'

/** Why a general manager may not make this change at their location, or null when they may. */
export function branchRefusal(
  s: BusinessState,
  locationId: string,
  command: Command,
): string | null {
  const mine = (id: string | undefined) => (id ?? s.organisation.locationId) === locationId
  const visitHere = (appointmentId: string | undefined) => {
    const visit = s.appointments.find((a) => a.id === appointmentId)
    return !!visit && visit.locationId === locationId
  }
  if (CLIENT_COMMANDS.has(command.type)) return null
  if (VISIT_COMMANDS.has(command.type) || command.type === 'reschedule')
    return visitHere((command as { appointmentId: string }).appointmentId) ? null : ELSEWHERE
  switch (command.type) {
    case 'book':
      // Where the visit lands is checked again once it is made (see branchChangeRefusal).
      return command.input.locationId && !mine(command.input.locationId) ? ELSEWHERE : null
    case 'batch':
      for (const part of command.commands) {
        const refusal = branchRefusal(s, locationId, part as Command)
        if (refusal) return refusal
      }
      return null
    case 'refund': {
      if (command.counterSaleId) {
        const sale = (s.counterSales ?? []).find((x) => x.id === command.counterSaleId)
        return sale && mine(sale.locationId) ? null : 'That sale was at another location.'
      }
      const receipt = command.saleId
        ? s.sales.find((x) => x.id === command.saleId)
        : s.payments.find((x) => x.id === command.paymentId)
      return receipt && visitHere(receipt.appointmentId) ? null : ELSEWHERE
    }
    case 'message':
      return command.input.appointmentId && !visitHere(command.input.appointmentId)
        ? ELSEWHERE
        : null
    case 'message-queue': {
      const message = operations(s).messages.find((m) => m.id === command.messageId)
      return message?.appointmentId && !visitHere(message.appointmentId) ? ELSEWHERE : null
    }
    case 'waitlist-add':
      return mine(command.input.locationId ?? locationId)
        ? null
        : 'That waitlist place is for another location.'
    case 'waitlist-remove': {
      // A request for any location is anyone's to tidy; one for another location is not.
      const entry = s.waitlist?.find((e) => e.id === command.entryId)
      return entry?.locationId && !mine(entry.locationId)
        ? 'That waitlist place is for another location.'
        : null
    }
    case 'clock-in':
      return staffLocationOn(s, command.staffId, businessDate(s)) === locationId
        ? null
        : 'That person works at another location today.'
    case 'clock-out': {
      // Clocking out closes the shift where it was clocked in, whatever today's rota says.
      const open = shifts(s)
        .filter((x) => x.staffId === command.staffId && !x.end)
        .sort((a, b) => b.start.localeCompare(a.start))[0]
      if (open) return mine(open.locationId) ? null : 'That person clocked in at another location.'
      return staffLocationOn(s, command.staffId, businessDate(s)) === locationId
        ? null
        : 'That person works at another location today.'
    }
    case 'waitlist-offer':
      return staffLocationOn(s, command.staffId, command.date) === locationId
        ? null
        : 'That person works at another location that day.'
    case 'counter-sale':
    case 'stock':
    case 'purchase-order':
      return mine(command.locationId) ? null : 'That is at another location.'
    case 'stock-move':
      return mine(command.from) ? null : 'You can only send stock from your own location.'
    case 'receive-order':
    case 'cancel-order': {
      const order = (operations(s).purchaseOrders ?? []).find((o) => o.id === command.orderId)
      return order && mine(order.locationId) ? null : 'That order is for another location.'
    }
    case 'branch-visit':
      return mine(command.input.locationId) ? null : 'That is at another location.'
    case 'branch-visit-fix': {
      const visit = branchVisits(s).find((v) => v.id === command.visitId)
      return visit && mine(visit.locationId) ? null : 'That visit is at another location.'
    }
    case 'request-raise':
      return mine(command.input.locationId) ? null : 'That is at another location.'
  }
  return WHOLE_BUSINESS
}

/**
 * Checked after a general manager's change is made: every visit and shift it added or changed is
 * at their location, before and after. This catches a booking or move that lands somewhere else.
 */
export function branchChangeRefusal(
  before: BusinessState,
  after: BusinessState,
  locationId: string,
): string | null {
  const old = new Map(before.appointments.map((a) => [a.id, a]))
  for (const visit of after.appointments) {
    const previous = old.get(visit.id)
    if (previous && JSON.stringify(previous) === JSON.stringify(visit)) continue
    if (visit.locationId !== locationId || (previous && previous.locationId !== locationId))
      return 'That would change a visit at another location.'
  }
  // Hours worked, likewise: only those at their location, before and after.
  const main = after.organisation.locationId
  const at = (shift: { locationId?: string }) => (shift.locationId ?? main) === locationId
  const was = new Map((before.operations?.shifts ?? []).map((x) => [x.id, x]))
  for (const shift of after.operations?.shifts ?? []) {
    const previous = was.get(shift.id)
    if (previous && JSON.stringify(previous) === JSON.stringify(shift)) continue
    if (!at(shift) || (previous && !at(previous)))
      return 'That would change hours worked at another location.'
  }
  return null
}

/** Whether a general manager's location is still open. */
export const branchOpen = (s: BusinessState, locationId: string) =>
  places(s).some((p) => p.id === locationId)

/**
 * What a general manager reads: the studio record less the team's pay rates, and only their own
 * location's branch visits and requests for a sign-off.
 */
export function branchView(s: BusinessState, locationId: string): BusinessState {
  const lean = withoutPayRates(s)
  const o = lean.operations
  if (!o) return lean
  return {
    ...lean,
    operations: {
      ...o,
      ...(o.branchVisits
        ? { branchVisits: o.branchVisits.filter((v) => v.locationId === locationId) }
        : {}),
      ...(o.requests ? { requests: o.requests.filter((r) => r.locationId === locationId) } : {}),
      ...(o.shifts ? { shifts: shiftsAt(o.shifts, locationId, s.organisation.locationId) } : {}),
    },
  }
}
