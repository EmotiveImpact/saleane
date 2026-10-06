# SALEANE architecture

Foundation 0.2 · 6 October 2026. This document separates **implemented local authority** from **target production contracts**. Hosting, database, authentication, payments, communications and model providers are not configured or deployed.

## Implemented application

Vite + React + TypeScript with React Router. The lockfile makes installed dependencies reproducible. Radix Dialog supplies headless accessible behaviour. Saleane owns its components, CSS tokens and page composition. Fonts are bundled locally.

```text
src/
  domain/model.ts       Versioned Zod schemas, scoped IDs, stored-state validation
  domain/seed.ts        Separate fictional UK/US workspaces and linked histories
  domain/commands.ts    Booking, arrival, checkout, client, note and consent rules
  domain/selectors.ts   Calendar, client statistics, return opportunities, reports
  domain/format.ts      Civil date, venue clock conventions and minor-unit formatting
  state/storage.ts     Load validation, revision check, commit-before-success
  state/StoreProvider   Workspace context and market selection
  components/          Saleane controls, agenda, visit/booking sheets and recovery
  pages/               Today, Calendar, Clients, Timeline, Business, Guest booking
```

A command creates a new validated state. The storage adapter saves it before the UI adopts it. Views derive from that state. A checkout creates one sale, one settlement payment, one completion transition and one client event. Rebooking links the old and new appointments. Reports do not keep separate editable totals.

Keys: `saleane.demo.v1.UK` and `saleane.demo.v1.US`. Schema version is 1; product version is 0.2.1. A corrupt, foreign-scoped or unsupported snapshot is left untouched and writes are paused. Export/reset controls enable deliberate recovery. Stale revision detects many ordinary sequential tab conflicts; localStorage is not transactional across concurrent tabs. No security claim is made for browser storage.

Demo scheduling stores a civil date and minutes in a fixed venue day, using 09:00–18:00 daily opening, one service/professional/resource per visit, 15-minute validation and 30-minute offered slots. It validates service qualification and shared-resource intervals including buffers. It does not implement UTC scheduling, DST conversion, holds, closures, partial processing time, staff shifts or network concurrency. Those are V1 engine work.

Guest booking creates a new local client record instead of guessing an existing identity from email. Production needs verified identity and reviewed duplicates. Guest and operator routes in this one demo share the same browser state; the guest route is not an access-control boundary.

## End-state domain

**Relational records, explicit edges, durable events.** PostgreSQL is the target category of database; vendor/region remains a decision. A separate graph database is not required to express client relationships. Start with a modular TypeScript service and one transactional database rather than a separate service per screen.

```mermaid
erDiagram
    Organisation ||--o{ Location : operates
    Organisation ||--o{ Membership : authorises
    Organisation ||--o{ Client : knows
    Client ||--o{ RelationshipEdge : connects
    Client ||--o{ Appointment : visits
    Location ||--o{ Resource : contains
    Staff ||--o{ Capability : qualifies
    Service ||--o{ Capability : requires
    Appointment ||--|{ AppointmentSegment : schedules
    AppointmentSegment }o--|| Staff : assigns
    AppointmentSegment }o--|| Resource : reserves
    AppointmentSegment }o--|| Service : snapshots
    Appointment ||--o| Sale : settles
    Sale ||--|{ SaleLine : contains
    Appointment ||--o{ Payment : receives
    Sale ||--o{ Payment : applies
    SaleLine ||--o{ StockMovement : consumes
    SaleLine ||--o{ CommissionAccrual : rewards
    Client ||--o{ ConsentRecord : permits
    Client ||--o{ Conversation : communicates
    Appointment ||--o{ DomainEvent : records
    DomainEvent ||--o{ InsightProposal : supports
```

The diagram is the target contract, not a claim that every table exists in v0.2. Current prototype uses one service segment on each appointment and a service-only sale; multi-segment visit and sale-line migration must preserve those IDs and snapshots.

