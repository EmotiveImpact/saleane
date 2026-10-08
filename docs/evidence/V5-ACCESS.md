# V5 · Access keys for other software: evidence

Recorded 8 October 2026 in Chromium (Playwright) against the built app (`npm run build && npm start`) with a fresh local database. One signed-in studio of its own was used. All names are fictional.

## What was exercised

- **Settings › Connected software › Access keys (owner):** the panel explains that a key can only read what is ticked, never change anything, and stops working the moment it is revoked.
- **Making a key:** "Make an access key", named "Accounts", reading Visits and "Treatments, prices and the team", shows the key once with "Copy it into the other software now. It is shown only this once."
- **Using it:** `GET /api/v1/services` with the key answers 200. `GET /api/v1/clients` answers 403 "This key cannot read that. It needs clients:read."
- **The list:** after a reload the key shows "Starts sal_…", what it reads, who made it and "Last used" with the studio's local time. The key itself is not shown again.
- **Revoking:** "Revoke" says "Revoked “Accounts”. It no longer works." and the same key then gets 401.
- **On a phone (390px):** no sideways scrolling. No console errors. axe (WCAG 2.2 A/AA) finds nothing on the panel, the key shown once or the phone view. The full sweep reports 147 pages with zero violations.

Screenshot: [the key shown once](V5-ACCESS-key.png).

## Automated checks

`server/partnerApi.test.ts` covers: a key reading the studio, visits in a date range (without guest contact details), treatments and the team; clients read only by a key with `clients:read`, with their contact details; the key never listed after it is made, and when it was last used; anything but `GET` refused with 405, ranges over 31 days or backwards refused, a forged or missing key refused, and a revoked key refused on the next request; managers refused, sample studios refused; and each key reading only its own studio.

## Limits

- Read only. Other software cannot book, change or cancel through SALEANE yet.
- Visits, clients, treatments and the team only. Money, packages, gift cards, stock and the other V2 records are not offered yet.
- One studio per key. Group and branch keys wait for several locations (V2).
- Not tried by a real partner. It needs the app hosted.
- Nothing is deleted automatically; a revoked key's row is kept with when it was revoked.
