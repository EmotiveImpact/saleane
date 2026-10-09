import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ArrowLeft, ChevronRight, Info, Search, Sparkles } from 'lucide-react'
import { api } from '../state/api'
import { Button, ErrorMessage, Modal } from '../design'
import type { Role } from '../domain/operations'
import {
  HELP_GROUPS,
  SUPPORT_TOPICS,
  helpArticles,
  helpForScreen,
  searchHelp,
  supportStatusWords,
  supportTopicWords,
} from '../domain/help'
import type { HelpArticle, SupportAnswer, SupportTopic } from '../domain/help'
import './helpPanel.css'

const DELIVERY: Record<SupportAnswer['delivery'], string> = {
  email: 'It is emailed to the SALEANE team, who reply to',
  test: 'Email is in test mode on this server, so a request is saved here but not sent yet. Replies would go to',
  kept: 'No help address is set on this server yet, so a request is saved here but not sent. Replies would go to',
}
const SAID: Record<SupportAnswer['delivery'], string> = {
  email: 'Sent to the SALEANE team. They will reply by email.',
  test: 'Saved. Email is in test mode, so it has not been sent to anyone yet.',
  kept: 'Saved on this server. It has not been sent, as no help address is set yet.',
}

/**
 * NEXT-06: Help, from anywhere in SALEANE. Guides for the screen a person is on come first; the
 * rest can be searched or browsed. Anyone signed in can write to the SALEANE team, and the panel
 * says plainly whether that request was sent or only kept.
 */
