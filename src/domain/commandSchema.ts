import { z } from 'zod'
import { missedCallSources } from './missedCallsSchema'
import { offerInputSchema } from './plansSchema'
import { specialInputSchema } from './specialsSchema'
import { taskInputSchema } from './tasksSchema'
import { waitlistInputSchema, waitlistTimesSchema } from './waitlistSchema'
import { giftCardInputSchema } from './giftCardsSchema'
import {
  patchTestInputSchema,
  patchTestResultSchema,
  patchTestSettingsSchema,
} from './patchTestsSchema'
import { formAnswersSchema, formContentSchema, formSettingsSchema } from './formsSchema'
import { feedbackInputSchema } from './feedback'
import {
  GUEST_NOTE_LIMIT,
  bookingChannels,
  paymentMethodSchema,
  processorSchema,
  clientSchema,
  resourceSchema,
  serviceSchema,
  staffSchema,
} from './model'
import {
  closureInputSchema,
  messageInputSchema,
  payRulesInputSchema,
  protectionSchema,
  productInputSchema,
  timeOffInputSchema,
  weeklyHoursSchema,
} from './operations'
import { tillCountCommandSchema } from './tillCount'
import { retailItemsSchema } from './retailSchema'
import { rentMethods, rentalInputSchema } from './rentSchema'
import { orderLinesSchema, supplierInputSchema } from './purchasingSchema'
import { accountingProviders, accountingSettingsSchema } from './accountsSchema'
import { reminderSettingsSchema } from './reminderSettings'
import { CONSENT_TEXT_LIMIT } from './consentSchema'
import { consultationContentSchema } from './consultationsSchema'
const id = z.string().min(1).max(150)
const money = z.number().int().nonnegative().max(100_000_000)
const method = paymentMethodSchema
/** Set only by the server when a payment provider took the money; the API refuses it from a page. */
const processor = processorSchema.optional()
const importSource = z.string().trim().min(2).max(100)
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
  channel: z.enum(bookingChannels).optional(),
  rebookedFromId: id.optional(),
  /** V1.5: the waitlist request this booking fills. */
  waitlistId: id.optional(),
  /** V1.5: the missed call this booking answers. */
  callId: id.optional(),
  /** V1.5: the version of the email news wording the guest was shown, when they ticked it. */
  consentVersion: z.number().int().min(1).optional(),
  /** V1.5: the consultation this visit comes from; the booking keeps its current version. */
  consultationId: id.optional(),
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
    /** V1.5: the public review page; empty removes it. Absent leaves it as it is. */
    reviewUrl: z.string().trim().max(300).optional(),
  }),
  z.object({ type: z.literal('hours'), hours: weeklyHoursSchema }),
  // Guest-facing "before you arrive" notes; an empty note removes it.
  z.object({
    type: z.literal('guest-notes'),
    arrivalNote: z.string().trim().max(GUEST_NOTE_LIMIT),
    prepNotes: z
      .array(z.object({ serviceId: id, note: z.string().trim().max(GUEST_NOTE_LIMIT) }))
      .max(500)
      .refine(
        (rows) => new Set(rows.map((row) => row.serviceId)).size === rows.length,
        'Each service appears once.',
      ),
    /** V1.5: care advice emailed after the visit. Absent leaves every note as it is. */
    aftercareNotes: z
      .array(z.object({ serviceId: id, note: z.string().trim().max(GUEST_NOTE_LIMIT) }))
      .max(500)
      .refine(
        (rows) => new Set(rows.map((row) => row.serviceId)).size === rows.length,
        'Each service appears once.',
      )
      .optional(),
  }),
  z.object({ type: z.literal('closure'), input: closureInputSchema }),
  z.object({ type: z.literal('remove-closure'), closureId: id }),
  z.object({
    type: z.literal('service'),
    id: id.optional(),
    // A blank "usually back after" clears it, so null is allowed here.
    input: serviceSchema
      .omit({ id: true, organisationId: true })
      .extend({ returnWeeks: z.number().int().min(1).max(52).nullable().optional() }),
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
  // PILOT-01: the studio's confirmation and reminder settings.
  z.object({ type: z.literal('reminders'), settings: reminderSettingsSchema }),
  // PILOT-01: a client's own wish about appointment emails and texts.
  z.object({
    type: z.literal('contact-preferences'),
    clientId: id,
    email: z.boolean(),
    sms: z.boolean(),
  }),
  z.object({
    type: z.literal('refund'),
    /** The receipt refunded; or, with `paymentId`, a deposit or fee payment (PILOT-02). */
    saleId: id.optional(),
    paymentId: id.optional(),
    /** V2: a walk-in sale of products. */
    counterSaleId: id.optional(),
    /** V2: products the guest brought back that go back on the shelf. */
    restock: retailItemsSchema.optional(),
    amountMinor: money.refine((n) => n > 0),
    reason: z.string().trim().min(3).max(300),
    reference: z.string().trim().min(1).max(150),
    /** How the money went back. Older refunds lack it; the till count then follows the receipt. */
    method: method.optional(),
    processor,
  }),
  z.object({
    type: z.literal('deposit'),
    appointmentId: id,
    amountMinor: money.refine((n) => n > 0),
    method,
    reference: z.string().trim().max(150).optional(),
    processor,
  }),
  // PILOT-02: a no-show or late-cancellation fee, charged by card or recorded by hand.
  z.object({
    type: z.literal('fee'),
    appointmentId: id,
    amountMinor: money.refine((n) => n > 0),
    method,
    reference: z.string().trim().max(150).optional(),
    processor,
  }),
  z.object({ type: z.literal('protection'), settings: protectionSchema }),
  z.object({
    type: z.literal('tax'),
    label: z.string().trim().max(40),
    rateBps: z.number().int().min(0).max(10000),
    inclusive: z.boolean(),
  }),
  z.object({ type: z.literal('product'), id: id.optional(), input: productInputSchema }),
  z.object({ type: z.literal('time-off'), input: timeOffInputSchema }),
  z.object({ type: z.literal('rental'), input: rentalInputSchema }),
  z.object({ type: z.literal('supplier'), id: id.optional(), input: supplierInputSchema }),
  z.object({
    type: z.literal('purchase-order'),
    supplierId: id,
    lines: orderLinesSchema,
    note: z.string().trim().max(300).optional(),
  }),
  z.object({
    type: z.literal('receive-order'),
    orderId: id,
    received: z
      .array(z.object({ productId: id, quantity: z.number().int().min(0).max(10000) }))
      .min(1)
      .max(50),
  }),
  z.object({ type: z.literal('cancel-order'), orderId: id }),
  z.object({ type: z.literal('accounting-settings'), settings: accountingSettingsSchema }),
  z.object({
    type: z.literal('accounting-export'),
    provider: z.enum(accountingProviders),
    from: z.iso.date(),
    to: z.iso.date(),
  }),
  z.object({ type: z.literal('end-rental'), rentalId: id, to: z.iso.date() }),
  z.object({
    type: z.literal('rent-payment'),
    rentalId: id,
    periodStart: z.iso.date(),
    amountMinor: money.refine((n) => n > 0),
    method: z.enum(rentMethods),
    reference: z.string().trim().max(150).optional(),
  }),
  z.object({ type: z.literal('cancel-time-off'), timeOffId: id }),
  z.object({
    type: z.literal('leave-allowance'),
    staffId: id,
    days: z.number().min(0).max(366).multipleOf(0.5),
  }),
  z.object({ type: z.literal('pay-rules'), rules: payRulesInputSchema }),
  z.object({
    type: z.literal('pay-rate'),
    staffId: id,
    serviceBps: z.number().int().min(0).max(10000),
    productBps: z.number().int().min(0).max(10000),
    from: z.iso.date(),
  }),
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
  // V1.5: month and day only; null removes it.
  z.object({
    type: z.literal('client-birthday'),
    clientId: id,
    birthday: clientSchema.shape.birthday.unwrap().nullable(),
  }),
  z.object({
    type: z.literal('client-edit'),
    clientId: id,
    contact: contactSchema,
    preferences: z.string().trim().max(1000),
  }),
  // PILOT-03: moving from another system. Each import is reviewed row by row before it is sent.
  z.object({
    type: z.literal('import-services'),
    source: importSource,
    services: z
      .array(
        serviceSchema
          .omit({
            id: true,
            organisationId: true,
            archived: true,
            prepNote: true,
            aftercareNote: true,
          })
          .extend({ staffIds: z.array(id).max(100) }),
      )
      .min(1)
      .max(200),
    reviewed: z.literal(true),
  }),
  z.object({
    type: z.literal('import-appointments'),
    source: importSource,
    appointments: z
      .array(
        z.object({
          clientId: id.optional(),
          contact: contactSchema.optional(),
          serviceId: id,
          staffId: id,
          date: z.iso.date(),
          startMinutes: z.number().int().min(0).max(1439),
          /** The price the guest was quoted in the old system, kept as booked. */
          priceMinor: money,
          /** A deposit the guest already paid to the old system. */
          depositPaidMinor: money,
          /** The old system's booking reference, when it has one. */
          reference: z.string().trim().max(40).optional(),
        }),
      )
      .min(1)
      .max(200),
    reviewed: z.literal(true),
  }),
  z.object({
    type: z.literal('import-balances'),
    source: importSource,
    balances: z
      .array(
        z.object({
          clientId: id,
          kind: z.enum(['credit', 'owed']),
          amountMinor: money.refine((n) => n > 0),
          note: z.string().trim().max(200),
        }),
      )
      .min(1)
      .max(500),
    reviewed: z.literal(true),
  }),
  z.object({
    type: z.literal('balance-settle'),
    balanceId: id,
    note: z.string().trim().min(2).max(200),
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
    /** V1.5: the guest's waitlist request this earlier time fills. */
    waitlistId: id.optional(),
    date: z.iso.date(),
    startMinutes: z.number().int().min(0).max(1439),
    staffId: id,
  }),
  z.object({
    type: z.literal('cancel'),
    appointmentId: id,
    reason: z.string().trim().min(2).max(300),
    // Set only when the guest cancels through their private link (LOCAL-02).
    deposit: z.enum(['refund_due', 'retained']).optional(),
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
    processor,
    /** V1.5: a package or membership pays for the visit; the guest pays any tip at the desk. */
    holdingId: id.optional(),
    /** V2: products the guest buys with the visit, at their catalogue price. */
    products: retailItemsSchema.optional(),
    /** V1.5: a gift card or voucher pays part or all of what is due. */
    giftCardId: id.optional(),
    giftCardMinor: money.optional(),
  }),
  z.object({ type: z.literal('note'), clientId: id, text: z.string().trim().min(2).max(1000) }),
  // V2: products sold to someone without a visit.
  z.object({
    type: z.literal('counter-sale'),
    clientId: id.optional(),
    /** V2: who made the sale, for their commission. */
    staffId: id.optional(),
    products: retailItemsSchema.refine((items) => items.length > 0, 'Add a product.'),
    method,
    reference: z.string().trim().max(150).optional(),
  }),
  z.object({ type: z.literal('client'), contact: contactSchema, referredById: id.optional() }),
  z.object({ type: z.literal('consent'), clientId: id, consent: z.boolean() }),
  z.object({
    type: z.literal('consent-wording'),
    text: z.string().trim().min(10).max(CONSENT_TEXT_LIMIT),
  }),
  z.object({ type: z.literal('guest-consent-stop'), appointmentId: id }),
  z.object({
    type: z.literal('consultation-save'),
    /** Present to save a new version of an existing consultation. */
    id: id.optional(),
    clientId: id,
    staffId: id.optional(),
    heldOn: z.iso.date(),
    content: consultationContentSchema,
  }),
  tillCountCommandSchema,
  // Sent only through a guest's private link, never by the studio.
  z.object({ type: z.literal('feedback'), appointmentId: id }).extend(feedbackInputSchema.shape),
  z.object({ type: z.literal('waitlist-add'), input: waitlistInputSchema }),
  z.object({
    type: z.literal('waitlist-remove'),
    entryId: id,
    reason: z.string().trim().min(2).max(300),
  }),
  z.object({
    type: z.literal('waitlist-offer'),
    entryId: id,
    date: z.iso.date(),
    startMinutes: z.number().int().min(0).max(1439),
    staffId: id,
  }),
  // From the guest's own private link only.
  z.object({
    type: z.literal('waitlist-join'),
    appointmentId: id,
    anyone: z.boolean(),
    times: waitlistTimesSchema,
  }),
  z.object({ type: z.literal('waitlist-leave'), appointmentId: id }),
  // V1.5: ordinary guest forms. The studio sets them up; answers come only from the guest's link.
  z.object({
    type: z.literal('form-save'),
    id: id.optional(),
    content: formContentSchema,
    settings: formSettingsSchema,
  }),
  z.object({ type: z.literal('form-archive'), formId: id, archived: z.boolean() }),
  z.object({ type: z.literal('form-submit'), appointmentId: id }).extend(formAnswersSchema.shape),
  // V1.5: "I've arrived", from the guest's own private link only.
  z.object({ type: z.literal('guest-here'), appointmentId: id }),
  // V1.5: a call the studio missed, written down to call back; and saying it was called back.
  z.object({
    type: z.literal('missed-call'),
    number: z.string().trim().min(3).max(30),
    source: z.enum(missedCallSources).optional(),
  }),
  z.object({ type: z.literal('missed-call-done'), callId: id }),
  z.object({ type: z.literal('offer'), id: id.optional(), input: offerInputSchema }),
  z.object({
    type: z.literal('plan-sell'),
    offerId: id,
    clientId: id,
    method,
    reference: z.string().trim().max(150).optional(),
  }),
  z.object({
    type: z.literal('plan-renew'),
    holdingId: id,
    method,
    reference: z.string().trim().max(150).optional(),
  }),
  z.object({
    type: z.literal('plan-cancel'),
    holdingId: id,
    reason: z.string().trim().min(2).max(300),
    refundMinor: money.optional(),
    method: method.optional(),
    reference: z.string().trim().max(150).optional(),
  }),
  // Ask Saleane: several desk changes approved together, applied together or not at all. Only
  // moving, cancelling, closing time and unsent drafts, so no money moves in a batch.
  z.object({
    type: z.literal('batch'),
    label: z.string().trim().min(2).max(200),
    commands: z
      .array(z.looseObject({ type: z.enum(['reschedule', 'cancel', 'closure', 'message']) }))
      .min(1)
      .max(40),
  }),
  // V3: planning a special records it; nothing is sent and no price changes.
  z.object({ type: z.literal('special-plan'), input: specialInputSchema }),
  z.object({ type: z.literal('task-add'), input: taskInputSchema }),
  z.object({ type: z.literal('task-done'), taskId: id }),
  z.object({ type: z.literal('special-stop'), specialId: id }),
  z.object({
    type: z.literal('gift-card-sell'),
    input: giftCardInputSchema,
    method,
    reference: z.string().trim().max(150).optional(),
  }),
  z.object({ type: z.literal('gift-card-extend'), giftCardId: id, expiresOn: z.iso.date() }),
  z.object({
    type: z.literal('gift-card-cancel'),
    giftCardId: id,
    reason: z.string().trim().min(2).max(300),
    refundMinor: money.optional(),
    method: method.optional(),
    reference: z.string().trim().max(150).optional(),
  }),
  z.object({
    type: z.literal('patch-test'),
    input: patchTestInputSchema,
    /** For a test done earlier whose skin has already been checked. */
    result: z
      .object({ outcome: patchTestResultSchema, notes: z.string().trim().max(300) })
      .optional(),
  }),
  z.object({
    type: z.literal('patch-test-result'),
    patchTestId: id,
    outcome: patchTestResultSchema,
    notes: z.string().trim().max(300),
  }),
  z.object({ type: z.literal('patch-test-settings'), settings: patchTestSettingsSchema }),
  ...operatingCommandSchema.options,
])
export type BookingInput = z.infer<typeof bookingSchema>
export type ContactInput = z.infer<typeof contactSchema>
export type Command = z.infer<typeof commandSchema>
export type OperatingCommand = z.infer<typeof operatingCommandSchema>
