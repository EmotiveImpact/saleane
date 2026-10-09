import { useState } from 'react'
import type { CSSProperties } from 'react'
import { Clock3 } from 'lucide-react'
import { useStore } from '../state/context'
import { availableMinutes, dayAppointments } from '../domain/selectors'
import { hasLocations, placeOf, staffLocationOn } from '../domain/locations'
import { clockedIn, clockTime } from '../domain/hours'
import { Avatar, Button } from '../design'
import { can, rotaChangeOn, timeOffOn } from '../domain/operations'
import { changeKind } from '../domain/rota'
import { useClock } from '../state/clock'
import { TeamClock } from './Clock'
import './teamToday.css'

/**
 * Who is working today and how full their day is: a small strip of faces, each ringed by the
 * share of their open hours already booked. The figure is written beneath, so the ring is only
 * a picture of it.
 */
export function TeamToday() {
  const { state, today, role, blocked } = useStore()
  const [clocking, setClocking] = useState(false)
  const now = Date.parse(useClock(30_000))
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
          const shift = clockedIn(state, staff.id, now)
          // Stage 3: a day changed on the rota says so, as the rota does.
          const change = timeOffOn(state, staff.id, today)
            ? undefined
            : rotaChangeOn(state, staff.id, today)
          const kind = change && changeKind(state, change)
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
              {kind && (
                <small className="team-today-changed">
                  {kind === 'extra'
                    ? 'Extra day'
                    : kind === 'off'
                      ? 'Day changed'
                      : 'Hours changed'}
                </small>
              )}
              {shift && (
                <small className="team-today-in">In since {clockTime(state, shift.start)}</small>
              )}
            </li>
          )
        })}
      </ul>
      {!blocked && role !== 'practitioner' && can(role, 'clock') && (
        <Button variant="secondary" className="team-today-clock" onClick={() => setClocking(true)}>
          <Clock3 size={16} aria-hidden="true" /> Clock in and out
        </Button>
      )}
      {clocking && <TeamClock onClose={() => setClocking(false)} />}
    </section>
  )
}
