import { offeredAt, visitPlace } from './locations'
import { z } from 'zod'
import { formContentSchema } from './formsSchema'
import { visitForms } from './forms'
import { GUEST_NOTE_LIMIT, appointmentSchema, organisationSchema } from './model'
import { visitUid } from './calendarFile'
import type { BusinessState } from './model'
import { businessDate, hoursFor, instantFor, operations } from './operations'
import { addDays } from './format'
import { WAITLIST_TIMES } from './waitlistSchema'
import type { WaitlistTime } from './waitlistSchema'
import { lookSchema } from './brandRulesSchema'
import { isOpen } from './waitlist'
import { feedbackForVisit, feedbackOpen } from './feedback'
import { guestPlanSchema, guestPlans } from './guestPlans'
import { bookedAhead, guestUsual } from './usual'

/**
 * LOCAL-02: what a guest holding a private manage link may see and do.
 *
 * Read: their one visit (service, professional's first name, time, status) and the deposit
 * already recorded against it, the studio's address, phone and email, and its "before you arrive"
 * notes, and the packages and memberships they hold (what is left, not what was paid). None of the
 * guest's own contact details, no client notes, history or other visits. After a completed visit,
 * a link to book their usual (Stage 5) carries only its treatment, first name, day and location:
 * nothing about the visits it was worked out from.
 * Write: cancel that visit while it is still upcoming. A paid deposit is flagged for refund when
 * the guest cancels at least GUEST_CANCEL_CUTOFF_HOURS before the start, and retained after that.
 * Nothing is refunded automatically; the studio records any refund in Money.
 * Move it to another free time until the same cutoff (see guestMove.ts).
 */
export const GUEST_CANCEL_CUTOFF_HOURS = 24
/** "Come in sooner?" is offered only for a visit at least this many days away. */
export const GUEST_SOONER_MIN_DAYS = 3
/** Evenings are offered only at a studio open until at least this time on some day. */
const EVENING_CLOSE = 18 * 60
/** A link stops opening this long after the visit starts, whatever its stored expiry. */
export const GUEST_LINK_AFTER_VISIT_MS = 7 * 24 * 60 * 60000
/** The longest a link can live from the moment it is issued. */
export const GUEST_LINK_MAX_MS = 120 * 24 * 60 * 60000

/** A guest can say "I've arrived" from this long before their visit until it ends. */
export const GUEST_HERE_EARLY_MS = 30 * 60000

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
        // How to reach the visit's location, or the studio when the location has none of its own.
        phone: true,
        email: true,
      })
      .strict(),
    /** Stage 6: the guest's own first name, for the label on their visit. Nothing else of theirs. */
    guest: z
      .object({ firstName: z.string().max(100) })
      .strict()
      .optional(),
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
      .object({
        paidMinor: z.number().int().nonnegative(),
        simulated: z.boolean(),
        /** Paid only by test card payments, in test mode: no money was taken. */
        test: z.literal(true).optional(),
      })
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
    /**
     * V1.5: "I've arrived", on the day of the visit. `saidAt` is when the guest told the desk;
     * `welcomed` is true once the desk has welcomed them.
     */
    here: z
      .object({
        open: z.boolean(),
        opensAt: z.iso.datetime(),
        saidAt: z.iso.datetime().nullable(),
        welcomed: z.boolean(),
      })
      .strict()
      .optional(),
    /**
     * V1.5: the studio's public review page, after a completed visit. Offered the same way to
     * every guest, whatever feedback they gave.
     */
    review: z
      .object({ url: z.string().max(300) })
      .strict()
      .optional(),
    /**
     * V1.5: ordinary forms this visit asks for, before it happens. Answers are not sent back:
     * `done` says only that the studio has them.
     */
    forms: z
      .array(
        z
          .object({
            formId: z.string(),
            version: z.number().int(),
            content: formContentSchema,
            done: z.boolean(),
          })
          .strict(),
      )
      .optional(),
    /** V1.5: present when this guest gets the studio's email news, so they can stop it here. */
    emailNews: z.literal(true).optional(),
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
        /** The parts of the day the treatment can start in, when that is not all three. */
        offered: z.array(z.enum(WAITLIST_TIMES)).optional(),
      })
      .strict()
      .optional(),
    /**
     * Moving this upcoming visit online. Absent once it can no longer change. `reason` says why
     * it cannot move now: the cutoff has passed, the studio has switched online booking off, or
     * (Stage 5) it was booked at a quiet-time price for that time only.
     */
    move: z
      .object({ available: z.boolean(), reason: z.enum(['cutoff', 'off', 'offer']).optional() })
      .strict()
      .optional(),
    /** The studio's own colours, so the page looks like its booking page. */
    look: lookSchema.optional(),
    /** After a cancellation: the studio's booking page, with the same treatment chosen. */
    bookAgain: z
      .object({ path: z.string().max(400) })
      .strict()
      .optional(),
    /**
     * Stage 5: "Book your usual", after a completed visit while the link is open and nothing else
     * is booked: the booking page with their usual treatment, professional, next usual day and
     * location already chosen (usual.ts). Only the link and the words for it, never their visits.
     */
    usual: z
      .object({
        path: z.string().max(400),
        serviceName: z.string().max(200),
        /** The professional's first name, as the visit names them. */
        professional: z.string().max(100).optional(),
        date: z.iso.date(),
        /** With several locations, where. */
        location: z.string().max(200).optional(),
      })
      .strict()
      .optional(),
    /**
     * Stage 1: the packages and memberships this guest holds that are active or waiting for this
     * month's payment, and what each can mean for this visit (see guestPlans.ts). Absent when
     * they hold none.
     */
    plans: z.array(guestPlanSchema).optional(),
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

