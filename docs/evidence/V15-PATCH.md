# V1.5 · Patch tests: evidence

Recorded 7 October 2026 in Chromium (Playwright) against the built app (`npm run build && npm start`) with a fresh local database and a signed-in sample studio. All names are fictional and nothing was sent.

## What was exercised

- **Today (owner):** "Patch tests to sort" lists the two Gloss & Tone visits in the next fortnight that are not in order: Grace Chen on Friday, whose test from Monday has no result yet, and Luca Evans on Saturday, who has no test.
- **Record a test:** on Luca's page the Patch tests panel says his Saturday colour needs a test at least 48 hours before. In "Record a patch test" (where "Done by" starts as "Not recorded", with the colour team listed first) the "Skin checked?" choice offers "Clear (after 48 hours)", greyed out, for a test done today. With the date moved back three days it offers "Yes, clear"; saving that with "No redness" makes his Saturday visit read "Patch test clear on Sunday 4 October".
- **The 48 hour wait:** a test recorded today for another client shows its result to come. "Record the result" keeps Clear greyed out and says "It can be called clear from Thursday 8 October, 15:00. Record a reaction straight away if one shows." A reaction can be recorded at once.
- **A reaction:** on Grace's page, recording her waiting test as a reaction with "Redness and itching" makes her Friday visit read "Reacted to a patch test on Monday 5 October", and Today now lists only her, as "Reaction recorded".
- **On the visit:** Ellie Brooks's Thursday colour shows "Patch test clear on Sunday 27 September" in the appointment panel.
- **Settings › Services:** Gloss & Tone reads "Needs a patch test", its edit form has the box ticked, and the Patch tests rules (48 hours, 6 months, reminders on) save; the months were changed to 12.
- **Booking page:** Gloss & Tone says "Needs a patch test at least 48 hours before".
- **390px:** the panel fits with no sideways scroll.
- No console errors throughout. The full sweep (`scripts/qualify.mjs`, whose Today and client pages now include the patch test panels) reports 111 pages with zero axe violations, no sideways scroll and no missing focus; the only console errors are the expected 401s on the signed-out demo account page.

Screenshots: [Today](V15-PATCH-today.png), [test needed](V15-PATCH-needed.png), [the form](V15-PATCH-form.png), [result to record](V15-PATCH-waiting.png), [clear](V15-PATCH-clear.png), [reaction](V15-PATCH-reaction.png), [on the visit](V15-PATCH-visit.png), [rules in Settings](V15-PATCH-settings.png), [service form](V15-PATCH-service.png), [booking page](V15-PATCH-booking.png), [at 390px](V15-PATCH-390.png).

## Automated checks

`src/domain/patchTests.test.ts` covers: where each sample colour visit stands and which ones Today lists; recording a test and its result on the timeline with who did each; a test too close to the visit and a clear test that has run out; a reaction stopping arrival until a later clear test, while other treatments are never stopped; a test called clear only once the full 48 hours have passed, while a reaction is taken straight away, both for a result recorded later and one recorded with the test; refusing a test in the future, a second different result and an unknown client, with a repeated identical result changing nothing; practitioners limited to their own clients and their own tests, including recording results only for tests they did, and only owners and managers changing the rules; the studio rules; the reminder planned once on each channel, not again once recorded or when the visit moves (unless the first one was skipped; a failed one is not queued again), sent after a reaction until a new test is done, not after a test, not within 48 hours of the visit and not when turned off; the export (dated in the studio's time zone) and erasure review; and ledger checks for another studio's or an unknown client's test.

`server/practitioner.test.ts` checks a practitioner records a test for their own client through the API and is refused for another client, as someone else, or for the studio rules. `server/messaging.test.ts` checks a local studio plans the patch test message on both channels for a colour booking, and skips it when a test is recorded before it goes out, asks again once that test shows a reaction, and sends the studio's current waiting time if the rules change while it is queued (migration 9 lets the outbox hold this kind of message).

## Limits

- A salon record, not a clinical one. It holds the product, the date, who did it, where it was placed and what was seen. It does not hold medical history, and the form says so.
- A test can be called clear only once the studio's waiting time (48 hours by default) has passed since it went on.
- Only a recorded reaction stops a visit. A missing, waiting or too-close test is shown to the team, who decide.
- The reminder asks the guest to call or pop in; guests cannot book a patch test online yet.
- With no email or text provider configured the reminder stays in test mode and is not sent.
- Nothing is deleted. Tests are kept in the client's record and listed as kept in the erasure review.
- Safari and Firefox were not checked.
