import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { BellRing, Mail, MessageSquareText, RotateCcw } from 'lucide-react'
import { useStore } from '../state/context'
import { api } from '../state/api'
import { can } from '../domain/operations'
import {
  channelsFor,
  outboxStatusLabel,
  reminderHourChoices,
  reminderSettings,
  textNumber,
} from '../domain/reminders'
import type {
  MessageChannel,
  MessageKind,
  OutboxStatus,
  ReminderSettings,
} from '../domain/reminders'
import { Button, ErrorMessage } from '../design'
import type { Client } from '../domain/model'

export type SentMessage = {
  id: string
  appointmentId: string
  clientId: string
  kind: MessageKind
  channel: MessageChannel
  recipient: string
  subject: string
  body: string
  status: OutboxStatus
  provider: string | null
  detail: string | null
  createdAt: string
  updatedAt: string
}
type ProviderMode = { name: string; live: boolean }
type OutboxReply = {
  messages: SentMessage[]
  providers: { email: ProviderMode; sms: ProviderMode }
}

const kindLabel: Record<MessageKind, string> = {
  confirmation: 'Booking confirmation',
  changed: 'New time',
  reminder: 'Reminder',
  cancelled: 'Cancellation',
  feedback: 'How was your visit?',
  patch_test: 'Patch test needed',
}
const providerLabel: Record<string, string> = {
  test: 'test mode',
  postmark: 'Postmark',
  twilio: 'Twilio',
}

/** The studio's confirmation and reminder settings (PILOT-01). Owners and managers can change them. */
export function MessageSettings() {
  const { state, commit, blocked, role, mode } = useStore()
  const current = reminderSettings(state)
  const [draft, setDraft] = useState<ReminderSettings>(current)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')
  const editable = can(role, 'reminders') && !blocked
  const changed = JSON.stringify(draft) !== JSON.stringify(current)
  const set = <K extends keyof ReminderSettings>(key: K, value: ReminderSettings[K]) => {
    setDraft((before) => ({ ...before, [key]: value }))
    setSaved('')
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending || !editable) return
    setPending(true)
    setError('')
    try {
      const result = await commit({ type: 'reminders', settings: draft })
      if (!result.ok) setError(result.error)
      else setSaved('Saved. New settings apply to the next message due.')
    } catch {
      setError('The settings could not be saved. Your choices are still here; try again.')
    } finally {
      setPending(false)
    }
  }
  return (
    <section className="surface ops-panel settings-panel">
      <header>
        <div>
          <h2>Messages to guests</h2>
          <p>Booking confirmations and reminders, sent for you by email and text.</p>
        </div>
        <BellRing size={21} />
      </header>
      <form className="settings-body" onSubmit={save} aria-busy={pending}>
        <ProviderNote />
        <fieldset className="message-settings" disabled={!editable || pending}>
          <legend className="sr-only">What to send</legend>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={draft.confirmations}
              onChange={(e) => set('confirmations', e.target.checked)}
            />
            Confirm each booking, and any change of time or cancellation
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={draft.reminders}
              onChange={(e) => set('reminders', e.target.checked)}
            />
            Send a reminder before each visit
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={draft.feedback !== false}
              onChange={(e) => set('feedback', e.target.checked)}
            />
            After checkout, email a private &ldquo;how was your visit?&rdquo; request
          </label>
          <label>
            When the reminder goes
            <select
              value={draft.hoursBefore}
              disabled={!draft.reminders}
              onChange={(e) =>
                set('hoursBefore', Number(e.target.value) as ReminderSettings['hoursBefore'])
              }
            >
              {reminderHourChoices.map((hours) => (
                <option key={hours} value={hours}>
                  {hours === 2
                    ? '2 hours before'
                    : hours === 24
                      ? 'The day before'
                      : 'Two days before'}
                </option>
              ))}
            </select>
          </label>
        </fieldset>
        <fieldset className="message-settings" disabled={!editable || pending}>
          <legend>How</legend>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={draft.email}
              onChange={(e) => set('email', e.target.checked)}
            />
            Email
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={draft.sms}
              onChange={(e) => set('sms', e.target.checked)}
            />
            Text message, when the client has a mobile number
          </label>
        </fieldset>
        <p className="subtle">
          These are service messages about a booked visit, never marketing. A client can turn them
          off on their profile. {mode === 'demo' ? 'The demo studio never sends anything.' : ''}
        </p>
        <ErrorMessage error={error} />
        <p className="ops-save-note" role="status">
          {saved}
        </p>
        {editable && (
          <div className="settings-actions">
            <Button type="submit" disabled={!changed || pending}>
              {pending ? 'Saving…' : 'Save message settings'}
            </Button>
          </div>
        )}
      </form>
    </section>
  )
}

/** Says plainly whether messages really leave SALEANE. */
function ProviderNote() {
  const { session, mode, state } = useStore()
  const live = session?.services.email
  const sample = state.operations?.mode !== 'local'
  return (
    <div className="ops-banner">
      {live ? <Mail size={20} /> : <MessageSquareText size={20} />}
      <div>
        <strong>
          {mode === 'demo' || sample
            ? 'This is a sample studio, so nothing is ever sent.'
            : live
              ? 'Sending is connected.'
              : 'Test mode: messages are written down here and nothing is sent.'}
        </strong>
        <p>
          {live
            ? 'A message shows as delivered only when the provider confirms it.'
            : 'You can read exactly what each guest would receive. Real sending starts once an email and text provider is chosen and connected.'}
        </p>
      </div>
    </div>
  )
}