/**
 * Why a guest cannot move this visit online now, or null when they can. A visit moves online up to
 * the same cutoff as a cancellation with the deposit given back, and only while the studio takes
 * bookings online. `closed` means it is no longer upcoming: cancelled, under way or over. Stage 5:
 * a visit booked at a quiet-time price was for that time only, so only the studio moves it.
 */
export function guestMoveBlock(
  s: BusinessState,
  appointmentId: string,
  now: number,
): 'closed' | 'offer' | 'off' | 'cutoff' | null {
  const a = s.appointments.find((item) => item.id === appointmentId)
  if (!a) throw new Error('This visit is not in the studio record.')
  const start = visitStart(s, appointmentId)
  if (a.status !== 'confirmed' || now >= start) return 'closed'
  if (a.bookedOffer) return 'offer'
  if (!operations(s).bookingEnabled) return 'off'
  if (now >= start - GUEST_CANCEL_CUTOFF_HOURS * 60 * 60000) return 'cutoff'
  return null
}

/**
 * The parts of the day this treatment could start in on the days before the visit (a week at
 * most): within opening hours with its full length and resting time. Evenings count only at a
 * studio open until 6pm or later that day, so a studio closing at 5.30pm never offers them.
 */
function soonerParts(s: BusinessState, appointmentId: string, today: string): WaitlistTime[] {
  const a = s.appointments.find((item) => item.id === appointmentId)!
  const length = a.bookedDurationMinutes + a.bookedBufferMinutes
  const parts = new Set<WaitlistTime>()
  for (let day = today; day < a.date && day < addDays(today, 7); day = addDays(day, 1)) {
    const hours = hoursFor(s, day, a.locationId)
    if (!hours || hours.closed) continue
    const latest = hours.close - length
    if (latest < hours.open) continue
    if (hours.open < 720) parts.add('morning')
    if (hours.open < 1020 && latest >= 720) parts.add('afternoon')
    if (latest >= 1020 && hours.close >= EVENING_CLOSE) parts.add('evening')
  }
  return WAITLIST_TIMES.filter((part) => parts.has(part))
}

/**
 * Whether a guest can tap "I've arrived" now: a confirmed visit today on the studio's clock, from
 * half an hour before it starts until it ends. `opensAt` is when it opens, for the page to say.
 */
export function guestHereWindow(s: BusinessState, appointmentId: string, now: number) {
  const a = s.appointments.find((item) => item.id === appointmentId)
  if (!a) throw new Error('This visit is not in the studio record.')
  const start = visitStart(s, appointmentId)
  const opensAt = start - GUEST_HERE_EARLY_MS
  const end = start + a.bookedDurationMinutes * 60000
  const today = a.date === businessDate(s, new Date(now).toISOString())
  const reason =
    a.status !== 'confirmed' || !today || now >= end ? 'closed' : now < opensAt ? 'early' : null
  return { open: !reason, reason, today, opensAt: new Date(opensAt).toISOString() }
}

