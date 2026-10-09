# Stage 1, part D · At a glance on the client page: evidence

Recorded 9 October 2026 in a separate worktree from main at `016f3ca`. All names and amounts are fictional. The house rules for this stage kept the browser checks for the lead, so nothing here was seen in a browser: the screens were checked through tests that render them, and the steps to see them are listed at the end.

## What was built

Edem asked on 6 October for insight on a client's page. Each client page now has an **At a glance** section between the heading and the relationship timeline:

- one sentence about the client: "Usually every 4 weeks, on Saturday mornings.", or for someone new "New client. 1 visit so far." and nothing more;
- up to six facts, most useful first: a patch test that is not in order, their package or membership, when they are due back (and whether they are drifting away), their favourite treatment and professional, what they spent in the last 12 months and per visit, missed visits and late cancellations, and how often they book the next visit before leaving;
- one suggested next step with its button, chosen in this order: a membership waiting for this month's payment; drifting away ("Invite them back"); due back with nothing booked ("Book their usual", or "Book their next visit" when there is no clear favourite); a patch test needed before the next visit; "Comes every month and spends more than the Glow Membership costs: mention it"; otherwise nothing.

Nothing is sent or changed from the section. "Invite them back" shows the invitation and saves it, on request, as an unsent email news draft in the Inbox ("Invitation saved in the Inbox, unsent."), only for a client who agreed to email news; once one is waiting, or has been approved since their last visit, the section points to it instead of offering a second. "Book their usual" opens the existing booking dialog with their favourite treatment and professional on their usual weekday and time. The membership and patch test steps bring the page's own Packages & memberships or Patch tests panel into view and move focus to it.

Code: `src/domain/clientInsight.ts` (the facts and the step), `src/components/clientInsightWords.ts` (the words), `src/components/ClientInsight.tsx` and `clientInsight.css` (the section). `ClientRelationship.tsx` gains one import and one line. `src/domain/insights.ts` now names its drifting threshold `driftDays` so both screens use the same rule; Today's behaviour is unchanged.

## The same rules as the rest of SALEANE