/** The outbox for one studio, or one client. Reads only; staff can ask a failed message to go again. */
function useSentMessages(clientId?: string) {
  const { mode, state, session } = useStore()
  const [reply, setReply] = useState<OutboxReply | null>(null)
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)
  const orgId = state.organisation.id
  const signedIn = mode === 'server' && !!session
  useEffect(() => {
    if (!signedIn) return
    let active = true
    api<OutboxReply>(
      `/api/workspaces/${encodeURIComponent(orgId)}/outbox${clientId ? `?clientId=${encodeURIComponent(clientId)}` : ''}`,
    )
      .then((next) => {
        if (!active) return
        setReply(next)
        setError('')
      })
      .catch((e: unknown) => {
        if (active) setError(e instanceof Error ? e.message : 'Sent messages could not be loaded.')
      })
    return () => {
      active = false
    }
  }, [orgId, clientId, signedIn, state.revision, refresh])
  return { reply, error, load: () => setRefresh((n) => n + 1), available: signedIn }
}

export function SentMessages({ clientId }: { clientId?: string }) {
  const { state, role, blocked } = useStore()
  const { reply, error, load, available } = useSentMessages(clientId)
  const [pending, setPending] = useState('')
  const [actionError, setActionError] = useState('')
  if (!available) return null
  const when = (iso: string) =>
    new Intl.DateTimeFormat(state.organisation.locale, {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: state.organisation.timeZone,
    }).format(new Date(iso))
  async function retry(id: string) {
    setPending(id)
    setActionError('')
    try {
      await api(`/api/workspaces/${encodeURIComponent(state.organisation.id)}/outbox/${id}/retry`, {
        method: 'POST',
        body: {},
      })
      load()
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'It could not be sent again.')
    } finally {
      setPending('')
    }
  }
  const messages = reply?.messages ?? []
  return (
    <section className="surface sent-messages" aria-labelledby="sent-messages-title">
      <header>
        <h2 id="sent-messages-title">{clientId ? 'Appointment messages' : 'Sent for you'}</h2>
        <p>
          {reply && !reply.providers.email.live && !reply.providers.sms.live
            ? 'Test mode: these show what guests would receive. Nothing was sent.'
            : 'Confirmations and reminders, with what the provider has told us.'}
        </p>
      </header>
      <ErrorMessage error={error || actionError} />
      {messages.length ? (
        <ul className="sent-list">
          {messages.map((message) => {
            const client = state.clients.find((c) => c.id === message.clientId)
            return (
              <li key={message.id} className={`sent-item is-${message.status}`}>
                <details>
                  <summary>
                    <span className="sent-channel" aria-hidden="true">
                      {message.channel === 'email' ? (
                        <Mail size={16} />
                      ) : (
                        <MessageSquareText size={16} />
                      )}
                    </span>
                    <span className="sent-text">
                      <strong>
                        {kindLabel[message.kind]}
                        {!clientId && client ? ` · ${client.name}` : ''}
                      </strong>
                      <small>
                        {message.channel === 'email' ? 'Email' : 'Text'} to {message.recipient} ·{' '}
                        {when(message.createdAt)}
                      </small>
                    </span>
                    <span
                      className={`ops-tag ${['failed', 'unknown'].includes(message.status) ? 'is-blocked' : ''}`}
                    >
                      {outboxStatusLabel[message.status]}
                    </span>
                  </summary>
                  <div className="sent-body">
                    {message.subject && <strong>{message.subject}</strong>}
                    <p>{message.body}</p>
                    {message.detail && <p className="subtle">{message.detail}</p>}
                    {message.provider &&
                      message.provider !== 'test' &&
                      message.status !== 'skipped' && (
                        <p className="subtle">
                          Handled by {providerLabel[message.provider] ?? message.provider}.
                        </p>
                      )}
                    {['failed', 'unknown'].includes(message.status) &&
                      can(role, 'message.queue') && (
                        <Button
                          variant="secondary"
                          disabled={blocked || !!pending}
                          onClick={() => void retry(message.id)}
                        >
                          <RotateCcw size={15} />
                          {pending === message.id ? 'Sending again…' : 'Send again'}
                        </Button>
                      )}
                  </div>
                </details>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="subtle">
          {reply ? 'Nothing yet. Confirmations appear here as visits are booked.' : 'Loading…'}
        </p>
      )}
    </section>
  )
}

/** A client's own wish about appointment messages, on their profile. */
export function ClientMessagePreferences({ client }: { client: Client }) {
  const { state, commit, blocked, role } = useStore()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const allowed = can(role, 'contact-preferences') && !blocked
  const studio = reminderSettings(state)
  const reachable = channelsFor(state, client)
  async function change(next: { email: boolean; sms: boolean }) {
    if (pending || !allowed) return
    setPending(true)
    setError('')
    try {
      const result = await commit({ type: 'contact-preferences', clientId: client.id, ...next })
      if (!result.ok) setError(result.error)
    } catch {
      setError('Could not save. The previous choice is kept.')
    } finally {
      setPending(false)
    }
  }
  const email = !client.noEmailReminders,
    sms = !client.noTextReminders
  return (
    <>
      <ErrorMessage error={error} />
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={email}
          disabled={pending || !allowed}
          onChange={(e) => void change({ email: e.target.checked, sms })}
        />
        Appointment emails
      </label>
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={sms}
          disabled={pending || !allowed}
          onChange={(e) => void change({ email, sms: e.target.checked })}
        />
        Appointment texts
      </label>
      <p className="subtle">
        {!studio.email && !studio.sms
          ? 'The studio has turned appointment messages off.'
          : reachable.length
            ? `Confirmations and reminders go by ${reachable.map((c) => (c === 'email' ? 'email' : 'text')).join(' and ')}.`
            : 'No appointment messages will go to this client.'}
        {sms && studio.sms && !textNumber(client.phone)
          ? ' Texts need a mobile number with a country code.'
          : ''}
      </p>
    </>
  )
}
