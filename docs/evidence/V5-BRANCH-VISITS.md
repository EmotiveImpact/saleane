# V5 · Branch visit checklists: evidence

Recorded 8 October 2026 in Chromium (Playwright) against the built app (`npm run build && npm start`) with a fresh local database and a sample studio given one more location, Islington. All names are fictional. Nothing was deployed.

## What was exercised

- **Business, Branch visits (owner):** a new "Branch visits" tab sits beside Feedback for owners and managers only. The sample studio arrives with a starter checklist of eight lines and one visit to Marylebone on Friday 2 October, so the page opened with "Retail shelves are full, priced and dusted" waiting under "To put right", and "Each location" read "Marylebone: Last visited Friday 2 October: 6 fine, 1 to put right, 1 not checked" and "Islington: Not visited yet".
- **Recording a visit:** "Start a visit" opened the form with the location, the checklist and the date (today, and up to 31 days back). Each line has three large answers, Yes, No and Not checked, and a note. "Save visit" stays off until every line is answered; the form counted "8 of 8 answered". Answering No to "Stations and tools are clean and ready" with the note "Towels low at station 3" and saving showed "Visit to Islington saved, with 1 thing to put right." and the line joined the list.
- **Putting it right:** "Put right" on that line showed "Marked as put right: Stations and tools are clean and ready". In "Past visits" the visit now reads "7 fine, 1 put right since", and the line shows its note and "Put right Tuesday 6 October by Ada Owner". The visit itself says "Recorded by Ada Owner."
- **Checklists:** "Checklists" opened the editor, one line per row. A second checklist, "Monthly walk-round", was added with two lines. Changing a checklist never changes a visit already recorded: each visit keeps the wording each line had on the day. A checklist can be put away and brought back, never deleted, so old visits still name it.
- **The whole business:** each location in the whole-business view now shows its last branch visit ("Fri, 2 Oct", "Tue, 6 Oct").
- **Phone (390px):** the answers sit three across at thumb size, with no sideways scrolling.
- **Accessibility:** axe (WCAG 2.2 A/AA) finds nothing on the page, the visit form, the page after saving, or the checklist editor. No console errors. The full sweep (`scripts/qualify.mjs`) now includes the page: 153 pages, 0 violations.

Screenshots: [the page after a visit](V5-BRANCH-VISITS-page.png), [the form on a phone](V5-BRANCH-VISITS-390.png).

## Automated checks

`src/domain/branchVisits.test.ts` covers: a visit keeping the wording of the day after its checklist is reworded; scores; the list to put right; only a line answered no can be put right, and only once, with who did it; every line must be answered; a visit can't be in the future, more than 31 days back, or at a location that is not open; a put-away checklist can't be used but is kept; checklist names and lines unique regardless of case; and only the owner and managers can use any of it. `server/projections.test.ts` checks the desk receives no checklists or visits.

## Limits

- Only the owner and managers record visits and see them; reception and practitioners do not receive them at all.
- There are no photos on a visit yet, no scoring weights and no reminder to visit. A regional manager who sees only their own locations is a later V5 stage.
- Visits are kept for every location; nothing is deleted automatically.
