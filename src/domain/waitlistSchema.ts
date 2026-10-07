import { z } from 'zod'

/**
 * V1.5: the waitlist. A client asks to be told when a time opens for a service, within a window
 * of dates and, if they like, at certain times of day. The desk adds them, or a guest asks from
 * their own visit page to come in sooner. Nothing is deleted: an entry ends by being booked or by
 * being taken off the list, with the reason kept.
 */
const id = z.string().min(1).max(150)
const civilDate = z.iso.date()

export const WAITLIST_TIMES = ['morning', 'afternoon', 'evening'] as const
/** Times of day a request suits, each at most once; empty means any time. */
export const waitlistTimesSchema = z
  .array(z.enum(WAITLIST_TIMES))
  .max(3)
  .refine((times) => new Set(times).size === times.length, 'Choose each time of day once.')
export type WaitlistTime = (typeof WAITLIST_TIMES)[number]
/** The longest window a client can wait for, from its first day to its last. */
export const WAITLIST_MAX_DAYS = 90
/** Offers kept on one request; a request offered this many times is better taken off and asked again. */
export const WAITLIST_MAX_OFFERS = 50

export const waitlistInputSchema = z
  .object({
    clientId: id,
    serviceId: id,
    /** Absent: anyone who offers the service. */
    staffId: id.optional(),
    fromDate: civilDate,
    toDate: civilDate,
    /** Empty: any time of day. */
    times: waitlistTimesSchema,
    note: z.string().trim().max(300),
    /** A guest who already has this later visit and would like to come in sooner. */
    appointmentId: id.optional(),
  })
  .strict()
export type WaitlistInput = z.infer<typeof waitlistInputSchema>

export const waitlistOfferSchema = z.object({
  at: z.iso.datetime(),
  date: civilDate,
  startMinutes: z.number().int().min(0).max(1439),
  staffId: id,
  /** The Inbox draft written for the team to approve. */
  messageId: id,
})

export const waitlistEntrySchema = z
  .object({
    id,
    organisationId: id,
    createdAt: z.iso.datetime(),
    source: z.enum(['desk', 'guest']),
    status: z.enum(['waiting', 'booked', 'removed']),
    closedAt: z.iso.datetime().optional(),
    /** The visit that filled the wish: booked for it, or the guest's own visit moved earlier. */
    outcomeAppointmentId: id.optional(),
    removedReason: z.string().max(300).optional(),
    offers: z.array(waitlistOfferSchema).max(WAITLIST_MAX_OFFERS).optional(),
  })
  .extend(waitlistInputSchema.shape)
export type WaitlistEntry = z.infer<typeof waitlistEntrySchema>
