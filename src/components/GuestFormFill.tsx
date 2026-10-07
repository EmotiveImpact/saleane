import { useState } from 'react'
import type { FormEvent } from 'react'
import { api } from '../state/api'
import { guestViewSchema } from '../domain/guest'
import type { GuestView } from '../domain/guest'
import { ANSWER_LIMIT } from '../domain/formsSchema'
import { Button, ErrorMessage } from '../design'

type GuestFormItem = NonNullable<GuestView['forms']>[number]

/** V1.5: the studio's forms on the guest's private page, one at a time, before the visit. */
export function GuestForms({
  token,
  view,
  onChange,
}: {
  token: string
  view: GuestView
  onChange: (view: GuestView) => void
}) {
  if (!view.forms?.length) return null
  return (
    <>
      {view.forms.map((item) => (
        <GuestFormCard
          key={item.formId}
          token={token}
          item={item}
          studio={view.organisation.name}
          onChange={onChange}
        />
      ))}
    </>
  )
}

function GuestFormCard({
  token,
  item,
  studio,
  onChange,
}: {
  token: string
  item: GuestFormItem
  studio: string
  onChange: (view: GuestView) => void
}) {
  const { content } = item
  const [values, setValues] = useState<Record<string, string>>({})
  const [agreedName, setAgreedName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const heading = `form-${item.formId}`
  const set = (id: string, value: string) => {
    setValues((all) => ({ ...all, [id]: value }))
    setError('')
  }
  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const missing = content.questions.find((q) => q.required && !values[q.id]?.trim())
    if (missing) {
      setError(`Please answer “${missing.label}”.`)
      return
    }
    if (content.agreement && agreedName.trim().length < 2) {
      setError('Type your name to agree.')
      return
    }
    setSaving(true)
    setError('')
    try {
      onChange(
        guestViewSchema.parse(
          await api<GuestView>('/api/guest/form', {
            method: 'POST',
            body: {
              token,
              formId: item.formId,
              version: item.version,
              answers: content.questions
                .map((q) => ({ questionId: q.id, value: (values[q.id] ?? '').trim() }))
                .filter((a) => a.value),
              agreedName: content.agreement ? agreedName.trim() : '',
            },
          }),
        ),
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The form could not be sent. Try again.')
    } finally {
      setSaving(false)
    }
  }
  if (item.done)
    return (
      <section className="guest-form" aria-labelledby={heading}>
        <h2 id={heading}>{content.title}</h2>
        <p role="status">Thank you, {studio} has this form.</p>
      </section>
    )
  return (
    <section className="guest-form" aria-labelledby={heading}>
      <h2 id={heading}>{content.title}</h2>
      {content.intro && <p className="subtle">{content.intro}</p>}
      <form onSubmit={send}>
        {content.questions.map((q) => {
          const label = `${q.label}${q.required ? '' : ' (optional)'}`
          if (q.kind === 'yes_no' || q.kind === 'choice')
            return (
              <fieldset key={q.id} className="guest-form-choice">
                <legend>{label}</legend>
                <div>
                  {(q.kind === 'yes_no' ? ['yes', 'no'] : q.options!).map((option) => (
                    <label key={option}>
                      <input
                        type="radio"
                        name={`${item.formId}-${q.id}`}
                        value={option}
                        checked={values[q.id] === option}
                        onChange={() => set(q.id, option)}
                      />
                      {q.kind === 'yes_no' ? (option === 'yes' ? 'Yes' : 'No') : option}
                    </label>
                  ))}
                </div>
              </fieldset>
            )
          return (
            <label key={q.id} className="guest-comment">
              {label}
              {q.kind === 'long' ? (
                <textarea
                  rows={3}
                  maxLength={ANSWER_LIMIT}
                  value={values[q.id] ?? ''}
                  onChange={(e) => set(q.id, e.target.value)}
                />
              ) : (
                <input
                  maxLength={200}
                  value={values[q.id] ?? ''}
                  onChange={(e) => set(q.id, e.target.value)}
                />
              )}
            </label>
          )
        })}
        {content.agreement && (
          <div className="guest-form-agree">
            <p>{content.agreement}</p>
            <label className="guest-comment">
              Type your name to agree
              <input
                autoComplete="name"
                maxLength={100}
                value={agreedName}
                onChange={(e) => setAgreedName(e.target.value)}
              />
            </label>
          </div>
        )}
        <ErrorMessage error={error} />
        <Button type="submit" disabled={saving}>
          {saving ? 'Sending…' : 'Send to the studio'}
        </Button>
      </form>
    </section>
  )
}
