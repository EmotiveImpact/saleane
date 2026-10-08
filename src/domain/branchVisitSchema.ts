import { z } from 'zod'

const id = z.string().min(1).max(150)
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date such as 2026-10-20.')

/**
 * V5: branch visit checklists. The owner or a manager keeps a few checklists, walks a location
 * with one on a phone, answers each line yes, no or not today, and the visit is kept as it was
 * answered. Lines answered no stay on a list to put right until someone marks them done.
 */
export const CHECKLIST_LIMIT = 20
export const CHECKLIST_ITEM_LIMIT = 40
/** Weekly visits to forty locations for ten years; nothing is cleared out automatically. */
export const BRANCH_VISIT_LIMIT = 41 * 52 * 10

export const checklistItemSchema = z
  .object({ id, text: z.string().trim().min(2).max(140) })
  .strict()
export const checklistInputSchema = z
  .object({
    name: z.string().trim().min(2).max(60),
    items: z
      .array(z.object({ id: id.optional(), text: z.string().trim().min(2).max(140) }).strict())
      .min(1)
      .max(CHECKLIST_ITEM_LIMIT),
  })
  .strict()
export const checklistSchema = z
  .object({
    id,
    name: z.string().trim().min(2).max(60),
    items: z.array(checklistItemSchema).min(1).max(CHECKLIST_ITEM_LIMIT),
    archived: z.boolean(),
  })
  .strict()
export type Checklist = z.infer<typeof checklistSchema>

export const answerValues = ['yes', 'no', 'na'] as const
export type Answer = (typeof answerValues)[number]

const note = z.string().trim().max(280)
export const branchVisitInputSchema = z
  .object({
    locationId: id,
    checklistId: id,
    date,
    answers: z
      .array(z.object({ itemId: id, answer: z.enum(answerValues), note: note.optional() }).strict())
      .min(1)
      .max(CHECKLIST_ITEM_LIMIT),
    note: z.string().trim().max(1000).optional(),
  })
  .strict()

/** One answered line, with the wording it had on the day, so later edits never rewrite history. */
export const visitAnswerSchema = z
  .object({
    itemId: id,
    text: z.string().min(1).max(140),
    answer: z.enum(answerValues),
    note: note.optional(),
    /** Set when a line answered no is put right. */
    fixed: z.object({ on: date, at: z.string(), actor: z.string().optional() }).strict().optional(),
  })
  .strict()
export const branchVisitSchema = z
  .object({
    id,
    locationId: id,
    checklistId: id,
    checklistName: z.string().min(1).max(60),
    date,
    answers: z.array(visitAnswerSchema).min(1).max(CHECKLIST_ITEM_LIMIT),
    note: z.string().max(1000).optional(),
    recordedAt: z.string(),
    actor: z.string().optional(),
  })
  .strict()
export type BranchVisit = z.infer<typeof branchVisitSchema>

export const branchVisitCommandSchemas = [
  z
    .object({ type: z.literal('checklist-save'), id: id.optional(), input: checklistInputSchema })
    .strict(),
  z
    .object({ type: z.literal('checklist-archive'), checklistId: id, archived: z.boolean() })
    .strict(),
  z.object({ type: z.literal('branch-visit'), input: branchVisitInputSchema }).strict(),
  z.object({ type: z.literal('branch-visit-fix'), visitId: id, itemId: id }).strict(),
] as const
