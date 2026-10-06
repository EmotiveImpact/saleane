import { z } from 'zod'
import type { BusinessState } from './model'

const id = z.string().min(1).max(150)
const money = z.number().int().nonnegative().max(100_000_000)
export const hoursSchema = z
  .object({
    day: z.number().int().min(0).max(6),
    open: z.number().int().min(0).max(1439),
    close: z.number().int().min(1).max(1440),
    closed: z.boolean(),
  })
  .refine((h) => h.closed || h.close > h.open, 'Closing time must follow opening time.')
export const weeklyHoursSchema = z
  .array(hoursSchema)
  .length(7)
  .refine((hours) => new Set(hours.map((h) => h.day)).size === 7, 'Each weekday must appear once.')
export const closureInputSchema = z
  .object({
    date: z.iso.date(),
    staffId: id.optional(),
    startMinutes: z.number().int().min(0).max(1439),
    endMinutes: z.number().int().min(1).max(1440),
    reason: z.string().trim().min(2).max(150),
  })
  .refine((c) => c.endMinutes > c.startMinutes, 'A closure must end after it starts.')
export const messageInputSchema = z.object({
  clientId: id,
  appointmentId: id.optional(),
  purpose: z.enum(['appointment', 'marketing']),
  subject: z.string().trim().min(1).max(150),
  body: z.string().trim().min(1).max(3000),
})
export const productInputSchema = z.object({
  name: z.string().trim().min(2).max(100),
  sku: z.string().trim().max(50),
  priceMinor: money,
  reorderAt: z.number().int().nonnegative().max(10000),
  archived: z.boolean(),
})
export const operationsSchema = z.object({
  mode: z.enum(['sandbox', 'local']),
  bookingEnabled: z.boolean(),
  hours: weeklyHoursSchema,
  closures: z.array(closureInputSchema.and(z.object({ id }))),
  products: z.array(productInputSchema.extend({ id })),
  movements: z.array(
    z.object({
      id,
      productId: id,
      quantity: z.number().int().min(-100000).max(100000),
      reason: z.enum(['received', 'consumed', 'adjustment', 'retail']),
      note: z.string().max(300),
      createdAt: z.iso.datetime(),
      actor: z.string(),
      appointmentId: id.optional(),
    }),
  ),
  messages: z.array(
    messageInputSchema.extend({
      id,
      status: z.enum(['draft', 'queued', 'suppressed']),
      createdAt: z.iso.datetime(),
      actor: z.string(),
    }),
  ),
  refunds: z.array(
    z.object({
      id,
      saleId: id,
      amountMinor: money.refine((v) => v > 0),
      reason: z.string().trim().min(3).max(300),
      reference: z.string().trim().min(1).max(150),
      createdAt: z.iso.datetime(),
      actor: z.string(),
    }),
  ),
  tax: z
    .object({
      label: z.string().max(40),
      rateBps: z.number().int().min(0).max(10000),
      inclusive: z.boolean(),
    })
    .optional(),
})
export type Operations = z.infer<typeof operationsSchema>
export type Role = 'owner' | 'manager' | 'reception' | 'practitioner'
export function defaultOperations(mode: Operations['mode'] = 'sandbox'): Operations {
  return {
    mode,
    bookingEnabled: true,
    hours: Array.from({ length: 7 }, (_, day) => ({ day, open: 540, close: 1080, closed: false })),
    closures: [],
    products: [],
    movements: [],
    messages: [],
    refunds: [],
  }
}
export function operations(s: BusinessState): Operations {
  return s.operations ?? defaultOperations()
}
export function businessDate(s: BusinessState, now = new Date().toISOString()) {
  if (operations(s).mode === 'sandbox') return '2026-10-06'
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: s.organisation.timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(now))
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)!.value
  return `${part('year')}-${part('month')}-${part('day')}`
}
function localParts(instant: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(instant))
  const n = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)!.value)
  return Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'))
}
/** Rejects nonexistent and repeated local times instead of silently shifting an appointment. */
export function instantFor(s: BusinessState, date: string, minute: number) {
  if (
    !z.iso.date().safeParse(date).success ||
    !Number.isInteger(minute) ||
    minute < 0 ||
    minute >= 1440
  )
    throw new Error('Invalid local appointment time.')
  const target = Date.parse(`${date}T00:00:00Z`) + minute * 60000
  const offsets = new Set(
    [-36, -12, 0, 12, 36].map((h) => {
      const probe = target + h * 3600000
      return localParts(probe, s.organisation.timeZone) - probe
    }),
  )
  const matches = [...offsets]
    .map((offset) => target - offset)
    .filter((instant) => localParts(instant, s.organisation.timeZone) === target)
  if (matches.length !== 1)
    throw new Error(
      'This local time is unavailable because the clocks change. Choose another time.',
    )
  return new Date(matches[0]).toISOString()
}
export function hoursFor(s: BusinessState, date: string) {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay()
  return operations(s).hours.find((h) => h.day === day)!
}
export function staffHoursFor(s: BusinessState, staffId: string, date: string) {
  const person = s.staff.find((p) => p.id === staffId)
  return (
    person?.hours?.find((h) => h.day === new Date(`${date}T12:00:00Z`).getUTCDay()) ??
    hoursFor(s, date)
  )
}
export function stock(s: BusinessState, productId: string) {
  return operations(s)
    .movements.filter((m) => m.productId === productId)
    .reduce((sum, m) => sum + m.quantity, 0)
}
export function permissionFor(command: { type: string }) {
  if (['service', 'staff', 'resource'].includes(command.type)) return 'catalogue'
  if (['closure', 'remove-closure'].includes(command.type)) return 'hours'
  if (command.type === 'message-queue') return 'message.queue'
  return command.type
}
export const commandPermission = permissionFor
export function can(role: Role, action: string) {
  if (role === 'owner') return true
  if (['membership', 'restore', 'organisation', 'tax'].includes(action)) return false
  if (role === 'manager') return true
  if (
    [
      'catalogue',
      'hours',
      'refund',
      'stock',
      'product',
      'message.queue',
      'import-clients',
    ].includes(action)
  )
    return false
  if (role === 'reception') return true
  return ['read', 'arrive', 'note'].includes(action)
}
