import { useState } from 'react'
import type { FormEvent } from 'react'
import { ArrowLeft, FilePenLine, MailWarning, Plus, Search } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useStore } from '../state/context'
import { operations, can } from '../domain/operations'
import { dateLabel, timeLabel } from '../domain/format'
import { Avatar, Button, ErrorMessage, Modal, PageHeader, SegmentedControl } from '../design'
import type { BusinessState } from '../domain/model'
import { useInboxView } from '../state/inboxView'
import { isWaitlistOffer, staleOffer } from '../domain/waitlist'
import { SentMessages } from '../components/AppointmentMessages'
import '../components/management.css'

type QueuedMessage = ReturnType<typeof operations>['messages'][number]

function matches(message: QueuedMessage, state: BusinessState, query: string) {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const name = state.clients.find((c) => c.id === message.clientId)?.name ?? ''
  return `${name} ${message.subject} ${message.body}`.toLowerCase().includes(q)
}

const statusLabel = {
  draft: 'To approve',
  queued: 'Queued, not sent',
  suppressed: 'Not sent',
} as const

export function Inbox() {
  const { state, commit, blocked, role, session } = useStore()
  const config = operations(state)
  const [filter, setFilter] = useState<'all' | 'draft' | 'queued' | 'suppressed'>('all')
  const [composing, setComposing] = useState(false)
  const [editingId, setEditingId] = useState<string | undefined>()
  const [clientId, setClientId] = useState(state.clients[0]?.id ?? '')
  const [purpose, setPurpose] = useState<'appointment' | 'marketing'>('appointment')
  const [appointmentId, setAppointmentId] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [pending, setPending] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const client = state.clients.find((item) => item.id === clientId)
  const [query, setQuery] = useState('')
  const view = useInboxView(session?.user.id)
  const [selectedId, setSelectedId] = useState<string | undefined>()
  // On a phone the two-column view shows the list first, then one conversation.
  const [opened, setOpened] = useState(false)
  const [panelOpen, setPanelOpen] = useState(false)
  const messages = config.messages
    .filter((message) => filter === 'all' || message.status === filter)
    .filter((message) => matches(message, state, query))
    .slice()
    .reverse()
  const selected = messages.find((message) => message.id === selectedId) ?? messages[0]
  const count = (status: string) =>
    config.messages.filter((message) => message.status === status).length
  const allowedDraft = can(role, 'message') && !blocked
  const allowedQueue = can(role, 'message.queue') && !blocked
  function close() {
    if (!pending) {
      setComposing(false)
      setError('')
    }
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending || !allowedDraft) return
    setPending('draft')
    setError('')
    setNotice('')
    try {
      const result = await commit({
        type: 'message',
        id: editingId,
        input: { clientId, appointmentId: appointmentId || undefined, purpose, subject, body },
      })
      if (!result.ok) {
        setError(result.error)
        return
      }
      setComposing(false)
      setEditingId(undefined)
      setSubject('')
      setBody('')
      setAppointmentId('')
      setFilter('all')
      setNotice('Draft saved. Nothing has been sent.')
    } catch {
      setError('The draft could not be saved. Your writing is still here; try again.')
    } finally {
      setPending('')
    }
  }
  async function queue(messageId: string) {
    if (pending || !allowedQueue) return
    setPending(messageId)
    setError('')
    setNotice('')
    try {
      const result = await commit({ type: 'message-queue', messageId })
      if (!result.ok) {
        setError(result.error)
        return
      }
      setNotice('Approved and queued. Sending is not connected yet, so no message was sent.')
    } catch {
      setError('Could not update the queue. Try again.')
    } finally {
      setPending('')
    }
  }
  function open(message: QueuedMessage) {
    setSelectedId(message.id)
    setOpened(true)
    if (view === 'panel') setPanelOpen(true)
  }
  function edit(message: QueuedMessage) {
    setEditingId(message.id)
    setClientId(message.clientId)
    setPurpose(message.purpose)
    setAppointmentId(message.appointmentId ?? '')
    setSubject(message.subject)
    setBody(message.body)
    setError('')
    setPanelOpen(false)
    setComposing(true)
  }
  const when = (iso: string) =>
    new Intl.DateTimeFormat(state.organisation.locale, {
      day: 'numeric',
      month: 'short',
      timeZone: state.organisation.timeZone,
    }).format(new Date(iso))
  function conversation(message: QueuedMessage) {
    const recipient = state.clients.find((item) => item.id === message.clientId)
    const visit = state.appointments.find((item) => item.id === message.appointmentId)
    // A waitlist offer whose request ended or whose time has gone cannot be approved.
    const stale =
      message.status === 'draft' ? staleOffer(state, message.id, new Date().toISOString()) : null
    const missingConsent = message.purpose === 'marketing' && !recipient?.marketingConsent
    const earlier = config.messages.filter(
      (item) =>
        item.clientId === message.clientId &&
        item.id !== message.id &&
        item.createdAt <= message.createdAt,
    )
    return (
      <>
        <header className="inbox-pane-header">
          <Avatar identity={recipient?.id} name={recipient?.name ?? 'Client'} />
          <div>
            <h2 className="inbox-name">{recipient?.name ?? 'Client no longer available'}</h2>
            <p>
              {message.purpose === 'appointment' ? 'Appointment update' : 'Marketing'}
              {visit &&
                ` for the visit on ${dateLabel(visit.date, state.organisation.locale)} at ${timeLabel(visit.startMinutes, state.organisation.locale)}`}
            </p>
          </div>
          {recipient && (
            <Link className="button button-secondary" to={`/clients/${recipient.id}`}>
              Profile
            </Link>
          )}
        </header>
        <div className="inbox-thread">
          {earlier.map((item) => (
            <div className="inbox-bubble" key={item.id}>
              <small>
                {when(item.createdAt)} · {statusLabel[item.status]}
              </small>
              <strong>{item.subject}</strong>
              <p>{item.body}</p>
            </div>
          ))}
          <div className={`inbox-bubble inbox-bubble-current is-${message.status}`}>
            <small>
              {message.status === 'draft' ? 'Draft, waiting for you' : statusLabel[message.status]}{' '}
              · saved {when(message.createdAt)} by {message.actor}
            </small>
            <strong>{message.subject}</strong>
            <p>{message.body}</p>
          </div>
          {missingConsent && (
            <p className="ops-help">
              Marketing permission is not recorded. Review consent before queueing.
            </p>
          )}
          {stale && <p className="ops-help">{stale} This offer will not be sent.</p>}
        </div>
        <footer className="inbox-pane-actions">
          {message.status === 'draft' && !stale && (
            <Button
              disabled={!allowedQueue || !!pending || missingConsent}
              onClick={() => {
                void queue(message.id)
              }}
            >
              {pending === message.id ? 'Queueing…' : 'Approve and queue'}
            </Button>
          )}
          {message.status !== 'queued' && !isWaitlistOffer(state, message.id) && (
            <Button
              variant="secondary"
              aria-label={`Edit draft ${message.subject}`}
              disabled={!allowedDraft || !!pending}
              onClick={() => edit(message)}
            >
              Edit<span className="sr-only"> draft {message.subject}</span>
            </Button>
          )}
          <small>Nothing leaves SALEANE until texting and email are connected.</small>
        </footer>
      </>
    )
  }
  return (
    <div className="inbox-page">
      <PageHeader
        variant="compact"
        eyebrow="Inbox"
        title="A considered word."
        description="Prepare client messages with their relationship and permissions in view."
        actions={
          <Button
            disabled={!allowedDraft || !state.clients.length}
            onClick={() => {
              setError('')
              setNotice('')
              if (editingId) {
                setSubject('')
                setBody('')
                setAppointmentId('')
                setEditingId(undefined)
              }
              setComposing(true)
            }}
          >
            <Plus size={17} />
            Write a draft
          </Button>
        }
      />
      <div className="ops-banner">
        <MailWarning size={20} />
        <div>
          <strong>Drafts you write here are not sent yet.</strong>
          <p>
            Approved drafts wait in the queue. Queued does not mean sent, and no incoming
            conversations are imported. Booking confirmations and reminders are handled separately,
            below.
          </p>
        </div>
      </div>
      <section className={`surface inbox-card inbox-${view} ${opened ? 'is-open' : ''}`}>
        <div className="inbox-list">
          <div className="inbox-toolbar">
            <SegmentedControl
              label="Message queue view"
              appearance="chips"
              value={filter}
              onChange={(next) => {
                setFilter(next)
                setOpened(false)
              }}
              options={(['all', 'draft', 'queued', 'suppressed'] as const).map((value) => ({
                value,
                label: (
                  <>
                    {value === 'all' ? 'All' : statusLabel[value].replace(', not sent', '')}
                    <span className="chip-count">
                      {value === 'all' ? config.messages.length : count(value)}
                    </span>
                  </>
                ),
              }))}
            />
            <label className="search-field">
              <Search size={17} />
              <span className="sr-only">Search messages</span>
              <input
                type="search"
                placeholder="Search messages"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
          </div>
          <ErrorMessage error={composing ? '' : error} />
          <p className="ops-save-note" role="status">
            {notice}
          </p>
          <ul className="inbox-rows">
            {messages.map((message) => {
              const recipient = state.clients.find((item) => item.id === message.clientId)
              const current = view === 'columns' && selected?.id === message.id
              return (
                <li key={message.id}>
                  <button
                    type="button"
                    className={`inbox-row ${current ? 'is-selected' : ''}`}
                    aria-current={current ? 'true' : undefined}
                    onClick={() => open(message)}
                  >
                    <Avatar small identity={recipient?.id} name={recipient?.name ?? 'Client'} />
                    <span className="inbox-row-text">
                      <span className="inbox-row-top">
                        <strong>{recipient?.name ?? 'Client no longer available'}</strong>
                        <small>{when(message.createdAt)}</small>
                      </span>
                      <small>
                        {message.purpose === 'appointment' ? 'Appointment update' : 'Marketing'}
                      </small>
                      <span className="inbox-preview">
                        {message.subject}: {message.body}
                      </span>
                    </span>
                    <span
                      className={`ops-tag ${message.status === 'suppressed' ? 'is-blocked' : ''}`}
                    >
                      {statusLabel[message.status]}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
          {!messages.length && (
            <div className="ops-no-records">
              <FilePenLine size={27} />
              <h2>
                {filter === 'all' && !query
                  ? 'A little space to be thoughtful.'
                  : 'Nothing in this view.'}
              </h2>
              <p>
                {filter === 'all' && !query
                  ? 'Write an appointment update or a consent-aware marketing draft. It stays here until you decide the next step.'
                  : 'Choose another view or clear the search to see your saved messages.'}
              </p>
            </div>
          )}
        </div>
        {view === 'columns' && (
          <div className="inbox-pane" aria-live="polite">
            {selected ? (
              <>
                <button type="button" className="inbox-back" onClick={() => setOpened(false)}>
                  <ArrowLeft size={16} />
                  All messages
                </button>
                {conversation(selected)}
              </>
            ) : (
              <p className="inbox-pane-empty">Choose a message to read it here.</p>
            )}
          </div>
        )}
      </section>
      <SentMessages />
      {view === 'panel' && panelOpen && selected && (
        <Modal
          open
          placement="side"
          onClose={() => setPanelOpen(false)}
          title={statusLabel[selected.status]}
          description="Prepared in SALEANE. Nothing is sent until texting and email are connected."
        >
          <div className="inbox-panel">{conversation(selected)}</div>
        </Modal>
      )}
      {composing && (
        <Modal
          open
          onClose={close}
          title={editingId ? 'Edit draft' : 'Write a draft'}
          description="A local draft only. No email or text message will be sent."
        >
          <form onSubmit={save} aria-busy={!!pending}>
            <div className="ops-fields">
              <label>
                Client
                <select
                  required
                  disabled={!!editingId}
                  value={clientId}
                  onChange={(event) => {
                    setClientId(event.target.value)
                    setAppointmentId('')
                  }}
                >
                  <option value="" disabled>
                    Choose a client
                  </option>
                  {state.clients.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Purpose
                <select
                  disabled={!!editingId}
                  value={purpose}
                  onChange={(event) => setPurpose(event.target.value as typeof purpose)}
                >
                  <option value="appointment">Appointment update</option>
                  <option value="marketing">Marketing</option>
                </select>
              </label>
              <label className="ops-wide">
                Related appointment (optional)
                <select
                  value={appointmentId}
                  onChange={(event) => setAppointmentId(event.target.value)}
                >
                  <option value="">No linked appointment</option>
                  {state.appointments
                    .filter((item) => item.clientId === clientId)
                    .slice()
                    .sort((a, b) => b.date.localeCompare(a.date))
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {dateLabel(item.date, state.organisation.locale)} ·{' '}
                        {state.services.find((service) => service.id === item.serviceId)?.name}
                      </option>
                    ))}
                </select>
              </label>
              <label className="ops-wide">
                Subject
                <input
                  required
                  maxLength={150}
                  value={subject}
                  onChange={(event) => setSubject(event.target.value)}
                />
              </label>
              <label className="ops-wide">
                Message
                <textarea
                  required
                  maxLength={3000}
                  rows={6}
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                  placeholder="Write the message you would like your client to receive…"
                />
              </label>
            </div>
            {purpose === 'marketing' && (
              <p className="ops-editor-note">
                {client?.marketingConsent
                  ? 'Marketing permission is recorded. Sending is not connected yet.'
                  : 'Marketing permission is not recorded. You can keep a draft, but it cannot be queued for delivery.'}
              </p>
            )}
            <ErrorMessage error={error} />
            <div className="ops-actions">
              <Button type="submit" disabled={!!pending || !allowedDraft}>
                {pending === 'draft' ? 'Saving draft…' : 'Save draft'}
              </Button>
              <Button variant="secondary" disabled={!!pending} onClick={close}>
                Close
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}
