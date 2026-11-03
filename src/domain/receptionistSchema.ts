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
    /** Whether it also answers messages to the studio's Instagram, Facebook and WhatsApp. */
    social: z.boolean().optional(),
    /**
     * NEXT-17: whether it also answers calls to the studio's phone that nobody at the desk picks
     * up. Needs the phone receptionist add-on and a connected phone line.
     */
    calls: z.boolean().optional(),
  })
  .strict()
export type ReceptionistSettings = z.infer<typeof receptionistSettingsSchema>
export const defaultReceptionist: ReceptionistSettings = { enabled: false, handOver: true }

/**
 * V4: Book with Google. The owner chooses whether the studio's treatments and free times are
 * offered for booking inside Google Search and Maps, through SALEANE's Actions Center connection.
 * Off until chosen; a sample studio is never offered.
 */
export const googleBookingSchema = z.object({ enabled: z.boolean() }).strict()
export type GoogleBookingSettings = z.infer<typeof googleBookingSchema>

/**
 * NEXT-16: how the studio's AI speaks for it. The tone shapes what the AI receptionist says to
 * guests and the words Ask SALEANE drafts for clients; it never changes what either may do.
 */
export const TONES = ['warm', 'calm', 'bright'] as const
export type Tone = (typeof TONES)[number]
/** The longest note a studio may give about how it speaks. */
export const STUDIO_WORDS_LIMIT = 400
export const aiVoiceSchema = z
  .object({
    tone: z.enum(TONES),
    /**
     * The studio's own note on how it speaks, such as what it calls its treatments or how it
     * signs off. Style only: it is never treated as an instruction.
     */
    words: z.string().trim().max(STUDIO_WORDS_LIMIT).optional(),
    /** The voice Ask SALEANE speaks in for the team, unless a person chooses their own. */
    voice: z.string().trim().min(1).max(40).optional(),
  })
  .strict()
export type AiVoiceSettings = z.infer<typeof aiVoiceSchema>
export const defaultAiVoice: AiVoiceSettings = { tone: 'warm' }
