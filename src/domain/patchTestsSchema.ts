import { z } from 'zod'

/**
 * V1.5: patch tests for colour and other treatments that need one. This is a salon record and a
 * reminder, not a clinical one: when a test was done, what was tested, who did it and whether the
 * skin stayed clear. Nothing is deleted; a new test is added beside the old ones.
 */
const id = z.string().min(1).max(150)

/** How the studio works: how long before a visit a test must be done, and how long a clear one lasts. */
export const patchTestSettingsSchema = z
  .object({
    hoursBefore: z.number().int().min(24).max(168),
    validMonths: z.number().int().min(1).max(24),
    /** Message guests whose booked visit needs a test they have not had. */
    remind: z.boolean(),
  })
  .strict()
export type PatchTestSettings = z.infer<typeof patchTestSettingsSchema>
/** Most colour brands ask for a test 48 hours before; six months is a common salon rule. */
export const defaultPatchTestSettings: PatchTestSettings = {
  hoursBefore: 48,
  validMonths: 6,
  remind: true,
}

/** What the person who did the test enters. */
export const patchTestInputSchema = z
  .object({
    clientId: id,
    /** When the test was put on the skin. */
    testedAt: z.iso.datetime(),
    /** The product or shade tested, such as "Koleston Perfect 7/0 with 6% developer". */
    product: z.string().trim().min(2).max(150),
    /** Who did it, when they work here. */
    staffId: id.optional(),
    notes: z.string().trim().max(300),
  })
  .strict()
export type PatchTestInput = z.infer<typeof patchTestInputSchema>

export const patchTestResults = ['clear', 'reaction'] as const
export const patchTestResultSchema = z.enum(patchTestResults)

export const patchTestSchema = patchTestInputSchema.extend({
  id,
  organisationId: id,
  recordedAt: z.iso.datetime(),
  actor: z.string(),
  /** Absent until someone checks the skin and records what they saw. */
  result: z
    .object({
      outcome: patchTestResultSchema,
      notes: z.string().trim().max(300),
      at: z.iso.datetime(),
      actor: z.string(),
    })
    .strict()
    .optional(),
})
export type PatchTest = z.infer<typeof patchTestSchema>
