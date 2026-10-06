# SALEANE version roadmap

Last updated: 6 October 2026. Milestones are outcome gates, not promised dates. Nothing in this document authorises an automatic merge or deployment.

## Current position

**0.2.0 — Connected foundation:** Vite, React and TypeScript; custom visual system; browser-local Today, Calendar, client directory and timeline, branded booking, simulated checkout/rebooking and derived business reporting. Executable booking, ledger and persistence rules; fictional UK and US workspaces. See [verification evidence](evidence/VERIFICATION.md).

The previous **v0.1** was a cloud discovery pack and HTML concept, referenced in the source conversation. It is not a Git release. Its downloadable ZIP was not accessible through the conversation-read tool or found in the checked local folders. This build preserves the available product decisions; it does not claim to have imported unseen files.

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

## Decisions before the next build

1. Select the first non-clinical pilot business and map its actual hours, resources and booking policy.
2. Choose authentication, hosting, database and payment providers using UK/US residency, availability and cost evidence. No vendor is deployed or approved by this foundation.
3. Decide client identity/verification and reviewed duplicate-resolution policy. Never auto-merge on email.
4. Decide VAT/sales-tax classifications, gratuity allocation, cancellation/refund treatment and receipts with qualified advisers.
5. Validate the wordmark and naming with target users; complete trademark/domain clearance separately.

Every release updates the changelog, PRD status matrix and evidence. Every provider-dependent claim names the environment in which it was verified.
