import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Check, Leaf } from 'lucide-react'
import { useStore } from '../state/context'
import { clientInsight } from '../domain/clientInsight'
import type { BookingSuggestion, NextStep } from '../domain/clientInsight'
import type { Client } from '../domain/model'
import { can } from '../domain/operations'
import { staffLocationOn } from '../domain/locations'
import { Button, Definition } from '../design'
import { BookingDialog } from './BookingDialog'
import type { BookingDefaults } from './BookingDialog'
import { insightLines, insightSummary, invitationDraft, stepWords } from './clientInsightWords'
import './clientInsight.css'

/**
 * "At a glance" on the client page: a sentence about the client, a few facts worth knowing at the
 * desk, and one suggested next step. Everything is read from the studio record (clientInsight.ts).
 * Nothing is sent or changed from here: a step opens the booking dialog, a part of this page, or
 * an invitation the person saves as an unsent draft for the Inbox.
 *
 * Everyone who reaches this page (owners, managers, general managers and reception) already sees
 * what the client spends in the heading and on each receipt, so the spending line follows that.
 * A general manager reads the whole client record, every location's visits and receipts included
 * (branchView), so their figures are the same as everyone else's.
 */
export function ClientInsight({ client }: { client: Client }) {
  const { state, today, role, blocked, saving, commit, branch } = useStore()
  const [booking, setBooking] = useState<BookingDefaults | null>(null)
  const [drafting, setDrafting] = useState(false)
  const [savedDraft, setSavedDraft] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  // The studio record changes on every save, so the work is kept until it does.
  const insight = useMemo(() => clientInsight(state, client, today), [state, client, today])
  const seesMoney = role !== 'practitioner' && role !== 'regional'
  const locale = state.organisation.locale
  const summary = insightSummary(insight, locale)
  const lines = insightLines(state, insight, today, { money: seesMoney })
  const step = atTheirLocation(insight.next)
  const words = step ? stepWords(state, step, today, { money: seesMoney }) : null
  const busy = pending || saving

  /**
   * A general manager books at their own location, so a favourite professional who works
   * elsewhere that day is left out of the suggestion for them to choose someone.
   */
  function atTheirLocation(next: NextStep | null): NextStep | null {
    if (!next || !('booking' in next) || role !== 'general' || !branch) return next
    const { staffId, ...rest } = next.booking
    if (!staffId || staffLocationOn(state, staffId, next.booking.date) === branch) return next
    return { ...next, booking: rest }
  }

  function book(suggestion: BookingSuggestion) {
    setBooking({
      clientId: client.id,
      date: suggestion.date,
      ...(suggestion.serviceId ? { serviceId: suggestion.serviceId } : {}),
      ...(suggestion.staffId ? { staffId: suggestion.staffId } : {}),
      ...(suggestion.startMinutes !== undefined ? { startMinutes: suggestion.startMinutes } : {}),
    })
  }

  async function saveInvitation(next: Extract<NextStep, { kind: 'invite-back' }>) {
    if (busy || blocked || !can(role, 'message')) return
    setPending(true)
    setError('')
    try {
      const result = await commit({
        type: 'message',
        input: {
          clientId: client.id,
          purpose: 'marketing',
          ...invitationDraft(state, client, next),
        },
      })
      if (!result.ok) {
        setError(result.error)
        return
      }
      setDrafting(false)
      setSavedDraft(true)
    } catch {
      setError('The invitation could not be saved. Nothing was sent; try again.')
    } finally {
      setPending(false)
    }
  }

  /** Brings a part of this page into view, such as the patch tests, and moves focus to it. */
  function goTo(headingId: string) {
    const heading = document.getElementById(headingId)
    const section = heading?.closest('section') ?? heading
    if (!section) return
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    section.scrollIntoView?.({ behavior: still ? 'auto' : 'smooth', block: 'start' })
    if (!section.hasAttribute('tabindex')) section.setAttribute('tabindex', '-1')
    section.focus({ preventScroll: true })
  }

  function action() {
    if (!step) return null
    const may = (what: string) => !blocked && can(role, what)
    switch (step.kind) {
      case 'membership-unpaid':
        return may('plan-renew') ? (
          <Button variant="secondary" onClick={() => goTo('client-plans-heading')}>
            Go to memberships
          </Button>
        ) : null
      case 'invite-back':
        // One invitation at a time: once written, the Inbox is where it is approved.
        if (savedDraft || step.invited) return null
        if (step.consent && may('message'))
          return drafting ? null : (
            <Button
              variant="secondary"
              onClick={() => {
                setError('')
                setDrafting(true)
              }}
            >
              Invite them back
            </Button>
          )
        return may('book') ? (
          <Button variant="secondary" disabled={busy} onClick={() => book(step.booking)}>
            {step.booking.usual ? 'Book their usual' : 'Book their next visit'}
            <ArrowRight size={16} aria-hidden="true" />
          </Button>
        ) : null
      case 'book-usual':
        return may('book') ? (
          <Button variant="secondary" disabled={busy} onClick={() => book(step.booking)}>
            {step.booking.usual ? 'Book their usual' : 'Book their next visit'}
            <ArrowRight size={16} aria-hidden="true" />
          </Button>
        ) : null
      case 'patch-test':
        return may('patch-test') ? (
          <Button variant="secondary" onClick={() => goTo('client-patch-tests')}>
            Go to patch tests
          </Button>
        ) : null
      case 'mention-membership':
        return may('plan-sell') ? (
          <Button variant="secondary" onClick={() => goTo('client-plans-heading')}>
            Go to memberships
          </Button>
        ) : null
    }
  }

  return (
    <section className="surface client-insight" aria-labelledby="client-insight-title">
      <div className="client-insight-heading">
        <h2 id="client-insight-title">At a glance</h2>
        <span className="client-insight-source">
          <Leaf size={14} aria-hidden="true" />
          From their visits and receipts
        </span>
      </div>
      {summary && <p className="client-insight-summary">{summary}</p>}
      {lines.length > 0 && (
        <dl className="client-insight-facts" data-count={lines.length}>
          {lines.map((line) => (
            <div key={line.id} className="client-insight-fact">
              <dt>
                {line.label}
                {line.definition && <Definition label={line.label}>{line.definition}</Definition>}
              </dt>
              <dd className="client-insight-value">{line.value}</dd>
              {line.detail && <dd className="client-insight-detail">{line.detail}</dd>}
            </div>
          ))}
        </dl>
      )}
      {step && words && (
        <div
          className="client-insight-step"
          role="group"
          aria-labelledby="client-insight-step-title"
        >
          <div className="client-insight-step-copy">
            <p className="eyebrow">Next step</p>
            <h3 id="client-insight-step-title">{words.title}</h3>
            <p>{words.detail}</p>
          </div>
          <div className="client-insight-step-action">{action()}</div>
          {step.kind === 'invite-back' && drafting && (
            <div className="client-insight-draft">
              <p>{invitationDraft(state, client, step).body}</p>
              <small>
                Saved, it waits in the Inbox unsent. You can change it there, and nothing goes until
                someone approves it.
              </small>
              <div>
                <Button disabled={busy || blocked} onClick={() => void saveInvitation(step)}>
                  {busy ? 'Saving…' : 'Save as unsent draft'}
                </Button>
                <Button variant="quiet" disabled={busy} onClick={() => setDrafting(false)}>
                  Not now
                </Button>
              </div>
            </div>
          )}
          {step.kind === 'invite-back' && (savedDraft || step.invited) && (
            <p role="status" className="client-insight-saved">
              <Check size={14} aria-hidden="true" />
              {savedDraft
                ? 'Invitation saved in the Inbox, unsent.'
                : step.invited === 'draft'
                  ? 'An invitation is waiting in the Inbox, unsent.'
                  : 'An invitation was approved in the Inbox since their last visit.'}{' '}
              <Link to="/inbox">Open the Inbox</Link>
            </p>
          )}
          {error && (
            <p role="alert" className="client-insight-error">
              {error}
            </p>
          )}
        </div>
      )}
      {booking && <BookingDialog defaults={booking} onClose={() => setBooking(null)} />}
    </section>
  )
}
