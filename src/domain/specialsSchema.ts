import { z } from 'zod'
import type { BusinessState } from './model'

/** V3 specials: the stored shape, kept apart from the rules so the record schema can import it. */
const id = z.string().min(1).max(150)
const date = z.iso.date()
const categories = z
  .array(z.enum(['Skin', 'Body', 'Hair']))
  .min(1)
  .max(3)
  .refine((list) => new Set(list).size === list.length, 'Duplicate treatment kinds.')

/** The longest a special can run, so its result can be read against usual weeks. */
export const SPECIAL_MAX_DAYS = 92

export const specialInputSchema = z
  .object({
    signalId: id,
    title: z.string().trim().min(2).max(80),
    reason: z.string().trim().min(2).max(400),
    offer: z.string().trim().min(2).max(200),
    categories,
    startDate: date,
    endDate: date,
  })
  .strict()
export const specialSchema = z
  .object({ id, organisationId: id, createdAt: z.iso.datetime(), stoppedOn: date.optional() })
  .extend(specialInputSchema.shape)
export type Special = z.infer<typeof specialSchema>
export type SpecialInput = z.infer<typeof specialInputSchema>

export const specialsList = (s: BusinessState) => s.specials ?? []

export function specialsProblem(s: BusinessState) {
  const list = specialsList(s)
  if (new Set(list.map((x) => x.id)).size !== list.length) return 'Duplicate special IDs.'
  if (list.some((x) => x.organisationId !== s.organisation.id)) return 'Foreign workspace special.'
  if (list.some((x) => x.endDate < x.startDate)) return 'A special cannot end before it starts.'
  return null
}
