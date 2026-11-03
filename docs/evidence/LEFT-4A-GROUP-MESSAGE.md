# LEFT-4A · One message to clients across the whole group

Built 10 October 2026 in a worktree, on top of main at `7684b33`. Everything below was checked with unit, component and server tests. Then seen in a browser on 10 October 2026, at 1440 and 390 px, after the four Stage 4 parts were put together; what was seen and fixed is under Seen in a browser.

## What it does

- **One message for many clients.** Inbox has a new "Messages to clients" link for owners, managers and general managers, which opens `/inbox/news`. A message has a subject, a few lines (up to 1,000 characters), who it is for (every client of the studio, or the clients of chosen locations) and how it goes (by email, or by text where the client agreed to texts and by email otherwise). It can end with a link to the studio's booking page. It is one well made message, not a campaign builder: no templates, schedules or automations.
- **A draft first.** Saving makes a draft. A draft can be changed or put aside (kept in the record under "Drafts put aside", never deleted). Nothing is queued until the owner approves it.
- **The numbers before approval.** Each draft shows how many clients it would reach, by email and by text, the same split for each location, and how many were left out and why ("Have not agreed to news and offers", "Asked to have their details erased", "Replied STOP to the studio’s texts"). Only numbers are ever shown, never a list of names, addresses or numbers.
- **Who receives it.**
  - Only clients with `marketingConsent` on. If any of a person's records said no, the person is left out.
  - Never anyone with an erasure request (the audit log's `client.erasure_requested`), under any of their records.
  - Never anyone whose number replied STOP to the studio's texts (`textsStopped`, Stage 1). They are left out of the message entirely, by email too, as the brief says "never a client who replied STOP".
  - One copy per person. Records with the same email (online booking can open a second record) count as one person, and one number never gets two texts.
  - By text only when the newest consent record's wording names texts, their visit texts are on and they have a mobile number in international form. Everyone else in a "by email or text" message gets an email, and the draft says how many.
  - Clients have no archived flag in this base, so "archived" has nothing to check; erasure is the only way a client leaves.
- **"Clients of a location"**, shown on screen word for word: "A client of a location had a visit there in the last 12 months, or has one booked there." A visit counts when it was completed or the client arrived; a cancelled visit or a no-show does not. A person with visits at two chosen locations is counted once, at the location of their latest visit, or failing that their next booking. "Every client of the studio" means every client who agreed, whether or not they have visited.
- **The words.**
  - The email starts "Hello [first name]," and ends "You are hearing from {studio} because you agreed to news and offers. To stop them, use this link: …" then the studio's name.
  - The text starts "{studio}: " and ends "Reply STOP to stop texts." Curly quotes, dashes and the ellipsis are made plain, so they do not make each part of a text hold 70 characters instead of 160.
  - The draft previews it "As an email" and "As a text", with the text's characters and parts (160 plain characters to a text, 153 a part; 70 and 67 for anything outside the plain set; € and square brackets take two places).
- **The stop link in each email.**
  - Each copy gets its own link, `/news/stop#token`. Only the token's SHA-256 hash is kept, in the new `news_links` table.
  - The link works for 400 days and is retired when the client's email address changes.
  - The link opens a page that asks before it does anything, so a mail program that opens links by itself changes nothing. Pressing "Stop news and offers" turns `marketingConsent` off under every record of that person and holds back any queued Inbox marketing. It adds "Email marketing withdrawn: Stopped from the link in a message to clients. No message sent." to their timeline and a consent record with the new source "email link". It shows in Settings, Who changed what, as "A client, from the link in a message to clients".
  - A second press says "Your news is already off." A wrong, expired or retired link always reads the same: "This link has expired or been replaced. Ask the studio to stop your news."
  - Emails go on Postmark's `broadcast` stream with a `List-Unsubscribe` header naming the link.
- **Quiet hours.** Copies are queued from the next 09:00 to 19:00 window on the studio's clock (clock changes included), and the outbox checks the time again as each one leaves. A copy that comes due at night waits for the morning. A copy that could not go within three days of approval is not sent at all.
- **Approval.**
  - The owner opens the draft and chooses "Check and approve". The panel asks "Send to 12 clients: 12 by email, 0 by text?", says that approving checks every agreement again and that the words cannot change afterwards, and says what happens in this studio (sample, test mode or live). Then "Approve and send to 12 clients", or "Not yet".
  - The server works the numbers out again at that moment, with erasure requests it reads from its own audit log, never from the browser. If they differ from the ones the owner saw, it refuses: "The numbers changed since you looked. It would now go to 3 clients: 3 by email and 0 by text. Check them and approve again." A message nobody could receive is refused too.
  - In the same transaction, one outbox row is written per person. Each row is keyed by message and client, so a repeat or a replayed request adds nothing.
- **Once approved** the words are fixed: "Change it" is gone and the server refuses a change ("This message is approved, so it can no longer be changed."). "Stop the rest" (with "Keep it going" to back out) marks every copy still waiting as not sent, "Stopped before it went out.", and says copies already with the provider cannot be called back.
- **Just before each copy leaves**, the outbox checks again that the message is still approved, the client still agrees, has not replied STOP, has no erasure request, and can still be reached that way (a text needs the same number and the texts agreement). Anything that fails is "Not sent" with the reason.
- **Honest wording.**
  - Test mode: the outbox writes each copy as `test` and the screen says "Queued in test mode, not sent".
  - Sample studios never queue and say "Approved. A sample studio, so nothing was queued or sent." (the row reads "Sample, nothing sent").
  - With a live provider: "Approved. Queued to go out between 09:00 and 19:00. A message is called delivered only when the provider confirms it."
  - The panel then counts the copies at each outbox status (Waiting to go, Test mode not sent, With the provider no receipt yet, Delivered, Not delivered, Unclear, Not sent). Delivered and Not delivered come only from provider receipts. Nothing on screen says a message was sent.
- **Visit messages first.** In each batch of 50 the outbox takes visit messages before copies of a message to clients, so a big message never holds up a confirmation or a reminder.
- **The record.**
  - Settings, Who changed what lists "Wrote a message to clients", "Changed a message to clients" (with the changed parts named), "Approved a message to clients" (with "clients by email", "clients by text" and "clients left out"), "Stopped a message to clients" and "Put aside a message to clients", each with who and when.
  - The panel's "The record" lists written by, last changed by, approved by, stopped by and put aside by, with the time on the studio's clock.
  - Each recipient's timeline gets "Message to clients" with the subject and channel, not the full text: "“Thursday evenings at Atelier House”, by email. Queued to go out, not sent yet. Whether it went shows with their messages." Their own message list shows the copy with its status, the stop link replaced by "[private link to stop news]".
  - The studio-wide message list leaves these copies out, so a message to 200 clients does not crowd out everything else.
- **The sample studio** has a draft ready to approve: "Thursday evenings at Atelier House", by email or text, with a link to book, written by Sophia Reed. In the tests' sample it reaches 12 clients, all by email (the sample's consent wording names email only), with 3 left out who have not agreed. A new studio's sample in the browser has more clients and takes the studio's own name: "Thursday evenings at Linden Studio" would go to 209 clients, 209 by email and 0 by text, with 90 left out.
- **Help**: three guides in Messages and AI ("Write one message to many clients", "Who receives a message to clients", "Approve a message to clients") for owners, managers and general managers, offered first on `/inbox/news`.

