import type { Role } from './operations'

/**
 * The welcome a new team member reads when they join from an invitation (TeamWelcome.tsx): what
 * their role does, where they will work from, and keeping their sign-in safe. The words describe
 * only what each role can see and do; `place` is the location a general manager runs or the
 * region a regional manager looks after.
 */
export type Welcome = {
  /** Three things this role does, for the first screen. */
  does: string[]
  /** The second screen: its heading and the three places they will work from. */
  day: { heading: string; places: { name: string; detail: string }[] }
  /** The last button, which opens where this role works. */
  open: string
}

export function welcomeFor(role: Role, place?: string): Welcome {
  switch (role) {
    case 'practitioner':
      return {
        does: [
          'See the visits booked with you, a day at a time.',
          'Read what to remember about each guest before you begin.',
          'Leave notes for the studio and record patch tests.',
        ],
        day: {
          heading: 'Your day',
          places: [
            {
              name: 'Next up',
              detail:
                'Your next guest is at the top, with their treatment and time. Welcome them in with one tap.',
            },
            {
              name: 'Before you begin',
              detail:
                'Open a visit to see what to remember about the guest, what you did last time and any patch test.',
            },
            {
              name: 'Only your guests',
              detail:
                'You see the visits booked with you. The rest of the studio’s records stay with the desk and managers.',
            },
          ],
        },
        open: 'Open your day',
      }
    case 'reception':
      return {
        does: [
          'Book, move and cancel visits.',
          'Welcome guests and take payment at the till.',
          'Look after guests’ details, notes and the waitlist.',
        ],
        day: {
          heading: 'The front desk',
          places: [
            { name: 'Today', detail: 'Who is in, who is next and anything waiting for you.' },
            {
              name: 'Calendar',
              detail:
                'Every visit, by person. Book into a free time, or open a visit to change it.',
            },
            {
              name: 'Clients',
              detail: 'Each guest’s visits, notes and preferences, and when they are next due.',
            },
          ],
        },
        open: 'Open the studio',
      }
    case 'general': {
      const here = place ?? 'your location'
      return {
        does: [
          `Run ${here}: its calendar, till and team.`,
          'See its takings, stock and rota.',
          'Ask for approval when something is above your limit.',
        ],
        day: {
          heading: `Running ${here}`,
          places: [
            { name: 'Today', detail: 'The day ahead, who is in and what needs doing.' },
            { name: 'Business', detail: 'Takings, stock and the rota for your location.' },
            {
              name: 'Requests',
              detail: 'Send up anything above your limit and see the answer when it comes back.',
            },
          ],
        },
        open: 'Open the studio',
      }
    }
    case 'regional': {
      const area = place ?? 'your region'
      return {
        does: [
          `See how each location in ${area} is doing.`,
          'Record branch visits and what needs putting right.',
          'Decide the requests your locations send up.',
        ],
        day: {
          heading: 'Your area',
          places: [
            {
              name: 'Your area today',
              detail: 'How each location stands, and anything that needs a look.',
            },
            {
              name: 'Branch visits',
              detail: 'Record a visit and what needs putting right, then see it put right.',
            },
            { name: 'Requests', detail: 'Approve or turn down what your locations ask for.' },
          ],
        },
        open: 'Open your area',
      }
    }
    default:
      return {
        does: [
          'Run the calendar, the till and the team’s days.',
          'See how the studio is doing, from takings to stock.',
          'Change treatments, hours and messages to guests.',
        ],
        day: {
          heading: 'Running the studio',
          places: [
            { name: 'Today', detail: 'The day ahead, takings so far and anything to decide.' },
            { name: 'Business', detail: 'Takings, stock, the rota and pay.' },
            {
              name: 'Settings',
              detail:
                role === 'owner'
                  ? 'Everything about the studio, from treatments to who can sign in.'
                  : 'Treatments, hours and messages. Studio details, tax and pay stay with the owner.',
            },
          ],
        },
        open: 'Open the studio',
      }
  }
}
