import { z } from 'zod'
import { parseState } from './model'
import { businessDate, operations, visitTax } from './operations'
import { placeOf, serviceAt, staffLocationOn } from './locations'
import { bookingSchema, commandSchema, contactSchema } from './commandSchema'
import type { Command, ContactInput } from './commandSchema'
import { assertMethod, paymentDetail, runOperatingCommand } from './operatingCommands'
import { runGroupCommand } from './group'
import { runApprovalCommand, stampRequestActors } from './approvals'
import { runBrandCommand } from './brandRules'
import { runTillCommand } from './till'
import { branchVisitUnchanged, runBranchVisitCommand, stampBranchVisitActors } from './branchVisits'
import { channelLabel } from './bookingChannel'
import { checkoutTotals } from './money'
import { recordTillCount } from './tillCount'
export { commandSchema } from './commandSchema'
export type { Command, BookingInput, ContactInput } from './commandSchema'
import type { Appointment, BusinessState, RelationshipEvent } from './model'
import { dateLabel, money, timeLabel } from './format'
import { availableAllocation } from './allocation'
import { runSwitchingCommand } from './switching'
import { coverVisit, runPlanCommand, stampPlanActors } from './plans'
import { runGiftCardCommand, spendGiftCard, stampGiftCardActors } from './giftCards'
import {
  patchTestBlocksVisit,
  repeatedPatchResult,
  runPatchTestCommand,
  stampPatchTestActors,
} from './patchTests'
import { referenceTaken } from './references'
import { recordFeedback, repeatedFeedback } from './feedback'
import { repeatedFormAnswer, runFormCommand, stampFormActors } from './forms'
import {
  consentUnchanged,
  recordConsentChanges,
  runConsentCommand,
  stampConsentActors,
} from './consent'
import {
  consultationForBooking,
  runConsultationCommand,
  stampConsultationActors,
  unchangedConsultation,
} from './consultations'
import { inboxUnchanged, runInboxCommand, stampInboxActors } from './inbox'
import { guestHereWindow } from './guest'
import { callForBooking, linkCallToVisit, markCalledBack, recordMissedCall } from './missedCalls'
import { planSpecial, stopSpecial } from './specials'
import { addTask, completeTask } from './tasks'
import { priceRetail, recordRetailMovements, retailCharge, sellAtCounter } from './retail'
import {
  closeForCancelledVisit,
  fillFromWaitlist,
  followMovedVisit,
  runWaitlistCommand,
  waitlistUnchanged,
} from './waitlist'

export type CommandResult =
  { ok: true; state: BusinessState; recordId: string } | { ok: false; error: string }

export function availableResource(
  s: BusinessState,
  serviceId: string,
  staffId: string,
  date: string,
  start: number,
  now = new Date().toISOString(),
  preferredResourceId?: string,
  locationId?: string,
) {
  const service = s.services.find((item) => item.id === serviceId)
  return service && !service.archived
    ? availableAllocation(
        s,
        serviceId,
        staffId,
        date,
        start,
        service.durationMinutes,
        service.bufferMinutes,
        service.resourceType,
        undefined,
        now,
        preferredResourceId,
        undefined,
        locationId,
      )
    : null
}
export function rescheduleResource(
  s: BusinessState,
  appointmentId: string,
  staffId: string,
  date: string,
  start: number,
  now = new Date().toISOString(),
  preferredResourceId?: string,
  /** V2: another location to move to. Absent keeps the visit where it is. */
  locationId?: string,
) {
  const appointment = s.appointments.find((item) => item.id === appointmentId)
  const resource = s.resources.find((item) => item.id === appointment?.resourceId)
  return appointment?.status === 'confirmed' && resource
    ? availableAllocation(
        s,
        appointment.serviceId,
        staffId,
        date,
        start,
        appointment.bookedDurationMinutes,
        appointment.bookedBufferMinutes,
        appointment.bookedResourceType ?? resource.type,
        appointment.id,
        now,
        preferredResourceId,
        undefined,
        // A visit moves to another time at the same location unless another is chosen.
        locationId ?? appointment.locationId,
      )
    : null
}
export function rescheduleSlots(
  s: BusinessState,
  appointmentId: string,
  staffId: string,
  date: string,
  now = new Date().toISOString(),
  locationId?: string,
) {
  const options: number[] = []
  for (let start = 0; start < 1440; start += 15)
    if (rescheduleResource(s, appointmentId, staffId, date, start, now, undefined, locationId))
      options.push(start)
  return options
}
export function slots(
  s: BusinessState,
  serviceId: string,
  staffId: string,
  date: string,
  now = new Date().toISOString(),
  locationId?: string,
) {
  const options: number[] = []
  for (let start = 0; start < 1440; start += 15)
    if (
      staffId === 'any'
        ? availableProfessionals(s, serviceId, date, start, now, locationId).length > 0
        : availableResource(s, serviceId, staffId, date, start, now, undefined, locationId)
    )
      options.push(start)
  return options
}
export function availableProfessionals(
  s: BusinessState,
  serviceId: string,
  date: string,
  start: number,
  now = new Date().toISOString(),
  locationId?: string,
) {
  return s.staff.filter((person) =>
    availableResource(s, serviceId, person.id, date, start, now, undefined, locationId),
  )
}
export function depositPaid(s: BusinessState, appointmentId: string) {
  return s.payments
    .filter((p) => p.appointmentId === appointmentId && p.kind === 'deposit')
    .reduce((sum, p) => sum + p.amountMinor, 0)
}

