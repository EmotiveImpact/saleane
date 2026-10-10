# LEFT-6C · Privacy approvals: deciding about records at the end of their keeping period

Branch `left-s6privacy`, from `left-stage5` at 6d557e4. Built and tested locally. **It has not been seen in a browser yet**: the lead runs the browser pass after merging (steps at the end). No migration: the decisions live in the studio record (`operations.retention`), as pay rates and rota changes do.

## What it does

- **Settings, Data & privacy** now opens with **"Waiting for your decision"**: the records that have reached the end of their keeping period (the register decided on 7 October 2026), grouped by kind with how many and why each is due, for example "Winifred Ashby. Last visit 12 March 2024. Due since 12 March 2026." Groups show five rows and "See all" beyond that. With nothing due the panel says "Nothing is waiting" in one line.
- **Kinds worked out from the record** (`src/domain/retentionDue.ts`), on the studio's own day:
  - Client details: 2 years after the last day the studio had business with them (any visit booked, kept or not and including one ahead, a purchase, a message from them, or the day they joined), across every record with the same email, since online booking can open a fresh record for the same guest. Never due while they have an active package or membership, or money carried over from a previous system is open.
  - Private feedback: 2 years after it was given.
  - Unsent messages (drafts, queued but never approved, held back): 90 days after they were written. A message approved for sending is never due, since it may have gone out.
  - Waitlist requests: 90 days after the last day asked for.
  - A date that does not exist moves to the end of its month: 29 February 2024 plus two years is 28 February 2026.
- **Deciding**: "Decide" beside a record, or "Decide for all" for a group, opens one dialog with two choices, **Keep longer** (chosen first, as the safe default) or **Approve deletion**.
  - Keep longer: a number of years (the default) or months, up to 10 years or 120 months, and a reason. The button says the date, "Keep until 6 October 2027". The record leaves the list and comes back on that date, marked "Kept until ...". A fold, "Kept longer (n)", lists what is kept, until when and why.
  - Approve deletion: says in plain words what is deleted and what stays, then asks for a tick, "I understand this is final. Deleted details cannot be brought back.", before "Delete for good".
