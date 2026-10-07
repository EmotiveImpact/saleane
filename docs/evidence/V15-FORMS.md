# V1.5 · Guest forms before a visit: evidence

Recorded 7 October 2026 in Chromium (Playwright) against the built app (`npm run build && npm start`) with a fresh local database, in a signed-in sample studio (London). All names and answers are fictional and nothing was sent.

## What was exercised

- **Settings › Guest forms (new section):** the sample studio has one form, "Before your cut", for Signature Cut & Finish, asked before every visit, three questions, version 1, one answer so far. Each form can be edited or stopped ("Stop asking"); answers already given stay.
- **Adding a form:** "Welcome to the studio". Typing "Do you have any allergies?" as a question shows "This form mentions “allergies”. Forms here are for everyday questions, so they cannot ask about health. Patch tests have their own record." and Save stays off until it is changed. With "How did you find us?" (pick one: A friend, Instagram, Google; must be answered), "Would you like a quiet visit?" (yes or no), "I have read the cancellation policy." to agree to, asked once per guest and for every service, it saved and listed as "Every service · Asked once per guest · 2 questions · Version 1 · 0 answers so far".
- **The desk:** Grace's 11:00 cut shows a Forms part on the visit: "Welcome to the studio: waiting for the guest. They can fill it in from their visit link." and "Before your cut: filled in Tue, 6 Oct", which opens to her three answers ("A small change", her note, "Yes" to a quiet appointment).
- **The guest (390px):** Luca's private link for his cut shows both forms under the visit details. Sending "Before your cut" without the required answer says "Please answer “What would you like this time?”." Choosing "Something new" with a note and sending shows "Thank you, Form Studio has this form." The welcome form, agreed by typing "Luca Moretti", went the same way. Both answers are in the studio record, the second with the typed name. No sideways scroll.
- No console errors. axe (WCAG 2.2 A/AA) finds nothing on the guest page with forms, the form editor and the visit window, at 1280px and 390px. The full sweep (`scripts/qualify.mjs`, now including Settings › Guest forms) reports 141 pages with zero violations, no sideways scroll and no missing focus; the only console errors are the expected 401s on the signed-out demo account page.

Confirmations and reminders for a visit that still waits for a form gain a line, and the text version says the same in fewer words:

```text
Before your visit, please fill in a short form (Before your cut) from the link below.
```

Screenshots: [Settings › Guest forms](V15-FORMS-settings.png), [the form editor](V15-FORMS-editor.png), [answers on the visit](V15-FORMS-desk.png), [the guest filling it in](V15-FORMS-guest.png) and [after sending](V15-FORMS-guest-done.png).

## Automated checks

`src/domain/forms.test.ts` covers: health words (allergies, pregnancy, medical conditions, medication and others) refused while everyday questions pass; a form asked before an upcoming visit and answered once from the guest's link, recorded on the visit's timeline as the guest; the guest page saying only that the studio has the form, never repeating the answers; a repeated identical send changing nothing and a different one refused; required answers, the listed choices, yes or no, a typed name to agree, a changed version and unknown questions all checked; a change of wording making version 2 (by the person who saved it) while earlier answers keep version 1, and saving with no change making no new version; a once-only form asked a single time per guest; forms only for the services they cover, and none once stopped; the confirmation and reminder lines, gone once the form is in; the client's export and erasure review; and that no studio role can answer for a guest, while owners and managers (not reception) set forms up.

`server/feedback.test.ts` checks through the API: the owner adds a form; the guest's link shows it; a send without the typed name is refused and a proper one accepted, safely repeated; the studio cannot submit a form for the guest; reception cannot change forms; and the practitioner's own day shows the guest's answers for that visit, without the name they typed to agree.

## Limits

- Forms are for everyday questions only. A list of health words is refused, which catches the common cases but is not a full check of meaning; the note in Settings says so in plain words. Health, medical and allergy questions wait for the separate clinical part of SALEANE. Patch tests have their own record.
- Guests fill forms in from their private link. The desk cannot fill one in for a guest yet, so a guest without a link (a walk-in, say) cannot answer one.
- Agreeing is by typing a name. It records what was agreed, which version and when; it is not a verified electronic signature.
- Answers cannot be changed once sent. Nothing is deleted automatically.
- Safari and Firefox were not checked.
