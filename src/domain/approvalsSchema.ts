import { z } from 'zod'
import { rotaCommandSchemas } from './rotaSchema'

const id = z.string().min(1).max(150)
const amount = z.number().int().min(1).max(10_000_000_00)
const minor = z.number().int().nonnegative().max(100_000_000)

/**
 * V5: requests that need a sign-off, such as spending on a branch. A request at a location in a
 * region goes to that region's manager, unless it costs more than they may approve; then, or
 * when the location is in no region, it passes up to the owner. The owner can decide any request.
 *
 * Stage 4: three kinds carry the change itself, so approving one does exactly what was asked.
 * A refund over a manager's limit waits as a request for that receipt and amount; once approved
 * it can be given back once, from the receipt, within `REFUND_APPROVAL_DAYS`. A new price for a
 * treatment at one location starts on its day by itself. A day on the rota changes as approved.
 */
export const REQUEST_LIMIT = 5000
/** What a regional manager may approve when the owner has not set a limit, in pence or cents. */
export const DEFAULT_REGIONAL_LIMIT = 500_00
/** How many of the studio's days an approved refund stays ready to give back. */
export const REFUND_APPROVAL_DAYS = 7
/** How far ahead a new price can start, in days from today. */
export const PRICE_AHEAD_DAYS = 366

export const requestKinds = ['spend', 'other', 'refund', 'price', 'rota'] as const
export type RequestKind = (typeof requestKinds)[number]
/** The kinds anyone who raises requests may ask for; the others carry a change to a location. */
export const plainKinds = ['spend', 'other'] as const

/** The receipt money goes back from: a visit's receipt, a deposit or fee, or a walk-in sale. */
export const refundTargetSchema = z
  .object({
    saleId: id.optional(),
    paymentId: id.optional(),
    counterSaleId: id.optional(),
  })
  .strict()
  .refine(
    (t) => [t.saleId, t.paymentId, t.counterSaleId].filter(Boolean).length === 1,
    'Choose one receipt.',
  )
export type RefundTarget = z.infer<typeof refundTargetSchema>

/** The exact day on the rota asked for: one day changed, or one day put back to usual. */
export const rotaAskSchema = z.discriminatedUnion('type', [
  rotaCommandSchemas[0],
  rotaCommandSchemas[1],
])
export type RotaAsk = z.infer<typeof rotaAskSchema>

export const requestInputSchema = z
  .object({
    locationId: id,
    kind: z.enum(requestKinds),
    /** What it is for. A refund, price or rota request is named from what it asks. */
    title: z.string().trim().min(2).max(80).optional(),
    amountMinor: amount.optional(),
    note: z.string().trim().max(500).optional(),
    /** Stage 4: the receipt a refund is for. Its amount is `amountMinor`, its reason `note`. */
    refund: refundTargetSchema.optional(),
    /** Stage 4: a treatment's new price at this location, and the day it starts. */
    price: z
      .object({ serviceId: id, priceMinor: minor, startsOn: z.iso.date() })
      .strict()
      .optional(),
    /** Stage 4: the day on the rota to change, exactly as it would be saved. */
    rota: rotaAskSchema.optional(),
  })
  .strict()
  .superRefine((r, ctx) => {
    const issue = (message: string, path: string) =>
      ctx.addIssue({ code: 'custom', message, path: [path] })
    if ((r.kind === 'spend' || r.kind === 'other') && !r.title)
      issue('Say what it is for.', 'title')
    if (r.kind === 'spend' && r.amountMinor === undefined)
      issue('Say how much it will cost.', 'amountMinor')
    if (r.kind === 'refund') {
      if (!r.refund) issue('Choose the receipt.', 'refund')
      if (r.amountMinor === undefined) issue('Say how much goes back.', 'amountMinor')
      if (!r.note || r.note.length < 3) issue('Say why the money goes back.', 'note')
    }
    if (r.kind === 'price' && !r.price) issue('Choose the treatment and its new price.', 'price')
    if (r.kind === 'rota' && !r.rota) issue('Choose the day on the rota.', 'rota')
    if (r.refund && r.kind !== 'refund') issue('Only a refund names a receipt.', 'refund')
    if (r.price && r.kind !== 'price') issue('Only a new price names a treatment.', 'price')
    if (r.rota && r.kind !== 'rota') issue('Only a rota change names a day.', 'rota')
  })
