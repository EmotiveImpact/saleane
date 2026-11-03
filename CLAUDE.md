# SALEANE — start here

Read [docs/AI_HANDOFF.md](docs/AI_HANDOFF.md) before changing code, then the [roadmap](docs/ROADMAP.md). This repository is the permanent source of truth.

- Preserve existing work and the original ivory/sage/serif photographic identity. Canonical name: SALEANE, without an accent. On screen say "visit" and "treatment", in plain British English with no em dashes.
- Build locally. Live services remain unconfigured: messages, card payments, AI suppliers, maps and Meta/Google run in test mode behind swappable adapters. Hosting is parked. Clinical is a separate later compliance boundary.
- Current version: **1.0.0-rc.1**, a local candidate, not production-qualified 1.0. LOCAL-01 to LOCAL-05, pilot basics, V1.5, V2, V3 core, V4 (test mode) and V5 are merged; what is left needs provider accounts, hosting or a real studio (see the handoff).
- Scoped people never get a whole-studio payload: practitioners get `PractitionerView`, regional managers `AreaView`, general managers `branchView`, guests `GuestView` for one visit through a hashed, revocable link (they can cancel or move it).
- Inspect branch/status, concurrent work and existing server before edits. Keep one server on 127.0.0.1:5173; disk has been tight. Reuse dependencies. Check main for the next free migration number before adding one.
- Preserve tenant, money, booking, retry and history invariants. Never claim a recorded manual payment or queued message was processed/sent.
- Run `npm run check` and `npm run format:check`; exercise changed journeys in a browser. Every screen change passes the [quality bar](docs/DESIGN_LANGUAGE.md#quality-bar) checklist at 1440px and 390px before anyone is asked to merge. Update PRD status, changelog and evidence honestly.
- Merging: the roadmap build thread merges its own green stage PRs ("merge as you go", 7 October 2026). Any other PR waits for the user's "merge". Nothing is ever deployed without a separate instruction.
