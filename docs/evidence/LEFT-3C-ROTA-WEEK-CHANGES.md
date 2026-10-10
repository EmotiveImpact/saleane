# LEFT-3C · The rota: changing a day, an extra day and the whole week

Built 9 October 2026 in a worktree, on top of the Stage 2 branch at `fdee202`. Everything below was checked with domain, component and server tests, then seen in a browser on 10 October 2026 (see Seen in a browser).

## What it does

- **Change one day for one person, for that date only.** On Business, then Rota, an owner or manager chooses a person's day in the week. The dialog says what their usual day is ("Usually 09:00 to 18:00.") and offers As usual, Different hours and Not working. With more than one location it also asks where ("At"). A short note for the team is optional. Their weekly hours in Settings are never touched.
- **Add an extra day.** On a day someone does not usually work, the same dialog offers As usual and Extra day (there is no day to take off), with hours and, with more than one location, where.
- **Put a day back to usual.** Choose the day again, then As usual and Put back to usual. The change is never deleted: it is marked as ended, with who ended it and when, so the record keeps what was planned.
- **The whole week, tucked away.** Under "Change the whole week" (a quiet fold above the week): Copy last week's changes puts each changed day from the week before onto the same weekday, and Clear this week's changes puts every change still to come this week back to usual. Each opens a dialog that lists exactly what will happen, what is left out and why ("That day has passed.", "Maya is away that day (holiday)."), before anything is saved. Days that have passed stay as they were. The fold only appears on a week that is not over, and only when there is something to copy or clear.
- **How a changed day looks.** A changed day is warm stone with a small "Changed" label; an added day says "Extra day"; a usual day off taken away says "Not working" with "Changed". There are no stripes. Each day an owner or manager can change is one button filling its cell, named for screen readers ("Change Maya Lewis's day, Friday 9 October. 09:00 to 15:00. Changed."). Days that have passed, days away and days the studio is closed are not buttons.
- **Booked visits outside the new hours.** When a change (or putting a day back, or a whole week) would leave booked visits outside the hours, the dialog lists each one by time, client first name and treatment ("16:00 Amelia, Skin Renewal Facial") and Save stays unavailable until a choice is made:
  - **Move them first.** Nothing is saved; the main button becomes Open the calendar on that day.
  - **Keep them booked as they are.** The change is saved, the visits are left exactly as they were, and the rota shows "1 booked visit outside these hours" on that day until they are moved. Opening that day again lists them, each a link to the visit in the calendar.
  - SALEANE never moves, cancels or messages a visit for this. The server refuses the change with the same list ("A booked visit would be outside the new hours: Fri 9 Oct 16:00, Amelia, Skin Renewal Facial. Move it first, or choose to keep it booked as it is.") unless the request says to keep them.
- **Today's team** (on Today) shows a small "Hours changed", "Extra day" or "Day changed" beside anyone whose day today is changed on the rota.
- **A practitioner's own page** shows "Your hours on the rota" for the day they are looking at ("Working 09:00 to 15:00" with "Changed for this day", or "Not working this day"), and a fold "2 changed days coming up" listing each one, which jumps to that day. Only their own days, and never the team's notes.
- **Who changed what** (Settings, owners only) has each change in plain words: "Changed a day on the rota" about Maya Lewis, with "date 9 October 2026" and "hours that day: their usual hours to 09:00 to 15:00"; "Put a day on the rota back to usual hours"; "Copied last week's rota changes" and "Cleared a week's rota changes" with the week and how many days; and how many booked visits were kept outside the hours, when any were.

## One shared answer to "when does this person work"

`plannedHoursFor` in `src/domain/operations.ts` is the one place that reads a changed day: usual weekly hours, or the change in force for that person on that date. `staffHoursFor` (hours, closed while away) and `staffLocationOn` (where) now both read it, so every place that already asked them follows the rota without its own copy of the rule. Changes are looked up through a small index by person and day, kept per saved list (the rota commands always save a new list), so availability searches stay fast.

Every place that works out who is free, and how it now follows the changed day:

