import { useState } from 'react'
import { Hourglass, Plus } from 'lucide-react'
import { useStore } from '../state/context'
import { feedbackSince } from '../domain/feedback'
import { money } from '../domain/format'
import { waiting, waitlistSummary } from '../domain/waitlist'
import { Button, Empty, PageHeader } from '../design'
import { WaitlistCard, WaitlistForm } from '../components/Waitlist'
import { can } from '../domain/operations'
import '../components/management.css'
import '../components/waitlist.css'

/**
 * V1.5: everyone waiting for a time, with the openings that would suit them read live from the
 * diary. A cancellation shows here at once as a time someone could take.
 */
export function Waitlist() {
  const { state, role, blocked } = useStore()
  const allowed = !blocked && can(role, 'waitlist-add')
  const [adding, setAdding] = useState(false)
  if (role === 'practitioner')
    return (
      <div className="waitlist-page">
        <PageHeader variant="compact" title="Waitlist" description="" />
        <Empty title="For the desk">
          The front desk, managers and owners look after the waitlist.
        </Empty>
      </div>
    )
  const summary = waitlistSummary(state, feedbackSince(state, 30))
  const rows = waiting(state).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  return (
    <div className="waitlist-page">
      <PageHeader
        variant="compact"
        title="Who would take a time."
        description="When a time opens that suits someone, it appears beside their name. Book it, move their visit, or write them an offer to approve. Nobody is contacted by itself."
      />
      <dl className="plans-totals waitlist-totals">
        <div>
          <dt>Waiting now</dt>
          <dd>{summary.waiting}</dd>
        </div>
        <div>
          <dt>Times filled from the list, last 30 days</dt>
          <dd>{summary.filled}</dd>
        </div>
        <div>
          <dt>Value of those visits</dt>
          <dd>{money(summary.valueMinor, state.organisation, true)}</dd>
        </div>
      </dl>
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
            {rows.map((entry) => (
              <WaitlistCard key={entry.id} entry={entry} />
            ))}
          </ul>
        ) : (
          <Empty title="Nobody is waiting">
            Add someone who wants a time that is full, or guests can ask from their own visit page.
          </Empty>
        )}
        {allowed && (
          <div className="ops-actions">
            <Button onClick={() => setAdding(true)}>
              <Plus size={16} aria-hidden="true" /> Add to the waitlist
            </Button>
          </div>
        )}
      </section>
      {adding && <WaitlistForm onClose={() => setAdding(false)} />}
    </div>
  )
}