## Who can do what

| Role             | Inbox                                    | Messages to clients                                                         | Write or change a draft, put it aside        | Approve | Stop the rest                       | Send a copy again |
| ---------------- | ---------------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------- | ------- | ----------------------------------- | ----------------- |
| Owner            | "Messages to clients" link               | Every message                                                               | Whole studio or chosen locations             | Yes     | Yes                                 | Yes               |
| Manager          | "Messages to clients" link               | Every message; "The owner checks the numbers and approves it."              | Whole studio or chosen locations             | No      | Yes                                 | No                |
| General manager  | "Messages to clients" link               | Only messages for their own location alone (the server leaves out the rest) | Their own location only, fixed in the editor | No      | Their own location's messages only  | No                |
| Reception        | No link; `/inbox/news` goes to the Inbox | No: the server removes messages to clients from what the desk receives      | No                                           | No      | No                                  | No                |
| Practitioner     | Their own day page only                  | No                                                                          | No                                           | No      | No                                  | No                |
| Regional manager | Their area page only                     | No                                                                          | No                                           | No      | No                                  | No                |
| Client           | The stop link at the foot of each email  | No                                                                          | No                                           | No      | Stops their own news, nobody else's | No                |

Every rule is enforced by the server: the permission (`news` to draft, `news-send` to approve, owner only, `news-stop`, and `news-unsubscribe` for the stop link only), the general manager's location check in `branchRefusal`, and refusals for practitioners and regional managers. A general manager asking the numbers for any other scope gets 403, and the numbers are only ever counts.

