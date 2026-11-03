# LEFT-3A · Commission by treatment or product, steps by takings, and targets

Built 9 and 10 October 2026 in a worktree, on top of the Stage 2 branch at `fdee202`. Checked with unit, component and server tests. It has not been seen in a browser yet: this build was not allowed to start a server or open a browser, so the steps for the lead are at the end.

## What it does

- **Rates for a treatment or product.** On Pay, the owner opens "Rates for treatments and products" and adds a rate for one treatment, a kind of treatment (Skin, Body or Hair treatments), products in general, or one product, for everyone or for one person, from a date. A rate can be ended from a day ("End", then "End from this day"), which puts the usual rate back. Nothing is ever overwritten: every change is a new record from its date, so earlier months keep the rate they had. "In force today", "Starting later" and "Every change, newest first" (with who set it) are shown in the dialog. A product only used in treatments is refused: "Choose a product that is sold at the till."
- **The most specific rate wins**, in this order, written at the top of `src/domain/commission.ts`, in the dialog's description and in Help ("Set a commission rate for a treatment or product"):
  1. a rate for this person and this treatment (or this product);
  2. a rate for everyone and this treatment (or this product);
  3. this person's rate for the kind of treatment (or for products in general);
  4. everyone's rate for the kind of treatment (or for products in general);
  5. steps by takings, this person's or else everyone's, in place of the usual rate;
  6. this person's usual rate (the existing "Rates" dialog, unchanged);
  7. nothing, when no rate is set.
- **Steps by takings.** "Steps by takings" sets up to five steps for everyone or one person from the first of a month: a rate from the first sale, and higher rates from set amounts of the month's takings. Steps can count treatments only (usual) or treatments and products together. Each month starts afresh on the first. Two ways to pay, each explained in one sentence on screen:
  - Only the takings above a step (usual): "Each step's rate is paid only on the takings above it, so the first part always earns the first rate."
  - The whole month, once a step is reached: "Once the month's takings reach a step, the whole month is paid at that step's rate."
    The dialog reads the steps back in plain words as they are typed ("Treatments at 35% up to £3,000, then 40% above it"). "Stop these steps from October 2026" puts people back on everyone's steps or their usual rate.
- **How steps and item rates combine.** A rate set for a treatment or product always wins over steps, and its takings do not count towards the steps: steps count exactly the takings they pay on. Products count towards steps only when the steps say "Treatments and products together". This is tested both ways.
- **Monthly targets.** "Target" beside each person sets a takings target for the month, with optional treatment and product targets, from a month onwards until changed or stopped. Takings for a target are counted exactly as pay counts them: treatments and products after discounts and without tax, less money given back that comes off their commission. Tips never count. Someone renting a chair or room has no target for months they rent ("They rent a chair or room that month, so their takings are their own."), and a target set before they started renting is not shown for those months.
- **Pay shows it.** Each person's line says how they are paid ("Treatments 35% to £3,000, then 40% · Products 10% · Lymphatic Massage 45% · Hydrating Serum 15%") and, with a target, "Target £6,000 · £1,514 so far, 25%" with the thin bar Business uses. "Details" opens "How commission was worked out": one line per rate, such as "Treatments at 35% up to £3,000 / On £3,000.00 of takings / £1,050.00", "Lymphatic Massage at 45%, its own rate", "Treatments given back at 35%, the step reached in October 2026", with a total that equals the commission, then each receipt.
- **The payroll download** has a new "How commission was worked out" column ("Treatments at 40%: 1400.00 earns 560.00; Products at 10%: ...") and, when anyone has a target, "Monthly target" and "Towards target".
- **Practitioners** see only their own target on their day page: "Your target for October: £1,514 of £6,000 so far, 25%." It is the only money on that page, and only when they have a target. Their rates and what they have earned are never sent to them.
- **Help.** New articles: "Set a commission rate for a treatment or product" and "Pay more commission once takings reach a step" (owners), "Set a monthly takings target" (owners and managers) and "See your target for the month" (practitioners).

## Exact to the penny

- Money is in minor units throughout. A fixed rate (a usual rate or a rate of its own) is worked out once per receipt per rate, rounded half away from zero, so a refund rounds the same way as the sale it reverses.
- Steps are worked out on the month's takings so far: each receipt earns what the month's commission is after it less what it was before it, so the month's total is rounded once and the receipts add up to it exactly. With "whole month", the receipt that reaches a step carries the catch-up for the month's earlier takings; earlier months never change.
- The parts shown in "How commission was worked out" are split from the same figures and always add up to the commission (checked for every person wherever a test pays visits, and on awkward amounts such as £19.99, £25.01, £33.33 and a penny at 12.5%, 33.33% and 45.67%).
- **Money given back** (refunds come off commission by default, the existing rule): with steps still in force, it comes off that month's takings so the steps go back down; once steps have stopped, it comes off at the rate of the step the original month reached, and says so.

## Who can do what

