import type { BusinessState } from './model'
import { TASKS_MAX_OPEN, tasksList } from './tasksSchema'
import type { Task, TaskInput } from './tasksSchema'

/** Reminders still to do, earliest first. */
export const openTasks = (s: BusinessState) =>
  tasksList(s)
    .filter((t) => !t.doneAt)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.createdAt.localeCompare(b.createdAt))

/** Reminders for today, with any from earlier days still not done. */
export const dueTasks = (s: BusinessState, today: string) =>
  openTasks(s).filter((t) => t.dueDate <= today)

export function addTask(
  next: BusinessState,
  input: TaskInput,
  today: string,
  now: string,
  makeId: () => string,
) {
  if (input.dueDate < today) throw new Error('Choose today or a later day for a reminder.')
  if (openTasks(next).length >= TASKS_MAX_OPEN)
    throw new Error('There are too many open reminders. Tick some off first.')
  const task: Task = {
    ...input,
    id: makeId(),
    organisationId: next.organisation.id,
    createdAt: now,
  }
  next.tasks = [...tasksList(next), task]
  return task.id
}

export function completeTask(next: BusinessState, taskId: string, now: string) {
  const task = tasksList(next).find((t) => t.id === taskId)
  if (!task) throw new Error('Reminder not found.')
  if (!task.doneAt) task.doneAt = now
  return task.id
}
