import { useStore } from '../state/context'
import { dayAppointments } from '../domain/selectors'
import { staffLocationOn } from '../domain/locations'
import { addDays, dateLabel, timeLabel } from '../domain/format'
import { addMonths, shownHours, weekStart } from './calendarDays'
import './calendarMonth.css'

/**
 * The whole month at a glance: how full each day is and its first few visits. On a phone each
 * day shows how many visits it has, and the whole day is one tap to open it.
 * A day opens its timeline; a visit opens its details.
 */
export function CalendarMonth({
  date,
  staffFilter,
  locationFilter,
  selectedId,
  onOpen,
  onDay,
}: {
  date: string
  staffFilter: string
  locationFilter: string
  selectedId: string
  onOpen: (id: string) => void
  onDay: (date: string) => void
}) {
  const { state, today } = useStore()
  const locale = state.organisation.locale
  const month = date.slice(0, 7)
  const first = weekStart(`${month}-01`)
  const weeks = Math.ceil(
    (Date.parse(`${addMonths(date, 1)}T12:00:00Z`) - Date.parse(`${first}T12:00:00Z`)) /
      (7 * 86_400_000),
  )
  const weekday = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' })
  const team = state.staff.filter(
    (s) => !s.archived && (staffFilter === 'all' || s.id === staffFilter),
  )
  // People working at the chosen location that day, for how full the day is.
  const peopleOn = (day: string) =>
    locationFilter === 'all'
      ? team.length
      : team.filter((s) => staffLocationOn(state, s.id, day) === locationFilter).length
  return (
    <div className="month-view">
      <p className="month-hint">Tap a day to open it.</p>
      <div className="month-weekdays" aria-hidden="true">
        {Array.from({ length: 7 }, (_, i) => (
          <span key={i}>{weekday.format(new Date(`${addDays(first, i)}T12:00:00Z`))}</span>
        ))}
      </div>
      <div className="month-grid">
        {Array.from({ length: weeks * 7 }, (_, i) => {
          const day = addDays(first, i)
          const visits = dayAppointments(state, day).filter(
            (a) =>
              (staffFilter === 'all' || a.staffId === staffFilter) &&
              (locationFilter === 'all' || a.locationId === locationFilter),
          )
          const hours = shownHours(state, day, locationFilter)
          const open = hours.closed ? 0 : (hours.close - hours.open) * Math.max(1, peopleOn(day))
          const booked = visits.reduce((sum, a) => sum + a.bookedDurationMinutes, 0)
          const fill = open ? Math.min(1, booked / open) : 0
          const shown = visits.slice(0, 3)
          const closed = hours.closed && !visits.length
          const count = `${visits.length} ${visits.length === 1 ? 'visit' : 'visits'}`
          return (
            <section
              key={day}
              className={`month-day ${day.slice(0, 7) !== month ? 'month-out' : ''} ${day === today ? 'month-today' : ''}`}
              aria-label={dateLabel(day, locale)}
            >
              <button
                type="button"
                className="month-day-head"
                aria-label={`${dateLabel(day, locale)}, ${closed ? 'closed' : visits.length ? count : 'no visits'}`}
                onClick={() => onDay(day)}
              >
                <strong>{Number(day.slice(8))}</strong>
                {closed ? (
                  <small className="month-closed">Closed</small>
                ) : visits.length ? (
                  // On a phone the number stands on its own line above the word.
                  <small className="month-count">
                    <span>{visits.length}</span>{' '}
                    <span>{visits.length === 1 ? 'visit' : 'visits'}</span>
                  </small>
                ) : null}
              </button>
              {!hours.closed && (
                <span className="month-fill" aria-hidden="true">
                  <span style={{ width: `${Math.round(fill * 100)}%` }} />
                </span>
              )}
              <ol>
                {shown.map((a) => {
                  const client = state.clients.find((c) => c.id === a.clientId)!
                  const person = state.staff.find((p) => p.id === a.staffId)!
                  return (
                    <li key={a.id}>
                      <button
                        type="button"
                        className={`month-visit tone-${person.tone}`}
                        data-selected={selectedId === a.id ? '' : undefined}
                        aria-haspopup="dialog"
                        onClick={() => onOpen(a.id)}
                      >
                        {timeLabel(a.startMinutes, locale)} {client.name.split(' ')[0]}
                      </button>
                    </li>
                  )
                })}
              </ol>
              {visits.length > shown.length && (
                <button type="button" className="month-more" onClick={() => onDay(day)}>
                  {visits.length - shown.length} more
                </button>
              )}
            </section>
          )
        })}
      </div>
    </div>
  )
}
