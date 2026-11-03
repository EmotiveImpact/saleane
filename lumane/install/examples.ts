import type { AppFindings } from './findings'

// Pretend apps for the install page and the tests, with no SALEANE inside them. They show what an
// installer finds when it reads an app; nothing here is a real business.

/** A calendar app with its own design system: indigo, DM Sans and tighter corners. */
export const CALEANE: AppFindings = {
  name: 'Caleane',
  short: 'Cal',
  files: 212,
  handles: ['events', 'calendars', 'people', 'invitations', 'reminders'],
  design: {
    file: 'src/styles/tokens.css',
    look: {
      colour: '#3949AB',
      font: "'DM Sans', system-ui, sans-serif",
      corners: 'soft',
      scheme: 'light',
    },
  },
  pathways: [
    {
      name: 'look_up_events',
      title: 'Look up events',
      kind: 'read',
      description: 'Looks up events on the calendars this person can see, by day, person or title.',
      example: 'What’s on tomorrow?',
      recommended: true,
      preview: {
        answer:
          'Tomorrow you have three things on:\n09:30 Stand-up\n11:00 Design review\n15:00 Call with Northgate',
      },
    },
    {
      name: 'find_free_times',
      title: 'Find free times',
      kind: 'read',
      description: 'Finds times when everyone named is free, within working hours.',
      example: 'Find a free hour with Sam',
      recommended: true,
      preview: {
        answer: 'You and Sam are both free tomorrow 13:00 to 14:00 and Friday 10:00 to 11:00.',
      },
    },
    {
      name: 'prepare_event',
      title: 'Prepare a new event',
      kind: 'action',
      description: 'Prepares a new event with a title, a time and the people to invite.',
      example: 'Add a team lunch on Friday at 12:30',
      recommended: true,
      preview: {
        answer: 'Here is the lunch, ready for you. Nobody is invited until you approve it.',
        change: {
          summary: 'Add “Team lunch” on Friday 9 October, 12:30 to 13:30.',
          details: [
            { label: 'Event', value: 'Team lunch' },
            { label: 'When', value: 'Fri 9 Oct, 12:30 to 13:30' },
            { label: 'Invite', value: '6 people, by email' },
          ],
        },
      },
    },
    {
      name: 'prepare_move',
      title: 'Prepare a move',
      kind: 'action',
      description: 'Prepares moving an event to a new time, and who to tell.',
      example: 'Move the design review to Friday at 2pm',
      recommended: true,
      preview: {
        answer: 'Friday at 14:00 suits all five people invited. Here is the change, ready for you.',
        change: {
          summary: 'Move the design review to Friday at 14:00 and tell everyone invited.',
          details: [
            { label: 'Event', value: 'Design review' },
            { label: 'From', value: 'Wed 7 Oct, 11:00 to 12:00' },
            { label: 'To', value: 'Fri 9 Oct, 14:00 to 15:00' },
            { label: 'Tell', value: '5 people invited, by email' },
          ],
        },
      },
    },
    {
      name: 'prepare_reminder',
      title: 'Remind the people invited',
      kind: 'action',
      description: 'Prepares a short reminder to the people invited to an event.',
      example: 'Remind everyone invited to the design review',
      preview: {
        answer: 'Here is a short reminder for the five people invited.',
        change: { summary: 'Email a reminder about the design review to 5 people invited.' },
      },
    },
  ],
}

/** An invoicing app with no design system of its own, which takes LUMANE's default look. */
export const TALLY: AppFindings = {
  name: 'Tally',
  files: 148,
  handles: ['invoices', 'customers', 'payments received', 'reminders'],
  pathways: [
    {
      name: 'look_up_invoices',
      title: 'Look up invoices',
      kind: 'read',
      description: 'Looks up invoices by customer, status or date.',
      example: 'Who owes the most?',
      recommended: true,
      preview: { answer: 'Hartley & Rowe owe the most: £2,400, now 42 days late.' },
    },
    {
      name: 'paid_this_month',
      title: 'Sum up what was paid',
      kind: 'read',
      description: 'Adds up the payments received in a period.',
      example: 'What was paid this month?',
      recommended: true,
      preview: { answer: '£18,240 was paid this month, across 23 invoices.' },
    },
    {
      name: 'prepare_chasers',
      title: 'Prepare reminders for late invoices',
      kind: 'action',
      description: 'Prepares polite reminder emails for invoices more than a number of days late.',
      example: 'Chase the invoices more than 30 days late',
      recommended: true,
      preview: {
        answer:
          'Three invoices are more than 30 days late, £4,860 in all. Here are three polite reminders, ready for you.',
        change: {
          summary: 'Email a polite reminder, with the invoice attached, to each of these three.',
          details: [
            { label: 'Hartley & Rowe', value: '42 days late, £2,400' },
            { label: 'Northgate Studio', value: '35 days late, £1,560' },
            { label: 'Fenwick Joinery', value: '31 days late, £900' },
          ],
        },
      },
    },
  ],
}
