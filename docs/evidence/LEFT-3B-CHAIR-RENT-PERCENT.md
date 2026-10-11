# LEFT-3B · Chair rent as a percentage, with renters' takings kept apart

Built 9 and 10 October 2026 in a worktree, on top of the Stage 2 branch at `fdee202`, together with LEFT-3A. Checked with unit, component and server tests. It has not been seen in a browser yet: this build was not allowed to start a server or open a browser, so the steps for the lead are at the end.

## What it does

- **Three kinds of rent.** "Set up a rental" (Pay, Chair and room rent) now asks for "A fixed amount", "A share of their takings" or "A fixed amount plus a share of their takings", each week or month. The share is a percentage (such as 10 or 12.5).
- **Products.** By default a renter's takings are their treatments only: products they sell come off the studio's shelf and stay the studio's sales. A tick box, "The products they sell are their own, and count towards the share", makes their products theirs instead (and part of the share, when there is one).
- **What is owed.** The renter's takings are their treatments (and products when theirs) on the days they rent, after discounts and without tax. Tips never count. Money given back on their receipts comes off in the week or month it is given back. The share is worked out on each period's takings, rounded once to the penny (half up), and never goes below nothing. A fixed part is owed from the start of each period, as before; the share once the period has ended. While a period runs, its share is shown as "so far", never as owed: in the sample studio the panel says "£50.00 owed" for this week's fixed part, and Record rent offers "£57.50 so far".
- **The working is shown.** Each rental's line says its terms ("£50.00 a week plus 10% of treatments from Monday 21 September. Products they sell stay the studio's sales."). "How the rent was worked out" opens a sentence for each recent period, such as "£50.00 fixed plus 10% of £1,805.00 in treatments is £180.50: £230.50. £230.50 paid." and "£50.00 fixed plus 10% of £75.00 in treatments is £7.50: £57.50 so far.", and says what counts as their takings.
- **Recording rent.** "Record rent" lists each period with something unpaid ("Week from Monday 5 October · £57.50 so far"), shows the period's working under it and suggests the amount. A running period can be paid as it goes, up to what is due so far: "Only £57.50 more is due for that period so far." or "Nothing more is due for that period yet." SALEANE records rent; it never collects it.
- **Renters' takings are kept out of the studio's figures, and rent is the studio's income.** On Business, takings, the average treatment sale, products, tips, tax and refunds leave out a renter's own takings on the days they rent. Two new lines sit with "Gift cards, packages and memberships sold": "Chair and room rent recorded" (owners and managers, with a link to the rent) and "Renters' own takings, kept apart: Not counted in any figure here. They came through your till." "The people behind it" adds ", N while renting" to a renter's completed visits, and their takings there leave those visits out.
- **Money still lists every receipt.** Money's receipts keep every receipt and label a renter's: "· Theo's own takings, renting a chair", or "Theo's own takings for the treatment, renting a chair" when products on the receipt stay the studio's. The till count still counts every pound of cash in the drawer.
- **Accounts.** The day summary keeps a renter's takings, with their tax, apart as "Held for renters" (a new column shown only when there are any), counts their rent as the studio's income, and the journal credits "Takings held for renters" to its own account code, so it still balances against the takings clearing account. The new code is optional until someone rents; preparing a batch with renters' takings and no code is refused: "Fill in the account code for takings held for renters first. Your accountant can tell you it." The sales spreadsheet adds "Renter" and "Renter's own, with tax" columns. The tax summary is the studio's own takings only.
- **Help.** "Rent a chair or room to someone" (owners and managers) explains the three kinds of rent, products, what counts, and that renters' takings are kept apart.

## Every place that adds up takings, and what each now does

