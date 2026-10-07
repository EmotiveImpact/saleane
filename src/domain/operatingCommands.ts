import type { BusinessState, RelationshipEvent } from './model'
import { isReviewUrl } from './model'
import type { OperatingCommand } from './commandSchema'
import {
  PAY_RATE_LIMIT,
  PAY_RULES_LIMIT,
  SCHEDULE_HISTORY_LIMIT,
  TIME_OFF_DAYS,
  TIME_OFF_LIMIT,
  businessDate,
  operations,
  stock,
} from './operations'
import { daysBetween } from './timeOff'
import { isPeriodStart } from './rent'
import { cancelOrder, placeOrder, receiveOrder, saveSupplier } from './purchasing'
import { prepareAccountingExport } from './accounts'
import { RENT_LIMIT, RENT_PAYMENT_LIMIT } from './rentSchema'
import { restockReturn } from './retail'
import { assertSchedulePreserved, scheduleChanges, scheduleSnapshot } from './schedule'
import { isWaitlistOffer, staleOffer } from './waitlist'
import { otherLedgerRefund, otherLedgerReference, referenceTaken } from './references'

export function assertMethod(
  s: BusinessState,
  method: string,
  reference?: string,
  processor?: { provider: string; live: boolean },
) {
  const sandbox = operations(s).mode === 'sandbox'
  if (method === 'previous_system')
    throw new Error('A deposit paid to a previous system arrives only through a reviewed import.')
  if ((method === 'card') !== !!processor)
    throw new Error('Card payments are taken through the payment screen, not recorded by hand.')
  if (method === 'card' && !reference?.trim())
    throw new Error('A card payment needs the payment provider’s reference.')
  if (sandbox !== method.startsWith('demo_'))
    throw new Error(
      sandbox
        ? 'Use a simulated payment method in the sample workspace.'
        : 'Record a cash or external terminal payment in this workspace.',
    )
  if (method === 'external_card' && !reference?.trim())
    throw new Error(
      'Enter the external terminal receipt reference. SALEANE has not charged the card.',
    )
}
/** How a recorded payment reached the studio, in plain words for the client's timeline. */
export function paymentDetail(method: string, processor?: { provider: string; live: boolean }) {
  if (processor)
    return processor.live
      ? 'Paid by card through the payment provider.'
      : 'Test card payment: the provider is in test mode and no money moved.'
  return `Payment recorded as ${method === 'cash' ? 'cash received' : 'already paid at an external terminal'}. SALEANE did not process a payment.`
}
export function runOperatingCommand(
  next: BusinessState,
  command: OperatingCommand,
  now: string,
  makeId: () => string,
  addEvent: (
    event: Omit<RelationshipEvent, 'id' | 'organisationId' | 'occurredAt' | 'actor'>,
  ) => void,
) {
  const scheduling = [
    'hours',
    'closure',
    'remove-closure',
    'staff',
    'resource',
    'time-off',
    'cancel-time-off',
  ].includes(command.type)
  // Guest notes change only text guests read; an empty note removes it.
  if (command.type === 'guest-notes') {
    const services = command.prepNotes.map(({ serviceId, note }) => {
      const service = next.services.find((item) => item.id === serviceId)
      if (!service) throw new Error('Service does not belong to this workspace.')
      return { service, note }
    })
    const aftercare = (command.aftercareNotes ?? []).map(({ serviceId, note }) => {
      const service = next.services.find((item) => item.id === serviceId)
      if (!service) throw new Error('Service does not belong to this workspace.')
      return { service, note }
    })
    if (command.arrivalNote) next.organisation.arrivalNote = command.arrivalNote
    else delete next.organisation.arrivalNote
    for (const { service, note } of services) {
      if (note) service.prepNote = note
      else delete service.prepNote
    }
    for (const { service, note } of aftercare) {
      if (note) service.aftercareNote = note
      else delete service.aftercareNote
    }
    return next.organisation.id
  }
  // Taken before any change so the schedule check and its history compare like with like.
  const before = scheduling ? scheduleSnapshot(next) : next
  next.operations = structuredClone(operations(next))
  const o = next.operations,
    scope = { organisationId: next.organisation.id }
  let recordId = ''
  if (command.type === 'organisation') {
    if (
      command.timeZone !== next.organisation.timeZone &&
      next.appointments.some((a) => ['confirmed', 'arrived'].includes(a.status))
    )
      throw new Error('Resolve upcoming appointments before changing the venue time zone.')
    Object.assign(next.organisation, {
      name: command.name,
      locationName: command.locationName,
      address: command.address,
      timeZone: command.timeZone,
    })
    o.bookingEnabled = command.bookingEnabled
    if (command.botCheck !== undefined) o.botCheck = command.botCheck
    if (command.reviewUrl !== undefined) {
      if (!command.reviewUrl) delete next.organisation.reviewUrl
      else if (!isReviewUrl(command.reviewUrl))
        throw new Error('Enter the review page as a full web address starting with https://.')
      else next.organisation.reviewUrl = command.reviewUrl
    }
    recordId = next.organisation.id
  } else if (command.type === 'hours') {
    o.hours = command.hours
    recordId = next.organisation.locationId
  } else if (command.type === 'closure') {
    const closure = { ...command.input, id: makeId() }
    o.closures.push(closure)
    recordId = closure.id
  } else if (command.type === 'time-off') {
    const { staffId, from, to } = command.input
    if (!next.staff.some((p) => p.id === staffId && !p.archived))
      throw new Error('Choose someone on the team.')
    if (daysBetween(from, to) + 1 > TIME_OFF_DAYS)
      throw new Error(`Record up to ${TIME_OFF_DAYS} days at a time.`)
    o.timeOff ??= []
    if (o.timeOff.length >= TIME_OFF_LIMIT) throw new Error('Too much time off to keep.')
    if (
      o.timeOff.some((t) => !t.cancelledAt && t.staffId === staffId && t.from <= to && t.to >= from)
    )
      throw new Error('This overlaps time off already recorded for them.')
    const away = {
      id: makeId(),
      staffId,
      from,
      to,
      kind: command.input.kind,
      ...(command.input.note ? { note: command.input.note } : {}),
      createdAt: now,
      actor: 'Local operator',
    }
    o.timeOff.push(away)
    recordId = away.id
  } else if (command.type === 'cancel-time-off') {
    const away = o.timeOff?.find((t) => t.id === command.timeOffId)
    if (!away) throw new Error('Time off not found.')
    if (away.cancelledAt) throw new Error('This time off is already cancelled.')
    away.cancelledAt = now
    away.cancelledBy = 'Local operator'
    recordId = away.id
  } else if (command.type === 'leave-allowance') {
    if (!next.staff.some((p) => p.id === command.staffId))
      throw new Error('Choose someone on the team.')
    o.leaveAllowances = [
      ...(o.leaveAllowances ?? []).filter((a) => a.staffId !== command.staffId),
      { staffId: command.staffId, days: command.days },
    ]
    recordId = command.staffId
  } else if (command.type === 'remove-closure') {
    if (!o.closures.some((c) => c.id === command.closureId)) throw new Error('Closure not found.')
    o.closures = o.closures.filter((c) => c.id !== command.closureId)
    recordId = command.closureId
  } else if (
    command.type === 'service' ||
    command.type === 'staff' ||
    command.type === 'resource'
  ) {
    const rows =
      command.type === 'service'
        ? next.services
        : command.type === 'staff'
          ? next.staff
          : next.resources
    const old = command.id ? rows.find((r) => r.id === command.id) : undefined
    if (command.id && !old) throw new Error('Record does not belong to this workspace.')
    const record = { ...command.input, ...scope, id: command.id ?? makeId() }
    if (command.type === 'service') {
      if (command.input.depositMinor > command.input.priceMinor)
        throw new Error('Deposit cannot exceed the service price.')
      if (command.input.durationMinutes + command.input.bufferMinutes > 1440)
        throw new Error('A service must fit within one day.')
      const { returnWeeks, ...input } = command.input
      const weeks = returnWeeks ? { returnWeeks } : {}
      if (old) {
        Object.assign(old, { ...input, ...weeks, ...scope, id: record.id })
        if (returnWeeks === null) delete (old as { returnWeeks?: number }).returnWeeks
      } else next.services.push({ ...input, ...weeks, ...scope, id: record.id })
    } else if (command.type === 'staff') {
      if (old) {
        Object.assign(old, record)
        // Without hours of their own, a professional follows the venue opening hours.
        if (!command.input.hours) delete (old as { hours?: unknown }).hours
      } else next.staff.push({ ...command.input, ...scope, id: record.id })
    } else {
      if (old) {
        Object.assign(old, record)
        // The form sends every field, so no resting time means None.
        if (!command.input.restMinutes) delete (old as { restMinutes?: number }).restMinutes
      } else next.resources.push({ ...command.input, ...scope, id: record.id })
    }
    recordId = record.id
  }
  if (
    command.type === 'organisation' ||
    command.type === 'hours' ||
    command.type === 'closure' ||
    command.type === 'remove-closure' ||
    command.type === 'service' ||
    command.type === 'staff' ||
    command.type === 'resource' ||
    command.type === 'time-off' ||
    command.type === 'cancel-time-off' ||
    command.type === 'leave-allowance'
  ) {
    if (scheduling) {
      // Removing time away only frees time, so it can never strand a visit.
      if (command.type !== 'remove-closure' && command.type !== 'cancel-time-off')
        assertSchedulePreserved(before, next, now)
      const entries = scheduleChanges(before, next, command, recordId).map((entry) => ({
        ...entry,
        id: makeId(),
        occurredAt: now,
        actor: o.mode === 'sandbox' ? 'Maya · demo operator' : 'Local operator',
      }))
      if (entries.length)
        o.scheduleHistory = [...(o.scheduleHistory ?? []), ...entries].slice(
          -SCHEDULE_HISTORY_LIMIT,
        )
    }
    return recordId
  }
  if (command.type === 'tax') {
    o.tax = { label: command.label, rateBps: command.rateBps, inclusive: command.inclusive }
    recordId = next.organisation.id
  } else if (command.type === 'reminders') {
    o.reminders = { ...command.settings }
    recordId = next.organisation.id
  } else if (command.type === 'contact-preferences') {
    const client = next.clients.find((c) => c.id === command.clientId)
    if (!client) throw new Error('Client does not belong to this workspace.')
    const was = { email: !client.noEmailReminders, sms: !client.noTextReminders }
    if (command.email) delete client.noEmailReminders
    else client.noEmailReminders = true
    if (command.sms) delete client.noTextReminders
    else client.noTextReminders = true
    if (was.email !== command.email || was.sms !== command.sms)
      addEvent({
        clientId: client.id,
        type: 'consent',
        title: 'Appointment messages updated',
        detail: `Appointment emails ${command.email ? 'on' : 'off'}, texts ${command.sms ? 'on' : 'off'}. Marketing preference unchanged.`,
      })
    recordId = client.id
  } else if (command.type === 'message') {
    const client = next.clients.find((c) => c.id === command.input.clientId)
    if (!client) throw new Error('Client does not belong to this workspace.')
    if (
      command.input.appointmentId &&
      !next.appointments.some(
        (a) => a.id === command.input.appointmentId && a.clientId === client.id,
      )
    )
      throw new Error('Choose an appointment belonging to this client.')
    const old = command.id ? o.messages.find((m) => m.id === command.id) : undefined
    if (command.id && !old) throw new Error('Message does not belong to this workspace.')
    if (old?.status === 'queued') throw new Error('A queued message cannot be edited.')
    // An offer is checked against the time it names, so its wording is not changed by hand.
    if (old && isWaitlistOffer(next, old.id))
      throw new Error('A waitlist offer cannot be edited. Write a new one from the waitlist.')
    if (old && (old.clientId !== command.input.clientId || old.purpose !== command.input.purpose))
      throw new Error('Keep the client and purpose of an existing draft unchanged.')
    if (command.input.purpose === 'marketing' && command.input.channel === 'sms')
      throw new Error('Email news goes by email only. Choose email for a marketing message.')
    const message = {
      ...command.input,
      id: command.id ?? makeId(),
      status: 'draft' as const,
      createdAt: old?.createdAt ?? now,
      actor: old?.actor ?? 'Local operator',
    }
    if (old) Object.assign(old, message)
    else o.messages.push(message)
    recordId = message.id
    // V1.5: written and approved in one step from the inbox.
    if (command.approve) approveMessage(next, old ?? o.messages[o.messages.length - 1], now)
    addEvent({
      clientId: client.id,
      appointmentId: command.input.appointmentId,
      type: 'message',
      title: 'Message drafted',
      detail: `${command.input.subject}. Saved locally; delivery is unconfigured.`,
    })
  } else if (command.type === 'message-queue') {
    const message = o.messages.find((m) => m.id === command.messageId)
    if (!message) throw new Error('Message does not belong to this workspace.')
    approveMessage(next, message, now)
    recordId = message.id
  } else if (command.type === 'deposit') {
    const a = next.appointments.find((a) => a.id === command.appointmentId)
    if (!a || !['confirmed', 'arrived'].includes(a.status))
      throw new Error('A deposit can be recorded only for an upcoming or arrived appointment.')
    assertMethod(next, command.method, command.reference, command.processor)
    const existing =
      command.reference &&
      next.payments.find(
        (p) =>
          p.appointmentId === a.id && p.kind === 'deposit' && p.reference === command.reference,
      )
    if (existing) {
      if (existing.amountMinor !== command.amountMinor || existing.method !== command.method)
        throw new Error('This reference already records a different payment.')
      return existing.id
    }
    if (referenceTaken(next, command.reference))
      throw new Error('This payment reference is already recorded for another payment.')
    const paid = next.payments
      .filter((p) => p.appointmentId === a.id && p.kind === 'deposit')
      .reduce((sum, p) => sum + p.amountMinor, 0)
    if (paid + command.amountMinor > a.bookedDepositMinor)
      throw new Error('The recorded deposit would exceed the booked deposit requirement.')
    const payment = {
      ...scope,
      id: makeId(),
      appointmentId: a.id,
      kind: 'deposit' as const,
      amountMinor: command.amountMinor,
      currency: next.organisation.currency,
      recordedAt: now,
      method: command.method,
      reference: command.reference,
      ...(command.processor ? { processor: command.processor } : {}),
    }
    next.payments.push(payment)
    recordId = payment.id
    addEvent({
      clientId: a.clientId,
      appointmentId: a.id,
      type: 'deposit',
      title: command.processor ? 'Deposit paid by card' : 'Deposit recorded',
      detail:
        o.mode === 'sandbox'
          ? 'Simulated deposit recorded. No money collected.'
          : paymentDetail(command.method, command.processor),
    })
  } else if (command.type === 'fee') {
    const a = next.appointments.find((a) => a.id === command.appointmentId)
    if (!a || !['no_show', 'cancelled'].includes(a.status))
      throw new Error('A fee applies only to a missed or cancelled visit.')
    assertMethod(next, command.method, command.reference, command.processor)
    if (otherLedgerReference(next, command.reference))
      throw new Error('This payment reference is already recorded for another payment.')
    if (command.reference && next.payments.some((p) => p.reference === command.reference)) {
      const existing = next.payments.find(
        (p) => p.appointmentId === a.id && p.kind === 'fee' && p.reference === command.reference,
      )
      if (!existing || existing.amountMinor !== command.amountMinor)
        throw new Error('This payment reference is already recorded for another payment.')
      return existing.id
    }
    const taken = next.payments
      .filter((p) => p.appointmentId === a.id && p.kind !== 'settlement')
      .reduce((sum, p) => sum + p.amountMinor, 0)
    if (taken + command.amountMinor > a.bookedPriceMinor)
      throw new Error('The fee and deposit together cannot exceed the booked price.')
    const payment = {
      ...scope,
      id: makeId(),
      appointmentId: a.id,
      kind: 'fee' as const,
      amountMinor: command.amountMinor,
      currency: next.organisation.currency,
      recordedAt: now,
      method: command.method,
      reference: command.reference,
      ...(command.processor ? { processor: command.processor } : {}),
    }
    next.payments.push(payment)
    recordId = payment.id
    addEvent({
      clientId: a.clientId,
      appointmentId: a.id,
      type: 'deposit',
      title: a.status === 'no_show' ? 'No-show fee taken' : 'Late cancellation fee taken',
      detail:
        o.mode === 'sandbox'
          ? 'Simulated fee recorded. No money collected.'
          : paymentDetail(command.method, command.processor),
    })
  } else if (command.type === 'protection') {
    o.protection = { ...command.settings }
    recordId = next.organisation.id
  } else if (command.type === 'refund' && command.counterSaleId) {
    // V2: money back for products sold without a visit, with any products put back on the shelf.
    if (command.saleId || command.paymentId) throw new Error('Choose one receipt to refund.')
    const sale = (next.counterSales ?? []).find((x) => x.id === command.counterSaleId)
    if (!sale) throw new Error('Receipt does not belong to this workspace.')
    const existing = o.refunds.find(
      (r) => r.counterSaleId === sale.id && r.reference === command.reference,
    )
    if (existing) {
      if (existing.amountMinor !== command.amountMinor)
        throw new Error('This reference already records a different refund.')
      return existing.id
    }
    if (o.refunds.some((r) => r.reference === command.reference))
      throw new Error('This refund reference already belongs to another receipt.')
    if (
      o.refunds
        .filter((r) => r.counterSaleId === sale.id)
        .reduce((sum, r) => sum + r.amountMinor, 0) +
        command.amountMinor >
      sale.totalMinor
    )
      throw new Error('This refund would exceed the remaining receipt total.')
    if (command.processor || command.method === 'card')
      throw new Error('Return walk-in sales in cash or on your own card terminal.')
    const method = command.method ?? sale.method
    assertMethod(next, method, command.reference)
    const refund = {
      id: makeId(),
      counterSaleId: sale.id,
      amountMinor: command.amountMinor,
      reason: command.reason,
      reference: command.reference,
      method,
      createdAt: now,
      actor: 'Local operator',
    }
    o.refunds.push(refund)
    if (command.restock?.length)
      restockReturn(next, sale.id, refund.id, command.restock, now, makeId)
    recordId = refund.id
    if (sale.clientId)
      addEvent({
        clientId: sale.clientId,
        type: 'refund',
        title: o.mode === 'sandbox' ? 'Simulated refund recorded' : 'External refund recorded',
        detail: `${command.reason}. Receipt ${sale.receiptNumber}. Reference ${command.reference}. This record did not transfer funds.`,
      })
  } else if (command.type === 'refund') {
    if (!!command.saleId === !!command.paymentId)
      throw new Error('Choose the receipt or the payment being refunded.')
    const sale = command.saleId ? next.sales.find((s) => s.id === command.saleId) : undefined
    const paid = command.paymentId
      ? next.payments.find((p) => p.id === command.paymentId && p.kind !== 'settlement')
      : undefined
    if (!sale && !paid) throw new Error('Receipt does not belong to this workspace.')
    // A deposit still counts toward the visit's checkout, so it is returned only once it is off.
    if (
      paid?.kind === 'deposit' &&
      next.appointments.find((a) => a.id === paid.appointmentId)?.status !== 'cancelled'
    )
      throw new Error('Refund a deposit after the visit is cancelled.')
    const same = (r: { saleId?: string; paymentId?: string }) =>
      sale ? r.saleId === sale.id : r.paymentId === paid!.id
    const existing = o.refunds.find((r) => same(r) && r.reference === command.reference)
    if (existing) {
      if (existing.amountMinor !== command.amountMinor)
        throw new Error('This reference already records a different refund.')
      return existing.id
    }
    if (
      o.refunds.some((r) => r.reference === command.reference) ||
      otherLedgerRefund(next, command.reference)
    )
      throw new Error('This refund reference already belongs to another receipt.')
    if (
      o.refunds.filter(same).reduce((sum, r) => sum + r.amountMinor, 0) + command.amountMinor >
      (sale
        ? // A plan's or gift card's share was never paid at the desk, so it cannot go back as money.
          sale.totalMinor - (sale.coveredMinor ?? 0) - (sale.giftCardMinor ?? 0)
        : paid!.amountMinor)
    )
      throw new Error('This refund would exceed the remaining receipt total.')
    if (command.method) assertMethod(next, command.method, command.reference, command.processor)
    else if (command.processor) throw new Error('A card refund names its method.')
    const refund = {
      id: makeId(),
      ...(sale ? { saleId: sale.id } : { paymentId: paid!.id }),
      amountMinor: command.amountMinor,
      reason: command.reason,
      reference: command.reference,
      ...(command.method ? { method: command.method } : {}),
      ...(command.processor ? { processor: command.processor } : {}),
      createdAt: now,
      actor: 'Local operator',
    }
    o.refunds.push(refund)
    if (command.restock?.length) {
      if (!sale) throw new Error('Only products on a receipt can come back.')
      restockReturn(next, sale.id, refund.id, command.restock, now, makeId)
    }
    recordId = refund.id
    const a = next.appointments.find((a) => a.id === (sale ?? paid)!.appointmentId)!
    addEvent({
      clientId: a.clientId,
      appointmentId: a.id,
      ...(sale ? { saleId: sale.id } : {}),
      type: 'refund',
      title:
        o.mode === 'sandbox'
          ? 'Simulated refund recorded'
          : command.processor
            ? 'Refunded to the card'
            : 'External refund recorded',
      detail: command.processor
        ? `${command.reason}. ${command.processor.live ? 'Returned by the payment provider' : 'Test refund: no money moved'}. Reference ${command.reference}.`
        : `${command.reason}. Reference ${command.reference}. This record did not transfer funds.`,
    })
  } else if (command.type === 'product') {
    const old = o.products.find((p) => p.id === command.id)
    if (command.id && !old) throw new Error('Product not found.')
    if (
      command.input.sku &&
      o.products.some(
        (p) => p.id !== command.id && p.sku.toLowerCase() === command.input.sku.toLowerCase(),
      )
    )
      throw new Error('This SKU already belongs to another product.')
    if (
      command.input.supplierId &&
      !(o.suppliers ?? []).some((x) => x.id === command.input.supplierId)
    )
      throw new Error('Choose a supplier from the list.')
    const product = { ...command.input, id: command.id ?? makeId() }
    // Replaced whole, so a cleared optional field such as the cost price really clears.
    if (old) o.products[o.products.indexOf(old)] = product
    else o.products.push(product)
    recordId = product.id
  } else if (command.type === 'accounting-settings') {
    o.accounting = command.settings
    recordId = next.organisation.id
  } else if (command.type === 'accounting-export') {
    recordId = prepareAccountingExport(next, command, now, makeId)
  } else if (command.type === 'supplier') {
    recordId = saveSupplier(next, command, makeId)
  } else if (command.type === 'purchase-order') {
    recordId = placeOrder(next, command, now, makeId).id
  } else if (command.type === 'receive-order') {
    recordId = receiveOrder(next, command, now, makeId)
  } else if (command.type === 'cancel-order') {
    recordId = cancelOrder(next, command.orderId, now)
  } else if (command.type === 'rental') {
    const { staffId, resourceId, space } = command.input
    if (!next.staff.some((p) => p.id === staffId && !p.archived))
      throw new Error('Choose someone on the team.')
    const resource = resourceId && next.resources.find((r) => r.id === resourceId)
    if (resourceId && (!resource || resource.archived))
      throw new Error('Choose a chair or room that is in use.')
    if (resource && resource.type !== (space === 'chair' ? 'chair' : 'treatment'))
      throw new Error(`That is not a ${space}.`)
    if (
      (o.rentals ?? []).some((r) => r.staffId === staffId && (!r.to || r.to >= command.input.from))
    )
      throw new Error('They already have a rental. End it before starting another.')
    o.rentals ??= []
    if (o.rentals.length >= RENT_LIMIT) throw new Error('Too many rentals to keep.')
    const rental = {
      id: makeId(),
      ...command.input,
      createdAt: now,
      actor: 'Local operator',
    }
    o.rentals.push(rental)
    recordId = rental.id
  } else if (command.type === 'end-rental') {
    const rental = o.rentals?.find((r) => r.id === command.rentalId)
    if (!rental) throw new Error('Rental not found.')
    if (rental.to) throw new Error('This rental has already ended.')
    if (command.to < rental.from) throw new Error('The last day cannot be before it started.')
    if ((o.rentPayments ?? []).some((p) => p.rentalId === rental.id && p.periodStart > command.to))
      throw new Error('Rent is already recorded after that day.')
    rental.to = command.to
    recordId = rental.id
  } else if (command.type === 'rent-payment') {
    const rental = o.rentals?.find((r) => r.id === command.rentalId)
    if (!rental) throw new Error('Rental not found.')
    if (!isPeriodStart(rental, command.periodStart))
      throw new Error('Choose one of the rent periods.')
    if (command.periodStart > businessDate(next, now)) throw new Error('That rent is not due yet.')
    const paid = (o.rentPayments ?? [])
      .filter((p) => p.rentalId === rental.id && p.periodStart === command.periodStart)
      .reduce((sum, p) => sum + p.amountMinor, 0)
    if (paid + command.amountMinor > rental.amountMinor)
      throw new Error(
        `Only ${rental.amountMinor - paid > 0 ? 'the rest of the rent' : 'nothing more'} is due for that period.`,
      )
    if (command.method !== 'cash' && !command.reference?.trim())
      throw new Error('Enter the transfer or terminal reference.')
    o.rentPayments ??= []
    if (o.rentPayments.length >= RENT_PAYMENT_LIMIT)
      throw new Error('Too many rent payments to keep.')
    const payment = {
      id: makeId(),
      rentalId: rental.id,
      periodStart: command.periodStart,
      amountMinor: command.amountMinor,
      method: command.method,
      ...(command.reference?.trim() ? { reference: command.reference.trim() } : {}),
      paidAt: now,
      actor: 'Local operator',
    }
    o.rentPayments.push(payment)
    recordId = payment.id
  } else if (command.type === 'pay-rules') {
    o.payRules ??= []
    if (o.payRules.length >= PAY_RULES_LIMIT)
      throw new Error('Too many pay setting changes to keep.')
    const rules = { id: makeId(), ...command.rules, createdAt: now, actor: 'Local operator' }
    o.payRules.push(rules)
    recordId = rules.id
  } else if (command.type === 'pay-rate') {
    if (!next.staff.some((p) => p.id === command.staffId))
      throw new Error('Choose someone on the team.')
    o.payRates ??= []
    if (o.payRates.length >= PAY_RATE_LIMIT) throw new Error('Too many pay rate changes to keep.')
    const rate = {
      id: makeId(),
      staffId: command.staffId,
      serviceBps: command.serviceBps,
      productBps: command.productBps,
      from: command.from,
      createdAt: now,
      actor: 'Local operator',
    }
    o.payRates.push(rate)
    recordId = rate.id
  } else if (command.type === 'stock') {
    const product = o.products.find((p) => p.id === command.productId)
    if (!product || product.archived) throw new Error('Choose an active product.')
    if (command.reason === 'received' && command.quantity < 0)
      throw new Error('Received stock must increase the quantity.')
    if (['consumed', 'retail'].includes(command.reason) && command.quantity > 0)
      throw new Error('Usage and retail movements must reduce the quantity.')
    if (stock(next, product.id) + command.quantity < 0)
      throw new Error('There is not enough stock for this movement.')
    const movement = {
      id: makeId(),
      productId: product.id,
      quantity: command.quantity,
      reason: command.reason,
      note: command.note,
      appointmentId: command.appointmentId,
      createdAt: now,
      actor: 'Local operator',
    }
    o.movements.push(movement)
    recordId = movement.id
  } else if (command.type === 'client-birthday') {
    const client = next.clients.find((c) => c.id === command.clientId)
    if (!client) throw new Error('Client does not belong to this workspace.')
    // Saving the same date again changes nothing and adds nothing to the timeline.
    if ((client.birthday ?? null) !== command.birthday) {
      if (command.birthday) client.birthday = command.birthday
      else delete client.birthday
      addEvent({
        clientId: client.id,
        type: 'profile',
        title: command.birthday ? 'Birthday recorded' : 'Birthday removed',
        detail: 'Month and day only.',
      })
    }
    recordId = client.id
  } else if (command.type === 'client-edit') {
    const client = next.clients.find((c) => c.id === command.clientId)
    if (!client) throw new Error('Client does not belong to this workspace.')
    if (!/^\+[\d() -]{6,29}$/.test(command.contact.phone.trim()))
      throw new Error('Enter a telephone number starting with + and a country code.')
    const consentChanged = client.marketingConsent !== command.contact.marketingConsent
    Object.assign(client, {
      ...command.contact,
      name: command.contact.name.trim(),
      email: command.contact.email.trim().toLowerCase(),
      phone: command.contact.phone.trim(),
      preferences: command.preferences,
    })
    if (!client.marketingConsent)
      o.messages
        .filter(
          (m) => m.clientId === client.id && m.purpose === 'marketing' && m.status === 'queued',
        )
        .forEach((m) => {
          m.status = 'suppressed'
        })
    addEvent({
      clientId: client.id,
      type: 'profile',
      title: 'Client details updated',
      detail: 'Ordinary contact details and preferences updated.',
    })
    if (consentChanged)
      addEvent({
        clientId: client.id,
        type: 'consent',
        title: client.marketingConsent ? 'Email marketing enabled' : 'Email marketing withdrawn',
        detail: 'Marketing preference recorded. No message delivered.',
      })
    recordId = client.id
  } else if (command.type === 'import-clients') {
    const batch = {
      id: makeId(),
      kind: 'clients' as const,
      source: command.source || 'Reviewed contact file',
      createdAt: now,
      actor: 'Local operator',
      recordIds: [] as string[],
      totalMinor: 0,
    }
    for (const contact of command.contacts) {
      if (contact.marketingConsent)
        throw new Error(
          'Import contacts with marketing off. Record verified consent individually after import.',
        )
      if (!/^\+[\d() -]{6,29}$/.test(contact.phone.trim()))
        throw new Error('Every imported telephone number needs a country code.')
      const email = contact.email.trim().toLowerCase(),
        name = contact.name.trim()
      if (
        next.clients.some(
          (c) => c.email.toLowerCase() === email && c.name.toLowerCase() === name.toLowerCase(),
        )
      )
        throw new Error(
          'Import contains an existing or repeated client. Review duplicates before importing.',
        )
      const client = {
        ...contact,
        ...scope,
        id: makeId(),
        name,
        email,
        phone: contact.phone.trim(),
        preferences: '',
        createdAt: now,
      }
      next.clients.push(client)
      addEvent({
        clientId: client.id,
        type: 'profile',
        title: 'Client imported after review',
        detail: `Source: ${command.source ?? 'Reviewed contact file'}. Contact details imported. Marketing remains off; no historical visits or payment details imported.`,
      })
      batch.recordIds.push(client.id)
      recordId = client.id
    }
    // PILOT-03: logged with the other imports so the switch can be checked in one place.
    o.imports = [...(o.imports ?? []), batch]
  }
  return recordId
}

type DraftMessage = NonNullable<BusinessState['operations']>['messages'][number]
/** Approves a draft for the outbox, after checking it may go and has somewhere to go. */
function approveMessage(next: BusinessState, message: DraftMessage, now: string) {
  const stale = staleOffer(next, message.id, now)
  if (stale) throw new Error(stale)
  if (
    message.purpose === 'marketing' &&
    !next.clients.find((c) => c.id === message.clientId)?.marketingConsent
  )
    throw new Error(
      'This client has not consented to email marketing. Appointment updates are a separate purpose.',
    )
  if (message.approvedAt) throw new Error('This message is already approved.')
  // V1.5: the outbox sends it, so it needs somewhere to go now.
  const to = next.clients.find((c) => c.id === message.clientId)!
  if (
    message.channel === 'sms'
      ? !/^\+[1-9]\d{7,14}$/.test(to.phone.replace(/[\s().-]/g, ''))
      : !to.email.trim()
  )
    throw new Error(
      message.channel === 'sms'
        ? 'This client has no mobile number with its country code. Add one, or send by email.'
        : 'This client has no email address. Add one, or send by text.',
    )
  message.status = 'queued'
  message.approvedAt = now
}
