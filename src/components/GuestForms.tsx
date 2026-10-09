import { useState } from 'react'
import type { FormEvent } from 'react'
import { ClipboardList, Plus, Trash2 } from 'lucide-react'
import { useStore } from '../state/context'
import { can } from '../domain/operations'
import {
  answerText,
  formsList,
  healthWord,
  latest,
  visitAnswers,
  visitForms,
} from '../domain/forms'
import { QUESTION_LIMIT, questionKinds } from '../domain/formsSchema'
import type { FormContent, GuestForm, Question } from '../domain/formsSchema'
import type { Appointment } from '../domain/model'
import { dateLabel } from '../domain/format'
import { businessDate } from '../domain/operations'
import { Button, ErrorMessage, Modal } from '../design'
import { useRun } from './usePayment'
import './guestForms.css'

/**
 * V1.5: ordinary guest forms. Settings lists them and edits them; the visit window shows what a
 * guest has sent. Health questions are refused by the rules, and the editor says so before saving.
 */

const kindLabel: Record<Question['kind'], string> = {
  short: 'Short answer',
  long: 'Longer answer',
  yes_no: 'Yes or no',
  choice: 'Pick one',
}

let questionSequence = 0
const newQuestion = (): Question => ({
  id: `q-${Date.now().toString(36)}-${++questionSequence}`,
  kind: 'short',
  label: '',
  required: false,
})

