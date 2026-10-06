import { useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarClock, History } from 'lucide-react'
import type { BusinessState } from '../domain/model'
import { describeVisit } from '../domain/schedule'
import type { AffectedVisit, ScheduleChange } from '../domain/schedule'
import { Button } from '../design'

const SHOWN = 8

/** LOCAL-04: names the upcoming visits a change would strand, linked to each one in the calendar. */
export function AffectedVisits({ visits, locale }: { visits: AffectedVisit[]; locale: string }) {
  if (!visits.length) return null
  const one = visits.length === 1
  return (
    <div className="ops-impact" role="status">
      <CalendarClock size={19} aria-hidden="true" />
      <div>
        <strong>
          {one
            ? 'This upcoming visit would be affected'
            : `These ${visits.length} upcoming visits would be affected`}
        </strong>
        <p>
          Move or cancel {one ? 'it' : 'them'} in the calendar first, then save this change. SALEANE
          never moves or cancels a booked visit for you.
        </p>
        <ul>
          {visits.slice(0, SHOWN).map((visit) => (
            <li key={visit.appointmentId}>
              <Link to={`/calendar?date=${visit.date}&appointment=${visit.appointmentId}`}>
                {describeVisit(visit, locale)}
              </Link>
              <small>
                {visit.serviceName ? `${visit.serviceName}. ` : ''}
                {visit.reason}.
              </small>
            </li>
          ))}
        </ul>
        {visits.length > SHOWN && <p>And {visits.length - SHOWN} more.</p>}
      </div>
    </div>
  )
}

/** Who changed hours, time away, professionals and rooms, newest first. */
export function ScheduleHistory({
  entries,
  organisation,
}: {
  entries: ScheduleChange[]
  organisation: BusinessState['organisation']
}) {
  const [shown, setShown] = useState(10)
  const latest = [...entries].reverse()
  const when = new Intl.DateTimeFormat(organisation.locale, {
    timeZone: organisation.timeZone,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
  return (
    <section className="surface ops-panel" aria-labelledby="schedule-history-title">
      <header>
        <div>
          <h2 id="schedule-history-title">Schedule history</h2>
          <p>
            Every change to opening hours, working hours, time away, professionals and rooms. Booked
            visits keep their original times and terms.
          </p>
        </div>
        <History size={21} aria-hidden="true" />
      </header>
      {latest.length ? (
        <ol className="ops-history">
          {latest.slice(0, shown).map((entry) => (
            <li className="ops-record" key={entry.id}>
              <div className="ops-record-copy">
                <p>{entry.summary}</p>
                <small>
                  {entry.actor} ·{' '}
                  <time dateTime={entry.occurredAt}>{when.format(new Date(entry.occurredAt))}</time>
                </small>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="ops-help">
          No schedule changes recorded yet. Changes saved from now on are listed here.
        </p>
      )}
      {latest.length > shown && (
        <div className="ops-actions">
          <Button variant="secondary" onClick={() => setShown((count) => count + 20)}>
            Show earlier changes
          </Button>
        </div>
      )}
    </section>
  )
}
