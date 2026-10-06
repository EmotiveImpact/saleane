# SALEANE version roadmap

Last updated: 6 October 2026. Milestones are outcome gates, not promised dates. The user authorised consolidation into main on 6 October 2026. This does not authorise deployment or future automatic merges.

## Current position

**0.2.0 — Connected foundation:** Vite, React and TypeScript; custom visual system; browser-local Today, Calendar, client directory and timeline, branded booking, simulated checkout/rebooking and derived business reporting. Executable booking, ledger and persistence rules; fictional UK and US workspaces. See [verification evidence](evidence/VERIFICATION.md).

The previous **v0.1** was a cloud discovery pack and HTML concept, referenced in the source conversation. It is not a Git release. The entire visible source conversation and the original PRD attachment preview have now been read; its readable text is archived. ZIP download attempts did not return bytes. The original generated visual board was subsequently inspected directly. After the first new studies were rejected, the revised studies and 0.2.1 app follow its light-sidebar, serif and photographic direction. Original image bytes remain unimported.

**0.2.2 — Appointment changes (locally verified):** confirmed-visit rescheduling, cancellation/missed history with retained deposits, calendar navigation/selection and a persistent panel heading. Local lint, 72 tests, build and targeted browser journeys passed; see [0.2.2 evidence](evidence/VERIFICATION_0.2.2.md). These changes exercise the daily loop in fictional local state and do not satisfy server, payment or communications gates.

**1.0.0-rc.1 — Local V1 candidate:** the user authorised a team build and selected local-first operation with live services unconfigured. Local account/studio authority, editable operating configuration, guest holds and exact-room allocation, manual money, unsent drafts, bounded client import and backup/restore are now implemented. See [local contract](V1_LOCAL_CONTRACT.md) and [candidate evidence](evidence/VERIFICATION_1.0.0-rc.1.md). The candidate version identifies a reviewable local app; it does not waive any stable production 1.0 gate.

## The path from the current candidate to V1

Do not rebuild the authority and booking foundations: they already operate locally. Earlier planned 0.3/0.4 milestones are substantially implemented in 1.0.0-rc.1; their outstanding qualification is listed below. A candidate version is not a production release.

| Milestone                                    | Scope                                                                                                                                      | Exit evidence                                                                                                                                 |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| RC2 · Restricted access and guest continuity | Assigned-practitioner projections; verified own-booking management; permission and expiry UX                                               | Direct API cross-staff/cross-tenant denial, minimal read payloads, revocation and guest cancellation race tests; browser journeys             |
| RC3 · Local operational readiness            | Privacy/export workflows, schedule change history, broader accessibility/browser coverage, measured performance and recovery               | Reviewed retention decisions, scoped exports, keyboard/screen-reader and Safari/Firefox checks, measured budgets and repeatable restore drill |
| Pilot qualification · External services      | Only after user selects pilot/providers: hosted identity/database/recovery, real payment/deposit/refund reconciliation, consented delivery | Provider sandbox then controlled live evidence, signed event replay protection, failed/unknown operation recovery, verified delivery receipts |
| Supervised pilot                             | One non-clinical studio, actual configuration/import, daily reconciliation, support and rollback                                           | Observed onboarding, operating days, recovery and incident drill; UK/US acceptance for markets actually enabled                               |
| 1.0 · Run the Day                            | Reliably operate a paying non-clinical studio                                                                                              | All PRD V1 gates; explicit release approval. No version bump substitutes for evidence                                                         |

## The long view

