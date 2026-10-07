# V2 · Several locations: evidence

Recorded 7 October 2026 in Chromium (Playwright) against the built app, in the browser demo studio (Atelier House, Marylebone, London). All names, addresses and visits are fictional.

## What was exercised

- **Settings, Locations:** "Add location" for Islington, 1 Upper Street, London N1, with the note "Ring the bell marked Atelier." and its own opening hours. The page said "Islington saved." and listed Marylebone (Main) and Islington with "nobody working here yet".
- **Spaces:** a new "Islington treatment room" at Islington. The list of spaces shows each room's location.
- **Team:** a new professional, Nia Okafor, qualified for the Skin Renewal Facial, working at Islington each day. Islington then showed one room and someone working every day.
- **Guest booking (demo page):** Skin Renewal Facial, then "Where would you like to come?" with both locations. Choosing Islington left only Nia Okafor as a professional. The review read "Wednesday 7 October at 09:00, 60 minutes with Nia Okafor, Islington, 1 Upper Street, London N1" and the confirmation showed Islington's arrival note.
- **Calendar:** the "All locations" filter set to Islington shows only Nia Okafor's column, with Grace Fictional's visit on 7 October.
- Settings, the booking page and the calendar at 390px have no sideways scroll. No console errors during the journey.
- The full sweep (`scripts/qualify.mjs`) reports 135 pages with zero accessibility violations, no sideways scroll and no missing focus; the only console errors are the expected 401s on the signed-out demo account page.

Screenshots: [adding a location](V2-LOCATIONS-add.png), [locations list](V2-LOCATIONS-settings.png), [team](V2-LOCATIONS-team.png), [guest choosing Islington](V2-LOCATIONS-guest.png), [confirmation](V2-LOCATIONS-confirmed.png), [calendar for Islington](V2-LOCATIONS-calendar.png).

## Automated checks

`src/domain/locations.test.ts`: a one-location studio unchanged; times offered only where the person works that day and only in rooms at that place; reminders naming the visit's location and address; a location's own opening hours; refusing a change that would strand a booked visit; refusing a duplicate name, a room at a closed location, and anyone but the owner; the ledger rejecting a visit, room or working day that names a missing location. `server/locations.test.ts`: the live booking page lists both locations and where each person works, availability at Islington, a hold and a booking that lands at Islington with Nia.

## Limits

- Stock is counted for the studio as a whole, not per location.
- Business, Pay and Accounts figures are for the whole studio. A breakdown per location is not built.
- A visit cannot be moved from one location to another; it has to be cancelled and booked again.
- Waitlist entries without a visit, and imported visits, belong to the main location.
- Someone following the studio's opening hours works at the main location. Schedule history does not record changes to which location a person works at on a day.
- No travel time is allowed between locations, since each person works at one place per day.
- Safari and Firefox were not checked.
