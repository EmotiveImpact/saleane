# V3 · Smart insights, first pass: evidence

Recorded 7 October 2026 in Chromium (Playwright) against the dev server in browser demo mode (Atelier House, fictional records, business date Tuesday 6 October 2026).

## What was exercised

- **Today, "Saleane noticed" (1280px and 390px):** "12 visits and 12.5 hours booked today; a usual Tuesday has about 2 hours. Yesterday took £185, against about £135 on a usual Monday." Under "Drifting away": Jamie Morgan, Emily Clarke and Charlotte Hayes (5 to 6 weeks since their last visit), each offered a different open time (today 12:15, today 16:15, tomorrow 09:00). No warnings appear, because nothing in the demo record is unusual.
- **Offer button:** opens the usual booking dialog with the client, their usual treatment and professional, the date and the time filled in. Nothing is booked until the desk confirms.
- **Ask Saleane, "Give me my morning brief":** "Tuesday 6 October: 12 visits, 12.5 hours booked (a usual Tuesday has about 2 hours). 14.5 hours of the team's time is still open. Yesterday took £185, against about £135 usually."
- **Quiet-gap invitation (1280px and 390px):** "Prepare an invitation" beside Jamie Morgan's offer shows "Hello Jamie, it has been a little while. Maya has today at 12:15 free for your Skin Renewal Facial. If you would like it, reply to this message and we will book you in." with "Save as unsent draft" and "Not now". Saving shows "Invitation saved in the Inbox, unsent."; the Inbox lists it as "Draft, waiting for you" with "Approve and queue", and nothing is marked sent.
- **Business, by professional:** each row reads "N completed visits · N% rebooked", with a note explaining rebooking and the studio-wide rate. The demo record has no rebooked visits, so every rate reads 0%; the automated test covers a real rebooking.
- axe (WCAG 2.2 A/AA and best practice) on the insights panel with the invitation open and on the whole Business page at both widths: zero violations, no sideways scroll; the only console errors are the expected 401s on the signed-out demo account check.

Screenshots: [Today panel](V3-INSIGHTS-today.png), [offer opening a booking at 390px](V3-INSIGHTS-offer-390.png), [invitation preview](V3-INSIGHTS-invitation.png), [invitation in the Inbox](V3-INSIGHTS-inbox.png).

## Automated checks

`src/domain/insights.test.ts` covers the brief against the same weekday over the previous four weeks; no warnings on an ordinary day; a quiet day ahead noticed only with enough history; more cancellations than usual; a client with two missed visits booked tomorrow; takings down kept to managers; drifting clients judged against their own usual gap (a three-weekly client is noticed after four and a half weeks) and ordered longest overdue first; open-time offers that never give two clients the same professional at overlapping times. `src/assistant/ask.test.ts` covers the morning brief through Ask Saleane, with takings only for managers, drifting clients and "nothing looks unusual". The same file covers the invitation wording and per-professional rebooking counts that add up to the studio rate.

## Limits

- Every rule is a fixed, explainable threshold, not a trained model. The thresholds (half a usual day, twice the usual cancellations, a quarter down on takings, one and a half times a client's usual gap) are first settings to tune with a pilot studio.
- The demo record has little history, so its "usual" figures are small; a real studio's month of visits makes them meaningful.
- Offers open a booking for the desk. An invitation is only ever saved as an unsent draft; replies are not read yet, and targets are shown as rates without goals to set against them.
- Schedule optimisation and plain-English analysis beyond these questions are later V3 stages. Safari and Firefox were not checked.
