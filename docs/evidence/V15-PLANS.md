# V1.5 · Packages and memberships: evidence

Recorded 7 October 2026 in Chromium (Playwright) against the built app (`npm run build && npm start`) with a fresh local database. All names and amounts are fictional.

## What was exercised

- A new non-sample studio (Linden Studio, UK) with one room, Maya Lind, a £95 restorative facial, a £25 brow shape and one client, Rosa Okafor.
- **Settings, Packages & memberships:** added "Five facials", a package of 5 facials for £400 used within 6 months, and "Brow club", a £20 a month membership with one brow shape a month and 10% off other visits. Both list with their terms, services and how many clients hold them.
- **Client page:** sold Five facials to Rosa, recorded as cash already received (the desk must confirm it). The panel then showed "5 of 5 visits left · use by Tuesday 6 April", and the timeline "Package bought".
- **Checkout:** a facial for Rosa today, welcomed, then checked out. "Pay with" offered Five facials (chosen first) or paying as usual. The plan paid £80.00 (£400 over 5 visits), the £15.00 difference showed as the plan saving, and nothing was left to collect, so no payment fields were asked for. The receipt reads "Paid by Five facials".
- **Money, Plans:** £400.00 taken for plans, £320.00 of package visits paid for and not yet used, with Rosa's package at 4 of 5 visits left, paid £400.00, used £80.00.
- The client page and Settings at 390px.
- axe (WCAG 2.2 A/AA and best practice) on every screen above: zero violations, no console errors, no sideways scroll at 1280px or 390px. The full sweep (`scripts/qualify.mjs`, now including Settings, Packages & memberships) reports 93 pages with zero violations and no overflow; the only console errors are the expected 401s on the signed-out demo account page.

Screenshots: [Settings](V15-PLANS-settings-list.png), [selling](V15-PLANS-sell.png), [checkout](V15-PLANS-checkout.png), [receipt](V15-PLANS-receipt.png), [Money, Plans](V15-PLANS-money.png), [client page at 390px](V15-PLANS-client-390.png).

## Automated checks

`src/domain/plans.test.ts` covers: month arithmetic at month ends; plans that make no sense refused; changes to a plan leaving clients' bought terms alone; who may set up, sell, renew and end a plan; a package sale with its end date, payment and till cash; a covered visit's share, saving, tip-only payment, takings and visits left; a package using exactly its price over its visits and refusing a visit once used; another client's plan, another service, an extra discount and an expired package refused; ending a plan with a refund capped at the unused part, recorded and never processed; a refund on a plan-paid receipt capped at the tip; a membership covering its monthly visit, offering its discount, and needing each month paid; a lapsed membership restarting from the current month and never charging a month twice; a second copy of the same membership refused; who sold a plan recorded; plan use without its receipt and card payments recorded by hand rejected by the ledger checks; plans in the client's export; a membership returning only its current paid month; a payment or refund reference used twice refused; plan names kept unique when renamed or put back on sale. `server/plans.test.ts` covers the same permissions through the server and keeps plans out of a practitioner's view.

## Limits

- Plan payments are recorded by the desk: cash, or the studio's own card terminal with its reference. Paying for a plan by card through SALEANE, saved-card monthly renewal and reminders for a due membership payment come in a later stage.
- A visit paid by a plan cannot also have a deposit; refund the deposit or check it out as usual.
- A plan-paid visit with a tip takes the tip by cash or the studio's own terminal, not by card through SALEANE.
- Gift cards, and spending carried-over credit at checkout, are not built yet.
- Guests do not yet see their plan on their visit page.
- Safari and Firefox were not checked.
