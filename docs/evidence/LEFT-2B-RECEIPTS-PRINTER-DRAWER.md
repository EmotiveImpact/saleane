# Stage 2, part B · Receipts, the receipt printer and the cash drawer: evidence

Built 9 October 2026 in a worktree from `main` at 016f3ca. Everything here runs in test mode: no receipt printer, cash drawer or email service was connected, and no money moved. The browser checks below are still to do (the build agent was asked not to start a server or open a browser); the automated checks have all been run.

## What a person can do

- **Settings, Till and printer (owners and managers; others read it):** for each location, choose how receipts print: the computer's print window (the default), a receipt printer on the studio's network, or the test printer. Paper width (80 mm or 58 mm), the printer's port and the VAT number (UK) or tax ID (US) sit behind a "Paper width, port and VAT number" line that opens in place. A network printer needs its address on the studio's network; SALEANE refuses anything else before saving ("SALEANE only connects to a printer on your own network, such as 192.168.1.50."). "Open the drawer for cash payments" is off and greyed for the print window, with the sentence "The computer's print window cannot open a cash drawer. To open the drawer automatically, connect a network receipt printer." Once a network or test printer is saved, "Print a test page" sends one; with the test printer, "Show the test printer's last job" shows what it would have printed.
- **After checkout (visit window), after a walk-in sale (Stock, Sold without a visit) and after selling a gift card:** "Print receipt" and, when the client has an email address in a studio of its own, "Email receipt". If the location's drawer opens through SALEANE, a line under the buttons says what happened: "Test drawer: it would have opened now.", "The drawer was sent the signal to open." or "The drawer may not have opened." with the printer's answer.
- **Money, Receipts:** each visit receipt has the same two buttons. Walk-in rows now open the receipt as a till roll (with a link to give money back from Stock), and a new "Gift cards and plans" group lists gift card, voucher, package and membership payments, each opening its receipt.
- **Money, End-of-day till count:** "The cash drawer" lists every opening on the chosen day (time, cash payment or refund with its receipt number, or "No sale" with its reason, who, and what the printer answered) under one sentence, such as "The drawer opened 4 times: 3 cash payments, 1 no sale by Maya: change for a £20." "Open the drawer" asks "Why is the drawer opening?" (3 to 80 characters) and, with more than one drawer, which one.
- **Refund to the card (Money, a card receipt):** each product still on the receipt has "back on the shelf" with a number. The products go back only when the payment provider confirms the refund; a failed refund puts nothing back, and an unclear one puts them back only once checking confirms it.

Roles: owners, managers and reception print, email and open the drawer (they take payments); a general manager does so at their own location only; practitioners and regional managers cannot (the server refuses with 403). Only owners and managers change the printer or send a test page.

## How it works

- `src/domain/receipt.ts` builds one receipt model from a visit, a walk-in sale, a gift card sale or a plan payment: studio name, location (when there is more than one) and address, VAT number or tax ID, date and time in the studio's time zone, receipt number, who served, each line (treatment, products with quantities, discount or member discount or plan saving, tip), tax as the studio shows it (added as a line, or "Includes VAT 20%"), deposit paid before the visit, the part a package or membership paid, gift card used (last four characters only), total, how it was paid in honest words ("Card, test payment, no money moved", "Card at the studio's own terminal", "Cash"), refunds and a short thank you. The slip on screen, the printer and the email all read the same rows.
- Printing through the print window opens the browser's print dialog with only the receipt, on an 80 mm or 58 mm roll (`@page` sized to the slip), black on white.
- A network printer gets ESC/POS over raw TCP on port 9100 to 9109, from SALEANE's server. `server/till/printers.ts` connects only to private addresses (10/8, 172.16/12, 192.168/16, 169.254/16, fc00::/7, fe80::/10), looks a name up first and refuses it if any answer is outside the network, refuses odd forms (decimal, hex or octal addresses, short forms, localhost) without looking them up, connects to the address it checked, and gives up after 3 seconds. It says "sent", never "printed".
- Cash recorded by any saved change (checkout, walk-in sale, gift card, plan, deposit or fee, and cash refunds) opens that location's drawer if it is connected: the opening is written in `till_events` in the same transaction as the cash, then sent. A drawer that could not be reached within a minute is marked skipped rather than opened later by surprise. A sample studio always uses the test printer.
- Emailing a receipt queues one outbox message of the new kind `receipt` (idempotent by request key, at most three per receipt), checked again before it goes: email only, and only if the client's address has not changed. In test mode it is recorded as a test message and never sent.

## How to see the test printer's preview

1. Settings, Till and printer: choose "Test printer", tick "Open the drawer for cash payments" if wanted, and Save.
2. Either press "Print a test page" there, or check out a visit in cash (or open any receipt in Money) and press "Print receipt". The paper appears under the buttons in the printer's own letters, with "Test printer: nothing was printed on paper. This is what it would have printed." and where the paper would be cut or the drawer open.
3. "Show the test printer's last job" in Settings, Till and printer shows the most recent one again. Drawer openings are listed under "The cash drawer" in Money's till count.

## Automated checks

