import { z } from 'zod'

export const DEMO_DATE = '2026-10-06'
export const OPEN_MINUTES = 9 * 60
export const CLOSE_MINUTES = 18 * 60
export type Region = 'UK' | 'US'
const id = z.string().min(1)
const minor = z.number().int().nonnegative().max(100_000_000)
const civilDate = z.iso.date()
const scoped = { id, organisationId: id }

export const organisationSchema = z.object({
  id,
  name: z.string(),
  region: z.enum(['UK', 'US']),
  currency: z.enum(['GBP', 'USD']),
  locale: z.enum(['en-GB', 'en-US']),
  timeZone: z.string(),
  locationId: id,
  locationName: z.string(),
  address: z.string(),
})
export const clientSchema = z.object({
  ...scoped,
  name: z.string().min(2).max(100),
  email: z.email(),
  phone: z.string().max(30),
  preferences: z.string().max(1000),
  marketingConsent: z.boolean(),
  createdAt: z.iso.datetime(),
})
export const serviceSchema = z.object({
  ...scoped,
  name: z.string(),
  description: z.string(),
  category: z.enum(['Skin', 'Body', 'Hair']),
  durationMinutes: z.number().int().positive(),
  bufferMinutes: z.number().int().nonnegative(),
  priceMinor: minor,
  depositMinor: minor,
  resourceType: z.enum(['treatment', 'chair']),
})
export const staffSchema = z.object({
  ...scoped,
  name: z.string(),
  role: z.string(),
  serviceIds: z.array(id),
  tone: z.enum(['sage', 'blue', 'sand']),
})
export const resourceSchema = z.object({
  ...scoped,
  name: z.string(),
  type: z.enum(['treatment', 'chair']),
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
  status: z.enum(['confirmed', 'arrived', 'completed', 'cancelled']),
  source: z.enum(['desk', 'online', 'rebook']),
  createdAt: z.iso.datetime(),
  rebookedFromId: id.optional(),
  bookedPriceMinor: minor,
  bookedDepositMinor: minor,
  bookedDurationMinutes: z.number().int().positive(),
  bookedBufferMinutes: z.number().int().nonnegative(),
})
export const saleSchema = z.object({
  ...scoped,
  appointmentId: id,
  currency: z.enum(['GBP', 'USD']),
  serviceMinor: minor,
  tipMinor: minor,
  depositAppliedMinor: minor,
  totalMinor: minor,
  balanceMinor: minor,
  paidAt: z.iso.datetime(),
  method: z.enum(['demo_card', 'demo_cash']),
})
export const paymentSchema = z.object({
  ...scoped,
  appointmentId: id,
  saleId: id.optional(),
  kind: z.enum(['deposit', 'settlement']),
  amountMinor: minor,
  currency: z.enum(['GBP', 'USD']),
  recordedAt: z.iso.datetime(),
  method: z.enum(['demo_card', 'demo_cash']),
})
export const eventSchema = z.object({
  ...scoped,
  clientId: id,
  appointmentId: id.optional(),
  saleId: id.optional(),
  type: z.enum(['booked', 'arrived', 'checkout', 'note', 'consent', 'relationship']),
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
  ]
  for (const collection of collections) {
    if (new Set(collection.map((item) => item.id)).size !== collection.length)
      throw new Error('Duplicate record IDs.')
    if (collection.some((item) => item.organisationId !== org.id))
      throw new Error('Foreign workspace record.')
  }
  const exists = (rows: { id: string }[], recordId: string) =>
    rows.some((row) => row.id === recordId)
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
    if (a.rebookedFromId && !exists(s.appointments, a.rebookedFromId))
      throw new Error('Broken rebooking link.')
    if (a.bookedDepositMinor > a.bookedPriceMinor) throw new Error('Invalid booked deposit.')
  }
  if (new Set(s.sales.map((sale) => sale.appointmentId)).size !== s.sales.length)
    throw new Error('Duplicate appointment settlement.')
  for (const sale of s.sales) {
    const appointment = s.appointments.find((a) => a.id === sale.appointmentId)
    if (
      !appointment ||
      appointment.status !== 'completed' ||
      sale.currency !== org.currency ||
      sale.totalMinor !== sale.serviceMinor + sale.tipMinor ||
      sale.balanceMinor !== sale.totalMinor - sale.depositAppliedMinor
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
  for (const event of s.events)
    if (
      !exists(s.clients, event.clientId) ||
      (event.appointmentId && !exists(s.appointments, event.appointmentId)) ||
      (event.saleId && !exists(s.sales, event.saleId))
    )
      throw new Error('Broken timeline link.')
  for (const edge of s.relationships)
    if (
      edge.fromClientId === edge.toClientId ||
      !exists(s.clients, edge.fromClientId) ||
      !exists(s.clients, edge.toClientId)
    )
      throw new Error('Invalid relationship edge.')
  return s
}
