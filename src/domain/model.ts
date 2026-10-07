import { z } from 'zod'
import { operationsSchema, taxSchema, weeklyHoursSchema } from './operations'
import { tillCountProblem, tillCountSchema } from './tillCount'
import { paymentMethodSchema, processorSchema } from './paymentMethods'
import { holdingSchema, offerSchema } from './plansSchema'
import { coveredSaleProblem, plansProblem } from './plans'
import { feedbackProblem, feedbackSchema } from './feedback'
import { counterSaleSchema, saleRetailSchema } from './retailSchema'
import { retailCharge, retailProblem } from './retail'
export { paymentMethodSchema, paymentMethods, processorSchema } from './paymentMethods'

export const DEMO_DATE = '2026-10-06'
export const OPEN_MINUTES = 9 * 60
export const CLOSE_MINUTES = 18 * 60
export type Region = 'UK' | 'US'
const id = z.string().min(1)
const minor = z.number().int().nonnegative().max(100_000_000)
const civilDate = z.iso.date()
const scoped = { id, organisationId: id }
/** Shared booking links the studio can hand out; anything else is ignored. */
export const bookingChannels = ['google', 'instagram'] as const
export type BookingChannel = (typeof bookingChannels)[number]
export const GUEST_NOTE_LIMIT = 400

