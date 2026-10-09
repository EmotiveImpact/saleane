# MOVING-01 · Moving in, stage 1: clients from any system

**Status: built locally on 9 October 2026, awaiting the owner's "merge"; nothing deployed.**

The owner said yes to all five moving-in answers on 9 October 2026: the UK five first (Fresha, Phorest, Timely, Treatwell, Booksy), a free "move me in" service, marketing only where the old system shows the client agreed, cards saved again through a link, and start building now. This is the first stage: the client list.

## What the owner sees

Clients, Import clients, and Settings, Switching over, Clients, now open the same screen, "Move your clients in".

1. **Where are you moving from?** The UK five come first, then Square, Vagaro, GlossGenius and "Something else". Choosing one shows where to find the export in that system, in plain words.
2. **Add your files.** Drop or choose as many files as they like, CSV or Excel (.xlsx), exactly as the old system gave them. Each file is named with what SALEANE thinks it is ("Fresha client list · 11 rows", "Phorest client export · 4 rows"). Visit, gift card, package and payment files are recognised and kept for the next stage rather than refused.
3. **One thing to check.** Only a column SALEANE is unsure of becomes a question, with three examples from the file ("Is “Contact” in VIP list.csv the mobile?").
4. **Check before it comes across.** Ready, already here, and needing a look, with how many agreed to marketing and how many have birthdays; who was combined; each row that cannot come across and why; and, folded away, what every column becomes, which the owner can change.
5. **Bring N clients across.** Long lists go in parts the server accepts, one after another. A dropped connection keeps the files and says how many came across; anyone saved shows as already here on the next review.

![The start](MOVING-01-start.jpg)
![Four files added and one question](MOVING-01-files-and-question.jpg)
![The review with every column](MOVING-01-review.jpg)
![Done](MOVING-01-done.jpg)

## Rules kept

- **Nothing already in SALEANE changes.** Same name plus the same email or phone means "already here" and the row is left out. Nobody is merged on email alone. The server refuses an import containing an existing or repeated client.
- **The same person in several rows or files is combined** into one client, keeping every note.
- **Marketing comes across only with evidence.** A client's email marketing is on only when the old file records that they agreed in an email or general marketing column ("Accepts marketing: Yes", "emailMarketingConsent: true", "Subscribed"). "Unknown", blank or anything unclear means off. The consent record has source "previous system", the evidence in the old system's own words, and no wording version, because SALEANE never showed them its own words. The server refuses carried consent without evidence. Text marketing is noted on the timeline but not switched on. A client with no email starts with email marketing off, with a note saying why.
- **Clients without an email can come across** when they have a phone number. Guest booking and new clients at the desk still need an email. Editing a client never removes an email they already had.
- **Phone numbers become international** for the studio's country: "07700 900123", "7700900123" (Excel dropped the zero), "+44 (0)20…", "0044…" and US 10 or 11 digit numbers.
- **Birthdays keep month and day only**, read in the file's own date order. Names written in capitals or surname first are tidied.
- **Card details never move across.** A card column is left out with "Clients save their card again through a link."

## The client afterwards

Grace Mensah appeared in the Fresha list twice and in a VIP spreadsheet. She arrived once, with all three notes, her birthday, and email marketing on. The client page says "Agreed Fri, 9 Oct in their previous system, brought across by Local operator" with "Fresha recorded “Accepts marketing: Yes”" beneath it. Her timeline lists the source and what came across. Her privacy file says "agreed in their previous system: Fresha recorded “Accepts marketing: Yes”"; a client with no email reads "Email: Not recorded".

![Grace after the move](MOVING-01-client.jpg)

The move is listed under Settings, Switching over, What has come across ("Clients from Phorest and Fresha client lists").

![Settings](MOVING-01-settings.jpg)

## How it was checked

- `npm run check` (lint, all tests, build) and `npm run format:check` pass.
- 21 domain tests in `src/domain/movingIn/movingIn.test.ts`: comma, semicolon and tab files, a byte-order mark, Windows text and UTF-16; an Excel workbook with dates stored as numbers; files it cannot read (.xls, a web page saved as .xls) explained; synonyms; headings checked against contents; title and totals rows; the layouts for Fresha, Phorest, Timely, Square, Vagaro and GlossGenius; visits and gift card files told apart; phones, birthdays and names; a Fresha list end to end, including the saved studio read back and moved again (everyone already here); consent refused without evidence; a client already here left untouched; two files combined; marketing off for a client with no email; a US Square export; long lists split into parts; editing a client without an email; the privacy file wording.
- Two interaction tests on the Clients page: a Fresha list brought across with notes, birthday and recorded marketing; a failed save keeps the files and asks for the review again.
- Chromium at 1440 and 390 pixels wide on the browser demo, with four files at once: a Fresha client list (11 rows, with a duplicate, a client already here, a dropped leading zero, a name in capitals, "Unknown" marketing and a row with no contact details), a Phorest client export in Excel with a title row and real Excel dates, a Fresha appointments list, and a hand-made VIP spreadsheet. Result: 14 ready, 1 already here, 1 needing a look, 2 combined, 6 with marketing, 7 with birthdays; 14 clients saved.

![Phone, 390 pixels](MOVING-01-phone-390.jpg)

## Not done yet, said plainly

- **No real export files yet.** Fresha's client list marketing columns, Square, Vagaro and GlossGenius are confirmed from published sources; Phorest and Timely layouts are likely, from their report labels and API names. Treatwell and Booksy have no published headings, so their files are read by meaning, and an unsure column is asked about. Real files will confirm or correct this.
- **Answers are not remembered** for the next studio from the same system yet.
- **Only clients come across in this stage.** Visits, gift cards, vouchers, packages and balances are recognised and kept for the next stages; the older CSV steps for treatments, upcoming visits and balances are unchanged.
- **Old .xls files** are not read; the owner is asked to save as .xlsx or CSV. Only the first sheet of a workbook is read.
- The free "move me in" service, a practice move, moving day and the US systems are later stages.
- Checked in Chromium only, not Safari or Firefox.
