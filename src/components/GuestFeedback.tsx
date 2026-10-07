import { useState } from 'react'
import type { FormEvent } from 'react'
import { Star } from 'lucide-react'
import { api } from '../state/api'
import { guestViewSchema } from '../domain/guest'
import type { GuestView } from '../domain/guest'
import { FEEDBACK_COMMENT_LIMIT } from '../domain/feedback'
import { Button, ErrorMessage } from '../design'

const WORDS = ['', 'Poor', 'Fair', 'Good', 'Very good', 'Wonderful'] as const

/** Five stars as a radio group: arrow keys move, and each choice reads as "4 out of 5, very good". */
function Stars({
  legend,
  value,
  onChange,
}: {
  legend: string
  value: number
  onChange: (value: number) => void
}) {
  return (
    <fieldset className="guest-stars">
      <legend>{legend}</legend>
      <div className="guest-stars-row">
        {[1, 2, 3, 4, 5].map((n) => (
          <label key={n} className={n <= value ? 'is-on' : ''}>
            <input
              type="radio"
              name={legend}
              value={n}
              checked={value === n}
              onChange={() => onChange(n)}
              aria-label={`${n} out of 5, ${WORDS[n].toLowerCase()}`}
            />
            <Star size={30} strokeWidth={1.4} aria-hidden="true" />
          </label>
        ))}
        <span className="guest-stars-word" aria-hidden="true">
          {WORDS[value]}
        </span>
      </div>
    </fieldset>
  )
}

/** V1.5: a guest's private feedback after a completed visit. */
export function GuestFeedback({
  token,
  view,
  onChange,
}: {
  token: string
  view: GuestView
  onChange: (view: GuestView) => void
}) {
  const [visitRating, setVisitRating] = useState(0)
  const [practitionerRating, setPractitionerRating] = useState(0)
  const [comment, setComment] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const feedback = view.feedback
  if (!feedback || (!feedback.open && !feedback.given)) return null
  const who = view.visit.professional
  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!visitRating || !practitionerRating) {
      setError(`Choose a rating for your visit and for ${who}.`)
      return
    }
    setSaving(true)
    setError('')
    try {
      onChange(
        guestViewSchema.parse(
          await api<GuestView>('/api/guest/feedback', {
            method: 'POST',
            body: { token, visitRating, practitionerRating, comment: comment.trim() },
          }),
        ),
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Your feedback could not be sent. Try again.')
    } finally {
      setSaving(false)
    }
  }
  if (feedback.given)
    return (
      <section className="guest-feedback" aria-labelledby="feedback-heading">
        <h2 id="feedback-heading">Thank you</h2>
        <p role="status">
          {view.organisation.name} has your feedback: {feedback.given.visitRating} out of 5 for your
          visit and {feedback.given.practitionerRating} out of 5 for {who}.
        </p>
      </section>
    )
  return (
    <section className="guest-feedback" aria-labelledby="feedback-heading">
      <h2 id="feedback-heading">How was your visit?</h2>
      <p className="subtle">
        Private to {view.organisation.name}: only the owner and managers read what you write, and
        nothing is published.
      </p>
      <form onSubmit={send}>
        <Stars legend="Your visit" value={visitRating} onChange={setVisitRating} />
        <Stars
          legend={`How ${who} looked after you`}
          value={practitionerRating}
          onChange={setPractitionerRating}
        />
        <label className="guest-comment">
          Anything you would like the studio to know (optional)
          <textarea
            rows={4}
            maxLength={FEEDBACK_COMMENT_LIMIT}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
        </label>
        <ErrorMessage error={error} />
        <Button type="submit" disabled={saving}>
          {saving ? 'Sending…' : 'Send to the studio'}
        </Button>
      </form>
    </section>
  )
}
