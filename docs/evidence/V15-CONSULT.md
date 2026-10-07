# V1.5 · Consultations that carry their version into a visit: evidence

Recorded 7 October 2026 in Chromium (Playwright) against the built app (`npm run build && npm start`) with a fresh local database, in a signed-in sample studio (London). All names are fictional and nothing was sent.

## What was exercised

- **A client's page, Consultations (new panel):** Ellie's sample consultation reads "Thu, 1 Oct with Theo Bennett · Gloss & Tone", what she wanted ("Warmer, softer blonde. Less brassy at the ends."), what was agreed, the price given (£65.00), "Version 2, saved by Maya · demo operator · one visit booked from it", and version 1 under Earlier versions.
- **Recording one:** for Amelia, with Maya, for Skin Renewal Facial: what she would like, what was agreed and £190. Typing "Mentioned a nut allergy." in the notes shows "This mentions “allergy”. Consultations here are for everyday notes, so they cannot record health details. Patch tests have their own record." and Save stays off until it is changed.
- **Updating it:** the price changed to £180 and saved as version 2. The panel shows version 2, saved by the signed-in owner, with version 1 kept underneath.
- **Booking from it:** "Book from this" opens the booking window with Amelia and the facial already chosen and a line at the top: "From the consultation on Tuesday 6 October (version 2): Two facials a fortnight apart, the second a week before the day." Booking 10:00 on 7 October stores the visit with that consultation and version 2.
- **The visit:** opening it from the calendar shows "Agreed at consultation" with the plan, what she wanted, the date, the version and the price given.
- No console errors. axe (WCAG 2.2 A/AA) finds nothing on the client page, the consultation form and the visit window. The full sweep (`scripts/qualify.mjs`) reports 141 pages with zero violations.

Screenshots: [the client's consultations](V15-CONSULT-client.png), [recording one](V15-CONSULT-form.png), [booking from it](V15-CONSULT-booking.png) and [on the visit](V15-CONSULT-visit.png).

## Automated checks

`src/domain/consultations.test.ts` covers: recording a consultation with who saved it and a timeline entry; every change kept as a version, by whoever saved it, and a save with no change making none; a visit booked from it keeping the version agreed after a later change (and saying it has changed since), while a new booking takes the latest version; the practitioner's own day showing what was agreed for their visit; health details, another client's consultation, a booking from the public page and a future date all refused; reception and managers recording consultations while a practitioner cannot on their own; a visit pointing at a missing version refused; and every version and the visits booked from it in the client's data export, text export and erasure review.

## Limits

- Consultations are for everyday notes. A list of health words is refused, the same as for guest forms; it is not a full check of meaning. Health details wait for the separate clinical part of SALEANE.
- The desk and managers record them. A practitioner reads them on their day but cannot record one from their own view yet.
- The date and who held it are set when it is first recorded; later versions change what was wanted, agreed and quoted.
- The price given is a note of what was said, not a price change: the visit is still booked at the treatment's price.
- The practitioner's view was checked by tests, not in the browser.
- Nothing is deleted automatically. Safari and Firefox were not checked.
