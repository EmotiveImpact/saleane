# LEFT-5C · Changing the time of a Google booking

Built 10 October 2026 in a worktree, on top of `left-stage5` at `957c445`. Everything below was checked with server, domain and component tests. It has **not been seen in a browser yet**: the lead runs the browser pass after the Stage 5 parts are put together. Google itself has never called it: SALEANE is not a Google booking partner yet, so this runs in test mode only, as the rest of Book with Google does.

## What it does

- **A guest who booked on Google can move the visit there.** Google's Actions Center sends `UpdateBooking` with a new `slot` (a start and a length, and optionally a professional). SALEANE moves the visit to that time, keeps everything that was booked, and answers with the booking at its new time. Before this, a Google booking could only be cancelled.
- **The same rules as the guest's own visit link.**
  - The same treatment and the same booked length. A slot for another treatment, another length or another studio is refused.
  - Until 24 hours before the visit (`GUEST_CANCEL_CUTOFF_HOURS`), never once it has started, and never while the studio is not taking changes online.
  - Only an open day within the booking window, never a time already gone.
  - The studio's patch test rule: a treatment that needs a clear patch test is not moved online to a time the guest's test does not cover.
  - A time free for desk bookings and for other guests holding a time online, with a room (`rescheduleResource` on the record with online holds added).
- **Who it is with.** A professional Google names for the new time is used. Otherwise a guest who chose a professional stays with them, and a guest who booked with anyone moves to whoever is free, their own professional first. Google keeps showing no name for a guest who booked with anyone.
- **The desk's own move.** The visit is moved with the `reschedule` command, recorded as "Book with Google". The booked treatment, price, deposit and tax stay as they were ("Booked treatment, price and deposit kept"), and the guest's private links follow the visit (`followGuestLinks`), as when they move it from their own link.
- **A retry changes nothing.** Google sends no key with `UpdateBooking`, so the move's event id is made from the booking, the move before it and the time asked for (`google-move-` and 32 hex characters). The same request again within 15 minutes finds that move and answers with the visit as it is now, even if the desk has moved it since. After 15 minutes the same request is a new move, so a guest can go back to a time once the desk has moved them off it.
- **Google reads the time the visit has now.** `CreateBooking`, `UpdateBooking`, `GetBookingStatus` and `ListBookings` all answer with the visit's current start and length (and the professional, when the guest chose one), so a move at the desk or from the guest's own link shows on Google too. The stored slot is updated after every move through Google.
- **The record.** The client's relationship timeline shows "Visit moved" by "Book with Google", with the old and new time. Settings, Who changed what shows "Moved through Book with Google" by "A guest, through Google".
- **A locked studio** (an unpaid bill) takes no new Google bookings and shows no free times on Google, while guests can still cancel or move a booking they already have, as with their own links.
- **Words.** Book with Google in Settings now says guests can move a visit on Google until 24 hours before it and cancel until it starts. A new help guide, "Let guests book on Google" (owners), explains it.

## Who can do what

| Who                     | Move a Google booking                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------------------------ |
| The guest, on Google    | Their own booking, to a free time for the same treatment, until 24 hours before, while online changes are on |
| Google's booking server | Only with the partner credentials (HTTP Basic), only in test mode on this computer                           |
| The studio team         | Moves it in the diary as any visit; Google then reads the new time                                           |
| Anyone else             | No: a booking id Google never made is not found, and a request without the partner credentials gets 401      |

There is no new command: a move through Google is the desk's `reschedule`, recorded with the server action `google.move`, which has its words in `changeRecord.ts`.

## Server

- `server/routes/guest.ts`: the guest's own move is now `moveOnline(ctx, org, appointmentId, {date, startMinutes, staffIds, actor, action, eventId})`, shared by the visit link and Google. It runs the guest's move rules, the open day check, the time check, the patch test rule and `rescheduleResource` on the record with holds, tries each professional in turn, dispatches `reschedule`, persists it and moves the guest links. It returns the new state or a refusal (`closed`, `cutoff`, `off`, `day`, `passed`, `taken`, `patch`, `failed`). The visit link's answers are unchanged.
- `server/googleBooking.ts`: `UpdateBooking` with a slot and no status (or `CONFIRMED`) moves; `CANCELED` cancels as before; anything else is `BOOKING_NOT_CANCELLABLE`. Refusals map to Google's failure causes: started or within 24 hours is `OUTSIDE_CANCELLATION_WINDOW`; online changes off or a visit no longer confirmed is `BOOKING_NOT_CANCELLABLE`; a cancelled visit is `BOOKING_ALREADY_CANCELLED`; a closed day, a time gone, a time taken, the patch test rule, another treatment, another length or another studio is `SLOT_UNAVAILABLE`. `bookingView` and `slotNow` read the visit's current time for every answer. A locked studio is refused new bookings and availability.
- No migration.

## Tests

