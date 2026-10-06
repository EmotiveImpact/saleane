# SALEANE 0.2.1 verification

6 October 2026. Feature branch `feat/saleane-foundation`; local prototype evidence only.

## Scope

Source-context reconciliation, product/UX contracts, original-reference visual revision, generated imagery and appointment side-panel. The rejected studies remain archived. Read `PROJECT_CONTEXT.md` for source provenance and `THIRD_PARTY_NOTICES.md` for asset provenance.

## Application checks

- `npm run lint`: passed, zero warnings.
- `npm test`: 3 files, 41 tests passed. Covers domain rules, storage/recovery and component interaction. Existing checks include booking/resource conflicts, immutable snapshots, checkout/rebook integrity and focus handling.
- `npm run build`: application passed. The first combined build exposed a non-module study script warning; the final combined build is recorded below after correction.
- In-app browser visited Today, Calendar, Clients, Amelia's relationship, Business and Booking at actual CSS widths 320 and 1440. Each document width equalled the viewport width; each expected heading rendered; no completed image element had zero natural width.
- Browser zoom made requested width differ from effective width in the first check. The final matrix used measured `innerWidth`, not requested size. This distinction avoids claiming false overflow or wrong breakpoint evidence.
- Visually inspected Today and guest booking on desktop and phone. Corrected mobile third-metric padding/border and added a solid backing to the booking location label for photo contrast.
- Opened Amelia's arrived appointment, saw the 460px right-side panel, advanced to checkout and confirmed the £95 service minus £25 deposit = £70 due. The focused heading advanced to Checkout. Escape closed the dialog and returned focus to the named Amelia appointment trigger. This inspection did not record a payment in the user's preview state.

## Earlier side-panel journey evidence

The isolated visual-agent run verified one simulated £84.25 checkout with 15% tip, one origin-linked rebooking, focus trapping/restoration and 1440/390/320 layouts. The original images in `appointment-panel-*.png` show the pre-warm visual styling; they prove the panel interaction only. Revised visual screenshots are named separately.

## Limits

No new screen-reader certification, production authentication/tenant enforcement, provider payment/delivery, database concurrency, deployment or user usability trial is established. Generated full-size PNGs favour prototype review quality; responsive image encoding and performance budgets remain a production optimisation gate. No UXio connector was used.

## Final combined build

At 17:26 local time, `npm run format:check` and `npm run check` passed: zero lint warnings, 41/41 tests, TypeScript and Vite. Both `dist/index.html` and `dist/design-studies/index.html` were generated without the earlier script warning. The study script is a module and its fonts/portrait asset are bundled.

The built preview at `http://127.0.0.1:4173/today` was reloaded and inspected: the serif wordmark resolved to Bodoni Moda, the light sidebar computed to `rgb(242, 242, 236)`, and the studio image resolved to `/images/saleane-studio-warm.png`. This is local production-build evidence, not deployment.

## Revised study and screenshot evidence

The visual-agent browser pass covered 39 direction/screen/viewport combinations at 1440, 390 and 320px: zero page overflow, zero selected axe rule violations, no page errors and no failed local assets. The selected rule set is recorded in [the machine-readable report](../../design-studies/evidence/reference-browser-checks.json); this is not an all-rules accessibility audit. It exercised the study's simulated £84.25 checkout, 11:00 rebook selection, Escape focus restoration and mobile USD confirmation. Study interactions are illustrative; they do not establish app domain or provider behaviour.

The final built-app Today/booking captures also had no overflow and loaded the studio imagery:

- [Today desktop](reference-app-today-desktop.png) · [Today phone](reference-app-today-mobile.png)
- [Booking desktop](reference-app-booking-desktop.png) · [Booking phone](reference-app-booking-mobile.png)

Source-following study screenshots and the withdrawn earlier interpretation are linked from [VISUAL_DIRECTIONS](../VISUAL_DIRECTIONS.md).
