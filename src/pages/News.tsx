import { useEffect, useId, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Mail, MessageSquareText, Plus } from 'lucide-react'
import { useStore } from '../state/context'
import { api } from '../state/api'
import { Button, ErrorMessage, Modal, PageHeader, SegmentedControl, photos } from '../design'
import { can, operations } from '../domain/operations'
import { hasLocations, places } from '../domain/locations'
import { outboxStatusLabel, outboxStatuses } from '../domain/reminders'
import type { OutboxStatus } from '../domain/reminders'
import {
  NEWS_LOCATION_RULE,
  NEWS_BOOK_LINK,
  NEWS_STOP_LINK,
  clients,
  newsAudience,
  newsEmail,
  newsMessages,
  newsOnlyAt,
  newsReasonLabel,
  newsScopeLabel,
  newsSummary,
  newsText,
  newsWayLabel,
  textParts,
} from '../domain/news'
import type { NewsSummary } from '../domain/news'
import { NEWS_BODY_LIMIT, NEWS_SUBJECT_LIMIT } from '../domain/newsSchema'
import type { NewsMessage, NewsWay } from '../domain/newsSchema'
import '../components/management.css'
import './news.css'

/**
 * Stage 4: one message from the studio to its clients, for the whole group or chosen locations.
 * Leads draft it here; the owner checks the numbers and approves it, which queues one copy for each
 * client in the outbox. Nothing on this page lists who receives it: only how many, by each way and
 * location, and how many were left out and why.
 */

type Scope = { by: NewsWay; locationIds?: string[] }
type Follow = {
  mode: 'sandbox' | 'local'
  providers: { email: { live: boolean }; sms: { live: boolean } }
  messages: { id: string; outbox: Record<OutboxStatus, number> }[]
}

/** How many clients a message would reach now: from the server, which knows erasure requests. */
function useNumbers(scope: Scope | null) {
  const { state, mode } = useStore()
  const key = scope ? `${scope.by}|${(scope.locationIds ?? []).join(',')}` : ''
  const orgId = state.organisation.id
  const local = useMemo(
    () =>
      scope && mode !== 'server'
        ? newsSummary(newsAudience(state, scope, { now: new Date().toISOString() }))
        : null,
    // The scope is read through its key, so a new object with the same choice changes nothing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state, key, mode],
  )
  const [remote, setRemote] = useState<{ key: string; numbers: NewsSummary } | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    if (mode !== 'server' || !key) return
    let active = true
    const [by, locations] = key.split('|')
    const query = new URLSearchParams({ by, ...(locations ? { locations } : {}) })
    const wait = window.setTimeout(() => {
      api<NewsSummary>(`/api/workspaces/${encodeURIComponent(orgId)}/news/audience?${query}`)
        .then((numbers) => {
          if (!active) return
          setRemote({ key, numbers })
          setError('')
        })
        .catch((e: unknown) => {
          if (active) setError(e instanceof Error ? e.message : 'The numbers could not be counted.')
        })
    }, 250)
    return () => {
      active = false
      window.clearTimeout(wait)
    }
  }, [key, mode, orgId, state.revision])
  return {
    numbers: mode === 'server' ? (remote?.key === key ? remote.numbers : null) : local,
    error,
  }
}

/** How far each approved message has gone, counted from the outbox and the providers' answers. */
function useFollow() {
  const { state, mode } = useStore()
  const orgId = state.organisation.id
  const [follow, setFollow] = useState<Follow | null>(null)
  useEffect(() => {
    if (mode !== 'server') return
    let active = true
    api<Follow>(`/api/workspaces/${encodeURIComponent(orgId)}/news`)
      .then((next) => {
        if (active) setFollow(next)
      })
      .catch(() => {
        // The page still shows every message; only the progress waits for the next change.
      })
    return () => {
      active = false
    }
  }, [mode, orgId, state.revision])
  return follow
}

