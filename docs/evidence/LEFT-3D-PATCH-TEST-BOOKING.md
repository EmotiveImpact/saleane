# LEFT-3D · Patch tests and online booking

Built 9 October 2026 in a worktree, on top of `fdee202` (Stage 1 and main merged into Stage 2). Everything below was checked with domain, component and server tests. It was not seen in a browser: this build ran without a dev server or browser by instruction, so the browser pass is left to the lead (see Browser steps for the lead).

## What it does

- **A studio setting, off by default.** In Settings, Treatments, Patch tests, below the existing rules, a tick box: "Stop online booking when a patch test is missing or out of date". Under it, a choice: "The patch test guests can book online", listing every treatment on the menu that needs no patch test itself, or "None: guests call or email you to arrange one". Both are saved with "Save patch test rules", and both appear in Who changed what ("stop online booking without a patch test", from "no" to "yes" the first time, then "yes" to "no"; "patch test guests book").
- **One rule decides for every way a guest books without the desk.** `onlinePatchTestStop` in `src/domain/patchTests.ts` returns the guest's words when a booking must stop, or null when it may go ahead. It stops only when the rule is on and the treatment needs a patch test. A guest goes ahead only with a clear test that counts for the visit's time under the studio's rules (at least the set hours before, and within the months a clear test lasts). A test still waiting for its result, one too close to the visit, one out of date and a recorded reaction all stop it.
- **What a guest reads.** On the booking page, choosing a treatment that needs a patch test shows a soft panel in place of "Choose a time":
  - Heading: "A patch test comes first".
  - "Gloss & Tone needs a quick patch test at least 48 hours before your visit, so Atelier House books it with you rather than online."
  - With a patch test bookable online: "Book your patch test here. If you have had one with us recently, call or email to book." and a primary "Book a patch test" button that switches the guest to the patch test and its times.
  - Without one: "Call or email to arrange your patch test, or to book if you have had one with us recently."
  - "Call 020 7946 0123" and "Email us" buttons for the studio's (or the chosen location's) phone and email. The words follow what the studio gave: "call", "email" or both. A studio with neither says "Pop in" and adds "You will find us at" its address, with a Directions button.
  - Nothing about the guest, any client or any record is ever shown.
- **The AI receptionist** (chat on the booking page, texts and social messages) says the same in one line and offers no time: "Gloss & Tone needs a patch test first, so it cannot be booked online. Book a patch test, or if you have had one recently, contact the studio to book." Its menu marks the treatment, and its instructions say never to say whether the guest has had a test.
- **Book with Google** leaves the treatment out of the services and availability feeds while the rule is on, so Google stops offering it; a booking Google still sends for it gets `SLOT_UNAVAILABLE` with the same words.
- **A guest moving their own visit** from its private link is the only online guest SALEANE knows for sure (the link is a hashed, revocable bearer for one visit). For a treatment that needs a test, Move my visit offers only times their clear test covers, says "This treatment needs a clear patch test that covers the visit, so only those times can be chosen here. For another time, contact the studio.", and a move to any other time is refused. Cancelling is unchanged.
- **The desk is never stopped.** In Book a visit, for a treatment that needs a patch test, a note under the times says where the client stands ("Needs a patch test at least 48 hours before", "Patch test clear on ...", "waiting for its result", a reaction). For someone new it reads "Someone new needs a patch test at least 48 hours before". When the same rule would have stopped the visit online, it adds: "Online booking would have stopped this visit, as the studio asks for a clear patch test first. You can still book it here." "Book the patch test first" (secondary) switches the dialog to the studio's patch test with someone who does it. Confirm stays enabled.
- **Help.** A new guide, "Stop online booking until a patch test is in place" (owners and managers), and one more step in "Book a visit" for the desk note.
- **Sample studio.** A new treatment, "Colour patch test" (Hair, 15 minutes, no charge, no deposit, with Theo), is set as the patch test guests book. The rule itself is off, as in every studio. Gloss & Tone already needs a patch test; Ellie Brooks is clear, Grace Chen's is waiting for its result and Luca Evans has none.

## Every way a guest books without the desk

