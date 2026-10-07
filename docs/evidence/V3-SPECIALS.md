# V3 · Specials, the assistant manager: evidence

Recorded 7 October 2026 in Chromium (Playwright) against the dev server in browser demo mode (Atelier House, fictional records, business date Tuesday 6 October 2026), as the owner.

## What was exercised

- **Today, "Specials to consider" (1280px and 390px):** five suggestions, soonest first: a cold, wet spell (sample weather, 8 to 10 October), the Riverside 10K (sample event, 18 to 21 October), Diwali (26 October to 7 November), October half-term (sample school dates) and Christmas party season (27 November to 24 December). Each shows its reason, the room to fill ("Room for about 19 more body visits on those days; you usually do about 2 a week."), a starting idea and its source.
- **Plan this special (Diwali):** the special moves to "Your specials" with "Starts Mon, 26 Oct. Nothing has been sent; tell clients from the Inbox when you are ready." and a Stop button. Services and prices are unchanged.
- **Ask Saleane:** "Did our specials work?" answered "Diwali: Starts Mon, 26 Oct. Nothing has been sent…". "Plan the Christmas party special" prepared a proposal; approving it added it to "Your specials".
- axe (WCAG 2.2 A/AA and best practice) on the panel at both widths: zero violations, no sideways scroll, no console errors apart from the expected 401s on the signed-out demo account check.

Screenshots: [Today panel with a planned special](V3-SPECIALS-today.png), [planning through Ask Saleane at 390px](V3-SPECIALS-ask-390.png).

## Automated checks

`src/domain/specials.test.ts` covers: each country seeing its own occasions; reading the GOV.UK bank holiday format and turning a Monday holiday into a long weekend; suggestions sorted soonest first with a reason and room; waiting for each signal's lead time, skipping one nearly over and one the studio has no treatments for; planning only by owners and managers, once per suggestion, with no change to services or messages; refusing a special that ends before it starts, has passed or runs longer than three months; a finished special compared with the four periods before it; and a stopped special counted only to the day it stopped. `src/assistant/ask.test.ts` covers suggestions for managers only, planning a named special through approval, and the result answer. `server/specials.test.ts` covers reception being refused and a manager and owner planning and stopping a special through the server.

## Limits

- Every source is in test mode. The seasonal calendar and the GOV.UK England and Wales bank holidays are bundled copies; US federal holidays are a bundled copy of the published list. School dates, the weather and local events are sample data. Live adapters (GOV.UK, a weather service, council term dates, and later a paid events feed with a spending cap) are not connected.
- Eid dates depend on the moon, and the suggestion says so.
- "Room to fill" counts half of the open team time on those days, so it is a rough ceiling, not a forecast.
- The result compares visits with the same length of time before the special. It cannot tell which guests came because of it.
- Telling clients about a special goes through the Inbox as today; there is no bulk send. Any discount is given at checkout; prices never change on their own.
- Maps of locations belong to V5. Safari and Firefox were not checked.
