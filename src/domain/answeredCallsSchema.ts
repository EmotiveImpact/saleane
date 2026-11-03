import { z } from 'zod'

/**
 * NEXT-17: calls the AI receptionist answered on the studio's phone line, when nobody at the desk
 * picked up. Each keeps what was said, any booking link it texted and any message for the team,
 * so the desk can read the call and follow it up. Kept apart so `operations` can embed it.
 */
const id = z.string().min(1).max(150)
/** Years of answered calls for a busy studio. Nothing is removed automatically. */
export const ANSWERED_CALL_LIMIT = 5000
/** What one call keeps of the conversation, so a long call cannot fill the studio's record. */
export const CALL_TURN_LIMIT = 60
export const CALL_TEXT_LIMIT = 1000
/** Booking links one call may text to the caller. */
export const CALL_TEXTS_LIMIT = 2

export const callTurnSchema = z
  .object({
    from: z.enum(['guest', 'receptionist']),
    text: z.string().trim().min(1).max(CALL_TEXT_LIMIT),
  })
  .strict()
export type CallTurn = z.infer<typeof callTurnSchema>

export const callMessageSchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    contact: z.string().trim().min(5).max(200),
    message: z.string().trim().min(2).max(1000),
  })
  .strict()

export const answeredCallSchema = z
  .object({
    id,
    /** The caller's number with its country code; absent when they withheld it. */
    number: z
      .string()
      .regex(/^\+[1-9]\d{7,14}$/)
      .optional(),
    /** When the AI receptionist answered, and how long the call lasted. */
    at: z.iso.datetime(),
    seconds: z.number().int().min(0).max(7200),
    turns: z.array(callTurnSchema).max(CALL_TURN_LIMIT),
    /** Each time it texted the caller a link to book, as it described the time. */
    texted: z.array(z.string().trim().min(1).max(300)).max(CALL_TEXTS_LIMIT),
    /** A message the caller left for the team. */
    message: callMessageSchema.optional(),
    /** A client whose number this is, when there is exactly one. */
    clientId: id.optional(),
    /** Someone at the studio read it and followed it up. */
    doneAt: z.iso.datetime().optional(),
    doneBy: z.string().optional(),
  })
  .strict()
export type AnsweredCall = z.infer<typeof answeredCallSchema>
