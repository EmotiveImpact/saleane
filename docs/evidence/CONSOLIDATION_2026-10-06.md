# Consolidation verification — 6 October 2026

Scope: roadmap and Claude handoff, preservation of superseded server history, and the PR review finding about browser reset revision reuse.

- `npm run check`: passed. Lint, **158 tests** (125 frontend/domain/store, 33 server/recovery), TypeScript and application/server/backup builds.
- `npm run format:check`: passed; `git diff --check`: passed before commit.
- Two new regression tests prove stale pre-reset state is rejected after reset plus a subsequent write, and unreadable demo data supports explicit reset. Reset advances beyond both current and persisted revisions.
- In-app Chromium opened the existing 127.0.0.1:5173 Today view successfully. No user demo reset was performed; the reset fix is covered by persistence regression tests. The earlier candidate evidence remains the source for full targeted operating journeys.
- Existing Node SQLite experimental and Vite future config-loader advisories remain. No dependencies were installed, additional server started, live service configured or deployment performed.
- Experimental server commit `f73d084` is superseded: preserve ancestry with a history-only merge, without importing its implementation/dependencies. Verify remote main ancestry and CI after GitHub merge.

Local disk had approximately 233 MiB available at verification. Do not generate unnecessary large artifacts or duplicate dependencies. Full check output was retained in `/tmp/saleane-consolidation-check.log` for this machine/session; this file records portable results rather than assuming that temporary log will be available to the next AI.
