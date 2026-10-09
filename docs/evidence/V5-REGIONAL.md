# V5 · Regional managers: evidence

Recorded 8 October 2026 in Chromium (Playwright) against the built app (`npm run build && npm start`) with a fresh local database. A sample studio was given two more locations, Islington and Leeds, and two regions: London (Marylebone and Islington) and North (Leeds). All names are fictional. Nothing was deployed.

## What was exercised

- **Inviting (owner):** under Settings, Team, Workspace access, "Regional manager" appears as an access choice once the studio has regions, with "Looks after" to choose the region. An invitation for London was created and listed under pending invitations. Existing members can be moved to "Regional manager · London" or "· North" from the same list.
- **Joining:** the invitation link opened the join form; after "Join studio" the new account went straight to its own page at `/area/…`, never the studio workspace.
- **The regional manager's page:** "Good evening, London." with the business date, then "Your area today": "Across 2 locations, completed visits took £4,830 in the last 28 days, up 383% on the 28 days before.", "This month so far: £1,105 taken, with £1,100 more booked but not yet taken.", "Today, 10 visits are booked across London.", "1 thing from branch visits still to put right." and "Due a branch visit: Islington (not yet visited)." Each location shows booked today, the last 28 days, the change, rebooking and the month. Leeds is nowhere on the page.
- **Branch visits:** "Start a branch visit" offered Marylebone and Islington only. A visit to Islington with one line answered no was saved ("Visit to Islington saved, with 1 thing to put right.") and that line was then marked put right.
- **Everything else is shut:** the studio's team list answered 403 to the regional manager's session.
- **Phone (390px):** figures wrap into two columns; no sideways scrolling.
- **Accessibility:** axe (WCAG 2.2 A/AA) finds nothing on the owner's invitation form, the regional page, or the page after saving. No console errors beyond the usual 401 before signing in.

Screenshots: [invitation](V5-REGIONAL-invite.png), [the regional page](V5-REGIONAL-area.png), [on a phone after a visit](V5-REGIONAL-390.png).

## Automated checks

`server/regional.test.ts`: an invitation needs a region with an open location; the read is the area view only, with no studio record, no other region's location, no client ids or emails, and no appointments, payments, sales or pay rates; every other studio route the owner can open (team, day sheet, outbox, audit, connections, access keys, social, assistant, Google, privacy export and others) answers 403, as do Ask Saleane and guest links; branch visits only at their own locations, fixes only on their own visits, and no other command (not even a client note); moving them to another region changes what they see; removing their region leaves them with nothing; changing them to reception gives the desk view again. `server/database.test.ts`: migration 20 keeps every membership and invitation, and a regional manager must name a region while no other role may.

## How it is kept safe

- The role is `regional`, separate from `manager`, so every existing check written for managers leaves them out.
- `orgFor` refuses a regional manager on every route unless the route asks for the area view; only reading the workspace and saving a command do. A new route is closed to them until someone opens it on purpose.
- The workspace read for a regional manager is built on the server from their region only (`src/domain/area.ts`), as the practitioner's is; the screen never holds the studio record.

## Limits

- A regional manager covers one region. Requests for a sign-off were added in the next stage ([evidence](V5-APPROVALS.md)); a general manager with full control of one branch is a later V5 stage.
- The figures are the same as the whole-business view: completed service takings, with booked visits shown apart.
- They cannot change their password from their own page yet.
