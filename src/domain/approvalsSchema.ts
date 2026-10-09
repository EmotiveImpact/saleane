import { z } from 'zod'

const id = z.string().min(1).max(150)
const amount = z.number().int().min(1).max(10_000_000_00)

/**
 * V5: requests that need a sign-off, such as spending on a branch. A request at a location in a
 * region goes to that region's manager, unless it costs more than they may approve; then, or
 * when the location is in no region, it passes up to the owner. The owner can decide any request.
 */
export const REQUEST_LIMIT = 5000
/** What a regional manager may approve when the owner has not set a limit, in pence or cents. */
export const DEFAULT_REGIONAL_LIMIT = 500_00

export const requestKinds = ['spend', 'other'] as const
export const requestInputSchema = z
  .object({
    locationId: id,
    kind: z.enum(requestKinds),
    title: z.string().trim().min(2).max(80),
    amountMinor: amount.optional(),
    note: z.string().trim().max(500).optional(),
  })
  .strict()
  .refine((r) => r.kind !== 'spend' || r.amountMinor !== undefined, {
    message: 'Say how much it will cost.',
    path: ['amountMinor'],
  })

export const routeSchema = z.discriminatedUnion('level', [
  z.object({ level: z.literal('regional'), regionId: id }).strict(),
  z.object({ level: z.literal('owner') }).strict(),
])
export type Route = z.infer<typeof routeSchema>

export const approvalRequestSchema = z
  .object({
    id,
    locationId: id,
    kind: z.enum(requestKinds),
    title: z.string().min(2).max(80),
    amountMinor: amount.optional(),
    note: z.string().max(500).optional(),
    /** Who it went to when it was raised, and why it passed up if it did. */
    routedTo: routeSchema,
    passedUp: z.enum(['over-limit', 'no-region', 'no-manager']).optional(),
    raisedAt: z.string(),
    raisedBy: z.string().optional(),
    /** The account that raised it, from the server's session. Older requests have none. */
    raisedById: id.optional(),
    decision: z
      .object({
        outcome: z.enum(['approved', 'declined']),
        note: z.string().max(500).optional(),
        at: z.string(),
        by: z.string().optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
export type ApprovalRequest = z.infer<typeof approvalRequestSchema>

export const approvalSettingsSchema = z
  .object({ regionalLimitMinor: z.number().int().min(0).max(10_000_000_00) })
  .strict()

export const approvalCommandSchemas = [
  z
    .object({
      type: z.literal('request-raise'),
      input: requestInputSchema,
      /**
       * Regions that have a regional manager. The server always supplies this from its access
       * records; without it (the browser demo) every request goes to the owner.
       */
      managedRegions: z.array(id).max(50).optional(),
      /**
       * Who raised it, and the region they look after when they are a regional manager. The
       * server supplies both from the session, overwriting anything the browser sent.
       */
      raisedById: id.optional(),
      raiserRegion: id.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('request-decide'),
      requestId: id,
      outcome: z.enum(['approved', 'declined']),
      note: z.string().trim().max(500).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('approval-limit'),
      regionalLimitMinor: z.number().int().min(0).max(10_000_000_00),
    })
    .strict(),
] as const
