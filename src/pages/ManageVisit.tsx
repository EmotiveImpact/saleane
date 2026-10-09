import { useEffect, useRef, useState } from 'react'
import { CalendarPlus } from 'lucide-react'
import { api, ApiError } from '../state/api'
import { guestViewSchema, GUEST_CANCEL_CUTOFF_HOURS } from '../domain/guest'
import type { GuestView } from '../domain/guest'
import { dateLabel, money, timeLabel } from '../domain/format'
import { Button, ErrorMessage, Status, photos } from '../design'
import { BeforeYouArrive } from '../components/BeforeYouArrive'
import { AddToCalendar } from '../components/AddToCalendar'
import { GuestPayment } from '../components/GuestPayment'
import { GuestFeedback } from '../components/GuestFeedback'
import { GuestWaitlist } from '../components/GuestWaitlist'
import { GuestHere } from '../components/GuestHere'
import { GuestReview } from '../components/GuestReview'
import { GuestForms } from '../components/GuestFormFill'
import { GuestEmailNews } from '../components/GuestEmailNews'
import { GuestMove } from '../components/GuestMove'
import { StudioContact } from '../components/StudioContact'
import { returnNote, returnedToken } from '../state/guestReturn'
import { readPendingMove } from '../state/guestMove'
import { useGuestColours } from '../state/studioColours'
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

const EXPIRED = 'This link has expired or been replaced. Ask the studio for a new one.'
/** The shape of a token the server issues; anything else cannot open a visit. */
const wellFormed = (token: string) => /^[A-Za-z0-9_-]{32,100}$/.test(token)
/** A refused link reads the same whether it was mistyped, replaced or has expired. */
function loadError(e: unknown) {
  if (e instanceof ApiError && (e.status === 400 || e.status === 404)) return EXPIRED
  return e instanceof Error ? e.message : 'Your visit could not be loaded.'
}

/** A moment in the studio's own time and language: "Tuesday 6 October at 09:00". */
function momentLabel(iso: string, org: GuestView['organisation']) {
  return new Intl.DateTimeFormat(org.locale, {
    timeZone: org.timeZone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hour12: org.locale === 'en-US',
  }).format(new Date(iso))
}

/**
 * What cancelling means for the deposit, in plain words: before the guest asks, as they confirm,
 * and once it is done. Only a visit with a deposit mentions one, and a simulated deposit never
 * reads as money.
 */
function cancelWords(view: GuestView, cutoff: string) {
  const { deposit, cancellation } = view
  const paid = money(deposit.paidMinor, view.organisation, true)
  const late = `It is less than ${GUEST_CANCEL_CUTOFF_HOURS} hours until your visit`
  if (cancellation.outcome === 'none')
    return {
      before: 'If you can’t make it, cancel here so the time can go to someone else.',
      confirm: 'Your time will go back on the studio’s calendar for someone else.',
      done: '',
    }
  if (deposit.simulated)
    return cancellation.outcome === 'refund_due'
      ? {
          before: `Cancel before ${cutoff} and your simulated ${paid} deposit would be given back. After that, the studio would keep it.`,
          confirm: `Your simulated ${paid} deposit would be given back. This is a sample studio, so no money moves.`,
          done: 'In this sample studio, no money moves.',
        }
      : {
          before: `${late}, so if you cancel now the studio would keep your simulated ${paid} deposit.`,
          confirm: `${late}, so the studio would keep your simulated ${paid} deposit. No money moves in a sample studio.`,
          done: 'In this sample studio, no money moves.',
        }
  return cancellation.outcome === 'refund_due'
    ? {
        before: `Cancel before ${cutoff} and the studio will give back your ${paid} deposit. After that, it keeps the deposit.`,
        confirm: `The studio will give back your ${paid} deposit. It returns the money itself; nothing is refunded automatically.`,
        done: `It will give back your ${paid} deposit.`,
      }
    : {
        before: `${late}, so if you cancel now the studio keeps your ${paid} deposit.`,
        confirm: `${late}, so the studio keeps your ${paid} deposit.`,
        done: `It keeps your ${paid} deposit.`,
      }
}

/**
 * LOCAL-02: a guest's private page for one visit. It shows that visit and how to reach the studio,
 * and lets the guest move or cancel it under the studio's 24-hour policy. It wears the studio's
 * own colours and photograph, like its booking page.
 */
