# V5 · Requests that pass up to the right person: evidence

Recorded 8 October 2026 in Chromium (Playwright) against the built app (`npm run build && npm start`) with a fresh local database. A sample studio was given two more locations, Islington and Leeds, and two regions: London (Marylebone and Islington) and North (Leeds). A regional manager, Rae Area, was invited for London; North has none. All names are fictional. Nothing was deployed and no money moved.

## What was exercised

- **Raising (regional manager):** on their own page, "Ask for a sign-off" offered Marylebone and Islington only and said "Anything over £500, or with no regional manager, goes to the owner." "New basin" for £200 and "Refit the nail bar" for £2,400 were sent at Islington.
- **Routing:** the morning summary added "1 request is waiting for your sign-off." New basin showed "Waiting on you." with a Decide button; the nail bar showed "Waiting on the owner, because it costs more than a regional manager may approve." with no button.
- **Deciding (regional manager):** New basin was approved with "Go ahead, keep the receipt." and moved to Decided as "Approved … by Rae Area", with the note.
- **The owner's Requests tab:** Business, Requests showed the nail bar waiting on the owner with the reason. The owner declined it ("Declined … by Ada Owner"), then set the regional limit to £750 ("Regional managers can now approve up to £750."). A request the owner raised at Leeds showed "Waiting on the owner, because its region has no regional manager."
- **Phone (390px):** the regional manager's page showed "You can approve up to £750 at your locations." with no sideways scrolling.
- **Accessibility:** axe (WCAG 2.2 A/AA) finds nothing on the request form, the decide dialog, the regional page after deciding, or the owner's Requests tab. No console errors beyond the usual 401 before signing in.

The full sweep (`scripts/qualify.mjs`, now including `/business/requests`) covers 159 pages with 0 axe violations; the only console errors are the three known 401s on the demo account page.

Screenshots: [owner's Requests tab](V5-APPROVALS-requests.png), [regional page requests](V5-APPROVALS-area-requests.png), [deciding](V5-APPROVALS-decide.png), [on a phone](V5-APPROVALS-area-requests-390.png).

## Automated checks

- `src/domain/approvals.test.ts`: routing to the region's manager, over the limit, with no region and with no regional manager; a request is decided once; permissions by role.
- `server/regional.test.ts`: a regional manager's request at their location within the limit goes to them even when the browser claims no region has a manager (the server's own list wins); over the limit it passes to the owner and they are refused ("This request has passed up to the owner."); they cannot raise at another region's location; they decide their own once (a second decision is refused); the owner decides one that passed up; a region with no regional manager goes straight to the owner. A manager's request routes to the regional manager, but the manager can neither decide nor change the limit. Reception receives no requests and cannot raise one.

## How it is kept safe

- Where a request goes is fixed when it is raised, on the server, from the access records. A later change of limit or of who looks after a region does not move requests already raised.
- Only the owner changes the limit. The owner can decide any request, including one waiting on a regional manager.
- A regional manager's read and writes still go through the area view and `areaRefusal`; requests at other regions' locations are never sent to them.

## Limits

- A decision is a record only. Approving spending does not pay, order or book anything.
- Nobody is notified by text or email yet; requests show on the Requests tab and in the regional manager's morning summary.
- The browser demo has no access records, so every request there goes to the owner.
