import { useState } from 'react'
import { useStore } from '../state/context'
import { useClock } from '../state/clock'
import { businessDate, businessMinutes, can, operations } from '../domain/operations'
import { openMissedCalls } from '../domain/missedCalls'
import { openAnsweredCalls } from '../domain/answeredCalls'
import { patchTestsDue } from '../domain/patchTests'
import { dueTasks } from '../domain/tasks'
import { dayAppointments } from '../domain/selectors'
import { allInHand } from '../domain/moments'
import { photos } from '../design'
import { MissedCalls } from './MissedCalls'
import { AnsweredCalls } from './AnsweredCalls'
import { PatchTestsDue } from './PatchTests'
import { Reminders } from './Reminders'
import './needsYou.css'
import './moments.css'

/**
 * The top of Today's side column: what is waiting on someone, as small cards with a count each.
 * Calls to return, calls the AI receptionist answered, patch tests to sort before a booked visit,
 * and the team's reminders. Stage 6: once nothing waits and everyone due so far has been welcomed
 * or checked out, the cards give way to a still photograph and "All in hand". Adding a reminder or
 * a call stays one tap away.
 */
export function NeedsYou() {
  const { state, today, role, branch } = useStore()
  const clock = useClock()
  const [opened, setOpened] = useState(false)
  const calls = can(role, 'missed-call') ? openMissedCalls(state, clock).length : null
  const answered = can(role, 'missed-call') ? openAnsweredCalls(state, clock).length : 0
  const tests = patchTestsDue(state, businessDate(state, clock)).length
  const reminders = dueTasks(state, today).length
  const total = (calls ?? 0) + answered + tests + reminders
  const cards = calls !== null || tests > 0 || reminders > 0 || can(role, 'task')
  const calm =
    !opened &&
    allInHand({
      waiting: total,
      // A general manager's desk is their own location.
      visits: dayAppointments(state, today).filter(
        (a) => role !== 'general' || !branch || a.locationId === branch,
      ),
      // A sample studio's clock stands still; a real one moves on with the minute.
      nowMinutes:
        operations(state).mode === 'sandbox'
          ? businessMinutes(state)
          : businessMinutes(state, clock),
    })
  if (calm)
    return (
      <section className="needs-you all-in-hand settle-in" aria-labelledby="needs-you-title">
        <div
          className="all-in-hand-photo"
          aria-hidden="true"
          style={{ backgroundImage: `url(${photos.calmStudio})` }}
        />
        <div className="all-in-hand-words">
          <h2 id="needs-you-title">All in hand</h2>
          <p>Everyone due so far has been welcomed, and nothing is waiting.</p>
          {(calls !== null || can(role, 'task')) && (
            <button type="button" className="text-link" onClick={() => setOpened(true)}>
              {calls !== null && can(role, 'task')
                ? 'Add a reminder or log a missed call'
                : calls !== null
                  ? 'Log a missed call'
                  : 'Add a reminder'}
            </button>
          )}
        </div>
      </section>
    )
  return (
    <section className="needs-you" aria-labelledby="needs-you-title">
      <div className="needs-you-head">
        <h2 id="needs-you-title">Needs you</h2>
        <span>{total ? `${total} waiting` : 'All clear'}</span>
      </div>
      {cards ? (
        <>
          <MissedCalls />
          <AnsweredCalls />
          <PatchTestsDue />
          <Reminders />
        </>
      ) : (
        <p className="needs-empty">Nothing is waiting on you.</p>
      )}
    </section>
  )
}
