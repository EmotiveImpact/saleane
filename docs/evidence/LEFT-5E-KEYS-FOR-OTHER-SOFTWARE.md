# LEFT-5E · Keys for other software: visits, clients and a chain's till sales sent in

Built 10 October 2026 in a worktree on branch `left-s5keys`, from left-stage5 at `957c445`, then merged with left-stage5 at `d402850` (PR #92 and Stage 5A) and `25f2b0b` (Stage 5C and 5D). Everything below was checked with unit, component and server tests. **It has not been seen in a browser yet**; the steps for that are at the end.

## What it does

- **Three new scopes for an access key.** In Settings, Connected software, Access keys, the owner now ticks what a key may read under "It may read", and, behind "It may also change things" (closed until opened), what it may change:
  - **Add and change visits** (`appointments:write`): "Book, move and cancel visits, with the same checks as the desk: hours, rooms, patch tests and the booked price. Guests get the studio’s usual messages."
  - **Add and change clients** (`clients:write`): "Add clients and change their details. Email news is only ever recorded when the software says who agreed, when and how."
  - **Send in till sales** (`sales:write`): "Sales and refunds from another till, recorded as money taken outside SALEANE. They count in takings and Money, and products sold come off the shelf."
  - Each scope's sentence is the checkbox's accessible description. The key list says what a key does in one line ("May read visits, and add and change visits") and, for a key that can change things, "Its changes show in Who changed what under its name."
  - A key made before this keeps exactly the scopes it had: nothing is added to old keys.
- **A one-location key** may add and change visits and send in till sales at its own location only. It is never offered clients (they belong to the whole studio). A visit elsewhere is answered as not found, and a change that would touch another location is refused with `wrong_location`, using the same `branchRefusal` and `branchChangeRefusal` as a general manager.
- **Writes under `/api/v1`**, JSON in and out, documented with examples in `docs/CONNECTIONS.md` ("Sending things into SALEANE"):
  - `POST /api/v1/appointments` books, `PATCH /api/v1/appointments/{id}` moves, `POST /api/v1/appointments/{id}/cancel` cancels;
  - `POST /api/v1/clients` adds, `PATCH /api/v1/clients/{id}` changes;
  - `POST /api/v1/till-sales` records a sale or a refund from another till.
  - Refusals carry `{ "error", "code" }`, and a body that is not valid also carries `fields`. The full table of codes is in `docs/CONNECTIONS.md`.
- **Idempotency.** Every write needs an `Idempotency-Key` header (400 `idempotency_key_missing` otherwise). The first successful answer is kept for that key, with a hash of the method, the address and the body, in the same transaction as the change. The same key and body gets that answer again with `Idempotent-Replayed: true` and changes nothing; the same key with a different body is refused with 422 `idempotency_key_reused`. A refusal keeps nothing, so it can be put right and sent again. Kept answers are cleared after 30 days.
- **The same limits and checks as reads**: the bearer key, its scopes, its last day and location, and 120 requests a minute for reads and writes together. Writes are refused with 402 while the studio is read only or locked for an unpaid SALEANE bill, and a sample studio never takes anything in. Writes are answered before `app.ts`'s 405 line and its Origin and JSON gate, which still refuse everything else.
- **Visits go through the desk's commands.**
  - Booking: `chooseStaff(withHolds)` (the studio's and the professional's hours, who does the treatment, a free room or chair, and guests holding a time online), then the desk's `book` with the treatment's price at that location kept as the booked price. The visit's `source` is `software`, it names the key, and its history says "Booked by {key} through its access key."
  - Moving: `rescheduleResource` over `withHolds`, then `reschedule`; the guest's own visit links follow it, as at the desk.
  - Cancelling: the desk's `cancel` and its rules (the deposit's history kept for review, the freed time offered to the waitlist).
  - Messages: guests get exactly the messages a desk booking, move or cancellation would give them, through the outbox as usual. Nothing else is sent.
  - Patch tests: with the studio's rule on, the client needs a clear test covering the visit's time (a new client never has one); a client whose last test was a reaction is never booked for that treatment through a key, rule or not. Both answer `patch_test_needed`.
