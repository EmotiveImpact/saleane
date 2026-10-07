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
  })
  .strict()
export type ReminderSettings = z.infer<typeof reminderSettingsSchema>
export const defaultReminderSettings: ReminderSettings = {
  confirmations: true,
  reminders: true,
  hoursBefore: 24,
  email: true,
  sms: true,
}