| Path                                                              | Where it stops                                                                                                                                                                             | What the guest reads                                                         |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| Booking page, server (`/book/:slug`)                              | The catalogue says `patchTestFirst`, so the page shows the panel and never asks for times. `POST /holds` refuses with 422 before any time is held or details asked                         | The panel above; the refusal carries the one-line words                      |
| Booking page, last step (`POST /book`)                            | Checked again inside the booking, for a hold taken before the rule was turned on. 422, nothing written, no deposit started                                                                 | The same words, whatever name, email or phone was typed                      |
| AI receptionist (`/receptionist`, texts, social)                  | `find_times` and `offer_time` refuse; the treatments list marks it. Its times are booked on the booking page, so the page's checks apply after it too                                      | The same one line, no times                                                  |
| Book with Google                                                  | `bookableOnGoogle`: out of the services and availability feeds, `CheckAvailability` 0 (and `BatchAvailabilityLookup` through the same check); `CreateBooking` refuses after a replay check | `booking_failure` `SLOT_UNAVAILABLE` with the same words                     |
| Guest moving a visit (`/api/guest/move-times`, `/api/guest/move`) | Times filtered to those a clear test covers; a move elsewhere 422                                                                                                                          | The note in Move my visit; "...cannot be moved there online..." on a refusal |
| Browser-only demo booking page                                    | The same panel; its booking goes through the domain `book` command, which checks the rule for every `source: 'online'` booking                                                             | The same                                                                     |
| Anything else that books with `source: 'online'`                  | The domain `book` command itself, as a backstop                                                                                                                                            | The same                                                                     |

The desk (`source: 'desk'`) never passes through the rule.

## Privacy: why every online guest reads the same words

