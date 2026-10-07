import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { PhoneMissed } from 'lucide-react'
import { useStore } from '../state/context'
import { useClock } from '../state/clock'
import { businessDate, can } from '../domain/operations'
import { numberLabel, openMissedCalls } from '../domain/missedCalls'
import { reminderSettings } from '../domain/reminders'
import { dateLabel } from '../domain/format'
import { Button, ErrorMessage } from '../design'
import { useRun } from './usePayment'
import './patchTests.css'

/**
 * V1.5: calls nobody could answer, for the desk to call back. Written down here by the team, or
 * by the studio's phone line once one is connected. A caller may also get one text with the
 * booking link, if the studio switched that on.
 */
export function MissedCalls() {
  const { state, role, blocked } = useStore()
  const clock = useClock()
  const [number, setNumber] = useState('')
  const [notice, setNotice] = useState('')
  const { run, pending, error, setError } = useRun()
  if (!can(role, 'missed-call')) return null
  const allowed = !blocked
  const org = state.organisation
  const today = businessDate(state, clock)
  const calls = openMissedCalls(state, clock)
  const textBack = reminderSettings(state).missedCall === true && reminderSettings(state).sms
  const when = (iso: string) => {
    const time = new Intl.DateTimeFormat(org.locale, {
      timeZone: org.timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: org.locale === 'en-US',
    }).format(new Date(iso))
    const day = businessDate(state, iso)
    return day === today ? time : `${dateLabel(day, org.locale, true)}, ${time}`
  }
  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setNotice('')
    if (!number.trim()) {
      setError('Enter the caller’s number.')
      return
    }
    if (await run({ type: 'missed-call', number })) {
      setNumber('')
      setNotice('Added to the list to call back.')
    }
  }
  async function done(callId: string, who: string) {
    setNotice('')
    if (await run({ type: 'missed-call-done', callId })) setNotice(`${who} is off the list.`)
  }
  return (
    <section className="surface ops-panel missed-panel" aria-labelledby="missed-calls-title">
      <header>
        <div>
          <h2 id="missed-calls-title">Missed calls</h2>
          <p>
            Calls nobody could answer. Call them back, then take them off the list.{' '}
            {textBack
              ? 'Each caller is also texted your booking link, once a day.'
              : 'Texting callers back is off in Settings.'}
          </p>
        </div>
        <PhoneMissed size={21} aria-hidden="true" />
      </header>
      {calls.length ? (
        <ul className="patch-list is-compact">
          {calls.map((call) => {
            const client = state.clients.find((c) => c.id === call.clientId)
            const who = client?.name ?? numberLabel(call.number)
            return (
              <li key={call.id}>
                <div>
                  {client ? (
                    <Link to={`/clients/${client.id}`}>
                      <strong>{client.name}</strong>
                    </Link>
                  ) : (
                    <strong>{numberLabel(call.number)}</strong>
                  )}
                  <small>
                    {when(call.lastAt)}
                    {call.calls > 1 ? ` · rang ${call.calls} times` : ''}
                    {client ? ` · ${numberLabel(call.number)}` : ''}
                  </small>
                  <small>
                    {call.source === 'phone' ? 'From the phone line' : `Noted by ${call.actor}`}
                  </small>
                </div>
                <div className="missed-actions">
                  <a className="button button-secondary" href={`tel:${call.number}`}>
                    Call
                  </a>
                  <Button
                    variant="quiet"
                    disabled={!allowed || pending}
                    onClick={() => void done(call.id, who)}
                    aria-label={`Called back ${who}`}
                  >
                    Called back
                  </Button>
                </div>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="subtle">No calls waiting for a call back.</p>
      )}
      {allowed && (
        <form className="missed-form" onSubmit={(event) => void add(event)} aria-busy={pending}>
          <label>
            Log a missed call
            <input
              type="tel"
              inputMode="tel"
              autoComplete="off"
              placeholder={org.region === 'US' ? '(212) 555-0100' : '07700 900123'}
              value={number}
              onChange={(e) => setNumber(e.target.value)}
            />
          </label>
          <Button type="submit" variant="secondary" disabled={pending}>
            {pending ? 'Saving…' : 'Add'}
          </Button>
        </form>
      )}
      <ErrorMessage error={error} />
      {notice && (
        <p className="ops-save-note" role="status">
          {notice}
        </p>
      )}
    </section>
  )
}
