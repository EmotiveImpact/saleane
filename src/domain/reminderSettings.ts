import { z } from 'zod'

/** PILOT-01 studio settings for confirmations and reminders. Kept apart so `operations` can embed it. */
export const reminderHourChoices = [2, 24, 48] as const
export const reminderSettingsSchema = z
  .object({
    confirmations: z.boolean(),
    reminders: z.boolean(),
    hoursBefore: z.union([z.literal(2), z.literal(24), z.literal(48)]),
    email: z.boolean(),
    sms: z.boolean(),
    /** V1.5: a private "how was your visit?" email after checkout. Absent means on. */
    feedback: z.boolean().optional(),
    /** V1.5: care advice the day of the visit, for treatments that have some. Absent means on. */
    aftercare: z.boolean().optional(),
    /** V1.5: a "you're due back" email to guests who agreed to hear from the studio. Absent means on. */
    dueBack: z.boolean().optional(),
  })
  .strict()
export type ReminderSettings = z.infer<typeof reminderSettingsSchema>
export const defaultReminderSettings: ReminderSettings = {
  confirmations: true,
  reminders: true,
  hoursBefore: 24,
  email: true,
  sms: true,
  feedback: true,
  aftercare: true,
  dueBack: true,
}
