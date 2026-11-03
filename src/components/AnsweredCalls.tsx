import { useId, useState } from 'react'
import { Link } from 'react-router-dom'
import { PhoneIncoming } from 'lucide-react'
import { useStore } from '../state/context'
import { useClock } from '../state/clock'
import { businessDate, can } from '../domain/operations'
import { callLength, openAnsweredCalls } from '../domain/answeredCalls'
import { numberLabel } from '../domain/missedCalls'
import { dateLabel } from '../domain/format'
import { Button, ErrorMessage } from '../design'
import { useRun } from './usePayment'
import { BookingDialog } from './BookingDialog'
import { useSeeAll } from './seeAll'
import { SeeAllButton } from './SeeAllButton'
import './needsYou.css'

/**
 * NEXT-17: calls the AI receptionist answered when nobody at the desk could, for the team to read
 * and follow up: a message the caller left, any link it texted them to book, and what was said.
 * Shown on Today only while one waits; marked done once someone has followed it up.
 */
export function AnsweredCalls() {
  const { state, role, blocked } = useStore()
  const clock = useClock()
  const listId = useId()
  const [notice, setNotice] = useState('')
  const [booking, setBooking] = useState<{ clientId?: string } | null>(null)
  const { run, pending, error } = useRun()
  const calls = openAnsweredCalls(state, clock)
  const more = useSeeAll(calls)
  // Shown while a call waits, and until the last one followed up has been said so.
  if (!can(role, 'missed-call') || (!calls.length && !notice)) return null
  const allowed = !blocked
  const org = state.organisation
  const today = businessDate(state, clock)
  const canBook = allowed && can(role, 'book')
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
  async function done(callId: string, who: string) {
    setNotice('')
    if (await run({ type: 'answered-call-done', callId }))
      setNotice(`The call from ${who} is marked as followed up.`)
  }
  return (
    <section className="needs-card answered-card" aria-labelledby="answered-calls-title">
      <header className="needs-card-head">
        <PhoneIncoming size={18} aria-hidden="true" />
        <h3 id="answered-calls-title">Answered by the AI receptionist</h3>
        <span className={`needs-card-count ${calls.length ? '' : 'is-none'}`}>
          {calls.length}
          <span className="sr-only"> to read</span>
        </span>
      </header>
      {!calls.length && <p className="needs-empty">Nothing left to read.</p>}
      <ul className="needs-list" id={listId} hidden={!calls.length}>
        {more.shown.map((call) => {
          const client = state.clients.find((c) => c.id === call.clientId)
          const number = call.number ? numberLabel(call.number) : 'Number withheld'
          const who = client?.name ?? number
          return (
            <li key={call.id}>
              <div className="needs-who">
                {client ? (
                  <Link to={`/clients/${client.id}`}>{client.name}</Link>
                ) : (
                  <strong>{number}</strong>
                )}
                <small>
                  {when(call.at)} · {callLength(call.seconds)}
                  {client && call.number ? ` · ${number}` : ''}
                </small>
              </div>
              {call.message && (
                <div className="answered-message">
                  <strong>Message for the team</strong>
                  <p>{call.message.message}</p>
                  <small>
                    From {call.message.name}, {call.message.contact}
                  </small>
                </div>
              )}
              {call.texted.map((time) => (
                <p className="answered-texted" key={time}>
                  Texted a link to book {time}. Nothing is booked until they confirm.
                </p>
              ))}
              {call.turns.length > 0 && (
                <details className="answered-said">
                  <summary>What was said</summary>
                  <ol>
                    {call.turns.map((turn, index) => (
                      <li key={index} className={turn.from === 'guest' ? 'is-caller' : ''}>
                        <span>{turn.from === 'guest' ? 'Caller' : 'AI receptionist'}</span>
                        {turn.text}
                      </li>
                    ))}
                  </ol>
                </details>
              )}
              <div className="needs-actions">
                {call.number && (
                  <a className="button button-secondary" href={`tel:${call.number}`}>
                    Call
                  </a>
                )}
                {canBook && (
                  <Button
                    variant="secondary"
                    disabled={pending}
                    onClick={() => {
                      setNotice('')
                      setBooking({ clientId: call.clientId })
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
                  aria-label={`Followed up the call from ${who}`}
                >
                  Followed up
                </Button>
              </div>
            </li>
          )
        })}
      </ul>
      <p className="needs-note">
        It says it is an AI, answers from your studio’s records and never books by itself.
      </p>
      {more.hidden > 0 && (
        <div className="needs-card-links">
          <SeeAllButton list={listId} {...more} />
        </div>
      )}
      <ErrorMessage error={error} />
      {notice && (
        <p className="ops-save-note" role="status">
          {notice}
        </p>
      )}
      {booking && (
        <BookingDialog defaults={{ clientId: booking.clientId }} onClose={() => setBooking(null)} />
      )}
    </section>
  )
}
