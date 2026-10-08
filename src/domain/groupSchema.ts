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

export const groupCommandSchemas = [
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
