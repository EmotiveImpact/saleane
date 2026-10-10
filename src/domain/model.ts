import { z } from 'zod'
import { operationsSchema, taxSchema, weeklyHoursSchema } from './operations'
import { tillCountProblem, tillCountSchema } from './tillCount'
import { paymentMethodSchema, processorSchema } from './paymentMethods'
import { holdingSchema, offerSchema } from './plansSchema'
import { coveredSaleProblem, plansProblem } from './plans'
import { giftCardSchema } from './giftCardsSchema'
import { giftCardsProblem, refundableOnReceipt } from './giftCards'
import { patchTestsProblem } from './patchTests'
import { patchTestSchema } from './patchTestsSchema'
import { formResponseSchema, formSchema } from './formsSchema'
import { formsProblem } from './forms'
import { consentRecordSchema, consentWordingSchema } from './consentSchema'
import { consentProblem } from './consent'
import { consultationSchema, visitConsultationSchema } from './consultationsSchema'
import { consultationsProblem } from './consultations'
import { replySchema, savedReplySchema, socialAnswerSchema, textStopSchema } from './inboxSchema'
import { inboxProblem } from './inbox'
import { feedbackProblem, feedbackSchema } from './feedback'
import { specialSchema, specialsProblem } from './specialsSchema'
import { taskSchema, tasksProblem } from './tasksSchema'
import { counterSaleSchema, saleRetailSchema } from './retailSchema'
import { otherTillSaleSchema } from './otherTillSchema'
import { otherTillProblem } from './otherTill'
import { retailCharge, retailProblem } from './retail'
import { rentProblem } from './rent'
import { commissionProblem } from './commission'
import { purchasingProblem } from './purchasing'
import { waitlistEntrySchema } from './waitlistSchema'
import { waitlistProblem } from './waitlist'
import { locationsProblem } from './locations'
import { groupProblem } from './group'
import { branchVisitsProblem } from './branchVisits'
import { approvalsProblem } from './approvals'
import { tillProblem } from './till'
import { rotaProblem } from './rota'
import { staffMovesProblem } from './staffMoves'
import { timeOffProblem } from './timeOff'
import { newsProblem } from './news'
import { bookedOfferSchema } from './quietOffersSchema'
import { quietOffersProblem } from './quietOffers'
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
/** Stage 5: the AI assistants a guest can book through; `assistant` when it did not say which. */
export const assistantChannels = ['chatgpt', 'claude', 'assistant'] as const
export type AssistantChannel = (typeof assistantChannels)[number]
/** Where an online guest came from: a shared booking link, or an AI assistant (Stage 5). */
export const visitChannels = [...bookingChannels, ...assistantChannels] as const
export type VisitChannel = (typeof visitChannels)[number]
export const GUEST_NOTE_LIMIT = 400
/** A public review address must be a secure web address. */
export function isReviewUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !!url.hostname && !url.username && !url.password
  } catch {
    return false
  }
}

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
  /**
   * V1.5: where guests can leave a public review (a Google review link, say). Offered the same way
   * to every guest after a visit, whatever they told the studio privately.
   */
  reviewUrl: z
    .string()
    .max(300)
    .refine(isReviewUrl, 'Use a full web address starting with https://.')
    .optional(),
  /** How guests reach the studio, shown on their visit page. Checked when saved (studioContact). */
  phone: z.string().max(40).optional(),
  email: z.email().max(254).optional(),
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
  /**
   * Stage 1: when their own STOP reply to the studio's text line turned texts off. Present only
   * while texts are off because of it, so a START reply turns them back on; absent when the desk
   * turned texts off (see textStop.ts).
   */
  textsStoppedAt: z.iso.datetime().optional(),
  /** Stage 1: when they texted START while the desk keeps texts off, for the team to decide. */
  textsAskedAt: z.iso.datetime().optional(),
  /** V1.5: month and day only ("03-14"), never the year, for a birthday email. */
  birthday: z
    .string()
    .regex(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/)
    .refine((value) => birthdayIsReal(value), 'Choose a real date.')
    .optional(),
  /**
   * V5: the first half of their postcode only ("N1", "SW1A"; US the first three ZIP digits), for
   * seeing where clients come from in groups. Never the full postcode or an address.
   */
  postcodeArea: z
    .string()
    .regex(/^[A-Z0-9]{1,4}$/)
    .optional(),
})
/** Whether a "MM-DD" birthday exists in some year (29 February does). */
export function birthdayIsReal(value: string) {
  const [month, day] = value.split('-').map(Number)
  return day <= new Date(Date.UTC(2024, month, 0)).getUTCDate()
}
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
  /** V1.5: guests need a clear patch test before this treatment, such as a colour. */
  patchTest: z.boolean().optional(),
  /** V2: a different price at another location. Absent means the same price everywhere. */
  locationPrices: z
    .array(z.object({ locationId: id, priceMinor: minor }))
    .max(20)
    .refine((rows) => new Set(rows.map((r) => r.locationId)).size === rows.length)
    .optional(),
  /** V2: locations where this treatment is not offered. Absent means offered everywhere. */
  notOfferedAt: z
    .array(id)
    .max(20)
    .refine((ids) => new Set(ids).size === ids.length)
    .optional(),
  /** V1.5: practical care advice emailed after the visit, such as "Avoid hot water for a day". */
  aftercareNote: z.string().max(GUEST_NOTE_LIMIT).optional(),
  /** V1.5: how many weeks until a guest usually comes back for this, for a "due back" nudge. */
  returnWeeks: z.number().int().min(1).max(52).optional(),
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
  /** V2: the location the room or chair is at. Absent means the main location. */
  locationId: id.optional(),
  /**
   * V1.5: minutes the room rests empty after each visit (airing, cooling, a deep clean). Only the
   * room waits; the professional is free. Absent means none.
   */
  restMinutes: z.number().int().min(5).max(120).multipleOf(5).optional(),
  /**
   * NEXT-08: a room for two, such as a couples' room. Two visits booked together can share it at
   * the same time; anyone else still has it to themselves. Absent means one at a time.
   */
  forTwo: z.literal(true).optional(),
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
  /**
   * `import` marks a visit booked in the studio's previous system and carried over (PILOT-03).
   * Stage 5: `software` marks a visit booked by other software through an access key.
   */
  source: z.enum(['desk', 'online', 'rebook', 'import', 'software']),
  /** Stage 5: the access key that booked it, and the key's name at the time. */
  software: z
    .object({ keyId: id, name: z.string().min(1).max(60) })
    .strict()
    .optional(),
  /** Where an online guest came from: a shared booking link or, since Stage 5, an AI assistant. */
  channel: z.enum(visitChannels).optional(),
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
  /** V1.5: when the guest tapped "I've arrived" on their private link. The desk still welcomes them. */
  guestHereAt: z.iso.datetime().optional(),
  /** V1.5: the consultation this visit was booked from, at the version agreed then. */
  consultation: visitConsultationSchema.optional(),
  /** NEXT-09: one of several visits booked together to repeat every few weeks. */
  repeat: z
    .object({ id, everyWeeks: z.number().int().min(1).max(12) })
    .strict()
    .optional(),
  /**
   * NEXT-08: one of several visits booked together for different people on one day, such as a
   * couple side by side or a bridal party. `lead` marks the person the booking was made for.
   */
  together: z
    .object({ id, lead: z.literal(true).optional() })
    .strict()
    .optional(),
  /**
   * Stage 5: booked at a quiet-time price from an invitation's private link: which invitation, and
   * the usual price then. `bookedPriceMinor` is the lower price, which checkout charges.
   */
  bookedOffer: bookedOfferSchema.optional(),
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
  /** V1.5: the gift card that paid part or all of what was due, and how much it paid. */
  giftCardId: id.optional(),
  giftCardMinor: minor.optional(),
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
  /** V2: where the visit was, when a move took it to another location. */
  locationId: id.optional(),
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
    'waitlist',
    'gift_card',
    'patch_test',
    'form',
    'consultation',
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
  /** V3: specials a manager planned from a seasonal or local suggestion. Nothing is sent by them. */
  specials: z.array(specialSchema).optional(),
  /** V3: reminders the team leaves for a day. Nothing is sent by them. */
  tasks: z.array(taskSchema).optional(),
  /** V2: products sold without a visit. */
  counterSales: z.array(counterSaleSchema).optional(),
  /** V1.5: clients waiting for an earlier or a free time. */
  waitlist: z.array(waitlistEntrySchema).optional(),
  /** V1.5: gift cards and vouchers sold here. */
  giftCards: z.array(giftCardSchema).optional(),
  /** V1.5: patch tests done here, kept beside each other and never deleted. */
  patchTests: z.array(patchTestSchema).optional(),
  /** V1.5: ordinary forms guests fill in before a visit, and every answer given, by version. */
  forms: z.array(formSchema).optional(),
  formResponses: z.array(formResponseSchema).optional(),
  /** V1.5: the studio's wording for email news by version, and every permission change. */
  consentWording: z.array(consentWordingSchema).max(500).optional(),
  consentRecords: z.array(consentRecordSchema).optional(),
  /** V1.5: consultations held with guests, each change kept as a version. */
  consultations: z.array(consultationSchema).optional(),
  /** V1.5: what guests wrote back, and the studio's saved replies to start a message from. */
  replies: z.array(replySchema).optional(),
  savedReplies: z.array(savedReplySchema).optional(),
  /** Stage 1: numbers that texted STOP to the studio's line, and when they texted START again. */
  textStops: z.array(textStopSchema).optional(),
  /** V4: the team's answers on Instagram, Facebook and WhatsApp. */
  socialAnswers: z.array(socialAnswerSchema).optional(),
  /** Stage 5: sales and refunds a chain's own tills sent in through an access key. */
  otherTillSales: z.array(otherTillSaleSchema).optional(),
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
    throw new Error('This studio record is for another region.')
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
    s.otherTillSales ?? [],
  ]
  for (const collection of collections) {
    if (new Set(collection.map((item) => item.id)).size !== collection.length)
      throw new Error('Duplicate record IDs.')
    if (collection.some((item) => item.organisationId !== org.id))
      throw new Error('A record from another studio.')
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
    if (service.depositMinor > service.priceMinor)
      throw new Error('A treatment deposit is not valid.')
  for (const staff of s.staff)
    if (staff.serviceIds.some((serviceId) => !exists(s.services, serviceId)))
      throw new Error('A team member offers a treatment the studio does not have.')
  for (const a of s.appointments) {
    if (
      !exists(s.clients, a.clientId) ||
      !exists(s.staff, a.staffId) ||
      !exists(s.services, a.serviceId) ||
      !exists(s.resources, a.resourceId)
    )
      throw new Error('A visit points to a record the studio does not have.')
    // Upgrade older local records using the linked catalogue without resetting user data.
    a.bookedResourceType ??= s.resources.find((resource) => resource.id === a.resourceId)!.type
    a.bookedServiceName ??= s.services.find((service) => service.id === a.serviceId)!.name
    if (a.rebookedFromId && !exists(s.appointments, a.rebookedFromId))
      throw new Error('Broken rebooking link.')
    if (a.bookedDepositMinor > a.bookedPriceMinor) throw new Error('Invalid booked deposit.')
    // Stage 5: a visit other software booked names the access key that booked it.
    if ((a.source === 'software') !== !!a.software)
      throw new Error('A visit does not say properly where it was booked.')
  }
  // NEXT-09: repeat visits are one client's, at one rhythm.
  const repeats = new Map<string, { clientId: string; everyWeeks: number }>()
  for (const a of s.appointments) {
    if (!a.repeat) continue
    const first = repeats.get(a.repeat.id)
    if (!first) repeats.set(a.repeat.id, { clientId: a.clientId, everyWeeks: a.repeat.everyWeeks })
    else if (first.clientId !== a.clientId || first.everyWeeks !== a.repeat.everyWeeks)
      throw new Error('Broken repeat booking.')
  }
  // NEXT-08: visits booked together are for different people, on one day at one location.
  const parties = new Map<string, Appointment[]>()
  for (const a of s.appointments)
    if (a.together) parties.set(a.together.id, [...(parties.get(a.together.id) ?? []), a])
  for (const party of parties.values())
    if (
      party.some((a) => a.date !== party[0].date || a.locationId !== party[0].locationId) ||
      new Set(party.map((a) => a.clientId)).size !== party.length ||
      party.filter((a) => a.together!.lead).length > 1
    )
      throw new Error('Broken booking for several people.')
  if (new Set(s.sales.map((sale) => sale.appointmentId)).size !== s.sales.length)
    throw new Error('A visit was settled twice.')
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
      sale.balanceMinor !==
        sale.totalMinor -
          sale.depositAppliedMinor -
          (sale.coveredMinor ?? 0) -
          (sale.giftCardMinor ?? 0) ||
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
    throw new Error('A payment record is not valid for this studio.')
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
      throw new Error('A visit has a history of changes that is not valid.')
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
      o.payRates ?? [],
      o.payRules ?? [],
      o.timeOff ?? [],
      o.rentals ?? [],
      o.suppliers ?? [],
      o.purchaseOrders ?? [],
      o.accountingExports ?? [],
      o.rentPayments ?? [],
    ])
      if (new Set(rows.map((r) => r.id)).size !== rows.length)
        throw new Error('Duplicate operating record IDs.')
    for (const rate of o.payRates ?? [])
      if (!exists(s.staff, rate.staffId)) throw new Error('Missing pay rate professional.')
    for (const away of o.timeOff ?? [])
      if (!exists(s.staff, away.staffId) || away.to < away.from)
        throw new Error('Invalid time off.')
    const allowances = o.leaveAllowances ?? []
    if (
      allowances.some((a) => !exists(s.staff, a.staffId)) ||
      new Set(allowances.map((a) => a.staffId)).size !== allowances.length
    )
      throw new Error('Invalid holiday allowance.')
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
                : change.kind === 'resource-moved'
                  ? [change.before, change.after].every((v) => !!v && 'locationId' in v)
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
        refundableOnReceipt(sale)
      )
        throw new Error('Refunds exceed the receipt total.')
  }
  for (const count of s.tillCounts ?? [])
    if (tillCountProblem(count)) throw new Error('Invalid till count.')
  const plans = plansProblem(s)
  if (plans) throw new Error(plans)
  const gifts = giftCardsProblem(s)
  if (gifts) throw new Error(gifts)
  const patch = patchTestsProblem(s)
  if (patch) throw new Error(patch)
  const feedback = feedbackProblem(s)
  if (feedback) throw new Error(feedback)
  const forms = formsProblem(s)
  if (forms) throw new Error(forms)
  const consent = consentProblem(s)
  if (consent) throw new Error(consent)
  const consultations = consultationsProblem(s)
  if (consultations) throw new Error(consultations)
  const inbox = inboxProblem(s)
  if (inbox) throw new Error(inbox)
  const specials = specialsProblem(s)
  if (specials) throw new Error(specials)
  const tasks = tasksProblem(s)
  if (tasks) throw new Error(tasks)
  const retail = retailProblem(s)
  if (retail) throw new Error(retail)
  const rent = rentProblem(s)
  if (rent) throw new Error(rent)
  const commission = commissionProblem(s)
  if (commission) throw new Error(commission)
  const purchasing = purchasingProblem(s)
  if (purchasing) throw new Error(purchasing)
  const waitlist = waitlistProblem(s)
  if (waitlist) throw new Error(waitlist)
  const location = locationsProblem(s)
  if (location) throw new Error(location)
  const group = groupProblem(s)
  if (group) throw new Error(group)
  const visits = branchVisitsProblem(s)
  if (visits) throw new Error(visits)
  const approvals = approvalsProblem(s)
  if (approvals) throw new Error(approvals)
  const till = tillProblem(s)
  if (till) throw new Error(till)
  const rota = rotaProblem(s)
  if (rota) throw new Error(rota)
  // Stage 4: people moving to another location from a date.
  const moves = staffMovesProblem(s)
  if (moves) throw new Error(moves)
  const away = timeOffProblem(s)
  if (away) throw new Error(away)
  const news = newsProblem(s)
  if (news) throw new Error(news)
  const otherTill = otherTillProblem(s)
  if (otherTill) throw new Error(otherTill)
  // Stage 5: a quiet-time price is below the usual price and booked once at most.
  const offers = quietOffersProblem(s)
  if (offers) throw new Error(offers)
  try {
    new Intl.DateTimeFormat('en', { timeZone: org.timeZone }).format(new Date())
  } catch {
    throw new Error('Invalid venue time zone.')
  }
  return s
}
