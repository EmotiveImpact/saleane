import { z } from 'zod'
import { parseState } from './model'
import { businessDate, operations, visitTax } from './operations'
import { placeOf, serviceAt, staffLocationOn } from './locations'
import { bookingSchema, commandSchema, contactSchema } from './commandSchema'
import type { Command, ContactInput } from './commandSchema'
import { assertMethod, paymentDetail, runOperatingCommand } from './operatingCommands'
import { runGroupCommand } from './group'
import { runApprovalCommand, stampRequestActors } from './approvals'
import { spendRefundApproval } from './signoffs'
import { runBrandCommand } from './brandRules'
import { runTillCommand } from './till'
import { branchVisitUnchanged, runBranchVisitCommand, stampBranchVisitActors } from './branchVisits'
import { runHoursCommand, stampShiftActors } from './hours'
import { runRotaCommand, stampRotaActors } from './rota'
import { runStaffMoveCommand, stampStaffMoveActors } from './staffMoves'
import { newsUnchanged, runNewsCommand, stampNewsActors } from './news'
import { runCommissionCommand } from './commission'
import { channelNote } from './bookingChannel'
import { checkoutTotals } from './money'
import { recordTillCount } from './tillCount'
import { openLocation, withSetupProgress } from './setup'
export { commandSchema } from './commandSchema'
export type { Command, BookingInput, ContactInput } from './commandSchema'
import type { Appointment, BusinessState, RelationshipEvent } from './model'
import { addDays, dateLabel, money, timeLabel } from './format'
import { REPEAT_AHEAD_DAYS, REPEAT_MOST, everyLabel, laterInRepeat, repeatDates } from './repeat'
import { upcomingTogether } from './together'
import { availableAllocation } from './allocation'
import { runSwitchingCommand } from './switching'
import { coverVisit, runPlanCommand, stampPlanActors } from './plans'
import { planCardUnchanged, runPlanCardCommand } from './planCards'
import { runGiftCardCommand, spendGiftCard, stampGiftCardActors } from './giftCards'
import {
  onlinePatchTestStop,
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
import {
  WRITTEN_BY_SALEANE,
  inviteForCancelled,
  invitesUnchanged,
  runInviteCommand,
} from './cancelledTimes'
import { offerInviteUnchanged, offerToBook, runOfferInvite } from './quietInvites'
import { offerPrices } from './quietOffers'

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
  /** NEXT-08: the visits this one is booked together with. */
  together?: string,
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
        together,
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
  // NEXT-08: a visit moved within its day and location stays with the others booked with it.
  const together =
    appointment?.together &&
    date === appointment.date &&
    (locationId ?? appointment.locationId) === appointment.locationId
      ? appointment.together.id
      : undefined
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
        together,
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
  /** NEXT-08: the visits this one would be booked together with. */
  together?: string,
) {
  const options: number[] = []
  for (let start = 0; start < 1440; start += 15)
    if (
      staffId === 'any'
        ? availableProfessionals(s, serviceId, date, start, now, locationId, together).length > 0
        : availableResource(
            s,
            serviceId,
            staffId,
            date,
            start,
            now,
            undefined,
            locationId,
            together,
          )
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
  together?: string,
) {
  return s.staff.filter((person) =>
    availableResource(s, serviceId, person.id, date, start, now, undefined, locationId, together),
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
  /** NEXT-08: a visit being booked together with others, who may share a room for two. */
  together?: string
  /**
   * Stage 4: a card refund started at this instant; a sign-off it used is judged as of then, so
   * one that lapses while the card company answers is still marked as given back.
   */
  refundApprovalAsOf?: string
  /**
   * NEXT-11: one part of a batch, such as a cover plan. SALEANE writes no invitations of its own
   * for a time the plan frees, since the rest of the plan may close it.
   */
  inBatch?: boolean
  /**
   * Stage 5: the invitation whose quiet-time price this online booking takes. Only the public
   * booking route passes it, after checking the guest's private link; it never comes from a body.
   */
  offer?: { messageId: string }
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
        const result = execute(current, part as Command, now, makeId, { inBatch: true })
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
    if (command.type === 'book-repeat') return bookRepeat(s, command, now, makeId)
    if (command.type === 'book-together') return bookTogether(s, command, now, makeId)
    // The setup wizards: several ordinary Settings changes, applied together or not at all.
    if (command.type === 'setup-step' || command.type === 'location-open') {
      let current = s
      const run = (part: Command) => {
        const result = execute(current, part, now, makeId)
        if (!result.ok) throw new Error(result.error)
        current = result.state
        return result.recordId
      }
      let recordId = s.organisation.id
      if (command.type === 'setup-step') {
        for (const part of command.changes) run(part as Command)
        current = withSetupProgress(current, command.next, now)
      } else recordId = openLocation(s, command, run)
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
      // Stage 3: an online booking always opens a new client record, so the guest is never known
      // for sure and the studio's patch test rule stops a treatment that needs one.
      const patchStop = input.source === 'online' ? onlinePatchTestStop(s, input.serviceId) : null
      if (patchStop) throw new Error(patchStop)
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
              options.together,
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
                  options.together,
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
        options.together,
      )
      if (!resourceId)
        throw new Error('That time is no longer available. Choose another time or professional.')
      const service = s.services.find((item) => item.id === input.serviceId)!
      // Stage 5: a quiet-time price from the guest's invitation, for exactly its time.
      if (options.offer && input.source !== 'online')
        throw new Error('A quiet-time price is booked only from the guest’s own link.')
      const offer = options.offer
        ? offerToBook(
            s,
            options.offer.messageId,
            {
              serviceId: service.id,
              staffId,
              date: input.date,
              startMinutes: input.startMinutes,
              locationId,
            },
            now,
          )
        : undefined
      // The deposit follows the treatment's own rule and is never more than the price booked.
      const priceMinor = offer ? offer.priceMinor : serviceAt(service, locationId).priceMinor
      const depositMinor = Math.min(service.depositMinor, priceMinor)
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
        bookedPriceMinor: priceMinor,
        bookedDepositMinor: depositMinor,
        bookedDurationMinutes: service.durationMinutes,
        bookedBufferMinutes: service.bufferMinutes,
        bookedResourceType: service.resourceType,
        bookedServiceName: service.name,
        bookedTax: operations(s).tax ?? null,
        ...(consultation ? { consultation } : {}),
        ...(offer
          ? { bookedOffer: { messageId: offer.messageId, usualPriceMinor: offer.usualPriceMinor } }
          : {}),
      }
      next.appointments.push(appointment)
      // Simulated deposit receipt is deliberately separate from the service-price snapshot.
      if (operations(s).mode === 'sandbox' && depositMinor > 0)
        next.payments.push({
          id: makeId(),
          organisationId: org.id,
          appointmentId: appointment.id,
          kind: 'deposit',
          amountMinor: depositMinor,
          currency: org.currency,
          recordedAt: now,
          method: 'demo_card',
        })
      addEvent({
        clientId: client.id,
        appointmentId: appointment.id,
        type: 'booked',
        title: input.source === 'rebook' ? 'Next visit booked' : 'Visit booked',
        detail: `${service.name} · ${dateLabel(input.date, org.locale)} at ${timeLabel(input.startMinutes, org.locale)}. ${offer ? `Booked at a quiet-time price of ${offerPrices(s, offer)}, from an invitation. ` : ''}${operations(s).mode === 'sandbox' ? 'Deposit simulated; no payment taken.' : 'No payment collected. Any required deposit remains outstanding.'}${input.channel ? ` ${channelNote(input.channel)}` : ''}${input.callId ? ' Booked when the studio called back after a missed call.' : ''}`,
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
        // NEXT-08: visits booked together share a day and a location; one moved off them leaves.
        const leaves = !!appointment.together && (from.date !== to.date || moved)
        if (leaves) delete appointment.together
        // "I've arrived" was about the old time; a guest tells the desk again on the new day.
        if (from.date !== to.date || from.startMinutes !== to.startMinutes)
          delete appointment.guestHereAt
        addEvent({
          clientId: appointment.clientId,
          appointmentId: appointment.id,
          type: 'rescheduled',
          title: 'Visit moved',
          allocationChange: { from, to },
          detail: `${dateLabel(from.date, org.locale)} at ${timeLabel(from.startMinutes, org.locale)} with ${s.staff.find((person) => person.id === from.staffId)!.name}${moved ? ` at ${placeOf(s, from.locationId)?.name}` : ''} → ${dateLabel(to.date, org.locale)} at ${timeLabel(to.startMinutes, org.locale)} with ${s.staff.find((person) => person.id === to.staffId)!.name}${moved ? ` at ${placeOf(s, place)?.name}` : ''}. Booked treatment, price and deposit kept; no message sent.${appointment.bookedOffer ? ' The quiet-time price stays with the visit.' : ''}${leaves ? ' No longer booked together with the others.' : ''}`,
        })
        if (command.waitlistId)
          fillFromWaitlist(next, command.waitlistId, appointment, now, 'move', from.date)
        followMovedVisit(s, next, appointment, now)
      } else {
        const status = command.type === 'cancel' ? 'cancelled' : 'no_show'
        // NEXT-09: the later visits of its repeat go too, when the studio asks for that.
        const later =
          command.type === 'cancel' && command.andLater
            ? laterInRepeat(s, appointment).map((x) =>
                next.appointments.find((y) => y.id === x.id)!,
              )
            : []
        // NEXT-08: and the visits booked together with it, when the studio asks for that.
        const others =
          command.type === 'cancel' && command.andTogether
            ? upcomingTogether(s, appointment)
                .map((x) => next.appointments.find((y) => y.id === x.id)!)
                .filter((x) => !later.includes(x))
            : []
        if (
          command.type === 'cancel' &&
          (command.andLater || command.andTogether) &&
          command.deposit
        )
          throw new Error('A guest cancels one visit at a time.')
        const withIt = [...later, ...others]
        if (appointment.status === status && !withIt.length)
          return { ok: true, state: s, recordId: appointment.id }
        if (appointment.status !== 'confirmed' && appointment.status !== status)
          throw new Error('Only an upcoming visit can be changed this way.')
        if (status === 'no_show' && appointment.date > businessDate(s, now))
          throw new Error('A visit still to come cannot be marked as missed.')
        const reason = command.reason.trim()
        if (reason.length < 2 || reason.length > 300)
          throw new Error('Enter an operational reason between 2 and 300 characters.')
        const leadName = next.clients.find((c) => c.id === appointment.clientId)?.name
        const changed = appointment.status === status ? withIt : [appointment, ...withIt]
        for (const visit of changed) {
          visit.status = status
          if (status === 'cancelled') closeForCancelledVisit(s, next, visit.id, now)
          const paid = depositPaid(s, visit.id)
          const deposit =
            command.type === 'cancel' && command.deposit && paid
              ? command.deposit === 'refund_due'
                ? `Deposit of ${money(paid, org, true)} flagged for refund under the 24-hour cancellation policy. No refund has been made; record it in Money once returned. No message sent.`
                : `Deposit of ${money(paid, org, true)} retained under the 24-hour cancellation policy. No fee, sale or message created.`
              : 'Deposit history retained for review. No refund, fee, sale or message created.'
          addEvent({
            clientId: visit.clientId,
            appointmentId: visit.id,
            type: status,
            title: status === 'cancelled' ? 'Visit cancelled' : 'Visit marked as missed',
            detail: `${reason}.${others.includes(visit) ? ` Cancelled together with ${leadName ?? 'the guest'}’s visit, booked with it.` : visit !== appointment ? ' Cancelled with the earlier visit of its repeat.' : ''} ${deposit}`,
          })
        }
        // NEXT-11: SALEANE writes invitations to each time it freed, for the team to approve.
        if (status === 'cancelled' && !options.inBatch)
          inviteForCancelled(
            next,
            changed.map((visit) => visit.id),
            now,
            makeId,
            addEvent,
          )
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
    } else if (command.type === 'opening-invite') {
      const same = invitesUnchanged(s, command)
      if (same) return { ok: true, state: s, recordId: same }
      recordId = runInviteCommand(next, command, now, makeId, addEvent)
    } else if (command.type === 'offer-invite') {
      const same = offerInviteUnchanged(s, command)
      if (same) return { ok: true, state: s, recordId: same }
      recordId = runOfferInvite(next, command, now, makeId, addEvent)
    } else if (command.type === 'quiet-offers') {
      const known = new Set(s.services.map((service) => service.id))
      if (command.settings.leftOutIds.some((id) => !known.has(id)))
        throw new Error('Choose treatments from this studio to leave out.')
      next.operations = { ...operations(next), quietOffers: { ...command.settings } }
      recordId = org.id
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
    } else if (command.type === 'plan-card' || command.type === 'plan-card-try') {
      const unchanged = planCardUnchanged(s, command)
      if (unchanged) return { ok: true, state: s, recordId: unchanged }
      recordId = runPlanCardCommand(next, command, now, makeId, addEvent)
    } else if (
      command.type === 'gift-card-sell' ||
      command.type === 'gift-card-extend' ||
      command.type === 'gift-card-cancel' ||
      command.type === 'gift-card-move'
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
      command.type === 'approval-limit' ||
      command.type === 'signoff-rules' ||
      command.type === 'request-start'
    ) {
      recordId = runApprovalCommand(next, command, now, makeId)
    } else if (
      command.type === 'clock-in' ||
      command.type === 'clock-out' ||
      command.type === 'shift-save' ||
      command.type === 'shift-remove'
    ) {
      recordId = runHoursCommand(next, command, now, businessDate(s, now), makeId)
    } else if (
      command.type === 'rota-day' ||
      command.type === 'rota-day-usual' ||
      command.type === 'rota-week-copy' ||
      command.type === 'rota-week-clear'
    ) {
      recordId = runRotaCommand(next, command, now, makeId)
    } else if (command.type === 'staff-move' || command.type === 'staff-move-cancel') {
      recordId = runStaffMoveCommand(next, command, now, makeId)
    } else if (
      command.type === 'news-save' ||
      command.type === 'news-approve' ||
      command.type === 'news-stop' ||
      command.type === 'news-discard' ||
      command.type === 'news-unsubscribe'
    ) {
      const unchanged = newsUnchanged(s, command)
      if (unchanged) return { ok: true, state: s, recordId: unchanged }
      recordId = runNewsCommand(next, command, now, makeId, addEvent)
    } else if (
      command.type === 'studio-look' ||
      command.type === 'house-rules' ||
      command.type === 'benchmark-sharing'
    ) {
      recordId = runBrandCommand(next, command, businessDate(s, now))
    } else if (command.type === 'till-settings') {
      recordId = runTillCommand(next, command)
    } else if (
      command.type === 'commission-rate' ||
      command.type === 'commission-steps' ||
      command.type === 'staff-target'
    ) {
      recordId = runCommissionCommand(next, command, now, makeId)
    } else {
      recordId = runOperatingCommand(next, command, now, makeId, addEvent)
      // Stage 4: a refund given back with a sign-off uses it up, so it is never used again.
      if (command.type === 'refund')
        spendRefundApproval(s, next, command, recordId, now, options.refundApprovalAsOf)
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

/**
 * NEXT-09: books a visit and the later ones that repeat it, each through the ordinary booking so
 * it is checked in full, all together or not at all. The later visits are for the client and
 * professional the first one got, wherever that person works on the day.
 */
function bookRepeat(
  s: BusinessState,
  command: Extract<Command, { type: 'book-repeat' }>,
  now: string,
  makeId: () => string,
): CommandResult {
  const { booking, everyWeeks, visits } = command
  const { locale } = s.organisation
  if (booking.source === 'online') throw new Error('Repeat visits are booked by the studio.')
  const onRhythm = new Set(repeatDates(booking.date, everyWeeks, REPEAT_MOST))
  let last = booking.date
  for (const visit of visits) {
    if (visit.date <= last || !onRhythm.has(visit.date))
      throw new Error(`Each repeat visit falls ${everyLabel(everyWeeks)} after the first.`)
    last = visit.date
  }
  if (last > addDays(businessDate(s, now), REPEAT_AHEAD_DAYS))
    throw new Error('Repeat visits can be booked up to a year ahead.')
  const repeat = { id: makeId(), everyWeeks }
  const all = [{ date: booking.date, startMinutes: booking.startMinutes }, ...visits]
  const made: Appointment[] = []
  let current = s
  for (const [index, when] of all.entries()) {
    const first = made[0]
    const input =
      index === 0
        ? booking
        : {
            serviceId: first.serviceId,
            staffId: first.staffId,
            clientId: first.clientId,
            date: when.date,
            startMinutes: when.startMinutes,
            ...('resourceId' in when && when.resourceId ? { resourceId: when.resourceId } : {}),
            // Every visit is where the first is: a person works at the same place each weekday.
            locationId: first.locationId,
            source: 'desk' as const,
            ...(booking.consultationId ? { consultationId: booking.consultationId } : {}),
          }
    const result = execute(current, { type: 'book', input }, now, makeId)
    if (!result.ok)
      return index === 0
        ? result
        : {
            ok: false,
            error: `${dateLabel(when.date, locale)} at ${timeLabel(when.startMinutes, locale)}: ${result.error}`,
          }
    current = result.state
    const visit = current.appointments.find((a) => a.id === result.recordId)!
    visit.repeat = repeat
    made.push(visit)
  }
  // Each visit's own "Visit booked" line says where it sits in the repeat.
  const ids = new Map(made.map((visit, index) => [visit.id, index + 1]))
  const before = new Set(s.events.map((e) => e.id))
  for (const event of current.events)
    if (!before.has(event.id) && event.type === 'booked' && ids.has(event.appointmentId ?? ''))
      event.detail += ` Visit ${ids.get(event.appointmentId!)} of ${made.length}, repeating ${everyLabel(everyWeeks)}.`
  return {
    ok: true,
    state: parseState({ ...current, revision: s.revision + 1 }, s.organisation.region),
    recordId: made[0].id,
  }
}

type TogetherGuest = Extract<Command, { type: 'book-together' }>['guests'][number]
type TogetherBooking = Extract<Command, { type: 'book-together' }>['booking']

/**
 * NEXT-08: everyone booked together, each through the ordinary booking as a visit of its own, at
 * the first visit's location. Someone sharing an earlier person's time in the same kind of room
 * joins them in a room for two when one is free, so a couple can be side by side.
 */
function placeParty(
  s: BusinessState,
  booking: TogetherBooking,
  guests: TogetherGuest[],
  now: string,
  makeId: () => string,
): { ok: true; state: BusinessState; made: Appointment[] } | { ok: false; error: string } {
  const together = makeId()
  const span = (serviceId: string, start: number) => {
    const service = s.services.find((item) => item.id === serviceId)
    return [start, start + (service ? service.durationMinutes + service.bufferMinutes : 0)]
  }
  const kind = (serviceId: string) => s.services.find((item) => item.id === serviceId)?.resourceType
  const meets = (a: number[], b: number[]) => a[0] < b[1] && b[0] < a[1]
  const people = [booking, ...guests]
  const made: Appointment[] = []
  let current = s
  for (const [index, person] of people.entries()) {
    const guest = index ? guests[index - 1] : undefined
    const input = guest
      ? {
          ...(guest.clientId ? { clientId: guest.clientId } : { contact: guest.contact }),
          serviceId: guest.serviceId,
          staffId: guest.staffId,
          date: booking.date,
          startMinutes: guest.startMinutes,
          ...(guest.resourceId ? { resourceId: guest.resourceId } : {}),
          locationId: made[0].locationId,
          source: 'desk' as const,
        }
      : booking
    const own = span(person.serviceId, person.startMinutes)
    const alike = (serviceId: string, start: number) =>
      kind(serviceId) === kind(person.serviceId) && meets(own, span(serviceId, start))
    // Side by side: the room for two an earlier person is in, or one that is free for both.
    const partner = made.find(
      (visit) =>
        alike(visit.serviceId, visit.startMinutes) &&
        current.resources.find((room) => room.id === visit.resourceId)?.forTwo,
    )
    const rooms = input.resourceId
      ? []
      : partner
        ? [partner.resourceId]
        : people.some((other, at) => at > index && alike(other.serviceId, other.startMinutes))
          ? current.resources.filter((room) => room.forTwo && !room.archived).map((room) => room.id)
          : []
    let result: CommandResult | undefined
    for (const resourceId of rooms) {
      result = execute(current, { type: 'book', input: { ...input, resourceId } }, now, makeId, {
        together,
      })
      if (result.ok) break
    }
    if (!result?.ok) result = execute(current, { type: 'book', input }, now, makeId, { together })
    if (!result.ok) {
      if (!guest) return result
      const name =
        (guest.clientId
          ? s.clients.find((client) => client.id === guest.clientId)?.name
          : guest.contact?.name) ?? `Person ${index + 1}`
      return { ok: false, error: `${name}: ${result.error}` }
    }
    current = result.state
    const visit = current.appointments.find((a) => a.id === result.recordId)!
    if (made.some((other) => other.clientId === visit.clientId))
      return {
        ok: false,
        error: 'Each person is booked once. Book another treatment for them on its own.',
      }
    visit.together = index ? { id: together } : { id: together, lead: true }
    made.push(visit)
  }
  return { ok: true, state: current, made }
}

/** NEXT-08: visits for several people on one day, booked together or not at all. */
function bookTogether(
  s: BusinessState,
  command: Extract<Command, { type: 'book-together' }>,
  now: string,
  makeId: () => string,
): CommandResult {
  const { booking, guests } = command
  if (booking.source === 'online')
    throw new Error('Visits for several people are booked by the studio.')
  // A new person's own email, never one that belongs to someone else.
  const emails = new Map<string, string>()
  for (const person of [booking, ...guests]) {
    const contact = person.contact
    if (!contact) continue
    const email = contact.email.trim().toLowerCase()
    const known = s.clients.find((client) => client.email.toLowerCase() === email)
    const twice = emails.get(email)
    if (known || twice)
      throw new Error(
        `${contact.name.trim()}: that email is ${known ? `${known.name}’s` : `${twice}’s too`}. Choose ${known ? 'them from your clients' : 'one person for it'}, or use their own email.`,
      )
    emails.set(email, contact.name.trim())
  }
  const placed = placeParty(s, booking, guests, now, makeId)
  if (!placed.ok) return placed
  const { state: current, made } = placed
  // Each visit's own "Visit booked" line names the people booked with it.
  const names = new Map(
    made.map((visit) => [visit.id, current.clients.find((c) => c.id === visit.clientId)!.name]),
  )
  const before = new Set(s.events.map((e) => e.id))
  for (const event of current.events)
    if (!before.has(event.id) && event.type === 'booked' && names.has(event.appointmentId ?? '')) {
      const list = made
        .filter((visit) => visit.id !== event.appointmentId)
        .map((visit) => names.get(visit.id)!)
      event.detail += ` Booked together with ${list.length < 2 ? list[0] : `${list.slice(0, -1).join(', ')} and ${list.at(-1)}`}.`
    }
  return {
    ok: true,
    state: parseState({ ...current, revision: s.revision + 1 }, s.organisation.region),
    recordId: made[0].id,
  }
}

/** One person in a booking for several, as the desk has them so far. */
export type PartyPerson = {
  clientId?: string
  serviceId: string
  /** A professional, or "any" for whoever is free. */
  staffId: string
  startMinutes: number
}

/**
 * NEXT-08: the calendar as it would be with these people booked together, so the desk can see the
 * times still free for the next person and where each one would be. Anyone not chosen yet stands
 * in as someone new; nothing is saved.
 */
export function previewTogether(
  s: BusinessState,
  date: string,
  people: PartyPerson[],
  locationId?: string,
  now = new Date().toISOString(),
) {
  let n = 0
  const makeId = () => `preview-${++n}`
  const who = (person: PartyPerson, index: number) =>
    person.clientId
      ? { clientId: person.clientId }
      : {
          contact: {
            name: 'Someone new',
            email: `someone-new-${index}@preview.invalid`,
            phone: '+447700900000',
            marketingConsent: false,
          },
        }
  const [first, ...rest] = people
  const placed = placeParty(
    s,
    {
      ...who(first, 0),
      serviceId: first.serviceId,
      staffId: first.staffId,
      date,
      startMinutes: first.startMinutes,
      source: 'desk',
      ...(locationId ? { locationId } : {}),
    },
    rest.map((person, index) => ({
      ...who(person, index + 1),
      serviceId: person.serviceId,
      staffId: person.staffId,
      startMinutes: person.startMinutes,
    })),
    now,
    makeId,
  )
  return placed.ok
    ? {
        ok: true as const,
        state: placed.state,
        made: placed.made,
        together: placed.made[0].together!.id,
      }
    : placed
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
  stampShiftActors(s, result.state, actorName)
  stampRotaActors(s, result.state, actorName)
  stampStaffMoveActors(s, result.state, actorName)
  stampNewsActors(s, result.state, actorName)
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
    'commissionRates',
    'commissionSteps',
    'staffTargets',
  ] as const) {
    const ids = new Set((operations(s)[key] ?? []).map((r) => r.id))
    const records = operations(result.state)[key] ?? []
    records
      // NEXT-11: invitations SALEANE wrote by itself keep its name.
      .filter((r) => !ids.has(r.id) && r.actor !== WRITTEN_BY_SALEANE)
      .forEach((r) => {
        r.actor = actorName
      })
  }
  return result
}
