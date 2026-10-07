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
export const SCHEDULE_HISTORY_LIMIT = 500
const scheduleValueSchema = z.union([
  weeklyHoursSchema,
  closureInputSchema.and(z.object({ id })),
  z.object({ archived: z.boolean() }),
])
/**
 * LOCAL-04: who changed the schedule, when, and what it was before and after. Optional so older
 * records still load, and bounded so a busy studio keeps the latest changes only.
 */
export const scheduleChangeSchema = z.object({
  id,
  occurredAt: z.iso.datetime(),
  actor: z.string(),
  kind: z.enum([
    'hours',
    'staff-hours',
    'closure-added',
    'closure-removed',
    'staff-archived',
    'staff-restored',
    'resource-archived',
    'resource-restored',
  ]),
  /** The professional, room or closure the change was about; absent for venue hours. */
  subjectId: id.optional(),
  summary: z.string().min(1).max(2000),
  /** Null means "nothing" (a new closure) or, for a professional's hours, "the venue's hours". */
  before: scheduleValueSchema.nullable(),
  after: scheduleValueSchema.nullable(),
})
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
export const taxSchema = z.object({
  label: z.string().max(40),
  rateBps: z.number().int().min(0).max(10000),
  inclusive: z.boolean(),
})
export type Tax = z.infer<typeof taxSchema>

export const operationsSchema = z.object({
  mode: z.enum(['sandbox', 'local']),
  bookingEnabled: z.boolean(),
  /** Ask online guests to pass a Cloudflare Turnstile check before a time is held. */
  botCheck: z.boolean().optional(),
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
      method: z.enum(['demo_card', 'demo_cash', 'cash', 'external_card']).optional(),
      createdAt: z.iso.datetime(),
      actor: z.string(),
    }),
  ),
  scheduleHistory: z.array(scheduleChangeSchema).max(SCHEDULE_HISTORY_LIMIT).optional(),
  tax: taxSchema.optional(),
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
const civilDate = z.iso.date()
// Building an Intl formatter is far more expensive than using one, and availability checks
// convert thousands of local times per request, so keep one formatter per time zone.
const localFormatters = new Map<string, Intl.DateTimeFormat>()
function localFormatter(timeZone: string) {
  let formatter = localFormatters.get(timeZone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
    localFormatters.set(timeZone, formatter)
  }
  return formatter
}
export function businessDate(s: BusinessState, now = new Date().toISOString()) {
  if (operations(s).mode === 'sandbox') return '2026-10-06'
  const parts = localFormatter(s.organisation.timeZone).formatToParts(new Date(now))
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)!.value
  return `${part('year')}-${part('month')}-${part('day')}`
}
/** Minutes past midnight on the studio's own clock, for the calendar's "now" line. */
export function businessMinutes(s: BusinessState, now = new Date().toISOString()) {
  const parts = localFormatter(s.organisation.timeZone).formatToParts(new Date(now))
  const n = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)!.value)
  return n('hour') * 60 + n('minute')
}
function localParts(instant: number, timeZone: string) {
  const parts = localFormatter(timeZone).formatToParts(new Date(instant))
  const n = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)!.value)
  return Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'))
}
/** Rejects nonexistent and repeated local times instead of silently shifting an appointment. */
export function instantFor(s: BusinessState, date: string, minute: number) {
  return instantIn(s.organisation.timeZone, date, minute)
}
/** The UTC instant of a civil time in a time zone; throws for times the clocks skip or repeat. */
export function instantIn(timeZone: string, date: string, minute: number) {
  if (
    !civilDate.safeParse(date).success ||
    !Number.isInteger(minute) ||
    minute < 0 ||
    minute >= 1440
  )
    throw new Error('Invalid local appointment time.')
  const target = Date.parse(`${date}T00:00:00Z`) + minute * 60000
  const offsets = new Set(
    [-36, -12, 0, 12, 36].map((h) => {
      const probe = target + h * 3600000
      return localParts(probe, timeZone) - probe
    }),
  )
  const matches = [...offsets]
    .map((offset) => target - offset)
    .filter((instant) => localParts(instant, timeZone) === target)
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
  if (['service', 'staff', 'resource', 'guest-notes'].includes(command.type)) return 'catalogue'
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

/**
 * The tax a visit is settled under: the basis in force when it was booked, so a guest pays the
 * price they were shown even if the studio's tax setting changes later (owner decision, 7 October
 * 2026). Visits booked before this snapshot existed follow the studio's current setting.
 */
export function visitTax(s: BusinessState, appointment: { bookedTax?: Tax | null }) {
  if (appointment.bookedTax === undefined) return operations(s).tax
  return appointment.bookedTax ?? undefined
}