/** Server-only settings that never come from a request body. */
export type ExecuteOptions = {
  /** A card payment held this gift card share on this business day; judge expiry as of then. */
  giftCardAsOf?: string
}

export function execute(
  s: BusinessState,
  rawCommand: Command,
  now = new Date().toISOString(),
  makeId: () => string = () => crypto.randomUUID(),
  options: ExecuteOptions = {},
): CommandResult {
  try {
    const command = commandSchema.parse(rawCommand)
    if (command.type === 'batch') {
      let current = s
      let recordId = ''
      for (const part of command.commands) {
        const result = execute(current, part as Command, now, makeId)
        if (!result.ok) return result
        current = result.state
        recordId = result.recordId
      }
      if (current === s) return { ok: true, state: s, recordId }
      return {
        ok: true,
        state: parseState({ ...current, revision: s.revision + 1 }, s.organisation.region),
        recordId,
      }
    }
    const next = structuredClone(s)
    const org = s.organisation
    const addEvent = (
      event: Omit<RelationshipEvent, 'id' | 'organisationId' | 'occurredAt' | 'actor'>,
    ) => {
      next.events.push({
        ...event,
        id: makeId(),
        organisationId: org.id,
        occurredAt: now,
        actor: operations(s).mode === 'sandbox' ? 'Maya · demo operator' : 'Local operator',
      })
    }
    const createClient = (contact: ContactInput) => {
      const clean = contactSchema.parse({
        ...contact,
        name: contact.name.trim(),
        email: contact.email.trim().toLowerCase(),
        phone: contact.phone.trim(),
      })
      if (!/^\+[\d() -]{6,29}$/.test(clean.phone))
        throw new Error('Enter a valid telephone number starting with + and a country code.')
      const client = {
        ...clean,
        id: makeId(),
        organisationId: org.id,
        createdAt: now,
        preferences: '',
      }
      next.clients.push(client)
      addEvent({
        clientId: client.id,
        type: 'consent',
        title: 'Client relationship opened',
        detail: clean.marketingConsent
          ? 'Email marketing consent recorded.'
          : 'Marketing stays off. Messages about their visits are separate.',
      })
      return client
    }
    let recordId = ''
    if (command.type === 'book') {
      const input = bookingSchema.parse(command.input)
      if (input.source === 'online' && !operations(s).bookingEnabled)
        throw new Error('Online booking is currently closed.')
      // Without a chosen location, the visit is wherever the person works that day.
      const chosenPlace = input.locationId
      const staffId =
        input.staffId === 'any'
          ? availableProfessionals(
              s,
              input.serviceId,
              input.date,
              input.startMinutes,
              now,
              chosenPlace,
            ).find(
              (person) =>
                !input.resourceId ||
                availableResource(
                  s,
                  input.serviceId,
                  person.id,
                  input.date,
                  input.startMinutes,
                  now,
                  input.resourceId,
                  chosenPlace,
                ),
            )?.id
          : input.staffId
      if (!staffId)
        throw new Error('That time is no longer available. Choose another time or professional.')
      const locationId = chosenPlace ?? staffLocationOn(s, staffId, input.date)
      const resourceId = availableResource(
        s,
        input.serviceId,
        staffId,
        input.date,
        input.startMinutes,
        now,
        input.resourceId,
        locationId,
      )
      if (!resourceId)
        throw new Error('That time is no longer available. Choose another time or professional.')
      const service = s.services.find((item) => item.id === input.serviceId)!
      let client = input.clientId
        ? next.clients.find((item) => item.id === input.clientId)
        : undefined
      if (input.clientId && !client) throw new Error('Client does not belong to this studio.')
      if (!client && input.contact) client = createClient(input.contact)
      if (!client) throw new Error('Choose a client or enter their details.')
      if (input.source === 'rebook' && !input.rebookedFromId)
        throw new Error('Rebooking requires a linked completed visit.')
      if (input.channel && input.source !== 'online')
        throw new Error('Only an online booking records where the guest came from.')
      if (input.rebookedFromId && input.source !== 'rebook')
        throw new Error('Use the rebooking workflow to link a previous visit.')
      if (input.rebookedFromId) {
        const previous = s.appointments.find((a) => a.id === input.rebookedFromId)
        if (!previous || previous.status !== 'completed' || previous.clientId !== client.id)
          throw new Error('Rebooking needs a completed visit for this client.')
      }
      if (input.callId) {
        if (input.source === 'online') throw new Error('Only the desk can book for a missed call.')
        callForBooking(s, input.callId, client.id)
      }
      if (input.consultationId && input.source === 'online')
        throw new Error('Only the studio can book from a consultation.')
      const consultation = input.consultationId
        ? consultationForBooking(s, input.consultationId, client.id, service.id)
        : undefined
      const appointment: Appointment = {
        id: makeId(),
        organisationId: org.id,
        locationId,
        clientId: client.id,
        serviceId: service.id,
        staffId,
        resourceId,
        date: input.date,
        startMinutes: input.startMinutes,
        status: 'confirmed',
        source: input.source,
        ...(input.channel ? { channel: input.channel } : {}),
        createdAt: now,
        rebookedFromId: input.rebookedFromId,
        bookedPriceMinor: serviceAt(service, locationId).priceMinor,
        bookedDepositMinor: service.depositMinor,
        bookedDurationMinutes: service.durationMinutes,
        bookedBufferMinutes: service.bufferMinutes,
        bookedResourceType: service.resourceType,
        bookedServiceName: service.name,
        bookedTax: operations(s).tax ?? null,
        ...(consultation ? { consultation } : {}),
      }
      next.appointments.push(appointment)
      // Simulated deposit receipt is deliberately separate from the service-price snapshot.
      if (operations(s).mode === 'sandbox' && service.depositMinor > 0)
        next.payments.push({
          id: makeId(),
          organisationId: org.id,
          appointmentId: appointment.id,
          kind: 'deposit',
          amountMinor: service.depositMinor,
          currency: org.currency,
          recordedAt: now,
          method: 'demo_card',
        })
      addEvent({
        clientId: client.id,
        appointmentId: appointment.id,
        type: 'booked',
        title: input.source === 'rebook' ? 'Next visit booked' : 'Visit booked',
        detail: `${service.name} · ${dateLabel(input.date, org.locale)} at ${timeLabel(input.startMinutes, org.locale)}. ${operations(s).mode === 'sandbox' ? 'Deposit simulated; no payment taken.' : 'No payment collected. Any required deposit remains outstanding.'}${input.channel ? ` Booked through your ${channelLabel(input.channel)} link.` : ''}${input.callId ? ' Booked when the studio called back after a missed call.' : ''}`,
      })
      if (input.waitlistId) fillFromWaitlist(next, input.waitlistId, appointment, now, 'book')
      if (input.callId) linkCallToVisit(next, input.callId, appointment.id, client.id, now)
      recordId = appointment.id
    } else if (
      command.type === 'reschedule' ||
      command.type === 'cancel' ||
      command.type === 'no-show'
    ) {
      const appointment = next.appointments.find((a) => a.id === command.appointmentId)
      if (!appointment) throw new Error('Visit does not belong to this studio.')
      if (command.type === 'reschedule') {
        if (appointment.status !== 'confirmed')
          throw new Error('Only an upcoming visit can be moved.')
        const input = z
          .object({
            date: z.iso.date(),
            staffId: z.string().min(1),
            startMinutes: z.number().int(),
          })
          .parse(command)
        const resourceId = rescheduleResource(
          s,
          appointment.id,
          input.staffId,
          input.date,
          input.startMinutes,
          now,
          command.resourceId,
          command.locationId,
        )
        if (!resourceId)
          throw new Error('That time is no longer available. Choose another time or professional.')
        const place = command.locationId ?? appointment.locationId
        const moved = place !== appointment.locationId
        if (
          appointment.date === input.date &&
          appointment.startMinutes === input.startMinutes &&
          appointment.staffId === input.staffId &&
          !moved &&
          (!command.resourceId || appointment.resourceId === resourceId)
        )
          return { ok: true, state: s, recordId: appointment.id }
        const from = {
          date: appointment.date,
          startMinutes: appointment.startMinutes,
          staffId: appointment.staffId,
          resourceId: appointment.resourceId,
          ...(moved ? { locationId: appointment.locationId } : {}),
        }
        const to = { ...input, resourceId, ...(moved ? { locationId: place } : {}) }
        Object.assign(appointment, to)
        // "I've arrived" was about the old time; a guest tells the desk again on the new day.
        if (from.date !== to.date || from.startMinutes !== to.startMinutes)
          delete appointment.guestHereAt
        addEvent({
          clientId: appointment.clientId,
          appointmentId: appointment.id,
          type: 'rescheduled',
          title: 'Visit moved',
          allocationChange: { from, to },
          detail: `${dateLabel(from.date, org.locale)} at ${timeLabel(from.startMinutes, org.locale)} with ${s.staff.find((person) => person.id === from.staffId)!.name}${moved ? ` at ${placeOf(s, from.locationId)?.name}` : ''} → ${dateLabel(to.date, org.locale)} at ${timeLabel(to.startMinutes, org.locale)} with ${s.staff.find((person) => person.id === to.staffId)!.name}${moved ? ` at ${placeOf(s, place)?.name}` : ''}. Booked treatment, price and deposit kept; no message sent.`,
        })
        if (command.waitlistId)
          fillFromWaitlist(next, command.waitlistId, appointment, now, 'move', from.date)
        followMovedVisit(s, next, appointment, now)
      } else {
        const status = command.type === 'cancel' ? 'cancelled' : 'no_show'
        if (appointment.status === status) return { ok: true, state: s, recordId: appointment.id }
        if (appointment.status !== 'confirmed')
          throw new Error('Only an upcoming visit can be changed this way.')
        if (status === 'no_show' && appointment.date > businessDate(s, now))
          throw new Error('A visit still to come cannot be marked as missed.')
        const reason = command.reason.trim()
        if (reason.length < 2 || reason.length > 300)
          throw new Error('Enter an operational reason between 2 and 300 characters.')
        appointment.status = status
        if (status === 'cancelled') closeForCancelledVisit(s, next, appointment.id, now)
        const paid = depositPaid(s, appointment.id)
        const deposit =
          command.type === 'cancel' && command.deposit && paid
            ? command.deposit === 'refund_due'
              ? `Deposit of ${money(paid, org, true)} flagged for refund under the 24-hour cancellation policy. No refund has been made; record it in Money once returned. No message sent.`
              : `Deposit of ${money(paid, org, true)} retained under the 24-hour cancellation policy. No fee, sale or message created.`
            : 'Deposit history retained for review. No refund, fee, sale or message created.'
        addEvent({
          clientId: appointment.clientId,
          appointmentId: appointment.id,
          type: status,
          title: status === 'cancelled' ? 'Visit cancelled' : 'Visit marked as missed',
          detail: `${reason}. ${deposit}`,
        })
      }
      recordId = appointment.id
    } else if (command.type === 'arrive' || command.type === 'checkout') {
      const appointment = next.appointments.find((a) => a.id === command.appointmentId)
      if (!appointment) throw new Error('Visit does not belong to this studio.')
      if (command.type === 'arrive') {
        if (appointment.status === 'arrived')
          return { ok: true, state: s, recordId: appointment.id }
        if (appointment.status !== 'confirmed' || appointment.date !== businessDate(s, now))
          throw new Error('Only a confirmed visit on the venue’s current day can arrive.')
        const blocked = patchTestBlocksVisit(s, appointment)
        if (blocked) throw new Error(blocked)
        appointment.status = 'arrived'
        addEvent({
          clientId: appointment.clientId,
          appointmentId: appointment.id,
          type: 'arrived',
          title: 'Welcomed to the studio',
          detail: 'Arrival recorded by the front desk.',
        })
        recordId = appointment.id
      } else {
        const existing = s.sales.find((sale) => sale.appointmentId === appointment.id)
        if (existing) return { ok: true, state: s, recordId: existing.id }
        if (appointment.status !== 'arrived')
          throw new Error('Welcome the client before completing checkout.')
        if (
          !Number.isInteger(command.tipMinor) ||
          command.tipMinor < 0 ||
          command.tipMinor > appointment.bookedPriceMinor * 2
        )
          throw new Error('Enter a tip of up to twice the treatment price.')
        assertMethod(s, command.method, command.reference, command.processor)
        if (referenceTaken(s, command.reference))
          throw new Error(
            'This payment reference is already recorded. Review the existing receipt.',
          )
        const deposit = depositPaid(s, appointment.id)
        if (deposit > appointment.bookedPriceMinor)
          throw new Error('The deposit is more than this treatment costs. Check the money records.')
        const saleId = makeId()
        // A plan pays its share of the visit; the rest of the booked price is the plan's saving.
        const plan = command.holdingId
          ? coverVisit(next, appointment, command.holdingId, deposit, saleId, now, makeId)
          : undefined
        if (plan && command.discountMinor)
          throw new Error('A visit paid by a plan takes no further discount.')
        const discount = plan
          ? appointment.bookedPriceMinor - plan.valueMinor
          : (command.discountMinor ?? 0)
        if (discount > appointment.bookedPriceMinor)
          throw new Error('The discount cannot be more than the booked treatment price.')
        // A plan's price already includes any tax, so its share is tax-inclusive.
        const bookedTax = visitTax(s, appointment)
        const tax = plan && bookedTax ? { ...bookedTax, inclusive: true } : bookedTax
        const { taxMinor, totalMinor: serviceTotal } = checkoutTotals({
          priceMinor: appointment.bookedPriceMinor,
          discountMinor: discount,
          tipMinor: command.tipMinor,
          depositMinor: deposit,
          tax,
        })
        // Products are priced at today's catalogue and tax, and must be in stock.
        const retail = priceRetail(s, command.products, appointment.locationId)
        const total = serviceTotal + retailCharge(retail)
        if (deposit > serviceTotal)
          throw new Error(
            'The discount leaves a balance below the recorded deposit. Review the deposit before checkout.',
          )
        // A gift card pays part or all of what is left after any deposit and plan.
        if (command.giftCardMinor !== undefined && !command.giftCardId)
          throw new Error('Choose the gift card to take this amount from.')
        const due = total - deposit - (plan?.valueMinor ?? 0)
        const gift = command.giftCardId
          ? spendGiftCard(
              next,
              appointment,
              command.giftCardId,
              command.giftCardMinor ?? 0,
              due,
              saleId,
              now,
              makeId,
              options.giftCardAsOf,
            )
          : undefined
        const giftMinor = gift ? command.giftCardMinor! : 0
        const sale = {
          id: saleId,
          organisationId: org.id,
          appointmentId: appointment.id,
          currency: org.currency,
          serviceMinor: appointment.bookedPriceMinor,
          discountMinor: discount,
          taxMinor,
          taxInclusive: plan ? true : (tax?.inclusive ?? false),
          taxRateBps: tax?.rateBps ?? 0,
          taxLabel: tax?.label ?? '',
          receiptNumber: `SL-${s.sales.length + 1}`,
          reference: command.reference,
          tipMinor: command.tipMinor,
          depositAppliedMinor: deposit,
          totalMinor: total,
          balanceMinor: due - giftMinor,
          paidAt: now,
          method: command.method,
          ...(command.processor ? { processor: command.processor } : {}),
          ...(plan ? { holdingId: plan.holding.id, coveredMinor: plan.valueMinor } : {}),
          ...(retail ? { retail } : {}),
          ...(gift ? { giftCardId: gift.card.id, giftCardMinor: giftMinor } : {}),
        }
        next.sales.push(sale)
        if (retail)
          recordRetailMovements(
            next,
            sale,
            retail,
            now,
            makeId,
            operations(s).mode === 'sandbox' ? 'Maya · demo operator' : 'Local operator',
          )
        next.payments.push({
          id: makeId(),
          organisationId: org.id,
          appointmentId: appointment.id,
          saleId: sale.id,
          kind: 'settlement',
          amountMinor: sale.balanceMinor,
          currency: org.currency,
          recordedAt: now,
          method: command.method,
          reference: command.reference,
          ...(command.processor ? { processor: command.processor } : {}),
        })
        appointment.status = 'completed'
        addEvent({
          clientId: appointment.clientId,
          appointmentId: appointment.id,
          saleId: sale.id,
          type: 'checkout',
          title: 'Visit completed',
          detail: `${
            retail
              ? `Bought ${retail.lines.map((line) => `${line.quantity > 1 ? `${line.quantity} × ` : ''}${line.name}`).join(', ')}. `
              : ''
          }${
            plan
              ? `Paid by ${plan.holding.name}${plan.holding.visits ? ` (${plan.visitsLeft} ${plan.visitsLeft === 1 ? 'visit' : 'visits'} left${plan.holding.kind === 'membership' ? ' this month' : ''})` : ''}. `
              : ''
          }${
            gift
              ? `${money(giftMinor, org, true)} paid by gift card ${gift.card.code} (${money(gift.leftMinor, org, true)} left). `
              : ''
          }${
            operations(s).mode === 'sandbox'
              ? 'Demo receipt recorded. No real money was collected.'
              : paymentDetail(command.method, command.processor)
          }`,
        })
        recordId = sale.id
      }
    } else if (command.type === 'note' || command.type === 'consent') {
      const client = next.clients.find((c) => c.id === command.clientId)
      if (!client) throw new Error('Client does not belong to this studio.')
      if (command.type === 'note') {
        const text = command.text.trim()
        if (text.length < 2 || text.length > 1000)
          throw new Error('Write a preference between 2 and 1,000 characters.')
        addEvent({
          clientId: client.id,
          type: 'note',
          title: 'Relationship note added',
          detail: text,
        })
      } else {
        client.marketingConsent = command.consent
        if (!command.consent && next.operations)
          next.operations.messages
            .filter(
              (m) => m.clientId === client.id && m.purpose === 'marketing' && m.status === 'queued',
            )
            .forEach((m) => {
              m.status = 'suppressed'
            })
        addEvent({
          clientId: client.id,
          type: 'consent',
          title: command.consent ? 'Email marketing enabled' : 'Email marketing withdrawn',
          detail: 'Preference recorded. No message sent.',
        })
      }
      recordId = client.id
    } else if (command.type === 'client') {
      if (command.referredById && !s.clients.some((c) => c.id === command.referredById))
        throw new Error('Referrer does not belong to this studio.')
      const client = createClient(command.contact)
      if (command.referredById) {
        next.relationships.push({
          id: makeId(),
          organisationId: org.id,
          fromClientId: command.referredById,
          toClientId: client.id,
          type: 'referral',
          createdAt: now,
        })
        addEvent({
          clientId: command.referredById,
          type: 'relationship',
          title: 'A relationship grew',
          detail: `Referred ${client.name}.`,
        })
        addEvent({
          clientId: client.id,
          type: 'relationship',
          title: 'Referred to the studio',
          detail: `Introduced by ${s.clients.find((c) => c.id === command.referredById)!.name}.`,
        })
      }
      recordId = client.id
    } else if (command.type === 'till-count') {
      recordId = recordTillCount(next, command, now, businessDate(s, now), makeId)
    } else if (
      command.type === 'import-services' ||
      command.type === 'import-appointments' ||
      command.type === 'import-balances' ||
      command.type === 'balance-settle'
    ) {
      recordId = runSwitchingCommand(next, command, now, makeId, addEvent, createClient)
    } else if (command.type === 'counter-sale') {
      if (command.method === 'card' || command.method === 'previous_system')
        throw new Error('Take a walk-in sale in cash or on your own card terminal.')
      assertMethod(s, command.method, command.reference)
      const sale = sellAtCounter(next, { ...command, method: command.method }, now, makeId)
      if (sale.clientId)
        addEvent({
          clientId: sale.clientId,
          type: 'checkout',
          title: 'Bought products',
          detail: `${sale.retail.lines.map((line) => `${line.quantity > 1 ? `${line.quantity} × ` : ''}${line.name}`).join(', ')} on receipt ${sale.receiptNumber}, without a visit.`,
        })
      recordId = sale.id
    } else if (
      command.type === 'waitlist-add' ||
      command.type === 'waitlist-remove' ||
      command.type === 'waitlist-offer' ||
      command.type === 'waitlist-join' ||
      command.type === 'waitlist-leave'
    ) {
      const same = waitlistUnchanged(s, command, now)
      if (same) return { ok: true, state: s, recordId: same }
      recordId = runWaitlistCommand(next, command, now, makeId, addEvent)
    } else if (command.type === 'guest-here') {
      const appointment = next.appointments.find((a) => a.id === command.appointmentId)
      if (!appointment) throw new Error('Visit does not belong to this studio.')
      // Telling the desk twice, or after the desk has welcomed them, changes nothing.
      if (appointment.guestHereAt || appointment.status === 'arrived')
        return { ok: true, state: s, recordId: appointment.id }
      const here = guestHereWindow(s, appointment.id, Date.parse(now))
      if (!here.open)
        throw new Error(
          here.reason === 'early'
            ? 'You can tell us you have arrived from 30 minutes before your visit.'
            : 'This visit can no longer be checked in online. Please speak to the desk.',
        )
      appointment.guestHereAt = now
      addEvent({
        clientId: appointment.clientId,
        appointmentId: appointment.id,
        type: 'arrived',
        title: 'Said they have arrived',
        detail: 'The guest tapped “I’ve arrived” on their private link. The desk welcomes them.',
      })
      recordId = appointment.id
    } else if (command.type === 'missed-call') {
      recordId = recordMissedCall(next, command, now, makeId)
    } else if (command.type === 'missed-call-done') {
      const call = (operations(s).missedCalls ?? []).find((c) => c.id === command.callId)
      if (call?.calledBackAt) return { ok: true, state: s, recordId: call.id }
      recordId = markCalledBack(next, command.callId, now)
    } else if (command.type === 'feedback') {
      const same = repeatedFeedback(s, command)
      if (same) return { ok: true, state: s, recordId: same.id }
      recordId = recordFeedback(next, command, now, makeId)
    } else if (command.type === 'special-plan') {
      recordId = planSpecial(next, command.input, now, makeId)
    } else if (command.type === 'special-stop') {
      recordId = stopSpecial(next, command.specialId, businessDate(s, now))
    } else if (command.type === 'task-add') {
      recordId = addTask(next, command.input, businessDate(s, now), now, makeId)
    } else if (command.type === 'task-done') {
      const task = (s.tasks ?? []).find((x) => x.id === command.taskId)
      if (task?.doneAt) return { ok: true, state: s, recordId: task.id }
      recordId = completeTask(next, command.taskId, now)
    } else if (
      command.type === 'offer' ||
      command.type === 'plan-sell' ||
      command.type === 'plan-renew' ||
      command.type === 'plan-cancel'
    ) {
      recordId = runPlanCommand(next, command, now, makeId, addEvent)
    } else if (
      command.type === 'gift-card-sell' ||
      command.type === 'gift-card-extend' ||
      command.type === 'gift-card-cancel'
    ) {
      recordId = runGiftCardCommand(next, command, now, makeId, addEvent)
    } else if (
      command.type === 'patch-test' ||
      command.type === 'patch-test-result' ||
      command.type === 'patch-test-settings'
    ) {
      const same = command.type === 'patch-test-result' && repeatedPatchResult(s, command)
      if (same) return { ok: true, state: s, recordId: same.id }
      recordId = runPatchTestCommand(next, command, now, makeId, addEvent)
    } else if (
      command.type === 'form-save' ||
      command.type === 'form-archive' ||
      command.type === 'form-submit'
    ) {
      const same = command.type === 'form-submit' && repeatedFormAnswer(s, command)
      if (same) return { ok: true, state: s, recordId: same.id }
      recordId = runFormCommand(next, command, now, makeId, addEvent)
    } else if (command.type === 'consent-wording' || command.type === 'guest-consent-stop') {
      const unchanged = consentUnchanged(s, command)
      if (unchanged) return { ok: true, state: s, recordId: unchanged }
      recordId = runConsentCommand(next, command, now, addEvent)
    } else if (command.type === 'consultation-save') {
      const unchanged = unchangedConsultation(s, command)
      if (unchanged) return { ok: true, state: s, recordId: unchanged }
      recordId = runConsultationCommand(next, command, now, makeId, addEvent)
    } else if (
      command.type === 'reply-received' ||
      command.type === 'reply-note' ||
      command.type === 'replies-read' ||
      command.type === 'reply-link' ||
      command.type === 'social-answer' ||
      command.type === 'saved-reply-save' ||
      command.type === 'saved-reply-remove'
    ) {
      const unchanged = inboxUnchanged(s, command)
      if (unchanged) return { ok: true, state: s, recordId: unchanged }
      recordId = runInboxCommand(next, command, now, makeId, addEvent)
    } else if (
      command.type === 'region' ||
      command.type === 'region-remove' ||
      command.type === 'targets' ||
      command.type === 'group-checks'
    ) {
      recordId = runGroupCommand(next, command, makeId)
    } else if (
      command.type === 'checklist-save' ||
      command.type === 'checklist-archive' ||
      command.type === 'branch-visit' ||
      command.type === 'branch-visit-fix'
    ) {
      const unchanged = branchVisitUnchanged(s, command)
      if (unchanged) return { ok: true, state: s, recordId: unchanged }
      recordId = runBranchVisitCommand(next, command, now, businessDate(s, now), makeId)
    } else if (
      command.type === 'request-raise' ||
      command.type === 'request-decide' ||
      command.type === 'approval-limit'
    ) {
      recordId = runApprovalCommand(next, command, now, makeId)
    } else if (
      command.type === 'studio-look' ||
      command.type === 'house-rules' ||
      command.type === 'benchmark-sharing'
    ) {
      recordId = runBrandCommand(next, command, businessDate(s, now))
    } else if (command.type === 'till-settings') {
      recordId = runTillCommand(next, command)
    } else {
      recordId = runOperatingCommand(next, command, now, makeId, addEvent)
    }
    recordConsentChanges(s, next, command, now, makeId)
    next.revision += 1
    return { ok: true, state: parseState(next, org.region), recordId }
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof z.ZodError
          ? 'Check the client details, date and time, then try again.'
          : error instanceof Error
            ? error.message
            : 'Unable to save this change.',
    }
  }
}

