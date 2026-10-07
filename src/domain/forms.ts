import type { z } from 'zod'
import type { Appointment, BusinessState, RelationshipEvent } from './model'
import { formContentSchema, FORM_LIMIT, FORM_RESPONSE_LIMIT } from './formsSchema'
import { instantFor } from './operations'
import type {
  FormAnswers,
  FormContent,
  FormResponse,
  GuestForm,
  formSettingsSchema,
} from './formsSchema'

/**
 * V1.5: ordinary guest forms. The studio sets up a form for some or all services; a guest fills it
 * in from their private link before the visit; the desk reads the answers on the visit. Changing a
 * form makes a new version and never rewrites an answer already given. Nothing here is clinical.
 */

type AddEvent = (
  event: Omit<RelationshipEvent, 'id' | 'organisationId' | 'occurredAt' | 'actor'>,
) => void

export const formsList = (s: BusinessState) => s.forms ?? []
export const formResponses = (s: BusinessState) => s.formResponses ?? []
export const latest = (form: GuestForm) => form.versions[form.versions.length - 1]
export const versionOf = (form: GuestForm, version: number) =>
  form.versions.find((v) => v.version === version)

/**
 * Words that mean a form is asking about health. These questions need the separate clinical part
 * of SALEANE, which is not built, so an ordinary form refuses them.
 */
const HEALTH =
  /\b(medical|medication|medicines?|allerg\w*|pregnan\w*|health|illness\w*|disease\w*|diagnos\w*|surgery|surgeries|prescri\w*|epilep\w*|diabet\w*|blood pressure|heart conditions?|skin conditions?|medical conditions?)\b/i

/** The first health word in a form, or null when it reads as an ordinary form. */
export function healthWord(content: FormContent) {
  const text = [
    content.title,
    content.intro,
    content.agreement,
    ...content.questions.flatMap((q) => [q.label, ...(q.options ?? [])]),
  ].join('\n')
  return HEALTH.exec(text)?.[0] ?? null
}

const sameContent = (a: FormContent, b: FormContent) => JSON.stringify(a) === JSON.stringify(b)

/** Whether a form is asked for this visit's treatment. */
const coversService = (form: GuestForm, serviceId: string) =>
  !form.serviceIds.length || form.serviceIds.includes(serviceId)

/** A guest's answer to this form that counts for this visit: this visit's, or any for a `once` form. */
export function answerFor(s: BusinessState, form: GuestForm, a: Appointment) {
  const rows = formResponses(s).filter((r) => r.formId === form.id)
  return (
    rows.find((r) => r.appointmentId === a.id) ??
    (form.when === 'once' ? rows.find((r) => r.clientId === a.clientId) : undefined)
  )
}

/** The forms a visit asks for, each with the answer that covers it, if any. */
export function visitForms(s: BusinessState, a: Appointment) {
  return formsList(s)
    .filter((form) => !form.archived && coversService(form, a.serviceId))
    .map((form) => ({ form, current: latest(form), answer: answerFor(s, form, a) }))
}

/** Forms this visit still waits for. Only upcoming visits wait. */
export function formsWaiting(s: BusinessState, a: Appointment) {
  if (a.status !== 'confirmed' && a.status !== 'arrived') return []
  return visitForms(s, a).filter((item) => !item.answer)
}

/** Every answer given for this visit, including to forms archived since, for the desk. */
export function visitAnswers(s: BusinessState, appointmentId: string) {
  return formResponses(s)
    .filter((r) => r.appointmentId === appointmentId)
    .map((response) => {
      const form = formsList(s).find((f) => f.id === response.formId)!
      return { response, form, content: versionOf(form, response.version)!.content }
    })
}

/** Reads one answer for showing: yes and no in words, empty as a dash. */
export function answerText(value: string, kind: string) {
  if (!value) return '–'
  if (kind === 'yes_no') return value === 'yes' ? 'Yes' : 'No'
  return value
}

export type FormCommand =
  | {
      type: 'form-save'
      id?: string
      content: FormContent
      settings: z.infer<typeof formSettingsSchema>
    }
  | { type: 'form-archive'; formId: string; archived: boolean }
  | ({ type: 'form-submit'; appointmentId: string } & FormAnswers)

/** The stored answer when a guest sends exactly the same form again, so a retry changes nothing. */
export function repeatedFormAnswer(
  s: BusinessState,
  command: { appointmentId: string } & FormAnswers,
) {
  const existing = formResponses(s).find(
    (r) => r.formId === command.formId && r.appointmentId === command.appointmentId,
  )
  return existing &&
    existing.version === command.version &&
    existing.agreedName === command.agreedName.trim() &&
    JSON.stringify(existing.answers) === JSON.stringify(cleanAnswers(command.answers))
    ? existing
    : undefined
}

const cleanAnswers = (answers: FormAnswers['answers']) =>
  answers.map((a) => ({ questionId: a.questionId, value: a.value.trim() }))

