import { z } from 'zod'
import { googleBookingSchema, receptionistSettingsSchema } from './receptionistSchema'
import type { BusinessState } from './model'
import { reminderSettingsSchema } from './reminderSettings'
import { patchTestSettingsSchema } from './patchTestsSchema'
import { MISSED_CALL_LIMIT, missedCallSchema } from './missedCallsSchema'
import { paymentMethodSchema, processorSchema } from './paymentMethods'
import { RENT_LIMIT, RENT_PAYMENT_LIMIT, rentPaymentSchema, rentalSchema } from './rentSchema'
import {
  ACCOUNTING_EXPORT_LIMIT,
  accountingExportSchema,
  accountingSettingsSchema,
} from './accountsSchema'
import {
  ORDER_LIMIT,
  SUPPLIER_LIMIT,
  purchaseOrderSchema,
  supplierSchema,
} from './purchasingSchema'

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
  /** V1.5: how it goes once approved. Absent means email, as drafts written before it did. */
  channel: z.enum(['email', 'sms']).optional(),
  subject: z.string().trim().min(1).max(150),
  body: z.string().trim().min(1).max(3000),
})
export const productInputSchema = z.object({
  name: z.string().trim().min(2).max(100),
  sku: z.string().trim().max(50),
  priceMinor: money,
  reorderAt: z.number().int().nonnegative().max(10000),
  archived: z.boolean(),
  /** V2: sold at the till. `false` marks a product only used in treatments. Absent means sold. */
  forSale: z.boolean().optional(),
  /** V2: what the studio pays the supplier for one, for stock value. Never shown to guests. */
  costMinor: money.optional(),
  /** V2: who the studio orders it from, and how many it usually orders. */
  supplierId: id.optional(),
  reorderQuantity: z.number().int().min(1).max(10000).optional(),
})
export const protectionSchema = z
  .object({
    /** Offer guests a way to save a card for their visit. */
    saveCard: z.boolean(),
    /** Share of the booked price the studio may charge for a no-show or a late cancellation. */
    feePercent: z.number().int().min(0).max(100),
  })
  .strict()
export type Protection = z.infer<typeof protectionSchema>
export const taxSchema = z.object({
  label: z.string().max(40),
  rateBps: z.number().int().min(0).max(10000),
  inclusive: z.boolean(),
})
export type Tax = z.infer<typeof taxSchema>

export const importKinds = ['clients', 'services', 'appointments', 'balances'] as const
export const importBatchSchema = z.object({
  id,
  kind: z.enum(importKinds),
  source: z.string().trim().min(2).max(100),
  createdAt: z.iso.datetime(),
  actor: z.string(),
  /** The records this import created, so the log can say what still stands. */
  recordIds: z.array(id).max(500),
  /** Money the imported rows carry: visit prices, or balances held. */
  totalMinor: money,
  /** Deposits already paid to the previous system, for an appointment import. */
  depositsMinor: money.optional(),
})
export type ImportBatch = z.infer<typeof importBatchSchema>
export const openingBalanceSchema = z.object({
  id,
  clientId: id,
  importId: id,
  /** `credit` is the studio's to give back or use; `owed` is the client's to pay. */
  kind: z.enum(['credit', 'owed']),
  amountMinor: money.refine((v) => v > 0),
  note: z.string().trim().max(200),
  createdAt: z.iso.datetime(),
  actor: z.string(),
  /** Set once staff record that the balance was used, paid or returned. Never deleted. */
  settled: z
    .object({ at: z.iso.datetime(), actor: z.string(), note: z.string().trim().min(2).max(200) })
    .optional(),
})
export type OpeningBalance = z.infer<typeof openingBalanceSchema>

/**
 * V2: what one person earns as commission, from a date onwards. A change adds a new row, so past
 * pay periods keep the rate that applied then. Basis points: 4000 is 40%.
 */
/**
 * V2: a person away for whole days, such as a holiday or sick leave. They are not booked on those
 * days. Cancelling keeps the record, marked with who cancelled it and when.
 */
export const TIME_OFF_LIMIT = 2000
export const TIME_OFF_DAYS = 62
export const timeOffKinds = ['holiday', 'sick', 'other'] as const
export const timeOffInputSchema = z
  .object({
    staffId: id,
    from: z.iso.date(),
    to: z.iso.date(),
    kind: z.enum(timeOffKinds),
    note: z.string().trim().max(150).optional(),
  })
  .refine((t) => t.to >= t.from, 'Time off must end on or after the day it starts.')
export const timeOffSchema = z.object({
  id,
  staffId: id,
  from: z.iso.date(),
  to: z.iso.date(),
  kind: z.enum(timeOffKinds),
  note: z.string().max(150).optional(),
  createdAt: z.iso.datetime(),
  actor: z.string(),
  cancelledAt: z.iso.datetime().optional(),
  cancelledBy: z.string().optional(),
})
export type TimeOff = z.infer<typeof timeOffSchema>

