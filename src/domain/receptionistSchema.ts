import { z } from 'zod'

/**
 * V4: the AI receptionist on the booking page. Off until the owner or a manager turns it on. It
 * answers guests' questions from the studio's own records, finds free times for the guest to book
 * through the ordinary booking steps, and passes anything else to the team's inbox. It always says
 * it is an AI, and it never books, moves, cancels or takes a payment by itself.
 */
export const receptionistSettingsSchema = z
  .object({
    enabled: z.boolean(),
    /** Whether a guest may leave a message for the team, which arrives in the inbox. */
    handOver: z.boolean(),
    /** Whether it also answers texts to the studio's text line. Off unless chosen. */
    texts: z.boolean().optional(),
  })
  .strict()
export type ReceptionistSettings = z.infer<typeof receptionistSettingsSchema>
export const defaultReceptionist: ReceptionistSettings = { enabled: false, handOver: true }
