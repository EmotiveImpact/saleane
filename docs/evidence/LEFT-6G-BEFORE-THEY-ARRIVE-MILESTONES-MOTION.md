# LEFT-6G · Before they arrive, quiet milestones, gentle motion and the wizards

Built after Edem's reminder of 10 October 2026 that finish and feel also covers a before-the-visit card for each guest, quiet milestone celebrations, gentle motion on key moments and the wizards fitting with the rest of the app. Built and checked in a browser at 1440 and 390 px. No migration, no new dependency.

## What it does

- **Before they arrive** (`src/domain/beforeVisit.ts`, `BeforeVisitCard`). The top of Today's side column shows the next guest still to come (`nextToArrive`: the first visit still booked today that has not started more than 10 minutes ago; a general manager's own location). It says their treatment and who they see, any milestone, what is good to remember (`guestBackground`, so the newest note on another record with the same email counts), their last visit with the date, treatment and professional, a patch test not in order (`visitPatchTest`), and "Nothing booked yet. A good moment to offer one at checkout." when nothing is booked after it. "Open Noor's visit" opens the visit window. A first visit leaves out "Last time". Below 1080 px the card runs the full width of the side column.
- **Quiet milestones** (`guestMilestones`, `milestoneLine`, `milestoneTag`). Counted from completed visits across every record with the guest's email, newest first:
  - a first visit: "Naomi's first visit. A warm welcome, and a moment to settle in.";
  - the 5th, 10th, 25th, 50th, 75th and 100th visit, then every 50th: "Amelia's tenth visit.";
  - an anniversary of the first visit, said once, at the first visit within 30 days after it: "A year since Rosa's first visit.";
  - a birthday within three days either side, across the turn of the year: "Noor's birthday is on Thursday.";
  - coming back after 180 days or more: "Ben is back after eight months.".
    They show on the card, in the visit window under Good to remember, as a small tag in the day's list ("Fifth visit", "Birthday this week"), and on a professional's own day under Next up and in Before you begin (`practitionerView` carries one sentence, `moment`, never the visits behind it). No exclamation marks, no "congratulations", no em dashes (tested).
- **The studio's milestone** (`studioMilestone`). When today's visits carry the studio (or a general manager's location) past its 100th, 250th, 500th or 1,000th completed visit, then every 1,000th, Today says "Naomi's visit at 14:00 will be Linden Studio's hundredth." under the day's summary, and "Naomi's visit today was Linden Studio's hundredth." once it is checked out. Visits already finished count first, so the line follows what happened.
- **Gentle motion on key moments** (`moments.css`). The greeting and its photograph rise softly as Today opens; a guest's status and row colour change softly when they are welcomed or checked out (hover stays quick); the closing ledger's lines arrive one after another; the guest's visit label and booking confirmation settle in; a milestone's hairline draws itself. Nothing loops, nothing bounces, and `prefers-reduced-motion` removes all of it. The quality bar change (#83) brings the shared `.settle` motion the wizards' steps already use.
- **The wizards fit.** In the browser, the setup guide's step names were cut to "St…" at phone width and the Add a location wizard cut "Treatm…" at 768 px. Now only the step you are on is named up to 820 px, and the setup guide's eight marks sit closer on phones so the current name is whole from 320 px (measured for every step at 320, 360, 390, 430, 640, 700, 768, 821, 900 and 1024 px). Fonts, buttons, fields and colours already matched the app.
- **Help**: "Before they arrive, and quiet milestones" (The day), for the desk.

## Checks

- `src/domain/beforeVisit.test.ts`: 12 tests, including counts across two records with one email, the turn of the year for birthdays, an anniversary said once, the studio's hundredth, and the practitioner's view carrying a sentence only for visits still to come.
- Lint, types, formatting and the build pass. App tests 1,762 and server tests 556 (2 skipped) pass.
- Browser: Today, the card and the visit window in a new sample studio at 1440 and 390; both wizards measured as above.