Kept apart (a renter's own takings on the days they rent are left out):

| Where                                                                                          | Code                                              | Why                                                                                                                                                |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Business: takings, average sale, products, tips, tax, refunds, by day, by treatment, by person | `report()` in `selectors.ts`                      | The studio's own performance. New `renters` (kept apart), `rent` (income) and `ownCompleted` (visits its takings and average come from)            |
| Ask SALEANE "takings"                                                                          | `takings` skill in `assistant/saleane.ts`         | Uses `report()`; adds that renters' takings are left out, and the rent recorded for owners and managers                                            |
| Whole business, regions, places, month to date, forecast and booked                            | `takings()` and month `bookedMinor` in `group.ts` | Feeds the Areas page, the branch map, a regional manager's area view, brand group figures and group checks                                         |
| Morning brief, "unusual" notices, day recap, week review                                       | `insights.ts`                                     | Compared like for like: anyone renting within five weeks of a compared day is left out of every day compared, so starting a rental is not a "drop" |
| How you compare: average visit                                                                 | `studioMeasures()` in `benchmark.ts`              | The studio's own average                                                                                                                           |
| Client areas: sales by area                                                                    | `areaMap.ts`                                      | The studio's own sales                                                                                                                             |
| Accounts: day summary, journal, tax summary, and the partner API's daily summary               | `dailySummary()`, `dayJournal()`, `taxSummary()`  | Held for renters, apart from income; their rent is income                                                                                          |
| Pay: commission and targets                                                                    | `pay.ts`, `commission.ts`                         | No commission while renting (as before); no target for a month they rent                                                                           |

Kept whole (every receipt, deliberately):

| Where                                                      | Code                                   | Why                                                                                      |
| ---------------------------------------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------- |
| Till count                                                 | `cashForDay()` in `tillCount.ts`       | The cash is in the drawer, whoever earned it                                             |
| Money: receipts, by day                                    | `Money.tsx`                            | Every receipt is listed; a renter's is labelled                                          |
| Accounts: money in and out, the sales list and spreadsheet | `moneyInAndOut()`, `salesByReceipt()`  | Every movement of money; the sales list says how much of each receipt is a renter's      |
| What a client has spent                                    | `directory.ts`, `clientInsight.ts`     | What the client spent at the studio, whoever looked after them                           |
| Time booked and rebooking                                  | `report()` utilisation and rebook rate | The chair or room was in use and the client did rebook                                   |
| Units sold by product                                      | `retailByProduct()`                    | Stock left the shelf either way                                                          |
| Today: "Booked for today"                                  | `Today.tsx`                            | The value of the day's diary, which the desk takes payment for, not the studio's takings |

## Who can do what

| Role             | Rent panel on Pay                                      | Business figures                                                                                                | Money and till                   |
| ---------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| Owner, manager   | Set up, end and record rent; see each period's working | Renters' takings left out; "Chair and room rent recorded" and "Renters' own takings, kept apart"                | Every receipt, renters' labelled |
| Reception        | No Pay page                                            | No Business overview (as before)                                                                                | Every receipt, renters' labelled |
| General manager  | No Pay page                                            | Their location's figures with renters' takings left out, and "Renters' own takings, kept apart"; no rent figure | Every receipt at their location  |
| Regional manager | No                                                     | Area figures with renters' takings left out                                                                     | No receipts (as before)          |
| Practitioner     | No                                                     | No                                                                                                              | No                               |

Reception's and a general manager's records keep each rental's person, space and dates (so their figures can leave a renter's takings out) but not its terms: the amount is 0 and the share is removed, and rent payments are not sent.

## Server and records

- No migration. A rental gains two optional fields: `percentBps` (the share, 1 to 10000 basis points) and `products` (their products are their own). Both are stored only when set, so existing rentals read exactly as before. A rental needs a fixed amount, a share or both ("Enter the rent.").
- The rent payment command checks against what is due so far, so a share can be paid as a period runs but never beyond it. The ledger check on load keeps its ceiling for fixed rents only: a share can fall after it was paid when money is given back later, and the panel then says "£x more than is now due, after money given back."
- The accounting codes gain an optional `renters` code.

## Tests

- `src/domain/takings.test.ts` (8): a rental needs a fixed amount or a share and keeps only what was asked for; a share of treatments only, leaving products, tips and days before the rental out, rounded once (10% of £155.05 is £15.51), with the week still running shown "so far"; a fixed amount plus a share, owed and running apart, and payments capped at what is due so far with the exact messages; products counted when theirs, a walk-in sale included, and money given back taken off in the period it is given back, never below nothing; the sample studio's rent; Business figures leaving a renter out and counting rent, retail staying the studio's unless the products are theirs, no commission; the till and the sales list keeping every receipt and naming the renter's part; the day summary, a balanced journal with "Takings held for renters" and the tax summary.
- `src/domain/rent.test.ts`: the ledger ceiling for fixed rents and none for a share; the sample's rent.
- `src/domain/accounts.test.ts`, `insights.test.ts`, `clientInsight.test.ts`, `sample.test.ts`, `nudges.test.ts`, `src/assistant/ask.test.ts`, `saleane.test.ts` and `src/components/askSaleane.test.tsx`: updated for renters' takings left out, with the reasons in comments, and a new test that comparisons are like for like (the same sample without the rental has no "takings down" notice).
- `server/projections.test.ts`, `server/pay.test.ts`, `server/branch.test.ts`, `server/regional.test.ts`: rent terms and payments never reach reception, general or regional managers.

## Checks

- `npm run lint`, `npx tsc -b`, `npm run format:check` and `npm run build`: pass.
- Front-end suite: 142 files, 1,253 tests passed. Server suite: 53 files, 406 passed and 2 skipped.

## Decisions

- **A rental day is the rule.** A visit is the renter's own when they were renting on the day of the visit, whatever day it is paid. A walk-in sale is theirs when they sold it on a rental day and their products are theirs.
- **The share is worked out per period and rounded once**, half up, so a week's rent is a whole number of pence and the parts never disagree.
- **Money given back on a renter's receipt** comes off their takings in the period it is given back, in proportion to how much of the receipt was theirs (the tip is never part of it), and out of what the accounts hold for them.
- **The sample studio's comparisons changed.** In the named sample (the fifteen named clients, which the tests use), Theo's renting days are now his own, so this week's takings are compared without him and the named clients alone took less than usual: "Takings are down this week" now appears there. The full sample with its regulars is unaffected.
- **Rent is the studio's income on the day it is recorded**, as before, so Business shows "Chair and room rent recorded" for the period chosen.
- **What a client spent** stays the whole of what they paid, because it describes the client, not the studio's income.

