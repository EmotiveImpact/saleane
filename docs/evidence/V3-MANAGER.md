# V3 · A manager's day in Ask Saleane: evidence

Recorded 7 October 2026 in Chromium (Playwright) against the dev server in browser demo mode (Atelier House, fictional records; the demo's business date is Tuesday 6 October and its time of day is the real clock), as the owner, at 1280px and 390px. The day-in-the-life page these come from: https://claude.ai/artifact/Pjh2tpzRkokQUPSUyVvG2B

## What was exercised

- **"Who's my 2pm?"** "14:00: Nina Patel, Deep Restore Massage with Sophia. 1 visit so far, the last on Monday 31 August for Skin Renewal Facial. Preferences: Interested in a monthly visit. Also then: Luca Evans with Theo. After that, Sophia has Isabel Wilson at 16:00."
- **"Theo is off sick today"** (asked after 1pm): a plan for one approval. Nobody else does Theo's treatment, so his remaining guests are asked to choose a new day, a note to each is saved unsent, and the rest of his day is closed. Approving it showed "Done. Saved to your records."; the Inbox then held the notes as drafts waiting for approval, none marked sent, and the visits stayed booked.
- **"How did we do today?"** "£195 in treatments from 2 visits, against about £181 on a usual Tuesday. 0 of 2 booked their next visit. 2 left without a next visit; Olivia James, Ellie Brooks are happy to hear from you…"
- **"Book Jamie in with Maya for a facial on Thursday afternoon"** "Free on Thursday 8 October: Maya at 12:00, 13:00, 14:00, 15:00…"
- axe (WCAG 2.2 A/AA and best practice) on the Ask Saleane panel with a plan showing: zero violations at both widths; no console errors apart from the expected 401s on the signed-out demo account check.

Screenshots: [cover plan in the panel](V3-MANAGER-cover.png), [booking options at 390px](V3-MANAGER-ask-390.png).

## Automated checks

`src/domain/cover.test.ts` covers a second stylist taking every upcoming visit at the same time with one revision, drafts left unsent and the absent person unbookable; a visit nobody can take kept booked with the day closed around it; visits that have already started left alone; and a batch applied together or not at all, refusing anything but moves, cancellations, closures and drafts. `src/assistant/ask.test.ts` covers a visit by time, open times then a booking proposal that the desk rules accept, a cancellation that changes nothing until approved, cover for managers only, and the day and week answers for managers only. `server/cover.test.ts` covers reception refused a plan containing changes its role cannot make, a manager's plan applied as one revision, and a batch carrying a payment refused.

## Limits

- Test mode recognises a set of phrasings; a real AI will understand far more, using the same skills and the same approval step.
- Follow-up questions ("and after her?") need conversation memory, which is not built yet.
- A cover plan only moves visits to the same time; it does not suggest other times or rooms. Guests nobody can see are asked to pick a new day by a draft note.
- Booking by chat is for existing clients; adding a new client still happens at the desk.
- The weekly review explains a quiet day from cancellations, missed visits and bookings only.
- Safari and Firefox were not checked.