| Version                           | Product outcome                                 | Connected scope                                                                                         | Dependency / exit gate                                                                                                                         |
| --------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| V1.0 · Run the Day                | Keep today’s promises and book the next visit   | Organisation, team, rooms, services, calendar, clients, branded booking, deposits, checkout, rebooking  | Reliable tenant and money loop; safe operating procedures                                                                                      |
| V1.5 · Own the Relationship       | Remember and recover the client journey         | Non-clinical forms, consultations, versioned consent, packages, memberships, inbox, wait-list recovery  | Purpose-based communications; financial liability rules; explicit form/data classification                                                     |
| V2 · Run the Business             | Operate profitably across people and places     | Inventory, consumption, retail, commissions, staff performance, multi-location, accounting exports      | Stock and commission ledgers reconcile; no cross-location or cross-currency leakage                                                            |
| V3 · Saleane Intelligence         | Turn trustworthy facts into better decisions    | Daily brief, anomalies, churn/rebooking opportunities, schedule optimisation, natural-language analysis | Metric catalogue, data lineage, evaluation set, permissions and human approval for writes                                                      |
| V4 · Saleane Concierge            | Handle routine conversations safely             | Phone, SMS, web and messaging with constrained booking/payment/customer-service tools                   | Identity checks; purpose/channel consent; interruption and handoff; command limits; provider and cost controls                                 |
| V5 · Saleane Network              | Support groups and an extensible platform       | Multi-brand groups, scoped benchmarking, APIs, partners, deeper automation                              | Explicit sharing rights; anonymisation assessment; stable API versions and group permissions                                                   |
| Separate track · Saleane Clinical | Support qualifying clinical/aesthetic workflows | Clinical data, clinical consent, charts and specialised audits                                          | Jurisdiction and entity assessment; specialist clinical/legal review; segregated data/permissions; appropriate contracts and security evidence |

## Ideas to validate, rather than commitments

A waiting-list invitation that starts with a real empty slot; an owner brief that explains a shortfall with receipt-level evidence; a guest booking link that retains the business’s identity; a consultation that carries its version into a visit; a small group’s shared services with location-specific pricing; a stock suggestion tied to booked consumption.

The sequence matters: a polished inbox without consent and delivery history is not relationship ownership. An AI conversation without authorised commands is not an operating system.

## Ordered build queue for the next AI

| ID / priority    | Deliverable                        | Dependencies and acceptance                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LOCAL-01 / first | Assigned-practitioner access       | **Merged.** Define a minimal server read DTO and explicit field/command policy before enabling invitations. Only assigned visits and necessary client information; no full organisation snapshot, unrelated client records, owner finance or exports. Test cross-staff, cross-tenant, revoked membership, direct URL/API and permitted browser journeys. Adapt frontend reads explicitly rather than fabricating incomplete BusinessState.                    |
| LOCAL-02         | Guest manage/cancel                | **In review (draft PR); 24-hour deposit cutoff chosen by the user.** Depends on an ownership capability contract and cancellation/deposit policy. Expiring, revocable, narrowly scoped tokens; no client lookup by guessable IDs. Local manual link delivery is clearly labelled. Test replay, wrong booking, expiry, hold/appointment races and retained money history. No email verification claim without a provider.                                      |
| LOCAL-03         | Privacy and data lifecycle         | **Merged.** Scoped client/studio exports with preview and audit, non-destructive erasure review, proposed retention register ([PRIVACY.md](PRIVACY.md)); defaults await owner decisions. Define export scope, actor permissions, retention and erasure exceptions. Preview and audit operations, test tenant isolation and exclusion of credentials/internal records. Obtain decisions before destructive retention; do not guess legal deletion of receipts. |
| LOCAL-04         | Schedule administration continuity | Review breaks, hours/closure edits and booked-visit impacts. Preserve historical terms and show affected visits; no silent moves. Test DST, buffers, room continuity and conflicting edits.                                                                                                                                                                                                                                                                   |
| LOCAL-05         | Qualification pass                 | Keyboard/focus/error recovery, screen-reader sampling, Safari/Firefox and small screens across the complete daily loop. Measure realistic appointment/client loads before setting performance budgets; repeat backup/recovery. Record exact environment and gaps.                                                                                                                                                                                             |
| EXTERNAL-01      | Provider-backed pilot              | Blocked only on user choices below, not a reason to stop LOCAL-01–05. Build against bounded provider contracts, never fabricate delivery or payment success.                                                                                                                                                                                                                                                                                                  |