- **What deleting a client means**: the record stays as **Former client**, so its receipts and visits keep their links. Their name, email (replaced by a unique address under the reserved `.invalid` domain that can never receive mail and matches nobody), phone, Good to remember, birthday, postcode area, relationship notes, client connections (and their name on the other person's connection entry), unsent messages, replies, answers on social apps, missed calls, waitlist requests and private feedback go: exactly the erasure review's "could be removed" list. Any approved marketing still queued is held back, and the existing consent rule writes a withdrawal record. Receipts, payments, deposits, refunds, gift cards (the buyer's name becomes Former client), packages, patch tests, forms, consultations, consent history, messages approved for sending and booked visit terms stay. The dialog says how long the money stays: "until at least 16 May 2030" in the UK, a year later in the US (6 and 7 years after the latest money record). **This step never deletes a money record.**
- A former client no longer appears in Clients, client search, the client picker, "Introduced by", Ready to return or Drifting away. Anyone past their keeping period (waiting for a decision) is also left out of Ready to return, Drifting away and the client page's "invite back" suggestion, since the studio no longer has a reason to contact them.
- **Who changed what** records "Approved deleting records at the end of their keeping period" or "Kept records past the end of their keeping period", with the kind ("client details"), how many and, for keeping, "kept until". Never names, deleted record ids or the typed reason. The same decisions appear in the privacy record on the same page ("Deletion approved · 2 clients' details · Ada Owner · time").
- **Everyone else** who opens Data & privacy reads only how many records are waiting for an owner or manager.
- **Help**: "Decide about records at the end of their keeping period" (Settings and data), for owners and managers; the client privacy guide and the erasure review no longer say SALEANE never deletes.

## Who can do what

| Role             | See what is waiting          | Keep longer | Approve deletion |
| ---------------- | ---------------------------- | ----------- | ---------------- |
| Owner            | Yes                          | Yes         | Yes              |
| Manager          | Yes                          | Yes         | Yes              |
| Reception        | How many only                | No (403)    | No (403)         |
| General manager  | How many only                | No (403)    | No (403)         |
| Practitioner     | No (their own day page only) | No (403)    | No (403)         |
| Regional manager | No (their area page only)    | No (403)    | No (403)         |

`can(role, 'retention')` returns `canApproveDeletion(role)` from the register (`DELETION_APPROVERS`), so the register is the one place that says who decides. The command route checks it before anything runs, and `practitionerRefusal`, `areaRefusal` and `branchRefusal` refuse both commands on their own as well (tested).

## Server and record

- Two commands, `retention-delete` and `retention-keep` (`src/domain/retentionSchema.ts`), each naming a kind and up to 500 record ids. Both are all or nothing: the record's own check works out what is due on the studio's day and refuses the whole decision if any named record is not due ("Some of these records are not due for a decision.") or already gone ("Some of these records have already been deleted."). So nothing is deleted twice, early, or without a decision; a repeat with the same request key gets the first answer.
- `operations.retention` keeps `kept` (kind, record id, until, amount, unit, reason, who, when) and `decisions` (who, when, choice, kind, how many, until), bounded. A keep is dropped once its record is gone.
- `server/routes/workspace.ts`: a client with a card still saved cannot be deleted until the card is removed from their page (409), since the card is kept with the payment provider. Deleting a client turns off their visit links (`guest_links.revoked_at`).
- `src/domain/model.ts`: `erasedAt` on a client.

## Tests

- `src/domain/retentionDue.test.ts` (21): the sample's due records, UK and US, and none in the quieter test sample; the words for why; two years through a leap day (due on 28 February, not the 27th); month ends for due dates and keeping by months (31 January to 28 or 29 February); unsent messages counted from the studio's own day in London (after the clocks change) and New York (New Year's Eve in UTC terms); approved messages never due; waitlist and feedback dates; waiting while a visit is booked ahead, a membership is active, or another record with the same email is recent; roles from the register, and the practitioner, area and branch refusals; **deleting a client keeps every receipt, payment and visit exactly, totals unchanged, no trace of the name, the erasure review's removable list empty, the record still valid**; consent withdrawn on record, the name taken off others' connections and gift cards; money kept until 6 years (UK) and 7 years (US) after the latest; feedback, messages and waitlist requests deleted on their own; **refused twice, refused when not due, refused as a whole group when one is not due**; the decision and Who changed what keep no names or ids; nothing changes without a decision; keeping by years with the reason, coming back on the exact day; by months; more than ten years and no reason refused; a keep dropped when its record goes.
- `server/retention.test.ts` (5): owner and manager decide, the decisions show in Who changed what with the right words and the audit table holds no names, ids or reason; **reception, practitioners, general and regional managers refused with nothing changed and nothing audited**; another studio cannot reach the records (404) and its own decisions stay its own; a repeat with the same key returns the first answer, a new request is refused, and a record not due is refused; a saved card holds a client back (409) and deleting turns off the visit link.
- `src/components/RetentionDecisions.test.tsx` (2, the whole app in the browser demo): the groups and why; keep longer with years chosen, a reason required, "Keep until 6 October 2027", the record leaving the list and the fold; delete asking for the tick, a message deleted, then both clients deleted together with "stay under the name Former client", leaving "Nothing is waiting".
- `src/domain/help.test.ts`: the new guide is found by "delete old client records", "keeping period" and "keep records longer" for a manager, not for reception or practitioners, and is listed on the privacy screen.

## Checks

From the worktree root, on a fresh database under `.claude-tmp/`:

- `npx tsc -b`: passes.
- `npm run lint`: passes.
- `npm run format:check`: passes.
- Front-end suite: 190 files, 1,668 tests passed (base: 188 and 1,645; 2 files and 23 tests new).
- Server suite: 68 files passed and 1 skipped, 540 passed and 2 skipped (base: 535; 1 file and 5 tests new).

## Decisions

- **No migration.** Decisions and keeps live in the studio record, so they travel with backups, exports and the browser demo. Migration 36 is left for another part.
- **Keeping longer counts from the day of the decision**, not from the old due date, so a record decided late is kept for the whole time chosen. It needs a reason; deleting does not, since the end of the period is the reason.
- **"Keep longer" is chosen first** in the dialog, so the quick path is the safe one; deleting needs a second deliberate choice and a tick.
- **One rule for what a client deletion removes**: the erasure review's "could be removed" list, reused rather than written again.
- **Money records are never deleted by this step**, even past 6 or 7 years: once a client is Former client their receipts hold no personal details, and receipts are immutable and feed takings and accounting. The dialog says the earliest date the law would let them go.
- **The kinds**: the four records whose period SALEANE can work out from the studio record. Staff accounts, the audit log, backups, consent evidence and sessions are server or longer-lived records and are not in this list.
- **Clients past their period are not suggested for contact** (Ready to return, Drifting away, the invite-back suggestion), even while kept longer.
- **Sample studios** carry two regulars from 2024 (Winifred Ashby and Gideon Marlowe) with a visit and receipt each, a piece of feedback, a waitlist request and a June draft, only when the sample has its regulars (as the demo and server samples do); the tests' quieter sample is unchanged, so no existing count moved.

## Quality bar

- [x] **One main job and one primary button.** The panel's job is deciding; each row has one quiet "Decide", a group one secondary "Decide for all". The dialog has one primary button, which names what happens ("Keep until 6 October 2027" or "Delete for good"), and a quiet Cancel.
- [x] **Rarely used things tucked away.** Long groups show five rows and "See all"; records kept longer sit in a native `<details>` fold (`MoreOptions` is not in `src/design` on this base).
- [x] **No card inside a card.** Groups are rows under hairlines inside the one panel; the dialog's "what is deleted" and "what stays" are a list with a hairline.
- [x] **No photograph**: a dense working surface.
- [x] **Empty**: a one-line `Empty` inside the panel, without a photograph, as a small gap inside a page that has other sections.
- [x] **No loading**: everything is worked out from the record already on screen.
- [x] **Motion**: the existing dialog's own; nothing new moves.
- [ ] **At 390 px.** Built for it (group button and dialog buttons full width, primary button at the foot, every target at least 44 px, names wrap), but not yet seen in a browser.
- [x] **Words**: British English, "visit", no dashes or exclamation marks; nothing says a message was sent.
- [x] **Built from the library**: `Button`, `Modal`, `ChoiceTiles`, `SegmentedControl`, `Empty`, `ErrorMessage` and existing `ops-*` rows; tokens only, no raw colours, no left-edge stripes.
- [ ] **Before and after pictures**: for the lead's browser pass.

## Limits and notes

- **Not seen in a browser yet.** Everything above is from tests.
- **Acting on an erasure request before the period ends is not built.** Recording a request still deletes nothing; the request shows on the client and in the privacy record.
- **Restoring a backup** taken before a deletion brings those records back; they show as due again and wait for a new decision.
- **Outside the studio record**: the server's sent message log (outbox) keeps what was sent, with its address, as "messages approved for sending stay" says; free text elsewhere (another client's notes, a visit's history) may still mention a former client by name.
- A general manager sees only the count, not the list, since deciding is for the owner and managers.

## Browser steps for the lead

1. Open a sample studio (with its regulars) as the owner: Settings, Data & privacy. "Waiting for your decision" shows Client details (2), Private feedback (1), Unsent messages (1) and Waitlist requests (1), each with why.
2. "Decide" beside Winifred Ashby: Keep longer is chosen, Years is chosen, the button reads "Keep until 6 October 2027". Try it without a reason, then with one. She leaves Client details and appears under "Kept longer (1)".
3. Unsent messages, "Decide": Approve deletion, read the words, try "Delete for good" without the tick, then with it.
4. Client details, "Decide for all": Approve deletion; the dialog says the receipts stay under Former client until a date in 2030 (2031 in a US sample). Delete. Feedback and waitlist groups empty with them.
5. Clients: neither appears. Open a receipt from 2024 on Money or the former client's page by link: "Former client". Settings, Who changed what: the decision with "records: client details", "how many: 2".
6. Sign in as reception or a general manager: Data & privacy says only how many are waiting.
7. Repeat at 390 px.