| Place                                                   | How it reads the day                                                                                                         | Checked by                                                                                            |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Desk booking (Book a visit, the calendar)               | `availableResource`, `slots` and `availableAllocation` (`src/domain/allocation.ts`), which use both functions                | `rota.test.ts`: times only within the new hours, a booking after them refused, an extra day bookable  |
| Guest booking page (times, days, next free time, holds) | `server/routes/public.ts` through `slots`, `availableResource` and `staffLocationOn`                                         | `server/rota.test.ts`: the sample's extra Saturday offered from 10:00, Friday ending by 15:00         |
| Guest moving their own visit                            | `server/routes/guest.ts` through `rescheduleResource`                                                                        | `rota.test.ts`: moving a visit onto the extra day                                                     |
| Receptionist (chat and text)                            | `availableProfessionals` and `staffLocationOn` in `src/assistant/receptionist.ts` and `server/messaging/receptionistText.ts` | `rota.test.ts`: Maya offered on her extra day                                                         |
| Ask SALEANE                                             | `src/assistant/saleane.ts` through `slots`                                                                                   | Same path as the desk                                                                                 |
| Book with Google                                        | `availabilityEntries` (`src/domain/googleFeeds.ts`) and `server/googleBooking.ts` through `slots`                            | `rota.test.ts`: Maya's free times appear on the extra day only                                        |
| Moving a visit at the desk                              | `rescheduleResource`                                                                                                         | `rota.test.ts`                                                                                        |
| Waitlist offers                                         | `openings` in `src/domain/waitlist.ts`                                                                                       | `rota.test.ts`: an offer at 10:00 on the extra day, none without it                                   |
| Cover when someone is off                               | `coverPlan` in `src/domain/cover.ts`, now using the opening hours of where the person works that day                         | `rota.test.ts`: Maya, in on her extra day, takes Sophia's visit                                       |
| Gaps and free time                                      | `staffDay` and `availableMinutes` in `src/domain/selectors.ts`, now using the opening hours of where they work that day      | `rota.test.ts`: 360 free minutes on the extra day; a day off takes its hours away                     |
| Moving a client to another professional (switching)     | `src/domain/switching.ts` through `availableAllocation` and `staffLocationOn`                                                | Same path as the desk                                                                                 |
| Schedule checks on any change                           | `scheduleConflict` and `affectedVisits` in `src/domain/schedule.ts`                                                          | `rota.test.ts`: the booked visits list, and other changes not held up by a visit already kept outside |
| Calendar and month view, location filters               | `staffLocationOn` in `Calendar.tsx`, `CalendarMonth.tsx` and `BookingDialog.tsx`                                             | `rota.test.ts`: someone sent to Islington for one day is booked there, in Islington's room            |
| Today's team and clocking in                            | `staffLocationOn` and `availableMinutes` in `TeamToday.tsx` and `Clock.tsx`; a clocked shift records where they were planned | `Rota.test.tsx`: "Hours changed" on Today's team                                                      |
| General managers' location checks                       | `branchRefusal` in `src/domain/branch.ts` through `staffLocationOn`                                                          | Existing branch tests                                                                                 |
| A practitioner's own day                                | `ownPlan` in `src/domain/rota.ts`, carried in `PractitionerView.plan`                                                        | `rota.test.ts` and `server/rota.test.ts`                                                              |
| Holiday counting                                        | `workingDaysAway` in `src/domain/timeOff.ts` counts the days someone was planned to work                                     | `rota.test.ts`: a holiday over an extra day counts it                                                 |
| Where someone works, for booking pages                  | `staffPlaces` adds any location the rota sends them to on a day still to come                                                | `rota.test.ts`                                                                                        |

**Payroll** is untouched: hours worked stay exactly as clocked (`rota.test.ts` compares `hoursPeriod` before and after a change). Nothing in SALEANE compares planned hours with clocked hours today, so nothing else needed to read the plan.

## Who can do what

