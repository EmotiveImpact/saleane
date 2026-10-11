# LEFT-5A · My usual

Built 10 October 2026 in a worktree on branch `left-s5usual`, from `left-stage5` at `957c445`, then merged with `left-stage5` at `462f889` (the real AI behind the receptionist and Ask SALEANE, #92) and built on that shape. Everything below was checked with unit, component and server tests. **It has not been seen in a browser yet**: the lead runs the browser pass after the Stage 5 parts are put together (steps at the end).

## What it does

- **One usual, worked out in one place.** `src/domain/usual.ts` works out a guest's usual from their own completed visits: the treatment, the professional they see, the location (with several), the day of the week, the part of the day (morning, afternoon, evening), the typical start time and the next usual day. The client page's "At a glance", the AI receptionist, the guest's visit page and Ask SALEANE all read it, so they never disagree.
- **The client page's rules, unchanged.** Only completed visits in the last 12 months (364 days) count. A favourite treatment, professional or location needs at least three visits, the top one in at least two of them, no tie, and at least half. A day or part of the day is a habit from four visits, two thirds of them alike. The typical start is the middle start time of the visits in that part of the day (on that day when there is one). `clientInsight.ts` now takes these from `usual.ts`; the client page shows exactly what it showed before and its 35 tests pass unchanged.
- **One guest, however many records.** Every online booking opens a new record, so the usual reads every record with the same email (case does not matter), as messages to clients and filling a cancelled time already do. The client page still reads one record, as it always has.
- **The next usual day.** From the day they are due back (the same "due back" the studio already uses), moved on to their usual day of the week when they have one, and never more than 90 days ahead.
- **What changed, said plainly.** A treatment archived or removed ("Your usual, Restorative Facial, is not on the menu now."); the person they see no longer takes bookings, no longer does it, or has moved to another location (named when they work somewhere that offers it); their usual location closed or no longer offers it. A treatment that needs a patch test first, or that cannot be booked online anywhere, is still their usual, and the online stop is said in the same words everyone else reads.
- **No usual, and why.** Fewer than three completed visits in the year ("I cannot see a usual from your visits yet."), no one treatment that stands out ("Your visits do not point to one usual treatment."), or the treatment is gone.

### The AI receptionist, by text

- **Who is writing.** By text or WhatsApp a guest is known from the number they write from. Until now that meant exactly one record with that number, so a guest who had booked online twice was never known. `src/domain/textingGuest.ts` also knows a number when every record with it shares one email, and answers with the record that has the latest visit. A number on records with different emails (a family phone) stays unknown, a sender the team matched by hand still proves nothing, and nobody is ever known in the booking page chat.
- **"My usual".** A known guest who writes "my usual", "the usual please", "same as last time", "same again", "my regular", "usual" and so on gets one line saying what the usual is and anything that changed, then times for it with the person they usually see, at their usual location, from their next usual day, in their usual part of the day. For example: "Your usual is Restorative Facial with Maya Lind, on Saturday mornings. Free on Saturday 31 October with Maya Lind: 09:00, 09:15, … Which would you like?"
- **Follow-ups.** "10:00 please" offers that time as before, as a link to finish booking on the page. "Saturday at 11 then", "my usual with Theo", "my usual with anyone", "my usual on Friday afternoon" look again with that change. With nothing free it looks on a week at a time (a day at a time without a usual day), up to four looks, then says so: "There is nothing free with Maya Lind in the morning on the next four Saturdays. Tell me another day or time, or say "with anyone", and I will look again."
- **No usual.** It says why and asks which treatment, listing the menu; the guest's answer carries on to times.
- **Not "my usual opening hours".** "The usual hours" asks about opening hours, and "move my usual appointment" is a change to a booked visit, which goes to the private link as before.
- **A visit under any of their records.** "Can I move my booking?" now finds the guest's coming visits under every record with their number and email, and the private link is written against the record the visit is under, so the outbox's checks before it goes are unchanged.
- **The new skill, `my_usual`**, is offered only to a known guest. It returns the summary and notes, the treatment, professional and location ids and names, the day, the part of the day with `after` and `before` (as `find_times` takes them), the next usual date, any online stop, and who does the treatment where. Never a price, another guest, a note or a visit. Its description tells a real model to pass these straight to `find_times`; the standing instructions say when to use it, and that without it the receptionist cannot see who is writing.

### The booking page chat, where nobody is known

"I cannot see who you are in this chat, so I do not know your usual. Which treatment would you like? Tell me and I will find you a time, or use the link from your last visit, or text us from the number on your booking." A treatment named in the same message is simply looked for. By text from a number it cannot match: "I cannot tell who is writing from this number, so I do not know your usual. Which treatment would you like? Tell me and I will find you a time. The team can see your message too."

### The guest's visit page

After a completed visit, while the private link still opens (seven days after the visit), the page shows "Come back for your usual?" with "Restorative Facial with Maya, from Saturday 31 October. Choose a time on Linden Studio's booking page." and a "Book your usual" link. The link opens the booking page on the times for that day with the treatment, professional (or "No preference") and location chosen, and no time chosen, held or said to be gone. It shows only while the studio takes bookings online, the guest has a clear usual they can book online, and nothing is booked ahead under any of their records. The new `usual` field in `guestViewSchema` is strict and carries only the path, the treatment's name, the professional's first name, the date and, with several, the location's name: nothing about the visits it was worked out from, so the page keeps its "no history or other visits" promise.

### Ask SALEANE

A new read skill, `client_usual`, gives one client's usual in the team's words, with how many visits it counted and across how many records. "Book Amelia her usual on Saturday" finds Amelia, reads her usual, looks for free times with her usual professional on that day (or her next usual day when no day is named), and proposes `book_visit` at the time named or at her usual start time. The booking waits for "Approve", as every Ask SALEANE booking does. If the time is taken it lists free times in her usual part of the day and asks. "What is Amelia's usual?" says it and her next usual day. With no usual it says why and asks which treatment. Its description gives a real model the same steps.

### Help

"When a guest asks for their usual", in Messages and AI, for owners, managers, reception and general managers: the three-visit rule, the text receptionist, the booking page chat, "Book your usual" on the visit page and "book Amelia her usual on Friday".

## Who can do what

| Who                                 | The usual                                                                     |
| ----------------------------------- | ----------------------------------------------------------------------------- |
| A guest texting from their number   | Their own usual and times, from the receptionist; nothing about anyone else   |
| A guest in the booking page chat    | Nobody is known: asked which treatment                                        |
| A guest with a visit's private link | "Book your usual" after a completed visit; only the link and the words for it |
| Owner, manager, reception           | `client_usual` in Ask SALEANE; a usual booking proposed for approval          |
| General manager                     | The same, in their own location's `branchView`; booking as before             |
| Practitioner, regional manager      | No `client_usual` (no whole-studio skills, as before), no help guide          |

## Server

- `server/messaging/receptionistText.ts`: the guest is known through `textingGuest`; a private link's answer is written against the record its visit is under. No other server change.
- No migration, no new route, no new command. The guest page's field comes through the existing `/api/guest/visit`.

## Tests

- `src/domain/usual.test.ts` (12): the favourite and pattern rules with ties; the typical start; the next usual day; a regular agreeing with the client page; too few visits and no clear treatment; records merged by email, case-insensitive, another guest left out, and a visit booked ahead under another record; a treatment archived or removed (named from the visit); a professional archived or no longer doing it; a professional moved to another location; several locations, not offered and closed; the patch test stop and a treatment bookable nowhere online; who is texting, from one record or several with one email, and never with two emails.
- `src/assistant/receptionistUsual.test.ts` (15): six ways of asking; the listed times are the usual treatment with Maya on 31 October in the morning; picking 10:00 offers exactly that time; "Saturday at 11 then"; with Theo, with anyone, Friday afternoon; looking on a week and the four-Saturdays answer; no usual, then a treatment; no clear treatment; a professional away and a treatment off the menu; the patch test stop with no times; no other guest, note or price in the skill or the answer; the booking page chat and an unknown number; `my_usual` not offered without a known guest; phrases that are and are not a usual; "move my usual appointment" is a change; a coming visit under a second record, never another guest's; a scripted real AI that calls `my_usual` and passes its fields to `find_times` unchanged; the instructions and facts without a known guest.
- `src/domain/guestUsual.test.ts` (7): the link and its words; with several locations; only after a completed visit, not with a visit booked ahead, without the page address or with online booking off; a visit booked ahead under another record; no usual and the patch test stop; the view is the same page plus the link and nothing else; the strict schema refuses extra fields.
- `src/pages/ManageVisit.test.tsx` (+2, 31): "Come back for your usual?" with its words and link on a completed visit; no link without one.
- `src/pages/ServerBookingUsual.test.tsx` (3): a usual link opens on that day's times with the treatment and professional chosen and no time chosen, held or gone; with anyone; a past day opens on the treatment.
- `src/assistant/saleaneUsual.test.ts` (9): `client_usual` in full; two records and a professional who left; who is given it; booking on the day named and on the next usual day, at the usual time and at a time named; the usual time taken; "what is Amelia's usual?", no usual, no such client; a practitioner; a scripted real AI following the skill's described steps to a proposal that waits for approval.
- `src/domain/help.test.ts`: "guest asks for their usual", "same as last time" (reception) and "book a client their usual" (general manager) find the guide; practitioners and regional managers do not; "client insight" still finds At a glance.
- `server/usual.test.ts` (4): a real studio in test mode, Rosa's four Saturday visits over two records booked, arrived and paid through commands as the clock moves: a text for her usual answers with the usual line and times against her latest record, and "10:00 please" gives the booking link with Maya and 31 October; a shared family number and an unknown number are not known; her last visit's private link carries the usual link and none of her details, other visits or Grace's, and loses it once she books ahead; no link while online booking is off.

## Checks

All from the worktree root, after the merge with `left-stage5`:

- `npx tsc -b`: pass.
- `npx eslint . --ignore-pattern '.claude/**' --max-warnings 0`: pass.
- `git ls-files -z | xargs -0 npx prettier --check --ignore-unknown`: pass.
- Front-end suite: 179 files, 1,585 tests passed (48 of them new). One run had a timing failure in `StudioSetup.test.tsx`, which this work does not touch; it passed alone and on a full rerun.
- Server suite, on a fresh database: 65 files (one skipped, as before), 494 passed and 2 skipped (4 new).
- `npm run build`: pass.

## Decisions

- **No migration, no command.** The usual is read from the record each time; nothing is stored.
- **The client page stays per record.** Merging records there would change a page the brief says must not change, so only the rules moved.
- **Known by a number shared by records with one email.** Without this, the guests most likely to ask for their usual (those who book online) could never be known by text. Two emails on one number stay unknown.
- **The usual link only when nothing is booked ahead.** A guest with a visit to come has no usual to book again yet, and the page should not invite a double booking.
- **The link is secondary.** The completed visit page may also show the feedback form's button, so "Book your usual" uses the secondary style to keep one primary button.
- **"From" the next usual day.** The guest page link opens that day's times; the guest can move to any day. The receptionist looks from that day, or the day the guest names.
- **The receptionist's skill takes no input.** It can only ever read the known guest's own usual, so there is nothing for a model to get wrong or misuse.
- **Day names** come from the studio's locale; dates are labelled as elsewhere.

## Quality bar

- [x] **One primary button per screen.** The usual section adds one secondary link; nothing else on the visit page changed.
- [x] **Rarely used options tucked away.** Nothing new to tuck away.
- [x] **No card inside a card.** The section reuses the visit page's "Would you like another time?" layout (`visit-again`), divided by space.
- [x] **No left-edge stripe, no new raw colours.** Existing classes and tokens only; the stripe test passes.
- [x] **Plain words**, British English, "visit" and "treatment", no dashes or exclamation marks, and nothing says a time is booked: "Nothing is booked until you confirm on that page."
- [ ] **At 390 px.** The section reuses styles already checked at 390 px, but this has not been seen in a browser yet.
- [ ] **Before and after pictures.** Not taken: no browser in this part.

## Limits and notes

- **Not seen in a browser yet.**
- **The booking page chat never knows the guest.** By design: anyone can type anything there.
- **A real AI** has been exercised only with scripted brains that use the skills as their descriptions say; no real model was called.
- **A family sharing one number with one email** is read as one guest. That is how SALEANE already counts records with one email.
- **The usual link on the visit page** appears only while the link opens, seven days after the visit; the next usual day may be weeks later, which the words make clear ("from Saturday 31 October").
- **Live texts** stay in test mode behind the existing provider; nothing here sends anything itself.

## Seen in a browser

On 10 October 2026, at 1440 and 390 px. Sample studios never answer texts, so the texting steps were followed in a studio of its own (Linden Studio, made up for the purpose) on a clock moved forward, where Rosa Field has four completed facials with Maya on Saturday mornings, two of them under a second record her online booking opened. The booking page chat, Ask SALEANE and Olivia's page were also followed in the UK sample.

- Inbox, "Deliver a test text" from Rosa's number, "Can I book my usual?": "Your usual is Restorative facial with Maya Lind, on Saturday mornings. Free on Saturday 31 October with Maya Lind: …". "10:00 please" answers with the booking link, and the link opens the booking page on that day with Maya and 10:00 chosen.
- A text from a made-up number answers that it cannot tell who is writing. The booking page chat answers that it cannot see who you are.
- Rosa's completed visit page shows "Come back for your usual?" with "Restorative facial with Maya, from Saturday 31 October" and "Book your usual", which opens the booking page on that day.
- Ask SALEANE: "What is Rosa's usual?" and "Book Rosa her usual on Saturday" give the usual and a booking to approve. Olivia's At a glance reads as before.
- Help: "When a guest asks for their usual" opens from search.
- Found and fixed:
  - Rosa's texts landed in a conversation of their own, unmatched, because her number was on two records. A number on several records of one guest (all with the same email) now goes to the record of their latest visit (`src/domain/inbox.ts`, tested in `src/domain/inbox.test.ts` and `server/usual.test.ts`).
  - Ask SALEANE asked "which Rosa?" between her two records. It now treats records with the same email as one guest, and books under the record she last visited under; someone with the same name and another email is still asked about (`src/assistant/saleane.ts`, tested in `src/assistant/saleaneUsual.test.ts`).
  - The booking page opened from the usual link, weeks ahead, did not show the chosen day in the day strip. A day chosen before the strip appears is now shown at once (`src/components/DayStrip.tsx`, tested in `src/components/DayStrip.test.tsx`).
  - Asked to "book Amelia her usual on Saturday 31 October", Ask SALEANE offered the nearest Saturday instead, because only weekday names were read. Ask SALEANE and the receptionist now read a written date ("31 October", "October 24th" or 2026-10-31), taking its next occurrence and refusing an impossible one (`src/assistant/receptionistBrain.ts` and `src/assistant/testBrain.ts`, tested in `src/assistant/saleaneUsual.test.ts`).
- Not seen in a browser, covered by tests: the receptionist on WhatsApp and the social inboxes, a live text provider and a real AI.

## Browser steps for the lead

Followed on 10 October 2026; what was seen is under Seen in a browser. Sample studios never answer texts, so steps 1, 3 and 4 need a studio of its own in test mode, with a guest who has at least three completed visits; the rest work at 1440 px and 390 px, signed up as a new owner with the UK sample studio. In the tests' sample (Tuesday 6 October) Olivia James's usual is a Lymphatic Massage with Sophia on Tuesday mornings, Noor Ahmed's and Amelia Carter's a Skin Renewal Facial with Maya on Tuesday mornings; a sample built on another day moves its dates with it.

1. Settings: turn on the AI receptionist and its answers to texts. Online booking is already on.
2. Clients, Olivia James: At a glance reads exactly as before this change.
3. Inbox, "Deliver a test text", from Olivia James's number: "Can I book my usual?". Her conversation shows "Your usual is Lymphatic Massage with Sophia Reed, on Tuesday mornings. Free on Tuesday … with Sophia Reed: …". Deliver "10:00 please" (or a time it listed): the answer carries the booking link; open it and see that time chosen. Try "same as last time", "my usual with anyone" and "my usual on Friday afternoon" too.
4. "Deliver a test text" from a made-up number: "my usual" answers "I cannot tell who is writing from this number, so I do not know your usual…".
5. The studio's booking page, its chat: "my usual" answers "I cannot see who you are in this chat…". Then "Lymphatic Massage on Thursday": times.
6. The diary: open Noor Ahmed's 11:00 visit today, Guest manage link, "Create link", and copy it. Mark her arrived and check her out. Open the link in a private window: below the visit, "Come back for your usual?" with "Skin Renewal Facial with Maya, from Tuesday …" and "Book your usual". Follow it: the booking page opens on "Find your moment." on that day with Maya chosen and no time chosen.
7. Back at the desk, book Noor another visit and reload the link: the usual section is gone.
8. Ask SALEANE as the owner: "What is Amelia's usual?", then "Book Amelia her usual on Tuesday": a booking at her usual time to approve; approve it and see it in the diary. As reception the same works. As a practitioner there is no usual.
9. Help, as reception: search "my usual" and open "When a guest asks for their usual".
10. At 390 px: the visit page's usual section stacks, "Book your usual" is at least 44 px tall, and nothing scrolls sideways.

Screens to capture before and after, at 1440 and 390 px: the Inbox conversation with the usual answer; the booking page chat answer; the completed visit page with "Come back for your usual?"; the booking page opened from it; Ask SALEANE with the usual booking to approve; the help guide; Olivia's client page At a glance (unchanged).
