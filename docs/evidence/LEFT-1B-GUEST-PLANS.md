# Stage 1, part B · A guest's package or membership on their visit page: evidence

Recorded 9 October 2026 in a separate worktree from main at `016f3ca`. Automated checks only: no server was started and no browser was opened for this part, so the screens below have not yet been looked at in a browser. The lead checks them after merging (steps at the end). All names and amounts are fictional.

## What a guest now sees

On their private visit page (`/manage#…`), under the visit details and any deposit to pay, and above "Your studio", one section for each package or membership they hold that is active or waiting for this month's payment. Cancelled, used up and expired plans are not shown.

- **A package:** "Your package", its name, then "3 of 6 visits left, until 14 March." The year is added when the last day is in another year from the visit.
- **A membership:** "Your membership", its name, then "1 of 1 visit left this month." (or "No visits left this month."), "Your member discount is 10%." when it gives one, and "Your next month starts on 6 November."
- **A membership whose month is not paid:** "This month is not paid yet. When you are ready, please speak to the studio." Nothing else about what it includes.
- **What it means for this visit**, while the visit is still to be paid for, in quieter type under the plan:
  - "This visit can come off your package. The studio will take it off at checkout." (or "membership")
  - "Your 10% member discount applies to this treatment. The studio will take it off at checkout."
  - "This visit has a deposit. If you would rather it came off your package, please ask the studio."
  - "This visit is after your package ends, so it cannot come off it."
  - For a membership month not yet paid: "Once your membership is paid up, this visit can come off it.", or, when this month is paid and the visit falls in a later one, "This visit falls in your membership month from 6 November, which is not paid yet. Once it is, the visit can come off your membership." The same with the member discount.
  - When the page also asks for a deposit, a plan that could pay says "This visit can come off your package. A visit with a deposit cannot, so please ask the studio before you pay the deposit."
  - Nothing for a treatment the plan does not cover, or for a visit that is cancelled, missed or already paid for.

No line says the visit is paid or free: the desk decides at checkout. US studios read dates as "November 6".

## How it is worked out

`guestPlans` in `src/domain/guestPlans.ts`, called from `guestView` on the server, reads only the link's visit and that visit's client's plans. The studio's own day (`businessDate`, in its time zone) decides what is active, used, expired or unpaid. What a plan means for this visit uses checkout's own functions on the day of the visit (`plansForVisit`, `memberDiscountPercent`, `planStanding`): the first plan that can pay is the one checkout offers first, no plan can pay once a deposit is recorded, and the member discount shows only when no plan pays. A month not yet paid is judged with the same `planStanding` as if that month were paid. `src/domain/plans.ts`, `server/payments/*` and `src/components/Plans.tsx` are unchanged.

The view carries, per plan: kind, name, active or unpaid, visits and visits left (while active), a package's last day, a membership's discount and next month, and the outcome for this visit. No price, amount paid, payment, use, method, plan or client ID. `guestViewSchema` stays strict and so does each plan inside it. A comment in `guestPlanSchema` and in the section marks where "Paid by card each month" will go once monthly card payments exist.

## Automated checks

- `src/domain/guestPlans.test.ts` (15 tests): a package with visits left, last day and "covers"; a membership with this month's visits, discount and next month; the member discount once this month's visit is used; a visit in a later unpaid month, for a membership with visits and for one with only a discount; an unpaid membership showing no visits or next month, then active again after the month is paid; the studio's day, not the UTC day (23:30 UTC on 6 October is already 7 October in London, so the month is unpaid); cancelled, used up and expired plans left out; a package that ends before the visit; with two plans, only the one checkout offers first pays; a visit with a deposit offers no plan but keeps the member discount; nothing for an uncovered treatment, a cancelled visit or a visit already paid by the plan; another client's plans never shown; no money, method, plan or client ID in the view and an extra field refused by the schema; months counted from the first day at month ends (31 January, then 28 February, then 31 March); every visit in the UK and US sample studios gives a valid view with plans sold.
- `server/guestPlans.test.ts` (7 tests), through the API with a controlled clock and a studio of its own with a facial that takes no deposit: a package; a membership; a membership a month later with November unpaid, then shown again after the desk takes the payment; a cancelled plan left out; two plans; one client's plans never on another client's visit, nor on another studio's; every upcoming visit in a UK and a US sample studio, with a package and a membership sold, opens a valid view.
- `src/components/GuestPlans.test.tsx` (8 tests): nothing for a guest with no plan; each heading, name and sentence above; never "paid", "free" or an amount on a package; the unpaid wording; the deposit-still-to-pay wording; US dates; no em or en dashes.
- `src/pages/ManageVisit.test.tsx` (1 new test): the section appears before "Your studio", and after the guest cancels it stays with what is left but no longer speaks about the visit.
- Full checks: `npm run lint`, `npx tsc -b`, `npm run format:check`, `npm test` (114 files and 976 tests, then 46 server files with 321 passing and 2 skipped) and `npm run build` all pass.

## Limits

- The section reuses the page's own type, spacing and hairlines. After the lead's browser check it sits under a hairline inside the visit card, with no box or tint of its own, so there is no card inside a card (the quality bar), and no stripe on its edge (the edges test passes).
- In sample studios every visit is booked with a simulated deposit, so checkout never offers a plan there and the guest reads the deposit sentence. To see "can come off your package" in a sample studio, set the treatment's deposit to nothing first and book a new visit.
- Plans are shown for the client of the visit only. If the studio sold the plan to a duplicate record of the same person, the guest does not see it.
- The page asks for any deposit the treatment takes even when a plan could pay; it now says to ask the studio first, but the deposit request itself is unchanged.
- Safari and Firefox were not checked.
