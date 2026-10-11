# Paying for each person beyond five

**Status: built locally on 10 October 2026. Test mode only: no card is charged and no money moves.**

## What it does

The owner decided on 10 October 2026 that each location's £49 (or $59) includes 5 people who take bookings, and each person beyond that is £9 a month ($12 in the US), plus VAT or any sales tax. Anyone who gives no treatments, such as reception or a manager, is free; a manager who also gives treatments counts.

- `src/domain/pricing.ts`: `personMinor` (900 in the UK, 1200 in the US), `PEOPLE_PER_LOCATION` (5), `bookingPeople` (people not archived who give at least one treatment still offered) and `extraPeople` (pooled across the studio, so two locations include 10).
- `src/domain/billing.ts`: `monthBill` adds a line such as "1 more person taking bookings, beyond the 5 included". `peopleChange` words what saving a professional does to the bill.
- `server/billing.ts`: every bill counts the studio's people when it is made (renewal, the end of a trial, a new location's bill), so adding or archiving someone applies from the next bill. Nothing is charged part way through a month for a person. The billing view carries `people`.
- Settings, Plan and billing: a "People taking bookings" block. The price page: "Includes 5 people taking bookings. Each person beyond that is £9 a month, plus VAT." The new location's last step counts people too, so a new location's 5 can lower what the extra people cost.
- The team screen: the owner of a studio of their own is told before saving when a change moves the bill. Managers, who do not see the bill, and sample studios are not.

## Tests

- `src/domain/billing.test.ts`: the people line on a bill, pooling across locations, who counts (archived people, reception and people whose only treatment is retired do not), and `peopleChange` going up, going down, staying the same for reception, a second location or an unchanged edit, and in dollars in the US.
- `server/billing.test.ts`: a studio with 7 people is billed for 2 extra; archiving one makes the next bill 1 extra; the end of a trial bills £58 plus VAT (£69.60); a second location removes the line.
- `src/components/PlanBilling.test.tsx`, `src/pages/Pricing.test.tsx` and `src/components/LocationOpening.test.tsx` check the words on screen.
- `npm run check` and `npm run format:check` pass (1,175 tests in the app and 378 on the server, two skipped, as before).

## Browser journey

Walked in Chromium against the built server with a new studio of its own: one treatment, five professionals and one receptionist.

- Plan and billing said "5 people take bookings. Your location includes 5, so there is nothing more to pay."
- Adding a sixth professional showed no note until a treatment was ticked, then "Saving makes 6 people taking bookings, and your location includes 5, so the monthly bill goes up by £9, plus VAT, from the next bill."
- After saving, Plan and billing said "6 people take bookings. Your location includes 5, so 1 more is £9 a month, plus VAT." and the next bill read SALEANE, 1 location £49.00; 1 more person taking bookings, beyond the 5 included £9.00; VAT at 20% £11.60; total £69.60.
- Ticking "Archive" on her showed "Saving brings the people taking bookings to 5, so the monthly bill goes down by £9, plus VAT, from the next bill."
- The price page showed the people line (in dollars, as the browser was set to the US).
- axe (WCAG 2.2 AA) found nothing on Plan and billing, the team editor or the price page. No sideways scroll at 1440 px or 390 px, and no console errors.

## Not covered

- No real card service: SALEANE has no payment account, so the bill was made in test mode.
- Someone added part way through a month is not charged for the rest of that month; they count from the next bill. This is deliberate and simple, and could change if the owner wants it.
- Safari and Firefox were not checked.
