import { z } from 'zod'
import { GUEST_NOTE_LIMIT, appointmentSchema, organisationSchema } from './model'
import { visitUid } from './calendarFile'
import type { BusinessState } from './model'
import { businessDate, instantFor, operations } from './operations'
import { addDays } from './format'
import { WAITLIST_TIMES } from './waitlistSchema'
import { feedbackForVisit, feedbackOpen } from './feedback'

/**
 * LOCAL-02: what a guest holding a private manage link may see and do.
 *
 * Read: their one visit (service, professional's first name, time, status) and the deposit
 * already recorded against it, the studio address and its "before you arrive" notes. No contact
 * details, client notes, history or other visits.
 * Write: cancel that visit while it is still upcoming. A paid deposit is flagged for refund when
 * the guest cancels at least GUEST_CANCEL_CUTOFF_HOURS before the start, and retained after that.
 * Nothing is refunded automatically; the studio records any refund in Money.
 */
export const GUEST_CANCEL_CUTOFF_HOURS = 24
/** A link stops opening this long after the visit starts, whatever its stored expiry. */
export const GUEST_LINK_AFTER_VISIT_MS = 7 * 24 * 60 * 60000
/** The longest a link can live from the moment it is issued. */
export const GUEST_LINK_MAX_MS = 120 * 24 * 60 * 60000

export const depositOutcomes = ['refund_due', 'retained', 'none'] as const
export type DepositOutcome = (typeof depositOutcomes)[number]

export const guestPaymentSchema = z
  .object({
    /** True while payments run in test mode: nothing is charged and no card is asked for. */
    testMode: z.boolean(),
    depositDueMinor: z.number().int().nonnegative(),
    saveCardOffered: z.boolean(),
    savedCard: z.object({ brand: z.string(), last4: z.string() }).strict().nullable(),
    /** What the guest agrees to when a card is saved, word for word. */
    policy: z.string(),
    /** A payment has started and its confirmation has not arrived yet. */
    pending: z.boolean(),
  })
  .strict()
export type GuestPayment = z.infer<typeof guestPaymentSchema>

/** What a guest agrees to when a card is saved. Kept with the card, word for word. */
export function cardPolicy(s: BusinessState) {
  const fee = operations(s).protection?.feePercent ?? 0
  return fee
    ? `Your card is saved for visits at ${s.organisation.name}. If you miss a visit, or cancel less than ${GUEST_CANCEL_CUTOFF_HOURS} hours before it, the studio may charge up to ${fee}% of the booked price, less any deposit you paid. You can ask the studio to remove the card at any time.`
    : `Your card is saved for visits at ${s.organisation.name}, so you can pay for a visit without handing over a card. You can ask the studio to remove it at any time.`
}

/** The payment part of a guest's view, or null when there is nothing to pay or save. */
export function guestPayment(
  s: BusinessState,
  appointmentId: string,
  now: number,
  context: {
    testMode: boolean
    savedCard: { brand: string; last4: string } | null
    pending: boolean
  },
): GuestPayment | null {
  const a = s.appointments.find((item) => item.id === appointmentId)
  if (!a || operations(s).mode !== 'local' || a.status !== 'confirmed') return null
  if (visitStart(s, appointmentId) <= now) return null
  const paid = s.payments
    .filter((p) => p.appointmentId === a.id && p.kind === 'deposit')
    .reduce((sum, p) => sum + p.amountMinor, 0)
  const depositDueMinor = Math.max(0, a.bookedDepositMinor - paid)
  const saveCardOffered = !!operations(s).protection?.saveCard && !context.savedCard
  if (!depositDueMinor && !saveCardOffered && !context.savedCard && !context.pending) return null
  return {
    testMode: context.testMode,
    depositDueMinor,
    saveCardOffered,
    savedCard: context.savedCard,
    policy: cardPolicy(s),
    pending: context.pending,
  }
}

