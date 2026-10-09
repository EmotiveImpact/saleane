# V5 · The whole business: evidence

Recorded 8 October 2026 in Chromium (Playwright) against the built app (`npm run build && npm start`) with a fresh local database and a sample studio given two more locations, Islington and Leeds. All names are fictional. Nothing was deployed.

## What was exercised

- **Business, all locations (owner):** "The whole business" sits above the usual figures whenever a studio has more than one location and "All locations" is chosen. It reads: "Across 3 locations, completed visits took £4,830 in the last 28 days, up 383% on the 28 days before." and "This month so far: £1,105 taken, with £1,100 more booked but not yet taken." Each location shows its last 28 days, the change on the 28 before (or "Nothing to compare"), how many completed visits were rebooked, this month's takings against its target, and what is booked but not yet taken.
- **Targets:** "Regions and targets" opens a window that only the owner sees. Targets of £12,000, £8,000 and £6,000 for October were saved together; each location then reads, for example, "£1,105 taken of £12,000 (9%)", and the summary adds "of a £26,000 target (4%)".
- **Regions:** "London" was added with Marylebone and Islington, then "North" with Leeds. While adding North, Islington's box was greyed out with "(in London)", because a location belongs to one region. The view then groups locations under London ("£4,830 · Up 383% · October £1,105 taken of £20,000") and North.
- **Phone (390px):** each location's figures wrap into two columns, with no sideways scrolling.
- **Accessibility:** axe (WCAG 2.2 A/AA) finds nothing on the view, the window, or the view after saving. No console errors.

Screenshots: [the view](V5-GROUP-view.png), [on a phone](V5-GROUP-390.png).

## Month-end estimate and the week in brief (9 October 2026)

Recorded in Chromium against the built app with a fresh sample studio given a second location, Islington.

- **Month-end estimate:** the summary adds "At the recent pace the month could end near £5,418. This is an estimate, not money taken." Each location shows "Month-end estimate: About £5,418" (Islington, with no history, "About £0"). The estimate is what is already taken this month, plus the larger of what is booked and the last 28 days' daily pace over the days left. With every location given a target it adds "on course for the target" or "short of the target". A regional manager's area page shows the same estimate for their locations.
- **The week in brief:** "Wed, 30 Sept to Tue, 6 Oct, against the week before." then "This week, completed visits took £1,200 from 13 visits, down 5% on the week before." and "No one new came this week." When one location's week is clearly ahead, a third line names it.
- **Phone (390px) and accessibility:** no sideways scrolling; axe finds nothing; no console errors.

Screenshots: [the estimate and week](V5-GROUP-forecast.png), [on a phone](V5-GROUP-forecast-390.png).

## Automated checks

`src/domain/group.test.ts` covers: each location's last 28 days against the 28 before, with the best and the weakest named; visits later this month counted as booked, never taken, and next month's left out; totals that add up; the plain-English summary; regions with their own totals, and a region's target only when every location in it has one; taking a target away; a location refused in a second region; region names unique regardless of case; unknown locations refused; removing a region; and only the owner able to set regions and targets; the month-end estimate (booked or pace, whichever is larger, rounded in words, and set against the target only when every location has one); and the week in brief (completed visits only, first-time clients, the best week named only when clearly ahead).

## Limits

- Figures come from completed visits' service takings, as on the rest of Business; products, tips and gift cards are not included.
- "Best" and "needs a look" compare growth on the previous 28 days, so a new location with nothing to compare is left out until it has history, and locations level with each other are never ranked. Targets are kept for every location for ten years of months.
- Managers see the view; only the owner sets regions and targets. Regional and general managers who see only their own locations, approvals passing up, branch checklists and the maps are later V5 stages.
- Targets are per location per calendar month. The month-end estimate is a simple pace, not a prediction: it does not allow for seasons, holidays or a location's opening days.
