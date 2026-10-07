# Changelog

Released entries describe observed implementation. An explicitly in-progress entry records work awaiting verification, not a shipped capability. Product versions are separate from stored-state schema versions.

## In review · A full Settings page

**Status: draft pull request, not merged.** Layout and navigation only; studio records save exactly as before.

- Settings is now a page in the main menu instead of a small pop-up. Sections sit down the side: Your preferences, Studio details, Colours & booking page, Services, Team, Spaces & equipment, Hours & closures, Data & privacy and This workspace.
- "Manage studio" under Business has moved into Settings; old links to it open Settings. Reception, who could not see Business, now land on Settings.
- Your preferences holds the Inbox layout: "Two columns, like email" (the default) or "List with a side panel", chosen per person and kept in this browser. The switch on the Inbox page is gone.
- The studio card, your name in the top bar, "About this version" and "Open recovery controls" each open the matching Settings section. The address names the section, so a link can open it directly.

## 2026-10-07 · Merged · The new look: fonts, studio colours and a Clients directory for hundreds

**Status: merged into main on 7 October 2026 with the design tightening pass below; not deployed.** Look and wording only; bookings, money and messages behave as before.

- New type: Figtree for all working text (360 body, 460 menu, 560 emphasis) and a light serif for headings and names. Financier Display Light is the chosen heading font, but its licence is not bought, so the committed code uses the free Newsreader at 300, then Georgia. Bodoni Moda, Source Sans 3 and Manrope are removed.
- A warm off-white ground, a warm sidebar, white cards with 20px corners, pill buttons and a sticky, translucent top bar. No dark panels: the Business insight card is now light.
- Studio colours: owners and managers pick a first and second colour in workspace settings (six and five presets, sage and soft rose by default). Buttons, selection, focus, the now line, counts and tags follow them. Every preset keeps white button text and coloured text at WCAG AA. **The choice is saved in this browser only** until studio settings are stored on the server.
- Today opens with a greeting card ("Good morning, …", how many guests are in today and who is in the studio now) beside a light studio photograph. Completed visits fade and a rose line marks the current time in the agenda.
- Clients is a directory built for hundreds: counts for All, Ready to return, New this month, Booked this week and Email marketing on; search by name, phone or email (a UK number typed with its leading 0 still matches); sort by most recent visit, name, visits or spend; 25 per page with "Showing 1 to 25 of N". Checked with 412 fictional clients brought in through Import clients. The query is shaped so the server can answer it page by page once clients live in Postgres.
- A client's page opens with their portrait, "Client since …, usually every N weeks", their next visit (or "Book next visit"), four figures, and a year of visits as dots.
- The Inbox menu item shows a rose count of drafts waiting for approval.
- The Inbox opens in two columns, like email: the queue on the left (All, To approve, Queued, Not sent, and search) and the chosen message on the right, with that client's earlier queued messages above it and the draft in a dashed outline with "Approve and queue" and "Edit". A View switch offers "List with side panel" instead, and each person's choice is remembered in this browser. On a phone the list comes first, then the message with an "All messages" link back. Nothing is labelled sent: queued messages read "Queued, not sent", because texting and email are not connected.
- Lighter, sunlit photographs in JPEG (242 KB and 48 KB) replace the larger PNG on the workspace, sign-in and booking pages.
- The design library page now resolves colours mixed with `color-mix()` before measuring contrast, and lists the studio colours.
- Tests: four new directory tests (paging 412 clients, search, agreement with Today's "ready to return", sorting). One Inbox test covers the remembered view.

## 2026-10-07 · Merged · Design tightening pass and faster flows

**Status: merged into main on 7 October 2026; not deployed.** Look and wording only; bookings, money and messages behave as before.

- Fixed the Money and Inbox section switches, which had lost their styling in the design library pass and showed as plain grey buttons.
- Money receipts are grouped by day with a day total and slim rows, five days at a time with "Show earlier receipts". Internal record codes are no longer shown.
- A client's past visits fold to one line (date, service, person, amount) and open to show what happened. Today's and upcoming visits stay open.
- On phones, the figures at the top of Today, Clients, Business, Money and Inbox sit in one slim strip.
- Slimmer rows on Today, the calendar list and Clients. Every detail is kept: where a column is hidden on a smaller screen, the professional, status, spend and next visit now appear under the name. The whole client row opens the client, and "Ready to return" shows as a label.
- Panel and section titles all use the editorial serif.
- One "Find a client" field in the top bar instead of two controls.
- Plain studio language for services that are not connected yet, the bot check setting and held-back messages.
- The sign-in welcome sits on a softer wash so it reads clearly over the photograph.

Second pass, for speed at the desk and for guests (same draft). Bookings still pass the same availability checks; nothing is sent or charged.

- Click any free space on the calendar to book there, with the professional, day and nearest time that fits already chosen. On phones the free times in each person's column do the same.
- A "now" line marks the current time on today's calendar.
- Drag an upcoming visit to another time or professional on the computer calendar. It opens the move step with the new spot chosen, so the usual checks and the Save button still decide.
- A week view shows seven days side by side; choosing a day opens it.
- The booking form finds a client by typing a name, email or phone. Once chosen, their "Good to remember" note and last visit appear. Services show their length and price.
- Rebooking after checkout offers "In 4, 6 or 8 weeks", led by the client's usual gap between visits when there is one, and keeps their usual time when it is free.
- Times are grouped into morning, afternoon and evening everywhere times are chosen.
- The demo booking page shows the next fortnight with how many times each day has, and a "Next available" shortcut when a day is full. The live booking page offers "Try" the next day when a day is full.
- Checkout reads in order: service, deposit, discount, tip, payment, total. A custom tip sits behind "Other".
- Search is titled "Search clients", matches phone numbers and shows each person's next visit.

## 2026-10-07 · Merged · Competitive position in the plan

**Status: documentation only; no product behaviour changes.**

- Roadmap gains a Competitive position section from the Mindbody comparison: memberships and packages lead V1.5, a narrow consented missed-call text-back joins V1.5 ahead of the V4 concierge, no marketplace stays a firm rule, and booking from Google search or Instagram is listed as an idea to validate.
- The same section records the one-line promise, the four moments (before, during, checkout, after), the cancellation-to-filled-slot workflow, focused navigation and the pilot test of less effort, fewer mistakes and better continuity.
- Vision states the no-marketplace rule plainly and adds a short "Where SALEANE competes" section.

## 2026-10-06 · Merged · LOCAL-05 qualification pass

**Status: merged into main on 6 October 2026; not deployed.** Chromium only; Safari, Firefox and screen readers are still to be run.

- Visit rows, calendar visits and demo booking services now take their spoken name from their visible text, so voice control matches what is on screen (WCAG 2.5.3). "Find a client" and the operator button keep their names on phones. The measure popover is named, notices sit in labelled sections and the sign-in page has one `h1`.
- Record validation no longer scans whole lists for every link. At 5,074 visits a read fell from 322 ms to 105 ms (p95) and a booking from 966 ms to 297 ms; a 30,074-visit studio now completes (read 568 ms, booking 1.7 s).
- `scripts/qualify.mjs` repeats the accessibility, reflow and keyboard sweep; `server/measure.test.ts` (with `MEASURE=1`) repeats the load and restore measurements. See `docs/evidence/LOCAL-05.md`.

## 2026-10-06 · Merged · Read-only offline day sheet (OFF-01)

**Status: merged into main on 6 October 2026; not deployed.**

- New `GET /api/workspaces/:id/day-sheet`, built by `src/domain/daySheet.ts`. Desk and management roles get today's studio visits with time, service, professional, room, status, client name and phone. A practitioner gets only their own visits and no phone numbers. No email, money, notes, exports or marketing lists. The sheet shows when it was synced and expires at closing time (at most 12 hours).
- The sheet is kept for the current tab only (session storage), and cleared on sign-out, studio change, expiry and changed access.
- When SALEANE cannot be reached, the saved sheet replaces the workspace with a clear offline notice and every change is paused. Reconnecting checks the session and role and replaces the sheet before changes resume.
- `/day-sheet` is a printable paper fallback, linked from Today and the practitioner day. The browser demo builds the sheet locally and offers a preview of the offline view.
- Not enabled, pending a threat review: keeping the sheet beyond the tab, a service worker and a device policy. Offline revocation is not instantaneous.

## 2026-10-06 · Merged · LOCAL-04 schedule administration continuity

**Status: merged into main on 6 October 2026; not deployed.** No schema migration: the history lives in the studio record as an optional, bounded list, so older records load unchanged. Live services stay unconfigured.

- A change to opening hours, a professional's own hours, time away (including a break for one professional), or archiving a professional or room is refused while it would strand an upcoming visit. The refusal now names each visit (date, time, client first name and professional) and why it no longer fits, instead of a generic conflict. Visits are never moved or cancelled for you.
- Manage shows the same check before saving: "These N upcoming visits would be affected", each linked to that visit in the calendar, and holds the save until they are moved or cancelled. Visits that already did not fit before the change, past days and visits already finished today do not block it.
- New Schedule history in Manage, Hours & closures: who changed what and when, in plain words, with the structured before and after kept in the record (latest 500 changes). A refused or stale (409) save records nothing.
- Professionals can have their own working hours in the team editor, or follow the venue's hours. Booked duration, turnaround, price and deposit stay with each visit when the service or hours change.
- Verified with lint, format check, strict TypeScript, builds and 233 tests (169 frontend/domain/store, 64 server), plus a Chromium pass on the built server. See `docs/evidence/LOCAL-04.md`.

## 2026-10-06 · Merged · Privacy and data lifecycle (LOCAL-03)

**Status: merged into main on 6 October 2026; not deployed.** No schema migration. Scope, roles and retention are defaults awaiting the owner's decision with an adviser.

- Owners and managers can preview, then download, a copy of one client's data (JSON plus a readable summary) from the client page. It holds their profile, consent, visits, receipts, payments, refunds, timeline and unsent messages with their real status; other clients appear only as a connection type, and credentials, sessions, invitations, holds, internal ids and the audit log stay out. Reception and practitioners get 403 from the server.
- The owner can preview and download a whole-studio export in Manage studio → Data & privacy, with team names, emails and roles but no password hashes, tokens, holds or other studios.
- Each download and each erasure request is written to the audit log by action and record id only, and listed as the privacy record.
- An erasure review shows what a decided policy could remove and what must be kept, with reasons. Recording a request deletes nothing. Email marketing can be withdrawn through the existing consent command.
- Added a proposed retention register in [PRIVACY.md](docs/PRIVACY.md). Evidence: [LOCAL-03](docs/evidence/LOCAL-03.md).

## In review · LOCAL-02 guest manage and cancel

**Status: merged into main on 7 October 2026; not deployed.** Schema migration 3 adds `guest_links`. Live services stay unconfigured; nothing is emailed or refunded automatically.

- A confirmed online booking returns a private link (`/manage#…`) shown on the confirmation page, labelled as not sent. The desk can create a new link for any upcoming visit from the appointment panel, which stops every earlier link, or stop all links.
- A link is a random token stored only as a hash, scoped to one visit in one studio. It expires 120 days after issue or seven days after the visit starts, whichever is sooner, and every failure returns the same message. The token lives in the address fragment, so it is not sent in server requests' paths or Referer headers. Restoring a backup revokes all links.
- The guest sees the treatment, time, professional's first name, status and any deposit recorded. No contact details, notes or other visits.
- The guest can cancel while the visit is still upcoming. The user chose a 24-hour cutoff: cancelling earlier flags a paid deposit for refund, later keeps it. The guest sees which applies before confirming, and the server refuses if the terms changed in between. No refund payment is created; the studio records any refund in Money. The cancellation event says who cancelled and what happened to the deposit.
- A replayed booking confirmation issues a fresh link and stops the earlier one. Rescheduling by the desk shows the new time on the same link.
- Verified with lint, format check, strict TypeScript, builds and 218 tests (153 frontend/domain/store, 65 server, after merging the design pass), plus a Chromium journey. See `docs/evidence/LOCAL-02.md`.

## 2026-10-06 · Merged · Editable "Good to remember"

**Status: merged into main on 6 October 2026; not deployed.**

- Owners, managers and reception can edit a client's "Good to remember" preferences in place on the client page, through the existing `client-edit` command, which records a "Client details updated" event. Practitioners still read preferences but cannot change them. Previously no screen could set preferences, so real studios always showed the empty state, and its wording pointed at the note form, which never changed this panel.

## 2026-10-06 · Merged · Design language library and design pass

**Status: merged into main on 6 October 2026; not deployed.**

- Added the SALEANE design language library: tokens in `src/design/tokens.css` (palette, semantic colour, type scale with a 12px floor, spacing, shape, elevation), components exported from `src/design/`, a living library page at `/design-language` that reads tokens and checks contrast live, and [DESIGN_LANGUAGE.md](docs/DESIGN_LANGUAGE.md).
- Brought in unstyled Radix Tabs, Toggle Group and Popover alongside Dialog. Manage sections are now tabs; reporting period, client segments, timeline filters and calendar view use one segmented control; metric definitions open in a popover.
- Working screens (Calendar, Clients, Inbox, Business, Money, Manage) use a compact serif header; Today keeps the editorial greeting.
- Raised all workspace text to at least 12px (statuses and turnaround labels were 9px) and fixed the measured contrast failures: completed status on tinted cards and upcoming booking steps.
- Today and Business now show one measure, "Time booked", with a shared definition and the period stated; Business also shows today's figure.
- The client timeline shows each visit once, ordered by when it happens, with its booking, arrival, checkout and money inside.
- On phones the calendar shows a swipeable column per professional with free time written between visits.
- Removed the coloured stripes on the left edge of calendar visits, phone calendar visits, errors, deposit reviews, preference notes, timeline money rows and visit steps. Tone now comes from the surface colour alone, and a test fails if a left-edge stripe is added again.

## 2026-10-06 · Merged · Public booking hold protection

**Status: merged into main on 6 October 2026; not deployed.** Schema migration 2 adds a `visitor` column to `booking_holds`. Live services stay unconfigured.

- Holds still lapse after five minutes. One visitor now keeps at most two unbooked holds per studio: a new hold replaces their oldest, and the booking page hands back its previous hold when a guest picks again.
- Hold creation has its own limits per address (six a minute, thirty an hour) on top of the existing public write limit.
- A studio-wide cap (the larger of 8 or three per active professional) stops many addresses together from holding the whole calendar. Booked and expired holds free their place.
- Optional Cloudflare Turnstile bot check, off by default, switched on in Manage under business details. It needs `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` on the server; without them the setting is refused. Tokens are verified server side before any write and fail closed if Cloudflare cannot be reached.
- Verified with lint, format check, strict TypeScript, builds and 198 tests (138 frontend/domain/store, 60 server), plus a Chromium pass on the built server. See `docs/evidence/HOLD-PROTECTION.md`.

## 2026-10-06 · Merged · LOCAL-01 assigned-practitioner access

**Status: merged into main on 6 October 2026; not deployed.** No schema migration (the membership and invitation tables already carried `staff_id`); live services stay unconfigured.

- A practitioner invitation must name one active professional, and no two team members can work as the same professional. The owner chooses the professional when inviting or changing someone's role in Manage.
- A practitioner's workspace read returns a separate practitioner record from `server/projections.ts`, never the studio record: their own visits from two weeks back to four weeks ahead (service, room, time, status) and, for clients in those visits only, a name, preferences and the latest 20 relationship notes. No email, phone, consent, prices, deposits, receipts, payments, other professionals' diaries, catalogue or settings.
- Practitioners may only welcome a client to their own visit and add a note for a client they serve. The server checks this after the role permission and before the request receipt, so a reused key cannot widen scope. Team, audit, invitations and message sending stay refused.
- Role changes and removal take effect on the next request, including replayed receipts.
- Practitioners sign in to a new "Your day" screen at `/practice/:studio` with its own retry journal. The studio workspace refuses a practitioner record rather than filling gaps.
- Verified with lint, format check, strict TypeScript, builds and 182 tests (137 frontend/domain/store, 45 server), plus a Chromium journey: invitation, sign-up, own day, welcome, note, owner sees the note, desktop and 390px. See `docs/evidence/LOCAL-01.md`.

## 2026-10-06 · Merged · Server groundwork for practitioner access

**Status: merged into main on 6 October 2026; not deployed.** No API contract, schema or behaviour change.

- `server/app.ts` (about 1,050 lines) is split into request checks and dispatch (`app.ts`), shared authority helpers (`context.ts`), HTTP utilities (`http.ts`) and three route modules (`routes/auth.ts`, `routes/workspace.ts`, `routes/public.ts`). The moved code is otherwise unchanged.
- `database.ts` runs numbered, forward-only migrations. Each step commits with its version record, a failed step rolls back to the last good version, and a database written by an unknown version is refused. Backup validation follows the same version list.
- `projections.ts` is the single place a signed-in workspace record leaves the server, for both workspace reads and command responses. Practitioners are still refused; LOCAL-01 adds their assigned-visit view there.
- Verified with lint, format check, strict TypeScript, builds and 172 tests (133 frontend/domain/store, 39 server including new migration and projection tests).

## 2026-10-06 · Merged · Version 1 hardening

**Status: merged into main on 6 October 2026; not deployed.** Small fixes from the version 1 codebase review; no visual redesign, schema change or live service.

- One checkout calculation (`src/domain/money.ts`) now produces both the checkout preview and the recorded receipt, so the two cannot drift.
- Typed amounts convert to minor units by string parsing. More than two decimals is rejected with a clear message instead of being rounded silently. Tip presets now stay selected for prices whose percentage has a part penny (for example 15% of £85.50).
- Short money display keeps two decimals when an amount has pence or cents (£85.50, not £85.5).
- A committed remote save is shown as saved even if clearing its retry key from tab storage fails.
- Availability reuses one time-zone formatter per zone. A no-preference availability check on the demo studio fell from about 62 ms to about 8.5 ms in a local measurement.
- Malformed percent-encoding in an API path returns 400 rather than a generic 500.
- CI now runs `npm run format:check`, matching the project rules.
- Verified with lint, format check, 166 tests (133 frontend/domain/store, 33 server) and builds, plus Chromium runs of demo checkout (tip presets, three-decimal rejection, receipt) and a Manage service price edit.

## 2026-10-06 · Consolidation and AI handoff

- Added `CLAUDE.md`, a detailed continuation handoff and an ordered RC2 → RC3 → provider qualification → pilot → stable 1.0 roadmap with acceptance criteria. Live services remain unconfigured.
- Reconciled the superseded server draft through a history-only merge preserving the verified Node/SQLite tree; retained the experimental branch for reference.
- Fixed browser-demo reset revision reuse reported in PR review. Reset advances beyond the persisted/current revision; two regression tests cover stale-tab rejection after a reset plus write, and explicit recovery of unreadable demo data.
- The user authorised consolidation into main. This entry is not a deployment or stable 1.0 claim; see the consolidation evidence for check results.

## 1.0.0-rc.1 — 2026-10-06 · Local operating application

**Status: local release candidate, not stable production 1.0.** The user selected local-first development with live services unconfigured. Existing browser demos, records, history and the original visual direction remain preserved.

### Added and connected

- Local accounts, studios, owner/manager/reception memberships, manual invitation links, sessions, password change and tenant-scoped SQLite authority. Practitioner logins are rejected until scoped projections exist.
- One combined UI/API host; asynchronous commands, revision conflicts, scoped idempotency receipts, durable privacy-preserving retry keys, attributed audit and workspace-transition guards.
- Manage surfaces for identity, services, qualification, rooms/chairs, weekly opening hours, closures and explicit tax configuration. Local venue clocks, 15-minute suggestions, DST/elapsed-time guards and no-preference allocation.
- Public studio booking with limited catalogue responses, temporary exact-room reservations, release/expiry and atomic confirmation shared with desk availability.
- Manual cash/external-card checkout, discounts/tax, deposits, receipts and externally completed refund recording with explicit acknowledgement/reference. No processor success is fabricated.
- Editable purpose-aware drafts and local unsent queue; bounded client CSV validation/preview/import with source, duplicate handling and no inferred consent.
- Consistent backup/verification and fresh-path restore with session/invitation/hold revocation. Original browser demo remains available alongside the local account workspace.
- Original ivory/sage/serif photographic system extended into accounts, Manage, Money and Inbox; route splitting and dynamic studio/operator identity. Product contract revision 0.4 and local V1 domain/runbook/evidence documentation.

### Verification and boundaries

156 tests passed (123 frontend/domain/store, 33 server/recovery), with lint, strict TypeScript and application/server/tool builds. Browser verification exercised fresh setup, guest/desk booking, arrival, explicit fictional manual checkout, receipt-linked rebooking, derived reporting, unsent drafts and reviewed CSV import; targeted 320px and desktop checks passed. A built-CLI backup/verify/restore drill passed while preserving the active source database. See [candidate evidence](docs/evidence/VERIFICATION_1.0.0-rc.1.md).

Live services, production data, provider reconciliation, assigned-practitioner projections, verified guest management, comprehensive privacy/accessibility and pilot acceptance remain unqualified. Node SQLite experimental and Vite config-loader advisories are recorded. No merge, deployment, message or real payment occurred. Remote CI is a separate review gate.

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
