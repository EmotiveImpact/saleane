import { useState } from 'react'
import { api } from '../state/api'
import { guestViewSchema } from '../domain/guest'
import type { GuestView } from '../domain/guest'
import { Button, ErrorMessage } from '../design'

/**
 * V1.5: a guest who gets the studio's email news can stop it from their private visit link. Visit
 * updates are a separate purpose and carry on.
 */
export function GuestEmailNews({
  token,
  view,
  onChange,
}: {
  token: string
  view: GuestView
  onChange: (view: GuestView) => void
}) {
  const [stopped, setStopped] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  if (!view.emailNews && !stopped) return null
  async function stop() {
    setSaving(true)
    setError('')
    try {
      const next = guestViewSchema.parse(
        await api<GuestView>('/api/guest/email-news', { method: 'POST', body: { token } }),
      )
      setStopped(true)
      onChange(next)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not go through. Try again.')
    } finally {
      setSaving(false)
    }
  }
  return (
    <section className="guest-news" aria-labelledby="email-news-heading">
      <h2 id="email-news-heading">Email news</h2>
      {stopped && !view.emailNews ? (
        <p role="status">
          Done. {view.organisation.name} will not send you email news. You will still hear about
          your visits.
        </p>
      ) : (
        <>
          <p className="subtle">
            You agreed to occasional email news from {view.organisation.name}. You can stop it here.
            You will still hear about your visits.
          </p>
          <ErrorMessage error={error} />
          <Button variant="secondary" disabled={saving} onClick={() => void stop()}>
            {saving ? 'Stopping…' : 'Stop email news'}
          </Button>
        </>
      )}
    </section>
  )
}