/** A moment on the studio's clock: "6 October 2026 at 11:00". */
function moment(state: ReturnType<typeof useStore>['state'], iso: string) {
  const { locale, timeZone } = state.organisation
  const day = new Intl.DateTimeFormat(locale, {
    timeZone,
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(iso))
  const time = new Intl.DateTimeFormat(locale, {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: locale === 'en-US',
  }).format(new Date(iso))
  return `${day} at ${time}`
}
/** Where the booking link in a message leads. */
const bookingUrl = (mode: string, slug: string) =>
  `${window.location.origin}${mode === 'server' ? `/book/${slug}` : '/booking'}`

const sentence = (n: NewsSummary | Pick<NewsMessage, 'toEmail' | 'toText'>) => {
  const email = 'email' in n ? n.email : (n.toEmail ?? 0)
  const text = 'text' in n ? n.text : (n.toText ?? 0)
  return `${clients(email + text)}: ${email} by email, ${text} by text`
}

/** Where a message stands, in a few words that never claim more than the provider said. */
function standing(m: NewsMessage, counts?: Record<OutboxStatus, number>) {
  if (m.status === 'draft') return { words: 'Draft', tone: '' }
  if (m.status === 'discarded') return { words: 'Put aside', tone: '' }
  if (m.sample) return { words: 'Sample, nothing sent', tone: '' }
  if (m.status === 'stopped') return { words: 'Stopped', tone: 'is-blocked' }
  if (!counts) return { words: 'Approved', tone: 'is-active' }
  if (counts.pending > 0) return { words: `${counts.pending} waiting to go`, tone: 'is-active' }
  if (counts.test > 0 && counts.accepted + counts.delivered + counts.failed === 0)
    return { words: 'Queued in test mode, not sent', tone: '' }
  if (counts.failed + counts.unknown > 0) return { words: 'Some need checking', tone: 'is-blocked' }
  return { words: 'With the provider', tone: 'is-active' }
}

export function News() {
  const { state, role, branch, blocked, mode } = useStore()
  const follow = useFollow()
  const all = newsMessages(state)
  const shown = all.filter((m) => m.status !== 'discarded').reverse()
  const aside = all.filter((m) => m.status === 'discarded').reverse()
  const [openId, setOpenId] = useState<string | null>(null)
  const [writing, setWriting] = useState<{ id?: string } | null>(null)
  const [notice, setNotice] = useState('')
  const sample = mode !== 'server' || operations(state).mode === 'sandbox'
  const live = !!follow && (follow.providers.email.live || follow.providers.sms.live)
  const mayWrite = can(role, 'news') && (role !== 'general' || !!branch)
  const open = all.find((m) => m.id === openId) ?? null
  const counts = (id: string) => follow?.messages.find((m) => m.id === id)?.outbox

  const welcome = !shown.length
  return (
    <div className="manage-page news-page">
      <Link className="news-back" to="/inbox">
        Back to the inbox
      </Link>
      {welcome ? (
        <section className="news-welcome" aria-labelledby="news-welcome-title">
          <img className="news-welcome-photo" src={photos.tea} alt="" />
          <div className="news-welcome-words">
            <p className="eyebrow">Inbox</p>
            <h1 id="news-welcome-title">One message for all your clients.</h1>
            <p>
              Write it once for every client who agreed to hear from you, or for the clients of one
              location. {role === 'owner' ? 'You check' : 'The owner checks'} the numbers and
              approves it before anything goes.
            </p>
            {mayWrite && (
              <Button disabled={blocked} onClick={() => setWriting({})}>
                Write a message
              </Button>
            )}
          </div>
        </section>
      ) : (
        <PageHeader
          eyebrow="Inbox"
          title="Messages to clients"
          description="One message for many clients. Only clients who agreed to news and offers receive it, once each, between 09:00 and 19:00 on the studio’s clock."
          actions={
            mayWrite && (
              <Button disabled={blocked} onClick={() => setWriting({})}>
                <Plus size={17} />
                Write a message
              </Button>
            )
          }
        />
      )}
      {notice && (
        <p className="news-notice news-settle" role="status">
          {notice}
        </p>
      )}
      {!welcome && (
        <>
          {(sample || follow) && (
            <p className="news-mode">
              {sample
                ? 'This is a sample studio. Approving a message shows how it works; nothing is queued or sent.'
                : live
                  ? 'Approved messages go through your email and text providers. A message is called delivered only when the provider confirms it.'
                  : 'Test mode: approved messages are queued in test mode, not sent. Each client’s copy shows on their page.'}
            </p>
          )}
          <ul className="news-list" aria-label="Messages to clients">
            {shown.map((m) => {
              const where = standing(m, counts(m.id))
              return (
                <li key={m.id}>
                  <button type="button" className="news-row" onClick={() => setOpenId(m.id)}>
                    <span className="news-row-words">
                      <strong>{m.subject}</strong>
                      <small>
                        {newsScopeLabel(state, m)} ·{' '}
                        {m.by === 'email' ? 'By email' : 'Email or text'} ·{' '}
                        {m.approvedAt
                          ? `Approved ${moment(state, m.approvedAt)} for ${clients((m.toEmail ?? 0) + (m.toText ?? 0))}`
                          : `Written by ${m.actor}`}
                      </small>
                    </span>
                    <span className={`ops-tag ${where.tone}`}>{where.words}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </>
      )}
      {aside.length > 0 && (
        <details className="news-aside">
          <summary>Drafts put aside ({aside.length})</summary>
          <ul className="news-list" aria-label="Drafts put aside">
            {aside.map((m) => (
              <li key={m.id}>
                <button type="button" className="news-row" onClick={() => setOpenId(m.id)}>
                  <span className="news-row-words">
                    <strong>{m.subject}</strong>
                    <small>
                      Put aside by {m.discardedBy}
                      {m.discardedAt ? `, ${moment(state, m.discardedAt)}` : ''}
                    </small>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
      {open && (
        <NewsPanel
          key={open.id}
          message={open}
          counts={counts(open.id)}
          follow={follow}
          sample={sample}
          onClose={() => setOpenId(null)}
          onChange={() => setWriting({ id: open.id })}
          onDone={(words) => {
            setNotice(words)
            setOpenId(null)
          }}
        />
      )}
      {writing && (
        <NewsEditor
          message={writing.id ? all.find((m) => m.id === writing.id) : undefined}
          onClose={() => setWriting(null)}
          onSaved={(id) => {
            setWriting(null)
            setNotice('Draft saved.')
            setOpenId(id)
          }}
        />
      )}
    </div>
  )
}

/** The numbers a message would reach: in total, by way and location, and who was left out. */
function Numbers({ numbers, scope }: { numbers: NewsSummary; scope: Scope }) {
  const { state } = useStore()
  const named = (id: string | null) =>
    id === null
      ? 'No visit in the last 12 months'
      : (places(state, true).find((p) => p.id === id)?.name ?? 'A location no longer listed')
  return (
    <div className="news-numbers">
      <p className="news-total">
        {numbers.total ? `Would go to ${sentence(numbers)}.` : 'Nobody would receive this yet.'}
      </p>
      {hasLocations(state) && numbers.byLocation.length > 0 && (
        <ul className="news-lines" aria-label="By location">
          {numbers.byLocation.map((l) => (
            <li key={l.locationId ?? 'none'}>
              <span>{named(l.locationId)}</span>
              <span>
                {l.email} by email, {l.text} by text
              </span>
            </li>
          ))}
        </ul>
      )}
      {numbers.leftOut.length > 0 && (
        <ul className="news-lines" aria-label="Left out">
          {numbers.leftOut.map((l) => (
            <li key={l.reason}>
              <span>{newsReasonLabel[l.reason]}</span>
              <span>{clients(l.count)} left out</span>
            </li>
          ))}
        </ul>
      )}
      <p className="subtle">
        {scope.locationIds?.length
          ? NEWS_LOCATION_RULE
          : 'Every client who agreed to news and offers.'}{' '}
        Each person gets one message, however many records or locations they have.
        {scope.by === 'either'
          ? numbers.emailNotText > 0
            ? ` Texts go only to clients whose agreement named texts, so ${clients(numbers.emailNotText)} get an email instead.`
            : ' Texts go only to clients whose agreement named texts.'
          : ''}
      </p>
    </div>
  )
}

/** How the message reads, as an email and as a text, with the text's length and parts. */
function Preview({
  message,
}: {
  message: Pick<NewsMessage, 'subject' | 'body' | 'bookLink' | 'by'>
}) {
  const { state, mode, slug } = useStore()
  const [as, setAs] = useState<'email' | 'text'>('email')
  const booking = bookingUrl(mode, slug)
  const email = newsEmail(state, message, { greet: '[first name]' })
  const text = newsText(state, message).replaceAll(NEWS_BOOK_LINK, booking)
  const parts = textParts(text)
  return (
    <div className="news-preview">
      <SegmentedControl
        label="Preview as"
        value={as}
        onChange={setAs}
        options={[
          { value: 'email', label: 'As an email' },
          { value: 'text', label: 'As a text' },
        ]}
      />
      {as === 'email' ? (
        <div className="news-preview-body" aria-label="As an email">
          <p className="news-preview-from">
            <Mail size={15} aria-hidden="true" /> From {state.organisation.name}
          </p>
          <strong>{email.subject || 'Subject'}</strong>
          <p>
            {email.body
              .replaceAll(NEWS_BOOK_LINK, booking)
              .replaceAll(NEWS_STOP_LINK, '[a private link to stop news]')}
          </p>
        </div>
      ) : (
        <div className="news-preview-body" aria-label="As a text">
          <p className="news-preview-from">
            <MessageSquareText size={15} aria-hidden="true" /> Text from {state.organisation.name}
          </p>
          <p>{text}</p>
          <p className="subtle">
            {parts.characters} characters, sent as{' '}
            {parts.parts === 1 ? 'one text' : `${parts.parts} parts`}.
            {parts.plain
              ? ''
              : ' A character outside the plain set means each part holds 70 characters, not 160.'}
            {message.by === 'email' ? ' This message goes by email only.' : ''}
          </p>
        </div>
      )}
    </div>
  )
}

function NewsPanel({
  message,
  counts,
  follow,
  sample,
  onClose,
  onChange,
  onDone,
}: {
  message: NewsMessage
  counts?: Record<OutboxStatus, number>
  follow: Follow | null
  sample: boolean
  onClose: () => void
  onChange: () => void
  onDone: (notice: string) => void
}) {
  const { state, role, branch, blocked, commit } = useStore()
  const scope = { by: message.by, locationIds: message.locationIds }
  const { numbers, error: countError } = useNumbers(message.status === 'draft' ? scope : null)
  const [checking, setChecking] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const draft = message.status === 'draft'
  const own = role !== 'general' || (!!branch && newsOnlyAt(message, branch))
  const mayChange = draft && can(role, 'news') && own
  const mayApprove = draft && can(role, 'news-send')
  const waiting = !counts || counts.pending > 0
  const mayStop =
    message.status === 'approved' && !message.sample && waiting && can(role, 'news-stop') && own
  // Until the server says whether email and texts are live, approval waits, so the words beside
  // it never say test mode for a message that would really go.
  const live =
    !!follow &&
    ((!!numbers?.email && follow.providers.email.live) ||
      (!!numbers?.text && follow.providers.sms.live))
  const when = (iso?: string) => (iso ? moment(state, iso) : '')

  async function act(command: Parameters<typeof commit>[0], done: string) {
    setPending(true)
    setError('')
    try {
      const result = await commit(command)
      if (!result.ok) {
        setError(result.error)
        return
      }
      onDone(done)
    } catch {
      setError('That could not be saved. Nothing has changed; try again.')
    } finally {
      setPending(false)
    }
  }
  const approvedWords = sample
    ? 'Approved. A sample studio, so nothing was queued or sent.'
    : live
      ? 'Approved. Queued to go out between 09:00 and 19:00. A message is called delivered only when the provider confirms it.'
      : 'Approved. Queued in test mode, not sent.'

  return (
    <Modal
      open
      placement="side"
      onClose={onClose}
      title={message.subject}
      description={`${newsScopeLabel(state, message)}. ${newsWayLabel[message.by]}.`}
    >
      <div className="news-panel">
        <section aria-labelledby="news-reach">
          <h3 id="news-reach">Who it reaches</h3>
          {draft ? (
            numbers ? (
              <Numbers numbers={numbers} scope={scope} />
            ) : countError ? (
              <ErrorMessage error={countError} />
            ) : (
              <p className="subtle" role="status">
                Counting the clients it would reach.
              </p>
            )
          ) : message.status === 'discarded' ? (
            <p className="subtle">Put aside before it was approved. It was never queued.</p>
          ) : (
            <>
              <p className="news-total">
                {message.sample ? 'Approved for' : 'Queued for'} {sentence(message)}.
              </p>
              {message.leftOut ? (
                <p className="subtle">{clients(message.leftOut)} left out when it was approved.</p>
              ) : null}
              {message.sample ? (
                <p className="subtle">A sample studio, so nothing was queued or sent.</p>
              ) : counts ? (
                <ul className="news-lines" aria-label="How far it has gone">
                  {outboxStatuses
                    .filter((status) => counts[status] > 0)
                    .map((status) => (
                      <li key={status}>
                        <span>{outboxStatusLabel[status]}</span>
                        <span>{counts[status]}</span>
                      </li>
                    ))}
                </ul>
              ) : null}
            </>
          )}
        </section>
        <section aria-labelledby="news-words">
          <h3 id="news-words">How it reads</h3>
          <Preview message={message} />
        </section>
        <section aria-labelledby="news-record">
          <h3 id="news-record">The record</h3>
          <ul className="news-lines">
            <li>
              <span>Written by {message.actor}</span>
              <span>{when(message.createdAt)}</span>
            </li>
            {message.editedAt && (
              <li>
                <span>Last changed by {message.editedBy}</span>
                <span>{when(message.editedAt)}</span>
              </li>
            )}
            {message.approvedAt && (
              <li>
                <span>Approved by {message.approvedBy}</span>
                <span>{when(message.approvedAt)}</span>
              </li>
            )}
            {message.stoppedAt && (
              <li>
                <span>Stopped by {message.stoppedBy}</span>
                <span>{when(message.stoppedAt)}</span>
              </li>
            )}
            {message.discardedAt && (
              <li>
                <span>Put aside by {message.discardedBy}</span>
                <span>{when(message.discardedAt)}</span>
              </li>
            )}
          </ul>
        </section>
        {checking && numbers && (
          <section className="news-check news-settle" aria-labelledby="news-check">
            <h3 id="news-check">Send to {sentence(numbers)}?</h3>
            <p>
              Approving checks again, at this moment, that each client still agreed. Once approved
              the words cannot change.{' '}
              {sample
                ? 'This is a sample studio, so nothing is queued or sent.'
                : live
                  ? 'They go out between 09:00 and 19:00 on the studio’s clock.'
                  : 'Test mode: they will be queued in test mode, not sent.'}
            </p>
          </section>
        )}
        {stopping && (
          <section className="news-check news-settle" aria-labelledby="news-stop">
            <h3 id="news-stop">Stop the rest?</h3>
            <p>
              Anything still waiting will not go. Copies already with the provider cannot be called
              back.
            </p>
          </section>
        )}
        <ErrorMessage error={error} />
        <div className="news-actions">
          {checking && numbers ? (
            <>
              <Button
                disabled={pending || blocked}
                onClick={() =>
                  void act(
                    {
                      type: 'news-approve',
                      messageId: message.id,
                      expect: { email: numbers.email, text: numbers.text },
                    },
                    approvedWords,
                  )
                }
              >
                {pending ? 'Approving…' : `Approve and send to ${clients(numbers.total)}`}
              </Button>
              <Button variant="quiet" disabled={pending} onClick={() => setChecking(false)}>
                Not yet
              </Button>
            </>
          ) : stopping ? (
            <>
              <Button
                disabled={pending || blocked}
                onClick={() =>
                  void act(
                    { type: 'news-stop', messageId: message.id },
                    'Stopped. Nothing more of this message will go.',
                  )
                }
              >
                {pending ? 'Stopping…' : 'Stop the rest'}
              </Button>
              <Button variant="quiet" disabled={pending} onClick={() => setStopping(false)}>
                Keep it going
              </Button>
            </>
          ) : (
            <>
              {mayApprove && (
                <Button
                  disabled={pending || blocked || !numbers?.total || (!sample && !follow)}
                  onClick={() => setChecking(true)}
                >
                  Check and approve
                </Button>
              )}
              {mayChange && (
                <Button variant="secondary" disabled={pending || blocked} onClick={onChange}>
                  Change it
                </Button>
              )}
              {mayStop && (
                <Button
                  variant="secondary"
                  disabled={pending || blocked}
                  onClick={() => setStopping(true)}
                >
                  Stop the rest
                </Button>
              )}
              {draft && !mayApprove && (
                <p className="subtle news-wait">The owner checks the numbers and approves it.</p>
              )}
              {mayChange && (
                <details className="news-more">
                  <summary>More</summary>
                  <Button
                    variant="quiet"
                    disabled={pending || blocked}
                    onClick={() =>
                      void act(
                        { type: 'news-discard', messageId: message.id },
                        'Draft put aside. It stays in the record.',
                      )
                    }
                  >
                    Put this draft aside
                  </Button>
                </details>
              )}
            </>
          )}
        </div>
      </div>
    </Modal>
  )
}

function NewsEditor({
  message,
  onClose,
  onSaved,
}: {
  message?: NewsMessage
  onClose: () => void
  onSaved: (id: string) => void
}) {
  const { state, role, branch, blocked, commit, mode, slug } = useStore()
  const ids = useId()
  const general = role === 'general'
  const several = hasLocations(state)
  const open = places(state)
  const [subject, setSubject] = useState(message?.subject ?? '')
  const [body, setBody] = useState(message?.body ?? '')
  const [by, setBy] = useState<NewsWay>(message?.by ?? 'email')
  const [bookLink, setBookLink] = useState(message?.bookLink ?? true)
  const [chosen, setChosen] = useState<string[] | undefined>(
    general && branch ? [branch] : message?.locationIds,
  )
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const scope = { by, locationIds: chosen }
  const { numbers } = useNumbers(chosen && !chosen.length ? null : scope)
  const parts = textParts(
    newsText(state, { body: body || ' ', bookLink }).replaceAll(
      NEWS_BOOK_LINK,
      bookingUrl(mode, slug),
    ),
  )

  async function save(event: FormEvent) {
    event.preventDefault()
    if (chosen && !chosen.length) {
      setError('Choose at least one location.')
      return
    }
    setPending(true)
    setError('')
    try {
      const result = await commit({
        type: 'news-save',
        ...(message ? { id: message.id } : {}),
        input: {
          subject: subject.trim(),
          body: body.trim(),
          by,
          ...(chosen ? { locationIds: chosen } : {}),
          ...(bookLink ? { bookLink: true } : {}),
        },
      })
      if (!result.ok) setError(result.error)
      else onSaved(result.recordId)
    } catch {
      setError('That could not be saved. Your writing is still here; try again.')
    } finally {
      setPending(false)
    }
  }

  return (
    <Modal
      open
      wide
      onClose={() => {
        if (!pending) onClose()
      }}
      title={message ? 'Change the draft' : 'Write a message'}
      description="Only clients who agreed to news and offers receive it. Nothing goes until the owner approves it."
    >
      <form onSubmit={save} aria-busy={pending}>
        <div className="ops-fields">
          {general ? (
            <p className="ops-wide news-for">
              For the clients of{' '}
              {places(state, true).find((p) => p.id === branch)?.name ?? 'your location'}.{' '}
              {NEWS_LOCATION_RULE}
            </p>
          ) : several ? (
            <fieldset className="ops-checks ops-wide">
              <legend>Who it is for</legend>
              <label>
                <input
                  type="radio"
                  name="news-scope"
                  checked={!chosen}
                  onChange={() => setChosen(undefined)}
                />
                Every client of the studio
              </label>
              <label>
                <input
                  type="radio"
                  name="news-scope"
                  checked={!!chosen}
                  onChange={() => setChosen([])}
                />
                The clients of chosen locations
              </label>
              {chosen && (
                <div className="news-places">
                  {open.map((p) => (
                    <label key={p.id}>
                      <input
                        type="checkbox"
                        checked={chosen.includes(p.id)}
                        onChange={(e) =>
                          setChosen(
                            e.target.checked
                              ? [...chosen, p.id]
                              : chosen.filter((id) => id !== p.id),
                          )
                        }
                      />
                      {p.name}
                    </label>
                  ))}
                  <small>{NEWS_LOCATION_RULE}</small>
                </div>
              )}
            </fieldset>
          ) : null}
          <fieldset className="ops-checks ops-wide">
            <legend>How it goes</legend>
            <label>
              <input
                type="radio"
                name="news-by"
                checked={by === 'email'}
                onChange={() => setBy('email')}
              />
              By email
            </label>
            <label>
              <input
                type="radio"
                name="news-by"
                checked={by === 'either'}
                onChange={() => setBy('either')}
              />
              By text where they agreed to texts, otherwise by email
            </label>
          </fieldset>
          <label className="ops-wide">
            Subject
            <input
              required
              minLength={3}
              maxLength={NEWS_SUBJECT_LIMIT}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
          </label>
          <div className="ops-wide ops-field">
            <label htmlFor={`${ids}-body`}>Your message</label>
            <textarea
              id={`${ids}-body`}
              aria-describedby={`${ids}-body-help`}
              required
              minLength={10}
              maxLength={NEWS_BODY_LIMIT}
              rows={6}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="A few warm lines, as you would say them at the desk."
            />
            <small id={`${ids}-body-help`}>
              {body.length} of {NEWS_BODY_LIMIT} characters. Emails start with the client’s first
              name and end with {state.organisation.name} and a link to stop news. Texts start with{' '}
              {state.organisation.name} and end with “Reply STOP to stop texts.”
              {by === 'either'
                ? ` As a text it is ${parts.characters} characters, sent as ${parts.parts === 1 ? 'one text' : `${parts.parts} parts`}.`
                : ''}
            </small>
          </div>
          <label className="ops-check ops-wide">
            <input
              type="checkbox"
              checked={bookLink}
              onChange={(e) => setBookLink(e.target.checked)}
            />
            End with a link to book online
          </label>
        </div>
        <p className="ops-editor-note news-editor-numbers" role="status">
          {chosen && !chosen.length
            ? 'Choose at least one location.'
            : numbers
              ? numbers.total
                ? `Would go to ${sentence(numbers)}.${numbers.leftOutTotal ? ` ${clients(numbers.leftOutTotal)} left out.` : ''}`
                : 'Nobody would receive this yet.'
              : 'Counting the clients it would reach.'}
        </p>
        <ErrorMessage error={error} />
        <div className="ops-actions news-editor-actions">
          <Button type="submit" disabled={pending || blocked}>
            {pending ? 'Saving…' : 'Save draft'}
          </Button>
          <Button variant="quiet" disabled={pending} onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  )
}
