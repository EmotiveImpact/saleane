import { z } from 'zod'
import { appointmentSchema, organisationSchema } from './model'
import type { BusinessState } from './model'
import { instantFor } from './operations'

/**
 * LOCAL-02: what a guest holding a private manage link may see and do.
 *
 * Read: their one visit (service, professional's first name, time, status) and the deposit
 * already recorded against it. No contact details, notes, history or other visits.
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
export function guestView(s: BusinessState, appointmentId: string, now: number): GuestView {
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
    },
    visit: {
      serviceName:
        a.bookedServiceName ?? s.services.find((x) => x.id === a.serviceId)?.name ?? 'Your visit',
      professional,
      date: a.date,
      startMinutes: a.startMinutes,
      durationMinutes: a.bookedDurationMinutes,
      status: a.status,
    },
    deposit: {
      paidMinor,
      simulated: s.payments.some(
        (p) => p.appointmentId === a.id && p.kind === 'deposit' && p.method === 'demo_card',
      ),
    },
    cancellation,
  })
}