## Quality bar

- **One main job and one primary button.** "Set up a rental" and "Record rent" keep one primary each; the rent kind is a set of three plain radio choices.
- **Rarely used options tucked away.** The working for each period sits behind "How the rent was worked out", a native `<details>` element because `MoreOptions` is not on this branch. The renters' account code sits with the other codes, marked "Only if someone rents a chair or room".
- **No card inside a card.** The working is rows inside the rent panel; Business's two new lines use the same rule and spacing as their neighbours.
- **Photographs, empty pages, loading.** None added or changed; `LoadingShapes` is not on this branch and nothing here loads on its own.
- **Motion.** `--motion-calm` is not on this branch; no new motion.
- **390 px.** The working lines stack, the dialog's choices and fields wrap as the existing form does. Checked in a browser at 390 px (see below).
- **Words.** Plain British English, "visit" and "treatment", no dashes. Rent is "recorded", never "paid by SALEANE" or "collected".
- **Built from the library.** Existing components and tokens only, no left-edge stripes.
- **Before and after pictures** were taken at 1440 and 390 px in the browser pass and are on the Stage 3 before and after page: https://claude.ai/artifact/EX667DQpzruWeeZeTktMrE.

## Seen in a browser

Checked on 10 October 2026 in Chromium against the local server, signed up as a new owner with the sample studio (sample day Tuesday 6 October), at 1440 px and 390 px.

- Business, Pay, Chair and room rent: Theo's line reads "£50.00 a week plus 10% of treatments from Monday 21 September. Products they sell stay the studio's sales.", with "£50.00 owed" and, under it, "£7.50 more so far this week". The weeks show Mon 5 Oct owed and Mon 28 Sept and Mon 21 Sept paid.
- "How the rent was worked out" reads, week by week, "£50.00 fixed plus 10% of £75.00 in treatments is £7.50: £57.50 so far.", "... £1,805.00 ... £180.50: £230.50. £230.50 paid." and "... £1,705.00 ... £170.50: £220.50. £220.50 paid.".
- "Record rent" opens on "Week from Monday 5 October · £57.50 so far" with the working under it, the amount filled in, and a reference and the confirming tick required.
- A manager can record rent and set up a rental. Reception has no Pay tab; Money labels Theo's receipts "Theo's own takings for the treatment, renting a chair".
- 390 px: the rent panel, its working and Record rent stack, with nothing scrolling sideways.

Found and fixed in this pass:

- Theo's line said only "£50.00 owed" while the current week's share, £7.50 so far, sat out of sight in the working. The line now shows both: the fixed part owed now, and the share so far on a quieter line underneath (a new Pay test covers it).
- A missing full stop after "Products they sell stay the studio's sales".

## Steps for the lead in a browser

Sample studio, signed up as a new owner, at 1440 px and 390 px. The sample's day is 6 October 2026. Theo Bennett rents his chair from 21 September for £50.00 a week plus 10% of his treatments.

1. Business, then Pay, Chair and room rent: Theo's line reads "£50.00 a week plus 10% of treatments from Monday 21 September. Products they sell stay the studio's sales" with "£50.00 owed" and "£7.50 more so far this week". Open "How the rent was worked out": the weeks from Mon 21 Sept and Mon 28 Sept read "£50.00 fixed plus 10% of £1,705.00 in treatments is £170.50: £220.50. £220.50 paid." and "... £1,805.00 ... £180.50: £230.50. £230.50 paid."; the week from Mon 5 Oct reads "£50.00 fixed plus 10% of £75.00 in treatments is £7.50: £57.50 so far."
2. "Record rent": "Week from Monday 5 October · £57.50 so far", with the working under it. Try £57.51: "Only £57.50 more is due for that period so far." Record £57.50 in cash.
3. End Theo's rental from today, then "Set up a rental" for him again from tomorrow as "A share of their takings" at 12.5% with products ticked; his line reads "12.5% of treatments and products, worked out each week".
4. Business, Overview, last 7 days: "Takings from completed treatments" £4,230 from 41 completed visits (63 visits were completed in all; 22 were Theo's while renting); "Chair and room rent recorded" £230.50 and "Renters' own takings, kept apart" £1,580. "The people behind it" shows Theo's visits "while renting".
5. Money: Theo's receipts read "· Theo's own takings, renting a chair". The till count for today still expects his cash.
6. Accounts: the "Held for renters" column, and the note under the table. In the accounting settings, the "Takings held for renters" code; preparing a batch without it is refused in plain words.
7. Sign in as reception: Money lists every receipt with the same labels; there is no Pay page. As a general manager: Business shows "Renters' own takings, kept apart" but no rent figure.
8. 390 px: the rent panel, its working, both dialogs and Business, with nothing scrolling sideways.