- `server/googleBooking.test.ts`: 12 tests, 6 of them new in "Moving a Google booking to a new time":
  - **moves the visit and records it**: the same visit with the same booked terms, one revision, the "Visit moved" event by "Book with Google" with its `google-move-` id, one `google.move` audit entry with no staff actor, Who changed what's words, the stored slot, `ListBookings` and `GetBookingStatus` at the new time; **the same request again changes nothing**; a desk move shows on Google and a late retry of the old request does not undo it; after 16 minutes the same time is a new move;
  - **refusals with Google's causes**, nothing moved: another length or treatment, a start Google never offered, a time taken by another guest, before opening, a professional who does not do the treatment, another studio's booking, a closed day, more than 60 days ahead, a time already gone, anything but cancelling or a new time, and an unknown booking (404);
  - **the guest's own rules**: within 24 hours, once started, cancelled, and online changes off;
  - **the patch test rule** stops a time the guest's test does not cover;
  - **anyone or a named professional**: a guest who booked with anyone moves to whoever is free and Google shows no name; a guest who chose a professional is refused a time that professional is busy; Google can name another professional;
  - **a locked studio** takes no new Google bookings and shows no times, and a guest can still move and cancel.
- `src/domain/changeRecord.test.ts`: the words for `google.move`.
- `src/domain/help.test.ts`: "book on google maps" and "reserve with google" find the new guide; a manager does not.
- The guest link's own move tests (`server/guestMove.test.ts` and the others that move a visit) pass unchanged on the shared `moveOnline`.

## Checks

Run from the worktree root on 10 October 2026, after both Stage 5 parts of this branch and a merge of `left-stage5` at `d402850` (PR #92 and Stage 5A):

- `npx tsc -b`: pass.
- `npx eslint . --ignore-pattern '.claude/**' --max-warnings 0`: pass.
- `git ls-files -z | xargs -0 npx prettier --check --ignore-unknown`: pass.
- Front-end suite: 181 files, 1,595 tests passed.
- Server suite: 65 files passed and 1 skipped, 514 tests passed and 2 skipped.
- `npm run build`: pass.

## Decisions

- **Google's cancellation window covers moves.** Google's own model treats a change of time under the merchant's cancellation policy, so a move refused for timing is `OUTSIDE_CANCELLATION_WINDOW` and one refused because the studio takes no changes online is `BOOKING_NOT_CANCELLABLE`.
- **A retry is found by its event id, for 15 minutes.** Google sends no idempotency key with `UpdateBooking`. A key made from the booking, the move before it and the time asked for means a repeated request finds its move, while a later genuine move back to the same time still works.
- **One move function.** The guest link and Google share `moveOnline`, so the two can never drift apart. The visit link's answers and tests are unchanged.
- **A locked studio keeps its guests' changes.** It takes no new Google bookings, but cancelling and moving keep working, as the guest's own link does while a studio is locked.
- **No migration.** The stored slot is updated in the existing `google_bookings` row.

## Quality bar

- [x] **Each screen or section has one main job and one primary button.** No new screen; the Book with Google panel's words changed only.
- [x] **Rarely used options are tucked away.** Nothing new to tuck away.
- [x] **No card inside a card; lists use rows and hairlines.** No new layout.
- [x] **At most one photograph per view.** No photographs added.
- [x] **Warm, plain words**, British English, no exclamation marks or dashes: "It is less than 24 hours until this visit, so it can no longer be moved online."
- [x] **Design tokens and library components**; no new raw colours or left-edge stripes. Lint, types, tests and format pass.
- [ ] **At 390 px.** Not seen in a browser yet; only one paragraph changed, in an existing panel.
- [ ] **Before and after pictures** at 1440 and 390 px: not taken; the lead's browser pass.

## Limits and notes

- **Google has never called this.** It follows the Booking Server API v3 as published (`UpdateBooking` with a slot, the failure causes) and is tested with requests built from it. It needs Google partner approval and hosting before a real guest can move a visit.
- **Google may also send a party size or other fields**; they are ignored, as in `CreateBooking`.
- **A retry after 15 minutes** of a move the desk has since undone moves the visit again. Google retries within seconds, so this should not happen in practice.

## Browser steps for the lead

Not seen in a browser yet. Google cannot be driven from a browser, so the move itself is covered by the server tests; the browser shows its results.

At 1440 px and 390 px, signed in as the owner of a new studio of your own (not a sample) with online booking on, Book with Google ticked, and the server started with `SALEANE_GOOGLE_BOOKING=test` and partner credentials:

1. Settings, Studio details, Book with Google: the paragraph says guests can move a visit on Google until 24 hours before it and cancel until it starts.
2. Make a Google booking and move it with the test requests (as in `server/googleBooking.test.ts`: `CreateBooking`, then `UpdateBooking` with `{"booking":{"booking_id":"…","slot":{"start_sec":"…","duration_sec":"3600"}}}` and the partner's Basic credentials).
3. The diary shows the visit at the new time. The client's page, relationship timeline: "Visit moved" by Book with Google, with the old and new time.
4. Settings, Who changed what: "Moved through Book with Google" by "A guest, through Google".
5. Help: search "reserve with google" and open "Let guests book on Google".
6. At 390 px: the Book with Google panel wraps without sideways scrolling.

Screens to capture before and after, at 1440 and 390 px: the Book with Google panel; the diary with the moved visit; the client's timeline; Who changed what; the help guide.