export function runFormCommand(
  next: BusinessState,
  command: FormCommand,
  now: string,
  makeId: () => string,
  addEvent: AddEvent,
) {
  if (command.type === 'form-save') {
    const content = formContentSchema.parse(command.content)
    const word = healthWord(content)
    if (word)
      throw new Error(
        `Forms here are for everyday questions, so they cannot ask about health (“${word}”). Patch tests have their own record; health questions wait for the separate clinical part of SALEANE.`,
      )
    for (const serviceId of command.settings.serviceIds)
      if (!next.services.some((x) => x.id === serviceId))
        throw new Error('Choose services from this studio.')
    const forms = (next.forms ??= [])
    if (!command.id) {
      if (forms.filter((f) => !f.archived).length >= FORM_LIMIT)
        throw new Error(`A studio can have up to ${FORM_LIMIT} forms in use.`)
      const form: GuestForm = {
        id: makeId(),
        organisationId: next.organisation.id,
        ...command.settings,
        versions: [{ version: 1, content, publishedAt: now, publishedBy: '' }],
      }
      forms.push(form)
      return form.id
    }
    const form = forms.find((f) => f.id === command.id)
    if (!form) throw new Error('That form is not in this studio.')
    Object.assign(form, command.settings)
    const current = latest(form)
    // Only a change to what guests read makes a new version; answers keep the one they saw.
    if (!sameContent(current.content, content))
      form.versions.push({
        version: current.version + 1,
        content,
        publishedAt: now,
        publishedBy: '',
      })
    return form.id
  }
  if (command.type === 'form-archive') {
    const form = formsList(next).find((f) => f.id === command.formId)
    if (!form) throw new Error('That form is not in this studio.')
    if (command.archived) form.archived = true
    else if (form.archived) {
      if (formsList(next).filter((f) => !f.archived).length >= FORM_LIMIT)
        throw new Error(`A studio can have up to ${FORM_LIMIT} forms in use.`)
      delete form.archived
    }
    return form.id
  }
  const a = next.appointments.find((x) => x.id === command.appointmentId)
  if (!a) throw new Error('This visit is not in the studio record.')
  if (
    (a.status !== 'confirmed' && a.status !== 'arrived') ||
    Date.parse(instantFor(next, a.date, a.startMinutes)) <= Date.parse(now)
  )
    throw new Error('Forms can be filled in before the visit only.')
  const form = formsList(next).find((f) => f.id === command.formId)
  if (!form || form.archived || !coversService(form, a.serviceId))
    throw new Error('This visit does not need that form.')
  if (answerFor(next, form, a)) throw new Error('Thank you, this form is already with the studio.')
  const current = latest(form)
  if (current.version !== command.version)
    throw new Error(
      'The studio changed this form while you were filling it in. Please check it again.',
    )
  const answers = cleanAnswers(command.answers)
  if (new Set(answers.map((x) => x.questionId)).size !== answers.length)
    throw new Error('Each question is answered once.')
  for (const answer of answers)
    if (!current.content.questions.some((q) => q.id === answer.questionId))
      throw new Error('Please check the form again.')
  for (const q of current.content.questions) {
    const value = answers.find((x) => x.questionId === q.id)?.value ?? ''
    if (q.required && !value) throw new Error(`Please answer “${q.label}”.`)
    if (value && q.kind === 'yes_no' && value !== 'yes' && value !== 'no')
      throw new Error(`Please answer “${q.label}” with yes or no.`)
    if (value && q.kind === 'choice' && !q.options!.includes(value))
      throw new Error(`Please choose one of the answers to “${q.label}”.`)
    if (q.kind === 'short' && value.length > 200) throw new Error(`Please keep “${q.label}” short.`)
  }
  const agreedName = command.agreedName.trim()
  if (current.content.agreement && agreedName.length < 2)
    throw new Error('Type your name to agree.')
  if (!current.content.agreement && agreedName) throw new Error('Please check the form again.')
  const responses = (next.formResponses ??= [])
  if (responses.length >= FORM_RESPONSE_LIMIT)
    throw new Error('The studio cannot take more forms. Please contact them.')
  const row: FormResponse = {
    id: makeId(),
    organisationId: next.organisation.id,
    appointmentId: a.id,
    clientId: a.clientId,
    formId: form.id,
    version: current.version,
    answers: answers.filter((x) => x.value),
    agreedName,
    submittedAt: now,
  }
  responses.push(row)
  addEvent({
    clientId: a.clientId,
    appointmentId: a.id,
    type: 'form',
    title: 'Form filled in',
    detail: `${current.content.title}, version ${current.version}${agreedName ? `, agreed as ${agreedName}` : ''}.`,
  })
  return row.id
}

/** Fills in who published each new version. */
export function stampFormActors(before: BusinessState, after: BusinessState, actor: string) {
  const seen = new Map(formsList(before).map((f) => [f.id, f.versions.length]))
  for (const form of formsList(after))
    for (const v of form.versions.slice(seen.get(form.id) ?? 0)) v.publishedBy = actor
}

/** parseState checks: versions in order, answers that match their visit and form version. */
export function formsProblem(s: BusinessState) {
  const forms = formsList(s)
  if (new Set(forms.map((f) => f.id)).size !== forms.length) return 'Duplicate form IDs.'
  for (const form of forms) {
    if (form.organisationId !== s.organisation.id) return 'Foreign workspace record.'
    if (form.versions.some((v, i) => v.version !== i + 1)) return 'Form versions out of order.'
  }
  const rows = formResponses(s)
  if (rows.length > FORM_RESPONSE_LIMIT) return 'Too many form answers.'
  if (new Set(rows.map((r) => r.id)).size !== rows.length) return 'Duplicate form answer IDs.'
  if (new Set(rows.map((r) => `${r.formId} ${r.appointmentId}`)).size !== rows.length)
    return 'A visit has a form answered twice.'
  // Indexed once: this runs after every change, and both lists can be long.
  const formById = new Map(forms.map((f) => [f.id, f]))
  const visitById = new Map(s.appointments.map((a) => [a.id, a]))
  for (const row of rows) {
    const form = formById.get(row.formId)
    const a = visitById.get(row.appointmentId)
    if (row.organisationId !== s.organisation.id) return 'Foreign workspace record.'
    if (!form || !versionOf(form, row.version) || !a || a.clientId !== row.clientId)
      return 'A form answer does not match its visit.'
  }
  return null
}
