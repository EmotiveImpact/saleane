# V2 · Rota, holidays and time off: evidence

Recorded 7 October 2026 in Chromium (Playwright) against the built app (`npm run build && npm start`) with a fresh local database, in the browser demo studio (Atelier House, London). All names and dates are fictional.

## What was exercised

- **Business, Rota, this week:** each person's hours for Monday 5 to Sunday 11 October with their booked visits (Maya, Sophia and Theo each have four on Tuesday 6 October).
- **A clash:** time off for Maya on 6 and 7 October. The form named her four visits that day ("Tue, 6 Oct 09:30, Amelia with Maya Lewis" and three more) and would not save.
- **A holiday:** Maya 12 to 14 October, "Half term". The form said "3 working days away, counted against their holiday allowance". Saving showed "Maya Lewis is away from Monday 12 October to Wednesday 14 October. Nobody can book them those days." Next week showed those three days as Holiday, and her 2026 holiday went to 8 of 28 days booked, 20 left (5 days in August plus 3).
- **Time away** lists Theo's sick day on 30 September, Maya's holiday and Sophia's holiday from 19 to 23 October.
- Rota at 390px: the week scrolls sideways inside its own box; the page itself has no sideways scroll. No console errors on any of the above.
- The full sweep (`scripts/qualify.mjs`, now including Rota) reports 117 pages with zero violations and no sideways scroll; the only console errors are the expected 401s on the signed-out demo account page.

Screenshots: [this week](V2-ROTA-week.png), [clash](V2-ROTA-clash.png), [next week with the holiday](V2-ROTA-next.png), [Rota at 390px](V2-ROTA-390.png).

## Automated checks

`src/domain/timeOff.test.ts`: a person away is closed for booking those days, the time counts as unavailable, overlapping time off and a booking on a day away are refused; time off that would strand a booked visit is refused and the preview names the visit; cancelling keeps the record with who cancelled, frees the days and cannot happen twice; working days of holiday counted against the allowance, split across New Year, sickness not counted; only owners and managers can record time off and allowances, stretches are limited to 62 days and must end on or after they start; the ledger rejects time off for someone not on the team; the week view shows hours, visits and days away.

## Limits

- Time off is for whole days. A break or part day is still a closure in Settings.
- The rota comes from each person's usual weekly hours. Swapping a shift for one week, or adding an extra day, is not built.
- Team members cannot ask for time off themselves; an owner or manager records it.
- The holiday year runs January to December. Bank holidays are not added automatically.
- Safari and Firefox were not checked.
