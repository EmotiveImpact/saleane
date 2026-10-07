# V1.5 · Missed-call text-back and "I've arrived": evidence

Recorded 7 October 2026 in Chromium (Playwright) against the built app (`npm run build && npm start`) with a fresh local database. One signed-in sample studio (London) and one real local studio (New York, so a visit could be booked for the next half hour in the evening here). All names and numbers are fictional and nothing was sent.

## What was exercised

- **Today › Missed calls (sample studio):** two calls from the sample data are listed, newest first: an unknown number noted by the desk at 10:41, and Olivia James, matched by her number, who rang twice from 09:04 and came through the phone line. Numbers read as "+44 7700 900456". Typing "07700 900789" and Add puts a third call on the list ("Added to the list to call back."). Typing "hello" is refused with "Enter the caller's number, for example 07700 900123 or +44 7700 900123." Each call has Call (a phone link) and Called back; Called back takes it off the list.
- **Settings › Messages to guests:** a new choice, off by default, "When you miss a call, text the caller once with your booking link". Ticked, saved and still ticked after a reload. The Missed calls panel then says "Each caller is also texted your booking link, once a day." instead of "Texting callers back is off in Settings."
- **"I've arrived" (desk side, sample studio):** Noor Ahmed's 11:00 facial shows "Says they're here" on Today instead of "Upcoming". Opening it reads "Noor tapped "I've arrived" at 10:52. Welcome them when you're ready." with the usual Welcome client button.
- **"I've arrived" (guest side, real studio, 390px):** a guest booked online for 4:00 PM opened their private link at 3:55 PM. Under the visit details: "Here already? Let Hudson Studio know you have arrived, then take a seat." with an "I've arrived" button. After tapping: "Thank you, we know you are here. You told us at 03:55 PM. Take a seat and someone will be with you shortly." With the owner's Today already open in another window, the visit changed from "Upcoming" to "Says they're here" on its own within 30 seconds, with no reload: Today and the calendar look for changes every 30 seconds while on screen and not saving. A guest page opened before the half hour shows the button when the time comes, without a reload.
- **390px:** the Missed calls panel and the guest page fit with no sideways scroll.
- The only console error was the expected 422 from the refused "hello" number. The full sweep (`scripts/qualify.mjs`) reports 135 pages with zero axe violations, no sideways scroll and no missing focus; the only console errors are the expected 401s on the signed-out demo account page.

The text a missed caller gets reads:

```text
Atelier House: sorry we missed your call. We will call you back as soon as we can. If it was about a visit, you can book here: (the studio's booking page) Reply STOP to stop texts.
```

Screenshots: [missed calls on Today](V15-CALLS-today.png), [message settings](V15-CALLS-settings.png), [missed calls at 390px](V15-CALLS-390.png), [Today with a guest who says they are here](V15-ARRIVED-agenda.png), [the visit on the desk](V15-ARRIVED-dialog.png), [guest page before](V15-ARRIVED-guest-before.png) and [after](V15-ARRIVED-guest-after.png).

## Automated checks

`src/domain/arrivals.test.ts` covers: reading UK and US local numbers, international ones (including "+44 (0)…" and "0044…") and refusing anything else; one line per number per day, matched to the client with that number, with repeat calls counted, until someone calls back; who recorded it and who called back; the client's export and erasure review; refusing a new call rather than dropping an old one when the list is full; reception allowed and practitioners not; the text planned once, within 15 minutes of the latest call, only when switched on and texts are on, with no second text that day however often they ring; never to a client who asked for no texts, nor after a call back; no booking link when online booking is off. For "I've arrived": open from 30 minutes before until the visit ends, on the day only; recorded once with a timeline entry from the guest's link; the desk still welcomes them; no studio role can send it; practitioners see it on their own day; and it is forgotten when the visit moves.

`server/calls.test.ts` checks through the API with a controlled clock: one text to the caller's number with the studio's booking page, stored without the address it was sent with, and none for a second or later call that day; the text skipped, with a reason, when someone calls back before it goes; the phone line callback refused without a valid signature, ignored for an answered call, a withheld number or an unknown studio, and a missed call written down and texted; the Twilio signature checked against the studio's own address; and "I've arrived" refused too early, accepted from half an hour before, repeated safely, and refused from a studio account. `server/database.test.ts` checks migration 13 lets the outbox hold the new kind and keeps messages already recorded.

## Limits

- The missed-call text is off until the studio switches it on. It is a reply to someone who has just rung, by text only, at most once a day per number, and never to a client who asked for no texts. Every text says how to stop. Recording a STOP reply automatically needs the live text provider and is not built yet.
- Calls come from the desk's "Log a missed call" unless the studio's line runs through Twilio. The Twilio callback (`/api/hooks/twilio/voice/<studio>`, set as the Dial action) is written against Twilio's documented callback and signature but has not been run against a real Twilio account. It only works when Twilio also sends the studio's texts.
- Nothing is removed automatically: calls from the same number on the same day share one entry, and the record holds 5,000 entries, after which a new call is refused rather than an old one dropped. A way for an owner to clear old calls will come with the deletion approval step. Open calls show on Today for a week. Calls matched to a client are in their data export and their erasure review.
- "I've arrived" only tells the desk. It does not mark the guest as in the studio, take a patch test or payment step, or notify anyone by sound or message; the desk sees it on Today, the calendar and the visit.
- With no text provider configured, texts stay in test mode and are not sent.
- Safari and Firefox were not checked.