export function FormSettings() {
  const { state, role, blocked } = useStore()
  const [editing, setEditing] = useState<GuestForm | 'new' | null>(null)
  const [notice, setNotice] = useState('')
  const { run, pending, error } = useRun()
  const allowed = !blocked && can(role, 'forms')
  const forms = formsList(state)
  const serviceNames = (form: GuestForm) =>
    form.serviceIds.length
      ? form.serviceIds
          .map((id) => state.services.find((s) => s.id === id)?.name)
          .filter(Boolean)
          .join(', ')
      : 'Every treatment'
  async function archive(form: GuestForm) {
    setNotice('')
    const archived = !form.archived
    if (await run({ type: 'form-archive', formId: form.id, archived }))
      setNotice(
        archived
          ? `${latest(form).content.title} is no longer asked for. Answers already given stay.`
          : `${latest(form).content.title} is asked for again.`,
      )
  }
  return (
    <section className="surface ops-panel" aria-labelledby="guest-forms-title">
      <header>
        <div>
          <h2 id="guest-forms-title">Guest forms</h2>
          <p>
            Short forms guests fill in from their private link before a visit, such as what they
            would like or agreeing to your terms. Everyday questions only: nothing about health.
          </p>
        </div>
        <Button disabled={!allowed} onClick={() => setEditing('new')}>
          <Plus size={16} />
          Add form
        </Button>
      </header>
      {forms.length ? (
        <div className="ops-ledger">
          {forms.map((form) => {
            const current = latest(form)
            const answers = (state.formResponses ?? []).filter((r) => r.formId === form.id).length
            return (
              <div className="ops-record" key={form.id}>
                <ClipboardList size={24} aria-hidden="true" />
                <div className="ops-record-copy">
                  <strong>{current.content.title}</strong>
                  <small>
                    {serviceNames(form)} ·{' '}
                    {form.when === 'once' ? 'Asked once per guest' : 'Asked before every visit'} ·{' '}
                    {current.content.questions.length}{' '}
                    {current.content.questions.length === 1 ? 'question' : 'questions'}
                  </small>
                  <small>
                    Version {current.version} · {answers} {answers === 1 ? 'answer' : 'answers'} so
                    far
                  </small>
                </div>
                <div className="ops-record-controls">
                  {form.archived && <span className="ops-tag">Not asked</span>}
                  <Button
                    variant="quiet"
                    disabled={!allowed || pending}
                    onClick={() => void archive(form)}
                  >
                    {form.archived ? 'Ask again' : 'Stop asking'}
                    <span className="sr-only"> {current.content.title}</span>
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={!allowed}
                    onClick={() => setEditing(form)}
                    aria-label={`Edit ${current.content.title}`}
                  >
                    Edit
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <p className="subtle">No forms yet. Guests are not asked to fill anything in.</p>
      )}
      <ErrorMessage error={error} />
      {notice && (
        <p className="ops-save-note" role="status">
          {notice}
        </p>
      )}
      {editing && (
        <FormEditor
          form={editing === 'new' ? null : editing}
          onClose={(message) => {
            setEditing(null)
            if (message) setNotice(message)
          }}
        />
      )}
    </section>
  )
}

function FormEditor({
  form,
  onClose,
}: {
  form: GuestForm | null
  onClose: (message?: string) => void
}) {
  const { state } = useStore()
  const start = form ? latest(form).content : null
  const [title, setTitle] = useState(start?.title ?? '')
  const [intro, setIntro] = useState(start?.intro ?? '')
  const [agreement, setAgreement] = useState(start?.agreement ?? '')
  const [questions, setQuestions] = useState<Question[]>(
    start?.questions.map((q) => ({ ...q })) ?? [newQuestion()],
  )
  // Options are typed one per line and only become a list when saved.
  const [optionText, setOptionText] = useState<Record<string, string>>(() =>
    Object.fromEntries((start?.questions ?? []).map((q) => [q.id, (q.options ?? []).join('\n')])),
  )
  const [when, setWhen] = useState<GuestForm['when']>(form?.when ?? 'every_visit')
  const [serviceIds, setServiceIds] = useState<string[]>(form?.serviceIds ?? [])
  const { run, pending, error } = useRun()
  const services = state.services.filter((s) => !s.archived || serviceIds.includes(s.id))
  const content: FormContent = {
    title: title.trim(),
    intro: intro.trim(),
    agreement: agreement.trim(),
    questions: questions.map((q) => ({
      id: q.id,
      kind: q.kind,
      label: q.label.trim(),
      required: q.required,
      ...(q.kind === 'choice'
        ? {
            options: (optionText[q.id] ?? '')
              .split('\n')
              .map((line) => line.trim())
              .filter(Boolean),
          }
        : {}),
    })),
  }
  const health = healthWord(content)
  const update = (id: string, patch: Partial<Question>) =>
    setQuestions((rows) => rows.map((q) => (q.id === id ? { ...q, ...patch } : q)))
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const done = await run({
      type: 'form-save',
      ...(form ? { id: form.id } : {}),
      content,
      settings: { serviceIds, when },
    })
    if (done)
      onClose(
        form
          ? `${content.title} saved. Guests who already answered keep the version they saw.`
          : `${content.title} added. Guests are asked for it from their visit link.`,
      )
  }
  return (
    <Modal
      open
      wide
      onClose={() => {
        if (!pending) onClose()
      }}
      title={form ? 'Edit form' : 'Add a guest form'}
      description="Changes make a new version. Answers already given keep the questions they were asked."
    >
      <form className="form-editor" onSubmit={(e) => void save(e)} aria-busy={pending}>
        <div className="form-grid">
          <label className="form-grid-wide">
            Title
            <input
              value={title}
              required
              minLength={2}
              maxLength={100}
              placeholder="Before your visit"
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label className="form-grid-wide">
            A line for guests (optional)
            <textarea
              value={intro}
              maxLength={600}
              rows={2}
              onChange={(e) => setIntro(e.target.value)}
            />
          </label>
        </div>
        <fieldset className="form-questions">
          <legend>Questions</legend>
          <ol>
            {questions.map((q, index) => (
              <li key={q.id}>
                <div className="form-grid">
                  <label className="form-grid-wide">
                    Question {index + 1}
                    <input
                      value={q.label}
                      required
                      minLength={2}
                      maxLength={200}
                      onChange={(e) => update(q.id, { label: e.target.value })}
                    />
                  </label>
                  <label>
                    Answer
                    <select
                      value={q.kind}
                      onChange={(e) => update(q.id, { kind: e.target.value as Question['kind'] })}
                    >
                      {questionKinds.map((kind) => (
                        <option key={kind} value={kind}>
                          {kindLabel[kind]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="ops-check">
                    <input
                      type="checkbox"
                      checked={q.required}
                      onChange={(e) => update(q.id, { required: e.target.checked })}
                    />
                    Must be answered
                  </label>
                  {q.kind === 'choice' && (
                    <label className="form-grid-wide">
                      Answers to pick from, one per line
                      <textarea
                        rows={3}
                        value={optionText[q.id] ?? ''}
                        onChange={(e) =>
                          setOptionText((all) => ({ ...all, [q.id]: e.target.value }))
                        }
                      />
                    </label>
                  )}
                </div>
                {questions.length > 1 && (
                  <Button
                    variant="quiet"
                    onClick={() => setQuestions((rows) => rows.filter((row) => row.id !== q.id))}
                  >
                    <Trash2 size={15} aria-hidden="true" />
                    Remove question {index + 1}
                  </Button>
                )}
              </li>
            ))}
          </ol>
          {questions.length < QUESTION_LIMIT && (
            <Button
              variant="secondary"
              onClick={() => setQuestions((rows) => [...rows, newQuestion()])}
            >
              <Plus size={15} />
              Add a question
            </Button>
          )}
        </fieldset>
        <div className="form-grid">
          <label className="form-grid-wide">
            Something to agree to (optional)
            <textarea
              value={agreement}
              maxLength={600}
              rows={2}
              placeholder="For example: I have read the studio’s cancellation policy."
              onChange={(e) => setAgreement(e.target.value)}
            />
            <small>Guests agree by typing their name.</small>
          </label>
          <label>
            Ask
            <select value={when} onChange={(e) => setWhen(e.target.value as GuestForm['when'])}>
              <option value="every_visit">Before every visit</option>
              <option value="once">Once per guest</option>
            </select>
          </label>
        </div>
        <fieldset className="form-services">
          <legend>For these treatments</legend>
          <p className="subtle">Leave them all unticked to ask for every treatment.</p>
          <div>
            {services.map((s) => (
              <label className="ops-check" key={s.id}>
                <input
                  type="checkbox"
                  checked={serviceIds.includes(s.id)}
                  onChange={(e) =>
                    setServiceIds((ids) =>
                      e.target.checked ? [...ids, s.id] : ids.filter((id) => id !== s.id),
                    )
                  }
                />
                {s.name}
              </label>
            ))}
          </div>
        </fieldset>
        {health && (
          <p className="form-health" role="alert">
            This form mentions “{health}”. Forms here are for everyday questions, so they cannot ask
            about health. Patch tests have their own record.
          </p>
        )}
        <ErrorMessage error={error} />
        <div className="dialog-footer">
          <Button variant="secondary" disabled={pending} onClick={() => onClose()}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending || !!health}>
            {pending ? 'Saving…' : 'Save form'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

/** On the visit window: which forms are in, with the answers, and which are still waiting. */
export function VisitForms({ appointment }: { appointment: Appointment }) {
  const { state } = useStore()
  const given = visitAnswers(state, appointment.id)
  const asked = visitForms(state, appointment)
  // A `once` form answered on an earlier visit covers this one too.
  const earlier = asked.filter(
    (item) => item.answer && item.answer.appointmentId !== appointment.id,
  )
  const waiting =
    appointment.status === 'confirmed' || appointment.status === 'arrived'
      ? asked.filter((item) => !item.answer)
      : []
  if (!given.length && !earlier.length && !waiting.length) return null
  const org = state.organisation
  const day = (iso: string) => dateLabel(businessDate(state, iso), org.locale, true)
  return (
    <section className="visit-forms" aria-label="Guest forms">
      <h3>Forms</h3>
      {waiting.map((item) => (
        <p key={item.form.id} className="subtle">
          {item.current.content.title}: waiting for the guest. They can fill it in from their visit
          link.
        </p>
      ))}
      {earlier.map((item) => (
        <p key={item.form.id} className="subtle">
          {item.current.content.title}: filled in before an earlier visit, on{' '}
          {day(item.answer!.submittedAt)}.
        </p>
      ))}
      {given.map(({ response, content }) => (
        <details key={response.id}>
          <summary>
            {content.title}: filled in {day(response.submittedAt)}
            {response.version > 1 ? `, version ${response.version}` : ''}
          </summary>
          <dl>
            {content.questions.map((q) => (
              <div key={q.id}>
                <dt>{q.label}</dt>
                <dd>
                  {answerText(
                    response.answers.find((a) => a.questionId === q.id)?.value ?? '',
                    q.kind,
                  )}
                </dd>
              </div>
            ))}
            {content.agreement && (
              <div>
                <dt>{content.agreement}</dt>
                <dd>Agreed as {response.agreedName}</dd>
              </div>
            )}
          </dl>
        </details>
      ))}
    </section>
  )
}
