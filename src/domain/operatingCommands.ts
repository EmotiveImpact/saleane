import type { BusinessState, RelationshipEvent } from './model'
import type { OperatingCommand } from './commandSchema'
import { SCHEDULE_HISTORY_LIMIT, operations, stock } from './operations'
import { assertSchedulePreserved, scheduleChanges, scheduleSnapshot } from './schedule'
import { withdrawnOffer } from './waitlist'

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
  const scheduling = ['hours', 'closure', 'remove-closure', 'staff', 'resource'].includes(
    command.type,
  )
  // Guest notes change only text guests read; an empty note removes it.
  if (command.type === 'guest-notes') {
    const services = command.prepNotes.map(({ serviceId, note }) => {
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
    recordId = next.organisation.id
  } else if (command.type === 'hours') {
    o.hours = command.hours
    recordId = next.organisation.locationId
  } else if (command.type === 'closure') {
    const closure = { ...command.input, id: makeId() }
    o.closures.push(closure)
    recordId = closure.id
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
      if (old) Object.assign(old, record)
      else next.services.push({ ...command.input, ...scope, id: record.id })
    } else if (command.type === 'staff') {
      if (old) {
        Object.assign(old, record)
        // Without hours of their own, a professional follows the venue opening hours.
        if (!command.input.hours) delete (old as { hours?: unknown }).hours
      } else next.staff.push({ ...command.input, ...scope, id: record.id })
    } else {
      if (old) Object.assign(old, record)
      else next.resources.push({ ...command.input, ...scope, id: record.id })
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
    command.type === 'resource'
  ) {
    if (scheduling) {
      // Removing time away only frees time, so it can never strand a visit.
      if (command.type !== 'remove-closure') assertSchedulePreserved(before, next, now)
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
    if (old && (old.clientId !== command.input.clientId || old.purpose !== command.input.purpose))
      throw new Error('Keep the client and purpose of an existing draft unchanged.')
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
    if (withdrawnOffer(next, message.id))
      throw new Error('This waitlist offer was withdrawn when the request ended.')
    if (
      message.purpose === 'marketing' &&
      !next.clients.find((c) => c.id === message.clientId)?.marketingConsent
    )
      throw new Error(
        'This client has not consented to email marketing. Appointment updates are a separate purpose.',
      )
    message.status = 'queued'
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
    if (command.reference && next.payments.some((p) => p.reference === command.reference))
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
    if (o.refunds.some((r) => r.reference === command.reference))
      throw new Error('This refund reference already belongs to another receipt.')
    if (
      o.refunds.filter(same).reduce((sum, r) => sum + r.amountMinor, 0) + command.amountMinor >
      (sale ? sale.totalMinor - (sale.coveredMinor ?? 0) : paid!.amountMinor)
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
    const product = { ...command.input, id: command.id ?? makeId() }
    if (old) Object.assign(old, product)
    else o.products.push(product)
    recordId = product.id
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
