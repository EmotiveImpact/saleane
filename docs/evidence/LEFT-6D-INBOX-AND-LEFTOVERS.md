# LEFT-6D · The Inbox as one conversation per guest, and three leftovers

Branch `left-s6inbox`, from `left-stage5` at 6d557e4. Built and tested locally. **It has not been seen in a browser yet**: the lead runs the browser pass once the Stage 6 parts are put together (steps at the end). No migration and no new dependency.

## What it does

### 1. One conversation per guest in the Inbox

Online booking always opens a new client record (a typed email proves nothing), so a regular can have several records that share one email. Before, the Inbox listed her once per record and split her messages between them.

- **Grouped in the domain, where the conversations are built** (`conversations` in `src/domain/inbox.ts`). Records with the same email, ignoring case and spaces, are one guest, the rule `guestKey` already uses in `cancelledTimes.ts` (repeated in `inbox.ts`, which `cancelledTimes.ts` loads). A conversation's key is now `guest:<email>`; it carries `clientIds` (every record of the guest) and `clientId` (the record an answer goes to). Everything from every record sits in one thread in time order: the guest's replies, the studio's messages and drafts, answers on social apps and what went out on its own. Unread replies and drafts are counted across the records, and opening the conversation marks every one of her replies read.
- **Where an answer goes.** To the record she last wrote under, so a text goes back to the number she used. With no reply from her, to the record of her latest visit (or the newest record), as `senderClient` already matches a text. The header shows that record's email and number, and under it: "Booked under 2 client records with this email, so their messages are together here. Answers go to the details above." The reply box, Write to, Note a reply and Profile all use that record.
- **What never joins**: records with different emails (a family sharing a phone), a record with no email (none can exist today; if one ever did, it joins nobody), and anything from another studio (the grouping reads one studio record only). A reply whose record has gone keeps a conversation of its own (`client:<id>`). Unmatched senders keep `from:<address>`.
- **On the server**, the outbox list (`GET /api/workspaces/:id/outbox`) takes `guest=1` with `clientId`, and then lists the sent messages of every record of that guest in that studio (`guestOf` on the studio's own record, and the SQL still filtered by `organisation_id`). The Inbox asks for it when a conversation opens; a client's own page still reads its own record only. Practitioners are still refused the outbox (403), and practitioners and regional managers still have no Inbox: their views carry no replies.
- **An email from an address on several records of one guest** now goes to her latest record, as a text from a number on several records already did in Stage 5. Before, it waited unmatched, so the same guest showed twice even after grouping.
- **Nothing about either record is changed, merged or removed.**
- **Sample studio**: in the full sample (with its regulars), one regular booked her next visit online, which opened a second record with the same email; her online visit belongs to that record. She thanked the studio by email from her first record after her last visit (read) and wrote from the new one last night (unread), so the Inbox shows her once with a new reply. The quieter sample the tests use is unchanged.
- **Help**: "One conversation for each guest" (Messages and AI), for everyone at the desk, found by "same guest two records in the inbox", "client booked online twice duplicate conversation" or "two records same email"; a practitioner does not find it.

### 2. The reply box leaves the conversation the room

On a desk-sized screen the reply box stayed open at the foot of the thread at full size (heading, saved replies, three lines, a note and the button), covering a good part of the conversation.

- It now stays **one short line until someone starts to reply**: "Reply to Ellie" and "Reply by" above one line of words with **Save as draft** beside it. Saved replies and the note about drafts appear once the box is in use (any focus inside it), and the words then grow with what is written, from three lines up to 280px, then scroll inside the box. Leaving it with nothing written folds it back; leaving it with words keeps them in view, as does an error.
- Choosing a saved reply keeps the focus in the words (the chips do not take focus on a click), so the box never folds under the pointer.
- It stays sticky at the foot of a long thread on a desk-sized screen (821px and wider, at least 640px tall), as before, so it is in reach while the thread scrolls, but now about 120px tall instead of about 250px. On a phone it follows the thread, as before, with the words and the button on one line until used, and every target at least 44px.
- The growing uses `--motion-calm` and `--ease-calm` when they arrive (PR #83), and `--motion-quick` until then; reduced motion removes it.

### 3. Business's empty chart no longer shows "£0.01"

Cause: `src/pages/Business.tsx` scaled the chart to `Math.max(...takings, 1)`, a minimum of one penny, so with no takings the axis read £0.01 at the top and, from `Math.round(0.5)`, £0.01 in the middle too. With takings, the top was the highest day to the penny (for example £85.50).

- New `chartScale` in `src/domain/chartScale.ts`: the top of the axis is a round figure in whole pounds or dollars at or above the highest bar (2, 4, 6, 8 or 10 times a power of ten, from £2), and the middle is exactly half of it, so neither shows pence. With no takings the axis shows only £0 (or $0) and every bar is flat. `barHeight` draws each bar as a share of that top, never past it.
- GBP and USD are the only currencies a studio can have, and both have 100 minor units; the test covers both.

### 4. The last internal words

- **Who changed what**: "Ask Saleane" is now "Ask SALEANE" (four entries), and "no appointment emails" and "no appointment texts" are "no visit emails" and "no visit texts".
- **Accounts**: the table's column, its account code label and its note say "Treatments", not "Services". The day-by-day spreadsheet's column is "Treatments before tax" and the accounting batch's line "Treatments", with "Tax on treatments and products". Code names (`servicesMinor`, `codes.services`) are unchanged.
- **Errors a person could read**: "Refresh the workspace before saving." is "Refresh the page before saving."; "Workspace was not found." (twice) is "That studio was not found."; "This request must come from your SALEANE workspace." is "This request must come from SALEANE in your browser."; "This person already belongs to the workspace." is "This person is already in the studio team."; "Choose a new workspace or use an invitation." is "Choose a new studio or use an invitation."; "The local service is busy." is "SALEANE is busy."; the guest booking page's "This service changed during the reservation." is "This treatment changed while you were booking."; and the browser demo's "Demo revision limit reached." says what to do.
- **The studio record's own checks**, which reach a person as a refusal when something does not add up: "Foreign workspace record" (and special, reminder) is "A record from another studio", "Workspace region mismatch" is "This studio record is for another region", and the five that said "appointment" or "service" now say visit or treatment.
- **Elsewhere**: the plan and billing panel and the pricing page say "Ask SALEANE" (five places); the sidebar's screen-reader name is "Studio navigation"; the sample's client notes and one sample form question say "visit"; two descriptions Ask SALEANE reads say "treatment".
- **Kept on purpose**: "appointment link" on Share your booking page (Google's own name for that field), "appointment" in Help's search words (a person may type it), the backup tool's "tenant links" (read only by whoever runs it), and the value `'appointment'` named in Ask SALEANE's instructions. Code identifiers, API paths, header names (`Saleane-Signature`) and database columns are unchanged.
- **The guard**: `src/domain/screenWords.test.ts` reads every screen and server file and checks the text in quotes and between tags (not code names, paths or comments) for "Saleane" in any case but capitals, "workspace", "tenant", "appointment" and a label of just "Services". It lists every line that breaks a rule, with a short list of words kept on purpose, each with its reason, and checks itself on sample lines in both directions.

## Who can see what

| Role             | Inbox                                                     | A guest's sent messages across records             |
| ---------------- | --------------------------------------------------------- | -------------------------------------------------- |
| Owner, manager   | One conversation per guest                                | Yes, in their own studio only                      |
| General manager  | As before (the whole client list, as a manager-like role) | Yes, as before for the outbox                      |
| Reception        | One conversation per guest; drafts only, as before        | Yes                                                |
| Practitioner     | No Inbox (their own day page only)                        | No: the outbox refuses them (403), unchanged       |
| Regional manager | No Inbox (their area page only)                           | No: `orgFor` refuses them on this route, unchanged |

## Tests

- `src/domain/inboxGuest.test.ts` (8): two records of one guest as one conversation, in time order, with unread and drafts counted across them, the key the same from either record, and **the answer going to the record she last wrote under**; still so when the studio wrote later; the record of her latest visit when she has not written; **an email from an address on two records kept with her**; **records with different emails never joined**; records without an email never joined; a reply whose record has gone keeps its own conversation; the full sample shows its regular once, in both regions, each record with visits, and the test sample has no second records.
- `server/inboxGuest.test.ts` (3): the outbox lists every record of the guest with `guest=1` and one record without it, and never a record with another email; **never another studio**, even for a guest with the same email, nor another studio's record id, nor another studio's outbox; an unknown `guest` value is refused.
- `src/pages/inboxGuest.test.tsx` (1, the whole app): the guest is listed once with "2 new replies"; her thread holds both records' messages in order with the note; the header shows the number she last wrote from; a reply is saved as a text draft to that record; opening it read both replies.
- `src/components/inboxReply.test.tsx` (1 new): one line until used; opens on focus; a saved reply keeps it open and the focus in the words; leaving with words keeps it open, leaving empty folds it; the missing-words error opens it.
- `src/domain/chartScale.test.ts` (5): only zero with no takings, in GBP and USD; round tops that halve to whole pounds; **never a part of a pound or dollar** across amounts from 1p to £50,000, never more than two and a half times the highest bar; bar heights within the axis; values that are not numbers left out.
- `src/domain/screenWords.test.ts` (2): the scanner finds each word it looks for and leaves code names alone; no screen or server reply uses them.
- `src/domain/help.test.ts`: three searches find the new guide; a practitioner does not.
- Updated for the new words: `server/holds.test.ts` (the guest booking page), `domain.test.ts`, `otherTill.test.ts`, `patchTests.test.ts`, `tillCount.test.ts` (the record's own checks), `PlanBilling.test.tsx`, `Pricing.test.tsx` (Ask SALEANE), `visitPanel.test.tsx` (the sample note).

## Checks

From the worktree root:

- `npx tsc -b`: passes.
- `npm run lint`: passes.
- `npm run format:check`: passes.
- Front-end suite (`DB_PATH` on a fresh file under `.claude-tmp/`): 192 files, 1,662 tests passed (4 files and 17 tests new; the base has 188 and 1,645).
- Server suite, on a fresh database: 68 files passed and 1 skipped, 538 tests passed and 2 skipped (1 file and 3 tests new; the base has 535 passed). `server/holds.test.ts` now looks for the guest's new words, "changed while you were booking".
- `npm run build`: passes.

## Decisions

- **Grouped where the conversations are built**, in the domain, which the screen and the server both use, and on the server only for the outbox read, which is the one thing the screen cannot group itself. No new command, no change to how replies are stored, and no migration.
- **The answer goes to the record she last wrote under**, not always to the record of her latest visit, because that is the number or address she is using now. A note the team wrote (by phone or in person) does not count as her writing.
- **An email from an address on several records of one guest now matches**, to her latest record. Before, it stayed unmatched, which is why a guest could appear twice even with grouping. It joins no records and changes neither.
- **The conversation key is the guest's email** (`guest:<email>`), kept in memory only, so the selection stays on her when a new reply moves where answers go.
- **The reply box opens on any focus inside it**, not only in the words, so moving to "Reply by" with the keyboard shows the saved replies too.
- **The chart's axis uses steps of 2, 4, 6, 8 and 10**, so the middle line is always whole pounds; the familiar 1, 2, 5 steps would give £0.50 or £2.50 in the middle.
- **The accounting spreadsheet and batch say "Treatments"** too, as an accountant reads them; account codes are unchanged, so the codes the accountant set still match.

## Not done, and why

- **No page-level test of the empty Business chart.** Emptying the sample studio's takings means taking apart linked visits, receipts and payments, which the record's own checks refuse; the rule lives in `chartScale` and is tested there, and the page only draws what it returns.
- **The sentence-level search for "service" meaning a treatment** is done by hand, not in the guard: "card service" and "message service" are correct, so a rule would mostly catch them. Those found were fixed.

## Quality bar

`LoadingShapes`, `MoreOptions` and `--motion-calm` are not in `src/design` on this base (PR #83), so nothing imports them; the reply box's growing falls back to `--motion-quick`.

- [x] One main job and one primary button: the Inbox keeps Write a draft; an open conversation's one primary is Save as draft in the reply box.
- [x] Rarely used options tucked away: the saved replies and the note about drafts wait until the reply box is in use.
- [x] No card inside a card: the note about several records is one line of text under the guest's details, not a box.
- [x] Photographs: none added; the Inbox is a working surface.
- [x] Empty pages: unchanged. The Business chart with no takings shows only £0 on its axis rather than invented figures.
- [x] Loading: unchanged (no new loading).
- [x] Motion: the reply box's growth uses the calm tokens when present and is removed with reduced motion.
- [ ] At 390px: written for it (the words and button on one line, targets at least 44px, nothing wider than the screen) but not yet seen in a browser.
- [x] Words: plain British English, no dashes, visit and treatment throughout; the guard keeps the internal words out.
- [x] Built from `src/design` and existing CSS; no new colours, no left-edge stripes; checks pass.
- [ ] Before and after pictures: for the lead's browser pass.

## For the browser pass

At 1440, 1080 and 390px, in the sample studio with its regulars:

1. **Inbox**: the regular who booked online again (in the UK and US samples, the first regular with a later online visit) is listed once with "New reply". Open her: two emails, the older from her first record, the newer from the record made online, in order, with "Booked under 2 client records with this email" under her details. Reply: the draft goes to the record shown.
2. **Reply box**: on opening a conversation it is one line beside Save as draft, and the thread has the room. Click into it: saved replies and the note appear; type several lines and it grows, then scrolls inside at about 280px. Click away with nothing written: it folds back. At 390px, the words and the button sit on one line until used.
3. **Business**: in a new studio with no takings (or a period with none), the chart's axis reads only £0; in the sample, the top and middle figures are round whole pounds (or dollars in the US sample).
4. **Settings, Who changed what**: an Ask SALEANE change reads "Ask SALEANE"; a client's message wish reads "no visit emails".
5. **Business, Accounts**: the table's second column is "Treatments".