| Role             | Pay page                                                     | Rates and steps                 | Targets             | Own target                   |
| ---------------- | ------------------------------------------------------------ | ------------------------------- | ------------------- | ---------------------------- |
| Owner            | Yes, with "How commission was worked out" and the download   | Sets, ends and stops them       | Sets and stops them | Not applicable               |
| Manager          | Yes, with each person's rates, breakdown and target          | Reads them; no buttons, and 403 | Sets and stops them | Not applicable               |
| Reception        | No Pay page; their record carries no rates, steps or targets | No (403)                        | No (403)            | Not applicable               |
| General manager  | No Pay page; their record carries no rates, steps or targets | No (403)                        | No (403)            | Not applicable               |
| Regional manager | No; their area view has no pay records at all                | No (403)                        | No (403)            | Not applicable               |
| Practitioner     | No                                                           | No (403)                        | No (403)            | Their own, on their day page |
| Guest            | No                                                           | No                              | No                  | No                           |

Every change appears in "who changed what" as "Changed a commission rate for a treatment or product", "Changed commission steps by takings" or "Changed a monthly target", stamped with the person who made it.

## Server and records

- No migration. The three new record lists live in the studio record (`operations.commissionRates`, `commissionSteps`, `staffTargets`), checked on every load (`commissionProblem`): duplicate ids and records naming someone not on the team are refused.
- Commands: `commission-rate` and `commission-steps` use the existing owner-only `pay-rate` permission; `staff-target` is new, allowed for owners and managers only. Each command checks the person is on the team, the treatment or product exists and is not archived, there is a rate or steps in force to end, a stop has a target to stop, parts of a target are not more than the whole, and the limits on rates, steps and record counts.
- Projections: `withoutPayRates` (used for reception and general managers) removes all three lists, rent payments and the terms of each rental. Practitioners get only `target` (their own month) inside `PractitionerView`, through its strict schema.

## Tests

- `src/domain/commission.test.ts` (20): the most specific rate, step by step as each is ended; a product's own rate beside the usual rates on one receipt; refusals; steps paid marginally receipt by receipt; whole-month steps with the catch-up; each month afresh, and a shorter period counting the month's earlier days; an item rate winning and leaving its takings out of the steps; products in steps only when chosen; stopping steps; money given back with steps in force and after they stop; awkward amounts to the penny; owner-only rates and steps, and the words in who changed what; targets counted like pay, carried on, stopped, and refused for renters; reception's record; the ledger check; the payroll download; the sample studio; reading a percentage.
- `src/pages/PractitionerDay.test.tsx`: the target line is the only money a practitioner sees, and someone without a target sees none.
- `src/domain/help.test.ts`: the new articles are found by "tiered commission", "commission rate for one treatment", "monthly sales target" and "my target", and managers do not get the owner-only steps article.
- `server/pay.test.ts` (2 new): only the owner sets rates and steps (manager, reception and practitioner refused), managers set targets, reception and practitioners cannot; each change is in who changed what; reception's record has no rates, steps, targets, rent payments or rent terms; a practitioner reads only their own target and nothing of anyone else's.
- `server/projections.test.ts`, `server/branch.test.ts` and `server/regional.test.ts`: reception, general managers and regional managers receive none of it, and a general manager cannot set a target.

## Checks

- `npm run lint`, `npx tsc -b`, `npm run format:check` and `npm run build`: pass.
- Front-end suite: 142 files, 1,253 tests passed (from 140 files and 1,222 before Stage 3 pay).
- Server suite: 53 files, 406 passed and 2 skipped (from 404; the 2 skips are unchanged).

## Decisions

- **Steps per calendar month.** "Pay period" is the calendar month, as Pay already shows This month and Last month. A shorter range inside a month (such as the first six days) counts the month's earlier days towards the steps, so a person's step does not reset because someone looked at a week.
- **Most specific wins, and a rate of its own beats steps.** An owner who sets 45% for Lymphatic Massage means 45%, whatever the month's takings, so those takings stay out of the steps rather than pushing other treatments up a step.
- **One treatment is more specific than a kind of treatment**, whoever it is for, so "Lymphatic Massage for everyone" beats "Body treatments for Sophia". The order above is the one tested.
- **Rounding.** Half away from zero, per receipt per rate for fixed rates, and once per month for steps. Tested, documented in code and in the payroll download's parts.
- **Targets are on takings, not commission**, counted as pay counts them, so an owner sees the same figures in both places. Treatment and product targets are optional extras beside the total.
- **A practitioner's own target** is shown because the brief asks for it; their rates and earnings stay owner and manager information, as before.

## Quality bar

