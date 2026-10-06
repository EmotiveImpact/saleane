# SALEANE — AI continuation handoff

Prepared 6 October 2026 for transfer to Claude. Read the repository before rebuilding anything. The user requested the roadmap, consolidation of all branches and a clear handoff. They explicitly chose **local first; live services unconfigured**.

## Read in this order

1. This file and [ROADMAP.md](ROADMAP.md): ordered next work and release gates.
2. [PROJECT_CONTEXT.md](PROJECT_CONTEXT.md), [VISION.md](VISION.md), [PRD.md](PRD.md) (revision 0.4) and [V1_LOCAL_CONTRACT.md](V1_LOCAL_CONTRACT.md).
3. [ARCHITECTURE.md](ARCHITECTURE.md), [server runbook](../server/README.md), [UX_ARCHITECTURE.md](UX_ARCHITECTURE.md), [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md).
4. [Candidate evidence](evidence/VERIFICATION_1.0.0-rc.1.md), [RESEARCH.md](RESEARCH.md) and [CHANGELOG.md](../CHANGELOG.md).

## Repository and consolidation

Private GitHub: https://github.com/EmotiveImpact/saleane; foundation review: https://github.com/EmotiveImpact/saleane/pull/1. Local checkout: `outputs/Saleane` within the Codex conversation directory. Inspect current Git status and remote main; do not assume a stale branch is the latest authority.

Implementation baseline `09dc3bd` is the local V1 candidate. The handoff increment fixes the review finding about browser reset revision reuse and adds regression coverage. The old server draft `f73d084` on `wip/saleane-server-authority` is preserved through an explicit **history-only merge**, keeping the current implementation tree. That draft used Fastify/PGlite/Postgres and broad state endpoints. The current Node/SQLite implementation supersedes its account, workspace and command ambitions with tested local boundaries. Do not cherry-pick its package lock or replace the current server. Preserving history does not mean claiming every abandoned implementation ships.

The requested GitHub merge consolidates this into main; verify the actual merge/check status in GitHub. No deployment is part of this handoff. Keep both historical branches unless the user requests cleanup.

## What actually works

Version **1.0.0-rc.1** connects Today → Calendar → Client → Appointment → manual Checkout → Rebook → Business intelligence. There are two modes: the preserved fictional browser demo with a fixed 6 October 2026 date, and authenticated local studios with current venue time and SQLite authority.

Local accounts, tenant memberships (owner/manager/reception), manual invitations, services/qualified professionals/resources, hours/closures/tax setup, public availability with exact-room holds, appointment lifecycle, client timeline, manual receipts/deposits/refunds, unsent drafts, bounded CSV imports and backup/restore are implemented. Empty UK/GBP and US/USD studios can be created through `/account`. Professional catalogue entries do not confer login access. Practitioner invitations/logins deliberately remain disabled.

There is no hosted service, processor capture/refund, sent email/SMS, production identity qualification, verified guest self-management, comprehensive privacy programme or real studio pilot. V2 stock command seams are not retail UI. Stable 1.0 requires the roadmap’s release gates, not a cosmetic version change.

## Code map

- `src/domain/model.ts`, `operations.ts`, `workspace.ts`: durable state, operating configuration and workspace creation.
- `src/domain/commands.ts`, `operatingCommands.ts`, `commandSchema.ts`: validated operations; `selectors.ts`: derived reporting.
- `src/state/StoreProvider.tsx`, `api.ts`, `storage.ts`: async authority, workspace transitions, recovery and preserved browser persistence.
- `src/pages/`, `src/components/`: route and shared interface; inspect actual exports before editing.
- `server/app.ts`, `auth.ts`, `database.ts`, `workspace.ts`: API, sessions, permissions, transactional persistence and migrations.
- `server/index.ts`: same-origin built UI/API host; `backup.ts`: consistent snapshot/verification/fresh-path restore.
- Tests sit beside domain, state and server implementation; `docs/evidence/` records observed browser and recovery work.

## Invariants that must survive

