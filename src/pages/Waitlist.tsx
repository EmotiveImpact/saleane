import { useState } from 'react'
import { Hourglass, Plus } from 'lucide-react'
import { useStore } from '../state/context'
import { useClock } from '../state/clock'
import { feedbackSince } from '../domain/feedback'
import { wholeMoney } from '../domain/format'
import { waiting, waitlistSummary } from '../domain/waitlist'
import { Button, Empty, PageHeader, Stat, Stats, photos } from '../design'
import { PassOnOffers, WaitlistCard, WaitlistForm } from '../components/Waitlist'
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
  const summary = waitlistSummary(state, feedbackSince(state, 30), clock)
  const rows = waiting(state, clock).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  // Before anyone has used the list, one welcoming page replaces three figures at zero.
  const unused = !rows.length && !summary.filled
  const add = allowed && (
    <Button onClick={() => setAdding(true)}>
      <Plus size={16} aria-hidden="true" /> Add to the waitlist
    </Button>
  )
  return (
    <div className="waitlist-page">
      <PageHeader
        variant="compact"
        photo={unused ? undefined : { src: photos.tea, position: 'center 58%' }}
        eyebrow="Waitlist"
        title="Who would take a time."
        description="When a time opens that suits someone, it appears beside their name. Nobody is contacted by itself."
        actions={unused ? undefined : add}
      />
      {unused ? (
        <Empty photo={photos.tea} level={2} title="Nobody is waiting yet." action={add}>
          Add a guest who wants a time that is full, and a time that suits them appears here the
          moment one opens.
        </Empty>
      ) : (
        <>
          <Stats>
            <Stat label="Waiting now" value={summary.waiting} />
            <Stat label="Times filled from the list, last 30 days" value={summary.filled} />
            <Stat
              label="Value of those visits"
              value={wholeMoney(summary.valueMinor, state.organisation)}
            />
          </Stats>
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
                {rows.map((entry) => (
                  <WaitlistCard key={entry.id} entry={entry} />
                ))}
              </ul>
            ) : (
              <Empty title="Nobody is waiting">
                Add someone who wants a time that is full, or guests can ask from their own visit
                page.
              </Empty>
            )}
          </section>
        </>
      )}
      {adding && <WaitlistForm onClose={() => setAdding(false)} />}
    </div>
  )
}
