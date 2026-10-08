# V1.5 · Booking from a missed call: evidence

Recorded 7 October 2026 in Chromium (Playwright) against the built app (`npm run build && npm start`) with a fresh local database, in a signed-in sample studio (London). All names and numbers are fictional and nothing was sent.

## What was exercised

- **Today › Missed calls:** each call now has Book beside Call and Called back. The sample list has an unknown number (+44 7700 900456) and Olivia James, matched by her number.
- **A caller nobody knows:** Book opens the usual booking window with "For the missed call from +44 7700 900456. Booking takes it off the list." The client search starts with the caller's number, so an existing client with that number shows straight away. "They are new: add them while booking" swaps the search for name, email and phone, with the phone already filled in from the call and the note "They are added as a client when you confirm. Ask before sending them news." Booking Nell Caller for a facial at 09:00 confirmed with "The call is off the missed calls list."
- **A known caller:** Book opens with Olivia James already chosen and not changeable, because the call came from her number. Booking her took her call off the list too.
- Afterwards the panel reads "No calls waiting for a call back. 2 calls this week became a booked visit.", and both calls in the studio record point at their visits.
- **390px:** the panel and the booking window with the new-client fields fit with no sideways scroll.
- No console errors. The full sweep (`scripts/qualify.mjs`) reports 135 pages with zero axe violations, no sideways scroll and no missing focus; the only console errors are the expected 401s on the signed-out demo account page. The sweep does not open the booking window from a call.

Screenshots: [booking a new caller](V15-CALLBOOK-new.png), [the confirmation](V15-CALLBOOK-done.png), [the list afterwards](V15-CALLBOOK-today.png), [at 390px](V15-CALLBOOK-390.png).

## Automated checks

`src/domain/callBookings.test.ts` covers: a booking for a call links the visit to the call, counts as calling back (by the person who booked), takes it off the list, notes it on the visit's timeline and appears in the client's data export as the visit it led to; a caller who is new is added as a client and the call is matched to them; an earlier call back time is kept; a second visit for the same call, a visit for a different client than the one who rang, or a call that is not on the list are refused; a cancelled visit no longer counts as a call that became a booking; and only the desk roles that can already see calls and book can do it. Online bookings never carry a call.

## Limits

- This links a booking the desk makes to a call already on the list. It does not answer or place calls, record them, or listen in. Calls still arrive by the desk writing them down, or from a Twilio line (untested live).
- A new caller needs an email address to be added, as for any client.
- "Calls this week that became a booked visit" counts the last seven days and leaves out cancelled visits. It is a count for the desk, not a report.
- Safari and Firefox were not checked.
