import { z } from 'zod'

/**
 * V1.5: consultations. Before a bigger or new treatment (a colour change, extensions, a bridal
 * look) the studio talks it through with the guest and writes down what they want, what was
 * agreed and any price given. Each change is a new version, and a visit booked from it keeps the
 * version it was booked against. Ordinary notes only: health questions are refused.
 */
const id = z.string().min(1).max(150)
const text = (max: number) => z.string().trim().max(max)
export const CONSULTATION_LIMIT = 20000
export const CONSULTATION_TEXT_LIMIT = 1000

/** What was said and agreed. Saving a change makes a new version. */
export const consultationContentSchema = z
  .object({
    /** The treatments talked about, from the studio's own services. */
    serviceIds: z.array(id).max(10),
    wants: text(CONSULTATION_TEXT_LIMIT),
    plan: text(CONSULTATION_TEXT_LIMIT).pipe(z.string().min(2)),
    /** The price given to the guest, in minor units, or null when none was given. */
    quoteMinor: z.number().int().nonnegative().max(100_000_000).nullable(),
    notes: text(CONSULTATION_TEXT_LIMIT),
  })
  .strict()
export type ConsultationContent = z.infer<typeof consultationContentSchema>

export const consultationVersionSchema = consultationContentSchema
  .extend({ version: z.number().int().min(1), savedAt: z.iso.datetime(), savedBy: z.string() })
  .strict()

export const consultationSchema = z
  .object({
    id,
    organisationId: id,
    clientId: id,
    /** Who talked it through with the guest. */
    staffId: id.optional(),
    heldOn: z.iso.date(),
    versions: z.array(consultationVersionSchema).min(1).max(100),
  })
  .strict()
export type Consultation = z.infer<typeof consultationSchema>

/** The consultation and version a visit was booked against. */
export const visitConsultationSchema = z.object({ id, version: z.number().int().min(1) }).strict()
