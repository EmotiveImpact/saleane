# OFF-01 evidence: read-only offline day sheet

Recorded 6 October 2026 on branch `claude/project-thread-lszoe0-offline`. Status: in review (draft PR), not released. Requirement: [PRD section 16](../PRD.md) and the OFF-01 row.

## What was built

- **Projection.** `src/domain/daySheet.ts` builds a strict, zod-checked day sheet; `server/routes/daysheet.ts` serves it at `GET /api/workspaces/:id/day-sheet` (registered with one line in `server/app.ts`). Membership, role and linked professional come from the server, as in every other workspace route.
- **Fields.** Owner, manager and reception: today's non-cancelled visits for the studio with start and end time, service, professional, room, status, client name and phone. Practitioner: only their own visits, client name, no phone and no professional column. Never email, consent, preferences, notes, prices, deposits, receipts, payments, exports or marketing lists. Each sheet carries `generatedAt` and `expiresAt`.
- **Expiry.** Today's closing time in venue time, or midnight once the venue has closed, and never more than 12 hours after the sheet was made.
- **Client storage.** In memory and in session storage for the current tab only (`saleane.day-sheet.v1`), keyed by account and studio. Nothing goes to local storage. The sheet is cleared on sign-out (even if the sign-out request cannot be sent), studio change, return to the demo, region change, expiry, a restored sheet for a different account, and when reconnecting finds changed access. A "Remove from this tab" button clears it on request.
- **Offline state.** A request that cannot reach the service (network failure, 502 or 504), or the browser's `offline` event, switches a signed-in studio to the offline screen: "Offline. Showing the day sheet saved at 21:43, valid until …. Changes are paused." The workspace screens are not rendered, so no write control is reachable, and the store also refuses commits while offline or reconnecting. The tab retries every 15 seconds, on the browser's `online` event and on "Try again".
- **Reconnect.** Checks `/api/session`, confirms the studio is still among the account's memberships, reloads the studio (desk roles) and fetches a fresh sheet, all before the workspace returns. If the session ended or access changed, the sheet is cleared and the studio is blocked with an explanation.
- **Paper fallback.** `/day-sheet` shows the sheet with print styles (actions hidden). Linked from Today and from the practitioner day.
- **Browser demo.** With no server, `/day-sheet` builds the same sheet from the fictional records in the browser (not saved) and offers "Preview the offline view".

## Defaults for the owner to confirm

1. Only today's visits; tomorrow morning is not included.
2. Cancelled visits are left out; missed and completed visits stay with their status.
3. Desk roles see client phone numbers; practitioners do not.
4. Notes are not offered offline at all yet; the PRD's opt-in, field-scoped notes are not built.
5. Expiry at closing time or midnight, capped at 12 hours.
6. Tab-only storage; offline retry every 15 seconds.

## Deliberately not enabled

Pending a threat review, as the PRD requires: persistence beyond the tab (closing the tab removes the sheet), an app-shell service worker and a device policy. Without a service worker, a tab **reloaded or opened while the service is down cannot load the app at all**; the offline sheet only serves a tab that was already open. Print the paper copy while connected if that matters.

**Offline revocation is not instantaneous.** If the owner removes someone or changes their role, a sheet already in their tab stays readable until it expires or the tab reconnects. The server refuses the next request immediately.

## Automated checks

- `src/domain/daySheet.test.ts` (6): desk fields and order; no email, money, consent, preferences, notes or other days; practitioner own visits and no phone; archived or unlinked practitioner refused; forged phone or extra fields rejected by the schema; cancelled visits left out; expiry at closing in venue time, midnight after closing, the 12-hour cap and the fixed-date sandbox.
- `server/daysheet.test.ts` (4): owner, manager and reception reads without email or money fields; practitioner scope; signed-out 401, other studio 404 (owner and practitioner), POST 405; role change to another professional, to reception and removal (404) take effect on the next request.
- `src/state/offline.test.tsx` (9): tab-only storage keyed to account and studio; offline banner after a failed write with no workspace write control and no further command request; browser `offline` event; reconnect stays offline while unreachable, then checks session, studio and day sheet in that order and replaces the sheet; removed access clears the sheet and blocks the studio; sign-out clears it even if the request fails; demo and studio change clear it; expired or foreign sheets are not restored; demo sheet and offline preview.
- Existing `PractitionerDay.test.tsx` mock store gained the two new fields.
- `npm run check`: lint, 165 frontend/domain/store tests, 64 server tests and all builds passed. `npm run format:check` passed.

## Chromium journey

Built app served by `npm start`'s server (`node server-dist/index.js`) on 127.0.0.1:5243 with a scratch database, driven by Playwright Chromium. Log: [off01-browser.json](off01-browser.json).

1. Registered an owner with the fictional sample studio and opened Today. "Day sheet" opened `/day-sheet`: 12 visits, columns Time, Client, Service, Professional, Room, Status; "Last synced at 21:43 · valid until Wed, 7 Oct, 00:00 · read-only" (after closing, so midnight). Print media hides the actions.
2. Tab storage held `saleane.workspace` and `saleane.day-sheet.v1` in session storage; local storage was empty. Visit fields: id, start, end, service, professional, room, status, client name and phone; no `@` and no money fields.
3. **Stopped the server process** and pressed "Refresh records". The offline screen replaced the workspace: "Offline. Showing the day sheet saved at 21:43, valid until Wed, 7 Oct, 00:00. Changes are paused." No "New appointment" button was present. Screenshots: [desktop](off01-offline-desktop.png), [390px](off01-offline-mobile.png) (no horizontal overflow).
4. "Try again" with the server still down stayed offline. Restarted the server on the same database; "Try again" brought the workspace back and the saved sheet had a new sync time.
5. `context.setOffline(true)` showed the offline screen; `setOffline(false)` revalidated and returned the workspace without a click.
6. Signed out from `/account`: the sheet was gone from session storage.
7. A practitioner invited to Maya Lewis (390px): sheet audience `practitioner`, 4 visits, no `clientPhone` anywhere, columns Time, Client, Service, Room, Status.

## Not checked

- Safari and Firefox, screen readers and keyboard-only use of the offline screen.
- An actual paper print or PDF output; only print media styles were sampled.
- Expiry firing in a live tab (covered by unit logic only), DST days in the browser, and a US studio in the browser.
- Behaviour behind a proxy that returns other error codes when the service is down (only network failure, 502 and 504 count as unreachable).
- The Vite development server with the API down.