export const guestViewSchema = z
  .object({
    organisation: organisationSchema
      .pick({
        name: true,
        locationName: true,
        locale: true,
        timeZone: true,
        currency: true,
        region: true,
        address: true,
      })
      .strict(),
    visit: z
      .object({
        serviceName: z.string(),
        professional: z.string(),
        date: z.iso.date(),
        startMinutes: z.number().int().min(0).max(1439),
        durationMinutes: z.number().int().positive(),
        status: appointmentSchema.shape.status,
        /** A one-way calendar identifier from visitUid, never the record ID itself. */
        calendarUid: z.string().min(1).max(100),
      })
      .strict(),
    /** The studio's "before you arrive" texts, empty when it has written none. */
    arrival: z
      .object({
        studioNote: z.string().max(GUEST_NOTE_LIMIT),
        serviceNote: z.string().max(GUEST_NOTE_LIMIT),
      })
      .strict(),
    deposit: z
      .object({ paidMinor: z.number().int().nonnegative(), simulated: z.boolean() })
      .strict(),
    cancellation: z
      .object({
        available: z.boolean(),
        cutoffAt: z.iso.datetime(),
        outcome: z.enum(depositOutcomes),
      })
      .strict(),
    /** PILOT-02: paying the deposit or saving a card. Absent when there is nothing to do. */
    payment: guestPaymentSchema.nullable().optional(),
    /** V1.5: private feedback after a completed visit. Only the guest's own ratings come back. */
    feedback: z
      .object({
        open: z.boolean(),
        given: z
          .object({ visitRating: z.number().int(), practitionerRating: z.number().int() })
          .strict()
          .nullable(),
      })
      .strict()
      .optional(),
    /**
     * V1.5: "tell me if something sooner comes up", for an upcoming visit at least a day away.
     * Only the guest's own choice comes back, never who else is waiting.
     */
    waitlist: z
      .object({
        joined: z
          .object({ anyone: z.boolean(), times: z.array(z.enum(WAITLIST_TIMES)) })
          .strict()
          .nullable(),
      })
      .strict()
      .optional(),
  })
  .strict()
export type GuestView = z.infer<typeof guestViewSchema>

export function visitStart(s: BusinessState, appointmentId: string) {
  const a = s.appointments.find((item) => item.id === appointmentId)
  if (!a) throw new Error('This visit is not in the studio record.')
  return Date.parse(instantFor(s, a.date, a.startMinutes))
}

/** What cancelling now would mean for this visit. Shared by the page and the server check. */
export function guestCancellation(s: BusinessState, appointmentId: string, now: number) {
  const a = s.appointments.find((item) => item.id === appointmentId)
  if (!a) throw new Error('This visit is not in the studio record.')
  const start = visitStart(s, appointmentId)
  const cutoff = start - GUEST_CANCEL_CUTOFF_HOURS * 60 * 60000
  const paidMinor = s.payments
    .filter((p) => p.appointmentId === a.id && p.kind === 'deposit')
    .reduce((sum, p) => sum + p.amountMinor, 0)
  const outcome: DepositOutcome = paidMinor ? (now < cutoff ? 'refund_due' : 'retained') : 'none'
  return {
    available: a.status === 'confirmed' && now < start,
    cutoffAt: new Date(cutoff).toISOString(),
    outcome,
    paidMinor,
  }
}

/** Builds the guest's read model. The server is the only caller. */
export function guestView(
  s: BusinessState,
  appointmentId: string,
  now: number,
  payment?: GuestPayment | null,
): GuestView {
  const a = s.appointments.find((item) => item.id === appointmentId)
  if (!a) throw new Error('This visit is not in the studio record.')
  const { paidMinor, ...cancellation } = guestCancellation(s, appointmentId, now)
  const professional = s.staff.find((p) => p.id === a.staffId)?.name.split(' ')[0] ?? 'The studio'
  return guestViewSchema.parse({
    organisation: {
      name: s.organisation.name,
      locationName: s.organisation.locationName,
      locale: s.organisation.locale,
      timeZone: s.organisation.timeZone,
      currency: s.organisation.currency,
      region: s.organisation.region,
      address: s.organisation.address,
    },
    visit: {
      serviceName:
        a.bookedServiceName ?? s.services.find((x) => x.id === a.serviceId)?.name ?? 'Your visit',
      professional,
      date: a.date,
      startMinutes: a.startMinutes,
      durationMinutes: a.bookedDurationMinutes,
      status: a.status,
      calendarUid: visitUid(a.id),
    },
    arrival: {
      studioNote: s.organisation.arrivalNote ?? '',
      serviceNote: s.services.find((x) => x.id === a.serviceId)?.prepNote ?? '',
    },
    deposit: {
      paidMinor,
      simulated: s.payments.some(
        (p) => p.appointmentId === a.id && p.kind === 'deposit' && p.method === 'demo_card',
      ),
    },
    cancellation,
    ...(payment === undefined ? {} : { payment }),
    ...(a.status === 'confirmed' &&
    addDays(a.date, -1) >= businessDate(s, new Date(now).toISOString())
      ? {
          waitlist: {
            joined: (() => {
              const entry = (s.waitlist ?? []).find(
                (e) => e.status === 'waiting' && e.appointmentId === a.id,
              )
              return entry ? { anyone: !entry.staffId, times: entry.times } : null
            })(),
          },
        }
      : {}),
    ...(a.status === 'completed'
      ? {
          feedback: {
            open: feedbackOpen(s, a.id, visitStart(s, a.id), now),
            given: (() => {
              const row = feedbackForVisit(s, a.id)
              return row
                ? { visitRating: row.visitRating, practitionerRating: row.practitionerRating }
                : null
            })(),
          },
        }
      : {}),
  })
}
