# V1.5 · Private client feedback and ratings: evidence

Recorded 7 October 2026 in Chromium (Playwright) against the built app (`npm run build && npm start`) with a fresh local database. All names are fictional.

## What was exercised

- A new non-sample studio (Linden Studio, UK) with Maya Lind and one client. A visit was booked, welcomed and checked out, then the guest's private visit link was opened at 390px.
- **Guest form:** the completed visit shows "How was your visit?" with star choices for the visit and for Maya and an optional comment. After sending, the page reads "Linden Studio has your feedback: 5 out of 5 for your visit and 4 out of 5 for Maya."
- **Business, Feedback (owner):** visits rated 1, Maya Lind with 1 rating at 4.0 / 5, and the comment under Latest answers. Checked at 1280px and 390px.
- **Settings, Messages:** the new "After checkout, email a private 'how was your visit?' request" choice, on by default.
- axe (WCAG 2.2 A/AA and best practice) on every screen above: zero violations, no console errors, no sideways scroll. The full sweep (`scripts/qualify.mjs`, now including Business, Feedback) reports 99 pages with zero violations and no overflow; the only console errors are the expected 401s on the signed-out demo account page.

Screenshots: [guest form](V15-FEEDBACK-guest-form.png), [guest thank-you](V15-FEEDBACK-guest-thanks.png), [owner page](V15-FEEDBACK-owner.png), [owner page at 390px](V15-FEEDBACK-owner-390.png), [Settings](V15-FEEDBACK-settings.png).

## Automated checks

`src/domain/feedback.test.ts` covers: feedback refused before a visit is complete; one answer per visit, a repeated identical send landing once and a different one refused; ratings outside 1 to 5 and over-long comments refused; staff unable to record feedback for a guest; the ledger check rejecting feedback that does not match its visit; studio and per-professional averages and the period filter; a practitioner's own average released only in groups of three different guests (one regular rating three visits is not enough, and a fourth guest's score cannot be read from a change); the feedback request planned only after checkout, within its window, with email, when switched on and not already answered; feedback in the client export. `server/feedback.test.ts` covers the guest link end to end (closed before checkout, open after, answer stored once, comment never returned to the guest), reception receiving no feedback and a practitioner receiving only their own average. `server/messaging.test.ts` covers the outbox sending one feedback email after checkout with a working private link, skipping a request the guest answered before it went out, and skipping one still waiting two days after checkout. A repeated identical answer leaves the studio record untouched, and a client's erasure review lists their feedback.

## Limits

- The request goes by email only; with no provider connected it waits in the outbox unsent.
- Feedback is not linked to the public Google review request yet; that neutral request is a later 1.5 stage.
- The owner cannot reply to a comment from SALEANE yet.
- Safari and Firefox were not checked.
