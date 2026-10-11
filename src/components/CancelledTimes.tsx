import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarX2 } from 'lucide-react'
import { useStore } from '../state/context'
import { useClock } from '../state/clock'
import { can, operations } from '../domain/operations'
import { feedbackSince } from '../domain/feedback'
import { money, wholeMoney } from '../domain/format'
import { offerPrices, offersTaken, quietOffer } from '../domain/quietOffers'
import { OfferNote } from './QuietOffers'
import { hasLocations, placeOf } from '../domain/locations'
import {
  FREED_DAYS_AHEAD,
  WRITTEN_BY_SALEANE,
  freedSummary,
  freedTimes,
  freedWhen,
  invitationState,
  invitationsFor,
  suggestionsFor,
  timeKey,
  waitingFor,
} from '../domain/cancelledTimes'
import type { FreedTime, InvitationState } from '../domain/cancelledTimes'
import type { Command } from '../domain/commands'
import type { WaitlistEntry } from '../domain/waitlistSchema'
import { Avatar, Button, ErrorMessage, Checkbox } from '../design'
import { FillDialog } from './Waitlist'
import './cancelledTimes.css'

/**
 * NEXT-11: times a cancellation left free, on the waitlist page. Each shows who is waiting for a
 * time like it, the guests who might like it and why, and who has been invited. Writing
 * invitations saves drafts for approval in the Inbox; nothing is sent from here.
 */

