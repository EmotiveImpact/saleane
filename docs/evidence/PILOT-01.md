# PILOT-01 · Appointment messages: evidence

Recorded 7 October 2026 in Chromium (Playwright) against the built app (`npm run build && npm start`) with a fresh local database. No email or text provider was configured, so every message ran in test mode and nothing was sent.

## What was exercised

- A new non-sample studio (Linden Studio, UK) with one room, one service and one professional, set up through the same commands the Settings page uses.
- A guest booked through the public booking API for 10:00 on 8 October. Within a few seconds the outbox recorded a booking confirmation by email and by text, both marked "Test mode, not sent".
- The Inbox "Sent for you" list, the client's profile ("Appointment messages" and the email and text switches) and Settings, "Messages to guests", at 1280px and 390px.
- axe (WCAG 2.2 A/AA and best practice) on each of those pages: zero violations. No console errors. No sideways scroll at 390px.

Screenshots: [Inbox](PILOT-01-inbox.png), [Inbox at 390px](PILOT-01-inbox-390.png), [client profile](PILOT-01-client.png), [Settings](PILOT-01-settings.png), [Settings at 390px](PILOT-01-settings-390.png).

## Automated checks

`server/messaging.test.ts` covers: one confirmation per channel with a working private link (and the booking page link still working); the day-before reminder only once; new-time and cancellation notices; sample studios never sending; studio and client switches; a message skipped when its visit changed after planning; retries for a busy provider, a stop at a refusal and no automatic resend of an unclear send; delivered only on a verified receipt; practitioners kept out of the outbox. It also checks the Postmark and Twilio adapters against simulated provider answers and the Twilio signature check. `src/domain/reminders.test.ts` covers the pure plan.

## Limits

- No real provider account was used. The Postmark and Twilio adapters follow their published APIs but are unverified against a live account.
- Delivery receipts need a public HTTPS address, which waits for hosting.
- Manually written Inbox drafts are still not sent; only automatic appointment messages use the outbox.
- Safari and Firefox were not checked.
