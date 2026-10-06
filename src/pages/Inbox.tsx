import { useState } from 'react'
import type { FormEvent } from 'react'
import { FilePenLine, Mail, MailWarning, Plus } from 'lucide-react'
import { useStore } from '../state/context'
import { operations, can } from '../domain/operations'
import { dateLabel, timeLabel } from '../domain/format'
import { Avatar, Button, ErrorMessage, Modal } from '../components/ui'
import '../components/management.css'

export function Inbox() {
  const { state, commit, blocked, role } = useStore()
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
  const messages = config.messages
    .filter((message) => filter === 'all' || message.status === filter)
    .slice()
    .reverse()
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
      setNotice('Queue review recorded. Delivery remains unconfigured; no message was sent.')
    } catch {
      setError('Could not update the queue. Try again.')
    } finally {
      setPending('')
    }
  }
  return (
    <div className="inbox-page">
      <div className="page-heading">
        <div>
          <p className="date-caption">Every conversation has a purpose</p>
          <h1>A considered word.</h1>
          <p>Prepare client messages with their relationship and permissions in view.</p>
        </div>
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
      </div>
      <div className="ops-banner">
        <MailWarning size={20} />
        <div>
          <strong>Delivery is unconfigured.</strong>
          <p>
            This is the local draft and review queue. Email and SMS are not connected. Queued does
            not mean sent, and no incoming conversations are imported.
          </p>
        </div>
      </div>
      <div className="ops-summary">
        <div>
          <span>Ready to consider</span>
          <strong>{count('draft')}</strong>
          <small>Saved drafts</small>
        </div>
        <div>
          <span>Awaiting a delivery service</span>
          <strong>{count('queued')}</strong>
          <small>Queued locally · none sent</small>
        </div>
        <div>
          <span>Consent needs attention</span>
          <strong>{count('suppressed')}</strong>
          <small>Suppressed messages</small>
        </div>
      </div>
      <div className="ops-tabs" role="group" aria-label="Message queue view">
        {(['all', 'draft', 'queued', 'suppressed'] as const).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
          >
            {value === 'all'
              ? 'All messages'
              : value === 'draft'
                ? 'Drafts'
                : value === 'queued'
                  ? 'Queued'
                  : 'Suppressed'}
            <span className="ops-count">
              {value === 'all' ? config.messages.length : count(value)}
            </span>
          </button>
        ))}
      </div>
      <div className="ops-layout">
        <section className="surface ops-panel">
          <header>
            <div>
              <h2>Your message queue</h2>
              <p>Consent is checked when a draft is queued. Future delivery must check it again.</p>
            </div>
            <Mail size={21} />
          </header>
          <ErrorMessage error={composing ? '' : error} />
          <p className="ops-save-note" role="status">
            {notice}
          </p>
          {messages.map((message) => {
            const recipient = state.clients.find((item) => item.id === message.clientId)
            const visit = state.appointments.find((item) => item.id === message.appointmentId)
            const missingConsent = message.purpose === 'marketing' && !recipient?.marketingConsent
            return (
              <article className="ops-message" key={message.id}>
                <header>
                  <Avatar small identity={recipient?.id} name={recipient?.name ?? 'Client'} />
                  <div>
                    <strong>{recipient?.name ?? 'Client no longer available'}</strong>
                    <br />
                    <small>
                      {recipient?.email} ·{' '}
                      {message.purpose === 'appointment' ? 'Appointment update' : 'Marketing'}
                    </small>
                  </div>
                  <span
                    className={`ops-tag ${message.status === 'suppressed' || missingConsent ? 'is-blocked' : ''}`}
                  >
                    {message.status === 'queued'
                      ? 'Queued · unsent'
                      : message.status === 'suppressed'
                        ? 'Suppressed'
                        : 'Draft'}
                  </span>
                </header>
                <h3>{message.subject}</h3>
                <p>{message.body}</p>
                {visit && (
                  <p className="ops-help">
                    Linked visit: {dateLabel(visit.date, state.organisation.locale)} at{' '}
                    {timeLabel(visit.startMinutes, state.organisation.locale)}
                  </p>
                )}
                {missingConsent && (
                  <p className="ops-help">
                    Marketing permission is not recorded. Review consent before queueing.
                  </p>
                )}
                <footer className="ops-message-footer">
                  <small>
                    Saved{' '}
                    {new Intl.DateTimeFormat(state.organisation.locale, {
                      dateStyle: 'medium',
                      timeZone: state.organisation.timeZone,
                    }).format(new Date(message.createdAt))}{' '}
                    · {message.actor}
                  </small>
                  {message.status !== 'queued' && (
                    <Button
                      variant="quiet"
                      aria-label={`Edit draft ${message.subject}`}
                      disabled={!allowedDraft || !!pending}
                      onClick={() => {
                        setEditingId(message.id)
                        setClientId(message.clientId)
                        setPurpose(message.purpose)
                        setAppointmentId(message.appointmentId ?? '')
                        setSubject(message.subject)
                        setBody(message.body)
                        setError('')
                        setComposing(true)
                      }}
                    >
                      Edit draft<span className="sr-only"> {message.subject}</span>
                    </Button>
                  )}
                  {message.status === 'draft' && (
                    <Button
                      variant="secondary"
                      disabled={!allowedQueue || !!pending || missingConsent}
                      onClick={() => {
                        void queue(message.id)
                      }}
                    >
                      {pending === message.id ? 'Reviewing…' : 'Queue for later delivery'}
                    </Button>
                  )}
                </footer>
              </article>
            )
          })}
          {!messages.length && (
            <div className="ops-no-records">
              <FilePenLine size={27} />
              <h3>
                {filter === 'all' ? 'A little space to be thoughtful.' : 'Nothing in this view.'}
              </h3>
              <p>
                {filter === 'all'
                  ? 'Write an appointment update or a consent-aware marketing draft. It stays here until you decide the next step.'
                  : 'Choose another queue view to see your saved messages.'}
              </p>
            </div>
          )}
        </section>
        <aside className="ops-aside">
          <h2>Relevant, and welcome.</h2>
          <p>
            Keep appointment messages about the visit. Promotions belong in marketing and require
            the appropriate permission.
          </p>
          <p>
            Saving a draft does not grant consent, contact a provider or create a delivery receipt.
          </p>
        </aside>
      </div>
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
                  ? 'Marketing permission is recorded. Delivery remains unconfigured.'
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
