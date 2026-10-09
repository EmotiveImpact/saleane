# NEXT-05 · Who changed what

Recorded 9 October 2026 on a local build (Chromium, 127.0.0.1:5173, sample studio). The setup made its changes through the same command route the screens use: a treatment price, 52 client notes, an invited manager who joined and moved a visit, and a changed client email.

## Tests

- `src/domain/changeRecord.test.ts` (12 tests): every literal action the server records has words, and each action belongs to exactly one kind; a treatment keeps its old and new price and length in pounds; a new treatment says "Added a treatment"; a client edit keeps only "email, phone and preferences", with none of the new wording stored; a moved visit keeps its date, time and professional by name; checkout keeps the discount, tip and how it was paid; every card payment purpose, refunds included, has words and a kind; opening hours read day by day; an access change reads "Access Reception became Manager"; a damaged detail is ignored; guests and automatic changes are named by where they came from; the spreadsheet uses the studio's time and keeps a leading "=" as text.
- `server/changes.test.ts` (5 tests): the owner sees each change newest first with its details and the people who made changes; managers and the desk get 403; an access change and an invitation keep the access; a client edit stores no email, phone or preference wording; filters by person, guests and automatic changes, kind and studio day, paging back with no repeats and with bad queries refused; the privacy record asks for its own kinds.
- `src/components/ChangeRecord.test.tsx` (3 tests) and the Settings interaction test: days in London time (22:30 UTC on 5 October sits under 5 October), "Show older changes", the person filter, an older page that arrives after the filter changed being left out, the demo note, and the section shown to the owner only.

## Browser journey

1. Settings, Your account and data, "Who changed what": the newest change first ("Changed a client's details, Amelia Carter, Changed email, By Ada Owner"), then "Moved a visit, Megan Kapoor, Deep Restore Massage, Fri 16 Oct at 09:30, Date 9 October 2026 became 16 October 2026, By Max Manager". Fifty entries, then "Show older changes" added the last eight, including "Price £95.00 became £105.00".
2. Who, Max Manager: only his two changes. What, Settings: only the price change and the studio being made. Up to the day before: "No changes match". "Back to today" returns the list.
3. "Download as a spreadsheet" saved `saleane-changes-2026-10-09.csv` with 58 changes and a header; the new email address appears nowhere in it.
4. At 390 px wide the filters stack and nothing scrolls sideways.
5. The manager's Settings has no "Who changed what" section, and its address opens Studio details instead.

axe (WCAG 2.2 AA tags) found nothing on the list, the filtered list or the phone view. No console errors.

## Not covered

Changes saved before migration 25 show without their details. Safari and Firefox were not checked. Managers cannot see the record; if they should see some of it, that is a later decision.
