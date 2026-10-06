# SALEANE version roadmap

Last updated: 6 October 2026. Milestones are outcome gates, not promised dates. Nothing in this document authorises an automatic merge or deployment.

## Current position

**0.2.0 — Connected foundation:** Vite, React and TypeScript; custom visual system; browser-local Today, Calendar, client directory and timeline, branded booking, simulated checkout/rebooking and derived business reporting. Executable booking, ledger and persistence rules; fictional UK and US workspaces. See [verification evidence](evidence/VERIFICATION.md).

The previous **v0.1** was a cloud discovery pack and HTML concept, referenced in the source conversation. It is not a Git release. The entire visible source conversation and the original PRD attachment preview have now been read; its readable text is archived. ZIP download attempts did not return bytes. The original generated visual board was subsequently inspected directly. After the first new studies were rejected, the revised studies and 0.2.1 app follow its light-sidebar, serif and photographic direction. Original image bytes remain unimported.

**0.2.2 — Appointment changes (locally verified):** confirmed-visit rescheduling, cancellation/missed history with retained deposits, calendar navigation/selection and a persistent panel heading. Local lint, 72 tests, build and targeted browser journeys passed; see [0.2.2 evidence](evidence/VERIFICATION_0.2.2.md). These changes exercise the daily loop in fictional local state and do not satisfy server, payment or communications gates.

## The path to V1

| Version           | Outcome                                       | Required evidence to advance                                                                                                                                                                 |
| ----------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0.2               | Review the connected product foundation       | Build, lint, rule and journey tests; desktop/mobile browser evidence; documented limitations                                                                                                 |
| 0.3               | Establish real organisation authority         | Authenticated account → organisation → location → memberships; tenant-scoped database and migrations; deny-by-default permissions; backup/restore drill                                      |
| 0.4               | Keep the booking promise on a server          | Service/team/resource setup; real opening hours, breaks, closures and capability; UTC/IANA scheduling; atomic holds and conflicts; public booking abuse controls; simultaneous-booking tests |
| 0.5               | Complete a provider-backed money loop         | Region-qualified payment provider; deposit capture and failure recovery; signed webhook deduplication; checkout/refund reconciliation; receipts and tax configuration approved for pilot     |
| 0.6               | Run a supervised studio pilot                 | Real onboarding/import, consented appointment communications, daily cash reconciliation, accessibility review, support runbook and a successful restore                                      |
| 1.0 · Run the Day | Reliably operate a paying non-clinical studio | All PRD V1 gates; live UK/US pilot evidence as applicable; legal/privacy/provider acceptance; monitored release and rollback                                                                 |

The 0.x progression avoids declaring the present local prototype to be V1. It is intended to keep the durable identifiers, commands and interface vocabulary, while moving state authority to the server.

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

## Immediate build queue

1. Review the locally verified 0.2.2 appointment-change slice and its [evidence](evidence/VERIFICATION_0.2.2.md): snapshot-preserving moves, conflict rejection, terminal history, retained deposits, reporting exclusions, keyboard/focus and phone rendering. Confirm CI against the pushed commit separately; do not merge or deploy automatically.
2. Establish **shared backend and authentication first**: qualify the preserved server draft or replace unsafe portions with tenant-scoped account → organisation → membership → location authority, transactional persistence, deny-by-default permissions, recovery and backup evidence. Keep the local demo available during this work.
3. Move booking and appointment commands behind that authority: venue time, actual hours, atomic capacity checks/holds, attributed history and policy enforcement. Reuse durable IDs and money snapshots.
4. Then qualify **communications and payment integrations** on those commands: purpose/consent and delivery receipts for appointment updates; provider-backed deposit/checkout/refund reconciliation. Provider test evidence, policy approval and failure recovery are prerequisites to pilot claims. Broad Inbox and marketing remain later scope.

This order lets client relationships, calendar/resources, money, staff and future inventory/intelligence share one trusted domain model. Clinical remains a separate compliance programme; no clinical fields enter this slice.

## Decisions before the next build

1. Select the first non-clinical pilot business and map its actual hours, resources and booking policy.
2. Choose authentication, hosting, database and payment providers using UK/US residency, availability and cost evidence. No vendor is deployed or approved by this foundation.
3. Decide client identity/verification and reviewed duplicate-resolution policy. Never auto-merge on email.
4. Decide VAT/sales-tax classifications, gratuity allocation, cancellation/refund treatment and receipts with qualified advisers.
5. Validate the wordmark and naming with target users; complete trademark/domain clearance separately.

Every release updates the changelog, PRD status matrix and evidence. Every provider-dependent claim names the environment in which it was verified.

## Foundation sequence and immediate continuation

Research v0.2 → PRD product bible → UX architecture → three visual directions → connected prototype → real build is the governing sequence. Research/design overlap and discoveries revise the contract. The context reconciliation, screen map and visual comparisons close gaps in the first repository foundation; they do not certify production readiness.

The server draft remains preserved on local `wip/saleane-server-authority` at `f73d084`. It is not a release. Before integration it must satisfy assigned-practitioner read filtering, tenant/role tests, safe session/recovery behaviour, persistence tests and an authenticated browser journey. Broad endpoints in a draft are not a substitute for a verified vertical slice. Keep the existing working prototype available while qualifying server authority.

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
