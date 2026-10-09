import { useState } from 'react'
import type { FormEvent } from 'react'
import { api } from '../state/api'
import { guestViewSchema } from '../domain/guest'
import type { GuestView } from '../domain/guest'
import { WAITLIST_TIMES } from '../domain/waitlistSchema'
import type { WaitlistTime } from '../domain/waitlistSchema'
import { Button, ErrorMessage } from '../design'
import './guestWaitlist.css'

const NAMES: Record<WaitlistTime, string> = {
  morning: 'Mornings',
  afternoon: 'Afternoons',
  evening: 'Evenings',
}

/**
 * V1.5: a guest with an upcoming visit can ask to come in sooner. The studio sees the request on
 * its waitlist and gets in touch if a time opens; nothing is moved without the guest's yes.
 */
export function GuestWaitlist({
  token,
  view,
  onChange,
}: {
  token: string
  view: GuestView
  onChange: (view: GuestView) => void
}) {
  const joined = view.waitlist?.joined ?? null
  const [editing, setEditing] = useState(false)
  const [anyone, setAnyone] = useState(joined?.anyone ?? false)
  const [times, setTimes] = useState<WaitlistTime[]>(joined?.times ?? [])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  if (!view.waitlist) return null
  const who = view.visit.professional
  // Only the parts of the day the treatment can start in at this studio.
  const offered = view.waitlist.offered ?? WAITLIST_TIMES
  async function send(join: boolean) {
    setSaving(true)
    setError('')
    try {
      onChange(
        guestViewSchema.parse(
          await api<GuestView>('/api/guest/waitlist', {
            method: 'POST',
            body: { token, join, anyone, times },
          }),
        ),
      )
      setEditing(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That could not be saved. Try again.')
    } finally {
      setSaving(false)
    }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void send(true)
  }
  if (joined && !editing)
    return (
      <section className="guest-feedback guest-waitlist" aria-labelledby="sooner-heading">
        <h2 id="sooner-heading">You are on the waitlist</h2>
        <p role="status">
          If an earlier time opens with {joined.anyone ? 'anyone' : who}{' '}
          {joined.times.length && joined.times.length < offered.length
            ? joined.times.map((t) => `in the ${t}`).join(' or ')
            : 'at any time of day'}
          , {view.organisation.name} will be in touch. Your visit stays as it is until you say yes.
        </p>
        <ErrorMessage error={error} />
        <div className="guest-waitlist-actions">
          <Button variant="secondary" disabled={saving} onClick={() => setEditing(true)}>
            Change times
          </Button>
          <Button variant="quiet" disabled={saving} onClick={() => void send(false)}>
            {saving ? 'Saving…' : 'Leave the waitlist'}
          </Button>
        </div>
      </section>
    )
  return (
    <section className="guest-feedback guest-waitlist" aria-labelledby="sooner-heading">
      <h2 id="sooner-heading">Would you like to come in sooner?</h2>
      <p className="subtle">
        Tell {view.organisation.name} what suits you. If an earlier time opens, they will let you
        know. Your visit stays booked either way.
      </p>
      <form onSubmit={submit}>
        <label className="guest-waitlist-check">
          <input type="checkbox" checked={anyone} onChange={(e) => setAnyone(e.target.checked)} />
          Anyone is fine, not only {who}
        </label>
        <fieldset className="guest-waitlist-times">
          <legend>Times that suit you (leave empty for any time)</legend>
          {offered.map((time) => (
            <label key={time}>
              <input
                type="checkbox"
                checked={times.includes(time)}
                onChange={(e) =>
                  setTimes(
                    e.target.checked
                      ? offered.filter((t) => t === time || times.includes(t))
                      : times.filter((t) => t !== time),
                  )
                }
              />
              {NAMES[time]}
            </label>
          ))}
        </fieldset>
        <ErrorMessage error={error} />
        <div className="guest-waitlist-actions">
          <Button type="submit" disabled={saving}>
            {saving ? 'Saving…' : joined ? 'Save' : 'Tell me if something sooner comes up'}
          </Button>
          {joined && (
            <Button variant="secondary" disabled={saving} onClick={() => setEditing(false)}>
              Cancel
            </Button>
          )}
        </div>
      </form>
    </section>
  )
}
