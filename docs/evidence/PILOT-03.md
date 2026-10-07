# PILOT-03 · Switching over from another system: evidence

Recorded 7 October 2026 in Chromium (Playwright) against the built app (`npm run build && npm start`) with a fresh local database. All names, emails and amounts are fictional; no data from a real studio was used.

## What was exercised

- A new non-sample studio (Linden Studio, UK) with one treatment room, one chair, two team members (Maya Lind and Theo Grant) and one client, Rosa Okafor. Settings, Switching over was opened from the Settings menu.
- **Services:** a four-row file with an extra `online_booking` column. Three rows were ready (a £95 facial with a £20 deposit given by Maya, a "£25" brow shape, a hair cut given by Theo that takes the chair), one was marked to fix because no one on the team is called Sam Rivers, and the extra column was listed as left out. Totals £195.00 price list and £20.00 deposits; three brought across, each given to its named professional.
- **Upcoming visits:** a four-row file with UK dates. Rosa's facial tomorrow at 10:05 at a quoted £85.00 with £20.00 already paid (reference BK-1042) was ready; a brow shape for a new guest at 10:30 with Maya was marked to fix because it clashes with Rosa's facial; a cut for the same new guest the next day at a quoted £70.00 was ready; a facial with Theo was marked to fix because Theo does not give it. Totals £155.00 booked and £20.00 deposits already paid. Two visits came across; the new guest was added once; the deposit is recorded as "Paid to Fresha before switching · BK-1042".
- **Balances:** a three-row file. £25.00 gift card credit for Rosa and £12.50 owed by the new guest were ready; an unknown email was marked to fix. Both came across.
- "What has come across" listed the three imports with who did them, counts, money totals and how many visits or balances were still open.
- Money showed "Includes £20.00 paid to your old system before switching" and a new Carried over tab. Rosa's credit was closed with the note "Taken off the facial"; it stays listed as closed, with the note, date and person. Rosa's client page shows the same.
- Settings, Switching over at 390px.
- axe (WCAG 2.2 A/AA and best practice) on every screen above: zero violations. No console errors. No sideways scroll at 1280px or 390px. The full sweep (`scripts/qualify.mjs`, now including Settings, Switching over) reports 81 pages with zero violations and no overflow; the only console errors are the expected 401s on the signed-out demo account page.

Screenshots: [import log](PILOT-03-settings-log.png), [services review](PILOT-03-services-review.png), [visits review](PILOT-03-visits-review.png), [balances review](PILOT-03-balances-review.png), [Money, carried over](PILOT-03-money-carried.png), [client page](PILOT-03-client.png), [Settings at 390px](PILOT-03-settings-390.png).

## Automated checks

`src/domain/switching.test.ts` covers: reading money, UK and US dates and 12 and 24 hour times as old systems export them; the services, visits and balances previews (duplicates, unknown professionals, clashes inside one file, unknown clients, a second open balance); services given to the named professionals and a repeated name refused; a visit kept at its quoted price and deposit, logged with its totals, not asking the guest for the deposit again and sending no confirmation; a new guest added once for several visits; clashes, past times, repeats and a deposit above the price refused; a carried-over deposit taken off the bill at checkout and kept out of the till; the old system refused as a payment method at the desk; balances closed with a note and never removed; client imports logged; who may import and who may close a balance. `server/switching.test.ts` covers the same through the server: owners import, the desk is refused an import but may close a balance, practitioners see no balances or import log, and a hand-recorded "previous system" payment is refused.

## Limits

- Files are CSV only, up to 48 KiB and 200 visits or services (500 balances) at a time. Exports from named systems (Fresha, Phorest, Mindbody and others) were not available, so the column names are SALEANE's own; a studio may need to rename columns in its export.
- Past visit history is not imported, only upcoming visits.
- A carried-over credit is not taken off a bill automatically; the desk applies it and closes it. Spending credit at checkout belongs with memberships, packages and gift cards in 1.5.
- There is no automatic undo of an import. Imported visits can be cancelled one by one as usual, and nothing is deleted.
- Safari and Firefox were not checked.
