import { useState } from 'react'
import { leads } from '../domain/operations'
import { Link } from 'react-router-dom'
import { MessageSquareQuote, Star } from 'lucide-react'
import { useStore } from '../state/context'
import { feedbackDay, feedbackList, feedbackSince, feedbackSummary } from '../domain/feedback'
import { dateLabel } from '../domain/format'
import { Avatar, Empty, PageHeader, SegmentedControl, Stat, Stats } from '../design'
import '../components/management.css'
import '../feedback.css'

const PERIODS = { 30: 'Last 30 days', 90: 'Last 90 days', 0: 'All time' } as const
type Period = keyof typeof PERIODS

const score = (value: number | null) => (value === null ? 'None yet' : `${value.toFixed(1)} / 5`)

/**
 * V1.5: what guests say privately after their visits. Owners and managers only: individual
 * answers never reach reception or practitioners, who see only their own average.
 */
export function Feedback() {
  const { state, role } = useStore()
  const [period, setPeriod] = useState<Period>(90)
  const since = period ? feedbackSince(state, period) : undefined
  if (!leads(role))
    return (
      <div className="feedback-page">
        <PageHeader variant="compact" title="Guest feedback" description="" />
        <Empty title="For owners and managers">
          Guests' private feedback is read by the studio's owner and managers.
        </Empty>
      </div>
    )
  const summary = feedbackSummary(state, since)
  const rows = feedbackList(state)
    .filter((r) => !since || r.createdAt >= since)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const org = state.organisation
  const name = (id: string, list: { id: string; name: string }[]) =>
    list.find((x) => x.id === id)?.name ?? ''
  return (
    <div className="feedback-page">
      <PageHeader
        variant="compact"
        title="What guests tell you."
        description="Private ratings and notes after each visit. Nothing here is published; public reviews stay on your Google page."
      />
      <SegmentedControl
        label="Period"
        className="ops-switch"
        value={String(period) as `${Period}`}
        onChange={(value) => setPeriod(Number(value) as Period)}
        options={(Object.keys(PERIODS) as `${Period}`[]).map((value) => ({
          value,
          label: PERIODS[Number(value) as Period],
        }))}
      />
      <Stats className="feedback-totals">
        <Stat label="Visits rated" value={summary.count} />
        <Stat label="The visit" value={score(summary.visitAverage)} />
        <Stat label="How guests were looked after" value={score(summary.practitionerAverage)} />
      </Stats>
      <div className="feedback-layout">
        <section className="surface ops-panel" aria-labelledby="by-person">
          <header>
            <div>
              <h2 id="by-person">By professional</h2>
              <p>
                Each professional sees only their own average, once three guests have rated them.
              </p>
            </div>
            <Star size={21} aria-hidden="true" />
          </header>
          <div className="ops-ledger">
            {summary.byStaff.map(({ staff, count, average }) => (
              <div className="ops-record" key={staff.id}>
                <Avatar identity={staff.id} name={staff.name} />
                <div className="ops-record-copy">
                  <strong>{staff.name}</strong>
                  <small>
                    {count} {count === 1 ? 'rating' : 'ratings'}
                  </small>
                </div>
                <span className="ops-record-money">{score(average)}</span>
              </div>
            ))}
          </div>
        </section>
        <section className="surface ops-panel" aria-labelledby="recent">
          <header>
            <div>
              <h2 id="recent">Latest answers</h2>
              <p>Newest first. A guest can answer once, within a week of their visit.</p>
            </div>
            <MessageSquareQuote size={21} aria-hidden="true" />
          </header>
          {rows.length ? (
            <ol className="feedback-list">
              {rows.map((row) => {
                const visit = state.appointments.find((a) => a.id === row.appointmentId)
                return (
                  <li key={row.id}>
                    <p className="feedback-meta">
                      <Link to={`/clients/${row.clientId}`}>
                        {name(row.clientId, state.clients)}
                      </Link>
                      {' · '}
                      {visit?.bookedServiceName ?? 'Visit'} with {name(row.staffId, state.staff)}
                      {' · '}
                      {dateLabel(feedbackDay(state, row.createdAt), org.locale)}
                    </p>
                    <p className="feedback-scores">
                      Visit {row.visitRating} / 5 · Looked after {row.practitionerRating} / 5
                    </p>
                    {row.comment && <blockquote>{row.comment}</blockquote>}
                  </li>
                )
              })}
            </ol>
          ) : (
            <Empty title="No answers yet">
              After checkout, guests get a private “how was your visit?” email with their visit
              link.
            </Empty>
          )}
        </section>
      </div>
    </div>
  )
}
