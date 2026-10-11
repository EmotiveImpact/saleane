import { z } from 'zod'

/**
 * Stage 3: commission beyond one rate per person. Kept apart so the operations and command schemas
 * can use it. Every record is a change from a date, like the usual rates, so a later change never
 * rewrites pay already worked out for earlier days: the record in force on a day is the latest one
 * starting on or before it.
 */
const id = z.string().min(1).max(150)
const date = z.iso.date()
const bps = z.number().int().min(0).max(10000)
const money = z.number().int().nonnegative().max(100_000_000)
/** A calendar month, "2026-10". */
export const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Choose a month.')

export const COMMISSION_RATE_LIMIT = 2000
export const COMMISSION_STEPS_LIMIT = 500
export const STAFF_TARGET_LIMIT = 2000
/** The most steps one set can have. */
export const MOST_STEPS = 5

export const treatmentKinds = ['Skin', 'Body', 'Hair'] as const

/** What a rate of its own is for: one treatment, a kind of treatment, products, or one product. */
export const rateItemSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('treatment'), serviceId: id }).strict(),
  z.object({ kind: z.literal('category'), category: z.enum(treatmentKinds) }).strict(),
  z.object({ kind: z.literal('products') }).strict(),
  z.object({ kind: z.literal('product'), productId: id }).strict(),
])
export type RateItem = z.infer<typeof rateItemSchema>

export const commissionRateInputSchema = z
  .object({
    /** One person, or everyone when absent. */
    staffId: id.optional(),
    item: rateItemSchema,
    /** Null ends the rate of its own from this date, so the usual rate applies again. */
    bps: bps.nullable(),
    from: date,
  })
  .strict()
export const commissionRateSchema = commissionRateInputSchema
  .extend({ id, createdAt: z.iso.datetime(), actor: z.string() })
  .strict()
export type CommissionRate = z.infer<typeof commissionRateSchema>

/** One step: from this much of the month's takings, this rate. The first step starts at nothing. */
export const stepSchema = z.object({ fromMinor: money, bps }).strict()
export const stepKinds = ['marginal', 'whole'] as const
export const stepScopes = ['treatments', 'all'] as const

export const commissionStepsInputSchema = z
  .object({
    staffId: id.optional(),
    /** What the steps count and pay on: treatments only, or treatments and products together. */
    on: z.enum(stepScopes),
    /** Only the takings above a step earn its rate, or the whole month does once it is reached. */
    kind: z.enum(stepKinds),
    /** Null stops the steps from this month, so the usual rate applies again. */
    steps: z
      .array(stepSchema)
      .min(2)
      .max(MOST_STEPS)
      .refine((steps) => steps[0].fromMinor === 0, 'The first step starts at nothing.')
      .refine(
        (steps) => steps.every((step, i) => i === 0 || step.fromMinor > steps[i - 1].fromMinor),
        'Each step starts above the one before.',
      )
      .nullable(),
    /** Steps count a calendar month's takings, so they start on the first of a month. */
    from: date.refine((d) => d.endsWith('-01'), 'Steps start on the first of a month.'),
  })
  .strict()
export const commissionStepsSchema = commissionStepsInputSchema
  .extend({ id, createdAt: z.iso.datetime(), actor: z.string() })
  .strict()
export type CommissionSteps = z.infer<typeof commissionStepsSchema>

/**
 * A monthly takings target for one person, from a month onwards. Treatment and product targets
 * are optional extras beside the total. A null total stops the target from that month.
 */
export const staffTargetInputSchema = z
  .object({
    staffId: id,
    from: monthSchema,
    takingsMinor: money.refine((n) => n > 0, 'Enter the target.').nullable(),
    treatmentsMinor: money.refine((n) => n > 0).optional(),
    productsMinor: money.refine((n) => n > 0).optional(),
  })
  .strict()
export const staffTargetSchema = staffTargetInputSchema
  .extend({ id, createdAt: z.iso.datetime(), actor: z.string() })
  .strict()
export type StaffTarget = z.infer<typeof staffTargetSchema>

export const commissionCommandSchemas = [
  z.object({ type: z.literal('commission-rate'), input: commissionRateInputSchema }).strict(),
  z.object({ type: z.literal('commission-steps'), input: commissionStepsInputSchema }).strict(),
  z.object({ type: z.literal('staff-target'), input: staffTargetInputSchema }).strict(),
] as const
