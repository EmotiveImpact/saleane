import { z } from 'zod'

const id = z.string().min(1).max(100)

/** The most life events a studio keeps across all its clients. */
export const LIFE_EVENT_LIMIT = 5000
/** The gentle offers an owner may add to a follow-up, as a percentage off the next treatment. */
export const FOLLOW_UP_PERCENTS = [5, 10, 15, 20] as const

/**
 * A dated, ordinary moment a guest told the studio about themselves ("Wedding", "New job",
 * "Graduation"), so the studio can write to them around the day. Never health or medical details:
 * the command refuses them, and follow-ups never read notes, consultations or patch tests.
 */
export const lifeEventSchema = z
  .object({
    id,
    clientId: id,
    label: z.string().trim().min(2).max(60),
    date: z.iso.date(),
    addedAt: z.iso.datetime(),
    actor: z.string(),
  })
  .strict()
export type LifeEvent = z.infer<typeof lifeEventSchema>

/** On a drafted message: which birthday or life event it marks, so each is written once. */
export const followUpMarkSchema = z
  .object({
    kind: z.enum(['birthday', 'event']),
    /** The year for a birthday, the life event's id for an event. */
    key: z.string().min(1).max(100),
    /** The gentle offer the owner added, honoured by the desk at checkout. */
    percent: z
      .number()
      .int()
      .refine((n) => (FOLLOW_UP_PERCENTS as readonly number[]).includes(n))
      .optional(),
    /** The last day the offer can be booked, on the studio's calendar. */
    until: z.iso.date().optional(),
  })
  .strict()
export type FollowUpMark = z.infer<typeof followUpMarkSchema>

export const followUpCommandSchemas = [
  /** Records a dated life event a guest shared. */
  z
    .object({
      type: z.literal('life-event'),
      clientId: id,
      label: lifeEventSchema.shape.label,
      date: z.iso.date(),
    })
    .strict(),
  z.object({ type: z.literal('life-event-remove'), eventId: id }).strict(),
  /**
   * Writes a follow-up draft for a birthday or a life event. It stays a draft until approved in
   * the usual way, which checks again that the guest agreed to hear from the studio.
   */
  z
    .object({
      type: z.literal('follow-up-draft'),
      clientId: id,
      /** 'birthday', or the id of one of the guest's life events. */
      about: id,
      /** A gentle offer, which only the owner may add. */
      percent: followUpMarkSchema.shape.percent,
    })
    .strict(),
] as const