## Server

- **Migration 33** rebuilds the outbox with `outboxWithKinds` to allow the kind `news`, adds an index on (organisation, kind, slot), the `news_links` table (token hash, organisation, client, message, outbox row, created, expires, used, revoked, with `expires_at > created_at`) with an index by client, and an index on the audit log by (organisation, action, record) for the erasure check.
- `server/messaging/news.ts`: `watchNews` runs inside the transaction that saves a change. On `news-approve` for a real studio it counts again (409 if the numbers differ) and writes one `pending` row per person with `INSERT OR IGNORE` on the key `news:{message}:{client}`. On `news-stop` it skips every waiting copy. On any change of a client's email it retires their stop links. `issueNewsLink` and `openNewsLink` make and read the hashed links.
- `server/messaging/outbox.ts`: the `news` branch of the claim (sample, three days, daytime, the checks above, then the booking link and a fresh stop link for an email). Visit messages go first in each batch.
- `server/routes/news.ts`: `GET /api/workspaces/:orgId/news` (counts by outbox status for each approved message), `GET /api/workspaces/:orgId/news/audience` (the numbers for a draft, with erasure requests), `POST /api/news/open` and `POST /api/news/stop` (rate limited, the same 404 for every failure; the stop runs in one transaction and is recorded with no staff actor).
- `server/routes/workspace.ts`: the server fills in erasure requests on `news-approve`, overriding anything a browser sends.
- `server/routes/messaging.ts`: the stop link is never shown in a message list; sending a copy again needs the owner.
- `server/messaging/providers.ts`: Postmark's `broadcast` stream and the `List-Unsubscribe` header for these emails.
- `server/projections.ts`: reception receives no messages to clients. `branchView` gives a general manager only their own location's.
- `server/README.md`: a paragraph on the outbox rules and the three new routes.

## Tests

- `src/domain/news.test.ts` (21): one person under several records, and left out when any record said no; erasure under any record; the location rule (12 months, booked ahead, cancelled visits do not count, a visit 13 months ago does not); everyone placed for the whole studio; texts only with an agreement naming texts, one text to a number, never after STOP; the email and text words, plain characters and the dash straightening; text parts; quiet hours across the October clock change; drafting, changing, putting aside, refusing a change once approved; approval only with the numbers the owner saw, the record and every client's timeline; a message nobody could receive; stopping once and never a draft; each copy checked again (stopped, erased, consent, STOP, texts); the stop link under every record with a consent record of where; permissions; a general manager kept to their location, in commands and in their view; practitioners and regional managers refused; words in the record; the studio record's own checks; the sample draft.
- `server/news.test.ts` (12): **test mode queues one copy per person, says none was sent**, and shows on the client's list and in Who changed what; **consent counted again at approval** (a client who withdrew between looking and approving is refused) and erasure requests read by the server even when a browser sends `erased: []`; **no double queue** from a replayed idempotency key or a repeated approval; **texts only to those who agreed, with "Reply STOP to stop texts.", never after STOP**, and a provider receipt turning one into Delivered; **quiet hours, then consent, STOP and erasure checked again overnight**; a night copy rescheduled to 09:00 and a three-day-old copy dropped; **stopping mid-way**: of 64 copies, 50 go in the first batch, a stop marks the remaining 14 Not sent and nothing more goes; **the stop link**: hashed only, opens without changing anything, stops news under both records with an "email link" consent record and no staff actor, a second use says it is already off, bad links all read the same, and a link is retired when the client's email changes; **a general manager** drafts only for their own location, cannot see, put aside or stop the owner's message to everyone, cannot ask the numbers for any other scope, cannot approve and cannot send a copy again (the owner can), and their approved draft reaches only their location's clients; **a manager drafts but cannot approve**, reception and practitioners are refused, reception's studio record has no messages to clients, and staff cannot use the client's stop command; **a sample studio approves without queuing anything**; Postmark's `broadcast` stream and `List-Unsubscribe` header.
- `src/pages/News.test.tsx` (8): the sample draft with its numbers, left out lines, rule, no names or addresses, and both previews with text parts; the owner's check and approval with sample wording and the fixed message afterwards; a manager changes the draft but has no approval; a general manager's editor fixed to their location and their numbers; choosing locations and the numbers by location; the welcome on an empty page; putting a draft aside into the fold; for a real studio, approval waits until the server says whether email and texts are live, then words the check and the notice for test mode or for live providers.
- `src/pages/NewsStop.test.tsx` (4): asks first and stops only on the button; already off; the same answer for a bad link; a malformed token never reaches the server.
- `src/domain/help.test.ts`: "send a newsletter to all clients", "group message" and "bulk email" find the first guide; "which clients are left out" the second; "approve a message to clients" the third; a general manager finds it; reception and practitioners do not; the three guides come first on `/inbox/news`. The existing "client replied STOP" and "unsubscribe from texts" checks still find the STOP guide.
- `server/projections.test.ts`: the desk's record now also leaves out messages to clients.