| Role             | Rota page                                                                        | Today's team    | Their own page                                      | Server                                                                                                                                                       |
| ---------------- | -------------------------------------------------------------------------------- | --------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Owner, manager   | Change any day, add a day, put back to usual, copy and clear a week              | Sees the labels |                                                     | Allowed (`hours` permission)                                                                                                                                 |
| Reception        | Sees the week with changed days marked, read only: no day buttons, no week tools | Sees the labels |                                                     | Refused: "Your role cannot make this change."                                                                                                                |
| General manager  | As today: sees the whole team's week read only, with changed days marked         | Sees the labels |                                                     | Refused. The `hours` permission is not theirs and is not in `GENERAL_ACTIONS`, so they cannot change hours at their location today; this is left for Stage 4 |
| Practitioner     | No rota page                                                                     |                 | Their own hours for each day and their changed days | Refused; their view carries only their own days, without notes                                                                                               |
| Regional manager | No rota page; the area view carries nothing of the rota                          |                 |                                                     | Refused                                                                                                                                                      |
| Guest            | Nothing, beyond the times offered following the changed day                      |                 |                                                     | No route changes the rota                                                                                                                                    |

## Server

- Four new commands, each with its own schema in `src/domain/rotaSchema.ts` (strict, five-minute steps, notes up to 100 characters): `rota-day`, `rota-day-usual`, `rota-week-copy`, `rota-week-clear`. Each takes an optional `keepBooked: true`, never assumed.
- Checks made on the server for every request, whatever the screen sent: someone on the team; a date from today to a year ahead ("That day has passed. The rota keeps what was planned for it.", "Change days up to a year ahead."); not on a day they are away; start before finish; an open location that offers at least one of their treatments; times within that location's opening hours that day, and not on a day it is closed; not the same as their usual day; one change in force per person per day (a new one ends the old one, which is kept); the week given by its Monday; and the booked visits check above.
- The studio record is checked as a whole when it is read and saved (`rotaProblem`): no duplicate ids, nobody unknown, no unknown location, never two changes in force for one person on one day.
- Permission: `permissionFor` maps all four commands to `hours`, which only owners and managers have. Regional managers, general managers and practitioners are refused by the role check before their own refusal checks.
- The audit row for each saved change carries the detail shown in Who changed what. Repeating a request with the same idempotency key applies it once.
- **No migration.** Changes live in the studio record (`operations.rotaChanges`, up to 8,000, the oldest ended ones let go first).

## Tests

- `src/domain/rota.test.ts` (27): one day's hours change that date only and leave weekly hours alone; an extra day is bookable within its hours; a usual day off takes its hours away; a change replaced is kept on record; putting back to usual, with the signed-in name; every server-side refusal in its own words (times, steps, dates, closed days, time off, location, treatments, notes); the record checks through `parseState`; owners and managers only, and the practitioner, regional and general refusals; every availability place in the table above; someone sent to another location for a day; the booked visits refusal by time, first name and treatment, keeping them untouched with nothing queued, the warning staying until a move, the same check when putting back and for a whole week, and past visits never counted; copying a week with what is left out and why; clearing only what is still to come; holiday counting; payroll unchanged; the change record's words; the sample week, with and without regulars, UK and US, and after the sample day moves (also onto another weekday).
- `server/rota.test.ts` (8): owner changes and manager puts back, with actor names, audit rows and the Who changed what lines; reception, practitioner and general manager refused for all four commands with nothing saved, another studio "not found"; server-side checks through the route, an unknown field refused; the booked visits refusal (422), then keeping them with visits, messages and the outbox unchanged; a repeated request applied once; a practitioner's view with only their own changed days and no notes, another practitioner's with none; a regional manager's view without the rota, and refused; the guest booking page offering times on the extra day and within the shorter Friday only.
- `src/pages/Rota.test.tsx` (8): the sample week's "Changed" and "Extra day" cells and their names; past and closed days not offered; the day dialog's usual hours and who changed it; putting a day back; adding an extra day with a note; the booked visits choice, Move first leading to the calendar, Keep saving with `keepBooked` and the warning on the rota; clearing and copying a week; reception's read-only rota; Today's team label.
- `src/domain/help.test.ts`: searches for "change a shift for one day", "extra day" and "copy last week rota" find the new guide; "my shift" finds the practitioner's day; reception never gets the owner's guide.
- `src/domain/timeOff.test.ts` and `src/pages/PractitionerDay.test.tsx` updated for the move of `rotaWeek` and the new section.

