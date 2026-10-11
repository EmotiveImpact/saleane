import type { CSSProperties } from 'react'
import { ChevronRight } from 'lucide-react'
import { useStore } from '../state/context'
import { dayAppointments, shownStatus } from '../domain/selectors'
import { addDays, dateLabel, timeLabel } from '../domain/format'
import { Status, Tip } from '../design'
import { shownHours, sideBySide, weekSpan, weekStart } from './calendarDays'
import './calendarWeek.css'

/** Positions on the timeline, in minutes from its start; the stylesheet turns them into height. */
const place = (values: Record<string, number>) =>
  Object.fromEntries(
    Object.entries(values).map(([key, value]) => [`--${key}`, value]),
  ) as CSSProperties

const visitCount = (count: number) =>
  count === 0 ? 'No visits' : `${count} ${count === 1 ? 'visit' : 'visits'}`

/**
 * Seven days side by side on one timeline, so the shape of the week shows at a glance. Each visit
 * sits at its time with the same chip as the day view, and visits at the same time sit side by
 * side. On a phone the same days read as a list, one after another. A day opens its timeline; a
 * visit opens its details.
 */
export function CalendarWeek({
  date,
  staffFilter,
  locationFilter,
  selectedId,
  now,
  onOpen,
  onDay,
}: {
  date: string
  staffFilter: string
  locationFilter: string
  selectedId: string
  /** Minutes since midnight in the studio, for the line that marks now on today. */
  now: number
  onOpen: (id: string) => void
  onDay: (date: string) => void
}) {
  const { state, today } = useStore()
  const locale = state.organisation.locale
  const monday = weekStart(date)
  const weekday = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' })
  const dayMonth = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  })
  const days = Array.from({ length: 7 }, (_, i) => {
    const day = addDays(monday, i)
    return {
      day,
      hours: shownHours(state, day, locationFilter),
      visits: dayAppointments(state, day).filter(
        (a) =>
          (staffFilter === 'all' || a.staffId === staffFilter) &&
          (locationFilter === 'all' || a.locationId === locationFilter),
      ),
    }
  })
  const { start, end } = weekSpan(days)
  const hourCount = (end - start) / 60
  // The hours down the side, kept short: 09:00, or 9 AM where the clock has twelve hours.
  const hour = new Intl.DateTimeFormat(locale, { hour: 'numeric', hour12: true, timeZone: 'UTC' })
  const hourLabel = (minutes: number) =>
    locale === 'en-US'
      ? hour.format(new Date(Date.UTC(2026, 0, 1, 0, minutes)))
      : timeLabel(minutes, locale)
  return (
    <div className="week-grid" style={place({ minutes: end - start })}>
      <div className="week-corner" aria-hidden="true" />
      <div className="week-axis" aria-hidden="true">
        {Array.from({ length: hourCount + 1 }, (_, i) => (
          <span key={i} style={place({ at: i * 60 })}>
            {hourLabel(start + i * 60)}
          </span>
        ))}
      </div>
      {days.map(({ day, hours, visits }) => {
        const when = new Date(`${day}T00:00:00Z`)
        const closed = hours.closed && !visits.length
        const layout = sideBySide(visits)
        return (
          <section
            key={day}
            className={`week-column ${day === today ? 'is-today' : ''} ${closed ? 'is-closed' : ''}`}
            aria-label={dateLabel(day, locale)}
          >
            <button type="button" className="week-head" onClick={() => onDay(day)}>
              <span>{weekday.format(when)}</span>
              <strong>{dayMonth.format(when)}</strong>
              <small>{closed ? 'Closed' : visitCount(visits.length)}</small>
              <ChevronRight size={16} aria-hidden="true" />
            </button>
            <div className="week-lane">
              {/* The hours either side of this day's opening, shaded, when the week runs longer. */}
              {!hours.closed && hours.open > start && (
                <div
                  className="week-shut"
                  style={place({ from: 0, length: hours.open - start })}
                  aria-hidden="true"
                />
              )}
              {!hours.closed && hours.close < end && (
                <div
                  className="week-shut"
                  style={place({ from: hours.close - start, length: end - hours.close })}
                  aria-hidden="true"
                />
              )}
              {day === today && now >= start && now <= end && (
                <div className="now-line" style={place({ from: now - start })} aria-hidden="true" />
              )}
              {visits.length > 0 && (
                <ol>
                  {visits.map((a) => {
                    const client = state.clients.find((c) => c.id === a.clientId)!
                    const person = state.staff.find((p) => p.id === a.staffId)!
                    const service = state.services.find((item) => item.id === a.serviceId)!
                    const { column, columns: across } = layout.get(a.id)!
                    const time = timeLabel(a.startMinutes, locale)
                    const until = timeLabel(a.startMinutes + a.bookedDurationMinutes, locale)
                    const [firstName, ...surname] = client.name.split(' ')
                    return (
                      <li
                        key={a.id}
                        className="calendar-event-wrap week-slot"
                        style={place({
                          from: a.startMinutes - start,
                          length: a.bookedDurationMinutes,
                          column,
                          across,
                        })}
                      >
                        <Tip
                          label={`${time} to ${until}, ${client.name}, ${service.name} with ${person.name}`}
                        >
                          <button
                            type="button"
                            className={`calendar-event week-event tone-${person.tone} ${a.status === 'completed' ? 'event-completed' : ''}`}
                            data-selected={selectedId === a.id ? '' : undefined}
                            aria-haspopup="dialog"
                            aria-expanded={selectedId === a.id}
                            onClick={() => onOpen(a.id)}
                          >
                            {/* In a narrow chip the person and the surname are left to the
                              screen reader and the tooltip, so the time and first name show. */}
                            <span className="week-event-when">
                              <span>{time}</span>{' '}
                              <span className="week-event-who">{person.name.split(' ')[0]}</span>
                            </span>{' '}
                            <strong>
                              {firstName}
                              {surname.length > 0 && (
                                <>
                                  {' '}
                                  <span className="week-event-surname">{surname.join(' ')}</span>
                                </>
                              )}
                            </strong>{' '}
                            <small>{service.name}</small> <Status status={shownStatus(a)} />
                          </button>
                        </Tip>
                      </li>
                    )
                  })}
                </ol>
              )}
            </div>
          </section>
        )
      })}
    </div>
  )
}
