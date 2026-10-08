# V5 · Connected software: evidence

Recorded 8 October 2026 in Chromium (Playwright) against the built app (`npm run build && npm start`) with a fresh local database and connections in test mode (the default). Two signed-in studios were used: a studio of its own (London) and a sample studio. All names are fictional and nothing left the computer.

## What was exercised

- **Settings › Connected software (studio of its own, owner):** the section explains what it does and says "Test mode: each event is signed and listed below as it would be sent. Nothing leaves this computer." The log says "Nothing yet."
- **An unsafe address:** "Connect software" with `http://hooks.example.test/catch` is refused with "The address must start https://, so what is sent cannot be read on the way."
- **Connecting:** the same with `https://…`, "A visit is booked" and "A new client is added" ticked and guest details left off, shows the signing secret once with "Copy it into the other software now. It is shown only this once." The connection lists its address, its events and "Guest names and contact details are left out."
- **Events:** adding a client and pressing "Send a test" gives two rows in "What was sent": "Test event to Zapier" and "A new client is added to Zapier", each "Test mode, not sent", with the studio's local time and "Test mode: signed and recorded. Nothing was sent."
- **Off switch:** "Turn all off" turns the connection off and offers "Turn on".
- **On a phone (390px):** the section stacks and the page does not scroll sideways.
- **A sample studio:** the section says "A sample studio never sends anything outside SALEANE. Connect other software from a studio of your own." and offers nothing to connect.
- The only console error was the expected 400 for the refused address. axe (WCAG 2.2 A/AA) finds nothing on the secret, the log, the phone view or the sample studio. The full sweep (`scripts/qualify.mjs`) now includes this section in every mode and reports 147 pages with zero violations.

Screenshots: [the secret shown once](V5-CONNECTIONS-secret.png), [the delivery log](V5-CONNECTIONS-log.png) and [on a phone](V5-CONNECTIONS-phone.png).

## Automated checks

`server/connections.test.ts` covers, through the server: a booking and a cancellation each sent once, signed with the secret (checked independently with HMAC-SHA256), with the studio's local date and time and no guest name or contact details; guest details included only for a connection that shares them; nothing sent for events a connection did not choose; an event recorded and then turned off before it went out logged as not sent; "Turn all off", a test event, and a removed connection keeping its log and refusing changes; a busy answer (503) and no answer tried again on the backoff and stopped after five tries, and a 410 refusal not tried again; a renewed secret used for the next delivery and different from the old; managers refused, an `http://` address refused, and sample studios refused; test mode by default, sending nothing; and private, local and mapped addresses refused with redirects not followed.

`src/domain/connectionEvents.test.ts` covers which change gives which event (booked, moved, cancelled, checked out, missed, new client), nothing for other changes, and guest details only when shared.

## Limits

- `SALEANE_CONNECTIONS=live` has not been run against a real Zapier hook or any real receiver. It needs the app hosted to be useful.
- Events cover visits and new clients. Payments, packages, gift cards, stock and the other V2 records are not sent yet.
- One delivery loop runs per server; events wait up to the loop interval (30 seconds) unless a change nudges it.
- Only the owner can connect software. There is no API for other software to read from or write to SALEANE yet.
- A restored backup may resend events that were waiting when the backup was taken; the receiving end should dedupe on `Saleane-Delivery`.
- Nothing is deleted automatically, including the delivery log. Safari and Firefox were not checked.
