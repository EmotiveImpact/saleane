import { z } from 'zod'

/**
 * V1.5: ordinary forms a guest fills in before a visit, such as how they found the studio, what
 * they would like from the visit, or agreeing to the studio's own terms. They are not clinical:
 * health, medical and allergy questions are refused (patch tests have their own record). Each
 * change to a form is a new version; an answer keeps the version it was given against.
 */
const id = z.string().min(1).max(150)
export const FORM_LIMIT = 30
export const QUESTION_LIMIT = 15
export const ANSWER_LIMIT = 1000
/** Every answer ever given stays, so this is years of visits for a busy studio. */
export const FORM_RESPONSE_LIMIT = 50000

export const questionKinds = ['short', 'long', 'yes_no', 'choice'] as const
export const questionSchema = z
  .object({
    id,
    kind: z.enum(questionKinds),
    label: z.string().trim().min(2).max(200),
    required: z.boolean(),
    /** For a choice: two to eight options, each said once. */
    options: z.array(z.string().trim().min(1).max(80)).max(8).optional(),
  })
  .strict()
  .refine(
    (q) =>
      q.kind === 'choice'
        ? !!q.options && q.options.length >= 2 && new Set(q.options).size === q.options.length
        : !q.options,
    'A choice needs two to eight different options.',
  )
export type Question = z.infer<typeof questionSchema>

/** What the studio writes. Saving a change makes a new version. */
export const formContentSchema = z
  .object({
    title: z.string().trim().min(2).max(100),
    intro: z.string().trim().max(600),
    questions: z.array(questionSchema).min(1).max(QUESTION_LIMIT),
    /** A statement the guest agrees to by typing their name, such as the studio's own terms. */
    agreement: z.string().trim().max(600),
  })
  .strict()
  .refine(
    (f) => new Set(f.questions.map((q) => q.id)).size === f.questions.length,
    'Each question appears once.',
  )
export type FormContent = z.infer<typeof formContentSchema>

/** `every_visit` asks before each visit; `once` asks a guest only the first time. */
export const formWhen = ['every_visit', 'once'] as const
export const formSettingsSchema = z
  .object({
    /** The services that need it. Empty means every service. */
    serviceIds: z.array(id).max(500),
    when: z.enum(formWhen),
  })
  .strict()

export const formVersionSchema = z
  .object({
    version: z.number().int().min(1),
    content: formContentSchema,
    publishedAt: z.iso.datetime(),
    publishedBy: z.string(),
  })
  .strict()
export const formSchema = z
  .object({
    id,
    organisationId: id,
    archived: z.boolean().optional(),
    versions: z.array(formVersionSchema).min(1).max(200),
  })
  .extend(formSettingsSchema.shape)
  .strict()
export type GuestForm = z.infer<typeof formSchema>

export const answerSchema = z
  .object({ questionId: id, value: z.string().trim().max(ANSWER_LIMIT) })
  .strict()
/** What the guest sends from their private link. */
export const formAnswersSchema = z
  .object({
    formId: id,
    /** The version the guest was shown, so a change while they were typing is caught. */
    version: z.number().int().min(1),
    answers: z.array(answerSchema).max(QUESTION_LIMIT),
    /** Their name, typed to agree to the form's statement. Empty when there is none. */
    agreedName: z.string().trim().max(100),
  })
  .strict()
export type FormAnswers = z.infer<typeof formAnswersSchema>

export const formResponseSchema = formAnswersSchema
  .extend({
    id,
    organisationId: id,
    appointmentId: id,
    clientId: id,
    submittedAt: z.iso.datetime(),
  })
  .strict()
export type FormResponse = z.infer<typeof formResponseSchema>