## Checks

- `npm run lint`, `npx tsc -b`, `npm run format:check` and `npm run build`: pass.
- Full `npm test`: front end 142 files, 1,257 tests passed; server 54 files passed and 1 skipped, 412 tests passed and 2 skipped (the same skips as before).

## Decisions

- **Changed hours stay within the location's opening hours**, and a change cannot open a closed day. Opening late or on a closed day is a change to the opening hours in Settings, which has its own checks; the refusal says so.
- **A day someone is away cannot be changed**: the time off is cancelled first. A change already made stays underneath time off added later and comes back if the time off is cancelled.
- **One change in force per person per day.** Saving again replaces it; the earlier one is kept, marked "replaced", so nothing is ever lost from the record. Saving exactly the same again is refused as no change.
- **"May work there"** means an open location that offers at least one of the person's treatments (or any open location, for someone with no treatments). There is no list of who may work where to check against.
- **Dates** run from today to a year ahead, on the studio's own calendar. The past is never rewritten.
- **The week tools** copy only changed days, never usual hours, and check each copied day as if made by hand. They sit in a fold because they are rarely used.
- **Notes** are seen by the owner, managers, reception and general managers, as time off notes are. Practitioners see their own hours and whether a day changed, not the notes.
- **General managers** keep what they had: they see the rota read only. Their `GENERAL_ACTIONS` do not include hours, so the existing rules do not let them change hours at their location.
- **Holds on the guest booking page** are not counted as booked visits, as with time off. When the guest confirms, the booking is checked again against the new hours.
- `rotaWeek` moved from `timeOff.ts` to the new `rota.ts`, and `usuallyWorks` became `plannedToWork` (holiday counting now counts the days someone was planned to work). Nothing else used either.

## Quality bar

