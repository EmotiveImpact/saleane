import { useState } from 'react'
import { Hourglass, Plus } from 'lucide-react'
import { useStore } from '../state/context'
import { useClock } from '../state/clock'
import { feedbackSince } from '../domain/feedback'
import { wholeMoney } from '../domain/format'
import { waiting, waitlistSummary } from '../domain/waitlist'
import { Button, Empty, MovingList, PageHeader, Stat, Stats, photos } from '../design'
import { PassOnOffers, WaitlistCard, WaitlistForm } from '../components/Waitlist'
import { CancelledTimes } from '../components/CancelledTimes'
import { QuietOffers } from '../components/QuietOffers'
import { freedSummary, freedTimes } from '../domain/cancelledTimes'
import { can } from '../domain/operations'
import '../components/management.css'
import '../components/waitlist.css'

/**
 * V1.5: everyone waiting for a time, with the openings that would suit them read live from the
 * diary. A cancellation shows here at once as a time someone could take. NEXT-11: above them, the
 * times cancellations left free, with guests who might like each one.
 */
export function Waitlist() {
  const { state, role, blocked } = useStore()
  const allowed = !blocked && can(role, 'waitlist-add')
  const [adding, setAdding] = useState(false)
  // Requests whose dates pass drop off an open page without waiting for another change.
  const clock = useClock()
  if (role === 'practitioner')
    return (
      <div className="waitlist-page">
        <PageHeader variant="compact" eyebrow="Waitlist" title="Who would take a time." />
        <Empty title="For the desk">
          The front desk, managers and owners look after the waitlist.
        </Empty>
      </div>
    )
  const since = feedbackSince(state, 30)
  const summary = waitlistSummary(state, since, clock)
  const rows = waiting(state, clock).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  // Before anyone has used the list or a cancellation has left a time free, one welcoming page
  // replaces three figures at zero and two empty panels.
  const unused =
    !rows.length &&
    !summary.filled &&
    !freedTimes(state, clock).length &&
    !freedSummary(state, since).freed
  const add = allowed && (
    <Button onClick={() => setAdding(true)}>
      <Plus size={16} aria-hidden="true" /> Add to the waitlist
    </Button>
  )
  return (
    <div className="waitlist-page">
      {unused ? (
        <Empty
          photo={photos.waitlist}
          photoPosition="center 40%"
          eyebrow="Waitlist"
          level={1}
          title="Nobody is waiting yet."
          action={add}
        >
          Add a guest who wants a time that is full. When one opens that suits them, it appears here
          for you to offer.
        </Empty>
      ) : (
        <>
          <PageHeader
            variant="compact"
            photo={{ src: photos.waitlist, position: 'center 26%' }}
            eyebrow="Waitlist"
            title="Who would take a time."
            description="When a time opens that suits someone, it appears beside their name. Nobody is contacted by itself."
            actions={add}
          />
          <Stats>
            <Stat label="Waiting now" value={summary.waiting} />
            <Stat label="Times filled from the list, last 30 days" value={summary.filled} />
            <Stat
              label="Value of those visits"
              value={wholeMoney(summary.valueMinor, state.organisation)}
            />
          </Stats>
          <CancelledTimes />
          <PassOnOffers />
          <section className="surface ops-panel" aria-labelledby="waiting-heading">
            <header>
              <div>
                <h2 id="waiting-heading">Waiting</h2>
                <p>Longest waiting first. Times are checked against the diary as you look.</p>
              </div>
              <Hourglass size={21} aria-hidden="true" />
            </header>
            {rows.length ? (
              <ul className="waitlist-cards">
                <MovingList>
                  {rows.map((entry) => (
                    <WaitlistCard key={entry.id} entry={entry} />
                  ))}
                </MovingList>
              </ul>
            ) : (
              <Empty title="Nobody is waiting">
                Add someone who wants a time that is full, or guests can ask from their own visit
                page.
              </Empty>
            )}
          </section>
          {/* A quiet time's lower price is offered from here, so it sits with the times it fills. */}
          <QuietOffers />
        </>
      )}
      {adding && <WaitlistForm onClose={() => setAdding(false)} />}
    </div>
  )
}
