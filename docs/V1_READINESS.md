# 1.0 · Run the Day: readiness ledger

Recorded 7 October 2026. SALEANE stays at **1.0.0-rc.1**. This ledger checks each 1.0 release gate ([PRD section 11](PRD.md#11-release-gates)) against the evidence in this repository, so it is clear what is finished locally and what can only be finished with a real studio, real providers and hosting. Nothing here is a claim of production readiness; the version moves to 1.0 only with the owner's explicit release approval after a supervised pilot.

## What a studio can already do, locally

Every V1 job in the long view ([ROADMAP](ROADMAP.md#the-long-view)) has a working local implementation with tests and browser evidence:

| V1 job                                  | Built in                                       | Evidence                                                                             |
| --------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------ |
| Studio, team, rooms, services, hours    | Foundation, LOCAL-04                           | [LOCAL-04](evidence/LOCAL-04.md)                                                     |
| Calendar, holds, move, cancel, no-show  | Foundation, hold protection                    | [HOLD-PROTECTION](evidence/HOLD-PROTECTION.md)                                       |
| Clients, timeline, referrals, consent   | Foundation, LOCAL-03                           | [LOCAL-03](evidence/LOCAL-03.md)                                                     |
| Branded booking and guest manage/cancel | Foundation, LOCAL-02                           | [LOCAL-02](evidence/LOCAL-02.md)                                                     |
| Practitioner's own day                  | LOCAL-01, extras                               | [LOCAL-01](evidence/LOCAL-01.md), [EXTRAS](evidence/EXTRAS.md)                       |
| Confirmations and reminders             | PILOT-01 (test mode)                           | [PILOT-01](evidence/PILOT-01.md)                                                     |
| Deposits, saved cards, checkout, fees   | PILOT-02 (test mode)                           | [PILOT-02](evidence/PILOT-02.md)                                                     |
| Receipts, refunds, till count, reports  | Foundation, extras                             | [EXTRAS](evidence/EXTRAS.md)                                                         |
| Rebooking                               | Foundation                                     | `src/domain/domain.test.ts`                                                          |
| Moving across from another system       | PILOT-03                                       | [PILOT-03](evidence/PILOT-03.md)                                                     |
| One clear published price               | PILOT-04 (price awaiting owner's confirmation) | [PILOT-04](evidence/PILOT-04.md)                                                     |
| Offline day sheet, backup and restore   | OFF-01, LOCAL-05                               | [OFF-01](evidence/OFF-01.md), [LOCAL-05](evidence/LOCAL-05.md)                       |
| Accessibility                           | LOCAL-05 onwards                               | Sweep of 87 pages, zero violations ([PILOT-04](evidence/PILOT-04.md)); Chromium only |

## Gate by gate

| Gate           | Done locally                                                                                                                                   | Still needed for 1.0                                                                                                                       | Waits on                             |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------ |
| Product        | Every daily journey runs end to end on fictional studios; switching import and price page exist                                                | Onboarding and real operating days observed with one pilot studio; the deposit step inside the booking page (after the booking redesign)   | Pilot studio; booking redesign (#20) |
| Local quality  | Lint, 294 frontend and 121 server tests, build, axe sweep at zero, measured load                                                               | Safari and Firefox checks; assistive-technology sampling on a real device                                                                  | Owner's Mac                          |
| Security/state | Tenant and role tests, practitioner and guest projections, hashed revocable guest links, CSRF, idempotent commands                             | Threat review against the hosted setup; hosted sign-in and secret storage                                                                  | Hosting (parked)                     |
| Money          | Ledger invariants, idempotent card attempts, unknown outcomes held for review, signed webhook handling, deposits carried over from old systems | A real provider account in its test environment, then live capture, refund and reconciliation; tax and receipt policy signed by an adviser | Stripe account; hosting for webhooks |
| Data/recovery  | Backup and restore drill, exports, non-destructive retention, reviewed imports with logged totals                                              | The same drill on the production database (Postgres) with recorded restore time; monitoring                                                | Hosting (parked)                     |
| Regional/legal | UK and US money, time zones and tax display; privacy defaults and retention decided by the owner                                               | Processor agreements, privacy notice and terms; UK and US acceptance for the markets enabled                                               | Providers chosen; legal review       |
| Release        | Each stage reviewed and merged into main with checks green                                                                                     | Explicit owner release approval, rollback plan and production acceptance                                                                   | Supervised pilot                     |

## The short path from here to 1.0

1. Edem confirms the providers already recommended (Postmark, Twilio, Stripe) and the published price.
2. When hosting is unparked: Neon (Postgres) and a host, then provider test environments end to end.
3. One real, non-clinical studio runs a supervised pilot: switching import, daily operation, reconciliation each day, and a restore drill.
4. Edem approves the release, and the version becomes 1.0.

Building continues meanwhile on 1.5 (memberships and packages first), which needs none of the above.
