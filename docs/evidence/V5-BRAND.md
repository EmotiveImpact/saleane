# V5 · Shared brand rules: evidence

Recorded 9 October 2026 in Chromium (Playwright) against the built app (`npm run build && npm start`) with a fresh local database. A sample studio (main location Marylebone) was given a second location, Islington, and its Skin Renewal Facial was priced at £190 there against £95 at home. All names are fictional. Nothing was deployed.

## What was exercised

- **Studio colours (owner):** under Settings, Colours & booking page, choosing Slate saved `{ first: #557089, second: #c27286 }` with the studio, and the app re-tinted at once.
- **The guest booking page:** opened in a separate browser with nothing saved in it, `/book/…` showed Slate. Before this stage the choice lived only in the browser that made it, so guests and other devices saw the house colours.
- **House rules (owner):** under Settings, Locations, "House rules for every location" was set to "Within 10% of the house price" with Skin Renewal Facial as a core treatment, and saved. "Not yet in line" then listed Skin Renewal Facial: "The price at Islington must stay within 10% of the house price under the house rules." The £190 price was left as it was.
- **Saving a treatment:** the facial's form says "House rules: prices stay within 10% of the house price. A core treatment, offered at every location." Saving it with £190 at Islington was refused with the same words; with £99.75 it saved.
- **Phone (390px):** no sideways scrolling.
- **Accessibility:** axe (WCAG 2.2 A/AA) finds nothing on the colours section, the house rules panel at either width, or the refused form. The only console error is the expected 422 from the refused save.

The full sweep (`scripts/qualify.mjs`) covers 165 pages with 0 axe violations; the only console errors are the three known 401s on the demo account page.

Screenshots: [house rules](V5-BRAND-rules.png), [a refused price](V5-BRAND-refused.png), [the guest booking page in Slate](V5-BRAND-guest.png), [on a phone](V5-BRAND-390.png).

## Automated checks

- `src/domain/brandRules.test.ts`: the prices a band allows; house rules record only what is chosen and only treatments on the menu; a price outside the band, a different price under "the same price everywhere", and a core treatment left off a menu are refused, while an archived treatment is not checked; treatments already out of line are listed and left unchanged until saved again; only the owner sets house rules, owners and managers set the colours, and a general manager is refused both.
- `server/brandRules.test.ts`: the colours are stored with the studio and sent with its public booking page, only listed colours are accepted, a manager may change them and the desk may not; a manager cannot set house rules, and once the owner has, a manager's save outside the band or dropping a core treatment is refused while one inside the band is saved.

## How it works

- Colours are `operations.look`, chosen from the same six first and five second colours as before. A choice an earlier version kept in one browser still shows there until the studio saves its own.
- House rules are `operations.houseRules`: `priceBandPercent` (0 to 50; 0 means the same price everywhere) and `coreServiceIds`. They are checked in the treatment command (`serviceRuleRefusal`) wherever it comes from, so no screen can get round them. Setting a rule never changes existing prices or menus.
- Treatments, messages, guest forms and the booking page were already one set for the whole business; these rules cover the two things each location can vary.

## Limits

- The colours on a guest's own visit page (the private link to move or cancel) still follow the house colours.
- A price band applies to every location alike; there is no separate band per location or per treatment.
- No migration: both settings live in the studio record.
