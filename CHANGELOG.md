# Changelog

Released entries describe observed implementation. An explicitly in-progress entry records work awaiting verification, not a shipped capability. Product versions are separate from stored-state schema versions.

## 0.2.2 — 2026-10-06 · Appointment changes and calendar continuity

### Changed

- Added confirmed-appointment rescheduling through the existing side panel. Preserve appointment/client/origin IDs, booked duration, turnaround, price and deposit history; revalidate professional and room availability and append old/new allocation history. Conflicts must leave the original visit untouched.
- Added cancellation and operator-recorded missed visits with reasons and retained timeline history. Recorded deposits stay in the ledger for review; no refund, cancellation fee, new sale or message is simulated by these actions.
- Extended calendar date navigation, visibly identify the selected appointment and expose cancelled/missed history separately from active allocation. Terminal successors must not inflate rebooking reporting.
- Kept the appointment heading and close action visible while its body scrolls. Use native radio choices for reschedule times, retaining keyboard operation and return focus when the original appointment leaves the active agenda.
- Corrected the phone client-header grid so identity and actions remain readable, and removed the duplicate empty-day message on phones.
- Adapted inspected Caleane component behavior to SALEANE's existing serif, ivory and sage identity. This does not select a new visual direction.

### Verification and boundaries

**Status: locally verified.** Final `npm run check` passed with zero lint warnings, 72 tests across three files, TypeScript and the combined Vite application/studies build. Tests include the staff-filter move regression. In-app browser checks on an isolated localhost origin exercised UK rescheduling with keyboard radio arrows, cancellation/history and Escape focus fallback, phone missed-visit history, and the linked client timeline. All six routes were checked at measured 320px and 1440px widths with no document overflow or broken rendered images. See [0.2.2 verification](docs/evidence/VERIFICATION_0.2.2.md).

Screenshots were inspected inline. Browser capture crops fixed panels over scrolled underlying pages, so no accurate archived 0.2.2 panel-screenshot claim is made. This is targeted browser evidence, not full accessibility certification. CI on the pushed commit remains unverified here; main and deployment are unchanged.

The app remains a fictional browser-local prototype. Missed attendance is manually recorded against the fixed demo day; the current date guard does not establish that a same-day visit's scheduled time has passed. Production requires authoritative venue time, authenticated actor, policy and audit enforcement. Holds, real refunds/fees, notifications, production authentication and shared database authority remain outside this increment. No merge or deployment is implied.

## 0.2.1 — 2026-10-06 · Source context and original visual direction

### Changed

- Re-read the full visible original conversation, original PRD preview and generated visual board. Added a source/decision ledger and preserved the PRD transcription without claiming unavailable ZIP/workbook bytes were imported.
- Expanded the product contract to revision 0.3, Research v0.2, vision, roadmap and architecture. Added UX architecture with 38 screen contracts, connected journeys, exception states and future feature disposition. Historical pricing ideas remain hypotheses; competitor prices retain source/billing qualifications.
- After the user rejected the first new visual studies, archived them explicitly and rebuilt around the original image: widely tracked serif SALEANE, warm light navigation, quiet operational hierarchy, sage attention surfaces and forest-green actions.
- Added locally bundled Bodoni Moda with OFL notice, generated fictional studio photography and four seed-identity portraits. Branded booking now carries the studio imagery; dates, money and forms retain functional sans-serif text.
- Appointment → checkout → receipt uses a compact right-side panel on desktop and a full-height sheet on phones. Step headings receive focus; Escape restores the initiating control. Other dialogs remain centred.
- Added the revised three-direction study as a production build entry. Studies remain design experiments; the working application owns the connected domain behaviour.

### Verification and boundaries

Local lint, 41 tests and the application build passed. Browser checks covered all six routes at actual 320px and 1440px widths, with no page overflow or broken rendered image elements; visual review also covered mobile booking, appointment and checkout. Detailed evidence and subsequent study/build results are in [the revision verification record](docs/evidence/VERIFICATION_0.2.1.md).

The app remains a browser-local fictional prototype. Reschedule/cancellation, no-preference allocation, production database/authentication, real payments/messages, offline snapshots and Clinical remain specified or future work. The separate server-authority draft is preserved but unverified and not shipped here. No merge or deployment is part of this revision.

## 0.2.0 — 2026-10-06 · Connected foundation

### Added

- Vite + React + TypeScript application with a reproducible lockfile, strict types, lint, Vitest and CI checks.
- Custom Saleane visual tokens/components; locally bundled Manrope and Source Sans 3; Radix headless dialogs; responsive operator and guest layouts.
- Today operating brief, daily professional calendar and agenda, client directory/search/segments, linked relationship timeline and explicit referrals.
- Branded service/time/details/review booking journey feeding the same local calendar and relationships.
- Staff qualification and shared-resource conflict checks, including turnaround time; immutable booked service snapshots.
- Simulated deposit, arrival, checkout with optional tip, retry-safe receipt and linked rebooking commands.
- Business reporting derived from completed service sales; 7/28-day periods, exact chart-data table, tips separately and CSV export.
- Separate fictional UK/GBP and US/USD workspaces with locale/venue clock conventions; versioned browser persistence, preserved-byte recovery, export/reset and sequential stale-tab protection.
- Build-grade PRD, vision, roadmap, architecture, design system, source-backed research and verification ledger.

### Preserved / corrected

- Retained initial Git history and original README text; archived an exact README copy.
- Changed repository visibility from public to private to match the requested source-of-truth boundary.
- Retained canonical SALEANE spelling without an accent. Documented wordmark rationale and font licensing.

### Verification

The current check results, rendered journey evidence, screenshots and limitations are in [docs/evidence/VERIFICATION.md](docs/evidence/VERIFICATION.md). CI status must be checked on the pushed commit; local checks alone do not prove hosted or production acceptance.

### Boundaries

This is a fictional browser-local prototype. No production database/authentication, provider payment or messaging, AI model, clinical capability, inventory, commission/payroll, real tax/refund engine or deployment is included. Fixed demo date is 6 October 2026. The old cloud v0.1 ZIP and assets were referenced but not recovered/imported. Local revision checks are not atomic server concurrency.

## 0.1 — Historical cloud discovery (referenced; not a Git release)

The source conversation reported a research/document pack and clickable HTML prototype in temporary cloud storage. Available product decisions inform 0.2. No unseen files or historical test results are represented as imported or reverified.
