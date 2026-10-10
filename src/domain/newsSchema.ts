import { z } from 'zod'

const id = z.string().min(1).max(150)
const when = z.iso.datetime()
const who = z.string().max(200)
const count = z.number().int().min(0).max(1_000_000)

/**
 * Stage 4: one message from the studio to its clients, for the whole group or chosen locations.
 * A draft is written and saved, can be changed until the owner approves it, and then goes through
 * the outbox one client at a time, to clients who agreed to news and only in the way they allow.
 * Nothing is ever deleted: a draft put aside is marked so, and a message stopped part-way keeps
 * who stopped it and when.
 */
export const NEWS_LIMIT = 500
export const NEWS_SUBJECT_LIMIT = 120
export const NEWS_BODY_LIMIT = 1000
/** A client of a location had a visit there within this many months, or has one booked there. */
export const NEWS_MONTHS = 12
/** How each client is reached: email only, or by text where they agreed to texts. */
export const newsWays = ['email', 'either'] as const
export type NewsWay = (typeof newsWays)[number]
export const newsStatuses = ['draft', 'approved', 'stopped', 'discarded'] as const
export type NewsStatus = (typeof newsStatuses)[number]

const unique = (ids: string[]) => new Set(ids).size === ids.length
const locationIds = z
  .array(id)
  .min(1)
  .max(50)
  .refine(unique, 'Choose each location once.')
  .optional()

export const newsInputSchema = z
  .object({
    subject: z.string().trim().min(3).max(NEWS_SUBJECT_LIMIT),
    body: z.string().trim().min(10).max(NEWS_BODY_LIMIT),
    by: z.enum(newsWays),
    /** The locations whose clients it is for; absent means every client of the studio. */
    locationIds,
    /** A line with the studio's booking page at the end. */
    bookLink: z.boolean().optional(),
  })
  .strict()
export type NewsInput = z.infer<typeof newsInputSchema>

export const newsMessageSchema = z
  .object({
    id,
    subject: z.string().min(3).max(NEWS_SUBJECT_LIMIT),
    body: z.string().min(10).max(NEWS_BODY_LIMIT),
    by: z.enum(newsWays),
    locationIds,
    bookLink: z.boolean().optional(),
    status: z.enum(newsStatuses),
    createdAt: when,
    /** Who wrote the draft. */
    actor: who,
    editedAt: when.optional(),
    editedBy: who.optional(),
    approvedAt: when.optional(),
    approvedBy: who.optional(),
    /** How many clients it was approved for, by email and by text, counted at approval. */
    toEmail: count.optional(),
    toText: count.optional(),
    /** Clients who would have been in it but were left out, for the record. */
    leftOut: count.optional(),
    /** Approved in a sample studio: nothing was queued or sent. */
    sample: z.literal(true).optional(),
    stoppedAt: when.optional(),
    stoppedBy: who.optional(),
    discardedAt: when.optional(),
    discardedBy: who.optional(),
  })
  .strict()
export type NewsMessage = z.infer<typeof newsMessageSchema>

/** The numbers the owner saw, so approval goes ahead only if they still hold. */
const expected = z.object({ email: count, text: count }).strict()

export const newsCommandSchemas = [
  /** Writes a new draft, or changes one that is not yet approved. */
  z.object({ type: z.literal('news-save'), id: id.optional(), input: newsInputSchema }).strict(),
  z
    .object({
      type: z.literal('news-approve'),
      messageId: id,
      expect: expected,
      /** Set by the server from its records of erasure requests; never trusted from a browser. */
      erased: z.array(id).max(100_000).optional(),
    })
    .strict(),
  /** Stops whatever has not gone yet. */
  z.object({ type: z.literal('news-stop'), messageId: id }).strict(),
  /** Puts a draft aside. It stays in the record. */
  z.object({ type: z.literal('news-discard'), messageId: id }).strict(),
  /** A client's own link in an email turns their news off. Only the server sends this. */
  z.object({ type: z.literal('news-unsubscribe'), clientId: id, messageId: id }).strict(),
] as const
export const NEWS_COMMANDS = [
  'news-save',
  'news-approve',
  'news-stop',
  'news-discard',
  'news-unsubscribe',
] as const
