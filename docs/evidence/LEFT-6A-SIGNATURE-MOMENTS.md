# LEFT-6A · The signature moments and the guest's own visit page

Branch `left-s6moments`, from `left-stage5` at 6d557e4. Built and tested locally. **It has not been seen in a browser yet**: the lead runs the browser pass at 1440 and 390 px once the Stage 6 parts are put together (steps at the end). No migration, no new dependency.

The design notes of 7 October name eight signature moments. Three were already built (the morning greeting on Today, Closing up on Business, the rebook moment after checkout). This part builds the rest, each worked out from the record in one tested module, `src/domain/moments.ts`, so nothing celebrates what did not happen.

## What it does

- **"Settled." at checkout** (`AppointmentDialog`). Once a receipt is recorded, the panel opens on the amount collected in the serif, a hairline beneath it and the word "Settled.", with one line under it from `settledLine`:
  - cash: "Recorded as paid by cash."; the studio's own terminal: "Recorded as paid by card terminal." Never "Charged" or "Paid".
  - a card payment the provider confirmed (`processor.live`): "Paid by card. The payment provider confirmed it."; a test card: "A test card payment. No money moved."
  - a plan or gift card that left nothing to collect: "Covered by Facial club. Nothing left to collect." or "Paid from a gift card. Nothing left to collect."; part paid by gift card: "Recorded as paid by cash. £20.00 came from a gift card."
  - a sample studio, whatever the method: "A sample studio, so this checkout is a demo. No money moved."
    The receipt lines, the rebook moment and the printed receipt stay beneath it, in the same order. The amount resolves from a soft blur, the hairline draws outwards and the words settle in, only when the payment has just been recorded (opening an older receipt shows it still). Reduced motion removes all of it. No sound.
