import { z } from 'zod'
import { googleBookingSchema, receptionistSettingsSchema } from './receptionistSchema'
import { aiBookingSchema } from './aiBookingSchema'
import type { BusinessState } from './model'
import { reminderSettingsSchema } from './reminderSettings'
import {
  REGION_LIMIT,
  TARGET_LIMIT,
  groupChecksSchema,
  regionSchema,
  targetSchema,
} from './groupSchema'
import { REQUEST_LIMIT, approvalRequestSchema, approvalSettingsSchema } from './approvalsSchema'
import { benchmarkSharingSchema, houseRulesSchema, lookSchema } from './brandRulesSchema'
import {
  BRANCH_VISIT_LIMIT,
  CHECKLIST_LIMIT,
  branchVisitSchema,
  checklistSchema,
} from './branchVisitSchema'
import { patchTestSettingsSchema } from './patchTestsSchema'
import { tillSettingsSchema } from './tillSchema'
import { SHIFT_LIMIT, shiftSchema } from './hoursSchema'
import { ROTA_CHANGE_LIMIT, ROTA_COMMANDS, rotaChangeSchema } from './rotaSchema'
import { NEWS_LIMIT, newsMessageSchema } from './newsSchema'
import type { RotaChange } from './rotaSchema'
import { STAFF_MOVE_LIMIT, staffMoveSchema } from './staffMovesSchema'
import type { StaffMove } from './staffMovesSchema'
import { MISSED_CALL_LIMIT, missedCallSchema } from './missedCallsSchema'
import { paymentMethodSchema, processorSchema } from './paymentMethods'
import { setupProgressSchema } from './setupSchema'
import { RENT_LIMIT, RENT_PAYMENT_LIMIT, rentPaymentSchema, rentalSchema } from './rentSchema'
import {
  COMMISSION_RATE_LIMIT,
  COMMISSION_STEPS_LIMIT,
  STAFF_TARGET_LIMIT,
  commissionRateSchema,
  commissionStepsSchema,
  staffTargetSchema,
} from './commissionSchema'
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
    /** V2: on a person's own hours, the location they work at that day. Absent means the main one. */
    locationId: id.optional(),
  })
  .refine((h) => h.closed || h.close > h.open, 'Closing time must follow opening time.')
export const weeklyHoursSchema = z
  .array(hoursSchema)
  .length(7)
  .refine((hours) => new Set(hours.map((h) => h.day)).size === 7, 'Each weekday must appear once.')
/**
 * V2: a further location of the studio. The main location stays on the organisation (its id, name,
 * address and arrival note), so a single-location studio is unchanged. Opening hours are the
 * studio's unless the location sets its own.
 */
