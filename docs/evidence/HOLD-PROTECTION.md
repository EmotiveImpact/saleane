# Public hold protection evidence

Recorded 6 October 2026 on branch `claude/project-thread-n6rot3`, stacked on LOCAL-01. Local only; no live service configured.

## Automated checks

`npm run check` passed: lint, strict TypeScript, application/server/backup builds and 198 tests (138 frontend/domain/store, 60 server). `npm run format:check` passed.

`server/holds.test.ts` tries to hog slots:

- A hold expires after five minutes; the time reappears and the lapsed token cannot book.
- One address holding six times in a morning ends with two active holds; the four earlier times are free again and the replaced tokens cannot book, while the newest still can.
- `replaces` releases the guest's own earlier hold; an unmatched token releases nothing.
- A refused hold (time taken) keeps the visitor's existing holds.
- A burst of seven holds in a minute from one address gets 429 on the seventh, without affecting another address; a minute later it recovers.
- Thirty holds spread over ten minutes from one address are accepted and the thirty-first gets 429 until the hour passes.
- Nine addresses holding nine times reach the studio cap for a three-professional studio; the tenth gets 429, times stay visible, and booking or expiry frees room for a new hold.
- The bot check is off by default and refused without server keys. With Cloudflare's test keys it is still off until the studio switches it on. Once on: no token or a forged token gets 403 with nothing written; the dummy test token passes and the guest's address is sent to siteverify; the always-failing test secret refuses; an unreachable Cloudflare fails closed; switching it off restores plain holds.

`src/pages/ServerBooking.test.tsx` checks that the booking page keeps "Hold this time" disabled until a token arrives, sends it with the hold, and renders a fresh widget after each attempt because tokens are single use.

## Browser pass (Chromium, built server with Cloudflare test keys)

1. With the check off, a guest picked a time and reached the details step.
2. The owner opened the server studio, ticked "Ask online guests to pass a quick bot check before a time is held" in Manage and saved; the public catalogue then reported the test site key.
3. On the booking page the widget could not load because this sandbox blocks `challenges.cloudflare.com`. The page said so and "Hold this time" stayed disabled; a direct API hold without a token returned 403. No page errors.

The widget itself was not seen rendering, because Cloudflare is unreachable from the test environment. Check it once on a machine with internet access using the test keys.
