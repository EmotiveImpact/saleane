import { z } from 'zod'

const id = z.string().min(1).max(150)
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date such as 2026-10-20.')
const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a time such as 09:30.')
const reason = z.string().trim().min(3, 'Say why, in a few words.').max(200)

/**
 * NEXT-07: hours worked, for payroll. Each person clocks in and out on their own page, or the desk
 * does it for them; an owner or manager adds hours that were missed and corrects mistakes, always
 * with a reason. A shift is never deleted: one removed in error keeps who removed it and why.
 */
/** Ten people working most days for four years; nothing is cleared out automatically. */
export const SHIFT_LIMIT = 12_000
/** Longer than this, an open shift is a forgotten clock-out rather than a day's work. */
export const SHIFT_MAX_HOURS = 16
export const BREAK_MAX_MINUTES = 240
/** The breaks offered when clocking out, in minutes. */
export const BREAK_CHOICES = [0, 15, 30, 45, 60] as const

/** Earlier versions kept on a shift changed by hand: the most recent this many. */
export const SHIFT_EARLIER = 20

const byHand = z
  .object({ at: z.iso.datetime(), actor: z.string(), reason: z.string().max(200) })
  .strict()
export const shiftSchema = z
  .object({
    id,
    staffId: id,
    /** The studio day it started on. */
    date,
    /** Where they worked, when the studio has more than one location. */
    locationId: id.optional(),
    start: z.iso.datetime(),
    end: z.iso.datetime().optional(),
    /** Unpaid break taken during the shift. */
    breakMinutes: z.number().int().min(0).max(BREAK_MAX_MINUTES),
    /** Clocked in and out, or added by hand. */
    source: z.enum(['clock', 'added']),
    createdAt: z.iso.datetime(),
    actor: z.string(),
    /** Who clocked out, when it was not done by hand. */
    endedBy: z.string().optional(),
    /** The latest time it was added or changed by hand; who changed what keeps every earlier one. */
    byHand: byHand.optional(),
    removed: byHand.optional(),
    /** What it said before each change by hand, oldest first, with who had set it and why. */
    earlier: z
      .array(
        z
          .object({
            date,
            start: z.iso.datetime(),
            end: z.iso.datetime().optional(),
            breakMinutes: z.number().int().min(0).max(BREAK_MAX_MINUTES),
            at: z.iso.datetime(),
            actor: z.string(),
            reason: z.string().max(200).optional(),
          })
          .strict(),
      )
      .max(SHIFT_EARLIER)
      .optional(),
  })
  .strict()
export type Shift = z.infer<typeof shiftSchema>

export const shiftInputSchema = z
  .object({
    staffId: id,
    date,
    start: clock,
    end: clock,
    breakMinutes: z.number().int().min(0).max(BREAK_MAX_MINUTES),
    reason,
  })
  .strict()
export type ShiftInput = z.infer<typeof shiftInputSchema>

export const hoursCommandSchemas = [
  z.object({ type: z.literal('clock-in'), staffId: id }).strict(),
  z
    .object({
      type: z.literal('clock-out'),
      staffId: id,
      breakMinutes: z.number().int().min(0).max(BREAK_MAX_MINUTES),
    })
    .strict(),
  z.object({ type: z.literal('shift-save'), id: id.optional(), input: shiftInputSchema }).strict(),
  z.object({ type: z.literal('shift-remove'), shiftId: id, reason }).strict(),
] as const
