import { z } from 'zod'

const id = z.string().min(1).max(150)
const civilDate = z.iso.date()

/**
 * Stage 6: deciding about records at the end of their keeping period (see dataRetention.ts for the
 * register and retentionDue.ts for the rules). The kinds of record SALEANE works out from the
 * studio record. Money records are never one of them: receipts, payments, deposits, refunds and
 * booked visit terms stay, under a neutral "Former client" name once a client's details go.
 */
export const RETENTION_KINDS = ['client', 'feedback', 'message', 'waitlist'] as const
export type RetentionKind = (typeof RETENTION_KINDS)[number]
export const EXTENSION_UNITS = ['months', 'years'] as const

/** The most records one decision covers, and the furthest a record can be kept at once. */
export const RETENTION_DECISION_LIMIT = 500
export const KEEP_MAX = { years: 10, months: 120 } as const
const KEPT_LIMIT = 50_000
const DECISIONS_LIMIT = 1_000

const ids = z
  .array(id)
  .min(1)
  .max(RETENTION_DECISION_LIMIT)
  .refine((list) => new Set(list).size === list.length, 'Name each record once.')

/** A record kept past its period, until a new date, and why. It comes back on that date. */
export const retentionKeepSchema = z
  .object({
    kind: z.enum(RETENTION_KINDS),
    recordId: id,
    until: civilDate,
    amount: z.number().int().min(1).max(KEEP_MAX.months),
    unit: z.enum(EXTENSION_UNITS),
    reason: z.string().trim().min(3).max(300),
    at: z.iso.datetime(),
    actor: z.string().max(200),
  })
  .strict()
export type RetentionKeep = z.infer<typeof retentionKeepSchema>

/**
 * One decision as it was made: who, when, which kind and how many. Never what was deleted: no
 * names, no ids of deleted records and no content, so the record of the decision is not a copy.
 */
export const retentionDecisionSchema = z
  .object({
    id,
    choice: z.enum(['delete', 'keep']),
    kind: z.enum(RETENTION_KINDS),
    count: z.number().int().min(1).max(RETENTION_DECISION_LIMIT),
    /** Kept until, for a decision to keep. */
    until: civilDate.optional(),
    at: z.iso.datetime(),
    actor: z.string().max(200),
  })
  .strict()
export type RetentionDecision = z.infer<typeof retentionDecisionSchema>

export const retentionRecordSchema = z
  .object({
    kept: z.array(retentionKeepSchema).max(KEPT_LIMIT),
    decisions: z.array(retentionDecisionSchema).max(DECISIONS_LIMIT),
  })
  .strict()
export type RetentionRecord = z.infer<typeof retentionRecordSchema>
export const RETENTION_DECISIONS_KEPT = DECISIONS_LIMIT

export const retentionCommandSchemas = [
  /** Approve deleting records that have reached the end of their period. Final. */
  z.object({ type: z.literal('retention-delete'), kind: z.enum(RETENTION_KINDS), ids }).strict(),
  /** Keep records longer, by whole months or years (years by default), with a reason. */
  z
    .object({
      type: z.literal('retention-keep'),
      kind: z.enum(RETENTION_KINDS),
      ids,
      amount: z.number().int().min(1).max(KEEP_MAX.months),
      unit: z.enum(EXTENSION_UNITS),
      reason: z.string().trim().min(3).max(300),
    })
    .strict(),
] as const
