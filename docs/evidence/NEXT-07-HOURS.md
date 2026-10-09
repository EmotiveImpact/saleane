# NEXT-07 · Hours worked for payroll

Recorded 9 October 2026 on a local build (Chromium, 127.0.0.1:5173, a new sample studio for each run). Sample studios keep the sample day, 6 October 2026, but clocking in uses the real time, so the times below are the evening the check was run.

## Tests

- `src/domain/hours.test.ts` (11 tests): changing only the break keeps the clocked times to the second (08:00:37 to 16:10:12 stays so, 7 h 40 min with a half-hour break), and a changed finish is the minute chosen; hours moved from Saturday to Monday move to Islington, where Maya works on Mondays; clocking in at 09:00 studio time, refusing a second clock-in ("Maya clocked in at 09:00 already."), refusing a break as long as the shift, and clocking out at 17:40 with a half-hour break for 8 h 10 min; a shift left open past 16 hours is a forgotten clock-out that counts as nothing, and the person can clock in the next day; hours added by hand, a shift past midnight, a change that keeps the shift's earlier times and reason, and the refusals for overlapping hours, a day not started, a finish still to come, a day more than 400 days back, more than 16 hours, a break as long as the shift, moving hours to someone else, unknown hours and a reason under three letters; removed hours stay in the record with the reason and can be added again; the names of who clocked in, clocked out and changed hours; who may clock and who may change hours; a save and load; three hours columns in the payroll spreadsheet, someone who has left kept on it, and the spreadsheet unchanged without hours; a sample studio's fortnight of hours.
- `src/components/HoursPanel.test.tsx` (4 tests): each person's hours and their shifts newest first; adding hours asks for a reason first and keeps what was chosen, then says "Maya: 4 h 30 min on Tuesday 6 October." and shows "Added by Olu Owner: Forgot to clock in"; changing a break, the earlier times shown under Before, and removing hours with a reason ("The record keeps them, with your reason."); a forgotten clock-out is pointed out, and reception sees no Add hours.
- `src/components/Clock.test.tsx` (2 tests): the desk clocks Maya in, goes Back from clocking her out, has a 15-minute break refused, clocks her out, and Today's strip shows who is in; a practitioner has no team clock on Today.
- `src/pages/PractitionerDay.test.tsx`: a practitioner clocks in and out on their own day, choosing a 30-minute break, and sees "3 h 30 min worked today."
- `server/practitioner.test.ts`: a practitioner cannot clock someone else in ("Clock in and out only for yourself.") or change hours (403), clocks themselves in and out, the owner sees the shift under their name, and their page never carries anyone else's hours.
- `src/domain/branch.test.ts`: a general manager cannot clock out a shift clocked in at another location, even when the rota now has the person with them ("That person clocked in at another location."), and any change to hours at another location is refused once made ("That would change hours worked at another location.").
- `server/branch.test.ts`: a general manager cannot clock in someone working at another location ("That person works at another location today."), clocks in someone at their own, sees only their location's hours, and cannot remove hours (403).
- `src/domain/help.test.ts`: "clock in" finds Clock the team in and out, "timesheet forgot to clock out" finds Put hours worked right, and a practitioner's "clock in" finds their own guide.

## Browser journey

1. Today, Your team today, Clock in and out: Maya Lewis, Sophia Reed and Theo Bennett, each "Not clocked in" with Clock in. Clock in Theo: "Theo clocked in at 22:04." Clock out Theo: "Theo clocked in at 22:04. Choose any unpaid break taken, so the hours are right." A 15-minute break was refused: "The break is as long as the shift. Choose a shorter break." With no break: "Theo clocked out at 22:04. Today: 0 min worked." After clocking Sophia in, the strip shows "In since 22:04" under her.
2. Business, Pay, Hours worked: "From clocking in and out, less unpaid breaks: 75 h 48 min in this period." Maya Lewis, 3 shifts, 25 h 21 min; Sophia Reed, 4 shifts, in now. Maya's shifts: "Mon 5 Oct, 08:59 to 18:18, 45 min break, 8 h 34 min".
3. Change on that shift, Finished 18:00, Why "Stayed late for a colour", Save the hours: "Maya: 8 h 16 min on Monday 5 October."
4. Add hours for Theo, 07:00 to 08:30, without a reason: "Say why, such as "Forgot to clock out"." With one: "Theo: 1 h 30 min on Tuesday 6 October." Then Change, Why "Added to the wrong day", Remove these hours: "The hours for Theo on Tuesday 6 October are removed. The record keeps them, with your reason."
5. Download for payroll: the header ends "Owed (GBP),Hours worked,Shifts,Shifts with no finish time", and Maya's row ends "591.40,25.05,3,0".
6. Maya's own day: "Not clocked in today." Clock in: "You clocked in at 22:04." and "In since 22:04". Clock out, No break, Clock out: "You clocked out at 22:04." Asking the server to clock Theo in from her account: 403, "Clock in and out only for yourself."
7. Who changed what lists "Clocked in", "Clocked out", "Added hours worked", "Changed hours worked" (with the break before and after) and "Removed hours worked", each under the person's name and who did it.
8. At 390 px wide, Today, the team clock, Pay, the change dialog and the practitioner's day have no sideways scroll, and every target in the new parts is at least 44 px. The dialogs' existing close button is 40 px, as before.

axe (WCAG 2.2 AA tags) found nothing on the team clock, clocking out, Pay with Hours worked, the change dialog, the practitioner's day with the clock, or clocking out there. The only console message was the server's 422 for the refused break, which the screen showed in words.

## Not covered

SALEANE adds up hours; it does not pay anyone, and works out no hourly rates, overtime, holiday pay or minimum wage checks. Clocking happens on the studio's own devices and people's own pages: there is no location check, photo or PIN, so a person could clock in from anywhere they are signed in. Safari and Firefox were not checked.
