# SALEANE 0.2 verification ledger

Date: 6 October 2026. Scope: the connected fictional-data foundation. Local build and browser evidence do not establish production/provider readiness.

## Repository intake and preservation

- Base: `main` at `2fcfb4525b189563b553570defbc039d8b231729` (Initial commit).
- Intake contained only the README. No other branch, open PR or existing workflow run was found. A second remote check before preparing review found the same main commit and no open PR.
- Original README bytes are in `docs/archive/INITIAL_README.md`; original text remains the beginning of the expanded README. No existing file was deleted.
- Feature branch: `feat/saleane-foundation`. No automatic merge or deployment is configured.
- Repository was public at intake; visibility was changed to private and rechecked.
- Prior conversation context was read using the available conversation tool; it returned no further cursor. The v0.1 cloud pack/visual assets were referenced but not accessible/imported. See [provenance](../RESEARCH.md).

## Local checks

Environment: macOS, Node 22.12.0, npm 10.9.8. Dependency versions are fixed by the lockfile.

| Check                  | Evidence / scope                                                                                         |
| ---------------------- | -------------------------------------------------------------------------------------------------------- |
| `npm run lint`         | ESLint with zero warnings permitted                                                                      |
| `npm test`             | 41 passing tests across domain rules, storage/recovery and connected React interactions                  |
| `npm run build`        | Strict TypeScript and Vite production bundle; latest JS about 473 kB / 143 kB gzip; fonts served locally |
| `npm run format:check` | Consistent maintained source/document formatting; original README archive excluded to preserve bytes     |
| `git diff --check`     | No whitespace errors                                                                                     |

The final combined command output is preserved in `local-checks.log`. CI runs the same install/lint/test/build sequence. Hosted status must be checked on the actual pushed commit; this document does not infer hosted success from local results.

## Browser evidence

An isolated Chromium browser exercised development preview on port 5173 and the built bundle on port 4173. The visible review preview uses a separate browser state. Fictional test clients and notes were used; no provider request, email, SMS, real payment or real reservation was made.

| Journey                                                             | Observed result                                                                                                                                                     |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UK Today → Amelia → checkout → receipt → rebook → timeline → reload | Service 9,500p + tip 1,425p − recorded deposit 2,500p = checkout 8,425p. One sale and one explicit next-visit link. Note/receipt persisted.                         |
| UK phone guest booking → calendar                                   | New fictional client and online-source appointment; marketing off; two linked client events; next-day calendar displays the visit.                                  |
| US phone guest booking → calendar                                   | USD pricing and 12-hour times; guest appears in the same US operator schedule; marketing off.                                                                       |
| US checkout and reporting/export                                    | $125 service, $25 tip, $25 recorded deposit, $125 checkout balance. 28-day CSV exported with USD minor-unit values.                                                 |
| Market switching                                                    | UK note absent from US; US guest absent from UK; saved UK state retained; language restored to en-GB.                                                               |
| Keyboard dialog                                                     | 25 Tab presses remained in the booking dialog; Escape closed it and returned focus to New appointment. Search focuses its field immediately (also tested in React). |
| Mobile navigation                                                   | Focus-managed navigation dialog opens and selects Clients; hidden desktop rail is excluded from mobile focus.                                                       |
| Calendar/search/recovery                                            | Staff filter and agenda/grid controls; workspace client search; unreadable snapshot warning and preserved original bytes. See UK production receipt.                |

[Production journey receipt](production-journeys.json) records the US/market/keyboard results. `production-UK-journeys.json` records the final UK/control/recovery results. The UK phone booking was separately exercised at 390×844 through the rendered development application before the final production checks.

## Accessibility and layout

The six requested routes (`/today`, `/calendar`, `/clients`, `/clients/client-1`, `/business`, `/booking`) were checked at widths **1440, 390 and 320** against the production bundle with axe-core WCAG A/AA rule tags. Final recorded result: **18 route/viewport combinations, zero reported rule violations and document width equal to viewport width**. See [machine-readable audit](browser-audit.json).

The first pass found completed-calendar text contrast and turnaround-label contrast issues. Removing opacity and strengthening text colour resolved them; the affected desktop calendar was rechecked. A browser error also identified an HTML phone pattern incompatible with Chromium’s Unicode-set regex mode; it was corrected and the production booking form subsequently completed without console errors.

These are limited automated and manual keyboard checks. They do not certify WCAG conformance, full screen-reader usability, Safari/Firefox behaviour, real mobile hardware, provider readiness or production security.

## Screenshots and export

- [Today, desktop](today-desktop.png)
- [Calendar, desktop](calendar-desktop.png)
- [Client relationship, desktop](relationship-desktop.png)
- [Checkout, desktop](checkout-desktop.png)
- [Business, desktop](business-desktop.png)
- [Branded booking, desktop](booking-desktop.png)
- [Today, phone](today-mobile.png)
- [UK branded booking, phone](booking-mobile.png)
- [UK confirmation, phone](booking-confirmation-mobile.png)
- [US confirmation, phone](booking-US-mobile.png)
- [UK next-day calendar, phone](calendar-mobile.png)
- [Fictional US 28-day CSV export](report-demo-US.csv)

Screenshots intentionally capture different fictional states after journeys. They are visual evidence, not production screenshots. Desktop and primary layout captures use the production bundle; the UK confirmation/next-day phone captures use the development preview.

## Reproduce

1. `npm ci`, then `npm run check` and `npm run format:check`.
2. `npm run preview -- --port 4173 --strictPort` after a successful build.
3. Open a fresh browser at `http://127.0.0.1:4173/today`; the fixed demo day is 6 October 2026.
4. Follow the README journeys with fictional details; inspect client timeline, calendar and Business after each write. Test both demo markets.
5. Check desktop/mobile keyboard paths, Escape/focus return, chart data table, downloads and recovery. For an automated accessibility recheck, run installed axe-core against each route/viewport using an isolated Playwright CLI session.

## Remaining release gates

Authentication, tenant/role enforcement, server concurrency/UTC/DST scheduling, configured real business hours, provider payments/refunds/tax/receipts, message consent/delivery policy, backups/restore, real migrations, user testing and specialist regional acceptance remain V1 work. Inventory, commissions, inbox, model-backed intelligence and Clinical are future milestones. LocalStorage revision checks are sequential conflict detection, not atomic multi-tab transactions.
