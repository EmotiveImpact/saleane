# V2 · Accountant exports and a test link to Xero and QuickBooks: evidence

Recorded 7 October 2026 in Chromium (Playwright) against the built app (`npm run build && npm start`) with a fresh local database, in the browser demo studio (Atelier House, London). All figures come from the fictional demo studio. The account codes are examples only; a real studio's accountant supplies its own.

## What was exercised

- **Business, Accounts, last month (September):** the period totals, the day-by-day table and the three spreadsheet buttons.
- **Downloads:** "Money in and out" gave 113 rows (deposits, payments, refunds and rent, with demo card payments marked "Yes" in the Test or demo column). "Sales by receipt" gave 45 rows. "Tax summary" gave the single 0% row for the UK demo studio, which is not VAT registered. File names carry the period, for example `saleane-money-2026-09-01-to-2026-09-30.csv`.
- **Xero preview:** the preview shows the first day with takings (8 September) as a draft Xero manual journal.
- **Preparing a batch:** "Prepare for Xero" said "Prepared 23 days for Xero in test mode. Nothing was sent." The batch list shows "Xero · Tue, 1 Sept to Wed, 30 Sept · 23 days · £4,345.00 · test mode, not sent".
- **Codes:** "Change software or codes" opens the settings form (owner only).
- Accounts at 390px has no sideways scroll. No console errors on any of the above.
- The full sweep (`scripts/qualify.mjs`) reports 129 pages with zero violations and no sideways scroll; the only console errors are the expected 401s on the signed-out demo account page.

Screenshots: [the page](V2-ACCOUNTS-page.png), [the Xero section after preparing](V2-ACCOUNTS-xero.png), [software and codes](V2-ACCOUNTS-codes.png), [phone width](V2-ACCOUNTS-phone.png).

## Automated checks

`src/domain/accounts.test.ts` covers the following:

- Receipts listed by the day they were paid, including walk-in sales.
- Money in and out, with demo payments marked and rent included.
- Tax and tips adding up the same in the day summary as on the receipts.
- Every day becoming a balanced journal against a takings clearing account.
- Days with nothing to post being left out of Xero and QuickBooks batches.
- Each software's own journal shape.
- A prepared batch logged as test mode with who prepared it, and refused for the wrong software or a blank code.
- Only the owner changing the software and codes.
- Month boundaries.
- Product totals matching Business.

`src/state/offline.test.tsx` used a fixed date that expired overnight. It now uses a time relative to the real clock, so the test no longer fails from 7 October onwards.

## Limits

- Nothing is sent to Xero or QuickBooks. Sending needs the studio's accountant to sign in to their software, which comes later behind the same adapter.
- One summary journal per day, not one entry per receipt.
- Visit receipts have no receipt numbers in SALEANE, so that column is blank for them; walk-in sales show their SC number.
- Deposits count as takings when the visit is paid, as in Business.
- One location. Safari and Firefox were not checked.
