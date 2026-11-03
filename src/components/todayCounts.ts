import { useStore } from '../state/context'
import { useClock } from '../state/clock'
import { businessDate, can } from '../domain/operations'
import { openMissedCalls } from '../domain/missedCalls'
import { openAnsweredCalls } from '../domain/answeredCalls'
import { patchTestsDue } from '../domain/patchTests'
import { dueTasks } from '../domain/tasks'
import { staffLocationOn } from '../domain/locations'

/*
 * What Today counts, worked out once so that a phone's tabs and a computer's headings always show
 * the same numbers as the sections beneath them.
 */

/**
 * What waits on the person at the desk now: calls to return, calls the AI receptionist answered,
 * patch tests to sort and the team's reminders.
 */
export function useWaiting() {
  const { state, today, role } = useStore()
  const clock = useClock()
  const calls = can(role, 'missed-call') ? openMissedCalls(state, clock).length : null
  const answered = can(role, 'missed-call') ? openAnsweredCalls(state, clock).length : 0
  const tests = patchTestsDue(state, businessDate(state, clock)).length
  const reminders = dueTasks(state, today).length
  return { calls, answered, tests, reminders, total: (calls ?? 0) + answered + tests + reminders }
}

/**
 * The people on Today's team: everyone not archived, or for a general manager (Stage 4) the people
 * whose day today is at their location.
 */
export function useTeamToday() {
  const { state, today, role, branch } = useStore()
  const own = role === 'general' && branch ? branch : undefined
  return state.staff.filter(
    (p) => !p.archived && (!own || staffLocationOn(state, p.id, today) === own),
  )
}
