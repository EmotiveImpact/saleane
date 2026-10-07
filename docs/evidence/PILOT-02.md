# PILOT-02 · Saved cards, card payments and deposits: evidence

Recorded 7 October 2026 in Chromium (Playwright) against the built app (`npm run build && npm start`) with a fresh local database. No payment provider was configured, so every payment ran in test mode and no money moved.

## What was exercised

- A new non-sample studio (Linden Studio, UK) with a £95 service carrying a £20 deposit, guests allowed to save a card, and a missed visit fee of up to 50%.
- A guest booked through the public booking API, opened the private link on a 390px phone, ticked "Also save my card", paid the £20 deposit on the labelled test payment page with test card 4242, and came back to their visit showing "£20.00 paid", "Thank you. That went through." and "Visa ending 4242 is saved for your visits".
- The desk opened a second visit from Today, chose "Card through SALEANE" at checkout, sent £95 to the test card reader, approved it, and the receipt appeared in the same panel.
- The client profile shows the saved card, its expiry, what the client agreed to, and a remove button. The timeline shows "Deposit paid by card" with the test-mode wording.
- Money refunded the card receipt back to the card; the refund is recorded with the card method.
- Settings, Payments at 1280px and 390px.
- axe (WCAG 2.2 A/AA and best practice) on every screen above: zero violations. No console errors. No sideways scroll at 390px. The full sweep (`scripts/qualify.mjs`, now including Settings, Payments) reports 75 pages with zero violations; the only console errors are the expected 401s on the signed-out demo account page.

Screenshots: [guest page](PILOT-02-guest-390.png), [test payment page](PILOT-02-test-page-390.png), [guest after paying](PILOT-02-guest-paid-390.png), [checkout with the test reader](PILOT-02-checkout-reader.png), [receipt](PILOT-02-receipt.png), [client profile](PILOT-02-client.png), [refund to the card](PILOT-02-money-refund.png), [Settings](PILOT-02-settings.png), [Settings at 390px](PILOT-02-settings-390.png).

## Automated checks

`server/payments.test.ts` covers: a guest deposit and saved card recorded once and refused a second time; a declined test card recording nothing; card payments typed in as ordinary records refused; a saved-card checkout charged once even when the same request is repeated, and refused when the amount is wrong or the visit is already paid; a card reader that records the sale only when approved; a missed visit fee within the policy, then refunded to the card, and no refund beyond what was paid; money taken for a visit cancelled meanwhile left for review instead of forced in; sample studios never taking card payments. It also checks the Stripe adapter: only signed, fresh webhooks accepted; each charge sent with the attempt as its idempotency key; a verified webhook finishing a reader payment through the server; Stripe refusing to start without its keys. `src/domain/fees.test.ts` covers the fee rule (no fee for a cancellation more than 24 hours ahead) and what a guest is offered.

## Limits

- No real payment provider account was used. The Stripe adapter follows Stripe's published API but is unverified against a live account.
- Stripe confirmations arrive by webhook, which needs a public HTTPS address, so they wait for hosting.
- Tap to Pay on a phone needs a native phone app; this web candidate uses card readers instead.
- The public booking page does not yet ask for the deposit at the moment of booking (that screen is being redesigned in another piece of work); guests pay it from their visit link.
- Safari and Firefox were not checked.