- `src/domain/receipt.test.ts` (14 tests): each receipt type, added and included tax, UK and US wording, deposit, gift card, package or membership, member discount, refunds, sample studios, receipt keys, the rows, text and email.
- `src/domain/till.test.ts` (12): printer settings per location and their refusals, the VAT number, the drawer forced off for the print window, the cash found in a saved change for every kind of sale and refund, the drawer sentence and the no-sale reason.
- `src/domain/lanAddress.test.ts` (5): private and public addresses, IPv6 and mapped forms, odd forms, names and ports.
- `server/tillPrinter.test.ts` (8): golden ESC/POS bytes for a simple receipt, the preview read back from bytes, typed text never becoming a printer command, £ and accents on code page 858, and the network adapter against a local TCP server (sent bytes match, a name looked up and the checked address used, this computer, 8.8.8.8, a public name, mixed answers, decimal, hex, octal and short addresses and localhost refused with nothing reaching the server, a wrong port refused, a refused connection and an unknown name in plain words, a silent address given up within the timeout).
- `server/receipts.test.ts` (14): settings by role, drawer openings for cash at checkout and for a gift card sold in cash, none for a card machine payment, no-sale reasons and permissions by role (reception yes, practitioner and regional manager no, a general manager only at their own location), the audit entry, a network printer receiving the pulse and a failed one reported honestly, a stale opening skipped, a sample studio never reaching a real printer or sending email, printing with the test preview and on a network printer, test pages owners only, the emailed receipt queued, deduplicated, capped at three and recorded as test, skipped when the address changed, refused for a walk-in with no client, and the card refund restock (confirmed, checked first, failed, unclear then checked, only from a receipt).
- `src/components/ReceiptSlip.test.tsx` (6): the slip's layout and width, printing only the slip on a till roll and tidying up, the test printer's paper, Print receipt using the print window without the server, the test printer and test drawer wording, and an email queued with a request key and never called sent.
- `src/components/interaction.test.tsx`: Settings now lists Till and printer under Treatments and money.

Full results: `npm run lint`, `npx tsc -b`, `npm run format:check` and `npm run build` pass. `npm test` passes in full (front end 116 files, 991 tests; server 46 files, 336 tests, 2 skipped), as first built. The checks were run again once Stage 2 was joined together; see the Stage 2 notes in the changelog.

## Migration 31

This part was built as migration 29. Main took 26 to 28, Stage 1 took 29 and product photos took 30 while it waited, so it is **31**. It rebuilds the outbox to add the `receipt` kind, restating every kind before it (including Stage 1's `plan_reminder` and `plan_declined`); any later step that rebuilds the outbox's kinds must restate `receipt` too. It also creates `till_events`.

## Decisions and limits

- Change given is not shown: the till does not record the cash handed over, only the amount paid.
- Plan receipts show tax at the studio's current rate, because a plan payment does not store the rate it was sold under.
- The printed receipt does not name the client; the email greets them by first name.
- The drawer also opens for cash deposits, missed-visit fees and cash refunds, which also pass through the drawer.
- Printing is not added to the change history; no-sale openings ("Opened the cash drawer without a sale") and emailed receipts ("Emailed a receipt") are.
- Plan sales happen on the client page, which this stage does not touch, so their receipts are reached from Money.
- The demo build in the browser cannot reach a network printer and says it could not be reached; sample studios use the test printer anyway.
- Real receipt printers, real drawers and real email were not tried; Safari and Firefox were not checked.

## Screens to capture (before and after)

Before (current `main`) and after, at 1440px and 390px:

1. Settings with Treatments and money open (after: Till and printer in the list), and Settings, Till and printer with the test printer saved and a test page shown.
2. The visit window just after a cash checkout, with Print receipt, Email receipt and the test drawer line (after) beside the same moment on `main`.
3. Money, Receipts: the receipts list (after: Gift cards and plans group), an open visit receipt with its buttons, and an open walk-in receipt as a till roll.
4. Money, End-of-day till count: the cash drawer list with one cash opening and one no sale, and "Open the drawer" asking for a reason.
5. Money, a card receipt with products, Refund to the card (after: "back on the shelf").
6. Stock, Sold without a visit just after a sale; Gift cards, the "Gift card ready" dialog.
7. The browser's print preview of a receipt on 80 mm and on 58 mm.

## Quality bar

Checked against `quality-bar.md` by reading the code; the browser pass at 1440px and 390px is still to do.

- **One main job and one primary button:** Till and printer has Save as its only primary button; "Print a test page" is secondary and "Show the test printer's last job" quiet. Print receipt and Email receipt are secondary wherever they appear, so the window's own way forward stays primary (the next visit after checkout, Done after a gift card). Open the drawer is secondary under the till count, whose primary stays Record till count.
- **Rarely used options tucked away:** paper width, port and VAT number sit behind a native `<details>` line, because `MoreOptions` is not on `main` yet (PR #83); swap it in once merged. The printer's address stays in view when "network printer" is chosen, because it is the one thing that choice needs. Gift card and plan receipts show five, then "See all".
- **No card inside a card:** the till roll and the test printer's paper are drawn as paper, with dashed hairlines above and below and no box; drawer openings and receipts are rows with hairlines.
- **Photographs:** none added; these are working surfaces.
- **Empty pages:** no new page. The drawer list shows one sentence when there is nothing ("The drawer has not been opened through SALEANE.").
- **Loading:** `LoadingShapes` is not on `main` yet, so nothing new shows a spinner or "Loading" on its own: the drawer list and status line appear when they arrive, and buttons say "Printing…", "Queuing…" or "Opening…" while waiting.
- **Motion:** none added, so nothing to reduce; `--motion-calm` is not used for the same reason as above.
- **390px:** to check in the browser. Written to fit: the slip is at most 302 px wide (219 px for 58 mm), the test printer's paper is the one strip allowed to scroll sideways, buttons wrap, and the summary line of the tucked-away options is 44 px high.
- **Words:** plain British English with no em dashes; nothing says printed, opened or sent unless SALEANE knows it ("Sent to the receipt printer. Check the receipt came out.", "Receipt queued for … It is not sent yet."); errors keep what was typed and say what to do next.
- **Built from `src/design`:** `Button`, `ErrorMessage` and `Modal` from the library and tokens only; the one raw colour is black on white inside `@media print` for the till roll. `npm run check` parts and `npm run format:check` pass.
- **Before and after pictures:** listed above for the lead's browser pass.
