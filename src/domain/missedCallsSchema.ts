import { z } from 'zod'

/**
 * V1.5: calls the studio missed, so someone can call back and, if the studio switches it on, the
 * caller gets one text with the booking link. Kept apart so `operations` can embed it.
 */
const id = z.string().min(1).max(150)
/**
 * Calls repeated the same day share one entry, so this is years of calls for a busy studio.
 * Nothing is removed automatically; a full list refuses new calls rather than dropping old ones.
 */
export const MISSED_CALL_LIMIT = 5000
export const missedCallSources = ['desk', 'phone'] as const
export const missedCallSchema = z
  .object({
    id,
    /** The caller's number with its country code, as a text provider accepts it. */
    number: z.string().regex(/^\+[1-9]\d{7,14}$/),
    /** The first missed call from this number that day, and the latest. */
    at: z.iso.datetime(),
    lastAt: z.iso.datetime(),
    /** How many times they rang before anyone called back. */
    calls: z.number().int().min(1).max(1000),
    /** `desk` was written down by the team; `phone` came from the studio's phone line. */
    source: z.enum(missedCallSources),
    /** A client whose number this is, when there is exactly one. */
    clientId: id.optional(),
    actor: z.string(),
    calledBackAt: z.iso.datetime().optional(),
    calledBackBy: z.string().optional(),
  })
  .strict()
export type MissedCall = z.infer<typeof missedCallSchema>