- **One main job and one primary button.** The Rota page keeps Add time off as its one primary button; each day is a quiet cell button. Each dialog has one primary (Save this day, Put back to usual, Copy 2 days, Put 2 days back to usual, or Open the calendar when Move first is chosen) with Cancel as a secondary. The week tools are secondary buttons.
- **Rarely used options tucked away.** "Change the whole week" is a native `<details>` fold, because `MoreOptions` is not in `src/design` on this branch (PR #83); it can move to `MoreOptions` when that merges. The practitioner's changed days to come are a fold too.
- **No card inside a card.** The booked visits choice, the week lists and the practitioner's hours use space and hairlines, no boxes. The changed day tint is the cell's own background.
- **Photographs and empty pages.** No photograph was added: the rota is a dense working surface. No new page can be empty; the week dialogs say "This week has no changed days still to come." in one line when that is so.
- **Loading.** `LoadingShapes` is not in `src/design` on this branch. Nothing new loads: the preview is worked out on the device, and Save shows "Saving…" in its own label.
- **Motion.** `--motion-calm` is not in `src/design` on this branch, so nothing new moves; dialogs use the existing Modal.
- **390 px.** The week keeps its existing sideways scroll (a strip made to scroll, with the fading edge). Each day button fills its cell at least 44 px high; the fold's line, the radio rows and the practitioner's list rows are 44 px targets; the week buttons wrap; the dialogs use the existing form grid, which stacks on a phone. Times in a narrow cell wrap between words, never in the middle of a time.
- **Words.** Plain British English, no exclamation marks, no dashes. Messages say what happens next ("Move it first, or choose to keep it booked as it is."), and "Nobody is messaged and nothing is cancelled." is said where it matters.
- **Built from the library.** Button, Modal, SegmentedControl, TimeField and ErrorMessage from `src/design`; colours from tokens only (`--stone`, `--paper`, `--line-strong`, `--rose-ink`, `--brand-ink`); no left-edge stripes (the edges test passes). Nothing claims a message was sent.
- **Before and after pictures** were taken at 1440 and 390 px in the browser pass; they go on the Stage 3 before and after page.

## Seen in a browser

Checked on 10 October 2026 in Chromium against the local server, signed up as a new owner with the sample studio (sample day Tuesday 6 October), at 1440 px and 390 px.

- Business, Rota: Maya's Friday reads "09:00 to 15:00" with "Changed", her Saturday "10:00 to 16:00" with "Extra day". Past days, closed days and days away are not buttons.
- Friday's dialog says "Usually 09:00 to 18:00", "Changed for this day by Owner. Training from three", with the hours and note filled in.
- Maya's Tuesday, Not working: the four booked visits are listed by time, first name and treatment, and Save this day stays unavailable until a choice is made. Move them first turns the main button into Open the calendar. Keep them booked as they are, then Save this day: the cell reads "Not working", "Changed" and "4 booked visits outside their hours", and the page says the four visits stay booked, marked on the rota. The calendar is unchanged.
- Today, Your team today: Maya reads "Not in today" with "Day changed".
- Change the whole week, on the week of 12 October: Copy last week's changes lists each day it will copy and the six visits that would fall outside the hours, with the same keep-or-move choice.
- Settings, Who changed what: "Changed a day on the rota".
- The guest booking page with Maya chosen offers 20 times on her extra Saturday, 10 October, and none on Tuesday.
- Reception, invited and signed in: the rota is read only, with no day buttons and no week tools, and changed days are marked.
- Maya, invited as a practitioner and signed in: her page shows "Not working this day" with "Changed for this day" and "3 changed days coming up".
- 390 px: only the week strip scrolls sideways (page width 390), and each dialog stacks.

Found and fixed in this pass:

- The keep-or-move choice drew each radio as a full-width circle above its words, because the form makes every input full width. Each is now a small radio beside its words, and the list's heading sits under the line rather than breaking it.
- The week dialog's "Move them first" said to come back to "this day"; it now says "this week".
- Reception's rota opened with "Change one day here", which they cannot do. They now read that changed days are marked.

## Limits and notes

- Archiving a location does not check the rota for changes that send someone there later, as it does not check weekly hours today. Booked visits there are still protected by the schedule checks.
- The rota's warning counts visits outside the person's hours and location; a visit stranded by something else (a partial closure, a room archived) shows in the schedule checks as before, not on the rota.

## Browser steps for the lead

Sample studio (owner), sample day Tuesday 6 October 2026.

1. Business, then Rota: in the week of Monday 5 October, Maya Lewis's Friday is tinted and reads "09:00 to 15:00", "Changed"; her Saturday reads "10:00 to 16:00", "Extra day". Today's column keeps its outline.
2. Choose Maya's Friday: "Usually 09:00 to 18:00. A change here is for this day only.", "Changed for this day by Owner. Training from three". Choose As usual, then Put back to usual: the cell is plain again and the message says so. Settings, Who changed what shows "Put a day on the rota back to usual hours" for Maya Lewis.
3. Choose Maya's Tuesday (today), then Not working: the booked visits are listed by time, first name and treatment and Save this day is unavailable. Choose Move them first: the button becomes Open the calendar. Choose Keep them booked as they are, then Save this day: the cell reads "Not working", "Changed" and "N booked visits outside their hours". Today shows "Day changed" beside Maya under Your team today. Open the calendar: every visit is where it was.
4. Next week: choose Maya's Saturday 17 October, Extra day, 10:00 to 16:00, Save this day. Then the guest booking page: Maya is offered that Saturday from 10:00.
5. "Change the whole week": on the week of 12 October, Copy last week's changes lists the days and anything left out; on the week of 5 October, Clear this week's changes lists what goes back to usual.
6. With a second location (Settings, Locations), choose a day and pick another location under At; the calendar's location filter shows them there that day only.
7. As reception: the rota shows the changed days, with no buttons in the week and no week tools. As a practitioner (Maya): her page shows "Your hours on the rota" and "2 changed days coming up"; Sophia's shows none of Maya's.
8. At 390 px: the week scrolls sideways inside its strip only; the day dialog's fields and the booked visits choice stack with nothing scrolling sideways.

Screens to capture before and after, at 1440 and 390 px: the rota week with the sample changes; the day dialog; the booked visits choice; the week dialogs; Today's team with a label; the practitioner's page.