- **Clients use the existing client commands.** Duplicates are matched as `import-clients` matches them (same name and email, ignoring capitals) and refused with 409 `duplicate_client` and the `clientId`. Email news is never assumed: it is recorded only when the software sends `agreed`, `at` (not later than now), `how` and, to agree, the `wordingVersion` of the studio's current wording (read from `GET /api/v1/studio`). The client's permission history records it as coming from that software, with when and how. A client with an erasure request gets nothing more (409 `erasure_requested`).
- **Sales from a chain's own tills.**
  - Lines are a treatment (by `serviceId`), a product (by `productId`, `barcode` or an `sku` only one product has) or free text kept by name; each with quantity, total with tax included, the tax inside it and its rate. Payments are `cash`, `card` or `other` and must add up. Also the other till's receipt number, an optional team member and the time it happened (up to 5 minutes ahead and 92 days back).
  - It counts in takings and Money for that location and the studio's own day. In Money it is a receipt row "Sold on {key name}" with "Card on another till · T-1", opening "Sale from another till", which says SALEANE recorded it when that till sent it in and took no payment itself. Money in and out shows "Sale on another till", the sales export has the column "Sent in from another till", the tax summary marks its lines, and Business shows "Sold on your other tills" apart from treatment takings.
  - It is never recorded as a SALEANE payment, never opens the cash drawer and is not part of the till count. The answer says `tookPayment: false`.
  - A receipt number is taken once per location and kind (409 `duplicate_receipt` with the `saleId`).
  - Known products come off the shelf at that location. A sale that already happened is never refused for stock: what is there comes off and `shelfShort` says what to count; the dialog says "not on SALEANE’s count. Count the shelf when you can."
- **Who changed what.** Each change a key makes is saved with the key as the actor (`key:{id}`) and shows as "{key name}, through its access key". The owner can pick the key under Who to see only its changes, and this stays true after the key is revoked. Till sales are named by their till and receipt.
- **Outgoing connections still fire** for a key's own change, and the event carries `changedBy: { type: "access_key", accessKey: { id, prefix, name } }` with a `Saleane-Access-Key: {prefix}` header, so software that sends things in and hears events can ignore its own echo. Documented in `docs/CONNECTIONS.md`.
- **Help**: "Let other software read or send things in" and "What other software can send in" (Settings and data, owner, offered first on Settings, Connections) and "Sales from your other tills" (Money, for owners, managers and general managers, on Money and Business).

## Who can do what

| Who                  | Make or revoke a key        | What it can send in                                           | Sees till sales                                                    | Who changed what           |
| -------------------- | --------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------ | -------------------------- |
| Owner                | Yes, with the scopes ticked | n/a                                                           | Money and Business                                                 | Every change, key by key   |
| Manager              | No                          | n/a                                                           | Money and Business                                                 | No (owner only, as before) |
| General manager      | No                          | n/a                                                           | Money and Business, as they already see counter sales              | No                         |
| Reception            | No                          | n/a                                                           | In the studio record, as counter sales are; no Money page or guide | No                         |
| Practitioner         | No                          | n/a                                                           | No: `PractitionerView` has none                                    | No                         |
| Regional manager     | No                          | n/a                                                           | Only inside their area's takings figures                           | No                         |
| Whole-studio key     | n/a                         | Visits, clients and till sales at any location, as ticked     | n/a                                                                | Listed under its name      |
| One-location key     | n/a                         | Visits and till sales at its own location only; never clients | n/a                                                                | Listed under its name      |
| Key made before this | n/a                         | Nothing: it keeps the reading scopes it had                   | n/a                                                                | n/a                        |

The two new commands (`other-till-sale`, `other-till-refund`) can never be dispatched by a person: `can()` refuses them for every role, and the only way in is a key with `sales:write`.

## Server

- **Migration 35**: the `api_key_writes` table (key, idempotency key, organisation, request hash, method, path, status, the kept answer as valid JSON, record id, when; primary key on key and idempotency key; `STRICT`) and an index by age. **34 is left unused**, as it belongs to another Stage 5 part.
  - The runner applies `steps.slice(applied.length)` and checks the applied versions against the known ones in order, so a gap works on a new database. Three places assumed consecutive numbers and were made gap tolerant: `server/backup.ts` (compares with the list of versions), `server/database.test.ts` (the next version is `SCHEMA_VERSION + 1`, and versions are checked sorted and unique) and `server/app.test.ts` (counts the migrations).
  - **A database made on this branch** (33, then 35) will refuse to open once 34 merges before 35, because the runner checks the order. Make a new local database after the merge.