export const organisationSchema = z.object({
  id,
  name: z.string().trim().min(2).max(100),
  region: z.enum(['UK', 'US']),
  currency: z.enum(['GBP', 'USD']),
  locale: z.enum(['en-GB', 'en-US']),
  timeZone: z.string(),
  locationId: id,
  locationName: z.string(),
  address: z.string(),
  /** Shown to guests before they arrive: directions, parking, how long to allow. Not clinical. */
  arrivalNote: z.string().max(GUEST_NOTE_LIMIT).optional(),
})
export const clientSchema = z.object({
  ...scoped,
  name: z.string().min(2).max(100),
  email: z.email(),
  phone: z.string().max(30),
  preferences: z.string().max(1000),
  marketingConsent: z.boolean(),
  createdAt: z.iso.datetime(),
  /** The client asked not to receive appointment emails or texts (PILOT-01). Absent means allowed. */
  noEmailReminders: z.boolean().optional(),
  noTextReminders: z.boolean().optional(),
})
export const serviceSchema = z.object({
  ...scoped,
  name: z.string().trim().min(2).max(100),
  description: z.string().max(1000),
  category: z.enum(['Skin', 'Body', 'Hair']),
  durationMinutes: z.number().int().positive(),
  bufferMinutes: z.number().int().nonnegative(),
  priceMinor: minor,
  depositMinor: minor,
  resourceType: z.enum(['treatment', 'chair']),
  archived: z.boolean().optional(),
  /** Practical preparation shown to guests, such as "Come with clean skin". Not clinical. */
  prepNote: z.string().max(GUEST_NOTE_LIMIT).optional(),
})
export const staffSchema = z.object({
  ...scoped,
  name: z.string().trim().min(2).max(100),
  role: z.string().trim().min(2).max(100),
  serviceIds: z
    .array(id)
    .refine((ids) => new Set(ids).size === ids.length, 'Duplicate qualifications.'),
  tone: z.enum(['sage', 'blue', 'sand']),
  hours: weeklyHoursSchema.optional(),
  archived: z.boolean().optional(),
})
export const resourceSchema = z.object({
  ...scoped,
  name: z.string().trim().min(2).max(100),
  type: z.enum(['treatment', 'chair']),
  archived: z.boolean().optional(),
})
export const appointmentSchema = z.object({
  ...scoped,
  locationId: id,
  clientId: id,
  serviceId: id,
  staffId: id,
  resourceId: id,
  date: civilDate,
  startMinutes: z.number().int().min(0).max(1439),
  status: z.enum(['confirmed', 'arrived', 'completed', 'cancelled', 'no_show']),
  /** `import` marks a visit booked in the studio's previous system and carried over (PILOT-03). */
  source: z.enum(['desk', 'online', 'rebook', 'import']),
  /** Where an online guest came from, when they followed a shared booking link. */
  channel: z.enum(bookingChannels).optional(),
  createdAt: z.iso.datetime(),
  rebookedFromId: id.optional(),
  bookedPriceMinor: minor,
  bookedDepositMinor: minor,
  bookedDurationMinutes: z.number().int().positive(),
  bookedBufferMinutes: z.number().int().nonnegative(),
  bookedResourceType: z.enum(['treatment', 'chair']).optional(),
  bookedServiceName: z.string().optional(),
  /** Tax basis at booking; null when the studio charged no tax then. Older visits omit it. */
  bookedTax: taxSchema.nullable().optional(),
})
export const saleSchema = z.object({
  ...scoped,
  appointmentId: id,
  currency: z.enum(['GBP', 'USD']),
  serviceMinor: minor,
  discountMinor: minor.optional(),
  taxMinor: minor.optional(),
  taxInclusive: z.boolean().optional(),
  taxRateBps: z.number().int().min(0).max(10000).optional(),
  taxLabel: z.string().max(40).optional(),
  receiptNumber: z.string().optional(),
  tipMinor: minor,
  depositAppliedMinor: minor,
  totalMinor: minor,
  balanceMinor: minor,
  paidAt: z.iso.datetime(),
  method: paymentMethodSchema,
  reference: z.string().max(150).optional(),
  processor: processorSchema.optional(),
  /** V1.5: the plan that paid for the visit, and how much of it this visit used. */
  holdingId: id.optional(),
  coveredMinor: minor.optional(),
  /** V2: products bought with the visit. They add to the total; plans and discounts never cover them. */
  retail: saleRetailSchema.optional(),
})
export const paymentSchema = z.object({
  ...scoped,
  appointmentId: id,
  saleId: id.optional(),
  /** A fee is a no-show or late-cancellation charge (PILOT-02), never part of a sale. */
  kind: z.enum(['deposit', 'settlement', 'fee']),
  amountMinor: minor,
  currency: z.enum(['GBP', 'USD']),
  recordedAt: z.iso.datetime(),
  method: paymentMethodSchema,
  reference: z.string().max(150).optional(),
  processor: processorSchema.optional(),
})
const allocationSchema = z.object({
  date: civilDate,
  startMinutes: z.number().int().min(0).max(1439),
  staffId: id,
  resourceId: id,
})
export const eventSchema = z.object({
  ...scoped,
  clientId: id,
  appointmentId: id.optional(),
  saleId: id.optional(),
  type: z.enum([
    'booked',
    'arrived',
    'checkout',
    'note',
    'consent',
    'relationship',
    'rescheduled',
    'cancelled',
    'no_show',
    'message',
    'refund',
    'deposit',
    'profile',
    'plan',
  ]),
  allocationChange: z.object({ from: allocationSchema, to: allocationSchema }).optional(),
  title: z.string(),
  detail: z.string(),
  occurredAt: z.iso.datetime(),
  actor: z.string(),
})
export const relationshipSchema = z.object({
  ...scoped,
  fromClientId: id,
  toClientId: id,
  type: z.enum(['referral', 'household']),
  createdAt: z.iso.datetime(),
})
export const stateSchema = z.object({
  schemaVersion: z.literal(1),
  revision: z.number().int().nonnegative(),
  organisation: organisationSchema,
  clients: z.array(clientSchema),
  services: z.array(serviceSchema),
  staff: z.array(staffSchema),
  resources: z.array(resourceSchema),
  appointments: z.array(appointmentSchema),
  sales: z.array(saleSchema),
  payments: z.array(paymentSchema),
  events: z.array(eventSchema),
  relationships: z.array(relationshipSchema),
  operations: operationsSchema.optional(),
  /** End-of-day till counts, append-only. Optional so records saved before them still load. */
  tillCounts: z.array(tillCountSchema).optional(),
  /** V1.5: packages and memberships on sale, and the ones clients hold. */
  offers: z.array(offerSchema).optional(),
  holdings: z.array(holdingSchema).optional(),
  /** V1.5: private guest feedback, one per completed visit. Owners and managers only. */
  feedback: z.array(feedbackSchema).optional(),
  /** V2: products sold without a visit. */
  counterSales: z.array(counterSaleSchema).optional(),
})
export type BusinessState = z.infer<typeof stateSchema>
export type Client = z.infer<typeof clientSchema>
export type Appointment = z.infer<typeof appointmentSchema>
export type Service = z.infer<typeof serviceSchema>
export type Staff = z.infer<typeof staffSchema>
export type Sale = z.infer<typeof saleSchema>
export type RelationshipEvent = z.infer<typeof eventSchema>

