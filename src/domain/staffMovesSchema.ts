import { z } from 'zod'

const id = z.string().min(1).max(150)
const date = z.iso.date()

/**
 * Stage 4: someone moving to another location from a date. Their usual days and hours stay the
 * same and happen at the new location from that date; every day before it stays where it was.
 *
 * The person's weekly hours always hold where they work from their latest move on, and each move
 * keeps where each of its weekdays was before it, so `usualHoursFor` (operations.ts) gives the old
 * location for any date before the move and the new one from it. Nothing is deleted: a move still
 * to come can be cancelled, and is then marked with who cancelled it and when.
 */
export const STAFF_MOVE_LIMIT = 1000
export const STAFF_MOVE_NOTE_LIMIT = 200
/** Booked visits a move can keep at the old location, named on the move. */
export const STAFF_MOVE_KEPT_LIMIT = 200
/** How far ahead a move can start, in days from today. */
export const STAFF_MOVE_AHEAD_DAYS = 366

const kept = z.array(id).max(STAFF_MOVE_KEPT_LIMIT)

export const staffMoveSchema = z
  .object({
    id,
    staffId: id,
    /** The first day at the new location. */
    date,
    /** Where those weekdays are from `date`. Named in full, the main location too. */
    to: id,
    /** Each weekday that moved (0 is Sunday) and where it was before, named in full. */
    days: z
      .array(z.object({ day: z.number().int().min(0).max(6), from: id }).strict())
      .min(1)
      .max(7),
    /** A few words for the team, such as "Leading the new team". */
    note: z.string().max(STAFF_MOVE_NOTE_LIMIT).optional(),
    /** They followed the studio's opening hours until this move gave them hours of their own. */
    madeOwnHours: z.literal(true).optional(),
    /** Booked visits at the old location that the person saving chose to keep as they are. */
    kept: kept.optional(),
    /** Days already changed on the rota, from `date`, that still send them to the old location. */
    rotaKept: z.array(id).max(STAFF_MOVE_KEPT_LIMIT).optional(),
    createdAt: z.iso.datetime(),
    actor: z.string(),
    cancelled: z
      .object({
        at: z.iso.datetime(),
        actor: z.string(),
        /** Booked visits at the new location kept as they are when the move was cancelled. */
        kept: kept.optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
export type StaffMove = z.infer<typeof staffMoveSchema>

export const staffMoveInputSchema = z
  .object({
    staffId: id,
    date,
    to: id,
    /** Only the days at this location move. Absent: every day not already at `to`. */
    from: id.optional(),
    note: z.string().trim().max(STAFF_MOVE_NOTE_LIMIT).optional(),
  })
  .strict()
export type StaffMoveInput = z.infer<typeof staffMoveInputSchema>

/** Saving anyway when booked visits would be left at the old location, never by default. */
const keepBooked = z.literal(true).optional()

export const staffMoveCommandSchemas = [
  z.object({ type: z.literal('staff-move'), input: staffMoveInputSchema, keepBooked }).strict(),
  z.object({ type: z.literal('staff-move-cancel'), moveId: id, keepBooked }).strict(),
] as const
