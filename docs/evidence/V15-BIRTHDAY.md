# V1.5 · Birthday and "we miss you": evidence

Recorded 7 October 2026 in Chromium (Playwright) against the built app (`npm run build && npm start`) with a fresh local database and a signed-in sample studio. All names are fictional and nothing was sent.

## What was exercised

- **Client page:** a new Birthday panel with Month and Day choices, "Not shared" by default. Choosing 30 February greys out "Save birthday" and says "That date does not exist. Choose another day." Choosing 29 February saves ("Birthday saved."), is still there after a reload, and adds "Birthday recorded" to the client's timeline. The panel says month and day only, never the year, and whether a birthday email will go given the client's agreement to hear from the studio.
- **Settings › Messages to guests:** two new choices, both on by default: a birthday email to guests who agreed and shared the date, and one "we miss you" email after a long gap. "A long gap is" offers two, three (default), four or six months without a visit; four months saved and stayed after a reload. The note underneath says due back, birthday and "we miss you" emails go only to guests who agreed to hear, by email only.
- **390px:** the birthday panel fits with no sideways scroll.
- No console errors throughout. The full sweep (`scripts/qualify.mjs`) reports 135 pages with zero axe violations, no sideways scroll and no missing focus; the only console errors are the expected 401s on the signed-out demo account page.

The emails depend on the date, so they were checked in the automated tests below with a controlled clock. For a sample guest they read:

```text
Happy birthday from Atelier House

Hello Amelia,

Everyone at Atelier House wishes you a very happy birthday. We hope it is a lovely day.

If you fancy a treat this month: (the studio's booking page)

You are hearing this because you said we could keep in touch. To stop these, reply to this email or tell us at your next visit.

Atelier House
```

```text
We miss you at Atelier House

Hello Amelia,

It has been a little while since your last visit, and we would love to see you again whenever you are ready.

Book when it suits you: (the studio's booking page)

You are hearing this because you said we could keep in touch. To stop these, reply to this email or tell us at your next visit.

Atelier House
```

Screenshots: [client birthday](V15-BIRTHDAY-client.png), [message settings](V15-BIRTHDAY-settings.png), [at 390px](V15-BIRTHDAY-390.png).

## Automated checks

`src/domain/keepInTouch.test.ts` covers: 29 February falling on the 28th outside leap years; the birthday email planned once on the day, in the daytime, with no visit attached, and not again that year; not without agreement on every record with the same email, not when turned off, and only one per guest with several records; recording, repeating (no new timeline entry), clearing and refusing impossible dates, with reception allowed and practitioners not; "we miss you" planned once from three months after the last visit and only for a month after that, so long-lapsed guests are not all emailed when a studio switches it on; not with anything booked, without agreement or when turned off; the chosen gap; never while a due back note could still be on its way; and asking guests to get in touch when online booking is off.

`server/messaging.test.ts` checks through the API with a controlled clock that the birthday email goes once on the day to the guest's address with the studio's booking page, recorded with no visit; and that a planned "we miss you" email is skipped, with a reason, when the guest books before it goes. `server/database.test.ts` checks migration 12 lets the outbox hold both kinds and keeps the messages already recorded.

## Limits

- Email only, and only to guests who agreed to hear from the studio. No offer or discount is attached.
- The birthday is entered by the studio on the client page; guests cannot add it themselves yet. The year is never stored.
- Stopping is by replying or telling the studio, who untick the agreement; there is no one-click unsubscribe link yet.
- With no email provider configured both stay in test mode and are not sent.
- Safari and Firefox were not checked.
