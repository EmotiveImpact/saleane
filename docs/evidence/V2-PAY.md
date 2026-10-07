# V2 · Commission and tips per person: evidence

Recorded 7 October 2026 in Chromium (Playwright) against the built app (`npm run build && npm start`) with a fresh local database, in the browser demo studio (Atelier House, London). All names, rates and amounts are fictional.

## What was exercised

- **Business, Pay, last month (September 2026):** Maya Lewis 23 visits at 40% on services, £874.00; Sophia Reed 15 visits at 35%, £472.50; Theo Bennett 6 visits at 35% (his rate went up from 30% on 1 September), £157.50. Total owed £1,504.00. The UK demo records no tips, so tips show £0.00. Details lists each visit with its service amount and commission.
- **Changing a rate:** Theo to 37.5% on services from 1 October. The dialog lists his earlier rates and who set them. Saving showed "Theo Bennett is on 37.5% on services and 10% on products from Thursday 1 October", and this month's figure for him moved to the new rate while September stayed the same.
- **A walk-in sale with a seller:** a Hydrating Serum (£48) sold without a visit, "Sold by" Maya Lewis. Her product commission this month rose by £4.80.
- **Download for payroll:** `saleane-pay-2026-09-01-to-2026-09-30.csv` with one row per person (visits, services, products, given back, commission, tips, owed).
- Pay at 390px: figures stack, no sideways scroll. No console errors on any of the above.
- The full sweep (`scripts/qualify.mjs`, now including Pay) reports 111 pages with zero violations and no sideways scroll; the only console errors are the expected 401s on the signed-out demo account page.

Screenshots: [Pay](V2-PAY-page.png), [rates](V2-PAY-rates.png), [Pay at 390px](V2-PAY-390.png).

## Automated checks

`src/domain/pay.test.ts`: commission on services and products with the tip in full; the rate in force on the visit's day, the kept history, and a back-dated change; a walk-in seller earning product commission and an unknown seller refused; money given back coming off in proportion in the month it is given back, leaving the tip; only the owner setting rates, with their name recorded, and out-of-range rates refused; rates left out of what reception reads; the ledger rejecting a rate for someone not on the team; both demo studios having rates and figures; the spreadsheet keeping a formula-like name as text. `server/pay.test.ts`: over the API a manager cannot set a rate, the owner can, a manager reads it and reception's record does not contain it. `server/projections.test.ts` now expects reception's record without rates.

## Limits

- SALEANE works out what is owed; it does not pay anyone, deduct tax or National Insurance, or handle salaries and hourly pay.
- One rate for all services and one for all products per person. Rates per service, tiers and targets are not built.
- A month is not locked once paid. A rate back-dated into a paid month changes that month's figures; the rate history shows when and by whom.
- Practitioners cannot see their own earnings yet.
- Safari and Firefox were not checked.

## Pay settings (added 7 October 2026)

- **Pay, "Tips and money given back" (owner only):** the window offers money given back coming off the commission (the default) or being paid by the studio, and tips going to the person who did the job (the default) or into a shared pot split each day, week or month. It says the studio never keeps any tips. Saving "shared pot, weekly, from 1 September" showed "From Tuesday 1 September: Money given back comes off the commission in the month it is given back. Tips are shared equally between everyone who did a visit that week (Monday to Sunday)." The section's explanation changed to match.
- The demo studio has no tips recorded, so the pot itself is shown by the automated checks rather than on screen.
- axe finds no violations with the window open. Pay at 390px has no sideways scroll, and there were no console errors.

Screenshot: [pay settings](V2-PAY-settings.png).

Automated checks in `src/domain/pay.test.ts`:

- The defaults apply until changed.
- When the studio pays for money given back, commission stays whole.
- A £10.01 pot is shared 500/501 between two people, adding up exactly.
- Week and month pots have the right first and last days.
- Only the owner can change the settings, and who changed them is recorded.

Limit: the pot is split equally between people who did at least one visit in it, not by hours worked.
