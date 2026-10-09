# V5 · Several brands, one owner: evidence

Recorded 9 October 2026 in Chromium (Playwright) against the built app (`npm run build && npm start`) with a fresh local database. One owner registered a UK sample studio, then created a second UK sample studio and a US sample studio. All names are fictional. Nothing was deployed.

## What was exercised

- **One studio:** with a single studio, "Your studios" shows no group view.
- **Three brands:** "Your brands together" appears under the studio list. It reads "Across 2 sample brands, completed visits took £9,660 in the last 28 days, up 383% on the 28 days before." and "Across 1 sample brand, completed visits took $6,255 in the last 28 days, up 379% on the 28 days before." Pounds and dollars are kept apart. Each brand shows its last 28 days, change, rebooked share, this month's takings, booked but not yet taken, and clients.
- **Open:** "Open Mercer Skin" opens that studio's Today page.
- **Phone (390px):** each brand's figures stack under its name, with no sideways scrolling.
- **Accessibility:** axe (WCAG 2.2 A/AA) finds nothing at desktop or phone width. No console errors.

Screenshots: [the page](V5-BRANDS-page.png), [on a phone](V5-BRANDS-390.png).

## Automated checks

`src/domain/brandGroup.test.ts` covers: each brand's figures matching its own Business view; totals kept per currency; the brand ahead and the one behind named only when clearly apart, and "needs a look" only when takings fell. `server/brandGroup.test.ts` covers: every owned studio listed, sample and real studios never added together, nothing but totals in the response, studios where the person is a manager or on the desk left out, and signed-out requests refused.

## Limits

- Figures are completed visits' service takings, as on Business. Products, tips and gift cards are not included.
- Brands are compared on growth only, because amounts in different currencies cannot be added. There is no exchange rate.
- Each brand is still its own studio with its own sign-in membership. Nothing (clients, team, treatments, colours or house rules) is shared or copied between brands, and a manager added to one brand sees nothing of another.