- `server/partnerWrites.ts`: the write gate (content type, key and rate limit, Idempotency-Key, body, hash, then one transaction that authenticates, looks up the kept answer, makes the change and keeps the answer). Each change runs `dispatch` as the key, the location checks, the gift card hold check, and `persist` as `key:{id}`. The 405 is kept to the addresses that exist; anything else is 404.
- `server/partnerShared.ts`: the key row, refusals with codes, and the visit as answered (now with `locationId` and `priceMinor`).
- `server/partnerApi.ts`: scopes from `src/domain/accessKeys.ts`; a write is also refused while read only; `GET /api/v1/studio` adds the key and the email news wording.
- `server/app.ts`: `partners.write` after Google's partner calls and before the AI booking endpoint and the 405 line; it wakes the outbox and connections after a change. The 405 now says "Use GET to read, POST to add or PATCH to change."
- `server/connections.ts` and `src/domain/connectionEvents.ts`: `changedBy` and the `Saleane-Access-Key` header.
- `server/routes/changes.ts` and `server/routes/workspace.ts`: the key's name for its changes, and keys in the list of who.
- `server/http.ts`: `HttpError` carries an optional `code`, and the app's catch adds it to the answer.
- Domain: `src/domain/otherTill.ts` and `otherTillSchema.ts` (new), with `model.ts`, `commands.ts`, `commandSchema.ts`, `operations.ts`, `branch.ts`, `privacy.ts`, `pay.ts`, `accounts.ts`, `locations.ts`, `selectors.ts`, `retail.ts`, `consent.ts`, `consentSchema.ts` and `changeRecord.ts`.

## Tests

- `server/partnerWrites.test.ts` (10): the new scopes offered, old keys unchanged and location keys narrow; **a booking through the desk's checks**, with the usual messages and the booked price, a taken time refused; **idempotency**: a replay with the header and no second visit, a reused key with another body refused, a refusal keeping nothing; **moving and cancelling** under the desk's rules; **patch tests**, a client who reacted never booked; **clients**: added and changed, duplicates refused with their id, email news only with who, when and how and from that software, erasure respected; **a one-location key** kept to its location; **read only, locked, sample and old keys** refused; **till sales and refunds**: takings, Money, stock, commission, no payment, a receipt only once; **Who changed what** under the key's name, and its events marked with `changedBy` and the header.
- `src/domain/otherTill.test.ts` (11): only through a key and never into a sample; linking by id, barcode or SKU, the rest by name; every amount, the time, the team member and one receipt checked; never refused for stock, with the shelf short noted; refunds from the same location and never more than taken; checked whenever the studio record is read; takings, Money and the business figures for its location and day; a renter's takings kept apart and commission to the team member named; words in the change record, the export and the branch rules; scope words and location scopes; email news only with who, when and how.
- `src/components/AccessKeys.test.tsx` (3): each scope explained, the changing ones tucked away and what was ticked sent; a one-location key offered only its own; an old key reading only, and saying so.
- `src/components/OtherTillSales.test.tsx` (1): a sale names its till, never claims SALEANE took the money, and shows the shelf note and the refund.
- `src/domain/help.test.ts`: searches for "api key", "let my booking tool add visits", "email news consent from other software", "sync clients without duplicates", "epos sales from our shop till" find the right guides; managers and reception do not get the owner's; the two key guides come first on Settings, Connections.
- `server/partnerApi.test.ts`: the old "POST is refused" check now expects 405 for DELETE and 403 `forbidden_scope` for a POST from a key without the scope.

## Checks

All from the worktree root, after the last merge (`25f2b0b`):

- `npx tsc -b`: pass.
- `npx eslint . --ignore-pattern '.claude/**' --max-warnings 0`: pass.
- `git ls-files -z | xargs -0 npx prettier --check --ignore-unknown`: pass.
- Front-end suite: 184 files, 1,610 tests passed.
- Server suite, with a new database: 66 files passed and 1 skipped, 524 tests passed and 2 skipped.
- `npm run build`: pass.

## Decisions

- **Desk rules, not the guest's.** A key acts for the studio, so it books and moves as the desk and Book with Google do (`chooseStaff(withHolds)`, `rescheduleResource`, the desk's commands). It does not use the guest's `holdTime`, `bookHeld` or `moveOnline` from Stage 5C and 5D: those need a held time, keep the guest's online cutoff and days, send a guest link and, for the first two, open their own transaction, while the kept idempotent answer must be saved in the same transaction as the visit. The same availability functions are used, so there is no second way of working out a free time.
- **Patch tests for software** follow the online rule, because software cannot see the desk's warnings, and a reaction always refuses.
- **Commission on till sales** is per line at the named team member's rates for that treatment or product, otherwise their usual rate or steps; none on days they rent a chair or room, when the takings are theirs. Refunds come off their commission unless the pay rules say the studio absorbs money given back.
- **Refunds and voids**: a refund names the original receipt (`refundOf`) at the same location, never gives back more than was taken and puts back no more stock than came off. A void is a refund of the whole receipt; there is no separate void.
- **Not refused for stock**: the sale already happened on the other till, so SALEANE records it and says what to count.
- **Echo marking** goes in the payload and a header rather than suppressing the event, so other connected software still hears every change.
- **Migration 35**, as assigned, with 34 left for its own part.