/** Builds the guest's read model. The server is the only caller. */
export function guestView(
  s: BusinessState,
  appointmentId: string,
  now: number,
  payment?: GuestPayment | null,
  /** The studio's booking page address, for booking again after a cancellation. */
  studio: { slug?: string } = {},
): GuestView {
  const a = s.appointments.find((item) => item.id === appointmentId)
  if (!a) throw new Error('This visit is not in the studio record.')
  const { paidMinor, ...cancellation } = guestCancellation(s, appointmentId, now)
  const today = businessDate(s, new Date(now).toISOString())
  const deposits = s.payments.filter((p) => p.appointmentId === a.id && p.kind === 'deposit')
  const sooner = (s.waitlist ?? []).find(
    (e) => isOpen(s, e, new Date(now).toISOString()) && e.appointmentId === a.id,
  )
  // "Come in sooner?" is offered for a visit a few days away, in the parts of the day that could
  // suit; a guest already asking keeps their answer until the day before, to change it or leave.
  const upcoming = a.status === 'confirmed' && addDays(a.date, -1) >= today
  const offered = upcoming ? soonerParts(s, a.id, today) : []
  const waitlist =
    upcoming && (sooner || (offered.length && a.date >= addDays(today, GUEST_SOONER_MIN_DAYS)))
      ? {
          joined: sooner ? { anyone: !sooner.staffId, times: sooner.times } : null,
          ...(offered.length && offered.length < WAITLIST_TIMES.length ? { offered } : {}),
        }
      : null
  const move = guestMoveBlock(s, a.id, now)
  const service = s.services.find((x) => x.id === a.serviceId)
  const look = operations(s).look
  const professional = s.staff.find((p) => p.id === a.staffId)?.name.split(' ')[0] ?? 'The studio'
  // V2: the guest sees the location their visit is at.
  const place = visitPlace(s, a)
  const firstName = s.clients
    .find((c) => c.id === a.clientId)
    ?.name.trim()
    .split(/\s+/)[0]
    ?.slice(0, 100)
  const phone = place.phone ?? s.organisation.phone
  const email = place.email ?? s.organisation.email
  // Only this visit's client's own plans, never another client's.
  const plans = guestPlans(s, a.id, now)
  const usual =
    a.status === 'completed' && studio.slug ? usualLink(s, a.clientId, today, studio.slug) : null
  return guestViewSchema.parse({
    organisation: {
      name: s.organisation.name,
      locationName: place.name,
      locale: s.organisation.locale,
      timeZone: s.organisation.timeZone,
      currency: s.organisation.currency,
      region: s.organisation.region,
      address: place.address,
      ...(phone ? { phone } : {}),
      ...(email ? { email } : {}),
    },
    ...(firstName ? { guest: { firstName } } : {}),
    visit: {
      serviceName: a.bookedServiceName ?? service?.name ?? 'Your visit',
      professional,
      date: a.date,
      startMinutes: a.startMinutes,
      durationMinutes: a.bookedDurationMinutes,
      status: a.status,
      calendarUid: visitUid(a.id),
    },
    arrival: {
      studioNote: place.arrivalNote ?? '',
      serviceNote: service?.prepNote ?? '',
    },
    deposit: {
      paidMinor,
      simulated: deposits.some((p) => p.method === 'demo_card'),
      // Only a deposit paid wholly by test card payments took no money.
      ...(deposits.length && deposits.every((p) => p.processor && !p.processor.live)
        ? { test: true as const }
        : {}),
    },
    cancellation,
    ...(payment === undefined ? {} : { payment }),
    ...(waitlist ? { waitlist } : {}),
    ...(move === 'closed'
      ? {}
      : { move: move ? { available: false, reason: move } : { available: true } }),
    ...(look ? { look } : {}),
    ...(plans.length ? { plans } : {}),
    ...(a.status === 'cancelled' && studio.slug && operations(s).bookingEnabled
      ? {
          bookAgain: {
            path: `/book/${encodeURIComponent(studio.slug)}${
              service && !service.archived && offeredAt(service, a.locationId)
                ? `?service=${encodeURIComponent(service.id)}`
                : ''
            }`,
          },
        }
      : {}),
    ...(usual ? { usual } : {}),
    ...((a.status === 'confirmed' || a.status === 'arrived') &&
    a.date === businessDate(s, new Date(now).toISOString())
      ? {
          here: (() => {
            const window = guestHereWindow(s, a.id, now)
            return {
              open: window.open,
              opensAt: window.opensAt,
              saidAt: a.guestHereAt ?? null,
              welcomed: a.status === 'arrived',
            }
          })(),
        }
      : {}),
    ...((a.status === 'confirmed' || a.status === 'arrived') &&
    visitStart(s, a.id) > now &&
    visitForms(s, a).length
      ? {
          forms: visitForms(s, a).map((item) => ({
            formId: item.form.id,
            version: item.current.version,
            content: item.current.content,
            done: !!item.answer,
          })),
        }
      : {}),
    ...(s.clients.find((c) => c.id === a.clientId)?.marketingConsent
      ? { emailNews: true as const }
      : {}),
    ...(a.status === 'completed' && s.organisation.reviewUrl
      ? { review: { url: s.organisation.reviewUrl } }
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

/**
 * Stage 5: the booking page with the guest's usual chosen, or null. Offered only while the studio
 * takes bookings online, when they have a clear usual a guest can book online (no patch test first,
 * on the menu where someone does it) and nothing is booked ahead under any of their records. The
 * page opens on its times for that day, with nothing held or chosen until the guest picks a time.
 */
function usualLink(s: BusinessState, clientId: string, today: string, slug: string) {
  if (!operations(s).bookingEnabled) return null
  const usual = guestUsual(s, clientId, today)
  if (usual.none || !usual.treatment || usual.onlineStop || !usual.nextDate) return null
  if (bookedAhead(s, usual.clientIds, today)) return null
  const query = new URLSearchParams({
    service: usual.treatment.serviceId,
    staff: usual.professional?.staffId ?? 'any',
    date: usual.nextDate,
  })
  if (usual.location) query.set('location', usual.location.locationId)
  return {
    path: `/book/${encodeURIComponent(slug)}?${query}`,
    serviceName: usual.treatment.name,
    ...(usual.professional ? { professional: usual.professional.name.split(' ')[0] } : {}),
    date: usual.nextDate,
    ...(usual.location ? { location: usual.location.name } : {}),
  }
}
