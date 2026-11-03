import { useRef } from 'react'
import type { Staff } from '../domain/model'
import { staffDay } from '../domain/selectors'
import { timeLabel } from '../domain/format'
import { useStore } from '../state/context'
import { Avatar, Status } from '../design'
import { pauses } from '../domain/moments'
import './moments.css'

function duration(minutes: number) {
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return [hours ? `${hours} h` : '', rest ? `${rest} min` : ''].filter(Boolean).join(' ') || '0 min'
}

/**
 * The narrow-screen calendar: one swipeable column per professional, with
 * free time written between visits so it is clear who can take a guest.
 */
export function PeopleColumns({
  staff,
  date,
  selectedId,
  onOpen,
  onBook,
  notBefore = 0,
}: {
  staff: Staff[]
  date: string
  selectedId?: string
  onOpen: (id: string) => void
  /** When given, free time becomes a button that starts a booking at that time. */
  onBook?: (staffId: string, startMinutes: number) => void
  /** Free time that has already passed today stays visible but cannot start a booking. */
  notBefore?: number
}) {
  const { state } = useStore()
  const columns = useRef<HTMLDivElement | null>(null)
  const locale = state.organisation.locale
  const days = staff.map((person) => ({ person, day: staffDay(state, person.id, date) }))
  return (
    <div className="people-calendar">
      <div className="people-summary" aria-label="Jump to a professional">
        {days.map(({ person, day }) => (
          <button
            key={person.id}
            type="button"
            onClick={() =>
              columns.current
                ?.querySelector(`[data-person="${person.id}"]`)
                ?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' })
            }
          >
            <Avatar small identity={person.id} name={person.name} tone={person.tone} />
            <span>
              <strong>{person.name.split(' ')[0]}</strong>
              <small>{day.working ? `${duration(day.freeMinutes)} free` : 'Not working'}</small>
            </span>
          </button>
        ))}
      </div>
      <div className="people-columns" ref={columns}>
        {days.map(({ person, day }) => (
          <section
            className="person-column"
            key={person.id}
            data-person={person.id}
            aria-labelledby={`person-${person.id}`}
          >
            <header>
              <Avatar small identity={person.id} name={person.name} tone={person.tone} />
              <span>
                <strong id={`person-${person.id}`}>{person.name}</strong>
                <small>
                  {day.working
                    ? `${day.visits} ${day.visits === 1 ? 'visit' : 'visits'} · ${duration(day.freeMinutes)} free`
                    : 'Not working today'}
                </small>
              </span>
            </header>
            <ol>
              {day.segments.map((segment) => {
                const from = timeLabel(segment.from, locale)
                const to = timeLabel(segment.to, locale)
                // Stage 6: free time between two of their visits reads as a pause; it books the same.
                const pause = segment.kind === 'free' && pauses(day.segments).has(segment.from)
                if (segment.kind === 'free')
                  return (
                    <li
                      className={`person-free${pause ? ' person-pause' : ''}`}
                      key={`free-${segment.from}`}
                    >
                      {pause && (
                        <span className="person-pause-label" aria-hidden="true">
                          A pause
                        </span>
                      )}
                      {onBook && segment.to - Math.max(segment.from, notBefore) >= 15 ? (
                        <button
                          type="button"
                          onClick={() => onBook(person.id, Math.max(segment.from, notBefore))}
                        >
                          <span className="sr-only">Book with {person.name}, </span>
                          <span>
                            Free {from} to {to}
                          </span>
                          <small>
                            {duration(segment.to - segment.from)} <span aria-hidden>· Book</span>
                          </small>
                        </button>
                      ) : (
                        <>
                          <span>
                            Free {from} to {to}
                          </span>
                          <small>{duration(segment.to - segment.from)}</small>
                        </>
                      )}
                    </li>
                  )
                if (segment.kind === 'closed')
                  return (
                    <li className="person-closed" key={`closed-${segment.from}`}>
                      <span>
                        Unavailable {from} to {to}
                      </span>
                      <small>{segment.reason}</small>
                    </li>
                  )
                const a = segment.appointment
                const client = state.clients.find((c) => c.id === a.clientId)!
                const service = state.services.find((s) => s.id === a.serviceId)!
                return (
                  <li key={a.id}>
                    <button
                      className={`person-visit tone-${person.tone}`}
                      data-selected={selectedId === a.id ? '' : undefined}
                      aria-haspopup="dialog"
                      aria-expanded={selectedId === a.id}
                      onClick={() => onOpen(a.id)}
                    >
                      <span className="person-visit-time">
                        {timeLabel(a.startMinutes, locale)}{' '}
                        <small>{a.bookedDurationMinutes} min</small>
                      </span>{' '}
                      <span className="person-visit-body">
                        <strong>{client.name}</strong> <small>{service.name}</small>
                      </span>{' '}
                      <Status status={a.status} />
                    </button>
                  </li>
                )
              })}
              {day.working && !day.segments.length && (
                <li className="person-free">
                  <span>Free all day</span>
                </li>
              )}
            </ol>
          </section>
        ))}
      </div>
    </div>
  )
}
