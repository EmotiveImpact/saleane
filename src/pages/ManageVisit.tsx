import { useEffect, useState } from 'react'
import { CalendarCheck } from 'lucide-react'
import { api, ApiError } from '../state/api'
import { guestViewSchema, GUEST_CANCEL_CUTOFF_HOURS } from '../domain/guest'
import type { GuestView } from '../domain/guest'
import { dateLabel, money, timeLabel } from '../domain/format'
import { Button, ErrorMessage, Status } from '../design'
import { BeforeYouArrive } from '../components/BeforeYouArrive'
import { AddToCalendar } from '../components/AddToCalendar'
import { GuestPayment } from '../components/GuestPayment'
import { returnNote, returnedToken } from '../state/guestReturn'
import '../guest.css'

/**
 * The token stays in the address fragment, which browsers never send to a server. Coming back
 * from the payment page, it is read from this tab's storage instead and put back in the address.
 */
function linkToken() {
  const token = window.location.hash.slice(1) || returnedToken()
  if (token && !window.location.hash)
    window.history.replaceState(null, '', `/manage${window.location.search}#${token}`)
  return token
}

/**
 * LOCAL-02: a guest's private page for one visit. It can show that visit and cancel it under the
 * studio's 24-hour policy. Nothing here is sent by email; the link was copied by hand.
 */
