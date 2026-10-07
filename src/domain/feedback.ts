import { z } from 'zod'
import type { BusinessState } from './model'

/**
 * V1.5: private client feedback. After a completed visit the guest can rate the visit and the
 * person who looked after them, with an optional comment, from their private visit link. Only
 * owners and managers read comments and individual ratings. A practitioner sees only their own
 * average, once enough ratings exist that no single guest's score stands out. Public reviews are a
 * separate, neutral request to the studio's Google page; nothing here is ever published.
 */
export const FEEDBACK_COMMENT_LIMIT = 1000
/** A practitioner's own average shows once this many different guests have rated them. */
export const PRACTITIONER_AVERAGE_MIN = 3
/** Feedback can be given for this long after the visit starts (the private link's lifetime). */
export const FEEDBACK_WINDOW_MS = 7 * 24 * 60 * 60000

const id = z.string().min(1).max(150)
const rating = z.number().int().min(1).max(5)
export const feedbackInputSchema = z
  .object({
    visitRating: rating,
    practitionerRating: rating,
    comment: z.string().trim().max(FEEDBACK_COMMENT_LIMIT),
  })
  .strict()
export const feedbackSchema = z
  .object({
    id,
    organisationId: id,
    appointmentId: id,
    clientId: id,
    staffId: id,
    createdAt: z.iso.datetime(),
  })
  .extend(feedbackInputSchema.shape)
export type Feedback = z.infer<typeof feedbackSchema>

export const feedbackList = (s: BusinessState) => s.feedback ?? []
export const feedbackForVisit = (s: BusinessState, appointmentId: string) =>
  feedbackList(s).find((f) => f.appointmentId === appointmentId)

/** Whether a guest can still leave feedback for this visit. */
export function feedbackOpen(
  s: BusinessState,
  appointmentId: string,
  visitStartMs: number,
  now: number,
) {
  const a = s.appointments.find((item) => item.id === appointmentId)
  return (
    a?.status === 'completed' &&
    !feedbackForVisit(s, appointmentId) &&
    now < visitStartMs + FEEDBACK_WINDOW_MS
  )
}

/** Records the guest's feedback. `next` is the working copy inside `execute`. */
export function recordFeedback(
  next: BusinessState,
  command: { appointmentId: string } & z.infer<typeof feedbackInputSchema>,
  now: string,
  makeId: () => string,
) {
  const a = next.appointments.find((item) => item.id === command.appointmentId)
  if (!a) throw new Error('This visit is not in the studio record.')
  const existing = feedbackForVisit(next, a.id)
  if (existing) {
    // A repeated send of the same answer lands once; a different one cannot replace it.
    if (
      existing.visitRating === command.visitRating &&
      existing.practitionerRating === command.practitionerRating &&
      existing.comment === command.comment.trim()
    )
      return existing.id
    throw new Error('Thank you, your feedback for this visit is already with the studio.')
  }
  if (a.status !== 'completed') throw new Error('Feedback opens once the visit is complete.')
  next.feedback ??= []
  const row: Feedback = {
    id: makeId(),
    organisationId: next.organisation.id,
    appointmentId: a.id,
    clientId: a.clientId,
    staffId: a.staffId,
    visitRating: command.visitRating,
    practitionerRating: command.practitionerRating,
    comment: command.comment.trim(),
    createdAt: now,
  }
  next.feedback.push(row)
  return row.id
}

/** parseState check: one answer per completed visit, from that visit's client, about its professional. */
export function feedbackProblem(s: BusinessState) {
  const rows = feedbackList(s)
  if (new Set(rows.map((r) => r.id)).size !== rows.length) return 'Duplicate feedback IDs.'
  if (new Set(rows.map((r) => r.appointmentId)).size !== rows.length)
    return 'A visit has more than one feedback answer.'
  for (const row of rows) {
    const a = s.appointments.find((item) => item.id === row.appointmentId)
    if (
      row.organisationId !== s.organisation.id ||
      !a ||
      a.status !== 'completed' ||
      a.clientId !== row.clientId ||
      a.staffId !== row.staffId
    )
      return 'Feedback does not match its visit.'
  }
  return null
}

const average = (values: number[]) =>
  values.length ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10 : null

/** Averages for the owner's feedback page: the studio, then each professional. */
export function feedbackSummary(s: BusinessState, since?: string) {
  const rows = feedbackList(s).filter((r) => !since || r.createdAt >= since)
  return {
    count: rows.length,
    visitAverage: average(rows.map((r) => r.visitRating)),
    practitionerAverage: average(rows.map((r) => r.practitionerRating)),
    byStaff: s.staff
      .map((person) => {
        const mine = rows.filter((r) => r.staffId === person.id)
        return {
          staff: person,
          count: mine.length,
          average: average(mine.map((r) => r.practitionerRating)),
        }
      })
      .filter((row) => row.count > 0 || !row.staff.archived),
  }
}

/**
 * A practitioner's own average and count, or a null average until enough different guests have
 * rated, so one regular's answers can never be read back from the average.
 */
export function ownRating(s: BusinessState, staffId: string) {
  const mine = feedbackList(s).filter((r) => r.staffId === staffId)
  return {
    count: mine.length,
    average:
      new Set(mine.map((r) => r.clientId)).size >= PRACTITIONER_AVERAGE_MIN
        ? average(mine.map((r) => r.practitionerRating))
        : null,
  }
}

/** Reception and practitioners never receive individual answers. */
export function withoutFeedback(s: BusinessState): BusinessState {
  const { feedback: _hidden, ...rest } = s
  void _hidden
  return rest
}