export function parseState(value: unknown, region: Region): BusinessState {
  const s = stateSchema.parse(value)
  const org = s.organisation
  if (org.region !== region || org.currency !== (region === 'UK' ? 'GBP' : 'USD'))
    throw new Error('Workspace region mismatch.')
  const collections = [
    s.clients,
    s.services,
    s.staff,
    s.resources,
    s.appointments,
    s.sales,
    s.payments,
    s.events,
    s.relationships,
    s.tillCounts ?? [],
    s.counterSales ?? [],
  ]
  for (const collection of collections) {
    if (new Set(collection.map((item) => item.id)).size !== collection.length)
      throw new Error('Duplicate record IDs.')
    if (collection.some((item) => item.organisationId !== org.id))
      throw new Error('Foreign workspace record.')
  }
  // Index each collection once: checking links by scanning arrays made validation quadratic, which
  // took seconds per request at tens of thousands of visits.
  const indexes = new Map<{ id: string }[], Set<string>>()
  const exists = (rows: { id: string }[], recordId: string) => {
    let ids = indexes.get(rows)
    if (!ids) indexes.set(rows, (ids = new Set(rows.map((row) => row.id))))
    return ids.has(recordId)
  }
  const appointmentById = new Map(s.appointments.map((a) => [a.id, a]))
  const paymentsByAppointment = new Map<string, (typeof s.payments)[number][]>()
  for (const payment of s.payments)
    paymentsByAppointment.set(payment.appointmentId, [
      ...(paymentsByAppointment.get(payment.appointmentId) ?? []),
      payment,
    ])
  const paymentsBySale = new Map<string, (typeof s.payments)[number][]>()
  for (const payment of s.payments)
    if (payment.saleId)
      paymentsBySale.set(payment.saleId, [...(paymentsBySale.get(payment.saleId) ?? []), payment])
  const depositsFor = (appointmentId: string) =>
    (paymentsByAppointment.get(appointmentId) ?? []).filter((p) => p.kind === 'deposit')
  for (const service of s.services)
    if (service.depositMinor > service.priceMinor) throw new Error('Invalid service deposit.')
  for (const staff of s.staff)
    if (staff.serviceIds.some((serviceId) => !exists(s.services, serviceId)))
      throw new Error('Missing staff service.')
  for (const a of s.appointments) {
    if (
      a.locationId !== org.locationId ||
      !exists(s.clients, a.clientId) ||
      !exists(s.staff, a.staffId) ||
      !exists(s.services, a.serviceId) ||
      !exists(s.resources, a.resourceId)
    )
      throw new Error('Broken appointment link.')
    // Upgrade older local records using the linked catalogue without resetting user data.
    a.bookedResourceType ??= s.resources.find((resource) => resource.id === a.resourceId)!.type
    a.bookedServiceName ??= s.services.find((service) => service.id === a.serviceId)!.name
    if (a.rebookedFromId && !exists(s.appointments, a.rebookedFromId))
      throw new Error('Broken rebooking link.')
    if (a.bookedDepositMinor > a.bookedPriceMinor) throw new Error('Invalid booked deposit.')
  }
  if (new Set(s.sales.map((sale) => sale.appointmentId)).size !== s.sales.length)
    throw new Error('Duplicate appointment settlement.')
  for (const sale of s.sales) {
    const appointment = appointmentById.get(sale.appointmentId)
    if (
      !appointment ||
      appointment.status !== 'completed' ||
      sale.currency !== org.currency ||
      (sale.discountMinor ?? 0) > sale.serviceMinor ||
      sale.totalMinor !==
        sale.serviceMinor -
          (sale.discountMinor ?? 0) +
          (sale.taxInclusive ? 0 : (sale.taxMinor ?? 0)) +
          retailCharge(sale.retail) +
          sale.tipMinor ||
      sale.balanceMinor !== sale.totalMinor - sale.depositAppliedMinor - (sale.coveredMinor ?? 0) ||
      coveredSaleProblem(sale)
    )
      throw new Error('Invalid sale ledger.')
  }
  for (const payment of s.payments)
    if (
      !exists(s.appointments, payment.appointmentId) ||
      payment.currency !== org.currency ||
      (payment.saleId && !exists(s.sales, payment.saleId))
    )
      throw new Error('Invalid payment link.')
  for (const appointment of s.appointments) {
    const deposits = depositsFor(appointment.id)
    if (
      deposits.some((p) => p.saleId) ||
      deposits.reduce((sum, p) => sum + p.amountMinor, 0) > appointment.bookedDepositMinor
    )
      throw new Error('Invalid deposit ledger.')
  }
  for (const sale of s.sales) {
    const a = appointmentById.get(sale.appointmentId)!
    const deposits = depositsFor(a.id).reduce((sum, p) => sum + p.amountMinor, 0)
    const settlements = paymentsBySale.get(sale.id) ?? []
    const taxable = sale.serviceMinor - (sale.discountMinor ?? 0)
    const rate = sale.taxRateBps ?? 0
    const expectedTax = Math.round(
      sale.taxInclusive ? (taxable * rate) / (10000 + rate) : (taxable * rate) / 10000,
    )
    if (
      sale.serviceMinor !== a.bookedPriceMinor ||
      deposits !== sale.depositAppliedMinor ||
      (sale.taxMinor ?? 0) !== expectedTax ||
      settlements.length !== 1 ||
      settlements[0].kind !== 'settlement' ||
      settlements[0].appointmentId !== a.id ||
      settlements[0].amountMinor !== sale.balanceMinor ||
      settlements[0].method !== sale.method
    )
      throw new Error('Inconsistent receipt and payment ledger.')
  }
  for (const payment of s.payments)
    if (payment.kind === 'settlement' && !payment.saleId) throw new Error('Unlinked settlement.')
  for (const payment of s.payments)
    if (payment.kind === 'fee') {
      const a = appointmentById.get(payment.appointmentId)!
      const charged = (paymentsByAppointment.get(a.id) ?? [])
        .filter((p) => p.kind !== 'settlement')
        .reduce((sum, p) => sum + p.amountMinor, 0)
      if (
        payment.saleId ||
        !['no_show', 'cancelled'].includes(a.status) ||
        charged > a.bookedPriceMinor
      )
        throw new Error('Invalid visit fee.')
    }
  for (const record of [...s.sales, ...s.payments])
    if (
      (record.method === 'card') !== !!record.processor ||
      (record.method === 'card' && !record.reference?.trim())
    )
      throw new Error('A card payment must carry its provider reference.')
  // A deposit paid to the old system arrives only with a carried-over visit (PILOT-03).
  for (const payment of s.payments)
    if (
      payment.method === 'previous_system' &&
      (payment.kind !== 'deposit' ||
        appointmentById.get(payment.appointmentId)?.source !== 'import' ||
        !payment.reference?.trim())
    )
      throw new Error('A carried-over deposit must belong to an imported visit.')
  if (s.sales.some((sale) => sale.method === 'previous_system'))
    throw new Error('A receipt cannot be settled by the previous system.')
  const sandbox = !s.operations || s.operations.mode === 'sandbox'
  if (
    [...s.sales, ...s.payments].some(
      (record) =>
        (record.method !== 'previous_system' && sandbox !== record.method.startsWith('demo_')) ||
        (record.method === 'external_card' && !record.reference?.trim()),
    )
  )
    throw new Error('Payment provenance does not match this workspace.')
  for (const event of s.events)
    if (
      !exists(s.clients, event.clientId) ||
      (event.appointmentId &&
        appointmentById.get(event.appointmentId)?.clientId !== event.clientId) ||
      (event.saleId && !exists(s.sales, event.saleId))
    )
      throw new Error('Broken timeline link.')
  for (const event of s.events) {
    if (
      event.allocationChange &&
      (event.type !== 'rescheduled' ||
        !event.appointmentId ||
        [event.allocationChange.from, event.allocationChange.to].some(
          (allocation) =>
            !exists(s.staff, allocation.staffId) || !exists(s.resources, allocation.resourceId),
        ))
    )
      throw new Error('Invalid appointment change history.')
  }
  for (const edge of s.relationships)
    if (
      edge.fromClientId === edge.toClientId ||
      !exists(s.clients, edge.fromClientId) ||
      !exists(s.clients, edge.toClientId)
    )
      throw new Error('Invalid relationship edge.')
  if (s.operations) {
    const o = s.operations
    for (const rows of [
      o.closures,
      o.products,
      o.movements,
      o.messages,
      o.refunds,
      o.imports ?? [],
      o.balances ?? [],
    ])
      if (new Set(rows.map((r) => r.id)).size !== rows.length)
        throw new Error('Duplicate operating record IDs.')
    for (const closure of o.closures)
      if (closure.staffId && !exists(s.staff, closure.staffId))
        throw new Error('Missing closure professional.')
    for (const movement of o.movements)
      if (
        !exists(o.products, movement.productId) ||
        (movement.appointmentId && !exists(s.appointments, movement.appointmentId))
      )
        throw new Error('Invalid stock movement.')
    for (const product of o.products)
      if (
        o.movements
          .filter((m) => m.productId === product.id)
          .reduce((sum, m) => sum + m.quantity, 0) < 0
      )
        throw new Error('Stock cannot fall below zero.')
    for (const message of o.messages) {
      const client = s.clients.find((c) => c.id === message.clientId)
      const appointment = message.appointmentId
        ? appointmentById.get(message.appointmentId)
        : undefined
      if (
        !client ||
        (message.appointmentId && appointment?.clientId !== client.id) ||
        (message.purpose === 'marketing' && message.status === 'queued' && !client.marketingConsent)
      )
        throw new Error('Invalid communication or consent.')
    }
    const history = o.scheduleHistory ?? []
    if (new Set(history.map((r) => r.id)).size !== history.length)
      throw new Error('Duplicate schedule history IDs.')
    for (const change of history) {
      const week = (value: unknown) => Array.isArray(value)
      const shapeFits =
        change.kind === 'hours'
          ? week(change.before) && week(change.after)
          : change.kind === 'staff-hours'
            ? [change.before, change.after].every((v) => v === null || week(v))
            : change.kind === 'closure-added'
              ? change.before === null && !!change.after && 'date' in change.after
              : change.kind === 'closure-removed'
                ? !!change.before && 'date' in change.before && change.after === null
                : [change.before, change.after].every((v) => !!v && 'archived' in v)
      // Professionals and rooms are archived, never deleted, so their history keeps its link.
      const subjectFits = change.kind.startsWith('staff')
        ? !!change.subjectId && exists(s.staff, change.subjectId)
        : change.kind.startsWith('resource')
          ? !!change.subjectId && exists(s.resources, change.subjectId)
          : true
      if (!shapeFits || !subjectFits) throw new Error('Invalid schedule history.')
    }
    for (const balance of o.balances ?? [])
      if (!exists(s.clients, balance.clientId) || !exists(o.imports ?? [], balance.importId))
        throw new Error('Invalid carried-over balance.')
    for (const refund of o.refunds)
      if (
        [refund.saleId, refund.paymentId, refund.counterSaleId].filter(Boolean).length !== 1 ||
        (refund.counterSaleId && !exists(s.counterSales ?? [], refund.counterSaleId)) ||
        (refund.saleId && !exists(s.sales, refund.saleId)) ||
        (refund.paymentId && !exists(s.payments, refund.paymentId)) ||
        (refund.method === 'card') !== !!refund.processor
      )
        throw new Error('Missing refunded receipt.')
    for (const payment of s.payments)
      if (
        o.refunds
          .filter((r) => r.paymentId === payment.id)
          .reduce((sum, r) => sum + r.amountMinor, 0) > payment.amountMinor
      )
        throw new Error('Refunds exceed the payment.')
    for (const sale of s.sales)
      if (
        o.refunds.filter((r) => r.saleId === sale.id).reduce((sum, r) => sum + r.amountMinor, 0) >
        sale.totalMinor - (sale.coveredMinor ?? 0)
      )
        throw new Error('Refunds exceed the receipt total.')
  }
  for (const count of s.tillCounts ?? [])
    if (tillCountProblem(count)) throw new Error('Invalid till count.')
  const plans = plansProblem(s)
  if (plans) throw new Error(plans)
  const feedback = feedbackProblem(s)
  if (feedback) throw new Error(feedback)
  const retail = retailProblem(s)
  if (retail) throw new Error(retail)
  try {
    new Intl.DateTimeFormat('en', { timeZone: org.timeZone }).format(new Date())
  } catch {
    throw new Error('Invalid venue time zone.')
  }
  return s
}
