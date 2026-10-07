import { z } from 'zod'

/**
 * V1.5: the inbox. Guests' replies are kept beside the messages the studio wrote, so each guest
 * reads as one conversation. A reply comes from the studio's email or text line once one is
 * connected, or is noted by the team when a guest answered by phone or in person. Saved replies
 * are the studio's own short wordings to start a message from.
 */
const id = z.string().min(1).max(150)
export const REPLY_LIMIT = 50000
export const REPLY_TEXT_LIMIT = 2000
export const SAVED_REPLY_LIMIT = 50

/** `email` and `sms` came in on the studio's lines; `desk` was noted by the team. */
export const replyChannels = ['email', 'sms', 'desk'] as const
/** How a guest answered when the team notes it down. */
export const noteWays = ['phone', 'in person', 'elsewhere'] as const

export const replySchema = z
  .object({
    id,
    organisationId: id,
    /** The guest it came from. Absent when the address or number matches no single client. */
    clientId: id.optional(),
    channel: z.enum(replyChannels),
    /** The address or number it came from; for a noted reply, how the guest answered. */
    from: z.string().trim().min(1).max(200),
    body: z.string().trim().min(1).max(REPLY_TEXT_LIMIT),
    receivedAt: z.iso.datetime(),
    /** The provider's own id for a reply that came in on a line, so a repeat is kept once. */
    providerRef: z.string().max(200).optional(),
    /** Who noted it, or the line it came in on. */
    actor: z.string(),
    readAt: z.iso.datetime().optional(),
    readBy: z.string().optional(),
  })
  .strict()
export type Reply = z.infer<typeof replySchema>

export const savedReplyInputSchema = z
  .object({
    name: z.string().trim().min(2).max(60),
    body: z.string().trim().min(2).max(3000),
  })
  .strict()
export const savedReplySchema = savedReplyInputSchema.extend({ id }).strict()
export type SavedReply = z.infer<typeof savedReplySchema>
