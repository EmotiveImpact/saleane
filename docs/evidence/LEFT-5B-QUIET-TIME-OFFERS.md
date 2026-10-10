# LEFT-5B · A lower price for a quiet time

Branch `left-s5offers`, from `left-stage5` at 957c445. Built and tested locally. **It has not been seen in a browser yet**: the lead runs the browser pass once the Stage 5 parts are put together (steps at the end).

## What it does

- **The owner's setting, in Settings, Messages**, in a panel of its own, "A lower price for quiet times", between Messages to guests and Saved replies. Invitations to a quiet time carry: **No lower price** (the default), **A percentage off** (5% to 75%) or **An amount off**. With either, the owner also sets **Never below** (no lower price goes under it; empty means only never below free), **Each lower price stays open for** 12 hours, a day, two days or three days (and never past the time itself), and **Treatments left out** (tucked in a fold). A line under the choices works an example from the menu: "For example, Skin Renewal Facial at £95 would be offered at £76." Everyone else who opens Settings reads it, with "Only the owner sets a lower price. You can read it here." Who changed what keeps each change, before and after: "Changed the lower price for quiet times", with "Lower price for quiet times no lower price became a percentage off" and "Percentage off 20% became 25%".
- **Which invitations carry it.** Both kinds of invitation to one time: those to a time a cancellation freed (written by SALEANE when a visit is cancelled, or by the team on Waitlist), and those to one of Today's open times (Smart insights, Drifting away, "Prepare an invitation"). With the setting off, nothing changes: the V3 gap invitation and the NEXT-11 invitations are word for word as before. With it on, a gap invitation goes as an invitation to that exact time by email, with a private link, through a new command (`offer-invite`), and only to a guest with an email address who agreed to hear from the studio under every record.
- **The price is fixed on the invitation as it is written**: the lower price, the usual price it is below, and when it ends, all kept on the message (`offer`). Changing or turning off the setting never changes an invitation already written. The email says the price, the exact time, that it is for that time only and when it ends: "For that time only, it is £76 instead of the usual £95. The lower price is open until Saturday 10 October at 18:00." Its booking link opens the booking page on that time with a private link to the lower price. Subjects end ", at a lower price".
- **Approval.** In the Inbox each invitation shows its words with the link as "[a private link to book this time at its lower price]" and, beneath, "Quiet-time price: £76 instead of the usual £95, open until Saturday 10 October at 18:00." (with "before tax" where tax is added on top, and "A guest has booked it." once used). Nothing is sent until someone approves it; in test mode it is queued and nothing is sent. An invitation cannot be approved, and is not sent if already approved, once its lower price has ended, the treatment's usual price has changed, or the treatment is no longer offered; the Inbox says which. Cancelled times shows the lower price new invitations would carry, and "Charlotte Hayes: approved 20 minutes ago, no reply yet, at a quiet-time price of £76 instead of £95" for those already written.
- **The private link.** Each invitation's link is made as the email goes and carries a single-use token in the address fragment (`#offer=`), so it never reaches a server log or a Referer header. Only its SHA-256 hash is kept, in a new table (`offer_links`, migration 34), never in the studio record or the outbox. A link is for one invitation, which is for one time (treatment, professional, location, date and start) and one guest.
- **Booking.** With a link that stands, the booking page shows "Your quiet-time price: £76 instead of the usual £95, for Wednesday 7 October at 10:00 with Maya only. It is open until Wednesday 7 October at 08:00." and Your visit shows Price £76 with "A quiet-time price, instead of the usual £95." Another time reads "Other times are at the usual price." with "Choose that time" to go back. The hold and the booking carry the lower price: the visit is booked at it (`bookedPriceMinor`), with `bookedOffer { messageId, usualPriceMinor }` kept on the visit. The deposit follows the treatment's own rule and is never more than the lower price (a £25 deposit on a £76 price stays £25; on a £5 price it is £5). The review step shows "Usual price £95" above "Quiet-time price £76", the deposit and what is left to pay.
- **When it cannot be had**, the guest is told plainly before confirming and can book at the usual price: a link that ended ("This quiet-time price ended on Wednesday 7 October at 08:00."), was used ("This quiet-time price has already been used to book."), whose time has gone, whose usual price changed, or that cannot be found; a time that is not the offer's ("This quiet-time price is for Wednesday 7 October at 10:00 with Maya only."). If it ends or is used between holding and confirming, the booking is refused, the page says why, holds the same time again at the usual price and asks the guest to read the price and agree again. A retry of the same booking returns the same visit and never takes the lower price twice.
- **The visit, checkout and receipt.** The visit shows Treatment £76 and "Quiet-time price, £19 off £95" beneath; checkout and the receipt name the treatment with "Quiet-time price, £19 off £95" under it, at £76. Tax is worked from the lower price, takings count what was charged and commission follows its existing rules on it (both work from the receipt's treatment amount). The guest's own copy of their record says "booked at £76.00, a quiet-time price (usually £95.00)".
- **Moving.** The studio may move a visit booked at a quiet-time price and the lower price stays with it; the visit's history says "The quiet-time price stays with the visit." The guest cannot move it from their own page ("This visit was booked at a quiet-time price for that time only, so it cannot be moved online. Contact the studio to change it."); they can still cancel it there.
- **Figures.** Cancelled times and the settings panel show the last 30 days: "One visit was booked at a quiet-time price in the last 30 days, £19 below the usual prices." Visits since cancelled or missed are left out.
- **Help**: "Offer a discount on a quiet time" (The day), for everyone at the desk, found by "discount a quiet time", "cheaper off peak price" or "lower price for a gap". (The suggested title used "price", which the help search folds into "plan" for the SALEANE plan guide, so the title says discount.)

## Who can do what

| Role             | Read the setting                          | Change the setting | Write an invitation with a lower price | Approve it                       | Move a visit booked with one |
| ---------------- | ----------------------------------------- | ------------------ | -------------------------------------- | -------------------------------- | ---------------------------- |
| Owner            | Yes                                       | Yes                | Yes                                    | Yes                              | Yes, the price stays         |
| Manager          | Yes, read only                            | No                 | Yes                                    | Yes                              | Yes, the price stays         |
| General manager  | Yes, read only                            | No                 | For a time at their own location only  | For a time at their own location | At their own location        |
| Reception        | Yes, read only                            | No                 | Yes                                    | No (as for every message today)  | Yes, the price stays         |
| Practitioner     | No (their own day page only)              | No                 | No                                     | No                               | No                           |
| Regional manager | No (their area page only)                 | No                 | No                                     | No                               | No                           |
| Guest            | Their own lower price, through their link | No                 | No                                     | No                               | No; they can cancel it       |

The server enforces each: `quiet-offers` is owner-only in `can` (and the whole business's in `branchRefusal`); `offer-invite` uses the `message` permission, as the gap invitation it replaces did; approval stays `message.queue`. A general manager's `offer-invite`, and now their approval of any invitation to a time, is refused unless the time is at their location ("That invitation is for a time at another location."). The lower price is taken only by the public booking route after it has checked the link; it never comes from a request body.

## Server

- **Migration 34**: `offer_links` (token hash, organisation, message, outbox row, created, expires with `expires_at > created_at`, used, the visit it booked, revoked; used and visit set together), an index by (organisation, message), and a unique index allowing one used link per invitation, so a lower price is booked once however many copies went out.
- `server/offers.ts`: `issueOfferLink` (43-character token, hash only), `readOffer` (the same words for a malformed, unknown, revoked or other studio's link; used; then the record's own checks) and `spendOffer` (marks the link used by the visit inside the booking's transaction; a link already used or revoked fails the booking with 409).
- `server/routes/public.ts`: `POST /api/public/:slug/offer` (rate limited) answers what a link offers or a plain problem. `POST .../holds` takes `offer`: a link that stands, for exactly the held time and professional, holds at the lower price and the reply says so; otherwise the time is held at the usual price and the reply says why (`offerProblem`). `POST .../book` checks the usual price has not changed and the link is still unused and not revoked, books through the record's own check, marks the link used, and answers 409 with the guest's words when the lower price no longer stands. A replayed booking returns the first visit and touches nothing.
- `src/domain/commands.ts`: `book` takes an `offer` option (server only, online only), checks the invitation is approved, not withdrawn, not used, not ended, at the same usual price, its time still free and the booking for exactly its time, then books at the lower price with `bookedOffer` and the deposit capped at the price. New commands `quiet-offers` and `offer-invite`.
- `server/messaging/outbox.ts`: an approved invitation with a lower price is checked again as it goes (not sent once ended or the price changed); its private link is made then and goes only in the copy sent, never in what is stored. With email in test mode nothing is sent; running locally (never in tests) the server prints the link that was not sent, so the lead can try it, as it does for account emails.
- `server/routes/messaging.ts`: the message list shows "[a private link to book this time at its lower price]", never the placeholder or a token.
- `server/backup.ts`: restoring a backup revokes every unused link (`offerLinksStopped`), so no link from before a restore books a lower price.
- `server/routes/guest.ts`, `src/domain/guest.ts`: the guest's visit page says why a visit booked at a quiet-time price cannot be moved online (`move.reason: 'offer'`).
- `server/README.md`: a paragraph on quiet-time prices, the new offer route and `offer` on holds.

## Tests

- `src/domain/quietOffers.test.ts` (17): the price (none by default, percentage with rounding, amount, never below free, the floor, a floor that leaves nothing off); no lower price while online booking is off, for a treatment left out or archived; when it ends (the owner's hours or the time, whichever first); the guest's full price with tax added on top; invitations to a cancelled time carrying it as written, and as before without it; **changing or turning off the setting never changes an invitation already written**; no approval once ended or the usual price changed; `offer-invite` (words, record, idempotent, refused with no lower price, without consent, for a time not free); **booking at the lower price** with `bookedOffer`, the event and the simulated deposit; the deposit never above the price; refusals (not approved, another time, not online, ended, **used once even after the visit is cancelled**) and booking at the usual price; **checkout, tax and takings at the lower price, and the receipt line**; the studio moving it keeps it and the guest cannot; offers taken leaving out cancellations; the record's own checks; the guest's copy of their record; permissions for every role, a general manager kept to their location, and Who changed what.
- `server/quietOffers.test.ts` (10): migration 34 and the table; **sent only once approved, with the link kept only as its hash** (not in the outbox, the studio record or the table) and hidden in the message list; **test mode queues and sends nothing**; not sent once ended; the offer route and the same answer for bad links, and an ended link; **hold and book at the lower price** with the deposit, the guest's page refusing to move it, **a retried booking taking it once**, checkout at £76; another time and a used link at the usual price; a link revoked while held refuses the booking and books nothing; the owner alone sets it, reception writes but does not approve, a manager approves, and the audit keeps the change; **restoring a backup stops unused links**.
- `src/components/QuietOffers.test.tsx` (6): the owner's settings saved as chosen with the example line; an amount it cannot use; read only for a manager; the cancelled time's invited line with the lower price; Smart insights writes `offer-invite` with the lower price shown, and the ordinary invitation without the setting.
- `src/components/quietOffersApp.test.tsx` (3, the whole app): the Inbox shows the lower price and approves it as written; the visit and checkout show "Quiet-time price, £19 off £95" at £76; the panel sits in Settings, Messages.
- `src/pages/ServerBookingOffer.test.tsx` (3): the booking page shows the lower price beside the usual one for its time only, goes back to it, holds with the link, reviews usual and lower price with the deposit, and books; a link that cannot give a lower price; the lower price ending before confirming holds the time again at the usual price and asks the guest to agree again.
- `src/domain/help.test.ts`: three searches find the new guide; a practitioner does not.

## Checks

From the worktree root:

- `npx tsc -b`: passes.
- `npx eslint . --ignore-pattern '.claude/**' --max-warnings 0`: passes.
- `git ls-files -z | xargs -0 npx prettier --check --ignore-unknown`: passes.
- Front-end suite: FRONT_COUNTS.
- Server suite: SERVER_COUNTS.
- `npm run build`: passes.

## Decisions

- **One name everywhere: "Quiet-time price".** The visit, checkout, receipt, figures, booking page and Inbox all say it; the email says "the lower price".
- **The price is worked out once, as the invitation is written**, from the treatment's price where the time is, and kept on the message with the usual price and the end. The floor applies to the price booked, before any tax added on top. Team screens show the price as booked; the email and booking page show what the guest pays, with any tax added on top, as the rest of the booking page does.
- **A lower price is open until the owner's hours run out or the time starts, whichever is first**, on the whole minute, and it must still be open as the visit is booked, not only when held.
- **No lower price while online booking is off**, since it can be booked only through its link.
- **Gap invitations with a lower price use a new command**, `offer-invite`, which writes an invitation to one time (by email, with the time on it, not editable by hand), like a cancelled-time invitation. Without the setting, Smart insights writes the same message as before. `offer-invite` refuses when no lower price applies rather than writing an ordinary invitation, so the words a person saw are the words saved.
- **The deposit** is the treatment's deposit, never more than the price booked. The same cap now also applies to an ordinary booking at a location whose price is below the deposit (before, the deposit could exceed it there).
- **Moving**: the studio may move the visit and the lower price stays with it, recorded on its history; the guest cannot move it online, because the price was for that time only. Cancelling is unchanged, and a cancelled visit still used its lower price.
- **The link is spent with the visit**, in the same transaction, and the record refuses a second visit with the same invitation's price; a retry of the same booking is answered from the first. If an email went twice (a retry after an uncertain send), either copy's link works, but only once between them.
- **Approving an invitation to a time** is now kept to a general manager's own location for every invitation to a time, not only those with a lower price (before, only invitations naming a visit were checked).
- **Migration 34**, as assigned.
- **No new dependencies.**

## Quality bar

- [x] **One main job and one primary button per section.** The settings panel: "Save lower price". The booking page keeps its own buttons; "Choose that time" is secondary. The Inbox keeps "Approve and queue".
- [x] **Rarely used options tucked away.** Treatments left out sit in a native `<details>` fold with a 44 px summary; the floor and how long it stays open show only once a lower price is chosen.
- [x] **No card inside a card; rows with hairlines.** The usual and lower prices are receipt rows; the lower price note is one tinted line within the bubble, card or step, not a card.
- [x] **No left-edge stripes; tokens only.** The notes use `--sage-soft`, `--ink`, `--action` and `--radius-inner`; no new raw colours. The edges test passes.
- [x] **Warm, plain words**, British English, "visit" and "treatment", no dashes or exclamation marks, and nothing says a message was sent: "Waiting in the Inbox for approval; delivery is unconfigured.", "Invitation saved in the Inbox, unsent."
- [ ] **At 390 px.** Built to stack (fields full width, choices and the fold 44 px tall, long words wrap), but not yet seen in a browser.
- [ ] **Before and after pictures** at 1440 and 390 px: not taken; for the lead's browser pass.

## Limits and notes

- **Not seen in a browser yet.** Everything above is from tests.
- **An approved lower price cannot be withdrawn by hand.** It ends by itself (at most three days, or as the time starts), or when the treatment's price changes or the treatment is archived. Turning the setting off stops new ones only.
- **Text messages** never carry a lower price; invitations go by email.
- **Offers to someone on the waitlist** never carry a lower price: they asked for a time like it, so it goes at the usual price as before.
- **Sample studios** never send, so their invitations carry the lower price in the Inbox but no link exists to try; a sample studio's clock stands still, so its lower prices are told from its 10:45 and end in real time.
- **With email in test mode** the guest receives nothing. Running locally, the server prints each link that was not sent (never stored), so the booking page can be tried; tests do not print it.
- **No Money page figure.** The 30-day figures are on Cancelled times and in the settings panel; takings already count what was charged.

## Browser steps for the lead

At 1440 px and 390 px, in a **real (not sample) studio in test mode** with the sample menu, Maya working tomorrow, online booking on, and a client with an email address who agreed to hear from the studio. Run the server locally so its console shows the test-mode link.

1. As the owner, Settings, Messages: the new panel "A lower price for quiet times" between Messages to guests and Saved replies, with No lower price chosen. Choose A percentage off, 20, Never below 50, a day, and leave one treatment out in the fold. The example line reads "For example, … at £95 would be offered at £76." Save lower price: "Saved. Invitations written from now on carry this lower price. Any already written keep theirs."
2. Settings, Who changed what: "Changed the lower price for quiet times" with each change.
3. Today, Smart insights, Drifting away: "Prepare an invitation" for a guest who agreed: the words include "For that time only, it is £76 instead of the usual £95." and the Quiet-time price line. Save as unsent draft.
4. Book and then cancel a visit for tomorrow; Waitlist, Cancelled times: SALEANE's own invitations say "at a quiet-time price of £76 instead of £95", and where anyone else might like it the Quiet-time price line sits above Write invitations.
5. Inbox: the invitation shows "[a private link to book this time at its lower price]" and "Quiet-time price: £76 instead of the usual £95, open until …". Approve and queue. Once the outbox has run, its delivery reads "Test mode, not sent".
6. Copy the link the server printed ("… link to book at its quiet-time price was not sent: …") into a private window. The booking page opens on that time with "Your quiet-time price: …" and £76 in Your visit. Choose another time: "Other times are at the usual price." and Choose that time. Hold, add details, review: Usual price £95, Quiet-time price £76, the deposit and what is left. Confirm.
7. Open the same link again: "This quiet-time price has already been used to book. You can still book at the usual price."
8. On the guest's visit page (View my visit): no Move my visit, with the reason; Cancel is still there.
9. In the studio, open the visit: Treatment £76 and Quiet-time price £19 off £95. Move it to another time: the price stays. Welcome, Continue to checkout: the treatment line says "Quiet-time price, £19 off £95" at £76. Take payment and open the receipt.
10. Waitlist, Cancelled times and the settings panel: "One visit was booked at a quiet-time price in the last 30 days, £19 below the usual prices."
11. Sign in as a manager and as reception: the panel is read only with "Only the owner sets a lower price."; reception can write the invitation but has no Approve.
12. At 390 px: the panel's fields stack, the radios and fold are 44 px tall, the booking page note and review rows do not scroll sideways.

Screens to capture before and after at 1440 and 390 px: Settings, Messages with the panel (off, then a percentage off with the example); the Inbox invitation with the Quiet-time price line; Cancelled times with the line and the 30-day figure; Smart insights' prepared invitation; the booking page on the offer's time, on another time, and the review step; the used-link notice; the guest's visit page without Move; the visit panel and checkout line; the receipt.