export function ManageVisit() {
  const [token] = useState(linkToken)
  const [view, setView] = useState<GuestView | null>(null)
  const [error, setError] = useState(() =>
    !token
      ? 'This link is incomplete. Open the full link you were given.'
      : wellFormed(token)
        ? ''
        : EXPIRED,
  )
  const [confirming, setConfirming] = useState(false)
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)
  const [moved, setMoved] = useState(false)
  const [unsureMove, setUnsureMove] = useState(false)
  const [paymentNote] = useState(() => returnNote(window.location.search))
  const notice = useRef<HTMLParagraphElement>(null)
  useGuestColours(view?.look)

  async function load() {
    const next = guestViewSchema.parse(
      await api<GuestView>('/api/guest/visit', { method: 'POST', body: { token } }),
    )
    setView(next)
    // A move whose answer never arrived in this tab is settled before anything else changes.
    setUnsureMove(!!readPendingMove(next.visit.calendarUid))
    return next
  }
  useEffect(() => {
    document.title = 'SALEANE · Your visit'
    if (!token || !wellFormed(token)) return
    ;(async () => {
      try {
        // Coming back without paying closes the provider's page, so the guest can start again.
        if (/payment=(cancelled|declined)/.test(window.location.search))
          await api('/api/guest/pay/cancel', { method: 'POST', body: { token } }).catch(() => null)
        const first = await load()
        // A payment confirmation can arrive a moment after the guest returns; look once more.
        if (paymentNote && (first.payment?.pending || first.payment?.depositDueMinor))
          setTimeout(() => void load().catch(() => null), 4000)
      } catch (e) {
        setError(loadError(e))
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

  // News of a change takes focus, so it is read out where the button used to be.
  useEffect(() => {
    if (moved || done) notice.current?.focus()
  }, [moved, done])

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
      setMoved(false)
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
  const cutoff = momentLabel(cancellation.cutoffAt, org)
  const paid = money(deposit.paidMinor, org, true)
  const words = cancelWords(view, cutoff)
  const when = `${dateLabel(visit.date, org.locale)} at ${timeLabel(visit.startMinutes, org.locale)}`
  const cancelled = visit.status === 'cancelled'
  const monogram = org.name
    .split(' ')
    .map((word) => word[0])
    .slice(0, 2)
    .join('')
  return (
    <main className="guest-page visit-page">
      <header className="visit-hero">
        <img className="visit-hero-image" src={photos.entrance} alt="" />
        <div className="visit-hero-brand">
          <span className="atelier-monogram" aria-hidden="true">
            {monogram}
          </span>
          <span>
            {org.name}
            <small>{org.locationName}</small>
          </span>
        </div>
      </header>
      <section className="guest-card visit-card" aria-labelledby="visit-heading">
        <h1 id="visit-heading">{cancelled ? 'Your visit is cancelled.' : 'Your visit'}</h1>
        {moved && (
          <p className="guest-notice" role="status" tabIndex={-1} ref={notice}>
            Your visit has moved to {when} with {visit.professional}. {org.name} can see the change.
          </p>
        )}
        {done && (
          <p className="guest-notice" role="status" tabIndex={-1} ref={notice}>
            {org.name} can see your cancellation. {words.done}
          </p>
        )}
        {paymentNote && (
          <p className="guest-notice" role="status">
            {paymentNote.startsWith('Thank you') &&
            !view.payment?.pending &&
            !view.payment?.depositDueMinor
              ? 'Thank you. That went through.'
              : paymentNote}
          </p>
        )}
        <dl className="guest-visit">
          <div>
            <dt>Treatment</dt>
            <dd>{visit.serviceName}</dd>
          </div>
          <div>
            <dt>When</dt>
            <dd>
              {when}
              <small>{visit.durationMinutes} minutes</small>
            </dd>
          </div>
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
        {!done && <GuestHere token={token} view={view} onChange={setView} />}
        {view.payment && !done && (
          <GuestPayment token={token} payment={view.payment} organisation={org} />
        )}
        <StudioContact studio={org} />
        <GuestForms token={token} view={view} onChange={setView} />
        <GuestFeedback token={token} view={view} onChange={setView} />
        <GuestReview view={view} />
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
        {cancellation.available ? (
          <section className="visit-plans" aria-labelledby="plans-heading">
            <h2 id="plans-heading">Need to change your plans?</h2>
            <GuestMove
              token={token}
              view={view}
              cutoff={cutoff}
              busy={confirming || saving}
              onMoved={(next) => {
                setView(next)
                setMoved(true)
                setDone(false)
                setError('')
              }}
              onUnsure={setUnsureMove}
              onRefresh={() => void load().catch(() => null)}
            />
            <div className="visit-plan">
              {confirming ? (
                <div className="guest-confirm">
                  <p>{words.confirm}</p>
                  <div className="guest-actions">
                    <Button disabled={saving} onClick={() => void cancel()}>
                      {saving ? 'Cancelling…' : 'Yes, cancel my visit'}
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={saving}
                      onClick={() => setConfirming(false)}
                    >
                      Keep my visit
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <p>{words.before}</p>
                  <Button
                    variant="secondary"
                    disabled={unsureMove}
                    onClick={() => setConfirming(true)}
                  >
                    Cancel this visit
                  </Button>
                </>
              )}
              <ErrorMessage error={error} />
            </div>
          </section>
        ) : (
          (visit.status === 'confirmed' ||
            visit.status === 'arrived' ||
            visit.status === 'no_show') && (
            <p className="visit-locked">
              {visit.status === 'confirmed'
                ? 'This visit has started, so it can no longer be changed online.'
                : 'This visit can no longer be changed online.'}{' '}
              Contact the studio if you need help.
            </p>
          )
        )}
        {!done && <GuestWaitlist token={token} view={view} onChange={setView} />}
        {view.bookAgain && (
          <section className="visit-again" aria-labelledby="again-heading">
            <h2 id="again-heading">Would you like another time?</h2>
            <p className="subtle">
              Choose a new time for {visit.serviceName} on {org.name}’s booking page.
            </p>
            <a className="button button-primary" href={view.bookAgain.path}>
              <CalendarPlus size={16} aria-hidden="true" />
              Book again
            </a>
          </section>
        )}
        <GuestEmailNews token={token} view={view} onChange={setView} />
        <p className="guest-footnote">This link is private to you; please keep it to yourself.</p>
      </section>
      <span className="wordmark visit-wordmark">SALEANE</span>
    </main>
  )
}