- **One main job and one primary button.** Each dialog has one primary ("Save the rate", "Save the steps", "Save the target"); ending, stopping, adding a step and Cancel are secondary or quiet. Pay's own actions stay secondary.
- **Rarely used options tucked away.** The full history of each kind of change sits behind "Every change, newest first", and each person's breakdown behind "Details". `MoreOptions` is not on this branch, so these are native `<details>` elements, styled quietly; they can move to `MoreOptions` when it arrives.
- **No card inside a card.** Breakdowns, rate rows and step rows use space and hairlines inside the existing panels and dialogs.
- **Photographs.** None added: Pay is a working surface.
- **Empty pages.** No new page. "No rates of their own yet. Everyone is on their usual rates." is a one-line empty state inside the dialog.
- **Loading.** `LoadingShapes` is not on this branch; nothing here loads on its own (it all comes with the studio record). Buttons say "Saving…" while a change is sent.
- **Motion.** `--motion-calm` is not on this branch, so no new motion was added.
- **390 px.** Step rows fold from three columns to two, with Remove on its own line; rate rows wrap; the owner's buttons wrap. Checked in a browser at 390 px (see below).
- **Words.** Plain British English, "treatment" and "visit", no dashes or exclamation marks; each error names what to do and keeps what was typed. Nothing says anyone has been paid: "SALEANE works it out; you pay people through your own payroll."
- **Built from the library.** `Button`, `Modal`, `Stat`, `Avatar`, `ErrorMessage` from `src/design`, existing tokens only, no left-edge stripes.
- **Before and after pictures** were taken at 1440 and 390 px in the browser pass and are on the Stage 3 before and after page: https://claude.ai/artifact/EX667DQpzruWeeZeTktMrE.

## Seen in a browser

Checked on 10 October 2026 in Chromium against the local server, signed up as a new owner with the sample studio (sample day Tuesday 6 October), at 1440 px and 390 px.

- Business, Pay, This month: Sophia's line reads "Treatments 35% to £3,000, then 40% · Products 10% · Lymphatic Massage 45% · Hydrating Serum 15%" with "Target £12,000 · £1,856 so far, 15% · products £76 of £600"; Maya's reads "Target £6,000 · £1,514 so far, 25%". Theo, renting, has no Target button.
- "Rates for treatments and products" lists Lymphatic Massage and Hydrating Serum for everyone at 45% and 15%, each "From Tuesday 1 September · set by Owner" with End, above the form to add a rate.
- "Steps by takings" and each person's "Target" open with their choices and fields; at 390 px each fills the screen and nothing scrolls sideways.
- Last month, Sophia, Details: "Treatments at 35% up to £3,000" £1,050.00, "Treatments at 40% above £3,000" £322.00 on £805.00, "Lymphatic Massage at 45%, its own rate" £3,402.00 on £7,560.00, "Products at 10%" £37.80 and "Hydrating Serum at 15%, its own rate" £28.80, making £4,840.60, worked out again by hand to the penny, with each visit listed under it.
- A manager sees each line, Details and Target, and no Rates, Rates for treatments and products or Steps by takings. Reception has no Pay tab and lands on Money. Maya's own page reads "Your target for October: £1,514 of £6,000 so far, 25%."

Found and fixed in this pass:

- The two ways steps can pay, and the tips choices already on main, drew each radio as a full-width circle above its words, because the form makes every input full width. Each is now a small radio beside its words.
- A finished month's target read "so far"; it now reads, for example, "£11,935, 99%".

## Limits and notes

- Rates for a kind of treatment use the three kinds the treatment form already offers (Skin, Body, Hair).
- Everyone's steps apply to anyone without steps of their own, whatever their usual rate; a person's own steps take the place of everyone's.
- At most 5 steps, 2,000 rates, 500 step changes and 2,000 target changes per studio.

## Steps for the lead in a browser

Sample studio (signed up as a new owner with the sample, at 1440 px and 390 px). The sample's day is 6 October 2026.

1. Business, then Pay, This month. Sophia's line reads "Treatments 35% to £3,000, then 40% · Products 10% · Lymphatic Massage 45% · Hydrating Serum 15%" with "Target £12,000 · £1,856 so far, 15% · products £76 of £600". Maya's reads "Target £6,000 · £1,514 so far, 25%".
2. Last month, Sophia, Details: "How commission was worked out" lists "Treatments at 35% up to £3,000" (£1,050.00), "Treatments at 40% above £3,000" (£322.00 on £805.00), "Lymphatic Massage at 45%, its own rate" (£3,402.00), products and the serum, and the total £4,840.60 equals her commission.
3. "Rates for treatments and products": add 50% for Maya on Skin Renewal Facial from today, save. Her line now names "Skin Renewal Facial 50%" and her facials earn 50% from today. End it from today and she is back on 40%. Open "Every change, newest first".
4. "Steps by takings": choose Maya, add 40% from the first sale and 45% from £1,000, switch between the two ways to pay and read the sentence under each, save. Her line changes; Details shows the step parts.
5. "Target" on Theo is missing (he rents his chair). "Target" on Maya: set £7,000 with £500 of products, save, then stop it from next month.
6. Download for payroll and open the file: the "How commission was worked out" column and the two target columns.
7. Sign in as a manager: Pay shows each person's line, breakdown and target, and the Target buttons, but no buttons for rates or steps (the server refuses them too); a target saves. As reception: no Pay tab. As Maya (practitioner): her day page shows "Your target for October: £1,514 of £6,000 so far, 25%." and no other money. As Theo: no target line.
8. Settings, Who changed what: each change above is listed with who made it.
9. 390 px: Pay, the three dialogs and the practitioner day page, with nothing scrolling sideways.
