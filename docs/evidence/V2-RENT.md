# V2 · Chair and room rent: evidence

Recorded 7 October 2026 in Chromium (Playwright) against the built app (`npm run build && npm start`) with a fresh local database, in the browser demo studio (Atelier House, London). All names and amounts are fictional.

## What was exercised

- **Business, Pay, Chair and room rent:** Theo Bennett rents the Styling chair for £180.00 a week from Monday 21 September. The weeks of 21 and 28 September show as paid and the week of 5 October as owed, £180.00 in total. In the list of people above, Theo shows "Rents a chair or room, keeps own takings" and earns no commission this month.
- **Recording rent:** "Record rent" for the week of 5 October, £180.00 by bank transfer with reference THEO-RENT-3 and the confirmation ticked. The page said "£180.00 rent from Theo Bennett recorded. SALEANE did not take this payment." and Theo's rental showed "Up to date".
- **Setting up a rental:** Sophia Reed, Treatment room 2, £650.00 a month from 1 November. The page said "Sophia Reed rents a room for £650.00 a month from Sunday 1 November."
- Pay at 390px has no sideways scroll. No console errors on any of the above.
- The full sweep (`scripts/qualify.mjs`) reports 117 pages with zero violations and no sideways scroll; the only console errors are the expected 401s on the signed-out demo account page.

Screenshots: [rent section](V2-RENT-panel.png), [recording rent](V2-RENT-record.png), [setting up a rental](V2-RENT-setup.png), [Pay afterwards](V2-RENT-pay.png).

## Automated checks

`src/domain/rent.test.ts`: weekly periods, part payments and what is still owed, and rent received in a period; refusing more than is due, a day that does not start a period, rent not yet due and a transfer without a reference; monthly rent on the same day within shorter months; one rental at a time, ending kept on record and not before rent already recorded, and a chair rental naming a chair; no commission on a renter's days; only owners and managers managing rent; the ledger rejecting rent beyond what was due or outside a period. `server/projections.test.ts` expects reception's record without rent or commission records.

## Limits

- Business still counts a renter's visits in the studio's service revenue. Keeping their takings apart is not built.
- Rent is a fixed amount. A percentage of the renter's takings, deposits and extras such as product use are not built.
- No reminders are sent for rent owed, and no rent invoice or receipt is produced.
- Safari and Firefox were not checked.