export function HelpPanel({
  open,
  onClose,
  role,
  signedIn,
  workspaceId,
  onAsk,
  locale = 'en-GB',
}: {
  open: boolean
  onClose: () => void
  /** The studio's way of writing dates. */
  locale?: string
  /** Null for someone with no studio open, who sees the guides meant for everyone. */
  role: Role | null
  /** False in the browser demo, which cannot write to anyone. */
  signedIn: boolean
  workspaceId?: string | null
  /** Opens Ask SALEANE, where the person has it. */
  onAsk?: () => void
}) {
  const location = useLocation()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [reading, setReading] = useState<HelpArticle | null>(null)
  const here = useMemo(
    () => helpForScreen(location.pathname, location.search, role),
    [location.pathname, location.search, role],
  )
  const found = useMemo(() => searchHelp(query, role), [query, role])
  const all = useMemo(() => helpArticles(role), [role])
  const page = `${location.pathname}${location.search}`

  function close() {
    setReading(null)
    setQuery('')
    onClose()
  }
  function go(to: string) {
    close()
    navigate(to)
  }

  const list = (articles: readonly HelpArticle[], label: string) => (
    <ul className="help-list" aria-label={label}>
      {articles.map((article) => (
        <li key={article.id}>
          <button type="button" onClick={() => setReading(article)}>
            <span>
              <strong>{article.title}</strong>
              <small>{article.summary}</small>
            </span>
            <ChevronRight size={17} aria-hidden="true" />
          </button>
        </li>
      ))}
    </ul>
  )

  return (
    <Modal
      open={open}
      onClose={close}
      placement="side"
      title={reading ? reading.title : 'Help'}
      description={
        reading
          ? reading.group
          : 'Guides for this screen and the rest of SALEANE, and a way to write to the SALEANE team.'
      }
    >
      <div className="help-panel">
        {reading ? (
          <article className="help-article">
            <Button variant="quiet" className="help-back" onClick={() => setReading(null)}>
              <ArrowLeft size={16} aria-hidden="true" />
              All help
            </Button>
            <p className="help-summary">{reading.summary}</p>
            <ol className="help-steps">
              {reading.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            {reading.note && (
              <p className="help-note">
                <Info size={16} aria-hidden="true" />
                <span>{reading.note}</span>
              </p>
            )}
            {reading.to && reading.to !== page && (
              <Button onClick={() => go(reading.to!)}>Go there</Button>
            )}
          </article>
        ) : (
          <>
            <label className="help-search">
              <span>Search help</span>
              <span className="help-search-field">
                <Search size={17} aria-hidden="true" />
                <input
                  type="search"
                  value={query}
                  placeholder="Such as refund, move a visit or password"
                  onChange={(event) => setQuery(event.target.value)}
                />
              </span>
            </label>
            {query.trim() ? (
              found.length ? (
                list(found, 'Guides that match')
              ) : (
                <p className="help-none" role="status">
                  No guide matches that. Try other words, Ask SALEANE, or write to the SALEANE team
                  below.
                </p>
              )
            ) : (
              <>
                {here.length > 0 && (
                  <section className="help-group" aria-labelledby="help-here">
                    <h3 id="help-here">On this screen</h3>
                    {list(here, 'On this screen')}
                  </section>
                )}
                {HELP_GROUPS.map((group) => {
                  const inGroup = all.filter((a) => a.group === group && !here.includes(a))
                  if (!inGroup.length) return null
                  const id = `help-${group.toLowerCase().replace(/\W+/g, '-')}`
                  return (
                    <section className="help-group" key={group} aria-labelledby={id}>
                      <h3 id={id}>{group}</h3>
                      {list(inGroup, group)}
                    </section>
                  )
                })}
              </>
            )}
          </>
        )}
        {onAsk && (
          <div className="help-ask">
            <p>Ask SALEANE can answer questions about your studio, and how to do things here.</p>
            <Button
              variant="secondary"
              onClick={() => {
                close()
                onAsk()
              }}
            >
              <Sparkles size={16} aria-hidden="true" />
              Ask SALEANE
            </Button>
          </div>
        )}
        <WriteToUs
          open={open}
          signedIn={signedIn}
          workspaceId={workspaceId}
          page={page}
          locale={locale}
        />
      </div>
    </Modal>
  )
}

/** The form to write to the SALEANE team, and what happened to earlier requests. */
function WriteToUs({
  open,
  signedIn,
  workspaceId,
  page,
  locale,
}: {
  open: boolean
  signedIn: boolean
  workspaceId?: string | null
  page: string
  locale: string
}) {
  const [answer, setAnswer] = useState<SupportAnswer | null>(null)
  const [topic, setTopic] = useState<SupportTopic>('using')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [said, setSaid] = useState('')
  useEffect(() => {
    if (!open || !signedIn) return
    let active = true
    api<SupportAnswer>('/api/support')
      .then((next) => {
        if (active) setAnswer(next)
      })
      .catch(() => {
        // The form still works; earlier requests simply are not listed.
      })
    return () => {
      active = false
    }
  }, [open, signedIn])

  async function send(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    setSaid('')
    try {
      const next = await api<SupportAnswer>('/api/support', {
        method: 'POST',
        body: { topic, message, page, ...(workspaceId ? { workspaceId } : {}) },
      })
      setAnswer(next)
      setMessage('')
      const sent = next.requests.find((r) => r.id === next.id)
      setSaid(
        sent && sent.status !== 'unknown' && sent.status !== 'failed'
          ? SAID[next.delivery]
          : sent?.status === 'failed'
            ? 'Saved, but the email could not be sent. It is kept here.'
            : 'Saved. The email service has not said yet whether it was sent.',
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Your message could not be saved. Try again.')
    } finally {
      setBusy(false)
    }
  }

  if (!signedIn)
    return (
      <section className="help-write" aria-labelledby="help-write-title">
        <h3 id="help-write-title">Write to the SALEANE team</h3>
        <p className="help-small">
          The browser demo cannot send anything. Sign in to a studio of your own to write to the
          team.
        </p>
      </section>
    )
  return (
    <section className="help-write" aria-labelledby="help-write-title">
      <h3 id="help-write-title">Write to the SALEANE team</h3>
      {answer && (
        <p className="help-small">
          {DELIVERY[answer.delivery]} {answer.email}. The screen you are on is sent with it.
        </p>
      )}
      <form onSubmit={(event) => void send(event)} className="help-form">
        <label>
          About
          <select value={topic} onChange={(e) => setTopic(e.target.value as SupportTopic)}>
            {SUPPORT_TOPICS.map((value) => (
              <option key={value} value={value}>
                {supportTopicWords[value]}
              </option>
            ))}
          </select>
        </label>
        <label>
          What do you need?
          <textarea
            value={message}
            rows={4}
            maxLength={4000}
            required
            minLength={10}
            onChange={(e) => setMessage(e.target.value)}
          />
        </label>
        <small className="help-small">
          Please leave out clients’ health details and card numbers.
        </small>
        <ErrorMessage error={error} />
        {said && (
          <p className="ops-save-note settle" role="status">
            {said}
          </p>
        )}
        <Button type="submit" disabled={busy || message.trim().length < 10}>
          {busy ? 'Saving…' : 'Send to the SALEANE team'}
        </Button>
      </form>
      {answer && answer.requests.length > 0 && (
        <div className="help-requests">
          <h4>What you have written</h4>
          <ul>
            {answer.requests.map((request) => (
              <li key={request.id}>
                <strong>{supportTopicWords[request.topic]}</strong>
                <small>
                  {new Date(request.createdAt).toLocaleDateString(locale, {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  })}
                  {request.studio ? `, ${request.studio}` : ''}.{' '}
                  {supportStatusWords[request.status]}.
                </small>
                <span>{request.message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