export const LOCATION_LIMIT = 20
export const locationInputSchema = z.object({
  name: z.string().trim().min(2).max(100),
  address: z.string().trim().max(300),
  arrivalNote: z.string().trim().max(400).optional(),
  hours: weeklyHoursSchema.optional(),
  archived: z.boolean().optional(),
  /** This location's own phone and email for guests; without them guests see the studio's. */
  phone: z.string().trim().max(40).optional(),
  email: z.string().trim().max(254).optional(),
})
export const locationSchema = locationInputSchema.extend({ id })
export type Location = z.infer<typeof locationSchema>
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
  /** V2: where a room is. */
  z.object({ locationId: id }),
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
    'resource-moved',
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
  /**
   * Stage 2: the barcode printed on the product. The product command checks it (EAN-13, EAN-8
   * and UPC-A check digits) and keeps it in its normal form, once per studio.
   */
  barcode: z.string().trim().max(60).optional(),
  /** Stage 2: the product's photo, kept in the server's images table and shown only to the team. */
  imageId: z
    .string()
    .regex(/^[A-Za-z0-9-]{8,64}$/)
    .optional(),
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
/** Stage 4: new days, kind or note for time off already recorded. The person stays the same. */
export const timeOffChangeInputSchema = z
  .object({
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
  /**
   * Stage 4: changing time off keeps the earlier record, cancelled, naming the one that replaced
   * it (`changedTo`); the new record names the one it came from (`changedFrom`).
   */
  changedTo: id.optional(),
  changedFrom: id.optional(),
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
      /**
       * `returned` puts a product a guest brought back on the shelf, with its refund (V2). `moved`
       * takes stock from one location to another, as a pair sharing a `transferId`.
       */
      reason: z.enum(['received', 'consumed', 'adjustment', 'retail', 'returned', 'moved']),
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
      /** V2: where the stock is. Absent means the main location. */
      locationId: id.optional(),
      /** V2: the two halves of moving stock between locations. */
      transferId: id.optional(),
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
      /**
       * NEXT-11: an invitation to a time a cancelled visit left free: the treatment, professional,
       * day and start it names, so it is checked against the diary before approval and sending.
       */
      opening: z
        .object({
          date: z.iso.date(),
          startMinutes: z.number().int().min(0).max(1439),
          staffId: id,
          serviceId: id,
          locationId: id.optional(),
        })
        .strict()
        .optional(),
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
  /** V2: locations beyond the main one. */
  locations: z.array(locationSchema).max(LOCATION_LIMIT).optional(),
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
  /** Stage 5: whether guests can book through ChatGPT or Claude. Absent means it is off. */
  aiBooking: aiBookingSchema.optional(),
  /** V5: locations grouped into regions, and each location's monthly takings target. */
  regions: z.array(regionSchema).max(REGION_LIMIT).optional(),
  targets: z.array(targetSchema).max(TARGET_LIMIT).optional(),
  /** V5: the owner's automatic checks across locations; absent means the defaults. */
  groupChecks: groupChecksSchema.optional(),
  /** V5: branch visit checklists and the visits recorded with them. */
  checklists: z.array(checklistSchema).max(CHECKLIST_LIMIT).optional(),
  branchVisits: z.array(branchVisitSchema).max(BRANCH_VISIT_LIMIT).optional(),
  /** V5: requests needing a sign-off, and what a regional manager may approve. */
  requests: z.array(approvalRequestSchema).max(REQUEST_LIMIT).optional(),
  approvals: approvalSettingsSchema.optional(),
  /** V5: the studio's colours and the house rules every location follows. */
  look: lookSchema.optional(),
  houseRules: houseRulesSchema.optional(),
  /** V5: anonymous comparison with similar studios, only when the owner chooses to share. */
  benchmark: benchmarkSharingSchema.optional(),
  /** Stage 2: how each location's receipts print and whether its cash drawer opens by itself. */
  till: tillSettingsSchema.optional(),
  /** Set up your studio: the screen the owner picks up at. Absent until they first use it. */
  setup: setupProgressSchema.optional(),
  /** NEXT-07: hours worked, clocked in and out or added by hand, for payroll. */
  shifts: z.array(shiftSchema).max(SHIFT_LIMIT).optional(),
  /** Stage 3: single days on the rota changed from someone's usual hours, or added. */
  rotaChanges: z.array(rotaChangeSchema).max(ROTA_CHANGE_LIMIT).optional(),
  /** Stage 4: people moving to another location from a date (staffMovesSchema.ts). */
  staffMoves: z.array(staffMoveSchema).max(STAFF_MOVE_LIMIT).optional(),
  /**
   * Stage 3: rates of their own for a treatment, a kind of treatment, products or a product, steps
   * by takings, and each person's monthly target, each kept as a history like the usual rates.
   */
  commissionRates: z.array(commissionRateSchema).max(COMMISSION_RATE_LIMIT).optional(),
  commissionSteps: z.array(commissionStepsSchema).max(COMMISSION_STEPS_LIMIT).optional(),
  staffTargets: z.array(staffTargetSchema).max(STAFF_TARGET_LIMIT).optional(),
  /** Stage 4: messages from the studio to its clients, for the whole group or chosen locations. */
  news: z.array(newsMessageSchema).max(NEWS_LIMIT).optional(),
})
export type Operations = z.infer<typeof operationsSchema>
/**
 * V5: a regional manager ('regional') looks after the locations in one region. They receive only
 * their area's view, never the studio record, and record branch visits there.
 */
export type Role = 'owner' | 'manager' | 'reception' | 'practitioner' | 'regional' | 'general'
/** Each role as the team reads it. */
export const roleNames: Record<Role, string> = {
  owner: 'Owner',
  manager: 'Manager',
  reception: 'Reception',
  practitioner: 'Practitioner',
  general: 'General manager',
  regional: 'Regional manager',
}
/** The roles that receive the whole studio record (reception and general managers with some parts left out). */
export const studioRole = (role: Role) =>
  role === 'owner' || role === 'manager' || role === 'reception' || role === 'general'
