import { z } from 'zod'
import { CLOSE_MINUTES, DEMO_DATE, OPEN_MINUTES, clientSchema, parseState } from './model'
import type { Appointment, BusinessState, RelationshipEvent } from './model'
import { dateLabel, timeLabel } from './format'

const contactSchema = clientSchema.pick({
  name: true,
  email: true,
  phone: true,
  marketingConsent: true,
})
const bookingSchema = z.object({
  serviceId: z.string(),
  staffId: z.string(),
  date: z.iso.date(),
  startMinutes: z.number().int().min(OPEN_MINUTES).max(CLOSE_MINUTES),
  clientId: z.string().optional(),
  contact: contactSchema.optional(),
  source: z.enum(['desk', 'online', 'rebook']),
  rebookedFromId: z.string().optional(),
})
export type BookingInput = z.infer<typeof bookingSchema>
export type ContactInput = z.infer<typeof contactSchema>
export type Command =
  | { type: 'book'; input: BookingInput }
  | { type: 'arrive'; appointmentId: string }
  | { type: 'checkout'; appointmentId: string; tipMinor: number; method: 'demo_card' | 'demo_cash' }
  | { type: 'note'; clientId: string; text: string }
  | { type: 'client'; contact: ContactInput; referredById?: string }
  | { type: 'consent'; clientId: string; consent: boolean }
export type CommandResult =
  { ok: true; state: BusinessState; recordId: string } | { ok: false; error: string }

export function availableResource(
  s: BusinessState,
  serviceId: string,
  staffId: string,
  date: string,
  start: number,
): string | null {
  const service = s.services.find((item) => item.id === serviceId)
  const staff = s.staff.find((item) => item.id === staffId)
  if (
    !service ||
    !staff ||
    !staff.serviceIds.includes(serviceId) ||
    date < DEMO_DATE ||
    !Number.isInteger(start) ||
    start < OPEN_MINUTES ||
    start % 15 !== 0
  )
    return null
  const end = start + service.durationMinutes + service.bufferMinutes
  if (end > CLOSE_MINUTES) return null
  const overlapping = s.appointments.filter(
    (a) =>
      a.date === date &&
      a.status !== 'cancelled' &&
      start < a.startMinutes + a.bookedDurationMinutes + a.bookedBufferMinutes &&
      end > a.startMinutes,
  )
  if (overlapping.some((a) => a.staffId === staffId)) return null
  return (
    s.resources.find(
      (resource) =>
        resource.type === service.resourceType &&
        !overlapping.some((a) => a.resourceId === resource.id),
    )?.id ?? null
  )
}
export function slots(s: BusinessState, serviceId: string, staffId: string, date: string) {
  const options: number[] = []
  for (let start = OPEN_MINUTES; start < CLOSE_MINUTES; start += 30)
    if (availableResource(s, serviceId, staffId, date, start)) options.push(start)
  return options
}
export function depositPaid(s: BusinessState, appointmentId: string) {
  return s.payments
    .filter((p) => p.appointmentId === appointmentId && p.kind === 'deposit')
    .reduce((sum, p) => sum + p.amountMinor, 0)
}

export function execute(
  s: BusinessState,
  command: Command,
  now = new Date().toISOString(),
  makeId = () => crypto.randomUUID(),
): CommandResult {
  try {
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
        actor: 'Maya · demo operator',
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
          ? 'Email marketing consent given in this demo.'
          : 'Marketing remains off. Appointment updates are separate.',
      })
      return client
    }
    let recordId = ''
    if (command.type === 'book') {
      const input = bookingSchema.parse(command.input)
      const resourceId = availableResource(
        s,
        input.serviceId,
        input.staffId,
        input.date,
        input.startMinutes,
      )
      if (!resourceId)
        throw new Error('That time is no longer available. Choose another time or professional.')
      const service = s.services.find((item) => item.id === input.serviceId)!
      let client = input.clientId
        ? next.clients.find((item) => item.id === input.clientId)
        : undefined
      if (input.clientId && !client) throw new Error('Client does not belong to this workspace.')
      if (!client && input.contact) client = createClient(input.contact)
      if (!client) throw new Error('Choose a client or enter their details.')
      if (input.rebookedFromId) {
        const previous = s.appointments.find((a) => a.id === input.rebookedFromId)
        if (!previous || previous.status !== 'completed' || previous.clientId !== client.id)
          throw new Error('Rebooking needs a completed visit for this client.')
      }
      const appointment: Appointment = {
        id: makeId(),
        organisationId: org.id,
        locationId: org.locationId,
        clientId: client.id,
        serviceId: service.id,
        staffId: input.staffId,
        resourceId,
        date: input.date,
        startMinutes: input.startMinutes,
        status: 'confirmed',
        source: input.source,
        createdAt: now,
        rebookedFromId: input.rebookedFromId,
        bookedPriceMinor: service.priceMinor,
        bookedDepositMinor: service.depositMinor,
        bookedDurationMinutes: service.durationMinutes,
        bookedBufferMinutes: service.bufferMinutes,
      }
      next.appointments.push(appointment)
      // Simulated deposit receipt is deliberately separate from the service-price snapshot.
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
        title: input.source === 'rebook' ? 'Next visit booked' : 'Appointment booked',
        detail: `${service.name} · ${dateLabel(input.date, org.locale)} at ${timeLabel(input.startMinutes, org.locale)}. Deposit simulated; no payment taken.`,
      })
      recordId = appointment.id
    } else if (command.type === 'arrive' || command.type === 'checkout') {
      const appointment = next.appointments.find((a) => a.id === command.appointmentId)
      if (!appointment) throw new Error('Appointment does not belong to this workspace.')
      if (command.type === 'arrive') {
        if (appointment.status === 'arrived')
          return { ok: true, state: s, recordId: appointment.id }
        if (appointment.status !== 'confirmed' || appointment.date !== DEMO_DATE)
          throw new Error('Only a confirmed visit on the demo day can arrive.')
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
          throw new Error('Enter a valid tip up to twice the service price.')
        const deposit = depositPaid(s, appointment.id)
        if (deposit > appointment.bookedPriceMinor)
          throw new Error('Deposit exceeds this service. Review the ledger.')
        const total = appointment.bookedPriceMinor + command.tipMinor
        const sale = {
          id: makeId(),
          organisationId: org.id,
          appointmentId: appointment.id,
          currency: org.currency,
          serviceMinor: appointment.bookedPriceMinor,
          tipMinor: command.tipMinor,
          depositAppliedMinor: deposit,
          totalMinor: total,
          balanceMinor: total - deposit,
          paidAt: now,
          method: command.method,
        }
        next.sales.push(sale)
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
        })
        appointment.status = 'completed'
        addEvent({
          clientId: appointment.clientId,
          appointmentId: appointment.id,
          saleId: sale.id,
          type: 'checkout',
          title: 'Visit completed',
          detail: 'Demo receipt recorded. No real money was collected.',
        })
        recordId = sale.id
      }
    } else if (command.type === 'note' || command.type === 'consent') {
      const client = next.clients.find((c) => c.id === command.clientId)
      if (!client) throw new Error('Client does not belong to this workspace.')
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
        addEvent({
          clientId: client.id,
          type: 'consent',
          title: command.consent ? 'Email marketing enabled' : 'Email marketing withdrawn',
          detail: 'Preference recorded in the local demo. No message sent.',
        })
      }
      recordId = client.id
    } else {
      if (command.referredById && !s.clients.some((c) => c.id === command.referredById))
        throw new Error('Referrer does not belong to this workspace.')
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
    }
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
