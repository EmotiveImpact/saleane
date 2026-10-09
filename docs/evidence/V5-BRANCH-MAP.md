# V5 · Branch map: evidence

Recorded 9 October 2026 in Chromium (Playwright) against the built app (`npm run build && npm start`) with a fresh local database. A UK sample studio was registered with three extra locations: Islington (1 Upper Street, London N1 0PN), Notting Hill (12 Ledbury Road, London W11 2AA) and Leeds (4 Briggate, Leeds LS1 6HD). Marylebone and Islington were grouped as a London region with a regional manager. All names are fictional. Nothing was deployed.

## What was exercised

- **Owner, Business, "The whole business":** a new "Where each location stands" map places each location by the postcode in its address. Each pin is sized by the last 28 days' takings and coloured by the change on the 28 days before (green up, grey level or new, rose down), labelled with the name, takings, the change and "Doing best" or "Needs a look" where the list says so. Marylebone read "£4,830 · +383%"; Islington and Notting Hill, with no visits yet, read "£0 · new". The sample landmarks (parks and the river) are drawn underneath.
- **A location the map cannot place:** Leeds has no sample centre, so it is left off with "Not on the map yet, as the map cannot place its postcode: Leeds. Its figures are in the list below."
- **Regional manager:** the London regional manager's page shows the same map with only Marylebone and Islington; the response carries no other location.
- **Screen readers:** the map is one image whose description lists every pin's name, takings and change, so nothing on it is only visual.
- **Phone (390px) and accessibility:** no sideways scrolling; axe (WCAG 2.2 A/AA) finds nothing on either page; the only console message is the expected 401 before the regional manager signs in.

Screenshots: [owner](V5-BRANCH-MAP.png), [on a phone](V5-BRANCH-MAP-390.png), [regional manager](V5-BRANCH-MAP-area.png).

## Automated checks

`src/domain/branchMap.test.ts` covers: each location placed by its postcode (the sample's main location in its sample home area), with its takings, up, level or down, and the best and weakest tags; a location with nothing before marked new; a location with no known centre listed as not placed; no map for a real studio; no map with fewer than two placed locations; and a regional manager's map holding only their region's locations. `server/regional.test.ts` checks a real studio's area view carries no map.

## Limits

- Like the client map, places come from a map service, and none is connected. Only sample studios have a map, drawn from approximate sample postcode centres with no streets; a real studio sees a note and the same figures in the list.
- The map shows the whole-business figures and nothing new; it changes no booking, price or pay.
