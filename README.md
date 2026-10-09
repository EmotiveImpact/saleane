# SALEANE

SALEANE is becoming the operating system for modern beauty, spa and wellness businesses in the UK and USA. The canonical spelling has no accent.

**1.0.0-rc.1 is a local preview.** Accounts, separate studios, booking, clients, money, the team, messages and reports share a local server and SQLite database, and every roadmap version up to V5 has a local build. Live services remain unconfigured, as requested: messages, card payments, AI suppliers and maps run in test mode. This is a fictional-data review build, not a hosted or production-qualified release.

**Continuing development with Claude or another AI? Start with [CLAUDE.md](CLAUDE.md) and the [handoff](docs/AI_HANDOFF.md).**

## Run locally

Use Node **22.13+** (tested with 22.22.3) and npm. Dependencies are pinned; this increment adds none.

```sh
npm ci
npm run dev
```

Open **http://127.0.0.1:5173**. Keep **one server** running. The original browser demo is preserved; it uses 6 October 2026 and simulated money. Open **/account** to create a local review account and a new empty studio, or explicitly choose a fictional sample studio. Empty studios use the venue's current date and time.

```sh
npm run check
npm run format:check
# Stop the development server before starting the built application:
npm start
```

`check` runs lint, browser/domain/store tests, server tests, TypeScript and both application/server builds. `start` uses that build and serves the UI/API on the same port. Vite's static `preview` is only for the old browser demo; it does not host the API.

## Try the connected application

1. **Account → studio:** create a review account and an empty UK/GBP or US/USD studio. It starts closed on Sunday with online booking off, and Today lists what is left to set up.
2. **Settings:** add treatments, qualified professionals and rooms/chairs; set hours/closures, the studio's phone and email, and tax (VAT or sales tax). Existing visits keep their booked terms.
3. **Clients:** add people or review a bounded CSV import. Source is required; exact duplicates are reviewed and skipped; consent is never inferred from an import. Use fictional information.
4. **Your booking page:** treatment → professional/no preference → day/time → temporary reservation → details → confirmation, with the deposit shown before booking. The server rechecks professional and room availability. The guest's private link lets them view, move or cancel the visit.
5. **Today → visit:** welcome a client who has arrived, record a cash or card machine payment with an explicit acknowledgement and reference, then rebook. The timeline, receipt and Business totals use the same records.
6. **Money:** see where each payment came from, record an already-received deposit or a refund already given back. This records what happened elsewhere; it does not move money.
7. **Inbox:** write or answer a message, review consent and queue it. Every queued message remains unsent in test mode.
8. **Team:** owners invite managers, reception, practitioners, general managers and regional managers with local invitation links. Each scoped role sees only its own part of the studio. Professional catalogue entries do not grant account access.

## Persistence and recovery

The default database is **`.saleane-data/saleane.sqlite`**. It contains local accounts and studio records and is ignored by Git. Keep it private. Browser demo records remain in their existing versioned browser keys.

Server writes validate tenant membership, permissions, expected revision and request keys inside a transaction. Uncertain operator requests retain privacy-preserving retry keys across refresh. Guest confirmation keeps its submitted details in the current tab until confirmation is resolved, allowing the same reservation to be checked after expiry or reload. Studio switches cannot accept a late save into a different workspace. Review the latest records before resubmitting a conflict.

For consistent backup, verification and fresh-path restore, see the [server runbook](server/README.md). Restore invalidates sessions, invitations, unfinished booking holds and guest links, and holds back access keys, connections, social accounts and pending messages until the owner turns them on again. Do not copy only a live SQLite main file or overwrite a running database.

## Product source of truth

- [Vision](docs/VISION.md) and [version roadmap](docs/ROADMAP.md)
- [PRD, revision 0.4](docs/PRD.md) and [local V1 contract](docs/V1_LOCAL_CONTRACT.md)
- [UX architecture](docs/UX_ARCHITECTURE.md), [design system](docs/DESIGN_SYSTEM.md) and [original visual reference](docs/VISUAL_DIRECTIONS.md)
- [Architecture](docs/ARCHITECTURE.md), [server runbook](server/README.md) and [research](docs/RESEARCH.md)
- [Recovered project context](docs/PROJECT_CONTEXT.md)
- [Candidate verification](docs/evidence/VERIFICATION_1.0.0-rc.1.md) and [changelog](CHANGELOG.md)

The visible original conversation, PRD preview and generated board were inspected in earlier work; the original ZIP/workbook/image bytes remain unavailable. The original README is preserved in `docs/archive/INITIAL_README.md`. Generated studio imagery is fictional. No UXio connector was available or used.

## Release boundary

This preview is ready for local review. Stable production 1.0 still requires qualified hosting/identity/recovery, payment and message providers, verified guest identity for manage links, privacy/retention procedures, broader accessibility/browser testing and a supervised non-clinical pilot. Tax settings are manual, not jurisdiction advice. No real client data or Clinical workflows should enter this candidate.

Changes reach main through reviewable pull requests. Deployment and live-service configuration require separate instruction.
