# NEXT-06 · Help inside the app

Recorded 9 October 2026 on a local build (Chromium, 127.0.0.1:5173, sample studios). No help address was set on the server, so requests were kept on it, as they will be until `SALEANE_SUPPORT_EMAIL` and email are connected.

## Tests

- `src/domain/help.test.ts` (5 tests): every screen and Settings section a guide names, or opens with "Go there", exists in the app's routes and in the list Settings draws; every guide has a group and steps, ends each line properly, and uses no dashes, American spellings or "appointment" and "customer"; each role sees only the guides for what it can do (reception has no refunds or SALEANE plan, a practitioner has only their own day, the day sheet and patch tests, a regional manager has their area) and someone with no studio open sees only the guides for everyone; the guides for the screen come first, a Settings section's own before the rest, the practitioner's and regional manager's own page first; search finds the right guide first for "How do I refund a payment?", "reschedule an appointment", "no show", "invite new staff", "gift voucher", "forgot password", "two factor", "my subscription", "GDPR" and "xero", and nothing for "the" or "rocket launch".
- `src/components/HelpPanel.test.tsx` (7 tests): the billing screen offers its two guides first and leaves them out of the groups below; reception on Money sees the till count and no refund guide; searching "reschedule" opens Move a visit, with its note that no message is sent, and "Go there" closes Help and opens the Calendar; "rocket" says no guide matches and hands over to Ask SALEANE; the browser demo cannot write to the team and asks nothing of the server; a request is sent with its topic, message, screen and studio, and the panel says "Saved. Email is in test mode, so it has not been sent to anyone yet." and lists it as "Not sent: email is in test mode."; a request the email service failed on says "Saved, but the email could not be sent. It is kept here." and never "sent".
- `server/support.test.ts` (5 tests): a request is emailed to the help address with who wrote, the studio and their role, the screen and the message, and recorded as accepted; one the email service failed on is kept as failed, one in test mode as test, and one with no help address as kept, with nothing sent; people see only their own requests and cannot name a studio they do not belong to (404); a request needs someone signed in, the CSRF token, a known topic, at least ten characters and a screen path on SALEANE, and a sixth in an hour is refused (429); the help address must be an email address.
- `src/assistant/ask.test.ts`: "How do I refund a payment?" is answered from the Refund a payment guide for the owner, reception is given a guide it can use instead, and a question with no guide points to Help.
- `src/components/interaction.test.tsx`: Help opens from the header on the Calendar with Book a visit on this screen, Escape returns focus to the Help button, and "Ask SALEANE" in Help opens Ask SALEANE.

## Browser journey

1. Calendar, Help: "On this screen" lists Book a visit, Move a visit, Cancel a visit or mark it missed and Check a client out, then the groups Getting started, The day, Clients, Money, Team, Locations, Messages and AI, and Settings and data. Write to the SALEANE team says "No help address is set on this server yet, so a request is saved here but not sent. Replies would go to" the owner's address.
2. Searching "refund" finds Refund a payment first. Its steps name Business, Money, Receipts, "Refund to the card" and "Record external refund", with the note that recording a refund made elsewhere moves no money. "Go there" opened /business/money.
3. Settings, Plan and billing, Help: Your SALEANE plan and bills, and If a SALEANE payment fails. About "My SALEANE plan or a bill", "Can I pay for a whole year at once?", Send: "Saved on this server. It has not been sent, as no help address is set yet." Below, What you have written: "9 October 2026, Linden Studio. Kept on this server; not sent."
4. Ask SALEANE, "How do I move a visit?": "Move a visit: 1. Open the visit on Today or the Calendar and choose Move visit. 2. …" ending "The guide is also in Help, at the top of the screen."
5. At 390 px wide on Clients, Help fills the screen with the seven client guides first, and nothing scrolls sideways.
6. A practitioner's own day has Help beside Sign out: Your day, Record a patch test you just did and Print the day sheet, then only Who can do what, the forgotten password guide and Write to the SALEANE team. At 390 px the button keeps its name for screen readers and nothing scrolls sideways.
7. A regional manager's area page has Help: Your area, Do a branch visit and Ask for a sign-off, then the same three for everyone.

axe (WCAG 2.2 AA tags) found nothing on the panel, a guide, the written request, the practitioner's page or the area page. No console errors.

## Not covered

Nobody at SALEANE reads or answers requests yet: they are kept on the server until a help address and email are connected. The guides are written for the screens as they are on 9 October 2026; the test checks every screen and section they name, not every label, so a renamed button needs its guide changed too. Safari and Firefox were not checked.