export function ManageVisit() {
  const [token] = useState(linkToken)
  const [view, setView] = useState<GuestView | null>(null)
  const [error, setError] = useState(() =>
    token ? '' : 'This link is incomplete. Open the full link you were given.',
  )
  const [confirming, setConfirming] = useState(false)
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)
  const [paymentNote] = useState(() => returnNote(window.location.search))

  async function load() {
    const next = guestViewSchema.parse(
      await api<GuestView>('/api/guest/visit', { method: 'POST', body: { token } }),
    )
    setView(next)
    return next
  }
  useEffect(() => {
    document.title = 'SALEANE · Your visit'
    if (!token) return
    ;(async () => {
      try {
        const first = await load()
        // A payment confirmation can arrive a moment after the guest returns; look once more.
        if (paymentNote && (first.payment?.pending || first.payment?.depositDueMinor))
          setTimeout(() => void load().catch(() => null), 4000)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Your visit could not be loaded.')
      }
    })()
    // Loads once for the token in the address.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    // Pasting another link into this tab changes only the fragment; open that visit afresh.
    const reopen = () => window.location.reload()
    window.addEventListener('hashchange', reopen)
    return () => window.removeEventListener('hashchange', reopen)
  }, [])

  async function cancel() {
    if (!view) return
    setSaving(true)
    setError('')
    try {
      const next = guestViewSchema.parse(
        await api<GuestView>('/api/guest/cancel', {
          method: 'POST',
          body: { token, expected: view.cancellation.outcome },
        }),
      )
      setView(next)
      setDone(true)
      setConfirming(false)
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) await load().catch(() => null)
      setError(e instanceof Error ? e.message : 'Your visit could not be cancelled.')
      setConfirming(false)
    } finally {
      setSaving(false)
    }
  }

  if (!view)
    return (
      <main className="guest-page">
        <span className="wordmark">SALEANE</span>
        {error ? (
          <section className="guest-card">
            <h1>We couldn’t open this visit.</h1>
            <ErrorMessage error={error} />
          </section>
        ) : (
          <p role="status">Opening your visit…</p>
        )}
      </main>
    )

  const { organisation: org, visit, deposit, cancellation, arrival } = view
  const cutoff = new Intl.DateTimeFormat(org.locale, {
    timeZone: org.timeZone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hour12: org.locale === 'en-US',
  }).format(new Date(cancellation.cutoffAt))
  const paid = money(deposit.paidMinor, org, true)
  const terms =
    cancellation.outcome === 'refund_due'
      ? `Your ${deposit.simulated ? 'simulated ' : ''}deposit of ${paid} will be flagged for refund. The studio returns it; nothing is refunded automatically.`
      : cancellation.outcome === 'retained'
        ? `It is less than ${GUEST_CANCEL_CUTOFF_HOURS} hours before your visit, so the studio keeps your ${deposit.simulated ? 'simulated ' : ''}deposit of ${paid}.`
        : 'No deposit was recorded for this visit, so there is nothing to refund.'
  return (
    <main className="guest-page">
      <span className="wordmark">SALEANE</span>
      <section className="guest-card" aria-labelledby="visit-heading">
        <p className="date-caption">
          <CalendarCheck size={16} />
          {org.name} · {org.locationName}
        </p>
        <h1 id="visit-heading">{done ? 'Your visit is cancelled.' : 'Your visit'}</h1>
        <dl className="guest-visit">
          <div>
            <dt>Treatment</dt>
            <dd>{visit.serviceName}</dd>
          </div>
          <div>
            <dt>When</dt>
            <dd>
              {dateLabel(visit.date, org.locale)} at {timeLabel(visit.startMinutes, org.locale)}
              <small>{visit.durationMinutes} minutes</small>
            </dd>
          </div>
          {org.address && (
            <div>
              <dt>Where</dt>
              <dd>{org.address}</dd>
            </div>
          )}
          <div>
            <dt>With</dt>
            <dd>{visit.professional}</dd>
          </div>
          {deposit.paidMinor > 0 && (
            <div>
              <dt>Deposit</dt>
              <dd>
                {paid} paid
                {deposit.simulated && <small>Simulated in the sample studio</small>}
              </dd>
            </div>
          )}
          <div>
            <dt>Status</dt>
            <dd>
              <Status status={visit.status} />
            </dd>
          </div>
        </dl>
        {paymentNote && (
          <p className="guest-notice" role="status">
            {paymentNote.startsWith('Thank you') &&
            !view.payment?.pending &&
            !view.payment?.depositDueMinor
              ? 'Thank you. That went through.'
              : paymentNote}
          </p>
        )}
        {view.payment && !done && (
          <GuestPayment token={token} payment={view.payment} organisation={org} />
        )}
        {visit.status === 'confirmed' && (
          <>
            <BeforeYouArrive studioNote={arrival.studioNote} serviceNote={arrival.serviceNote} />
            <AddToCalendar
              visit={{
                uid: visit.calendarUid,
                serviceName: visit.serviceName,
                studioName: org.name,
                date: visit.date,
                startMinutes: visit.startMinutes,
                durationMinutes: visit.durationMinutes,
                timeZone: org.timeZone,
                location: org.address || org.locationName,
                description: `With ${visit.professional}.`,
              }}
            />
          </>
        )}
        <ErrorMessage error={error} />
        {done && (
          <p className="guest-notice" role="status">
            The studio can see your cancellation.{' '}
            {cancellation.outcome === 'refund_due'
              ? 'Your deposit is flagged for refund.'
              : 'No message has been sent.'}
          </p>
        )}
        {cancellation.available ? (
          confirming ? (
            <div className="guest-confirm">
              <p>{terms}</p>
              <div className="guest-actions">
                <Button disabled={saving} onClick={() => void cancel()}>
                  {saving ? 'Cancelling…' : 'Yes, cancel my visit'}
                </Button>
                <Button variant="secondary" disabled={saving} onClick={() => setConfirming(false)}>
                  Keep my visit
                </Button>
              </div>
            </div>
          ) : (
            <>
              <p className="subtle">
                Cancel before {cutoff} and any deposit is flagged for refund. After that the studio
                keeps it.
              </p>
              <Button variant="secondary" onClick={() => setConfirming(true)}>
                Cancel this visit
              </Button>
            </>
          )
        ) : (
          !done && (
            <p className="subtle">
              {visit.status === 'confirmed'
                ? 'This visit has started, so it can no longer be changed online.'
                : 'This visit can no longer be changed online.'}{' '}
              Contact the studio if you need help.
            </p>
          )
        )}
        <p className="guest-footnote">
          To move your visit, contact the studio. This link is private to you; please keep it to
          yourself.
        </p>
      </section>
    </main>
  )
}