Each increment updates PRD status, changelog and evidence, runs lint/tests/build, and stays reviewable. Keep one server and preserve browser demo records. Inventory/retail/commissions remain V2; command seams are not a shipped retail product. Clinical stays separate.

## Deferred decisions required for a live pilot

1. Select the first non-clinical pilot business and map its actual hours, resources and booking policy.
2. Choose authentication, hosting, database and payment providers using UK/US residency, availability and cost evidence. No vendor is deployed or approved by this foundation.
3. Decide client identity/verification and reviewed duplicate-resolution policy. Never auto-merge on email.
4. Decide VAT/sales-tax classifications, gratuity allocation, cancellation/refund treatment and receipts with qualified advisers.
5. Validate the wordmark and naming with target users; complete trademark/domain clearance separately.

Every release updates the changelog, PRD status matrix and evidence. Every provider-dependent claim names the environment in which it was verified.

## Foundation sequence and immediate continuation

Research v0.2 → PRD product bible → UX architecture → three visual directions → connected prototype → real build is the governing sequence. Research/design overlap and discoveries revise the contract. The context reconciliation, screen map and visual comparisons close gaps in the first repository foundation; they do not certify production readiness.

The experimental server draft at `f73d084` is superseded by the verified Node/SQLite candidate. Its ancestry is retained during consolidation with an explicit history-only merge; the Fastify/PGlite/Postgres draft and its additional dependencies are not installed or substituted into the application. The original branch remains available for archaeology. See [AI handoff](AI_HANDOFF.md).

## Original feature disposition

| Original idea                                                  | Release and rationale                | Dependency retained now                                           |
| -------------------------------------------------------------- | ------------------------------------ | ----------------------------------------------------------------- |
| Compact Today, calendar side preview, client timeline          | Foundation and V1                    | Shared IDs, event sources, accessible progressive disclosure      |
| Services/people/rooms/hours, move/cancel/no-show               | V1                                   | Capability versus membership, immutable booked snapshots          |
| Branded booking, no preference, deposit, guest manage          | V1                                   | Same availability, holds, verified own-booking authority          |
| Checkout, tax, discounts, tips, refunds and receipts           | V1                                   | Versioned money/policy, authority limits, provider reconciliation |
| Migration, export, offline daily continuity                    | V1 pilot gates                       | Scoped source mappings, minimal read-only cache, retention        |
| Forms/waivers and consultation                                 | V1.5 non-clinical only               | Version/classification/acceptance; clinical content excluded      |
| Memberships/packages/gift cards                                | V1.5                                 | Liability, redemption, expiry/refund and imported-balance rules   |
| Inbox, waitlist, aftercare/feedback, reactivation              | V1.5                                 | Purpose/channel consent, dispatch receipts, reviewed offers       |
| Retail and professional/backbar stock                          | V2                                   | Product/stock movement, sale/consumption reference and reversal   |
| Commission, renters and staff performance                      | V2                                   | Employment model is explicit; no full payroll promise             |
| Multi-location, deeper accounting export                       | V2                                   | Tenant/location/currency from V1                                  |
| Recurring and multi-practitioner visits; Apple/Google calendar | V2 scheduling track                  | Exception/segment model, sync authority and revocation            |
| Personal cadence, owner questions, schedule optimisation       | V3                                   | Defined metrics, evidence and approval-led commands               |
| Phone/SMS/web/WhatsApp concierge                               | V4; channel qualification separately | Identity, opt-out, bounded tools, handoff and usage costs         |
| Groups, APIs and benchmarking                                  | V5                                   | Explicit sharing, aggregation and stable versions                 |
| Health forms, treatment-response notes, clinical photos        | Separate Clinical programme          | Later instruction supersedes early mixed examples                 |

No calendar dates are committed. The source workbook's illustrative 12–16-week schedule depended on an unverified team assumption; it is not a delivery promise. Final price, pilot and provider remain decisions supported by the research closure register.
