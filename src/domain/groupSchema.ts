import { z } from 'zod'

const id = z.string().min(1).max(150)

/**
 * V5: how many regions a business keeps, and how many monthly targets: every location's target
 * for ten years, so past months are kept and never need clearing out.
 */
export const REGION_LIMIT = 12
export const TARGET_LIMIT = 21 * 12 * 10
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use a month such as 2026-10.')

/** V5: a named group of locations, such as "London" or "North". */
export const regionInputSchema = z
  .object({
    name: z.string().trim().min(2).max(60),
    locationIds: z.array(id).min(1).max(40),
  })
  .strict()
export const regionSchema = regionInputSchema.extend({ id })
export type Region = z.infer<typeof regionSchema>

/** V5: what a location aims to take in one calendar month, from completed services. */
export const targetSchema = z
  .object({ locationId: id, month, takingsMinor: z.number().int().min(1).max(10_000_000_00) })
  .strict()
export type Target = z.infer<typeof targetSchema>

/**
 * V5: the checks that run by themselves across every location. Each one is a number the owner
 * chooses, or null to switch it off; a missing value uses the default.
 */
export const groupChecksSchema = z
  .object({
    /** A location's last 7 days down by at least this share on the 7 before. */
    takingsDropPct: z.number().int().min(5).max(90).nullable().optional(),
    /** A location's month-end estimate short of its target by at least this share. */
    targetShortPct: z.number().int().min(1).max(90).nullable().optional(),
    /** A location not visited for this many days. */
    visitDueDays: z.number().int().min(7).max(365).nullable().optional(),
    /** A request waiting for a decision this many days. */
    requestWaitDays: z.number().int().min(1).max(60).nullable().optional(),
  })
  .strict()
export type GroupChecks = z.infer<typeof groupChecksSchema>
export const GROUP_CHECK_DEFAULTS = {
  takingsDropPct: 20,
  targetShortPct: 10,
  visitDueDays: 30,
  requestWaitDays: 3,
} as const

export const groupCommandSchemas = [
  z.object({ type: z.literal('group-checks'), checks: groupChecksSchema }).strict(),
  z.object({ type: z.literal('region'), id: id.optional(), input: regionInputSchema }).strict(),
  z.object({ type: z.literal('region-remove'), regionId: id }).strict(),
  // Every location's target for one month, saved together; null takes one away.
  z
    .object({
      type: z.literal('targets'),
      month,
      set: z
        .array(
          z
            .object({
              locationId: id,
              takingsMinor: z.number().int().min(1).max(10_000_000_00).nullable(),
            })
            .strict(),
        )
        .min(1)
        .max(41),
    })
    .strict(),
] as const
