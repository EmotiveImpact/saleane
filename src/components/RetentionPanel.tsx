import { useStore } from '../state/context'
import { retention } from '../domain/retention'
import type { Rate } from '../domain/retention'
import { dateLabel } from '../domain/format'
import { Avatar, Metric } from '../design'
import './retention.css'

const NOT_ENOUGH = 'Not enough visits yet'
const percent = (figure: Rate) =>
  figure.rate === null ? (
    <span className="retention-none">{NOT_ENOUGH}</span>
  ) : (
    `${Math.round(figure.rate * 100)}%`
  )

/**
 * Who comes back: rebooking by professional, new-client return, returning clients and lapsed
 * clients for the Business page's chosen period. Every figure states how it is measured.
 */
export function RetentionPanel({ days }: { days: number }) {
  const { state, today } = useStore()
  const r = retention(state, days, today)
  const locale = state.organisation.locale
  const previous = `${dateLabel(r.previousFrom, locale, true)} to ${dateLabel(r.previousTo, locale, true)}`
  return (
    <section className="surface retention-panel" aria-labelledby="retention-title">
      <header>
        <h2 id="retention-title">Who comes back</h2>
        <p>Return visits for the last {days} days, counted from completed and booked visits.</p>
      </header>
      <div className="retention-figures">
        <Metric
          label="New-client return"
          value={percent(r.newClientReturn)}
          detail={
            r.newClientReturn.of
              ? `${r.newClientReturn.count} of ${r.newClientReturn.of} clients whose first completed visit was in this period have come back or booked again.`
              : 'Of clients whose first completed visit was in this period, the share who have come back or booked again.'
          }
          definition={
            <>
              <p>
                Clients whose first ever completed visit falls in this period. They count as
                returned when a later visit is completed, or is booked and still ahead. Cancelled
                and missed visits do not count.
              </p>
              <p>Clients first seen near the end of the period have had less time to return.</p>
            </>
          }
        />
        <Metric
          label="Returning clients"
          value={percent(r.returningClients)}
          detail={
            r.returningClients.of
              ? `${r.returningClients.count} of ${r.returningClients.of} clients seen ${previous} have been seen again or have a visit booked.`
              : `Of clients seen ${previous}, the share seen again since or with a visit booked.`
          }
          definition={
            <p>
              Clients with a completed visit in the {days} days before this period ({previous}).
              They count as returning when they have a completed visit in this period, or a visit
              booked and still ahead.
            </p>
          }
        />
        <Metric
          label="Lapsed clients"
          value={r.lapsedClients}
          detail="Away for more than one and a half times their usual gap between visits, with nothing booked."
          definition={
            <p>
              Clients with completed visits on at least two different days and no visit booked
              ahead. Their usual gap is the middle value of the gaps between their visits. They
              count as lapsed once the time since their last visit is more than one and a half times
              that gap. This does not depend on the chosen period.
            </p>
          }
        />
      </div>
      <div className="retention-table-wrap">
        <table className="retention-table">
          <caption>
            Recorded rebooking by professional
            <small>
              Completed visits in this period linked to a next visit from checkout, the same measure
              as the studio figure above.
            </small>
          </caption>
          <thead>
            <tr>
              <th scope="col">Professional</th>
              <th scope="col">Completed visits</th>
              <th scope="col">Linked to a next visit</th>
              <th scope="col">Rebooking</th>
            </tr>
          </thead>
          <tbody>
            {r.byPractitioner.map((row) => (
              <tr key={row.staff.id}>
                <th scope="row">
                  <span className="retention-person">
                    <Avatar
                      small
                      identity={row.staff.id}
                      name={row.staff.name}
                      tone={row.staff.tone}
                    />
                    {row.staff.name}
                  </span>
                </th>
                <td>{row.of}</td>
                <td>{row.count}</td>
                <td>{percent(row)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!r.byPractitioner.length && <p className="retention-empty">{NOT_ENOUGH}.</p>}
      </div>
    </section>
  )
}