/** Owners, managers and general managers (V5, who run one location): the people who lead a team. */
export const leads = (role: Role) => role === 'owner' || role === 'manager' || role === 'general'
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
/** Where a sample studio's clock stands on its sample day: 10:45, so its diary agrees with it. */
export const DEMO_MINUTES = 10 * 60 + 45
/**
 * Minutes past midnight on the studio's own clock, for the calendar's "now" line: now, or at the
 * instant given. A sample studio's clock stands still at 10:45, as its date does.
 */
export function businessMinutes(s: BusinessState, now?: string) {
  if (now === undefined && operations(s).mode === 'sandbox') return DEMO_MINUTES
  const parts = localFormatter(s.organisation.timeZone).formatToParts(new Date(now ?? Date.now()))
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
    throw new Error('That time is not valid.')
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
/** Opening hours for a day: the location's own when it sets them, otherwise the studio's. */
export function hoursFor(s: BusinessState, date: string, locationId?: string) {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay()
  const own =
    locationId && locationId !== s.organisation.locationId
      ? operations(s).locations?.find((l) => l.id === locationId)?.hours
      : undefined
  return (own ?? operations(s).hours).find((h) => h.day === day)!
}
/**
 * A person's usual hours for a day from their weekly pattern, ignoring time off. Stage 4: the
 * weekly pattern says where they work from their latest move on; a day before a move is where
 * that move found it (`movedFrom`).
 */
export function usualHoursFor(
  s: BusinessState,
  staffId: string,
  date: string,
): z.infer<typeof hoursSchema> {
  const person = s.staff.find((p) => p.id === staffId)
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay()
  const own = person?.hours?.find((h) => h.day === weekday)
  if (!own) return hoursFor(s, date)
  const before = movedFrom(s, staffId, date, weekday)
  if (before === undefined) return own
  const { locationId: _now, ...rest } = own
  void _now
  // The main location stays unnamed on hours, as everywhere else.
  return before === s.organisation.locationId ? rest : { ...rest, locationId: before }
}
// Read thousands of times a request, like the rota: the moves still standing, by person, oldest
// first. A list is never changed in place once read; the move commands always save a new one.
const moveIndex = new WeakMap<StaffMove[], Map<string, StaffMove[]>>()
/**
 * Stage 4: where a weekday was before the first move after `date`, when one moved it. Undefined
 * when no later move touched that weekday, so their weekly hours already say where it is.
 */
export function movedFrom(s: BusinessState, staffId: string, date: string, weekday: number) {
  const list = operations(s).staffMoves
  if (!list?.length) return undefined
  let index = moveIndex.get(list)
  if (!index) {
    index = new Map()
    for (const move of list)
      if (!move.cancelled) index.set(move.staffId, [...(index.get(move.staffId) ?? []), move])
    for (const moves of index.values()) moves.sort((a, b) => a.date.localeCompare(b.date))
    moveIndex.set(list, index)
  }
  for (const move of index.get(staffId) ?? []) {
    if (move.date <= date) continue
    const day = move.days.find((d) => d.day === weekday)
    if (day) return day.from
  }
  return undefined
}
/** Time off that covers a day for one person, if any (V2). */
export function timeOffOn(s: BusinessState, staffId: string, date: string) {
  return (operations(s).timeOff ?? []).find(
    (t) => !t.cancelledAt && t.staffId === staffId && t.from <= date && t.to >= date,
  )
}
// Availability asks for a person's day thousands of times a request, so the changes still in
// force are looked up by person and day. A list is never changed in place once read: the rota
// commands always save a new one.
const rotaIndex = new WeakMap<RotaChange[], Map<string, RotaChange>>()
/** Stage 3: the change on the rota for one person on one day, if one applies. */
export function rotaChangeOn(s: BusinessState, staffId: string, date: string) {
  const list = operations(s).rotaChanges
  if (!list?.length) return undefined
  let index = rotaIndex.get(list)
  if (!index) {
    index = new Map(list.filter((c) => !c.ended).map((c) => [`${c.staffId} ${c.date}`, c]))
    rotaIndex.set(list, index)
  }
  return index.get(`${staffId} ${date}`)
}
/**
 * The shared answer to "when does this person work on this day": their usual weekly hours, or the
 * day as changed on the rota (Stage 3). Every booking, move, offer, suggestion and screen reads
 * it through `staffHoursFor` and `staffLocationOn`.
 */
export function plannedHoursFor(s: BusinessState, staffId: string, date: string) {
  const usual = usualHoursFor(s, staffId, date)
  const change = rotaChangeOn(s, staffId, date)
  if (!change) return usual
  if (!change.working) return { ...usual, closed: true }
  return {
    day: usual.day,
    open: change.open!,
    close: change.close!,
    closed: false,
    ...(change.locationId ? { locationId: change.locationId } : {}),
  }
}
/** The hours a person can be booked on a day: as planned on the rota, closed while they are away. */
export function staffHoursFor(s: BusinessState, staffId: string, date: string) {
  const planned = plannedHoursFor(s, staffId, date)
  return timeOffOn(s, staffId, date) ? { ...planned, closed: true } : planned
}
/** What is on the shelf: at one location when given (V2), otherwise across the studio. */
export function stock(s: BusinessState, productId: string, locationId?: string) {
  return operations(s)
    .movements.filter(
      (m) =>
        m.productId === productId &&
        (!locationId || (m.locationId ?? s.organisation.locationId) === locationId),
    )
    .reduce((sum, m) => sum + m.quantity, 0)
}
export function permissionFor(command: { type: string; approve?: boolean }) {
  // Writing and approving in one step needs the right to approve.
  if (command.type === 'message' && command.approve) return 'message.queue'
  if (['service', 'staff', 'guest-notes', 'offer'].includes(command.type)) return 'catalogue'
  // Stage 4: rooms and chairs, which a general manager also looks after at their own location.
  if (command.type === 'resource') return 'rooms'
  // Opening hours, closures and holiday allowances are the whole studio's.
  if (['closure', 'remove-closure', 'leave-allowance'].includes(command.type)) return 'hours'
  // Stage 3 and 4: the team's days, on the rota and away, for owners and managers, and for a
  // general manager at their own location (src/domain/team.ts decides which days are theirs).
  if (
    (ROTA_COMMANDS as readonly string[]).includes(command.type) ||
    ['time-off', 'cancel-time-off', 'time-off-change'].includes(command.type)
  )
    return 'rota'
  if (command.type === 'stock-move') return 'stock'
  // Stage 4: cancelling a move still to come is part of moving someone.
  if (command.type === 'staff-move-cancel') return 'staff-move'
  // Adding a location also places its rooms, team and menu, all of which the owner may change.
  if (command.type === 'location-open') return 'location'
  // NEXT-09 and NEXT-08: booking repeat visits, or visits for several people, is booking.
  if (command.type === 'book-repeat' || command.type === 'book-together') return 'book'
  // NEXT-07: clocking in and out is for everyone in the studio; changing hours is for managers.
  if (command.type === 'clock-in' || command.type === 'clock-out') return 'clock'
  if (command.type === 'shift-save' || command.type === 'shift-remove') return 'shift-fix'
  // Stage 3: rates for a treatment or product and steps by takings are commission, which only the
  // owner sets; targets are for owners and managers.
  if (command.type === 'commission-rate' || command.type === 'commission-steps') return 'pay-rate'
  if (command.type === 'message-queue' || command.type === 'social-answer') return 'message.queue'
  if (command.type === 'special-plan' || command.type === 'special-stop') return 'special'
  // Stage 4: a message to clients is drafted by leads, approved and sent only by the owner.
  if (command.type === 'news-save' || command.type === 'news-discard') return 'news'
  if (command.type === 'news-approve') return 'news-send'
  if (command.type === 'task-add' || command.type === 'task-done') return 'task'
  if (command.type === 'missed-call-done') return 'missed-call'
  if (command.type === 'form-save' || command.type === 'form-archive') return 'forms'
  if (command.type === 'consent-wording') return 'consent-wording'
  if (command.type === 'consultation-save') return 'consultation'
  if (['reply-note', 'replies-read', 'reply-link'].includes(command.type)) return 'message'
  if (command.type === 'saved-reply-save' || command.type === 'saved-reply-remove')
    return 'saved-replies'
  // Stage 4: refund limits and the rota rule are the owner's, as the regional limit is.
  if (command.type === 'signoff-rules') return 'approval-limit'
  return command.type
}
export const commandPermission = permissionFor
/**
 * V5: permission names (see `permissionFor`) a general manager may use at all; `branchRefusal`
 * in src/domain/branch.ts then checks the location of each change.
 */
export const GENERAL_ACTIONS = [
  'read',
  'clock',
  'book',
  'reschedule',
  'cancel',
  'no-show',
  'arrive',
  'checkout',
  'deposit',
  'fee',
  'refund',
  'note',
  'client',
  'client-edit',
  'client-birthday',
  'client-area',
  'consent',
  'contact-preferences',
  'consultation',
  'patch-test',
  'patch-test-result',
  'message',
  'message.queue',
  'gift-card-sell',
  // Stage 4: only a card that belongs to their own location, to another (the server checks).
  'gift-card-move',
  'plan-sell',
  'plan-renew',
  // Stage 1: card payments for memberships sold at their location (the server checks where).
  'plan-card',
  'balance-settle',
  'task',
  'missed-call',
  'waitlist-add',
  'waitlist-offer',
  'waitlist-remove',
  'opening-invite',
  'counter-sale',
  'stock',
  'purchase-order',
  'receive-order',
  'cancel-order',
  'branch-visit',
  'branch-visit-fix',
  'request-raise',
  // Stage 4: their own team's days on the rota and time off, and the rooms and chairs at their
  // location. src/domain/team.ts decides whose days and which rooms are theirs.
  'rota',
  'rooms',
  // Stage 4: a message to their own location's clients, drafted or stopped, never approved.
  'news',
  'news-stop',
] as const

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
      // Stage 1: a declined membership card payment is noted only by the server.
      'plan-card-try',
      // Stage 4: an approved new price starts on its day by itself, only from the server.
      'request-start',
      // Stage 4: a client stops news only from the link in their own email.
      'news-unsubscribe',
    ].includes(action)
  )
    return false
  // V5: a regional manager records branch visits and raises and signs off requests, only at their
  // area's locations (the server checks which).
  if (role === 'regional')
    return ['branch-visit', 'branch-visit-fix', 'request-raise', 'request-decide'].includes(action)
  // V5: a general manager works as a manager at their own location only (the server checks where).
  if (role === 'general') return (GENERAL_ACTIONS as readonly string[]).includes(action)
  if (role === 'owner') return true
  if (
    [
      'request-decide',
      'approval-limit',
      'house-rules',
      'benchmark-sharing',
      'membership',
      'restore',
      'organisation',
      'tax',
      'google-booking',
      // Stage 5: letting ChatGPT or Claude book for guests is the owner's choice, as Google is.
      'ai-booking',
      'pay-rate',
      'pay-rules',
      'location',
      'accounting-settings',
      'region',
      'region-remove',
      'targets',
      'group-checks',
      // Stage 4: only the owner approves a message to clients, which sends it.
      'news-send',
      // The setup screens include the studio's details and tax, which only the owner sets.
      'setup-step',
    ].includes(action)
  )
    return false
  if (role === 'manager') return true
  if (
    [
      'catalogue',
      'hours',
      'rota',
      'rooms',
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
      // Stage 1: setting a membership to be paid from a saved card is for managers and owners.
      'plan-card',
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
      // Stage 4: moving a gift card or a team member to another location.
      'gift-card-move',
      'staff-move',
      'patch-test-settings',
      'forms',
      'consent-wording',
      'receptionist',
      'checklist-save',
      'checklist-archive',
      'branch-visit',
      'branch-visit-fix',
      'request-raise',
      'studio-look',
      'till-settings',
      'shift-fix',
      'staff-target',
      // Stage 4: messages to many clients are for the owner and the people who lead a team.
      'news',
      'news-stop',
    ].includes(action)
  )
    return false
  if (role === 'reception') return true
  return ['read', 'arrive', 'note', 'patch-test', 'patch-test-result', 'clock'].includes(action)
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
