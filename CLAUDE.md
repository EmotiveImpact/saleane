# SALEANE — start here

Read [docs/AI_HANDOFF.md](docs/AI_HANDOFF.md) before changing code, then follow the ordered [roadmap](docs/ROADMAP.md). This repository is the permanent source of truth.

- Preserve existing work and the original ivory/sage/serif photographic identity. Canonical name: SALEANE, without an accent.
- Build locally. Live services remain unconfigured. Clinical is a separate later compliance boundary.
- Current version: **1.0.0-rc.1**, a local candidate, not production-qualified 1.0.
- Next implementation: **LOCAL-01, assigned-practitioner read projections**. Do not enable practitioner accounts with a whole-studio payload.
- Inspect branch/status, concurrent work and existing server before edits. Keep one server on 127.0.0.1:5173; disk has been tight. Reuse dependencies.
- Preserve tenant, money, booking, retry and history invariants. Never claim a recorded manual payment or queued message was processed/sent.
- Run `npm run check` and `npm run format:check`; exercise changed journeys in a browser. Update PRD status, changelog and evidence honestly.
- The user authorised the current consolidation into main; this is not standing permission to merge future work or deploy.
