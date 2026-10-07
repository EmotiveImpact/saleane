import { z } from 'zod'
import type { BusinessState } from './model'

/**
 * V3 reminders: notes the team leaves for a day ("call the supplier on Friday"). The stored shape
 * is kept apart from the rules so the record schema can import it. Nothing is sent by a reminder.
 */
const id = z.string().min(1).max(150)

/** Open reminders a studio can hold at once, so the list stays a list. */
export const TASKS_MAX_OPEN = 200

export const taskInputSchema = z
  .object({ text: z.string().trim().min(2).max(200), dueDate: z.iso.date() })
  .strict()
export const taskSchema = z
  .object({
    id,
    organisationId: id,
    createdAt: z.iso.datetime(),
    /** Who asked for it, as the team knows them. */
    createdBy: z.string().max(120).optional(),
    doneAt: z.iso.datetime().optional(),
  })
  .extend(taskInputSchema.shape)
export type Task = z.infer<typeof taskSchema>
export type TaskInput = z.infer<typeof taskInputSchema>

export const tasksList = (s: BusinessState) => s.tasks ?? []

export function tasksProblem(s: BusinessState) {
  const list = tasksList(s)
  if (new Set(list.map((x) => x.id)).size !== list.length) return 'Duplicate reminder IDs.'
  if (list.some((x) => x.organisationId !== s.organisation.id)) return 'Foreign workspace reminder.'
  return null
}
