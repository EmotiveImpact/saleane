import { z } from 'zod'
import { clientSchema, resourceSchema, serviceSchema, staffSchema } from './model'
import {
  closureInputSchema,
  messageInputSchema,
  productInputSchema,
  weeklyHoursSchema,
} from './operations'
const id = z.string().min(1).max(150)
const money = z.number().int().nonnegative().max(100_000_000)
const method = z.enum(['demo_card', 'demo_cash', 'cash', 'external_card'])
export const contactSchema = clientSchema
  .pick({ name: true, email: true, phone: true, marketingConsent: true })
  .extend({
    phone: z
      .string()
      .trim()
      .max(30)
      .refine(
        (value) => /^\+[1-9]\d{6,14}$/.test(value.replace(/[ ()-]/g, '')),
        'Use an international telephone number with a country code.',
      ),
  })
export const importContactSchema = contactSchema
export const bookingSchema = z.object({
  resourceId: id.optional(),
  serviceId: id,
  staffId: id,
  date: z.iso.date(),
  startMinutes: z.number().int().min(0).max(1439),
  clientId: id.optional(),
  contact: contactSchema.optional(),
  source: z.enum(['desk', 'online', 'rebook']),
  rebookedFromId: id.optional(),
})
export const operatingCommandSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('organisation'),
    name: z.string().trim().min(2).max(100),
    locationName: z.string().trim().min(2).max(100),
    address: z.string().trim().max(300),
    timeZone: z.string().min(1).max(80),
    bookingEnabled: z.boolean(),
    botCheck: z.boolean().optional(),
  }),
  z.object({ type: z.literal('hours'), hours: weeklyHoursSchema }),
  z.object({ type: z.literal('closure'), input: closureInputSchema }),
  z.object({ type: z.literal('remove-closure'), closureId: id }),
  z.object({
    type: z.literal('service'),
    id: id.optional(),
    input: serviceSchema.omit({ id: true, organisationId: true }),
  }),
  z.object({
    type: z.literal('staff'),
    id: id.optional(),
    input: staffSchema.omit({ id: true, organisationId: true }),
  }),
  z.object({
    type: z.literal('resource'),
    id: id.optional(),
    input: resourceSchema.omit({ id: true, organisationId: true }),
  }),
  z.object({ type: z.literal('message'), id: id.optional(), input: messageInputSchema }),
  z.object({ type: z.literal('message-queue'), messageId: id }),
  z.object({
    type: z.literal('refund'),
    saleId: id,
    amountMinor: money.refine((n) => n > 0),
    reason: z.string().trim().min(3).max(300),
    reference: z.string().trim().min(1).max(150),
  }),
  z.object({
    type: z.literal('deposit'),
    appointmentId: id,
    amountMinor: money.refine((n) => n > 0),
    method,
    reference: z.string().trim().max(150).optional(),
  }),
  z.object({
    type: z.literal('tax'),
    label: z.string().trim().max(40),
    rateBps: z.number().int().min(0).max(10000),
    inclusive: z.boolean(),
  }),
  z.object({ type: z.literal('product'), id: id.optional(), input: productInputSchema }),
  z.object({
    type: z.literal('stock'),
    productId: id,
    quantity: z
      .number()
      .int()
      .min(-100000)
      .max(100000)
      .refine((n) => n !== 0),
    reason: z.enum(['received', 'consumed', 'adjustment', 'retail']),
    note: z.string().trim().min(2).max(300),
    appointmentId: id.optional(),
  }),
  z.object({
    type: z.literal('client-edit'),
    clientId: id,
    contact: contactSchema,
    preferences: z.string().trim().max(1000),
  }),
  z.object({
    type: z.literal('import-clients'),
    source: z.string().trim().min(2).max(100).optional(),
    contacts: z.array(contactSchema).min(1).max(500),
    reviewed: z.literal(true),
  }),
])
export const commandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('book'), input: bookingSchema }),
  z.object({
    type: z.literal('reschedule'),
    resourceId: id.optional(),
    appointmentId: id,
    date: z.iso.date(),
    startMinutes: z.number().int().min(0).max(1439),
    staffId: id,
  }),
  z.object({
    type: z.literal('cancel'),
    appointmentId: id,
    reason: z.string().trim().min(2).max(300),
  }),
  z.object({
    type: z.literal('no-show'),
    appointmentId: id,
    reason: z.string().trim().min(2).max(300),
  }),
  z.object({ type: z.literal('arrive'), appointmentId: id }),
  z.object({
    type: z.literal('checkout'),
    appointmentId: id,
    tipMinor: money,
    method,
    reference: z.string().trim().max(150).optional(),
    discountMinor: money.optional(),
  }),
  z.object({ type: z.literal('note'), clientId: id, text: z.string().trim().min(2).max(1000) }),
  z.object({ type: z.literal('client'), contact: contactSchema, referredById: id.optional() }),
  z.object({ type: z.literal('consent'), clientId: id, consent: z.boolean() }),
  ...operatingCommandSchema.options,
])
export type BookingInput = z.infer<typeof bookingSchema>
export type ContactInput = z.infer<typeof contactSchema>
export type Command = z.infer<typeof commandSchema>
export type OperatingCommand = z.infer<typeof operatingCommandSchema>