- Validate membership, command permissions, expected revision and scoped request keys server-side, in transactions. Never accept client role claims or use UI hiding as access control.
- Existing whole-studio BusinessState reads are unsuitable for practitioner access. LOCAL-01 needs a minimal read contract and adapted client surface, not frontend filtering or fabricated empty required collections.
- Keep immutable booked service/price/duration/buffer terms, original appointment/client IDs, exact held rooms and linked history. Public holds and desk bookings share availability. Check venue civil time, elapsed duration and DST.
- Operator uncertain requests retain SHA-256-scoped fingerprint → request UUID mappings in tab session storage (200 limit), without command payloads. Storage failure/corruption blocks writes. Reload must not mint a new key for an uncertain operation.
- Guest confirmation retains its exact submitted contact/consent and hold snapshot in tab storage until a definitive outcome. Unknown results remain protected even after hold expiry; do not enable a second booking/edit while recovery is unresolved. Closing the tab is a documented recovery boundary.
- A late async response must not replace a different studio. Revision conflicts load current records without silently resubmitting the initiating draft.
- Browser demo reset must advance persisted revision rather than returning to zero. It is still browser-local storage, not a multi-user transactional authority.
- Money is in minor units with provenance and immutable receipts. Manual payment/refund records explicitly acknowledge already-performed external activity. Cancelled visits retain deposit history; no fabricated fee/refund.
- Imports are bounded and reviewed, source-attributed, never infer marketing consent and never auto-merge identities on email. Queued communications remain unsent.
- Backup is consistent with WAL; restore uses a fresh path and revokes sessions/invitations/holds. Keep databases and sidecars outside static roots and Git.

## Local operating instructions

Use Node 22.13+ (22.22.3 verified), npm and the existing lockfile. Dependencies are already installed in this checkout; avoid needless installation, copies or new worktrees because local disk has been very tight. Check free space first if generating large outputs. Never delete user data to make room.

Check for the existing process on 127.0.0.1:5173 before starting anything. Keep exactly one server. `npm run dev` provides development UI/API; `npm run check` runs lint, frontend/server tests and builds; `npm start` serves the built UI/API after stopping any development server. Static `npm run preview` does not provide the API. Use `/account` for local accounts and `/book/:slug` for guest booking. Do not commit account passwords or local session data.

Default private database: `.saleane-data/saleane.sqlite` (ignored). `work/` contains disposable verification material; inspect before deleting. `node_modules`, `dist`, `server-dist`, databases and `.env` must remain untracked. Follow the server runbook for `npm run db:backup` commands rather than copying a live database file.

## Evidence and its limits

Baseline `09dc3bd` passed 156 tests (123 frontend/domain/store, 33 server/recovery), lint, strict TypeScript, application/server/backup builds, and remote CI. Targeted Chromium journeys covered empty studio setup, guest reservation, desk arrival, fictional £85 cash checkout, rebooking, reporting, unsent drafts and reviewed CSV import. Desktop and 320px surfaces were sampled; a built backup/verify/restore drill passed. Screenshots and logs are in `docs/evidence/`. The consolidation adds two regression tests for reset revision safety; final check evidence is recorded separately.

This is not full accessibility certification, Safari/Firefox acceptance, load testing, provider certification or production evidence. Node SQLite emits an experimental warning; Vite has a future native-config-loader advisory. Do not relabel these as tested away.

## Product and visual constraints

SALEANE is the operating system for modern beauty, spa and wellness businesses, targeting UK and USA. The relationship graph, calendar/resources, money, inventory, communications, staff and intelligence share one durable domain. Clinical is a deliberate later boundary. Research → PRD and screen architecture → visual system → operating prototype → qualified build remains the governing process; research and design may overlap.

The user rejected generic visual directions. Preserve the original light sidebar, weighted serif, warm ivory/sage palette and photographic direction documented in the design files. Generated studio images are fictional. Caleane was an interaction/style reference, not a replacement identity. No UXio connector was used. The original conversation’s readable context and PRD preview were recovered; original ZIP/workbook/image bytes remain unavailable. Do not claim to have imported them.

## First continuation task

Implement **LOCAL-01** from the roadmap: define assigned-practitioner read/command scope, then server projections, then the corresponding UI. Prove denial of other practitioners’ clients/visits, other tenants, finance/export access and revoked memberships through direct API tests as well as browser journeys. Enable practitioner invites only when those boundaries hold. Keep live services unconfigured. Update the PRD, changelog and evidence; leave the next increment on a reviewable feature branch unless the user authorises another merge.

Suggested kickoff: “Read CLAUDE.md and docs/AI_HANDOFF.md, inspect main and existing local changes/processes, then implement ROADMAP LOCAL-01 against the current shared domain. Preserve the visual direction and existing booking/money/retry invariants. Build locally, run the complete checks and affected browser journeys, document gaps, and prepare the change for review without deployment.”
