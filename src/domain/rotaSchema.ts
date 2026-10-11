import { z } from 'zod'

const id = z.string().min(1).max(150)
const date = z.iso.date()
/** Minutes past midnight, on a five-minute step, as the time lists offer them. */
const minute = z
  .number()
  .int()
  .min(0)
  .max(1440)
  .refine((m) => m % 5 === 0, 'Choose a time on a five-minute step.')

/**
 * Stage 3: one day on the rota changed from a person's usual weekly hours, for that date only.
 * A day can have different hours, a different location, or no work at all, and a day someone
 * does not usually work can be added. Their usual hours stay as they are. A change is never
 * deleted: putting a day back to usual, replacing it or clearing the week marks it ended, with
 * who did it and when, so only one change applies to a person on a day.
 */
export const ROTA_CHANGE_LIMIT = 8000
/** How far ahead a day can be changed, in days from today. */
export const ROTA_AHEAD_DAYS = 366
export const ROTA_NOTE_LIMIT = 100
/** Booked visits a change can keep outside its hours, named on the change. */
export const ROTA_KEPT_LIMIT = 60

const ended = z
  .object({
    at: z.iso.datetime(),
    actor: z.string(),
    /** Put back to usual hours, replaced by a newer change for the day, or cleared with its week. */
    how: z.enum(['usual', 'replaced', 'cleared']),
    /** Booked visits left outside the person's hours when it ended, kept on purpose. */
    kept: z.array(id).max(ROTA_KEPT_LIMIT).optional(),
  })
  .strict()

export const rotaChangeSchema = z
  .object({
    id,
    staffId: id,
    date,
    /** Working that day, with these hours, or not working at all. */
    working: z.boolean(),
    open: minute.optional(),
    close: minute.optional(),
    /** Where they work that day, when it is not the main location. */
    locationId: id.optional(),
    /** A few words for the team, such as "Covering Saturday". */
    note: z.string().max(ROTA_NOTE_LIMIT).optional(),
    /** Booked visits outside these hours that the person saving it chose to keep as they are. */
    kept: z.array(id).max(ROTA_KEPT_LIMIT).optional(),
    createdAt: z.iso.datetime(),
    actor: z.string(),
    ended: ended.optional(),
  })
  .strict()
  .refine(
    (c) =>
      c.working
        ? c.open !== undefined && c.close !== undefined && c.close > c.open
        : c.open === undefined && c.close === undefined && c.locationId === undefined,
    'A working day needs a start before its finish; a day off has no hours.',
  )
export type RotaChange = z.infer<typeof rotaChangeSchema>

export const rotaDayInputSchema = z
  .object({
    staffId: id,
    date,
    working: z.boolean(),
    open: minute.optional(),
    close: minute.optional(),
    locationId: id.optional(),
    note: z.string().trim().max(ROTA_NOTE_LIMIT).optional(),
  })
  .strict()
export type RotaDayInput = z.infer<typeof rotaDayInputSchema>

/** Saving anyway when booked visits would sit outside the new hours, never by default. */
const keepBooked = z.literal(true).optional()

export const rotaCommandSchemas = [
  z.object({ type: z.literal('rota-day'), input: rotaDayInputSchema, keepBooked }).strict(),
  z.object({ type: z.literal('rota-day-usual'), staffId: id, date, keepBooked }).strict(),
  /**
   * Last week's changes, onto the same weekdays of the week starting `monday`. Stage 4: with
   * `locationId`, only the days at that location, as a general manager copies them.
   */
  z
    .object({
      type: z.literal('rota-week-copy'),
      monday: date,
      locationId: id.optional(),
      keepBooked,
    })
    .strict(),
  /** Every change still to come in the week starting `monday`, back to usual hours. */
  z
    .object({
      type: z.literal('rota-week-clear'),
      monday: date,
      locationId: id.optional(),
      keepBooked,
    })
    .strict(),
] as const
export const ROTA_COMMANDS = [
  'rota-day',
  'rota-day-usual',
  'rota-week-copy',
  'rota-week-clear',
] as const