| Fact                  | Rule reused                                                                                                                                                                                                    |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Usual gap             | `usualWeeks` (the page heading, Today's drifting list)                                                                                                                                                         |
| Drifting away         | `driftDays` from `insights.ts`, the same booked test as `drifting`                                                                                                                                             |
| Due back              | `dueBackOn` from `dueBack.ts`, the same test as Today's "Ready to return" (`dueClients`)                                                                                                                       |
| Spending              | `serviceRevenue` and `retailRevenue` on receipts by visit date, products sold without a visit by the studio's own day (`recordDay`); tips left out, refunds not taken off, as the Business page counts takings |
| Missed and late       | a no-show; a cancellation less than 24 hours (`GUEST_CANCEL_CUTOFF_HOURS`) before the start, read on the studio's clock, as for the fee in `fees.ts`                                                           |
| Booking ahead         | an explicit rebooking link from checkout, as the Business page's rebooking figure                                                                                                                              |
| Plans and patch tests | `planStanding` and `patchTestStanding`, read only                                                                                                                                                              |

Two tests hold this together on the full sample studio (300 regulars): for every client, drifting, due back and the usual gap match Today's lists and the page heading; and the spending of all clients together equals the Business page's treatment takings for the same year, with products equal once unnamed walk-in sales are added.

A fact is left out rather than guessed: a favourite needs three visits in the year, no tie and at least half of them; a day or time of day needs four visits with two thirds alike; booking ahead and a clean record need three visits; the average per visit needs two receipts.

## Roles

- Owners, managers, general managers and reception reach the client page and already see what a client spends in its heading and on each receipt, so the spending line follows that. A guard keeps it from practitioners and regional managers, who never reach the page (practitioners have their own day view, unchanged).
- A general manager reads the whole client record through `branchView`, every location's visits and receipts included, so their figures are the same as the owner's; nothing needed saying about a partial view. When their favourite professional works at another location that day, the suggestion leaves the professional for the general manager to choose, and its wording leaves the name out too.
- Buttons follow `can`: the invitation needs `message`, booking needs `book`, the membership steps need `plan-renew` or `plan-sell`, the patch test step needs `patch-test`. Someone who may not act sees the step without a button, and nothing can be pressed while the studio cannot save. Every change still goes through the existing commands and their server checks; no command, route or migration was added.

## Performance

One pass over the studio's visits finds the client's own; one pass each over receipts, walk-in sales, cancellations and messages does the rest, and the component keeps the result until the studio record changes. Measured in the test runner on a loaded machine: about 3 ms for one client in a studio of 20,013 visits and receipts, and about 45 ms for all 300 clients of the full sample.

## Automated checks

`src/domain/clientInsight.test.ts` (21 tests): a regular monthly client (usual gap, Saturday mornings, favourites, booking ahead, spending without tips and with products less tax); the 12-month window at its first and missing day; a drifting client matching Today, with and without permission for email news; agreement with Today's lists and the page heading for every sample client; agreement with the Business page's takings; due back with their usual filled in, and a treatment's own return time; a professional who left or stopped doing the treatment left out; a new client and a client with no visits; no-shows and late cancellations over 12 months only; a late cancellation read on London's clock when the clocks go back; walk-in sales counted on New York's own day at the edges of the year; weekday and time of day from the studio's own dates at month ends; favourites tied, leading and spread thin; an unpaid membership put first; a membership month ending on 30 September after starting on 31 August; mentioning a membership, and not when it costs more, is off sale, is already held, or the client comes less than monthly; a patch test needed before the next visit, and one run out with nothing booked; an invitation already waiting; a studio of 20,000 visits.

`src/components/ClientInsight.test.tsx` (13 tests) renders the section with a mocked studio: the right next step and button for each kind, the invitation saved as a draft through the ordinary `message` command, an error keeping the draft, the waiting invitation, the booking dialog opening with the treatment and professional chosen, the general manager's suggestion, focus moving to Patch tests or Packages & memberships, no buttons for someone who may not act or while the studio cannot save, and no spending for a role that should not see it.

`src/pages/ClientRelationship.test.tsx` (2 tests) drives the whole demo app: the section sits above the timeline on Charlotte Hayes's page and saves her invitation as a marketing draft in the demo record; Grace Chen's page leads to her patch tests.

Run with `npx vitest run src/domain/clientInsight.test.ts src/components/ClientInsight.test.tsx src/pages/ClientRelationship.test.tsx`: 36 passed. Lint, `tsc -b` and `prettier --check .` pass. The full `npm test` passed: 115 front end files (990 tests) and 44 server files (314 passed, 2 skipped). On a busy machine one existing test, "saves a professional's own hours from 24-hour time lists" in `dateFields.test.tsx`, sometimes cannot find its button in time; it fails the same way on a clean checkout of main at `016f3ca` and passes when run again, so it is not caused by this part.

## To see it in a browser

In the demo or a sample studio (UK or US, the same named clients):

- **Invite them back:** Charlotte Hayes, Emily Clarke, Jamie Morgan.
- **Patch test before their next visit:** Grace Chen (result not recorded yet), Luca Evans (no test yet).
- **Book their usual:** none out of the box, because every regular due back is already booked. Cancel Ava Williams's 11:00 visit today, then open her page ("Book their usual", Lymphatic Massage with Sophia). Cancelling Zoe Miller's or Sophie Martin's visit today gives "Book their next visit", since they have no clear favourite yet.
- **Mention a membership:** add a membership in Settings that covers the Skin Renewal Facial for less than £95 a month ($125 in the US sample), then open Amelia Carter.
- **Membership payment:** the samples have no memberships, and one sold today is paid for a month, so this step cannot be seen without waiting a month. The tests cover it.
- **Nothing to suggest:** Amelia Carter, Olivia James, Ellie Brooks; **a new client:** Nina Patel or Isabel Wilson.

Check it at 1280px and 390px: the facts sit three or four to a row on a wide screen and two to a row on a phone, and the next step's button goes full width under its words.

## Limits

- Not seen in a browser by this part (kept for the lead), so no axe sweep or screenshots yet.
- The samples hold no memberships, so the two membership steps show only after one is set up.
- Spending does not take off refunds, matching the Business page; refunds stay in Money.
- The section reads the record already in the browser; it is not a server report and adds nothing to any role's view.
- Safari and Firefox were not checked.
