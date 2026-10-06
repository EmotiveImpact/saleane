# SALEANE 1.0.0-rc.1 — local candidate verification

Date: 6 October 2026. Target: feature branch `feat/saleane-foundation`, private `EmotiveImpact/saleane`, review PR #1. No merge or deployment is part of this record. This release candidate implements local application authority; stable production V1 acceptance remains open.

## Automated checks

`npm run check` completed successfully:

- ESLint: zero warnings/errors.
- Frontend/domain/store: **123 tests in 7 files passed**.
- Node API/database/recovery: **33 tests in 3 files passed**.
- Strict TypeScript and Vite application + standalone host + backup-tool builds passed.
- Raw local output: [local-v1-checks.log](local-v1-checks.log).

The tests cover protected appointment snapshots, venue/DST and elapsed-time rules, schedule/closure and shared-room conflicts, manual tax/discount/deposit/refund rules, consent/drafts, bounded imports, session/tenant/role boundaries, CSRF/Origin/Host/body/rate guards, idempotency, stale revisions, late workspace responses, remembered-load races and durable unknown-save retries. Guest holds are checked against desk booking and moves, including exact-room allocation, catalogue changes, release, expiry and replay. Final review added guest confirmation recovery across uncertain saves, expiry and tab reload (exact submitted details replayed, edits/new time blocked until resolution), and static-host rejection of database paths/companions inside public roots, including symlink and missing-path cases. Recovery tests include live WAL data, refused overwrites, validation and credential/hold revocation on restore.

Warnings retained honestly: Node 22.22.3 labels its built-in SQLite API experimental; Vite reports future native-config-loader compatibility for extensionless TypeScript imports. The final main minified chunk is approximately 450 kB; management/account/guest pages and shared operations are split into separate chunks. These warnings do not fail the checks, but performance/native-loader qualification remains work before production.

## Browser evidence

Browser: Codex in-app Chromium. Synthetic review account/studio only. Existing browser-demo records were preserved. Core flow was first exercised against the combined Vite/API host, then the development process was stopped and the built Node application was exercised on the same **127.0.0.1:5173** address with the same persisted database.

Observed journeys:

1. Created an empty UK studio through Account. Today showed zero clients, visits and funds with a setup path.
2. Added an £85/60-minute treatment, a qualified professional and a treatment room through Manage. Saved explicit Tuesday evening opening hours in this fictional review studio to exercise current-day checkout.
3. Guest booking selected no preference and tomorrow's 09:00 slot, obtained a five-minute hold, accepted fictional contact details without marketing consent and confirmed. The UI explicitly showed no money collected/no email sent. The booking appeared in Calendar after reopening the server workspace.
4. Desk-booked a current-day 20:00 visit, welcomed the client and completed manual cash recording. The acknowledgement was required; reference was **QA ONLY - fictional receipt**. No real funds were taken or asserted outside this synthetic test. Receipt showed £85 and no provider contact.
5. Rebooked from that receipt for 3 November, 10:00. Business then showed £85 completed service revenue and 100% explicitly linked rebooking for the one completed visit.
6. Wrote an appointment-purpose draft, saved it and queued it. The resulting state read **Queued · unsent**, with explicit unconfigured delivery.
7. On the built server at measured 320px, imported a synthetic two-row CSV. Preview identified one new record and one exact duplicate, ignored a `marketingConsent` column, required review and imported one client. Its relationship timeline retained the source and marketing remained off. Existing client/visit/money records stayed intact.
8. At measured 320px, Inbox, import/success, client relationship and Manage rendered with document width equal to viewport width. Manage had no broken rendered images. Desktop Manage measured 1228px without document overflow; captured console error list was empty. Temporary viewport override was reset.

This is targeted browser evidence. It is not full keyboard/screen-reader, Safari/Firefox, US operator, all-breakpoint or WCAG certification. UK/US domain logic and fixture behavior have automated coverage; the newly created end-to-end studio in this browser pass was UK.

Archived screenshots:

- [Built Manage desktop](v1-manage-desktop.jpg)
- [Connected business figures](v1-local-business.jpg)
- [Inbox phone](v1-inbox-mobile.jpg)
- [Imported client phone](v1-relationship-mobile.jpg)

Screenshots show their actual scroll position. The business/Inbox captures are scrolled views, not evidence that the application heading/navigation is missing.

## Persistence and recovery drill

While the built server held the review database open, the built backup CLI successfully created a consistent backup, verified migration 1 and one workspace, and restored to a **fresh** separate path. Restore reported sessions revoked. The original running database was not replaced. These review-only files are excluded from Git. Automated recovery tests additionally check accounts/receipts preservation and invalidation of invitations/holds.

A listener inventory after the switch showed exactly one SALEANE host at 127.0.0.1:5173 (PID 98674 during the recovery drill; the final host was subsequently restarted for the reviewed fixes); port 4173 had no listener. No payment, email, database-hosting or deployment accounts were configured. No new package dependency was added.

Disk pressure interrupted initial writes. Only reproducible `dist` output and npm's registry download cache were cleared; installed dependencies, repositories, conversations and user records were preserved. The production output was rebuilt. Disk remained tight, so no browser installs, extra checkouts or duplicate servers were created.

## Remaining release gates

This is **1.0.0-rc.1 local**, not stable production 1.0. Remaining gates include qualified hosting/identity/recovery, practitioner-specific read projections, verified guest self-management, provider capture/refund/reconciliation, delivered communications, privacy/export/retention/erasure, broader accessibility/browser/performance qualification and supervised pilot acceptance. Inventory/retail, commissions, multi-location UI and advanced intelligence retain their later roadmap scope. Clinical remains separate.

The pushed commit and GitHub CI are recorded independently in the PR and final handoff; local checks do not imply remote CI or a deployment.