| Aggregate / seam        | Stable information                                                                | Owning authority / growth                                                  |
| ----------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Organisation/location   | IDs, country, base currency, IANA zone, policy versions                           | Account service; future multi-brand groups require explicit sharing grants |
| Membership/staff        | Actor ID, roles, location scopes, capabilities and hours                          | Server policy; employee/contractor/renter distinct from permissions        |
| Client/relationship     | Stable tenant ID, contact channels, explicit typed edges, source mapping          | Relationship module; household/referral never inferred automatically       |
| Service/version         | Location price, duration, buffer, capabilities and resource needs                 | Catalogue; snapshots survive later editing                                 |
| Appointment/segments    | Client/location, service snapshots, staff/resource intervals, status/version      | Scheduling module; holds and reschedules atomic                            |
| Sale/lines              | Service/retail amounts, tax policy snapshot, currency, tip, adjustments           | Money module; settlement and immutable adjustment history                  |
| Payment/refund          | Provider IDs, purpose, amount, currency, status and allocation                    | Provider adapter plus verified webhook ledger                              |
| Product/stock movement  | Product/location, quantity/unit, reason, visit or sale-line link                  | Inventory module; append/reverse rather than overwrite balances            |
| Commission accrual      | Recipient, rule version, qualifying sale line, adjustment                         | People/money seam; compensation is not calendar availability               |
| Consent/conversation    | Purpose/channel, policy version, source, withdrawal, delivery states              | Communication module; suppression enforced at send-time                    |
| Domain event/outbox     | Event type/version, actor, tenant, subject IDs, correlation/causation             | Transactional write with aggregate; delivery retries safe                  |
| Insight/action proposal | Definition/version, permissioned sources, evaluation/confidence, proposed command | Intelligence reads projections; actions return to authorised modules       |

## Production authority and API contract

1. Authenticate the actor; resolve organisation membership and action/location scope on the server.
2. Validate an input schema and idempotency/correlation key.
3. Check capability, money or availability invariants inside the same transaction as the write.
4. Use scoped references and version constraints. The server returns a conflict when expected version is stale.
5. Commit domain records and an outbox event together.
6. Let jobs deliver notifications/build projections from the outbox. Delivery receipt is distinct from queued intent.
7. Return a stable record/command result. Client success requires committed authority; provider success requires verified provider result.

Suggested commands (contracts to implement, not existing endpoints):

| Command                                    | Input / guard                                                                        | Result / conflict                                         |
| ------------------------------------------ | ------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| `POST /organisations/:orgId/booking-holds` | Location, qualified segments, requested time, short expiry, public/session authority | Hold ID/expiry; 409 unavailable; rate-limited             |
| `POST .../appointments`                    | Hold, verified client/details, policy consent, deposit state, idempotency key        | Confirmed visit or explicit pending-payment state         |
| `POST .../appointments/:id/arrive`         | Expected version, permitted operator, arrival window                                 | Versioned arrival event; 409 invalid transition           |
| `POST .../sales`                           | Visit, price snapshot, tax version, optional tip, actual deposit allocation          | Sale/payment intent; unique visit settlement key          |
| `POST .../payments/webhook`                | Signature, provider event ID, permitted account mapping                              | Deduplicated ledger transition; rejected unmapped event   |
| `POST .../appointments/:id/rebook`         | Completed origin, same client, new valid hold                                        | Linked next visit; conflict preserves previous settlement |
| `POST .../clients/:id/notes`               | Ordinary data classification, permitted client scope                                 | Attributed note event                                     |
| `POST .../consents`                        | Channel/purpose/policy/source/action                                                 | Immutable grant/withdrawal event and current projection   |

A URL orgId is not authorisation. PostgreSQL scoped composite foreign keys or equivalent verified constraints must prevent references to another organisation. Queries, jobs, exports, webhooks and AI tools must carry the same tenant context. A generated UI permission check alone cannot satisfy this.

## Scheduling and time

Production scheduling stores UTC start/end instants, venue IANA zone and source civil-time intent. Service segments reserve staff and resource intervals with configured treatment, processing and cleanup policies. Reject nonexistent local times; resolve ambiguous times explicitly and test UK/US DST boundaries.

Use database-supported non-overlap constraints/locks plus transactional revalidation. A public hold has an expiry and cannot reserve capacity forever. Provider callbacks may race hold expiry: the state machine must resolve late capture through a documented reconciliation/refund path rather than inventing a confirmed visit. Test simultaneous guest and desk requests for the last room.

Reschedule is a new attributed allocation change with history; it is not drag-and-drop updating a display field. Every interaction has a non-drag accessible path.

## Money and providers

Minor-unit amounts always carry currency. Service/retail tax inclusion and classifications are explicit and versioned per location. Tips remain separately reportable/allotted. Deposit capture, liability, application, refund and forfeiture require distinct ledger reasons.

Use provider-hosted/tokenised card entry; never put card numbers in application state or logs. Signed, deduplicated webhooks map provider account and event to the correct tenant. Out-of-order or replayed delivery cannot double-settle. Daily reconciliation compares ledger to provider captures/refunds/fees; exported reports disclose recognition dates and tax treatment.

