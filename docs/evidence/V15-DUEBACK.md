# V1.5 · Due back and aftercare: evidence

Recorded 7 October 2026 in Chromium (Playwright) against the built app (`npm run build && npm start`) with a fresh local database and a signed-in sample studio. All names are fictional and nothing was sent.

## What was exercised

- **Settings › Services:** Signature Cut & Finish has a new "Usually back after (weeks)" field, empty by default, with the note "Optional. Guests who agreed to hear from you get a gentle note when they are due." Saving 5 kept 5; clearing it and saving left it empty again. Gloss & Tone reads 6.
- **Settings › Studio details:** the "Before and after a visit" panel groups each treatment with a Before note and an "Aftercare, emailed after the visit" note. The sample facial and Gloss & Tone have aftercare; adding some for Deep Restore Massage saved and was still there after a reload.
- **Settings › Messages to guests:** two new choices, both on by default: emailing the treatment's aftercare advice after checkout, and emailing guests who agreed to hear when they are due back. The note underneath now says the due back email goes only to guests who agreed, by email only.
- **390px:** the notes panel fits with no sideways scroll.
- No console errors throughout. The full sweep (`scripts/qualify.mjs`) reports 135 pages with zero axe violations, no sideways scroll and no missing focus; the only console errors are the expected 401s on the signed-out demo account page.

The emails themselves depend on the clock (half an hour after checkout; weeks later), so they were checked in the automated tests below with a controlled clock rather than in the browser. For the sample Gloss & Tone they read:

```text
Looking after your Gloss & Tone

Hello Ellie,

Thank you for coming in. Here is how to look after your Gloss & Tone over the next few days.

Wait two days before washing your hair, then use a colour-safe shampoo and cool water.

If anything feels wrong, please call us. For anything urgent, contact a medical professional.

Atelier House
```

```text
Time for your next visit to Atelier House?

Hello Ellie,

It is about 6 weeks since your Gloss & Tone with Theo, which is usually when guests come back for the next one.

Book when it suits you: (the studio's booking page)

You are hearing this because you said we could keep in touch. To stop these, reply to this email or tell us at your next visit.

Atelier House
```

Screenshots: [service form](V15-DUEBACK-service.png), [aftercare notes](V15-DUEBACK-aftercare.png), [message settings](V15-DUEBACK-settings.png), [at 390px](V15-DUEBACK-390.png).

## Automated checks

`src/domain/dueBack.test.ts` covers: aftercare planned once, not before half an hour or after two days, not for a treatment without advice or when turned off, and saved and cleared without touching the Before notes; the due back email planned once from three days before the date the treatment sets until two weeks after, only in the daytime on the studio's clock, with the booking link; not without consent, without a return time, when turned off, with anything booked or after a later visit; records with the same email treated as one guest (a booking, a later visit or a "no" under any of them stops it); a request to get in touch when online booking is off; the Today due back list following the treatment's weeks; and setting, keeping and clearing a treatment's weeks.

`server/messaging.test.ts` checks, through the API with a controlled clock, that aftercare goes by email half an hour after checkout and before the feedback request, with no manage link; that the due back email goes once on 14 November for a six-week treatment done on 6 October, with the studio's real booking page address in place of the placeholder; and that it is skipped, with a reason, when the guest books again after it was planned but before it went. `server/database.test.ts` checks migration 11 lets the outbox hold both new kinds and keeps the messages already recorded.

## Limits

- Email only. Neither message goes by text.
- Due back needs the guest's marketing agreement, recorded when they book or on their client page. Stopping it is by replying or telling the studio, who untick it; there is no one-click unsubscribe link yet.
- Online booking creates a new client record each time, so records are matched by email to avoid asking a guest who has already booked.
- Aftercare is practical advice the studio writes, not clinical guidance.
- With no email provider configured both stay in test mode and are not sent.
- Safari and Firefox were not checked.
