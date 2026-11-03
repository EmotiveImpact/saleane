import { z } from 'zod'

/**
 * Stage 5: booking through ChatGPT or Claude. The owner chooses whether an AI assistant may book
 * visits for guests through the studio's own booking connection, with the same checks as the
 * booking page. Off until chosen.
 */
export const aiBookingSchema = z.object({ enabled: z.boolean() }).strict()
export type AiBookingSettings = z.infer<typeof aiBookingSchema>
