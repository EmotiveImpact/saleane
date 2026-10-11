# SALEANE V1 local operating contract

Status: implemented local candidate; live services remain unconfigured. This contract describes the domain and local API boundaries, not a production-readiness or provider-certification claim. Read alongside PRD, ARCHITECTURE and the current verification evidence.

## Authority and workspace modes

Two domain modes are explicit:

- **Sandbox** contains fictional records and simulated money. Its civil date is fixed at 6 October 2026, so a demonstration remains repeatable. An older browser workspace without an `operations` object is interpreted as sandbox.
- **Local** is an independently created, initially empty workspace. Its date follows the venue’s configured IANA time zone. Cash and payments already made at an external terminal can be recorded. SALEANE does not charge a card, initiate a refund or send a message.

Storage transport is separate from domain mode. The browser demonstration remains available; a signed-in local workspace uses the local SQLite API. A server-hosted sandbox still contains fictional data. Creating a local workspace never silently converts the browser sample into business records.

`schemaVersion: 1` remains readable. Operating configuration and new snapshot fields are additive. On loading an older appointment, the first validated linked service name and resource category fill missing snapshot fields; this cannot reconstruct catalogue changes made before the upgrade. Existing prices, deposits, durations, buffers, IDs, timeline history and relationships are retained.

The local API validates the command, resolves membership, checks its permission, checks the workspace revision and executes in a database transaction. Command receipts bind an idempotency key to the account, workspace and command fingerprint. A retry returns the existing result; reusing a key for another command fails. Browser persistence alone does not provide these server concurrency guarantees.

The remote client persists a bounded retry journal in this tab’s session storage before sending a command. The journal contains only a SHA-256 fingerprint scoped to workspace/account/canonical command and a request UUID; it contains no plaintext client details or command body. Uncertain writes retain their key across workspace refresh, switching and page reload in the same tab. A confirmed response or definitive rejection removes the key. Unavailable/corrupt retry storage prevents new remote writes. Closing the browser tab ends this session-storage recovery boundary; an unresolved result must be reviewed before manually repeating it elsewhere.

Workspace loading and writes use a generation and active-workspace guard. A late response from a previous workspace cannot replace the selected workspace. Writes are refused during a workspace transition. A stale revision refreshes current records while retaining the initiating form draft, and session expiry blocks further writes without replacing business records with samples.

## Scheduling contract

A bookable allocation needs all of the following:

1. An active service and an active, qualified professional.
2. A valid venue civil date and quarter-hour start.
3. The full treatment **and buffer** inside both venue and professional working hours.
4. No venue closure or professional break overlapping either treatment or buffer.
5. No active appointment or unexpired API hold occupying the professional or the selected compatible resource.
6. A valid local instant. Nonexistent times, repeated times and durations crossing a daylight-saving transition are rejected rather than silently shifted.
7. In local mode, a start that has not already passed according to the command’s clock.

Hours contain each weekday exactly once. A closure can cover the whole venue or one professional. Professional weekly hours are supported by the domain; the management UI can use closures for individual breaks. Overnight services are outside this candidate.

“No preference” is represented by `staffId: 'any'` at the request boundary. The command resolves an actual qualified professional; appointments never store a fictitious “any” staff record. The API carries the exact resource validated against active holds into the booking/reschedule command. The domain validates that resource again. This prevents a second allocation pass from occupying someone else’s held room.

Public holds reserve time for five minutes. Availability is informational; confirmation revalidates the hold, current catalogue and allocation in the transaction. A service changing during a hold requires another review. No public response includes client, payment, timeline or relationship collections.

### Lifecycle continuity

Booking records the service name, resource category, price, deposit requirement, duration and buffer as snapshots. Rescheduling preserves the appointment ID, client, original service, financial records, original creation, source and rebooking link. It records old/new allocation history.

Only a confirmed appointment can be moved, cancelled or marked missed. A future appointment cannot be marked missed. Arrival is allowed only for a confirmed appointment on the venue’s current day. Checkout requires arrival. Cancellation and a missed visit retain deposit history; neither creates a fee, refund, completed sale or outbound message.

A rebooking must link a completed appointment for the same client and use the rebooking source. Cancelled/missed follow-up visits no longer count as a successful rebook.

Archiving or changing a professional/resource, removing a qualification, closing time or reducing hours is rejected if it would conflict with a pending visit. Existing visits must be resolved first. Archiving a service stops new bookings while retaining historical records and existing visit snapshots.

## Money contract

All calculations and records use integer minor currency units. The workspace currency is fixed by market: GBP in UK and USD in USA.

- Sandbox accepts only `demo_card` and `demo_cash`. Local workspaces accept only `cash` and `external_card`.
- External terminal records require a receipt reference. SALEANE treats the operator’s record as evidence of what they entered; it is not processor settlement evidence.
- Local booking creates no collected deposit. A configured deposit requirement and a received deposit are separate facts. Public local booking collects no online payment and uses a pay-at-studio policy while payment services are unconfigured.
- A deposit command explicitly records money already received, only against a confirmed/arrived appointment, and cannot exceed the booked deposit requirement.
- Checkout consumes the booked service price, optional discount, configured tax snapshot, tip and recorded deposit. It writes one immutable receipt and one settlement record. The appointment becomes completed in the same command.
- Discounts cannot exceed service value. A checkout total cannot fall below the deposit already applied. Tips are separate and are not included in the configured service tax calculation.
- Tax is an operator-configured rate in basis points, an inclusive/exclusive flag and a label. It is **not** an automatic jurisdiction, nexus, exemption, VAT-registration or tax-filing determination. The configuration is captured on the receipt so later settings changes do not reprice it.
- A refund command records an amount already returned externally, or a sandbox simulation. It retains the original sale/payment records. Cumulative refunds cannot exceed the receipt total. A repeated reference cannot silently duplicate a payment/refund or record a different amount.
- Cancelled/missed appointments with deposits require manual policy review. This candidate does not automatically forfeit, transfer or refund unapplied deposits.

