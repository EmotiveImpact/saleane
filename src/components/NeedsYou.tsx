import { useStore } from '../state/context'
import { useClock } from '../state/clock'
import { businessDate, can } from '../domain/operations'
import { openMissedCalls } from '../domain/missedCalls'
import { patchTestsDue } from '../domain/patchTests'
import { dueTasks } from '../domain/tasks'
import { MissedCalls } from './MissedCalls'
import { PatchTestsDue } from './PatchTests'
import { Reminders } from './Reminders'
import './needsYou.css'

/**
 * The top of Today's side column: what is waiting on someone, as small cards with a count each.
 * Calls to return, patch tests to sort before a booked visit, and the team's reminders.
 */
export function NeedsYou() {
  const { state, today, role } = useStore()
  const clock = useClock()
  const calls = can(role, 'missed-call') ? openMissedCalls(state, clock).length : null
  const tests = patchTestsDue(state, businessDate(state, clock)).length
  const reminders = dueTasks(state, today).length
  const total = (calls ?? 0) + tests + reminders
  const cards = calls !== null || tests > 0 || reminders > 0 || can(role, 'task')
  return (
    <section className="needs-you" aria-labelledby="needs-you-title">
      <div className="needs-you-head">
        <h2 id="needs-you-title">Needs you</h2>
        <span>{total ? `${total} waiting` : 'All clear'}</span>
      </div>
      {cards ? (
        <>
          <MissedCalls />
          <PatchTestsDue />
          <Reminders />
        </>
      ) : (
        <p className="needs-empty">Nothing is waiting on you.</p>
      )}
    </section>
  )
}
