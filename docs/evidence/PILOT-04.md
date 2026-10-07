# PILOT-04 · One clear published price: evidence

Recorded 7 October 2026 in Chromium (Playwright) against the built app (`npm run build && npm start`).

## What was exercised

- /pricing at 1280px with a UK browser (shows £49 a month, plus VAT), at 390px (same), and at 1280px with a US browser (shows $59 a month, plus any sales tax). The country switch changes the figure in place.
- axe (WCAG 2.2 A/AA and best practice): zero violations on all three. No console errors. No sideways scroll.
- The full sweep (`scripts/qualify.mjs`, now including /pricing) reports 87 pages with zero violations and no overflow; the only console errors are the expected 401s on the signed-out demo account page.

Screenshots: [desktop](PILOT-04-pricing-desktop.png), [phone](PILOT-04-pricing-390.png), [United States](PILOT-04-pricing-us.png).

## Automated checks

`src/pages/Pricing.test.tsx` checks the price labels in each currency, the three promises, and the country switch.

## Limits

- £49 / $59 is the recommended figure; the owner has been asked to confirm or change it.
- No billing or subscription is connected; nothing is charged.
- The page is part of the app, not a separate marketing site, and is not deployed.
