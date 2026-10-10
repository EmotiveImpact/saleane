import type { BusinessState } from './model'
import { operations } from './operations'

/**
 * "Your first weeks": what a new studio does once it is open for bookings, on Today after "Get
 * your studio ready" is finished. Each step ticks itself from the studio record, the person's own
 * sign-in or the team list. Bringing clients across, inviting a team and the reminder settings
 * can also be confirmed by hand (`confirmed`), because starting fresh, working alone and keeping
 * the usual reminders are real choices that leave no trace.
 */
export type WeekStep = 'link' | 'clients' | 'team' | 'checkout' | 'reminders' | 'twoStep'
export const WEEK_STEPS: readonly WeekStep[] = [
  'link',
  'clients',
  'team',
  'checkout',
  'reminders',
  'twoStep',
]
/** The permission (see `can`) each step needs; inviting the team, like the studio details, is the owner's. */
export const weekPermission: Record<WeekStep, string> = {
  link: 'read',
  clients: 'import-clients',
  team: 'organisation',
  checkout: 'checkout',
  reminders: 'reminders',
  twoStep: 'read',
}
/** How long the list may show: eight weeks from the first visit booked here. */
export const FIRST_WEEKS_DAYS = 56

/** Before any visit is booked here, and for eight weeks after the first; brought-in visits do not count. */
export function inFirstWeeks(s: BusinessState, now: string) {
  const booked = s.appointments
    .filter((a) => a.source !== 'import')
    .map((a) => Date.parse(a.createdAt))
  if (!booked.length) return true
  return Date.parse(now) - Math.min(...booked) < FIRST_WEEKS_DAYS * 86_400_000
}

export function firstWeeksSteps(
  s: BusinessState,
  facts: {
    /** Steps confirmed by hand in this browser. */
    confirmed?: ReadonlySet<WeekStep>
    /** Whether the person looking has two-step sign-in on. */
    twoStep?: boolean
    /** Whether anyone besides the owner can sign in or has been invited (the owner's team list). */
    invited?: boolean
  } = {},
): { id: WeekStep; done: boolean }[] {
  const confirmed = facts.confirmed ?? new Set<WeekStep>()
  const o = operations(s)
  const done: Record<WeekStep, boolean> = {
    // A guest booking from the page is the sign the link is out there.
    link: s.appointments.some((a) => a.source === 'online'),
    clients: confirmed.has('clients') || (o.imports ?? []).some((i) => i.kind === 'clients'),
    // Someone working alone has no one to invite.
    team:
      confirmed.has('team') ||
      !!facts.invited ||
      s.staff.filter((person) => !person.archived).length <= 1,
    checkout: s.sales.length > 0,
    reminders: confirmed.has('reminders') || o.reminders !== undefined,
    twoStep: !!facts.twoStep,
  }
  return WEEK_STEPS.map((id) => ({ id, done: done[id] }))
}