v0.2 simulates a deposit at booking and a settlement at checkout. Service revenue ignores the deposit payment amount and uses the completed service sale exactly once. No card-on-file, VAT/sales-tax invoice, refund or payment certification is implemented.

## Communication and intelligence

Transactional appointment messages and marketing have distinct purposes, templates and permission policies. Consent withdrawal changes eligibility before any future send. Delivery attempts/receipts and suppression are linked to client/conversation/appointment IDs. The present email boolean/events are a demo surface for a future consent ledger, not a jurisdiction-complete policy.

Intelligence is initially a deterministic projection with visible provenance. Later model adapters can summarise permissioned facts and propose a command. An action requires an authorised actor, exact preview and appropriate approval. Neither model text nor retrieved client messages can override permissions, deposit/cancellation policy or the clinical boundary. Evaluate recommendations and errors with a versioned fixture/pilot set; store action provenance.

Concierge is a client of these contracts. Voice/SMS/web channels do not receive raw database write authority.

## Clinical boundary

Core Saleane permits ordinary non-clinical service preferences only. Do not add diagnoses, medications, clinical forms, treatment images or health-derived segments to its free-text model as a shortcut.

Saleane Clinical requires jurisdiction/entity assessment, appropriate contracts (including BAA where applicable), data classification/retention, clinical permissions, audit and incident procedures, provider suitability and specialist validation. Plan a separately governed datastore/access boundary and explicitly authorised references if core operations need shared identity. Clinical records cannot enter generic marketing, benchmarking or model context by default. No compliance label is earned by adopting this architecture.

## Persistence, migrations and operations

Prototype schema migration currently rejects unknown versions and offers preserved-byte export/reset. Production needs tracked migrations, scoped import mapping, reviewed duplicate handling and tested rollback. Never reinterpret history after a service/tax/time-zone change.

Before pilot: backups and restore drill; retention/export/erasure procedure; secret rotation; audit/log redaction; monitoring for booking conflict/payment failures; incident owner; provider outage runbook; actual supported-browser and performance measurements. Public SPA route fallback must be configured on the chosen host for direct route access. No host is presently configured.

## Current technical risks and intentionally missing capabilities

LocalStorage has no atomic cross-tab transaction, trusted authorisation, encryption boundary or collaborative live updates. A very short simultaneous-write race remains despite revision checks. Demo schema validation catches malformed scoped links but is not a complete forensic ledger validator. The daily opening-hours model ignores closures and actual staff shifts. Guest client identity is unverified. Reports use visit date and simplified denominators. Tax, refunds, provider reconciliation, inbox, inventory, commissions, memberships and Clinical are not implemented.

Those boundaries make 0.3–0.6 necessary. Keep the current UI/domain vocabulary, move state authority to a transactional service, and add real evidence before claiming V1.

## Continuity contracts recovered from the source conversation

Read [PROJECT_CONTEXT](PROJECT_CONTEXT.md), [UX_ARCHITECTURE](UX_ARCHITECTURE.md) and the PRD together. Screens are projections of durable records, not independent databases. The prototype is 0.2.1; the unverified server draft is preserved separately on `wip/saleane-server-authority` at `f73d084` and is not part of the reviewed app.

- **Daily brief:** attention items carry source IDs, evaluation time, definition version and an available command. “Done for you” requires an actual action receipt. Calendar capacity, relationship history and money share organisation/location scope.
- **Read-only continuity:** a future authorised daily snapshot contains the minimum appointment/client display fields, actor/scope, issued time and expiry. Logout, role removal and tenant change invalidate access. Offline writes, payments, identity edits and new bookings are unavailable. This snapshot mechanism is specified, not implemented.
- **Migration:** imports stage immutable source rows with batch IDs and external-to-internal mappings. Preview, duplicate review, counts and money reconciliation precede commit. Source consent is evidence, never automatic permission to market. No card credentials are imported through CSV. Re-runs must not duplicate records.
- **Relationship expansion:** membership, consultation and aftercare events attach to existing client IDs; inbox threads and delivery receipts attach to consent purpose and visit IDs. Retail stock and professional consumption use distinct movement reasons. Commission rules snapshot eligibility rather than changing old sales when a staff rule changes.
- **Interface evolution:** side-panel appointments reuse the same command authority as calendar/checkout. Imagery, serif branding and the three study expressions do not introduce extra source records or fork the product's domain. The current static studies are visual experiments, not another booking engine.

The next server slice must prove two competing booking attempts, replayed checkout, unauthorised tenant access, restart persistence and recoverable migration against a real transactional database before replacing browser authority. Production provider, backup, legal and deployment gates remain separate.
