/**
 * How SALEANE speaks: the short form of docs/HOW_SALEANE_SPEAKS.md, shown on the design
 * language page. Every example is real copy from the app. Keep the two in step: change the
 * guide first, then these lines.
 */

/** The rules a writer keeps in mind for every line. */
export const voiceRules = [
  'Plain British English. Short sentences, calm and specific, and no exclamation marks.',
  'Say visit, not appointment, and treatment, not service. Say client to the team and you to a guest.',
  'Write SALEANE in capitals, and Ask SALEANE for the assistant, which follows the same words.',
  'No em dashes, and as few en dashes as possible. Use a full stop, a comma, a colon or the word “to”.',
  'Never say a thing happened when it did not. A recorded payment is not charged and a queued message is not sent.',
  'When you say no, give the reason in a few words and name who can help.',
  'When something fails, say what did not happen, that their typing is safe, and what to do next.',
  'Say the Y, not “this is not X, this is Y”. Leave out hype and rhetorical questions.',
] as const

/** The words that promise something about the real world, and when each may be used. */
export const truthWords = [
  ['Saved', 'SALEANE stored it. Nothing outside the studio happened.', 'Answer saved.'],
  [
    'Recorded',
    'A person tells SALEANE something happened elsewhere: cash, an outside card, a missed visit.',
    'The payment was recorded by hand; no card company was contacted.',
  ],
  [
    'Queued',
    'A message is waiting to go. Say when it will go, or why it will not.',
    'Approved. Queued to go out between 09:00 and 19:00.',
  ],
  ['Sent', 'Only when the email or text provider accepted it.', 'Queued, not sent'],
  [
    'Delivered',
    'Only when the provider confirms it arrived.',
    'A message is called delivered only when the provider confirms it.',
  ],
  [
    'Charged, paid',
    'Only when the card provider confirmed the money moved.',
    'Not charged: the studio became read only.',
  ],
  [
    'Test payment',
    'A card payment in test mode. Always say that no money moved.',
    'Paid with a test card. Test mode: no money moved.',
  ],
  [
    'Test mode',
    'A connection runs without its provider. Say what that means for this action.',
    'Approved. Queued in test mode, not sent.',
  ],
  [
    'Sample studio',
    'The fictional studios. They never charge cards or send anything.',
    'A sample studio, so nothing was queued or sent.',
  ],
] as const

/** What we say, what we avoid, and a line from the app that says it well. */
export const wordChoices = [
  ['visit', 'appointment', 'Only a visit still to come can be moved.'],
  ['treatment', 'service', 'Add a treatment in Settings first.'],
  ['client, or you to a guest', 'customer, user', 'Add a client before reserving their visit.'],
  ['professional, the team', 'staff member, resource', 'Any available professional'],
  ['room or chair', 'resource', 'Rooms and chairs stay at their location.'],
  ['sample studio', 'sandbox, demo tenant', 'Nothing leaves this sample studio.'],
  [
    'not connected yet',
    'not configured, disabled',
    'Email is not connected yet, so nothing was sent.',
  ],
  ['sign-off', 'approval workflow, ticket', 'Ask for a sign-off on a refund'],
  ['09:00 to 19:00', 'a dash between two times', 'Queued to go out between 09:00 and 19:00.'],
  ['a verb on every button', 'OK, Submit, Click here', 'Approve and send'],
] as const

/** Saying no, and saying what went wrong, in the app's own words. */
export const refusals = [
  'Only the owner can invite staff.',
  'That changes the whole business. Ask the owner or a manager.',
  'Rooms and chairs stay at their location. Ask the owner or a manager to move one.',
] as const
export const errors = [
  'Could not save the client. Your entries are still here; try again.',
  'No gift card here has that code. Check it and try again.',
  'Choose another time to carry on; your details are kept.',
] as const

/** The same moment written for the team and for a guest. */
export const audiences = [
  [
    'A deposit in test mode',
    'Card payments are in test mode, so no money moves.',
    'It was a test payment, so no money was taken.',
  ],
  [
    'A visit that cannot change',
    'Only a visit still to come can be cancelled.',
    'We couldn’t open this visit.',
  ],
  [
    'Saving went wrong',
    'Could not save this visit. Your choices are still here; try again.',
    'Choose another time to carry on; your details are kept.',
  ],
] as const

/** Dates, times and money as a UK and a US studio read them, from src/domain/format.ts. */
export const regionalForms = [
  ['A day', 'Tuesday 6 October', 'Tuesday, October 6'],
  ['A time', '09:30', '09:30 AM'],
  ['A range', '09:00 to 19:00', '09:00 AM to 07:00 PM'],
  ['Money', '£85.50, £1,100', '$85.50, $1,100'],
  ['An area', 'postcode', 'ZIP code'],
] as const
