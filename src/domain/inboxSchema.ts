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

/** V4: the studio's Instagram, Facebook Page and WhatsApp Business messages. */
export const socialChannels = ['instagram', 'facebook', 'whatsapp'] as const
export type SocialChannel = (typeof socialChannels)[number]
export const isSocialChannel = (channel: string): channel is SocialChannel =>
  (socialChannels as readonly string[]).includes(channel)
export const socialLabel: Record<SocialChannel, string> = {
  instagram: 'Instagram',
  facebook: 'Facebook',
  whatsapp: 'WhatsApp',
}
/** Meta lets a business answer only within a day of the guest's last message. */
export const SOCIAL_WINDOW_MS = 24 * 60 * 60000
/** The shortest of the three apps' limits (Instagram's), so an answer fits wherever it goes. */
export const SOCIAL_ANSWER_LIMIT = 1000
export const SOCIAL_ANSWER_COUNT_LIMIT = 50000

/**
 * `email` and `sms` came in on the studio's lines; `desk` was noted by the team; `chat` was left
 * with the AI receptionist on the booking page (V4), with the email or number to answer on;
 * `instagram`, `facebook` and `whatsapp` came in on the studio's own accounts (V4), from the
 * sender's id on that app.
 */
export const replyChannels = ['email', 'sms', 'desk', 'chat', ...socialChannels] as const
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
    /** V4: the name the app gave the sender, when it gives one. */
    name: z.string().max(100).optional(),
    /** V4: the studio's own account it was sent to; the sender's id belongs to that account. */
    account: z.string().max(200).optional(),
    /** Who noted it, or the line it came in on. */
    actor: z.string(),
    readAt: z.iso.datetime().optional(),
    readBy: z.string().optional(),
    /**
     * Stage 1: a text that was only a phone network keyword, and what it did (textStop.ts):
     * `stop` turned texts off, `start` turned them back on, `asked` asked for texts again while
     * the desk keeps them off, `already` asked for texts that were not off, `help` asked for help.
     */
    keyword: z.enum(['stop', 'start', 'asked', 'already', 'help']).optional(),
  })
  .strict()
export type Reply = z.infer<typeof replySchema>
export type ReplyKeyword = NonNullable<Reply['keyword']>

/** Stage 1: one entry per number that ever texted STOP to the studio's line. */
export const TEXT_STOP_LIMIT = 50000
export const textStopSchema = z
  .object({
    /** International (E.164), as the text line gives it. */
    number: z.string().regex(/^\+[1-9]\d{7,14}$/),
    /** Their latest STOP. Nothing is texted to the number from then until `startedAt`. */
    stoppedAt: z.iso.datetime(),
    /** The reply that said STOP. */
    replyId: id,
    /** When they texted START (or UNSTOP, or YES) afterwards; absent while texts are stopped. */
    startedAt: z.iso.datetime().optional(),
    startReplyId: id.optional(),
  })
  .strict()
export type TextStop = z.infer<typeof textStopSchema>

export const savedReplyInputSchema = z
  .object({
    name: z.string().trim().min(2).max(60),
    body: z.string().trim().min(2).max(3000),
  })
  .strict()
export const savedReplySchema = savedReplyInputSchema.extend({ id }).strict()
export type SavedReply = z.infer<typeof savedReplySchema>

/** V4: the team's answer to a guest's message on Instagram, Facebook or WhatsApp. */
export const socialAnswerSchema = z
  .object({
    id,
    organisationId: id,
    clientId: id.optional(),
    channel: z.enum(socialChannels),
    /** The guest's id on that app, as their message came from. */
    to: z.string().trim().min(1).max(200),
    /** The studio's account the guest wrote to; the answer goes only from that account. */
    account: z.string().trim().min(1).max(200),
    body: z.string().trim().min(1).max(SOCIAL_ANSWER_LIMIT),
    answeredAt: z.iso.datetime(),
    actor: z.string(),
  })
  .strict()
export type SocialAnswer = z.infer<typeof socialAnswerSchema>
