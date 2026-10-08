# V1.5 · Versioned consent for email news: evidence

Recorded 7 October 2026 in Chromium (Playwright) against the built app (`npm run build && npm start`) with a fresh local database, in a signed-in sample studio (London). All names are fictional and nothing was sent.

## What was exercised

- **Settings › Messages to guests › Asking about email news (new panel):** the studio starts on SALEANE's standard words, version 1: "I’d like occasional email news and offers from Consent Studio. I can stop them at any time." Changing them to "News of new treatments and the odd quiet-day offer from Consent Studio. Stop whenever you like." and saving shows "Saved as version 2. Guests who agreed before keep the words they saw." Version 1 stays listed under Earlier versions. Saving with no change is not offered.
- **The booking page (390px):** a guest's details step shows the version 2 words beside the optional box. Nadia ticked it and booked. The studio record holds one permission record: email, marketing, agreed, version 2, from the booking page, recorded as "Guest booking".
- **The guest's private link (390px):** an "Email news" part says she agreed to occasional email news and can stop it there, and that visit updates carry on. "Stop email news" shows "Done. Consent Studio will not send you email news. You will still hear about your visits." Her permission is off and a second record says withdrawn, from the guest link, by "Guest (private link)". No sideways scroll.
- **The client's page:** under Communication preference, her history reads "Stopped Wed, 7 Oct from their visit link" and "Agreed Wed, 7 Oct on the booking page", with "Version 2:" and the exact words beside the agreement.
- No console errors. axe (WCAG 2.2 A/AA) finds nothing on the Settings panel, the booking details step, the guest page and the client page. The full sweep (`scripts/qualify.mjs`) reports 141 pages with zero violations.
- While checking the guest page, the "Would you like to come in sooner?" boxes were stacked above their labels on a phone. They now sit beside their labels.

Screenshots: [the wording in Settings](V15-CONSENT-settings.png), [the booking page](V15-CONSENT-booking.png), [the guest's link](V15-CONSENT-guest.png), [after stopping](V15-CONSENT-guest-stopped.png) and [the client's history](V15-CONSENT-client.png).

## How it works

Every command that changes a client's email permission (booking online, the desk ticking or unticking it, editing the client, or the guest stopping it) leaves a record with the channel (email), the purpose (marketing), agreed or stopped, the version of the words agreed to, where it happened, when and who. The record is written in one place after every change, so no path can skip it. The client's on or off setting must always match their newest record, or the studio record is refused. Stopping also suppresses any email news already queued for that guest. Visit updates are a separate purpose and are not affected.

If the studio changes its words while a guest is booking, a ticked box against the old words is refused with "The studio has just changed how it asks about email news. Please read it again." SALEANE's standard words are kept in the studio's name the first time someone agrees to them, so renaming the studio later cannot change what an earlier guest saw.

## Automated checks

`src/domain/consent.test.ts` covers: the words agreed on the booking page; no record when the box is left empty; a tick against changed words refused; new wording versions, earlier words kept and a save with no change ignored; the standard words frozen in the studio's name; desk changes recorded with who made them, and queued email news suppressed on withdrawal; a change made by editing the client; a guest stopping it from their link (only there, and a repeat changes nothing); owners and managers (not reception) changing the words; a record that disagrees with the client refused; and each record with its words in the client's data export.

`server/feedback.test.ts` checks through the API: the public booking page gives the current words and version; booking with the box ticked records version 1 from the booking page; the studio cannot use the guest-only command; and the guest's link stops it, safely repeated, leaving two records.

## Limits

- Email news is the only channel and purpose with these records so far. A guest's appointment emails and texts keep their own on or off settings on the client's page.
- Guests who agreed before these records began show "Agreed before SALEANE kept a record of the words shown".
- A guest can stop email news from their link but not turn it back on there; they can tick the box when they next book, or ask the studio.
- No email is sent: there is no email provider yet, so an unsubscribe link in a real email is still to come.
- Records are never deleted automatically.
- Safari and Firefox were not checked.
