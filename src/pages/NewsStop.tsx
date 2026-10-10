import { useEffect, useState } from 'react'
import { api, ApiError } from '../state/api'
import { Button, ErrorMessage, photos } from '../design'
import { useGuestColours } from '../state/studioColours'
import type { StudioLook } from '../domain/brandRulesSchema'
import '../guest.css'
import './news.css'

/**
 * Stage 4: the page behind the link at the foot of a message to clients. It turns off the client's
 * news and offers, by email and by text, only when they press the button, so a mail program that
 * opens links by itself changes nothing. The token stays in the address fragment, which browsers
 * never send to a server.
 */
type Answer = { studio: string; look?: StudioLook; stopped: boolean }

const EXPIRED = 'This link has expired or been replaced. Ask the studio to stop your news.'
const wellFormed = (token: string) => /^[A-Za-z0-9_-]{32,100}$/.test(token)
function problem(e: unknown) {
  if (e instanceof ApiError && (e.status === 400 || e.status === 404)) return EXPIRED
  return e instanceof Error ? e.message : 'This link could not be opened. Try again.'
}

export function NewsStop() {
  const [token] = useState(() => window.location.hash.slice(1))
  const [answer, setAnswer] = useState<Answer | null>(null)
  const [done, setDone] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(() => (wellFormed(token) ? '' : EXPIRED))
  useGuestColours(answer?.look)
  useEffect(() => {
    if (!wellFormed(token)) return
    let active = true
    api<Answer>('/api/news/open', { method: 'POST', body: { token } })
      .then((next) => {
        if (active) setAnswer(next)
      })
      .catch((e: unknown) => {
        if (active) setError(problem(e))
      })
    return () => {
      active = false
    }
  }, [token])

  async function stop() {
    setSaving(true)
    setError('')
    try {
      setAnswer(await api<Answer>('/api/news/stop', { method: 'POST', body: { token } }))
      setDone(true)
    } catch (e) {
      setError(problem(e))
    } finally {
      setSaving(false)
    }
  }

  const studio = answer?.studio
  return (
    <main className="guest-page visit-page">
      <header className="visit-hero">
        <img className="visit-hero-image" src={photos.tea} alt="" />
        <div className="visit-hero-brand">
          <span>{studio ?? 'SALEANE'}</span>
        </div>
      </header>
      <section className="guest-card visit-card" aria-labelledby="news-stop-heading">
        {!answer ? (
          error ? (
            <>
              <h1 id="news-stop-heading">We couldn’t open this link.</h1>
              <ErrorMessage error={error} />
            </>
          ) : (
            <p role="status" id="news-stop-heading">
              Opening your link…
            </p>
          )
        ) : answer.stopped ? (
          <>
            <h1 id="news-stop-heading">{done ? 'Done.' : 'Your news is already off.'}</h1>
            <p className="guest-notice" role="status">
              {studio} will not send you news and offers. You will still hear about your visits.
            </p>
          </>
        ) : (
          <>
            <h1 id="news-stop-heading">Stop news from {studio}?</h1>
            <p className="subtle">
              You will no longer get news and offers from {studio}, by email or by text. Messages
              about your visits carry on.
            </p>
            <ErrorMessage error={error} />
            <Button className="news-stop-button" disabled={saving} onClick={() => void stop()}>
              {saving ? 'Stopping…' : 'Stop news and offers'}
            </Button>
          </>
        )}
      </section>
    </main>
  )
}
