import type { CSSProperties } from 'react'
import { useStore } from '../state/context'
import { availableMinutes, dayAppointments } from '../domain/selectors'
import { hasLocations, placeOf, staffLocationOn } from '../domain/locations'
import { Avatar } from '../design'
import './teamToday.css'

/**
 * Who is working today and how full their day is: a small strip of faces, each ringed by the
 * share of their open hours already booked. The figure is written beneath, so the ring is only
 * a picture of it.
 */
export function TeamToday() {
  const { state, today } = useStore()
  const team = state.staff.filter((p) => !p.archived)
  if (!team.length) return null
  const day = dayAppointments(state, today)
  const multiSite = hasLocations(state)
  return (
    <section className="team-today" aria-labelledby="team-today-title">
      <div className="team-today-head">
        <h2 id="team-today-title">Your team today</h2>
        <span>
          {team.length} {team.length === 1 ? 'professional' : 'professionals'}
        </span>
      </div>
      <ul className="team-today-list">
        {team.map((staff) => {
          const visits = day.filter((a) => a.staffId === staff.id)
          const open = availableMinutes({ ...state, staff: [staff] }, today)
          const booked = visits.reduce((sum, a) => sum + a.bookedDurationMinutes, 0)
          const percent = open ? Math.min(100, Math.round((booked / open) * 100)) : null
          const place = multiSite
            ? placeOf(state, staffLocationOn(state, staff.id, today))?.name
            : undefined
          return (
            <li key={staff.id}>
              <span
                className="team-today-ring"
                data-tone={staff.tone}
                style={{ '--booked': `${percent ?? 0}%` } as CSSProperties}
              >
                <Avatar identity={staff.id} name={staff.name} tone={staff.tone} />
              </span>
              <strong>{staff.name.split(' ')[0]}</strong>
              <small>{percent === null ? 'Not in today' : `${percent}% booked`}</small>
              {(percent !== null || visits.length > 0) && (
                <small>
                  {visits.length} {visits.length === 1 ? 'visit' : 'visits'}
                </small>
              )}
              {place && <small className="team-today-place">{place}</small>}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
