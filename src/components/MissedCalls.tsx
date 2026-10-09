import { useId, useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { PhoneMissed } from 'lucide-react'
import { useStore } from '../state/context'
import { useClock } from '../state/clock'
import { businessDate, can } from '../domain/operations'
import { callsBookedThisWeek, numberLabel, openMissedCalls } from '../domain/missedCalls'
import { reminderSettings } from '../domain/reminders'
import { dateLabel } from '../domain/format'
import { Button, ErrorMessage } from '../design'
import { useRun } from './usePayment'
import { BookingDialog } from './BookingDialog'
import { useSeeAll } from './seeAll'
import { SeeAllButton } from './SeeAllButton'
import './patchTests.css'
import './needsYou.css'

/**
 * V1.5: calls nobody could answer, for the desk to call back. Written down here by the team, or
 * by the studio's phone line once one is connected. A caller may also get one text with the
 * booking link, if the studio switched that on. A small card on Today: the first two calls,
 * the rest a tap away.
 */
export function MissedCalls() {
  const { state, role, blocked } = useStore()
  const clock = useClock()
  const listId = useId()
  const [number, setNumber] = useState('')
  const [logging, setLogging] = useState(false)
  const [notice, setNotice] = useState('')
  const [booking, setBooking] = useState<{ callId: string; clientId?: string } | null>(null)
  const { run, pending, error, setError } = useRun()
  const calls = openMissedCalls(state, clock)
  const more = useSeeAll(calls)
  if (!can(role, 'missed-call')) return null
  const allowed = !blocked
  const org = state.organisation
  const today = businessDate(state, clock)
  const booked = callsBookedThisWeek(state, clock)
  const canBook = allowed && can(role, 'book')
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
    <section className="needs-card missed-card" aria-labelledby="missed-calls-title">
      <header className="needs-card-head">
        <PhoneMissed size={18} aria-hidden="true" />
        <h3 id="missed-calls-title">Missed calls</h3>
        <span className={`needs-card-count ${calls.length ? '' : 'is-none'}`}>
          {calls.length}
          <span className="sr-only"> to call back</span>
        </span>
      </header>
      {calls.length ? (
        <ul className="needs-list" id={listId}>
          {more.shown.map((call) => {
            const client = state.clients.find((c) => c.id === call.clientId)
            const who = client?.name ?? numberLabel(call.number)
            return (
              <li key={call.id}>
                <div className="needs-who">
                  {client ? (
                    <Link to={`/clients/${client.id}`}>{client.name}</Link>
                  ) : (
                    <strong>{numberLabel(call.number)}</strong>
                  )}
                  <small>
                    {when(call.lastAt)}
                    {call.calls > 1 ? ` · rang ${call.calls} times` : ''}
                    {client ? ` · ${numberLabel(call.number)}` : ''}
                    {' · '}
                    {call.source === 'phone' ? 'from the phone line' : `noted by ${call.actor}`}
                  </small>
                </div>
                <div className="needs-actions">
                  <a className="button button-secondary" href={`tel:${call.number}`}>
                    Call
                  </a>
                  {canBook && (
                    <Button
                      variant="secondary"
                      disabled={pending}
                      onClick={() => {
                        setNotice('')
                        setBooking({ callId: call.id, clientId: call.clientId })
                      }}
                      aria-label={`Book a visit for ${who}`}
                    >
                      Book
                    </Button>
                  )}
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
        <p className="needs-empty">No calls waiting for a call back.</p>
      )}
      <p className="needs-note">
        {booked > 0 &&
          `${booked === 1 ? 'One call' : `${booked} calls`} this week became a booked visit. `}
        {textBack
          ? 'Each caller is also texted your booking link, once a day.'
          : 'Texting callers back is off in Settings.'}
      </p>
      {(more.hidden > 0 || (allowed && !logging)) && (
        <div className="needs-card-links">
          <SeeAllButton list={listId} {...more} />
          {allowed && !logging && (
            <button type="button" className="text-link" onClick={() => setLogging(true)}>
              Log a missed call
            </button>
          )}
        </div>
      )}
      {allowed && logging && (
        <form className="missed-form" onSubmit={(event) => void add(event)} aria-busy={pending}>
          <label>
            Log a missed call
            <input
              type="tel"
              inputMode="tel"
              autoComplete="off"
              autoFocus
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
      {booking && (
        <BookingDialog
          defaults={{ callId: booking.callId, clientId: booking.clientId }}
          onClose={() => setBooking(null)}
        />
      )}
    </section>
  )
}