## Checks

- `npm run lint`, `npx tsc -b` and `npm run format:check`: pass.
- Front-end suite: 154 files, 1,371 tests passed (base 151 and 1,338).
- Server suite: 58 files (one skipped, as before), 445 passed and 2 skipped (base 57 files, 433 passed and 2 skipped).
- `npm run build` was not run here, as the brief's list of checks does not include it; `npx tsc -b` covers the types.

## Decisions

- **Regional managers cannot draft.** They read an `AreaView` of figures and branch visits with no client records at all, so drafting for a region would hand them client counts by location and a way to write to clients they otherwise never see. General managers already cover each location, and the owner sends. If wanted later, it would be a draft for the locations in their region, with the same numbers-only rule.
- **Who may stop.** The owner and managers may stop a message part-way; a general manager may stop a message for their own location only. Stopping only ever sends less.
- **STOP leaves a person out entirely.** The brief says never a client who replied STOP, so they get no copy by email either, though their email consent is unchanged (the existing STOP guide still says texts never change email news).
- **Texts need an agreement that named texts.** The sample studio's consent wording names email only, so the sample shows 0 by text. The sample's wording was not changed, because existing consent tests rely on its version 1.
- **Email news ignores the visit email setting**, which is for visit messages, and the studio's reminder settings, which are for reminders.
- **"Clients of a location"** is a visit there in the last 12 months or one booked there, and a person is counted at the location of their latest visit.
- **The stop link needs a press** and lives in the address fragment, so it never reaches server logs or a Referer header, and a mail scanner opening it changes nothing.
- **Approval waits to know the mode.** For a real studio, "Check and approve" stays unavailable and no mode line shows until the server has said whether email and texts are live, so the screen can never say test mode for a message that would really go.
- **Migration 33**, as assigned.
- **No new dependencies.** `LoadingShapes`, `MoreOptions`, the new `Empty` and `--motion-calm` are not in this base, so the page uses native pieces (below).

## Quality bar

