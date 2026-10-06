# SALEANE 0.2.2 verification

6 October 2026. Feature branch `feat/saleane-foundation`; fictional local prototype acceptance.

## Scope and result

Appointment changes preserve the booking promise and ledger. Confirmed visits can move, cancel or be recorded as missed. Calendar history and the client timeline retain these actions; cancelled/missed records release active allocation and do not qualify as successful rebooks. Calendar date/professional context follows a saved move. Persistent panel headers, native radio time choices and a narrow-phone client-heading correction improve the daily loop.

`npm run check` passed at 18:09 local time: zero lint warnings, **72 tests across three files**, TypeScript and Vite. Both application and design-study build entries were generated. `npm run format:check` also passed after final documentation formatting. The initial check caught a TypeScript command-union narrowing issue; splitting cancellation and no-show discriminants resolved it before the final check.

## Rule and interaction evidence

Thirty-one tests were added to the previous 41. They exercise UK/US booked catalogue snapshots and ledger/rebook links, self-exclusion and professional/resource conflicts, buffers and opening limits, failed-command rollback, terminal guards/retries, active capacity and reporting, rebooking cohorts, reload history and stale writes. Component journeys verify radio arrow keys, explicit cancellation/missed review, timeline/day continuity and a move across an active professional filter.

A separate read-only review found that moving between professionals left the old calendar filter selected. The fix follows both date and professional and has its own regression test. No additional correctness issue was found in the reviewed patch; this is bounded review evidence, not a production security certification.

## Rendered browser evidence

Used the existing server on port 5173 through the in-app browser. Mutation checks ran on the separate `localhost` origin; the user's `127.0.0.1` preview records were not reset or mutated by this QA run.

- Moved Noor from 6 October 11:00 to 7 October 09:30. Changing date recalculated qualified room/professional availability. Native Right arrow moved the selected radio from 09:00 to 09:30. The saved panel retained £95 service and £25 deposit and the calendar followed 7 October.
- Cancelled that visit through explicit review. The deposit remained recorded, the active allocation disappeared, and the cancelled visit was reachable under Changes to this day. Escape returned focus to the main workspace after the original launcher disappeared.
- At effective 320px, recorded Zoe's missed visit through the attendance/date-only review. The panel filled the 320px viewport; title geometry remained at top zero above its separately scrolling body. Zoe no longer appeared in active allocations, and the history badge visibly read Missed visit.
- Noor's timeline displayed Appointment moved and Appointment cancelled. The phone identity column measured 211px after the grid correction; the booking action had its own row.
- All six routes—Today, Calendar, Clients, relationship, Business and Booking—were inspected at effective **320px and 1440px**. Document width matched viewport width in all twelve cases; expected headings rendered and no completed image element had zero natural width. Requested sizes were adjusted for existing browser zoom; evidence uses measured CSS pixels.
- Desktop body scrolling left the panel heading at top zero. Step changes focused their heading; Escape restored meaningful focus. Existing focus-trap and checkout/rebook tests remain green.

Machine-readable measurements: [browser-checks-0.2.2.json](browser-checks-0.2.2.json).

## Visual provenance and capture limits

Caleane's inspected calendar drawer and shared controls informed persistent headings, contained scrolling and explicit selection. The original SALEANE serif, ivory/sage/forest tokens and fictional imagery remain intact; no Caleane assets, packages or source components were imported.

Screenshots were visually inspected inline. The in-app capture cropped fixed-panel content when the underlying page was scrolled, despite the DOM geometry and accessibility tree placing the title at the viewport top. Those captures are not archived as accurate 0.2.2 panel evidence. Earlier 0.2.1 images remain historical, not new-release screenshots.

## Boundaries

The production bundle was built; this rendered pass used the development server and did not start a second preview server. No new dependencies, generated images or duplicate Saleane servers were created. Disk remains severely constrained; no unrelated data was deleted.

This remains browser-local state with a fixed 6 October demo day. Same-day elapsed time for no-show is operator-confirmed, not enforced by an authoritative venue clock. No refund, fee, outbound message or sale is created by cancellation/missed attendance. Authentication, shared database transactions, real provider payments/communications, production accessibility/user trials, deployment and Clinical remain separate gates. No merge is authorised by this record.