## Quality bar

- [x] **One primary button per screen.** The key form's primary is "Make the key"; the till sale dialog has none (it only reads).
- [x] **Rarely used options tucked away.** The changing scopes sit behind "It may also change things", closed until opened.
- [x] **No card inside a card; no left-edge stripe.** Till sales are receipt rows in Money's existing list; the scopes are rows in a fieldset.
- [x] **Design tokens only** in the new `management.css` rules; library `Button` and `Modal`.
- [x] **Honest words.** Nothing says SALEANE took a payment for a till sale ("took no payment itself", `tookPayment: false`), and guests' messages go through the outbox as for the desk, never called sent.
- [x] **Plain British English**, "visit", "treatment" and "SALEANE", no exclamation marks or em dashes.
- [ ] **At 390 px**: no sideways scroll, 44 px buttons, stacked fields. Built with the existing form and list styles, which do this elsewhere, but **not seen in a browser yet**.
- [ ] **Before and after pictures** at 1440 and 390 px: not taken.

## Limits and notes

- **Not seen in a browser.** Every journey is covered by tests only.
- **Migration gap**: see Server. A local database made on this branch must be made again once 34 merges.
- **Till sales live in the studio record**, up to 100,000 a studio. A chain sending many thousands a day would want a table of their own.
- **No outgoing event type for till sales** yet; they show in Who changed what and Money.
- **Tips, gift cards and plans** cannot be sent in from another till; they are sold in SALEANE.
- **A general manager** sees every location's till sales in the studio record, as they already see every location's counter sales; `branchView` was not changed.
- Everything runs locally: no card payment, message or outside service is involved in a write.

## Browser steps for the lead

Not yet followed. With the one server on 127.0.0.1:5173 and a new database, signed in as the owner of a studio that is not a sample (keys cannot be made in a sample), with a second location:

1. Settings, Connected software, Access keys: the new intro line. "Make an access key", name it "Shop till". See "It may read" and, closed, "It may also change things". Open it: three choices, each with its sentence. Tick "Send in till sales" and "Add and change visits", make the key and copy it. The list says what it may do, reads first ("May read visits, and add and change visits; send in till sales" when "Read visits" is ticked too), and "Its changes show in Who changed what under its name."
2. Choose "Islington only" for a second key: the location line, no client choices, "Send in till sales" still offered.
3. Find a treatment and a product: `curl -s -H "Authorization: Bearer sal_…" http://127.0.0.1:5173/api/v1/services`.
4. Book a visit: `curl -s -X POST http://127.0.0.1:5173/api/v1/appointments -H "Authorization: Bearer sal_…" -H "Content-Type: application/json" -H "Idempotency-Key: try-1" -d '{"serviceId":"…","date":"…","start":"10:00","client":{"name":"Ava Stone","email":"ava@example.invalid","phone":"+44 7700 900124"}}'`. Send it again: the same answer with `Idempotent-Replayed: true`. Change the start and send it with the same key: 422 `idempotency_key_reused`. The visit is on the Calendar, and its history says "Booked by Shop till through its access key."
5. Move it with `PATCH /api/v1/appointments/{id}` and `{"start":"11:00"}`, then cancel it with `POST …/cancel`, each with a new Idempotency-Key. Inbox shows whatever messages the desk would have queued for the same booking, move and cancellation, in test mode and not sent, and nothing more.
6. Send a till sale with the example from `docs/CONNECTIONS.md` (your location, product and treatment ids, today's time). Money: a receipt row "Sold on Shop till" with "Card on another till · T-1001". Open it: "Sale from another till", the note that SALEANE took no payment, and the shelf line if the count was short. Money in and out and the tax summary mark it from another till; the product's shelf count drops. Business: "Sold on your other tills".
7. Send the same receipt again with a new Idempotency-Key: 409 `duplicate_receipt`. Send a refund of one line with `"kind":"refund","refundOf":"T-1001"`: it shows under Refund records as "Given back on Shop till".
8. Settings, Who changed what: each change under "Shop till, through its access key"; pick the key under Who.
9. Help: search "api key" on Settings, Connections, and "sales from another till" on Money.
10. At 390 px: the key form, its opened changes and the till sale dialog stack and do not scroll sideways, with 44 px buttons.

Screens to capture before and after at 1440 and 390 px: the Access keys panel with a key listed; the key form with "It may also change things" opened; Money with a till sale row; the "Sale from another till" dialog; Refund records with a till refund; Business with "Sold on your other tills"; Who changed what filtered to the key.
