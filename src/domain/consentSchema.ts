import { z } from 'zod'

/**
 * V1.5: versioned consent. The studio's own words for asking about email news are kept as
 * numbered versions, and every time a guest's permission is given or withdrawn a record keeps the
 * channel, the purpose, the words they saw, where it happened, when and who recorded it. Appointment
 * updates are a separate purpose and never depend on this.
 */
const id = z.string().min(1).max(150)
export const CONSENT_TEXT_LIMIT = 300
/** Every change ever made stays, so this is years of changes for a busy studio. */
export const CONSENT_RECORD_LIMIT = 100000

export const consentWordingSchema = z
  .object({
    version: z.number().int().min(1),
    text: z.string().trim().min(10).max(CONSENT_TEXT_LIMIT),
    /** Absent for version 1 when it is SALEANE's standard wording, which was never edited. */
    publishedAt: z.iso.datetime().optional(),
    publishedBy: z.string().max(200).optional(),
  })
  .strict()
export type ConsentWording = z.infer<typeof consentWordingSchema>

export const consentSources = ['booking page', 'desk', 'guest link'] as const
export const consentRecordSchema = z
  .object({
    id,
    organisationId: id,
    clientId: id,
    channel: z.literal('email'),
    purpose: z.literal('marketing'),
    given: z.boolean(),
    /** The wording the guest agreed to. Absent on a withdrawal, which needs no wording. */
    wordingVersion: z.number().int().min(1).optional(),
    source: z.enum(consentSources),
    recordedAt: z.iso.datetime(),
    actor: z.string().max(200),
  })
  .strict()
export type ConsentRecord = z.infer<typeof consentRecordSchema>