/** How long ago, in words: "20 minutes ago", "an hour ago", "2 days ago". */
function ago(now: string, then: string) {
  const minutes = Math.max(0, Math.floor((Date.parse(now) - Date.parse(then)) / 60000))
  if (minutes < 1) return 'just now'
  if (minutes < 60) return minutes === 1 ? 'a minute ago' : `${minutes} minutes ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return hours === 1 ? 'an hour ago' : `${hours} hours ago`
  const days = Math.floor(hours / 24)
  return days === 1 ? 'a day ago' : `${days} days ago`
}

/** Reasons as one sentence: "Was due back on 15 September, has seen Maya before". */
function because(reasons: string[]) {
  return reasons
    .map((reason, i) => (i ? reason.charAt(0).toLowerCase() + reason.slice(1) : reason))
    .join(', ')
}

const times = (n: number, one: string, many: string) => (n === 1 ? one : many.replace('#', `${n}`))

export function CancelledTimes() {
  const { state, role, blocked } = useStore()
  const allowed = !blocked && can(role, 'opening-invite')
  const canOffer = !blocked && can(role, 'waitlist-add')
  const clock = useClock()
  const rows = useMemo(() => freedTimes(state, clock), [state, clock])
  const summary = useMemo(() => freedSummary(state, feedbackSince(state, 30)), [state])
  // Stage 5: visits booked at a quiet-time price, and how far below their usual prices.
  const taken = useMemo(() => offersTaken(state, feedbackSince(state, 30)), [state])
  const filledParts = [
    summary.invited ? times(summary.invited, 'one by someone invited', '# by someone invited') : '',
    summary.waitlist ? times(summary.waitlist, 'one from the waitlist', '# from the waitlist') : '',
  ].filter(Boolean)
  return (
    <section className="surface ops-panel" aria-labelledby="freed-heading">
      <header>
        <div>
          <h2 id="freed-heading">Cancelled times</h2>
          <p>
            Times a cancellation has left free in the next {FREED_DAYS_AHEAD} days. Anyone waiting
            comes first; then guests who agreed to hear from you and might like it. Nothing is sent
            until it is approved in the Inbox.
          </p>
        </div>
        <CalendarX2 size={21} aria-hidden="true" />
      </header>
      {summary.freed > 0 && (
        <p className="freed-summary">
          In the last 30 days, {times(summary.freed, 'one time was', '# times were')} freed by
          cancellations and{' '}
          {summary.filled === 0
            ? 'none has been booked again yet.'
            : `${times(summary.filled, 'one was', '# were')} booked again${filledParts.length ? ` (${filledParts.join(' and ')})` : ''}, worth ${wholeMoney(summary.valueMinor, state.organisation)}.`}
        </p>
      )}
      {taken.taken > 0 && (
        <p className="freed-summary">
          {times(taken.taken, 'One visit was', '# visits were')} booked at a quiet-time price in the
          last 30 days, {money(taken.givenMinor, state.organisation)} below the usual prices.
        </p>
      )}
      {rows.length ? (
        <ul className="freed-times">
          {rows.map((time) => (
            <FreedTimeCard key={timeKey(time)} time={time} allowed={allowed} canOffer={canOffer} />
          ))}
        </ul>
      ) : (
        <p className="ops-help">
          Nothing booked in the next {FREED_DAYS_AHEAD} days has been cancelled and left free.
        </p>
      )}
    </section>
  )
}

const stateWords: Record<InvitationState, string> = {
  draft: 'waiting in the Inbox for approval',
  stale: 'not sent: the time has gone',
  approved: 'approved',
  replied: 'has replied, see the Inbox',
  booked: 'booked this time',
  withdrawn: 'withdrawn',
}

function FreedTimeCard({
  time,
  allowed,
  canOffer,
}: {
  time: FreedTime
  allowed: boolean
  canOffer: boolean
}) {
  const { state, commit } = useStore()
  const clock = useClock()
  const listed = useMemo(() => waitingFor(state, time, clock), [state, time, clock])
  const suggestions = useMemo(() => suggestionsFor(state, time, clock), [state, time, clock])
  const invited = invitationsFor(state, time)
  // When nobody is waiting or invited yet, the best few are ticked, so writing to them is one tap.
  const [chosen, setChosen] = useState<string[]>(() =>
    listed.length || invited.length ? [] : suggestions.slice(0, 3).map((x) => x.clientId),
  )
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')
  const [offering, setOffering] = useState<WaitlistEntry | null>(null)
  const picked = chosen.filter((id) => suggestions.some((x) => x.clientId === id))
  const service = state.services.find((x) => x.id === time.serviceId)
  const person = state.staff.find((p) => p.id === time.staffId)
  const where = hasLocations(state) ? ` at ${placeOf(state, time.locationId)?.name}` : ''
  const name = (id: string) => state.clients.find((c) => c.id === id)?.name ?? 'A guest'
  const when = freedWhen(state, time)
  // Stage 5: the lower price invitations written now would carry, from the owner's setting.
  const lower = useMemo(() => quietOffer(state, time, clock), [state, time, clock])
  // An offer already written to someone waiting, for just this time.
  const offerFor = (entry: WaitlistEntry) =>
    entry.offers
      ?.filter(
        (o) =>
          o.date === time.date &&
          o.startMinutes === time.startMinutes &&
          o.staffId === time.staffId,
      )
      .at(-1)
  const offerWords = (entry: WaitlistEntry) => {
    const message = operations(state).messages.find((m) => m.id === offerFor(entry)?.messageId)
    if (!message) return 'offered this time'
    if (message.status === 'draft') return 'offered this time, waiting in the Inbox for approval'
    return message.status === 'suppressed'
      ? 'offered this time, withdrawn'
      : 'offered this time, approved'
  }
  async function write() {
    if (pending || !picked.length) return
    setPending(true)
    setError('')
    try {
      const command: Command = {
        type: 'opening-invite',
        appointmentId: time.appointmentId,
        clientIds: picked,
      }
      const result = await commit(command)
      if (!result.ok) setError(result.error)
      else {
        setChosen([])
        setDone(
          `${times(picked.length, 'An invitation is', '# invitations are')} waiting in the Inbox for you to approve. Nothing has been sent.`,
        )
      }
    } catch {
      setError('This could not be saved. Try again.')
    } finally {
      setPending(false)
    }
  }
  return (
    <li className="freed-time">
      <div className="freed-time-copy">
        <strong>{when}</strong>
        <span className="freed-time-with">
          {person && <Avatar small identity={person.id} tone={person.tone} name={person.name} />}
          <span>
            {service?.name}{' '}
            <small>
              with {person?.name}
              {where}
            </small>
          </span>
        </span>
        <small>
          {time.durationMinutes} minutes. Cancelled {ago(clock, time.cancelledAt)}.
        </small>
      </div>
      <div className="freed-time-who">
        {listed.length > 0 && (
          <div className="freed-waiting">
            <p>
              {listed.map((e) => name(e.clientId)).join(' and ')}{' '}
              {listed.length === 1
                ? 'is waiting for a time like this and comes'
                : 'are waiting for a time like this and come'}{' '}
              first.
            </p>
            {listed.some((entry) => offerFor(entry)) && (
              <ul className="freed-offered">
                {listed
                  .filter((entry) => offerFor(entry))
                  .map((entry) => (
                    <li key={entry.id}>
                      <strong>{name(entry.clientId)}</strong>: {offerWords(entry)}
                    </li>
                  ))}
              </ul>
            )}
            {canOffer && listed.some((entry) => !offerFor(entry)) && (
              <div className="freed-offers">
                {listed
                  .filter((entry) => !offerFor(entry))
                  .map((entry) => (
                    <Button key={entry.id} onClick={() => setOffering(entry)}>
                      Offer it to {name(entry.clientId).split(' ')[0]}
                      <span className="sr-only">: {when}</span>
                    </Button>
                  ))}
              </div>
            )}
          </div>
        )}
        {invited.length > 0 && (
          <div className="freed-invited">
            <p>Invited</p>
            <ul>
              {invited.map((m) => {
                const now = invitationState(state, m, clock)
                return (
                  <li key={m.id}>
                    <strong>{name(m.clientId)}</strong>:{' '}
                    {now === 'approved' && m.approvedAt
                      ? `approved ${ago(clock, m.approvedAt)}, no reply yet`
                      : stateWords[now]}
                    {now === 'draft' && m.actor === WRITTEN_BY_SALEANE && ', written by SALEANE'}
                    {m.offer && `, at a quiet-time price of ${offerPrices(state, m.offer)}`}
                  </li>
                )
              })}
            </ul>
          </div>
        )}
        {allowed && suggestions.length > 0 && (
          <fieldset className="freed-guests" disabled={pending}>
            <legend>
              Might like it
              <span className="sr-only">: {when}</span>
            </legend>
            {suggestions.map((guest) => (
              <label key={guest.clientId} className="freed-guest">
                <Checkbox
                  checked={picked.includes(guest.clientId)}
                  onChange={(e) =>
                    setChosen((current) =>
                      e.target.checked
                        ? [...current, guest.clientId]
                        : current.filter((id) => id !== guest.clientId),
                    )
                  }
                />
                <Avatar small identity={guest.clientId} name={guest.name} />
                <span>
                  <strong>{guest.name}</strong>
                  <small>{because(guest.reasons)}</small>
                </span>
              </label>
            ))}
          </fieldset>
        )}
        {!listed.length && !suggestions.length && !invited.length && (
          <p className="ops-help">
            Nobody who agreed to hear from you fits this time.
            {operations(state).bookingEnabled && ' It stays open to book online.'}
          </p>
        )}
        {allowed && suggestions.length > 0 && lower && (
          <OfferNote offer={lower} writtenAt={clock} />
        )}
        <ErrorMessage error={error} />
        {allowed && suggestions.length > 0 && (
          <Button
            variant={listed.length ? 'secondary' : 'primary'}
            disabled={pending || !picked.length}
            onClick={() => void write()}
          >
            {pending
              ? 'Writing…'
              : picked.length
                ? `Write ${times(picked.length, 'one invitation', '# invitations')}`
                : 'Choose who to invite'}
            <span className="sr-only">: {when}</span>
          </Button>
        )}
        {offering && (
          <FillDialog
            entry={offering}
            opening={{ date: time.date, startMinutes: time.startMinutes, staffId: time.staffId }}
            label={when}
            onClose={() => setOffering(null)}
          />
        )}
        <p role="status" className="ops-save-note">
          {done && (
            <>
              {done} <Link to="/inbox">Open the Inbox</Link>
            </>
          )}
        </p>
      </div>
    </li>
  )
}
