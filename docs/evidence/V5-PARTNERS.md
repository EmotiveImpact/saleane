# V5 · Partner access: evidence

Recorded 9 October 2026 in Chromium (Playwright) against the built app (`npm run build && npm start`) with a fresh local database. One studio of its own (not a sample) was registered with a second location, Islington. All names are fictional. Nothing was deployed and no partner was connected.

## What was exercised

- **Settings › Connected software › Access keys:** the panel now says a partner's key can be kept to one location and stop on a day you choose.
- **A key for one branch:** "Islington till", with "Which locations" set to "Islington only", offers only Visits and "Treatments, prices and the team", with the note "A key for one location reads its visits and the treatments and team. Clients and takings belong to the whole studio." With an end date of 31 December 2026, `GET /api/v1/studio` answers 200 with `"locationId"` and `"endsOn":"2026-12-31"`, and `GET /api/v1/clients` answers 403.
- **A key for the accountant:** "Accountant", reading "Takings by day, with no names or receipts", gets 200 from `GET /api/v1/takings?from=2026-10-01&to=2026-10-31` with the currency and one line per day (none yet in this new studio).
- **The list:** "Reads Visits; Treatments, prices and the team, at Islington only. Works until the end of 31 December 2026."
- **Phone (390px) and accessibility:** no sideways scrolling; axe (WCAG 2.2 A/AA) finds nothing on the form, the list or the phone view; no console errors.

Screenshots: [the form](V5-PARTNERS-form.png), [the list](V5-PARTNERS-keys.png).

## Automated checks

`server/partnerApi.test.ts` (partner access) covers: a one-location key refused clients or takings, and refused for an unknown location; a one-location key reading only that location's visits while a key for the main location reads its own; each key's menu leaving out treatments not offered at its location and showing that location's price; the key stopping once its location is closed; an end date in the past or on or after the same date next year refused, and the day before allowed; a key working through the whole of its last day in the studio's time and refused with "end date" after it; takings by day with no client names, the 31-day range limit, and the scope needed. Migration 22 adds `location_id` and `ends_on` to `api_keys`; existing keys keep working with neither set.

## Limits

- Still read only: a partner cannot book, change or cancel through SALEANE.
- Takings are the same daily lines as the accountant's export, for the whole studio. A one-location key cannot read them, because packages, gift cards and product sales at the counter are not tied to one location.
- No real partner (an accountant's software, Square, Lightspeed) has been connected; it needs the app hosted and each partner's own approval. Connecting a chain's existing till to send its sales in is not built.