- [x] **Each screen or section has one main job and one primary button.** The page: "Write a message". The panel: "Check and approve" for the owner, then "Approve and send to 12 clients"; "Stop the rest" is secondary until confirmed. The editor: "Save draft". The stop page: "Stop news and offers".
- [x] **Rarely used options are tucked away.** "Put this draft aside" sits behind "More", and drafts put aside behind "Drafts put aside (n)". `MoreOptions` is not in this base, so both are native `<details>` with 44 px summaries; they can move to `MoreOptions` when it merges.
- [x] **No card inside a card; lists use rows and hairlines.** Messages are rows with a hairline between them; the panel's sections are divided by space and hairlines; numbers are rows. The approval check is one tinted section inside the panel, not a card.
- [x] **At most one photograph per view.** Only the empty page and the client's stop page have one (the house tea photograph), large and fading into the words.
- [x] **The empty page opens with a welcome in place of its header**: eyebrow "Inbox", "One message for all your clients.", one line and "Write a message". The base's `Empty` has no photograph, eyebrow or action yet, so this is the same layout built in `news.css`; it can move to the new `Empty` when that merges.
- [ ] **LoadingShapes for loading.** Not in this base. While the server counts, the panel says "Counting the clients it would reach." and the stop page "Opening your link…", never a spinner or a blank. They can move to `LoadingShapes` when it merges.
- [x] **Motion and reduced motion.** `--motion-calm` is not in this base. The notices and the approval check use a 220 ms fade and rise (`news-settle`), and reduced motion removes it.
- [x] **At 390 px** (seen in the browser pass): the welcome stacks the photograph above the words, primary buttons are full width with 44 px targets, rows wrap, long subjects wrap rather than scroll. The panel and editor are the library's `Modal`.
- [x] **Warm, plain words**, British English, no exclamation marks or dashes, and nothing says a message was sent: "Queued in test mode, not sent", "A sample studio, so nothing was queued or sent.", "Copies already with the provider cannot be called back."
- [x] **Design tokens and library components** (`Button`, `Modal`, `PageHeader`, `SegmentedControl`, `ErrorMessage`, `photos`); no new raw colours (the welcome's fade is a mask, as elsewhere); no left-edge stripes. Lint, types, tests and format pass.
- [x] **Before and after pictures** at 1440 and 390 px: [Stage 4, before and after](https://claude.ai/artifact/2aV9ypAGeL5gAN5YBnnphg).

## Limits and notes

- **One-click unsubscribe (RFC 8058)** is not offered: the `List-Unsubscribe` header names the page, but a mail program's own one-click POST would be refused by the server's origin checks. Mail programs show the link; Gmail and Yahoo expect one-click for very large senders, so this matters once a studio sends thousands.
- **Restoring a backup** taken before a message went out loses the stop links issued since, so those links read as expired. Clients can still stop by asking the studio.
- **Clients have no archived flag** in this base. Erasure requests are the only exclusion of that kind.
- **Live delivery** needs Postmark's broadcast stream set up on the studio's account, and the sending domain's unsubscribe settings, before going live. Nothing here sends anything.
- A message is kept to 1,000 characters, 120 for the subject, and a studio to 500 messages.

## Seen in a browser

At 1440 and 390 px, in a new studio with the sample clients and a second location, Islington, signed in as the owner, Gia (general manager at Islington), a manager and reception:

- Inbox shows Messages to clients beside Write a draft. The page lists the sample draft with the sample notice.
- The draft's panel: "Would go to 209 clients: 209 by email, 0 by text.", Marylebone 209 by email, 90 left out who have not agreed, the rule and the texts line. As a text: "283 characters, sent as 2 parts." Check and approve, then approving it: "Approved. A sample studio, so nothing was queued or sent."
- The owner's editor, and Gia's, fixed to Islington's clients with "Nobody would receive this yet." (Islington is new, so no client there has agreed). Reception has no link, and `/inbox/news` returns to the Inbox. `/news/stop#` with a link that does not open: "We couldn't open this link." and the plain answer.
- Found and fixed:
  - The editor's choice circles were drawn far too big. A radio in a list of choices now sits small beside its words, as a tick box does (`management.css`).
  - A new studio's sample message kept the sample's name in its subject. Naming the studio now renames it too (`server/workspace.ts`, tested in `server/news.test.ts`).
- Not seen in a browser, covered by tests: a real client using their stop link, queuing in test mode for a studio that is not a sample, and a live provider.

## Browser steps for the lead

Followed on 10 October 2026, with Islington as the second location; what was seen is under Seen in a browser.

At 1440 px and 390 px, signed up as a new owner with the sample studio:

1. Inbox: "Messages to clients" sits beside "Write a draft". Open it: one row, "Thursday evenings at Atelier House", Draft, with the sample notice.
2. Open the draft: "Would go to 12 clients: 12 by email, 0 by text.", 3 left out who have not agreed, the rule and the texts line. Switch the preview to "As a text": it shows the characters and "sent as 2 parts".
3. Choose "Check and approve": "Send to 12 clients: 12 by email, 0 by text?" with the sample wording. Choose "Approve and send to 12 clients": "Approved. A sample studio, so nothing was queued or sent." The row reads "Sample, nothing sent"; the panel has no "Change it" and "The record" names the approver.
4. Open a client who agreed (Clients): the timeline shows "Message to clients" with the subject and "A sample studio, so nothing was queued or sent."
5. Settings, Who changed what: "Approved a message to clients" with the numbers.
6. "Write a message": choose by email or text, see the live numbers and the text's parts, save, change it, then put it aside under More and find it in "Drafts put aside".
7. Sign in as a manager (invite one): no "Check and approve". As reception: no link, and `/inbox/news` returns to the Inbox. As a general manager of a second location: the editor is fixed to their location.
8. For a real studio in test mode (not a sample, with clients who agreed): approve, then see "Queued in test mode, not sent" and each client's copy in their messages as "Test mode, not sent", with the stop link hidden.
9. Open `/news/stop#` followed by any 43 letters: "We couldn’t open this link." with the plain answer.
10. At 390 px: the empty page (put the sample draft aside) stacks the photograph above the words with a full-width button; the rows and the panel do not scroll sideways.

Screens to capture at 1440 and 390 px: Inbox with the new link; the page with the sample draft; the panel with numbers and both previews; the approval check; the approved message; the empty welcome; the editor; the stop page.