The state validator checks receipt arithmetic, tax calculation, payment linkage, settlement amounts, deposit totals and simulated/manual provenance. A corrupted imported or restored ledger fails validation.

### Reporting definitions

Completed service revenue uses appointment date and service value after discounts, excluding included tax and tips. Deposits are counted once through their completed receipt. Refunds are separate in Money; they are not silently deducted from this service-performance measure. Recorded funds and net recorded funds are distinct from service revenue.

Today’s booked value is the original booked service value before later discounts, tax adjustments and tips. Utilisation is treatment minutes divided by configured professional/venue open minutes, less closures; treatment buffers reserve capacity but are not counted as treatment delivered.

Historical reporting currently uses the **current** working-hours configuration. Schedule history is not versioned, so changing a past pattern can change a historical utilisation denominator. The metric is operational guidance, not a payroll record.

## Communications and consent

Messages have an explicit `appointment` or `marketing` purpose. They remain `draft`, `queued` or `suppressed`; no command records a delivery success. Appointment updates and marketing consent are separate concerns.

Marketing consent is checked when a draft is queued. Withdrawing it suppresses queued marketing messages. Drafts and suppressed drafts can be edited while retaining identity/client/purpose; queued messages cannot be edited. There is no automatic sender or background delivery worker. The API send endpoint reports that delivery is unconfigured.

The local invitation flow generates an expiring link for the owner to share; it does not email the invitation. Account verification, email recovery and delivery reputation remain live-service work.

## Clients, imports and inventory

Ordinary contact details and nonclinical preferences can be edited with timeline evidence. This does not add clinical notes, diagnosis, health photographs or a Clinical compliance claim.

The domain supports reviewed contact imports of at most 500 records per command. It accepts a reviewed source label, validates international phone digits and all rows before persistence, rejects repeated/existing exact name-plus-email pairs for review, does not silently merge shared email addresses, and keeps marketing off unless the old system's file recorded that the client agreed; that evidence is stored on a consent record with source `previous system`. Moving in (MOVING-01) reads client lists from Fresha, Phorest, Timely, Treatwell, Booksy and others as CSV or Excel and sends them in parts of at most 500. Moving in (MOVING-02) reads upcoming visits from the old system's own appointments file and sends them through `import-appointments` in parts of at most 200, after their clients. Past appointments, balances in the old system's own layout and payment tokens from other systems are not included yet.

Stock has products and signed movements with reasons and actors. Received movements increase stock; consumption/retail movements decrease it; adjustments explicitly correct a count. Stock cannot become negative. Archiving retains its movement history. A retail stock movement does not create a sale or claim collected revenue; integrated retail checkout and purchase ordering remain later work.

## Permission contract

| Action                                         | Owner | Manager | Reception | Practitioner     |
| ---------------------------------------------- | ----- | ------- | --------- | ---------------- |
| Read ordinary workspace and front-desk ledger  | Yes   | Yes     | Yes       | API access gated |
| Book, move, arrive, checkout, record deposit   | Yes   | Yes     | Yes       | API access gated |
| Client details, notes, consent, message drafts | Yes   | Yes     | Yes       | API access gated |
| Catalogue, hours, closures, stock and products | Yes   | Yes     | No        | API access gated |
| Record refund, queue messages, reviewed import | Yes   | Yes     | No        | API access gated |
| Venue identity/time zone, tax configuration    | Yes   | No      | No        | API access gated |
| Manage account membership/invitations          | Yes   | No      | No        | API access gated |
| Read server audit events                       | Yes   | Yes     | No        | API access gated |

The API checks these permissions; hidden controls alone do not confer security. Practitioner provisioning and access are deliberately disabled until an assigned-client projection can avoid exposing other clients and finances. The initial owner cannot be removed or demoted by the local membership route. Owner transfer is a later, separately specified workflow.

## Verification and remaining gates

The initial operating increment added 25 domain tests to the 54 existing lifecycle tests. Review added three tests for exact resource retention, durations across clock changes and explicit rebooking links: 82 domain tests passed in the scoped run. Ten remote-store integration tests also passed, covering account/workspace opening, draft retention on failed writes, conflict refresh, uncertainty/reload/remount recovery, storage denial/corruption, transition races and session expiry. See `src/domain/operations.test.ts` for executable evidence, and current repository verification evidence for the final run totals and browser/API results.

The test cases exercise backward-compatible samples and fresh local workspaces; UK/US civil dates and DST; supplied-clock consistency; no-preference allocation; hours, closures, qualifications and archived records; appointment snapshots; honest local deposits and manual receipts; inclusive/exclusive tax and discounts; bounded/idempotent refund records; corrupted ledgers; consent checks and suppression; editable drafts; atomic reviewed imports; stock bounds; actor attribution and permission mapping.

Production rollout still requires decisions and evidence for hosting, database operations/backups/restores, encryption and key management, account recovery/verification, provider-backed payments and reconciliation, communication delivery and consent records, operational monitoring, accessibility acceptance with users, legal/tax review, migrations and pilot operation. Clinical remains a separate future boundary. No live service or production deployment is implied by this local candidate.