export const PAY_RATE_LIMIT = 2000
export const payRateSchema = z.object({
  id,
  staffId: id,
  serviceBps: z.number().int().min(0).max(10000),
  productBps: z.number().int().min(0).max(10000),
  from: z.iso.date(),
  createdAt: z.iso.datetime(),
  actor: z.string(),
})
export type PayRate = z.infer<typeof payRateSchema>

/** V2: how the studio treats money given back and tips, kept as a history like the rates. */
export const tipSharing = ['person', 'pool'] as const
export const tipPoolPeriods = ['day', 'week', 'month'] as const
export const payRulesInputSchema = z.object({
  /** Money given back comes off the commission ('commission'), or the studio absorbs it ('studio'). */
  refunds: z.enum(['commission', 'studio']),
  /** Tips go to the person who did the job, or into a pot shared by everyone who worked. */
  tips: z.enum(tipSharing),
  pool: z.enum(tipPoolPeriods),
  from: z.iso.date(),
})
export const payRulesSchema = payRulesInputSchema.extend({
  id,
  createdAt: z.iso.datetime(),
  actor: z.string(),
})
export type PayRules = z.infer<typeof payRulesSchema>
export const PAY_RULES_LIMIT = 500

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
      /** `returned` puts a product a guest brought back on the shelf, with its refund (V2). */
      reason: z.enum(['received', 'consumed', 'adjustment', 'retail', 'returned']),
      note: z.string().max(300),
      createdAt: z.iso.datetime(),
      actor: z.string(),
      appointmentId: id.optional(),
      /** V2: the receipt that sold it, for a `retail` movement made at checkout. */
      saleId: id.optional(),
      /** V2: the walk-in sale that sold it, when it was sold without a visit. */
      counterSaleId: id.optional(),
      /** V2: the refund a `returned` movement came back with. */
      refundId: id.optional(),
      /** V2: the supplier order a delivery arrived on. */
      purchaseOrderId: id.optional(),
    }),
  ),
  messages: z.array(
    messageInputSchema.extend({
      id,
      status: z.enum(['draft', 'queued', 'suppressed']),
      createdAt: z.iso.datetime(),
      actor: z.string(),
      /**
       * V1.5: when it was approved for the outbox to send. Messages queued before the outbox took
       * them have none, and stay queued and unsent rather than going out unexpectedly.
       */
      approvedAt: z.iso.datetime().optional(),
    }),
  ),
  refunds: z.array(
    z.object({
      id,
      /** A refund returns money from one receipt, or from one deposit or fee payment (PILOT-02). */
      saleId: id.optional(),
      paymentId: id.optional(),
      /** V2: or from a walk-in sale of products. */
      counterSaleId: id.optional(),
      amountMinor: money.refine((v) => v > 0),
      reason: z.string().trim().min(3).max(300),
      reference: z.string().trim().min(1).max(150),
      method: paymentMethodSchema.optional(),
      processor: processorSchema.optional(),
      createdAt: z.iso.datetime(),
      actor: z.string(),
    }),
  ),
  scheduleHistory: z.array(scheduleChangeSchema).max(SCHEDULE_HISTORY_LIMIT).optional(),
  tax: taxSchema.optional(),
  /** Appointment confirmations and reminders (PILOT-01). Absent means the defaults apply. */
  reminders: reminderSettingsSchema.optional(),
  /** No-show protection (PILOT-02). Absent means no card is asked for and no fee applies. */
  protection: protectionSchema.optional(),
  /** Reviewed imports from the studio's previous system, kept as a log (PILOT-03). */
  imports: z.array(importBatchSchema).optional(),
  /** Credit or money owed that the previous system held for a client (PILOT-03). */
  balances: z.array(openingBalanceSchema).optional(),
  /** V2: commission rates per person, kept as a history. */
  payRates: z.array(payRateSchema).max(PAY_RATE_LIMIT).optional(),
  payRules: z.array(payRulesSchema).max(PAY_RULES_LIMIT).optional(),
  /** V2: holidays, sickness and other days away, and each person's yearly holiday allowance. */
  timeOff: z.array(timeOffSchema).max(TIME_OFF_LIMIT).optional(),
  /** V2: chairs and rooms rented to self-employed people, and the rent they have paid. */
  suppliers: z.array(supplierSchema).max(SUPPLIER_LIMIT).optional(),
  purchaseOrders: z.array(purchaseOrderSchema).max(ORDER_LIMIT).optional(),
  /** V2: the accounting software and account codes, and batches prepared for it. */
  accounting: accountingSettingsSchema.optional(),
  accountingExports: z.array(accountingExportSchema).max(ACCOUNTING_EXPORT_LIMIT).optional(),
  rentals: z.array(rentalSchema).max(RENT_LIMIT).optional(),
  rentPayments: z.array(rentPaymentSchema).max(RENT_PAYMENT_LIMIT).optional(),
  leaveAllowances: z.array(z.object({ staffId: id, days: z.number().min(0).max(366) })).optional(),
  /** V1.5: how long before a visit a patch test is needed and how long a clear one lasts. */
  patchTests: patchTestSettingsSchema.optional(),
  /** V1.5: calls the studio missed, to call back and, if switched on, to text back. */
  missedCalls: z.array(missedCallSchema).max(MISSED_CALL_LIMIT).optional(),
  /** V4: the AI receptionist on the booking page. Absent means it is off. */
  receptionist: receptionistSettingsSchema.optional(),
  googleBooking: googleBookingSchema.optional(),
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
/** A person's usual hours for a day from their weekly pattern, ignoring time off. */
export function usualHoursFor(s: BusinessState, staffId: string, date: string) {
  const person = s.staff.find((p) => p.id === staffId)
  return (
    person?.hours?.find((h) => h.day === new Date(`${date}T12:00:00Z`).getUTCDay()) ??
    hoursFor(s, date)
  )
}
/** Time off that covers a day for one person, if any (V2). */
export function timeOffOn(s: BusinessState, staffId: string, date: string) {
  return (operations(s).timeOff ?? []).find(
    (t) => !t.cancelledAt && t.staffId === staffId && t.from <= date && t.to >= date,
  )
}
/** The hours a person can be booked on a day: their usual hours, closed while they are away. */
export function staffHoursFor(s: BusinessState, staffId: string, date: string) {
  const usual = usualHoursFor(s, staffId, date)
  return timeOffOn(s, staffId, date) ? { ...usual, closed: true } : usual
}
export function stock(s: BusinessState, productId: string) {
  return operations(s)
    .movements.filter((m) => m.productId === productId)
    .reduce((sum, m) => sum + m.quantity, 0)
}
export function permissionFor(command: { type: string; approve?: boolean }) {
  // Writing and approving in one step needs the right to approve.
  if (command.type === 'message' && command.approve) return 'message.queue'
  if (['service', 'staff', 'resource', 'guest-notes', 'offer'].includes(command.type))
    return 'catalogue'
  if (
    ['closure', 'remove-closure', 'time-off', 'cancel-time-off', 'leave-allowance'].includes(
      command.type,
    )
  )
    return 'hours'
  if (command.type === 'message-queue') return 'message.queue'
  if (command.type === 'special-plan' || command.type === 'special-stop') return 'special'
  if (command.type === 'task-add' || command.type === 'task-done') return 'task'
  if (command.type === 'missed-call-done') return 'missed-call'
  if (command.type === 'form-save' || command.type === 'form-archive') return 'forms'
  if (command.type === 'consent-wording') return 'consent-wording'
  if (command.type === 'consultation-save') return 'consultation'
  if (['reply-note', 'replies-read', 'reply-link'].includes(command.type)) return 'message'
  if (command.type === 'saved-reply-save' || command.type === 'saved-reply-remove')
    return 'saved-replies'
  return command.type
}
export const commandPermission = permissionFor
export function can(role: Role, action: string) {
  // Feedback, a guest's own waitlist choices, forms, "I've arrived" and stopping email news come
  // only from their private link.
  if (
    [
      'feedback',
      'waitlist-join',
      'waitlist-leave',
      'guest-here',
      'form-submit',
      'guest-consent-stop',
      // V1.5: a guest's reply arrives only from the studio's email or text line.
      'reply-received',
    ].includes(action)
  )
    return false
  if (role === 'owner') return true
  if (
    [
      'membership',
      'restore',
      'organisation',
      'tax',
      'google-booking',
      'pay-rate',
      'pay-rules',
      'accounting-settings',
    ].includes(action)
  )
    return false
  if (role === 'manager') return true
  if (
    [
      'catalogue',
      'hours',
      'refund',
      'stock',
      'product',
      'message.queue',
      'saved-replies',
      'import-clients',
      'import-services',
      'import-appointments',
      'import-balances',
      'reminders',
      'fee',
      'protection',
      'plan-cancel',
      'special',
      'rental',
      'end-rental',
      'rent-payment',
      'supplier',
      'purchase-order',
      'receive-order',
      'cancel-order',
      'accounting-export',
      'gift-card-extend',
      'gift-card-cancel',
      'patch-test-settings',
      'forms',
      'consent-wording',
      'receptionist',
    ].includes(action)
  )
    return false
  if (role === 'reception') return true
  return ['read', 'arrive', 'note', 'patch-test', 'patch-test-result'].includes(action)
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