- **"Fully booked. Beautifully done."** (`fullyBooked`). Shown in the calendar's day header (its own line under the date and filters) and on Today under "The day ahead", once: there are visits that day, at least one person working who does some treatment, and no free stretch in anyone's working hours (from `staffDay`) long enough, starting on a quarter hour, for the shortest treatment that person does at that location with its turnaround. A day that has passed never says it. A whole day counts, so time left empty this morning still counts this afternoon. A general manager's view counts only their location; the calendar otherwise follows the chosen location. On a full day the calendar's half-hour guides (the texture of empty time) fade away. No confetti.
- **"A pause"** (`pauses`, `visitPauses`). On the calendar's day grid, a free stretch of 15 minutes or more between two visits for the same person is drawn as a soft stone tint with "A pause" in small italic serif. Free time before the first visit, after the last, or beside a closure stays ordinary free time. The tint sits under the free-time button, so a pause still to come books exactly as before: the same button, its screen reader label ("Book with Maya Lewis from 11:45"), the hover time and the 24 px tap rule are unchanged, and the pause itself is hidden from screen readers. The phone layout of the calendar (`PeopleColumns`) marks the same stretches "A pause" above their "Free 11:45 to 12:30" button. A practitioner's own day (`PractitionerDay`) shows "A pause, 11:45 to 12:30, 45 minutes" between their visits. The drag code is untouched.
- **"All in hand"** (`allInHand`, `NeedsYou`). When no call, patch test or reminder waits, and everyone due so far today has been welcomed or checked out, the Needs you card gives way to the still studio photograph (`photos.calmStudio`) with "All in hand" in the serif and "Everyone due so far has been welcomed, and nothing is waiting." It never shows while anything waits, while a guest whose time has come has not been welcomed, or while a guest who tapped "I've arrived" waits at the desk; and it is earned, so it never shows before anyone was due. Logging a missed call or adding a reminder stays one tap away ("Add a reminder or log a missed call", worded for what this person may do), which brings the cards back. A general manager's desk counts their own location.
- **The closing ledger** (`closingLedger`, `ClosingLedger`, Business, Closing up). Before the day is settled it reads as before: "Before you close.", "10 of today's 12 visits still to check out." and who comes first tomorrow. Once every visit today is checked out: "The day is settled." and a ruled ledger with dotted leaders and old-style figures: Guests seen, First-time guests (no completed visit before today), Rebooked before leaving (for example "7 of 12"), Treatment takings recorded, Products sold before tax (when any) and Tips recorded, all from `report(state, 1, location)`, the Business page's own rules, so renters' own takings are left out and named in a small line ("Renters' own takings, £…, are left out."). Then one human note: a guest booked tomorrow whose birthday it is ("Amelia comes in tomorrow at 10:00, on their birthday."), else a guest seen today with a birthday tomorrow, else who comes first tomorrow, else "Nothing is booked for tomorrow yet." It ends "Studio closed. See you tomorrow."
- **The guest's label** (`ManageVisit`, still `GuestView` only). The top of the guest's private page is now a typed card over the photograph: "Your visit, Amelia." in the serif, then ruled lines in small capitals for Treatment, With, Date and Time (with the length), then the arrival guidance in italic: the studio's own arrival words when the location has them, otherwise "Please arrive a few minutes early, so there is time to settle in." The studio's arrival words are said once (they no longer repeat under "Before you arrive", which keeps the treatment's own note and the patch-test line). Deposit and status keep their rows below. `GuestView` gains `guest.firstName` (optional), the guest's own first name and nothing else of theirs.
- **The studio's photograph.** Owners cannot upload a studio photograph anywhere today: the setup wizard's look step and branding settings choose colours only, and the only uploads are product photos for the team. So the page keeps the house photograph as decoration (`alt=""`, nothing calls it the studio's room), with a note in the code. A studio photograph upload belongs with the image pipeline later.
- **A map** (`src/domain/maps.ts`, `StudioMap`, `StudioContact` with `map`). No map adapter existed (the area and branch maps are sample-only drawings). The new adapter is swappable (`setMapAdapter`); its only adapter today is the test one, which never calls a map service and returns a placeholder. The page draws it as soft lines that are not real streets, a pin, the address and "Map shown when a map service is connected." The Directions link stays, and the address line under it is not repeated while the placeholder shows it. A connected adapter would return a picture and its credit.
- **Help**: "The small moments, and when they appear" (The day), for everyone at the desk, found by "fully booked beautifully done", "what does all in hand mean" and "closing ledger end of day"; not offered to a practitioner.

## Sample studio

- **Fully booked**: with the regulars (every sample studio in the app and demo), **Monday 12 October** is filled: `fillSampleDay` in `seed.ts` books regulars who already have a visit to come into each stretch still long enough for a treatment (never colour). Only Maya works on Mondays, so two more facials fill her afternoon. The test suites build the sample without regulars, so their diary is unchanged.
- **A pause**: Tuesday 6 October (the sample's today) has one between two of Maya's morning visits (10:45 to 11:00) and Monday 12 October has several, one of them bookable (11:45 to 12:30).
- **Settled.**: check out any of today's visits, such as Amelia, who is in the studio.
- **All in hand**: on the sample's today at 10:45, welcome Noor (she tapped "I've arrived"), mark both missed calls as called back, and sort both patch tests. Everyone due before 10:45 is then in hand.
- **The closing ledger**: check out every visit still open today (ten).
- **The guest's label and map**: open a visit, choose the guest link and open it.

## Who sees what

| Role             | Settled.               | Fully booked            | A pause       | All in hand         | Closing ledger                | Guest label          |
| ---------------- | ---------------------- | ----------------------- | ------------- | ------------------- | ----------------------------- | -------------------- |
| Owner, manager   | At checkout            | Calendar and Today      | Calendar      | Today               | Business                      | No                   |
| General manager  | At checkout, as before | Their location only     | Calendar      | Their location only | Business, the location chosen | No                   |
| Reception        | At checkout            | Calendar and Today      | Calendar      | Today               | Business, as before           | No                   |
| Practitioner     | No                     | No (their own day page) | Their own day | No                  | No                            | No                   |
| Regional manager | No                     | No                      | No            | No                  | No                            | No                   |
| Guest            | No                     | No                      | No            | No                  | No                            | Their own visit only |

Nothing here adds a command, a route or a permission: every moment reads what each role already receives (the practitioner's from `PractitionerView`, the guest's from `GuestView`), and none of them changes the record, sends a message or moves money.

## Tests

- `src/domain/moments.test.ts` (28): Settled words for cash, terminal, a confirmed card, a test card, a sample studio (every method), a plan, a gift card, part gift card and nothing to collect, never "charged" or "paid" for money recorded by hand; fully booked only when nothing fits anyone's shortest treatment, never on an empty day or a closed day, a gap shorter than that person's shortest treatment counting as filled (Maya 75 minutes, Theo's 15-minute patch test), quarter-hour starts, never on a past day, one location only, someone archived or with no treatment left out, and the sample's Monday 12 October; pauses only between two visits, never beside a closure, the sample's 10:45 pause, and the practitioner list leaving out cancelled visits and short breaths; All in hand with a call waiting, a late guest, a guest waiting at the desk, nobody due yet and cancelled visits; the closing ledger before and after settling, takings and tips equal to the Business page's own figures with renters left out, rebooked and first-time counts, each kind of human note and one location; `guestView` carrying only the guest's first name.
- `src/domain/maps.test.ts` (3): the test adapter's placeholder and that it never calls `fetch`; no address, no map; swapping in a connected adapter.
- `src/components/moments.test.tsx` (7): All in hand on Today's Needs you, its way back to the cards, and never with a call waiting, a late guest or a guest at the desk; the calendar saying Fully booked once on 12 October with its guides gone, a pause drawn while its time still books ("Book with Maya Lewis from 11:45"), quiet on a day with time left and on a past day; the Business closing ledger before and after the day is settled, its lines, the renters' line, the human note and the closing words, with no "charged" or "processed" anywhere.
- `src/components/visitPanel.test.tsx`: the Settled region after a sample checkout, with its amount and demo line.
- `src/pages/ManageVisit.test.tsx` (2 new, 1 changed): the label with first name, treatment, professional, date and time; the studio's arrival words said once; the map placeholder with the address and the Directions link; the photograph's empty alt; the general arrival line. The US date test now reads the date and time on their own lines.
- `src/pages/PractitionerDay.test.tsx`: unchanged, and still passes because the pause rows are hidden from screen readers and so do not count as visits.
- `src/domain/help.test.ts`: three searches find the new guide; a practitioner does not.
- `src/components/interaction.test.tsx`: the checkout journey now finds the amount twice (under "Settled." and on the total line).
- `server/guestExtras.test.ts`, `server/guestPlans.test.ts`, `server/usual.test.ts`: the guest view's keys include `guest`, and only the first name comes back.

## Checks

From the worktree root:

- `npx tsc -b`: passes.
- `npm run lint`: passes.
- `npm run format:check`: passes.
- Front-end suite (`DB_PATH` on a fresh file under `.claude-tmp/`): 191 files, 1,686 tests passed (the base had 188 and 1,645; 3 files and 41 tests new).
- Server suite, on a fresh database: 67 files passed and 1 skipped, 535 passed and 2 skipped (as the base).
- `npm run build`: passes.

## Decisions

- **Settled shows the amount collected at checkout** (the receipt's balance), even when it is nothing, and the line explains why (a plan, a gift card, or nothing left to collect). The motion plays only when the payment has just been recorded in this panel.
- **Fully booked follows the brief's rule literally**: rooms are not counted, so a day can read fully booked by people while a room is free, and a person who can give a 15-minute patch test (Theo) is fully booked only when no 15-minute stretch is left. A whole day counts, not only what is left after now.
- **The empty-time texture** is the half-hour guide line; it fades on a full day. The free-time buttons stay, so nothing that could be booked before becomes unbookable.
- **The pause is decoration only**: hidden from screen readers on the grid, on the phone columns and in the practitioner's list, so labels and counts read exactly as before.
- **All in hand is earned** (someone must have been due), counts a guest who tapped "I've arrived" as waiting, and keeps adding a reminder or logging a call one tap away rather than hiding them.
- **The ledger's money** is `report(state, 1, location)`: treatment takings after discounts and without included tax, tips and products before tax, renters left out. Guests seen counts every guest seen, renters' guests too.
- **The guest's label** says the studio's own arrival words once, on the label, and a general line when it has none. It shows for every visit status; the arrival line only while the visit is still to come.
- **The guest's first name now reaches their private page.** Until now the guest page carried no name at all, and three server tests checked that. The brief asks for the first name on the label, so `guest.firstName` is added and those tests now check that the surname, contact details and record ids still never come back (`server/usual.test.ts`, `server/guestPlans.test.ts`, `server/guestExtras.test.ts`). Anyone the link is forwarded to would see the first name; the lead may prefer to keep it off.
- **No studio photograph upload** was added (none exists to reuse); the house photograph stays decoration.
- **The map adapter lives in the browser code**, since a live map is a picture or embed the page shows; it has no network code at all in test mode.

## Quality bar

The shared `LoadingShapes`, `MoreOptions` and `--motion-calm` are not on this branch, so none is imported; the moments' durations (0.42 to 0.6 seconds, eased out, no bounce) live in `moments.css` and reduced motion removes them.

- [x] **One main job and one primary button per section.** Settled adds no button; the rebook moment keeps its one primary. All in hand has one quiet text button. The label and map add none.
- [x] **Rarely used options tucked away.** Nothing new to tuck away; the reminder and call forms sit behind one quiet line while all is in hand.
- [x] **No card inside a card; rows with hairlines.** Settled is a hairline and space, not a box. The ledger and label are ruled rows inside their existing panels. All in hand replaces the cards rather than nesting.
- [x] **At most one photograph per view, framed large and fading.** All in hand's photograph runs to the panel's edges and fades into the words; it replaces the cards, so Today's side column holds one photograph. The guest page keeps its one hero.
- [x] **Motion** is brief, calm and removed under reduced motion.
- [x] **No left-edge stripes; tokens only.** `--stone`, `--line`, `--line-strong`, `--ink`, `--muted`, `--brand-ink` and `--paper`; no new raw colours. The edges test passes.
- [x] **Warm, plain words**, British English, "visit" and "treatment", no dashes or exclamation marks; "recorded", "confirmed" and "no money moved" where each is true.
- [ ] **At 390 px.** Built for it (the calendar line takes its own row, the label's lines narrow to 82 px labels, the map scales, the All in hand link is 44 px tall), but not yet seen in a browser.
- [ ] **Before and after pictures** at 1440 and 390 px: not taken; for the lead's browser pass.

## Limits and notes

- **Not seen in a browser yet.** Everything above is from tests.
- **The ledger cannot yet be saved as an image** (the design notes mention it); it prints with the page.
- **Settled on a card payment** appears when the panel next shows the receipt after the provider confirms it, as the receipt did before.
- **Returning guest recognition** (moment 6 in the notes) was not in this part's brief and is not built here.

## Browser steps for the lead

At 1440 px and 390 px, in a sample studio (UK):

1. **Calendar**, next day until **Monday 12 October**: "Fully booked. Beautifully done." under the date; the half-hour guides gone; Maya's pauses tinted with "A pause"; hover the 11:45 pause and book from it as before. Go back to Tuesday 6 October: no line, and a small pause at 10:45 on Maya's lane. At 390 px, the same day in the people columns shows "A pause" above its free-time button.
2. **Today** on 12 October cannot be reached in a sample (its today is fixed); the Today line is covered by tests. Check the Today page reads as before on 6 October.
3. **Checkout**: open Amelia (in the studio), Continue to checkout, Record demo payment: the amount resolves, the hairline draws, "Settled." and "A sample studio, so this checkout is a demo. No money moved." Then try with reduced motion on.
4. **All in hand**: welcome Noor, mark both missed calls called back, sort both patch tests: Needs you gives way to the photograph and "All in hand". "Add a reminder or log a missed call" brings the cards back.
5. **Closing ledger**: check out every visit still open today, then open Business: "The day is settled." with the ledger and "Studio closed. See you tomorrow."
6. **Guest label and map**: open a visit still to come (Ava at 11:00), make a guest link and open it: "Your visit, Ava.", the ruled lines, the arrival line, and in Your studio the map placeholder with the address, "Map shown when a map service is connected." and Directions.
7. **Practitioner day**: sign in as Maya in a studio of your own with two visits a half hour apart: "A pause" sits between them.