export type RequestInput = z.infer<typeof requestInputSchema>

export const routeSchema = z.discriminatedUnion('level', [
  z.object({ level: z.literal('regional'), regionId: id }).strict(),
  z.object({ level: z.literal('owner') }).strict(),
])
export type Route = z.infer<typeof routeSchema>

/**
 * What a refund request is for, as the person deciding sees it: the receipt number, what was
 * sold and what it can still give back. Never the client: a regional manager decides from this.
 */
const refundAskSchema = z
  .object({
    saleId: id.optional(),
    paymentId: id.optional(),
    counterSaleId: id.optional(),
    /** The receipt number, or "Deposit" or "Missed visit fee" for a payment without one. */
    receipt: z.string().min(1).max(80),
    /** The treatment or products, by name. */
    what: z.string().min(1).max(200),
    /** What the receipt could give back in all, and what had gone back before this request. */
    paidMinor: minor,
    refundedMinor: minor,
  })
  .strict()

const priceAskSchema = z
  .object({
    serviceId: id,
    serviceName: z.string().min(1).max(100),
    /** The price at this location when it was asked for, and the price asked for. */
    fromMinor: minor,
    toMinor: minor,
    startsOn: z.iso.date(),
  })
  .strict()

/** A day as the rota plans it: "off", "usual" or its hours, such as "540-1020". */
const dayValue = z.string().regex(/^(off|usual|\d{1,4}-\d{1,4})$/)
const rotaRequestSchema = z
  .object({
    /** The command that is run, exactly as asked, when the request is approved. */
    command: rotaAskSchema,
    staffId: id,
    /** Their first name, for the people deciding. */
    staffName: z.string().min(1).max(100),
    date: z.iso.date(),
    before: dayValue,
    after: dayValue,
    /** Other hours, an extra day, a day not working, or the day back to usual. */
    change: z.enum(['hours', 'extra', 'off', 'usual']),
  })
  .strict()

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
    passedUp: z.enum(['over-limit', 'no-region', 'no-manager', 'own-request']).optional(),
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
    refund: refundAskSchema.optional(),
    price: priceAskSchema.optional(),
    rota: rotaRequestSchema.optional(),
    /**
     * Stage 4: when what was approved happened: the refund given back (its record), the new price
     * started (the treatment) or the rota changed (the day's change).
     */
    carriedOut: z
      .object({ at: z.string(), by: z.string().optional(), recordId: id.optional() })
      .strict()
      .optional(),
    /** Stage 4: an approved new price that could not start on its day, and why. */
    notStarted: z
      .object({ at: z.string(), reason: z.string().max(300) })
      .strict()
      .optional(),
  })
  .strict()
export type ApprovalRequest = z.infer<typeof approvalRequestSchema>

/** Stage 4: which rota changes by a general manager need a sign-off. */
export const rotaSignOffs = ['extra', 'all'] as const
export const approvalSettingsSchema = z
  .object({
    regionalLimitMinor: z.number().int().min(0).max(10_000_000_00),
    /**
     * Stage 4: the most a general manager, or a manager, may give back on one receipt without a
     * sign-off. Absent means no limit.
     */
    generalRefundLimitMinor: minor.optional(),
    managerRefundLimitMinor: minor.optional(),
    /** Stage 4: rota changes a general manager makes that need a sign-off. Absent means none. */
    rotaSignOff: z.enum(rotaSignOffs).optional(),
  })
  .strict()
export type ApprovalSettings = z.infer<typeof approvalSettingsSchema>

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
  /** Stage 4: the owner's refund limits, which rota changes need a sign-off, and the regional limit. */
  z
    .object({
      type: z.literal('signoff-rules'),
      /** The regional limit too, when the studio has regions, so the rules save together. */
      regionalLimitMinor: z.number().int().min(0).max(10_000_000_00).optional(),
      generalRefundLimitMinor: minor.nullable(),
      managerRefundLimitMinor: minor.nullable(),
      rotaSignOff: z.enum(['off', 'extra', 'all']),
    })
    .strict(),
  /**
   * Stage 4: an approved new price starting on its day. Only the server sends this, once the day
   * has come; nobody can send it from a screen.
   */
  z.object({ type: z.literal('request-start'), requestId: id }).strict(),
] as const