export function dispatch(
  s: BusinessState,
  command: Command,
  actorName = 'Local operator',
  now = new Date().toISOString(),
  options: ExecuteOptions = {},
): CommandResult {
  const result = execute(s, command, now, undefined, options)
  if (!result.ok || result.state === s) return result
  const eventIds = new Set(s.events.map((e) => e.id))
  result.state.events
    .filter((e) => !eventIds.has(e.id))
    .forEach((e) => {
      e.actor = actorName
    })
  stampPlanActors(s, result.state, actorName)
  const tasks = new Set((s.tasks ?? []).map((x) => x.id))
  for (const task of result.state.tasks ?? []) if (!tasks.has(task.id)) task.createdBy = actorName
  const sold = new Set((s.counterSales ?? []).map((sale) => sale.id))
  for (const sale of result.state.counterSales ?? []) if (!sold.has(sale.id)) sale.actor = actorName
  stampGiftCardActors(s, result.state, actorName)
  stampBranchVisitActors(s, result.state, actorName)
  stampRequestActors(s, result.state, actorName)
  const known = new Map((operations(s).missedCalls ?? []).map((c) => [c.id, c]))
  for (const call of operations(result.state).missedCalls ?? []) {
    const before = known.get(call.id)
    if (!before) call.actor = actorName
    if (call.calledBackAt && !before?.calledBackAt) call.calledBackBy = actorName
  }
  stampPatchTestActors(s, result.state, actorName)
  stampFormActors(s, result.state, actorName)
  stampConsentActors(s, result.state, actorName)
  stampConsultationActors(s, result.state, actorName)
  stampInboxActors(s, result.state, actorName)
  const counted = new Set((s.tillCounts ?? []).map((c) => c.id))
  for (const count of result.state.tillCounts ?? [])
    if (!counted.has(count.id)) count.actor = actorName
  const closed = new Set(
    (operations(s).purchaseOrders ?? []).filter((x) => x.closedAt).map((x) => x.id),
  )
  for (const order of operations(result.state).purchaseOrders ?? [])
    if (order.closedAt && !closed.has(order.id)) order.closedBy = actorName
  const cancelled = new Set(
    (operations(s).timeOff ?? []).filter((t) => t.cancelledAt).map((t) => t.id),
  )
  for (const away of operations(result.state).timeOff ?? [])
    if (away.cancelledAt && !cancelled.has(away.id)) away.cancelledBy = actorName
  const settled = new Set((operations(s).balances ?? []).filter((b) => b.settled).map((b) => b.id))
  for (const balance of operations(result.state).balances ?? [])
    if (balance.settled && !settled.has(balance.id)) balance.settled.actor = actorName
  for (const key of [
    'messages',
    'movements',
    'refunds',
    'scheduleHistory',
    'imports',
    'balances',
    'payRates',
    'payRules',
    'timeOff',
    'rentals',
    'rentPayments',
    'purchaseOrders',
    'accountingExports',
  ] as const) {
    const ids = new Set((operations(s)[key] ?? []).map((r) => r.id))
    const records = operations(result.state)[key] ?? []
    records
      .filter((r) => !ids.has(r.id))
      .forEach((r) => {
        r.actor = actorName
      })
  }
  return result
}
