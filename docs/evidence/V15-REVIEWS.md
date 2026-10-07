# V1.5 · Neutral review requests and room resting time: evidence

Recorded 7 October 2026 in Chromium (Playwright) against the built app (`npm run build && npm start`) with a fresh local database, in a signed-in sample studio (London). All names and addresses are fictional and nothing was sent.

## What was exercised

- **Settings › Studio details:** a new field, "Public review page (optional)", with the note "Every guest is invited to leave a public review here after their visit, in the same words whatever they told you privately." The sample studio starts with a fictional review page. Saving "http://not-secure.example" is refused with "Enter the review page as a full web address starting with https://."; saving an https address keeps it. Emptying the field removes it.
- **Guest page after a completed visit (390px):** the desk issued a private link for a visit, then welcomed and checked the guest out. The guest's page shows the private rating form as before, then "Tell others about your visit": "If you would like to, you can leave a public review for Review Studio. Every guest gets this same invitation." with a "Leave a public review" button that opens the studio's page in a new tab. No sideways scroll. The section only appears once a visit is complete and the studio has a review page.
- **Settings › Spaces & equipment:** editing Treatment room 1 now has "Resting time after each visit" (None, or 10 to 120 minutes empty), with the note "The space stays empty this long after each visit, for airing, cooling or a deep clean. The professional is free to work elsewhere. Visits already booked stay as they are." Choosing 30 minutes and saving shows "Treatment space · rests 30 minutes after each visit" in the list.
- The only console error was the expected 422 from the refused address. The full sweep (`scripts/qualify.mjs`) reports 135 pages with zero axe violations, no sideways scroll and no missing focus; the only console errors are the expected 401s on the signed-out demo account page.

The feedback email gains one line when the studio has a review page, the same for every guest:

```text
If you would like to tell others about your visit, you can also leave a public review: (the studio's review page)
```

Screenshots: [the review page setting](V15-REVIEW-settings.png), [the guest page](V15-REVIEW-guest.png), [the room editor](V15-REST-editor.png), [the rooms list](V15-REST-list.png).

## Automated checks

`src/domain/reviewsAndRest.test.ts` covers: only plain https addresses with no sign-in details are accepted, and a stored address that is not https never loads; setting, keeping (saving details without the field) and removing the link; every completed visit offered the same link whether or not the guest rated it, and none before the visit or without a link; the feedback email line present only when a link is set and only in the feedback email; a room with no rest free straight after a visit; a resting room kept empty after a visit, with the visit going to another free room instead; the rest also kept before the next visit; the professional free to go straight on in another room; and resting time accepted only in five-minute steps up to two hours.

`server/feedback.test.ts` checks through the API: the owner sets the link, the guest's private page offers it after checkout, a one-star private rating leaves the invitation exactly the same, and a `javascript:` address is refused.

## Limits

- SALEANE never asks for a good review, never filters who is invited by their private rating, and does not read or count public reviews. The studio pastes its own page (Google, Trustpilot or another); nothing is checked against those services.
- The invitation is shown on the guest's private page and added to the feedback email; there is no separate review email or text.
- Resting time applies to new bookings and moves only. Visits already booked stay where they are, even if they now sit inside a rest. The rest is not drawn on the calendar.
- Safari and Firefox were not checked.
