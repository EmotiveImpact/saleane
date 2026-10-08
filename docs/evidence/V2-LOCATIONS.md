# V2 · Several locations: evidence

Recorded 7 October 2026 in Chromium (Playwright) against the built app, in the browser demo studio (Atelier House, Marylebone, London). All names, addresses and visits are fictional.

## What was exercised

- **Settings, Locations:** "Add location" for Islington, 1 Upper Street, London N1, with the note "Ring the bell marked Atelier." and its own opening hours. The page said "Islington saved." and listed Marylebone (Main) and Islington with "nobody working here yet".
- **Spaces:** a new "Islington treatment room" at Islington. The list of spaces shows each room's location.
- **Team:** a new professional, Nia Okafor, qualified for the Skin Renewal Facial, working at Islington each day. Islington then showed one room and someone working every day.
- **Guest booking (demo page):** Skin Renewal Facial, then "Where would you like to come?" with both locations. Choosing Islington left only Nia Okafor as a professional. The review read "Wednesday 7 October at 09:00, 60 minutes with Nia Okafor, Islington, 1 Upper Street, London N1" and the confirmation showed Islington's arrival note.
- **Calendar:** the "All locations" filter set to Islington shows only Nia Okafor's column, with Grace Fictional's visit on 7 October.
- **Prices and menu:** in Settings, the Skin Renewal Facial now shows "At each location" with "Offered at" ticks and "Price at Islington". Set to £120, the list read "£120 at Islington". A guest choosing Islington saw "Service total £120, demo deposit £25, remaining at visit £95".
- **A link for each location:** Settings, Business, "Share your booking page" lists "For Marylebone, London" and "For Islington". The Islington link opened the booking page with Islington already chosen.
- **Stock:** "Move" on Calming Cleansing Balm, from Marylebone, London (10) to Islington, 2. With the Location filter on Islington the shelf showed 2 at Islington. Walk-in sales and supplier orders ask which location when there is more than one, and the order text says where to deliver.
- **Business:** the location filter on Islington shows Islington's figures and open time only.
- **Moving a visit:** Grace Fictional's Islington visit, "Move appointment", Location Marylebone, London, Maya Lewis, 09:00. The visit moved to Treatment room 1 with Maya, keeping its booked price, and the timeline names both locations.
- **Waitlist:** the add form has "Where" with Any location, Marylebone, London and Islington.
- Axe found no problems on the price dialog, the stock move dialog, Stock and Business filtered to Islington, the move dialog and the waitlist form.
- Settings, the booking page, the calendar, Stock and Business at 390px have no sideways scroll. No console errors during the journey.
- The full sweep (`scripts/qualify.mjs`) reports 147 pages with zero accessibility violations, no sideways scroll and no missing focus; the only console errors are the expected 401s on the signed-out demo account page.

Screenshots: [adding a location](V2-LOCATIONS-add.png), [locations list](V2-LOCATIONS-settings.png), [team](V2-LOCATIONS-team.png), [guest choosing Islington](V2-LOCATIONS-guest.png), [confirmation](V2-LOCATIONS-confirmed.png), [calendar for Islington](V2-LOCATIONS-calendar.png), [prices per location](V2-LOCATIONS-prices.png), [links per location](V2-LOCATIONS-links.png), [moving stock](V2-LOCATIONS-stock-move.png), [Islington's shelf](V2-LOCATIONS-stock.png), [Stock on a phone](V2-LOCATIONS-stock-390.png), [Business for Islington](V2-LOCATIONS-business.png), [moving a visit](V2-LOCATIONS-move-visit.png).

## Automated checks

`src/domain/locations.test.ts`: a one-location studio unchanged; times offered only where the person works that day and only in rooms at that place, and a booking without a chosen location (from the desk or Ask Saleane) going where the person works that day; reminders naming the visit's location and address; a location's own opening hours; refusing a change that would strand a booked visit; refusing a duplicate name, a room at a closed location, and anyone but the owner; the ledger rejecting a visit, room or working day that names a missing location; moving a visit to another location with its price kept and the move on the timeline; stock at each location, moving it, walk-in sales from the right shelf, and the ledger rejecting a move that does not balance; a location's own price and a treatment left off a location's menu; a waitlist request for one location finding times only there; open time split by location; location changes in the schedule history. `server/locations.test.ts`: the live booking page lists both locations and where each person works, availability at Islington, a hold and a booking that lands at Islington with Nia at Islington's price, and a time texted by the AI receptionist opening at Islington.

## Limits

- Pay and Accounts stay for the whole studio, as payroll and the accountant's books are for the business. Business and Stock can be filtered by location.
- "Reorder when down to" is one number per product, so at a location with none of a product it shows as running low. Supplier suggestions are for the whole studio.
- Returning guests (the retention panel on Business) stay for the whole studio.
- Imported visits belong to the main location.
- Someone following the studio's opening hours works at the main location.
- A manager who looks after only one location is planned for V5.
- No travel time is allowed between locations, since each person works at one place per day.
- Safari and Firefox were not checked.
