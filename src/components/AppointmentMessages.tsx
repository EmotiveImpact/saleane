import { useState } from 'react'
import { Link } from 'react-router-dom'
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
import type { ReminderSettings } from '../domain/reminders'
import { Button, ErrorMessage, Select, Checkbox } from '../design'
import type { Client } from '../domain/model'
import { kindLabel, useSentMessages } from './sentMessages'
import { isSocialChannel, socialLabel } from '../domain/inboxSchema'
import { dayMonth, textStopState } from '../domain/textStop'
import './textStop.css'
import { SentEmail } from './EmailPreview'

const providerLabel: Record<string, string> = {
  test: 'test mode',
  postmark: 'Postmark',
  resend: 'Resend',
  sendgrid: 'SendGrid',
  mailgun: 'Mailgun',
  ses: 'Amazon SES',
  smtp: 'a mail server',
  google: 'Google Workspace',
  microsoft: 'Microsoft 365',
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
            <Checkbox
              checked={draft.confirmations}
              onChange={(e) => set('confirmations', e.target.checked)}
            />
            Confirm each booking, and any change of time or cancellation
          </label>
          <label className="checkbox-label">
            <Checkbox
              checked={draft.reminders}
              onChange={(e) => set('reminders', e.target.checked)}
            />
            Send a reminder before each visit
          </label>
          <label className="checkbox-label">
            <Checkbox
              checked={draft.feedback !== false}
              onChange={(e) => set('feedback', e.target.checked)}
            />
            After checkout, email a private &ldquo;how was your visit?&rdquo; request
          </label>
          <label className="checkbox-label">
            <Checkbox
              checked={draft.missedCall === true}
              onChange={(e) => set('missedCall', e.target.checked)}
            />
            When you miss a call, text the caller once with your booking link
          </label>
          <label className="checkbox-label">
            <Checkbox
              checked={draft.openingInvites !== false}
              onChange={(e) => set('openingInvites', e.target.checked)}
            />
            When a visit is cancelled, write invitations to the time for you to approve
          </label>
          <label>
            When the reminder goes
            <Select
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
            </Select>
          </label>
        </fieldset>
        <fieldset className="message-settings" disabled={!editable || pending}>
          <legend>How</legend>
          <label className="checkbox-label">
            <Checkbox checked={draft.email} onChange={(e) => set('email', e.target.checked)} />
            Email
          </label>
          <label className="checkbox-label">
            <Checkbox checked={draft.sms} onChange={(e) => set('sms', e.target.checked)} />
            Text message, when the client has a mobile number
          </label>
        </fieldset>
        <p className="subtle">
          These are messages about a booked visit, not marketing. A client can turn them off on
          their profile. Aftercare, due back, birthday and &ldquo;we miss you&rdquo; emails are in{' '}
          <Link to="/marketing/automatic">Marketing, Automatic</Link>, and the words guests agree to
          for news are in <Link to="/marketing/audience">Marketing, Audience</Link>. A missed-call
          text goes within 15 minutes of the call, at most once a day to each number, and never to a
          client who asked for no texts. Invitations to a cancelled time go to a few guests who
          agreed to hear from you, only once you approve them in the Inbox, and never when someone
          on the waitlist could take it.{' '}
          {mode === 'demo' ? 'The demo studio never sends anything.' : ''}
        </p>
        <ErrorMessage error={error} />
        <p className="ops-save-note" role="status">
          {saved}
        </p>
        {editable && (
          <div className="ops-actions">
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
        <h2 id="sent-messages-title">{clientId ? 'Visit messages' : 'Sent for you'}</h2>
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
                        {message.channel === 'email'
                          ? 'Email'
                          : isSocialChannel(message.channel)
                            ? `${socialLabel[message.channel]} message`
                            : 'Text'}{' '}
                        to {message.recipient} · {when(message.createdAt)}
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
                    {message.channel === 'email' && message.status !== 'skipped' && (
                      <SentEmail id={message.id} />
                    )}
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
  // Stage 1: turning texts back on for a client who replied STOP waits for the team to confirm.
  const [asking, setAsking] = useState<string | null>(null)
  const allowed = can(role, 'contact-preferences') && !blocked
  const studio = reminderSettings(state)
  const reachable = channelsFor(state, client)
  const stop = textStopState(state, client)
  const confirming = asking === client.id && stop?.kind === 'stopped'
  const first = client.name.split(' ')[0]
  async function change(next: { email: boolean; sms: boolean; askedAfterStop?: true }) {
    if (pending || !allowed) return
    setPending(true)
    setError('')
    try {
      const result = await commit({ type: 'contact-preferences', clientId: client.id, ...next })
      if (!result.ok) setError(result.error)
      else setAsking(null)
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
        <Checkbox
          checked={email}
          disabled={pending || !allowed}
          onChange={(e) => void change({ email: e.target.checked, sms })}
        />
        Visit emails
      </label>
      <label className="checkbox-label">
        <Checkbox
          checked={sms || confirming}
          disabled={pending || !allowed || confirming}
          onChange={(e) => {
            if (e.target.checked && stop?.kind === 'stopped') setAsking(client.id)
            else void change({ email, sms: e.target.checked })
          }}
        />
        Visit texts
      </label>
      {confirming && stop?.kind === 'stopped' && (
        <div className="text-stop-confirm" role="group" aria-label="Turn texts back on">
          <p>
            <strong>Only if {first} asked you to.</strong> They replied STOP by text on{' '}
            {dayMonth(state, stop.at)}.{' '}
            {stop.blocked
              ? 'Their phone network keeps blocking the studio’s texts until they text START to your number, and SALEANE will not text that number until then.'
              : 'Texts would go to the number now on their record.'}
          </p>
          <div className="text-stop-actions">
            <Button
              disabled={pending || !allowed}
              onClick={() => void change({ email, sms: true, askedAfterStop: true })}
            >
              {pending ? 'Saving…' : `${first} asked, turn texts on`}
            </Button>
            <Button variant="secondary" disabled={pending} onClick={() => setAsking(null)}>
              Keep texts off
            </Button>
          </div>
        </div>
      )}
      {stop && !confirming && (
        <p className="text-stop-note" role="status">
          {stop.kind === 'stopped' ? (
            <>
              <strong>
                Texts are off. {first} replied STOP on {dayMonth(state, stop.at)}.
              </strong>{' '}
              {stop.blocked
                ? 'Their phone network blocks the studio’s texts until they text START. Emails and email news are separate and unchanged.'
                : 'Emails and email news are separate and unchanged.'}
            </>
          ) : stop.kind === 'asked' ? (
            <>
              <strong>
                {first} texted START on {dayMonth(state, stop.at)}.
              </strong>{' '}
              Texts were turned off here, so they stay off until the team turns them on. Turn visit
              texts on if {first} wants them.
            </>
          ) : (
            <>
              <strong>
                {first}’s number replied STOP on {dayMonth(state, stop.at)}.
              </strong>{' '}
              SALEANE will not text it until they text START.
            </>
          )}
        </p>
      )}
      <p className="subtle">
        {!studio.email && !studio.sms
          ? 'The studio has turned visit messages off.'
          : reachable.length
            ? `Confirmations and reminders go by ${reachable.map((c) => (c === 'email' ? 'email' : 'text')).join(' and ')}.`
            : 'No visit messages will go to this client.'}
        {sms && studio.sms && !textNumber(client.phone)
          ? ' Texts need a mobile number with a country code.'
          : ''}
      </p>
    </>
  )
}
