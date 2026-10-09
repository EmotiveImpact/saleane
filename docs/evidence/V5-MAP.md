# V5 · The client map: evidence

Recorded 9 October 2026 in Chromium (Playwright) against the built app (`npm run build && npm start`) with a fresh local database. The owner asked for both a map and the list, then for the map to be richer than the first sketch. A sample studio (main location Marylebone) was used; all names and numbers are fictional. Nothing was deployed and no outside service was used.

## What was exercised

- **The map (sample studio):** Business, Client areas now opens with "On the map" above the list. W1G, NW1 and W2 are drawn as circles at their approximate centres over a sample backdrop of Regent’s Park, Primrose Hill, Hyde Park and the Thames, with the Marylebone location pinned, rings at one and three miles, a scale bar and north.
- **At a glance:** with nothing chosen, the panel beside the map says "Most clients come from W1G (27%)." and "27% of clients come from areas centred within a mile of Marylebone."
- **Choosing an area:** choosing W1G outlines its circle, highlights its row in the list and shows 4 clients (27% of all), 28 visits so far, £2,280 treatment sales and "No earlier figure to compare" (the sample has no visits from the year before).
- **Sales:** switching the circles to Sales resizes them by treatment sales (W1G £2,280, NW1 £1,530, W2 £915).
- **Period:** the page can count the past year or the past 90 days.
- **A real studio:** a studio of your own shows "The map appears once a map service is connected." above the list, which carries on as before.
- **Phone (390px):** no sideways scrolling; the map's words are set larger so they stay readable.
- **Accessibility:** axe (WCAG 2.2 A/AA) finds nothing on the page at either width, after choosing an area, or in a real studio. Each circle can be reached and chosen with the keyboard and shows a focus ring. No console errors.

The full sweep (`scripts/qualify.mjs`) covers 165 pages with 0 axe violations, no sideways scrolling and no missing focus; the only console errors are the three known 401s on the demo account page.

Screenshots: [the map with sales and W1G chosen](V5-MAP-page.png), [on a phone](V5-MAP-390.png), [a real studio before a map service is connected](V5-MAP-off.png).

## Automated checks

- `src/domain/areaMap.test.ts`: the postcode area is found in a location's address (UK with or without the second half, US from a ZIP code); only areas with at least three clients are drawn, at their centres, and the sample's main location is pinned; the change is worked out against the same length of time before, and only when that period also had three or more clients; a real studio has no map, centres or landmarks; distances and the map projection are right.

## How it is kept private

- Only grouped areas with at least three clients are drawn. Smaller areas never reach the map, and no client is placed anywhere.
- Figures for an area (visits, sales, the change) are totals for those clients together.

## Limits

- No map service is connected. A real studio sees the list only; sample studios see approximate area centres and a few drawn landmarks, with no streets.
- The change needs at least three clients from that area in the period before; otherwise it says there is no earlier figure.
- A location is pinned only when its address includes a postcode (or, in the US, a ZIP code).