SALEANE never matches an online guest to a client: every online and Google booking creates a new client record from the details typed (the project's invariant, kept here). A typed email or phone number proves nothing, so using it to look up a patch test would let anyone find out whether a person is a client and whether they have had a test. So the booking page, the receptionist and Google never look. Every guest booking a treatment that needs a test is stopped with exactly the same words and status, before a time is held and before any details are asked. The tests send a made-up guest, the details of clients who are clear, waiting, untested, out of date and who reacted, and strangers with only a client's email or only their phone: every answer is byte for byte the same, and nothing is written.

The cost is that a client with a clear test cannot book that treatment online while the rule is on; the words tell them to contact the studio "if you have had one recently", and the desk can book them at once. The setting's help says this plainly before it is turned on ("Guests booking online are never matched to your client records, so with this on nobody can book Gloss & Tone online").

The only online guest SALEANE knows is the holder of a visit's private link, who already sees that one visit. Their move is checked against their own test, and the answer (times offered or not) tells them only about their own visit. A wrong or stopped link still gets "not found", as before.

## Who can do what

| Role                  | Setting (Settings, Treatments, Patch tests)                                                      | Desk note in Book a visit                                   | Guest screens                    |
| --------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- | -------------------------------- |
| Owner, manager        | See and change it, and the patch test guests book. Recorded in Who changed what (owners read it) | Yes, with "Book the patch test first"                       | n/a                              |
| Reception             | See it, disabled, with no Save. The server refuses a change (403)                                | Yes                                                         | n/a                              |
| General manager       | No (refused by the server, as for all patch test rules)                                          | Yes, from their branch view, which keeps patch test records | n/a                              |
| Practitioner          | No (their view has no Settings; refused by the server)                                           | Their view books no visits                                  | n/a                              |
| Regional manager      | No (refused by the server)                                                                       | Their area view books no visits                             | n/a                              |
| Guest, booking online | n/a                                                                                              | n/a                                                         | The panel, the receptionist line |
| Guest with a link     | n/a                                                                                              | n/a                                                         | The note and filtered move times |

## Server

- No migration. The two new fields (`stopOnline`, `testServiceId`) are optional members of the existing strict patch test settings schema, saved in the studio record. Older records read as off.
- `patch-test-settings` refuses a patch test treatment that is archived, not on the menu, or itself needs a test ("The patch test itself cannot be a treatment that needs a patch test."). It stays an owner and manager permission.
- `GET /api/public/:slug` adds `patchTestFirst: { testServiceId }` only while the rule is on. `testServiceId` is null unless the chosen treatment is on the menu, needs no test and is bookable somewhere by someone who does it.
- `POST /api/public/:slug/holds` checks the rule before any write (422). `POST /book` checks it after reading the hold and before booking or starting a deposit (422).
- `server/googleBooking.ts`: `CreateBooking` checks after its idempotent replay, so a booking made before the rule is still answered as it was.
- `server/routes/guest.ts`: `move-times` filters with the link holder's own standing at each start and adds `patchTest: true`; `move` checks after its existing time checks (422).
- The shared files changed only a little: `changeRecord.ts` (two field words), `helpArticles.ts` (one guide, one step), `commands.ts` (two lines in `book`). `operations.ts` and `commandSchema.ts` are untouched.

## Tests

- `server/patchTestBooking.test.ts` (10), against the real API on an in-memory database:
  - Booking page, rule off: a made-up guest, guests typing the details of Ellie (clear), Grace (waiting), Luca (none), Amelia (out of date) and Olivia (reaction), and strangers with only Ellie's email or only her phone all book a colour.
  - Rule on: the hold is refused (422) while the time stays free; at the last step the same nine guests get one identical answer, and the studio's revision, clients, visits and payments are unchanged. A facial and the patch test itself book. With no patch test online the words say to contact the studio.
  - Receptionist: colour times while off; the same line and no times once on; the patch test and a facial still offered.
  - Google: with the rule off, clients clear, out of date, reacted and untested, a stranger and strangers with a client's email or phone all book. With it on, the colour leaves both feeds, `CheckAvailability` is 0, all seven get one identical `booking_failure`, nothing is written, the earlier booking replays as confirmed and the patch test books.
  - Guest move: with the rule off, visits for clear, waiting, out of date, untested and reacted clients all move. With it on, clear moves; Luca's test covers the 15th but not the 22nd (no times, 422, then a move to the 15th works); waiting, untested and reacted get no times and 422; a made-up token gets 404; a facial still moves.
  - Setting: reception 403, manager 200, Who changed what shows "none to yes" then "yes to no".
  - Desk: books the patch test and the colour for Luca with the rule on.
- `src/domain/patchTests.test.ts` (6 new): off by default and the sample names its patch test; every unknown guest the same words; a known guest through only with a clear test for that time (clear, waiting, too close, out of date, reaction); the desk is never stopped; the patch test choice validated; the treatment off Google and out of the receptionist's times.
- `src/assistant/receptionist.test.ts` (2 new, 1 count updated for the sixth treatment): the same words for everyone, including Ellie texting from her own number with a clear test; `offer_time` refuses and the menu marks the treatment.
- `src/pages/ServerBookingPatchTest.test.tsx` (5): the panel's words and buttons, Book a patch test switches to its times with nothing asked about the colour and nothing held; contact words without a patch test, and Pop in with Directions when the studio gave no phone or email; rule off unchanged; a receptionist link with a time for a colour opens on the panel; a link naming a treatment opens with it chosen.
- `src/components/BookingPatchTest.test.tsx` (4): the desk note with "Online booking would have stopped this visit" and a confirmed desk booking; Book the patch test first switches treatment and professional; a clear client shows only the clear tag; with the rule off the warning and the quick way stay without the stopped line.
- `src/components/PatchTestRules.test.tsx` (3): off by default with its help as the box's description; saving sends the new fields; only treatments needing no test are offered; reception sees it disabled.
- `src/pages/ManageVisit.test.tsx` (1 new): the move note and the empty day message.
- `src/domain/help.test.ts` (3 new checks): the guide is found by owners' words and not shown to reception.

## Checks

- `npm run lint`, `npx tsc -b` and `npm run format:check`: pass. The client and server builds (`vite build`, written to a scratch folder so the worktree stays clean): pass.
- Front-end suite: 143 files, 1,243 tests passed.
- Server suite: 54 files passed and 1 skipped; 414 tests passed and 2 skipped (unchanged skips). Rerun in full after the last change to the server test file.

## Decisions

- **Only a clear result counts.** A test waiting for its result does not, so Grace is stopped until it is recorded. The help's note says to record the result once the skin has been checked.
- **Unknown means stopped.** See Privacy. Online, nobody is matched, so the rule stops every guest for that treatment. This is the only answer that cannot be used to learn about someone.
- **The receptionist does not use the texter's identity here.** A guest texting from the one number on a client's record is known to the receptionist for their own coming visits, but a time it offers is booked on the booking page, where nobody is known. So it says the same to everyone rather than offering a time the page would refuse.
- **Google leaves the treatment out** rather than offering times it would refuse. The patch test itself stays on Google when it is offered.
- **The move is filtered, not refused outright.** The link holder sees only times their own test covers. With none in order there are no times, and the note says to contact the studio.
- **The patch test treatment is the studio's choice**, so the panel's button and the desk's "Book the patch test first" point at a real treatment. When none is chosen, or it cannot be booked online, guests are asked to get in touch.
- **The sample** keeps the rule off, matching "off by default", with its new patch test already chosen so turning the rule on shows the full panel at once.
- **No migration**: optional settings fields in the studio record.

## Quality bar

- **One main job and one primary button.** The panel's one primary is "Book a patch test" (or "Call", "Email us" or "Directions" when it is the only way forward); the rest are secondary. In Book a visit, "Book the patch test first" is secondary so Confirm stays the dialog's one primary. The setting saves with the section's existing "Save patch test rules".
- **Rarely used options tucked away.** `MoreOptions` is not on this base (PR #83), and the new setting is an everyday choice for studios that use it, so it sits in view with its help beneath, like the reminder box above it. The patch test choice is a single select.
- **No card inside a card.** The panel replaces the "Choose a time" bar at the foot of the menu, a soft panel on the page in `--sage-soft`, shaped like the booking page's panel for a hold that ran out, not inside another card. The desk note is plain text and a tag in the dialog.
- **Photographs.** None added; the booking page keeps its own.
- **Empty pages.** No new page. In Move my visit, a day with nothing a clear test covers says so in one line with what to do.
- **Loading.** Nothing new loads: the panel comes with the catalogue the page already fetched, and choosing the patch test uses the page's existing time loading. `LoadingShapes` is not on this base.
- **Motion.** `--motion-calm` is not on this base, so nothing new moves.
- **390 px.** Below 650 px the panel's buttons stack at full width, one per line, using the design system's 44 px buttons; long studio names and addresses wrap. The desk note wraps inside the dialog (the tag's text wraps rather than overflowing).
- **Words.** Plain British English, "visit" and "treatment", no dashes and no exclamation marks; every stopped guest is told what to do next. Nothing claims a payment or a message.
- **Built from the library.** Tokens and existing classes only (`button`, `button-primary`, `button-secondary`, `ops-tag`, `ops-check`, `ops-field`, `ops-help`, `subtle`), `Button` from `src/design`, lucide icons as elsewhere, no new colours, no left-edge stripes.
- **Before and after pictures**: not taken (no browser in this build). The screens to capture are listed below.

## Limits and notes

- **Not seen in a browser.** Every journey is covered by component and server tests, but the panel's look at 1440 and 390 px, the desk note in the dialog and the move note need the lead's browser pass.
- A client with a clear test cannot book the treatment online while the rule is on (see Privacy). Studios that want clients with a test to book online would need signed-in guest accounts, which SALEANE does not have.
- The sample studio has no phone or email, so its panel says "pop in" with the address and Directions until the owner adds them in Settings.
- Sample studios created before this change keep their menu: the new "Colour patch test" appears only in a newly created sample.
- The menu shows the free patch test as £0.00, as it does for any free treatment; its description says "No charge." and the booking summary says "No charge for 15 minutes".
- The browser-only demo booking page shows the panel, but its sample has no server, so Google and the private link do not apply there.

## Browser steps for the lead

Sign up locally as a new owner with the sample studio (business date 6 October 2026).

1. **Setting.** Settings, Treatments, scroll to Patch tests. The box "Stop online booking when a patch test is missing or out of date" is unticked; its help names Gloss & Tone. "The patch test guests can book online" shows Colour patch test. Tick the box and choose Save patch test rules: "Saved."
2. **Who changed what.** Settings, Who changed what: "Changed the patch test rules" with "stop online booking without a patch test".
3. **Booking page.** Open the studio's booking page (`/book/<slug>`), choose Hair, then Gloss & Tone. In place of "Choose a time": "A patch test comes first", the two sentences, "Pop in ... You will find us at 24 Devonshire Place, London W1G.", Book a patch test and Directions. Choose Book a patch test: step 2 opens on Colour patch test with Theo's times. Book one as a made-up guest; no deposit is asked.
4. **Contact words.** Add a phone and email to the studio, reload the booking page and choose Gloss & Tone again: "call or email to book", with Call and Email us. Choose None as the patch test in Settings and save: the panel says "Call or email to arrange your patch test" and has no Book a patch test.
5. **Receptionist.** Settings, AI receptionist: turn it on. On the booking page choose Ask a question and ask "Any times for a gloss and tone on Thursday?": the one line, no times. Ask for a colour patch test or a facial: times as usual.
6. **Desk.** Today, New visit. Choose Luca Evans and Gloss & Tone: under the times, "Needs a patch test at least 48 hours before", "Online booking would have stopped this visit...", and Book the patch test first. Pick a time: Confirm is enabled. Choose Book the patch test first: the treatment becomes Colour patch test with Theo. Choose Ellie Brooks with Gloss & Tone: only "Patch test clear on ...". Grace Chen: waiting, with the stopped line. They are new: "Someone new needs a patch test...".
7. **Guest move.** Calendar, Ellie's Gloss & Tone on 8 October, Guest manage link, Create link. Open the link, Move my visit: the note, with times. Do the same for Grace's on 9 October: the note and "No times on ... can be chosen here. Try another day, or contact the studio."
8. **Google.** Google is never offered for a sample studio, so use a studio made without the sample: add a treatment that needs a patch test, a patch test treatment and someone who does both, turn on online booking, then Settings, Studio details, Book with Google. "Google would show N treatments" drops by one when the rule is on and rises again when it is off.
9. **Help.** Open Help and search "stop online booking without a patch test": the new guide. As reception it is not offered.
10. **Off again.** Untick the box and save: the booking page shows "Choose a time" for Gloss & Tone, and the desk note loses the stopped line.
11. **390 px.** On the booking page the panel's buttons stack at full width with nothing scrolling sideways; in Book a visit the note wraps.

Screens to capture before and after, at 1440 and 390 px: Settings, Treatments, Patch tests; the booking page with the panel (with and without a phone and email); the receptionist's answer; Book a visit with the desk note; Move my visit with the note.
