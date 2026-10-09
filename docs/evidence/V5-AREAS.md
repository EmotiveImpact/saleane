# V5 · Where clients come from: evidence

Recorded 8 October 2026 in Chromium (Playwright) against the built app (`npm run build && npm start`) with a fresh local database. A sample studio (UK, main location Marylebone) was used; its fictional clients carry sample postcode areas. Nothing was deployed.

## What was exercised

- **The page (owner):** Business has a "Client areas" tab. "Where clients come from." counts 15 clients with a visit in the past year or one booked, 13 with an area recorded (87%), and three named areas: W1G 4 clients (27%), NW1 3 (20%) and W2 3 (20%). "Other areas" holds 3 clients (NW8 with 2 and N1 with 1, each too few to name) and "No area recorded" 2.
- **Recording an area:** on a client's page, the Postcode area panel refused "London" with "Enter the first half of a postcode, such as N1 or SW1A." and saved "n1 9gu" as N1 ("Saved as N1."). The stored record holds N1 and nothing of "9GU".
- **Several locations:** after adding Islington, the page offers All locations, Marylebone and Islington. Islington, with no visits, shows 0 clients and "None yet".
- **Phone (390px):** no sideways scrolling; each bar sits under its area name.
- **Accessibility:** axe (WCAG 2.2 A/AA) finds nothing on the page, at either width, or on the client page. No console errors. (Straight after saving, with the page scrolled, axe flagged two contact-preference checkboxes sitting under the sticky top bar; scrolled back to the top it finds nothing, so this is the scroll position, not the new panel.)

The full sweep (`scripts/qualify.mjs`), now including `/business/areas`, covers 165 pages with 0 axe violations, no sideways scrolling and no missing focus; the only console errors are the three known 401s on the demo account page.

Screenshots: [the page](V5-AREAS-page.png), [on a phone](V5-AREAS-390.png), [the client panel](V5-AREAS-client.png).

## Automated checks

- `src/domain/clientAreas.test.ts`: a UK postcode is cut to its first half and a ZIP code to its first three digits, and anything else is refused; only areas with at least three clients are named and the rest are counted together; clients with only old, cancelled or missed visits are not counted, a client with several visits is counted once, and one location can be counted on its own; recording a full postcode stores only its first half (and none of the rest anywhere in the record), shows in the client's copy of their record, and can be removed; a town name is refused; the desk, managers, the owner and general managers may record an area, practitioners may not.

## How it is kept private

- Only the first half of a postcode is ever stored; the full postcode is cut in the command before it reaches the record.
- An area is named only when at least three clients share it. Smaller areas are added together under "Other areas".
- No one is placed on a map, and nothing is sent to an outside service.
- Practitioners' own view is unchanged and does not include the area.

## Limits

- This is a list with bars, not a drawn map. A drawn map needs an outside map service (map tiles), which is not connected here.
- Areas are recorded by hand on each client's page. Online bookings do not ask for a postcode.
- A map of branches showing how each is doing is covered by the side-by-side whole-business view ([evidence](V5-GROUP.md)); there is no drawn branch map for the same reason.
