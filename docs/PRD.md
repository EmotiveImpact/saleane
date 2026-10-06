# SALEANE product contract

**Contract revision:** 0.4 · **Updated:** 6 October 2026 · **Markets:** United Kingdom and United States.

This is the build contract for core Saleane. Requirements distinguish the executable local V1 candidate from production V1 acceptance. A completed local demo does not satisfy a server/provider/legal gate. Canonical brand spelling is **SALEANE**, without an accent.

## 1. Product outcome and scope

An owner-led beauty, spa or wellness business should run its day and retain its relationships from one dependable operating environment. The first complete production loop is:

**Organisation/account → location → services → team/resources → available time → client → branded booking/deposit → arrival/visit → checkout → receipt → rebook → relationship/reporting.**

Every stage keeps durable identifiers and an attributed event history. Inventory, communications, staff compensation and intelligence extend those records later. Clinical data and workflows remain a deliberate separate track.

### Present release boundary

**1.0.0-rc.1 is the local V1 candidate.** The user explicitly chose to build locally and leave live services unconfigured. It adds local accounts, isolated studio memberships, transactional SQLite authority, catalogue/hours/resources configuration, guest holds, manual money records, drafts, reviewed imports and recovery tooling to the original connected journey. The browser demo is preserved as an independent fictional workspace.

A local studio follows venue time and starts empty; an explicitly selected sample studio retains the fixed demo day and simulated money. The [local domain contract](V1_LOCAL_CONTRACT.md), [server runbook](../server/README.md) and [verification record](evidence/VERIFICATION_1.0.0-rc.1.md) govern this candidate. It is suitable for fictional-data review. It has not passed hosted/pilot, provider, legal or full accessibility acceptance, and is not a stable production 1.0 release.

| Capability           | Local candidate                                                                                                   | Remaining production acceptance                                                           |
| -------------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Accounts and studios | Password sign-in, sessions, owner/manager/reception, invitation links, isolated SQLite records                    | Verified identity/recovery, assigned-practitioner read scoping, operational threat review |
| Scheduling           | Editable catalogue/capability/resources, hours/closures, venue time, exact-room holds and transactional conflicts | Pilot policy, monitored multi-device load, guest verified cancellation/manage links       |
| Money                | Manual cash/external payment, discounts, configured tax, deposits, receipts, external refund provenance           | Processor capture/refund/webhook reconciliation, legally approved tax/receipt policies    |
| Relationships        | Directory, explicit edges, non-clinical notes, consent, scoped CSV preview/import and source                      | Reviewed migrations from named providers, duplicate resolution, retention/erasure         |
| Communications       | Purpose-aware editable drafts and unsent queue                                                                    | Qualified delivery adapters, delivery receipts, unsubscribe/versioned consent             |
| Operations           | Snapshot export, consistent backup/fresh-path restore, audit, defined reports                                     | Monitored restore/rollback, support SLA, offline continuity, pilot acceptance             |

### V1 production boundary

V1 includes account/organisation/location setup; roles; editable service/team/resource setup; real availability and conflicts; client directory and non-clinical preferences; branded booking; deposits; arrival; checkout/refunds/receipts; rebooking; defined operational reports; consented appointment updates; migration and support procedures.

Packages, memberships, broad marketing campaigns, payroll, multi-location UI, retail inventory and autonomous intelligence follow later versions. Their domain seams must be retained now. A hidden or nonexistent feature cannot be called shipped.

## 2. Users and jobs

| User                               | Primary job                                                             | Critical moment                                | Success evidence                                                                      |
| ---------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------- |
| Solo practitioner                  | Keep the day full and maintain relationships with little administration | A booking arrives while delivering a treatment | Phone booking is clear; no conflict; receipt and next visit require few decisions     |
| Studio owner (2–5 professionals)   | Run a dependable day with shared rooms                                  | Two bookings compete for the same space        | One confirmed promise; room and professional are both reserved                        |
| Reception/front desk               | Welcome, recover context, settle and rebook                             | Client standing at the desk                    | Identity and useful preference are visible; deposit and balance are unambiguous       |
| Professional                       | Prepare for and deliver assigned visits                                 | Handover between practitioners                 | Only permitted client context is visible; service and resource are clear              |
| Owner/manager (5–10 professionals) | Explain utilisation, revenue and retention                              | Business below target                          | Numbers have definitions and traceable underlying records                             |
| Customer/guest                     | Book with a trusted business on a phone                                 | Selecting a time and paying a deposit          | Business identity remains present; final total/terms are clear; marketing is optional |
| Future group operator              | Govern several locations without leaking data                           | Staff/pricing varies between locations         | Organisation and location scoping persists, with explicit group permissions           |

UK and US behaviours differ in currency, date/clock conventions, telephone country code, venue time zone, tax classification and gratuities. Employees, contractors and chair/room renters must eventually have explicit roles and compensation rules; these are not inferred from a calendar column.

## 3. Information architecture

Operator navigation: **Today, Calendar, Clients, Inbox, Business**. Inbox currently exposes local drafts and an unsent review queue; delivered conversations and broader campaigns remain later gates. Business has Overview, Money and Manage sections. Search finds clients. Workspace controls expose market, demo recovery and export. Booking is a separate guest route with the business’s brand.

| Route                | Intent                                      | Required connection                                                                        |
| -------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `/today`             | Understand and act on the working day       | Actual daily appointments, source-based return opportunities                               |
| `/calendar`          | Place people and services in available time | Qualified staff, scarce resources and booking rules                                        |
| `/clients`           | Find and understand a relationship          | Stable client ID; completed visits/spend; next visit; explicit segments                    |
| `/clients/:clientId` | Recover the person’s story                  | Event timeline, linked receipts, explicit referral/household edges, familiar professionals |
| `/booking`           | Make an appointment with the business       | Same service and availability rules as operator booking                                    |
| `/business`          | Understand operational outcomes             | Derived receipt/cohort data, definitions, exact values and export                          |

No duplicate appointment record belongs to a screen. A timeline is a projection, not a second system of record.

## 4. Domain invariants

- Every domain record has a stable ID and organisation scope. Appointments also carry location scope. Production references use scoped foreign keys, not display names or emails.
- Money is integer minor units plus ISO currency. Never aggregate GBP with USD or treat a market switch as currency conversion.
- A booked visit snapshots duration, buffer, price and deposit policy. Editing a service catalogue must not rewrite an existing promise or receipt.
- Availability requires qualified staff and a suitable free resource for `[start, treatment end + buffer)`. Adjacent intervals may touch at the boundary.
- Production time uses UTC instants plus venue IANA zone and the submitted civil-time context. Ambiguous/nonexistent DST times require explicit handling.
- Client connections are explicit graph edges with type and provenance. Contact information alone does not authorise merging or sharing.
- Deposits are part-payments/liabilities, not an extra sale. Settlement applies the actual recorded deposit; revenue, cash, tax and gratuities are defined separately.
- A checkout retry must not create a second sale, second charge or second stock/commission consequence.
- A financial correction adds an attributed reversal/adjustment. Production must not overwrite settled history.
- Consent is scoped by channel and purpose with policy version, source, timestamp and withdrawal. A booking is not blanket marketing permission.
- Intelligence reads permissioned facts and proposes authorised commands. It never obtains new authority from the text of a client note.

See [architecture](ARCHITECTURE.md) for domain seams and state authority.

## 5. Functional contract and traceability

Status: **Demo** = implemented with fictional local state; **Partial** = some demo behaviour exists, production rule remains; **Planned** = no executable implementation yet; **In progress** = local work exists or is being built but acceptance evidence is pending. V1 acceptance is independent of that status.

| ID     | Requirement / failure behaviour                                                 | Original foundation status (historical)           | Production acceptance                                                                                 |
| ------ | ------------------------------------------------------------------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| ORG-01 | Create organisation/location and membership; no cross-tenant access             | Planned; scoped fixtures only                     | Authenticated actor can create/select permitted workspace; foreign IDs consistently denied            |
| ORG-02 | Preserve market, currency and venue zone                                        | Demo                                              | Venue policies stored server-side; changes cannot reinterpret past receipts/times                     |
| CAT-01 | Configure service price, duration, buffer and eligible staff/resource           | Partial; seeded catalogue, qualification enforced | Owner can edit/version catalogue; booked snapshots remain fixed                                       |
| CAL-01 | View day by professional, date and agenda                                       | Demo                                              | Actual working hours, breaks/closures and live updates shown; keyboard alternative maintained         |
| CAL-02 | Reject staff or shared-resource collision including buffer                      | Demo                                              | Concurrent requests atomically reserve a slot; one winner, loser offered alternatives                 |
| CAL-03 | Hold, confirm, reschedule, cancel and expire appointments                       | Partial; move/cancel/missed Demo (0.2.2)          | Expiring holds, cancel/refund policy, attributed reschedule and no-show states proven                 |
| CLI-01 | Search/create a client by stable ID without auto-merging email                  | Demo                                              | Verified identity/duplicate-review policy; permissioned import, export and erasure workflow           |
| CLI-02 | Timeline joins visit, receipt, note, consent and relationships                  | Demo                                              | Source record links, pagination and actor provenance; permission filtering excludes restricted fields |
| CLI-03 | Record explicit referral graph on both client relationships                     | Demo                                              | Scoped edges, provenance, correction and sharing policy; no inferred household data                   |
| CLI-04 | Record ordinary preferences and purpose-specific consent                        | Partial; ordinary notes and email boolean/events  | Channel/purpose/policy-version ledger, withdrawal propagation, retention controls                     |
| BKG-01 | Guest booking chooses service → professional/time → details → review            | Demo                                              | Accessible phone completion with clear business identity, price, venue zone and terms                 |
| BKG-02 | Final booking revalidates availability and preserves entered details on error   | Local; hold limits in review                      | Server-side hold/rate limits and retry-safe confirmation; no phantom booked client/charge             |
| BKG-03 | Collect consent independently from booking; no account wall in first guest path | Demo                                              | Identity verification where required without mandatory marketing opt-in                               |
| PAY-01 | Record deposit and calculate remaining balance from actual recorded payments    | Demo, simulated                                   | Provider capture/failure/webhook/reconciliation; hosted card input; no raw card data stored           |
| PAY-02 | Checkout after arrival; separate tip; stable booked price; retry is idempotent  | Demo, simulated                                   | Unique sale/charge keys; failure/retry/refund evidence; signed tax and receipt policy                 |
| PAY-03 | Refund/cancel/adjust without erasing history                                    | Planned                                           | Partial/full refunds and failed/duplicate webhooks reconcile to provider and ledger                   |
| RBK-01 | Rebook a completed visit and retain origin/client link                          | Demo                                              | Server availability and client permission rechecked; cancellation does not inflate retention          |
| BIZ-01 | Derive revenue, utilisation, spend and rebooking from source records            | Demo                                              | Approved metric definitions, period/time-zone rules and financial reconciliation                      |
| BIZ-02 | Provide chart data table, period selection and CSV export                       | Demo                                              | Export obeys permission, scale and data-retention requirements                                        |
| INT-01 | Show traceable return opportunities with available time                         | Demo, deterministic rule                          | Evaluation against pilot outcomes; no AI/cash-growth claim without evidence                           |
| INT-02 | AI analysis/action proposal with approval and audit                             | Planned V3                                        | Read/write tool permissions, source links, model evaluation and rollback evidence                     |
| COM-01 | Appointment updates with purpose/channel/consent and delivery history           | Planned                                           | Provider receipts, suppression and opt-out behaviour tested per jurisdiction                          |
| INV-01 | Stock, consumption and sale movements share sale/visit IDs                      | Planned V2                                        | Ledger balances, reversal and per-location availability reconcile                                     |
| STF-01 | Staff permissions, capability, hours and compensation                           | Partial; capability/visual lanes only             | Server permissions and availability; versioned commission rules later                                 |
| REL-01 | Persist honest state and recover without silent data loss                       | Demo                                              | Transactional server storage, migrations and tested backup/restore; local recovery is insufficient    |
| ACC-01 | Accessible keyboard, responsive and plain error journeys                        | Partial; semantic controls and browser checks     | WCAG 2.2 AA review and assistive-technology evidence on supported browsers                            |

Executable checks map CAL/PAY/RBK/CLI/BIZ rules to `src/domain/domain.test.ts`; REL/ORG region isolation to `src/state/storage.test.ts`; connected booking/checkout/timeline interactions to `src/components/interaction.test.tsx`. Browser evidence records the actual rendered journeys separately.

## 6. State transitions and workflow acceptance

### Booking

Prototype: select service → eligible professional → free civil time → known/new fictional client → revalidate → atomically produce local appointment, demo deposit and event → persist → confirm.

Production: request → expiring hold → provider deposit intent if required → confirmed only after authorised policy/payment result. A dropped network request can be retried with the same idempotency key. A lost slot returns an actionable conflict without losing details or silently moving time. Provider failures release/expire holds according to policy. Webhook arrival order cannot double-confirm or double-charge.

### Visit

Prototype: `confirmed → arrived → completed`; arrival is limited to the fixed demo day. Completed/cancelled records cannot arrive again. Future booking cannot be checked out by changing its display.

The locally verified 0.2.2 prototype adds `confirmed → cancelled`, `confirmed → no_show`, and allocation changes while remaining `confirmed`. Only confirmed visits may use these actions. Rescheduling retains appointment/client/origin IDs and booked duration/buffer/price/deposit snapshots, excludes the original allocation during collision checks, and appends old/new staff/resource/date/time. A conflicting move leaves all original records unchanged. Cancellation/missed transitions require a reason, release active capacity, retain history and recorded deposits, and create no refund, fee, sale or outbound message. Repeating the same terminal command must not duplicate events. Completed or arrived visits cannot be moved or changed through these controls. Terminal successors are excluded from qualifying rebooking counts. Targeted local acceptance is recorded in [0.2.2 evidence](evidence/VERIFICATION_0.2.2.md); production acceptance remains outstanding.

The demo's missed-visit guard rejects future dates relative to 6 October 2026. It does not enforce elapsed appointment time within that fixed day; the operator explicitly records missed attendance. Production must require authoritative elapsed venue time and permission, not infer attendance from a date-only check.

Production additionally requires `held`, expiry, authenticated actor/timestamp/reason, versioned policy and an audit record for every transition. A completed visit is immutable except through an adjustment/reversal. Real refund or fee disposition is a separate authorised money command.

### Checkout and rebook

Given service value 95.00, deposit received 25.00 and optional tip 14.25: total sale including tip is 109.25; remaining checkout collection is 84.25; service revenue is 95.00; gratuity is 14.25. Deposit is not counted again as revenue. This example describes the demo’s tax-unconfigured money model, not a jurisdictional invoice.

After settlement, show receipt and invite rebooking. A rebook links `rebookedFromId` to the completed appointment and the same client. It does not invent a historical return or send outreach. Failures preserve the settled visit and allow choosing another slot.

### Relationship

A note append creates an event. Consent change records an event. An explicit referral creates a scoped edge and an event on both client timelines. A client’s past sales and next visit are derived from linked source records. Financial and communication events must obey permissions independently of ordinary notes.

### Storage recovery

v0.2 uses schema-versioned local snapshots and a revision check. Invalid JSON, unknown schema or broken scoped links preserve original bytes and pause writes. Export and explicit reset remain available. Failed storage writes do not advance UI state. A stale revision asks for reload. This check does not make multi-tab localStorage an atomic database; production requires transactional authority.

## 7. Permissions contract (production)

The browser demo has one fictional operator. Local server workspaces enforce owner, manager and reception command permissions. The table below remains the **full production policy target**; LOCAL-01 (in review) gives an assigned practitioner a scoped read of their own visits and minimal client context, and only the welcome and note commands for that scope; main refuses practitioner access until it merges.

| Action                          | Owner                                 | Manager        | Front desk                            | Professional         | Guest                                    |
| ------------------------------- | ------------------------------------- | -------------- | ------------------------------------- | -------------------- | ---------------------------------------- |
| Organisation billing/membership | Yes                                   | Explicit grant | No                                    | No                   | No                                       |
| Service/resource configuration  | Yes                                   | Yes            | No                                    | No                   | No                                       |
| Book/reschedule scoped visit    | Yes                                   | Yes            | Yes                                   | Assigned scope only  | Own verified booking via restricted link |
| View ordinary client context    | Yes                                   | Scoped         | Scoped                                | Assigned visits only | Own submitted details only               |
| View revenue/export all clients | Yes                                   | Explicit grant | No by default                         | No                   | No                                       |
| Checkout/refund                 | Yes                                   | Yes            | Explicit limit; refund grant separate | No by default        | Hosted own payment only                  |
| Marketing/send campaign         | Explicit purpose/consent and approval | Explicit grant | No by default                         | No                   | Opt-in/out only                          |
| Clinical data                   | Separate product policy               | Separate       | Separate                              | Separate             | Separate                                 |

A staff capability is not a permission grant. A public booking link never reveals the client directory, appointment client names, other clients’ events or organisation reporting. Server enforcement and cross-tenant tests are mandatory before a pilot; the local `/booking` route is not a security boundary.

## 8. UK and US localisation

| Concern     | UK                                       | US                                             | Contract                                                                                          |
| ----------- | ---------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Currency    | GBP minor units                          | USD minor units                                | Stored on financial records; no mixed totals                                                      |
| Date/time   | en-GB; 24-hour convention                | en-US; 12-hour convention                      | Venue IANA zone independent of viewer locale                                                      |
| Phone       | +44 examples                             | +1 examples                                    | Preserve country code; production parsing/verification                                            |
| Tax         | Business/service VAT classification      | State/local/service sales-tax classification   | Explicit tax policy/version and price inclusion; provider/adviser acceptance; demo applies no tax |
| Gratuity    | Optional                                 | Optional and more visible where appropriate    | Separate liability/allocation and reporting; never default a compulsory tip                       |
| Messaging   | UK privacy/PECR policy                   | Federal/state/channel policy                   | Purpose, channel, consent source/version and withdrawal; jurisdiction-qualified review            |
| Staff model | Employee/contractor/renter as configured | Employee/contractor/booth-renter as configured | Explicit role/compensation; no inference from country                                             |

Core preferences must avoid collecting clinical information. Later non-clinical forms still need data classification. HIPAA applicability is entity-specific, and non-HIPAA health products may have separate obligations; [research](RESEARCH.md) records the primary sources and qualified-review gates.

## 9. Intelligence and analytics

Present “Saleane noticed” is deterministic: a client’s last completed visit was at least 28 days before the demo day, they have no next confirmed visit and are not currently arrived. Tomorrow’s first available facial slot with Maya comes from the booking rules. The operator reviews a booking; no message or AI request is made.

| Metric             | Present definition                                                                          | Production refinement                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Booked value       | Non-cancelled visit price snapshots by visit date                                           | Status policy, tax inclusion and cancellation treatment                                  |
| Service revenue    | Completed service amounts less discount/inclusive tax, by visit date; tips/refunds separate | Accounting policy, refund adjustments, recognition dates                                 |
| Service spend      | Sum of client’s completed service receipts                                                  | Permissioned lifetime scope, adjustments and retention                                   |
| Utilisation        | Service minutes ÷ configured staff capacity after closures (current schedule)               | Actual bookable staff hours and closures; report treatment/buffer/processing separately  |
| Rebooking          | Completed cohort with an explicit non-cancelled next-visit link ÷ completed cohort          | Time window, visit status and attribution policy                                         |
| Return opportunity | Last completion ≥28 days ago, no next booking, not arrived                                  | Service-specific cadence, client channel preferences, consent and wait-list availability |

Production analytics events need organisation/location/actor IDs, correlation/command IDs, version, occurrence time and source. Avoid exporting personal details in analytics. Evaluate booking completion, checkout correctness, rebooking, cancellation recovery and support burden; no invented conversion uplift is approved.

## 10. Non-functional release targets

These are V1 targets to test, not demonstrated guarantees:

- Tenant isolation and deny-by-default permissions, including exports and AI tool access.
- No double booking/charge under concurrent requests and webhook replay; server transactions and scoped uniqueness.
- WCAG 2.2 AA, 200% zoom/reflow, keyboard/assistive-technology and touch journey evidence.
- Schedule/client operations feel immediate; target p95 API reads under 500ms and booking commit under 1s excluding provider/network delay, measured in pilot conditions.
- Supported current Chrome, Safari and Firefox; mobile iOS/Android booking. Current browser evidence covers Chromium only; targeted tests are not an accessibility certification. LOCAL-05 (in review) records a WCAG 2.2 A/AA rule sweep, 320px reflow, keyboard daily loop and measured local load in `docs/evidence/LOCAL-05.md`; Safari, Firefox and screen-reader runs remain open.
- Monitored service availability and incident response; choose contractual SLO after infrastructure/pilot evidence rather than promising uptime here.
- Encrypted transport/storage, managed secrets, scoped audit logs, data retention/export/deletion and restore procedures.
- Provider outage has an explicit state and manual recovery path; no silent optimistic confirmation of payment.
- Migration/import preserves IDs or explicit source mapping, duplicates are reviewed, rollback is rehearsed.

## 11. Release gates

| Gate           | v0.2 review                                         | V1 production                                                                   |
| -------------- | --------------------------------------------------- | ------------------------------------------------------------------------------- |
| Product        | All requested routes usable and coherent            | Onboarding and actual daily operations proven with pilot                        |
| Local quality  | Lint, tests, build and rendered journey evidence    | Same checks plus server/provider/performance/browser coverage                   |
| Security/state | Honest demo boundary, no committed secrets          | Tenant/role tests, threat review, secure storage and auth                       |
| Money          | Simulated math and retry invariants                 | Live/test-provider capture/refund/webhook/reconciliation, approved receipts/tax |
| Data/recovery  | Snapshot failure and stale-tab behaviour            | Backup/restore, migration, export/deletion, monitoring                          |
| Regional/legal | Scope and unresolved decisions documented           | UK/US policy, privacy, consent, processor and contract acceptance               |
| Release        | Feature branch ready for review; no automatic merge | Explicit release approval, rollback and production acceptance                   |

The verification ledger names the environment and observed result. Missing evidence remains a gap. Do not promote a future requirement to implemented merely because a document or TypeScript shape exists.

## 12. Decisions and change control

Changing the durable identity, money model, clinical boundary, canonical name or authority model requires an architectural decision and reviewed migration. Normal interaction/layout improvements can proceed with equivalent accessibility and flow evidence.

Open decisions: pilot studio, provider selections, verified guest identity, production tax/cancellation/retention policies, commission/contractor handling, licensed final wordmark, trademark/domain clearance and real customer usability findings. Resolve them in the roadmap order rather than building disconnected feature pages.

## 13. Product bible context and release reconciliation

Read [PROJECT_CONTEXT](PROJECT_CONTEXT.md) for the recovered conversation and [original PRD transcription](archive/ORIGINAL_PRD_TRANSCRIPTION.md). This contract fulfils the requested **PRD v0.1 product-bible stage**; its repository revision is 0.4, preserving the previous 0.2 contract history. Software and document versions do not certify one another.

Initial ICP is **1–10 practitioners, 1–2 locations**, premium independent beauty/spa/wellness in UK and USA. The two-to-five-person single-location pilot is a proposed validation cohort. Core promise: reduce administration and make the relationship, day and money understandable without making the owner a software operator. Full payroll, insurance billing, EMR, consumer marketplace, website builder, accounting replacement, autonomous clinical advice and arbitrary workflow builders are not first-V1 scope.

Earlier foundation P0 lists were broader than the later V1/V1.5/V2/V3 roadmap. The later staged direction governs release scope: forms/packages/memberships/inbox follow daily operations; retail/commissions and multi-location UI follow relationship authority; advanced intelligence follows trustworthy metrics. No original capability is treated as implemented because it appears in a document. Ordinary forms do not become a route for health data.

## 14. Detailed operating contracts

### Organisation, readiness and lifecycle

An account is a person; a membership grants access to a particular organisation/location; a practitioner record describes delivery capability. They are different entities. A revoked membership must cease authorising reads, writes, exports and jobs immediately on the server. Prevent removal of the last owner. New organisations start with an explicit market, currency, IANA zone and non-clinical classification. Currency/zone changes require impact review and cannot reinterpret old events.

Publish booking only after services, qualified people, resource capacity, opening hours, policy versions and required provider configuration pass readiness checks. Inactive services/staff/resources remain in history but cannot receive new allocations. If a proposed closure overlaps confirmed visits, show affected visits and require a resolution plan; never silently cancel them.

### Scheduling

Allocation reserves both staff and resource for treatment plus required turnaround. Working hours, breaks, holidays, capability, lead time, booking horizon and policy belong to the venue, with staff-specific overrides. A slot must fit wholly within the intersection. “No preference” selects an eligible available person with a deterministic, documented order and discloses the assignment before confirmation. Server revalidation can offer an alternative but cannot silently swap a named professional.

A reschedule retains appointment ID, client, origin, price/duration/buffer/deposit snapshots and money history while appending old/new allocation, actor, reason and timestamp. It validates using the booked duration even if catalogue duration changed. Cancelled time is released; paid deposits remain in the ledger awaiting policy disposition. Cancelled/completed records cannot arrive or settle. No-show is distinct from cancellation and requires the scheduled visit to have passed. Recurrence, multi-service processing gaps and multiple practitioners are later extensions, not implied by one-service booking.

### Relationships and lifecycle

The timeline is a projection of visits, money, notes, consent, communications and explicit edges. It must link to a source object and identify the actor; correcting ordinary text preserves attribution. Never expose restricted fields by embedding them in an event description. A graph edge has type, provenance and correction history. Email/phone cannot automatically merge people or establish a household.

Future lifecycle definitions: discovered/enquired require an explicit attributable enquiry; first visit and returned derive from completed visits; regular derives from a versioned cadence rule with adequate history; member requires an active contract; advocate derives from explicit referral evidence; VIP is an audited business designation. These can overlap and are not a mandatory linear funnel. A pause/opt-out suppresses outreach. “At risk” is an explainable operating hypothesis, never a health or personal-worth inference.

### Money

A sale is separate from money movement. Deposits are liabilities until applied or resolved; refunds, fees, tips, discounts and tax have their own reasons and references. Store currency, source amount, tax classification/version, inclusive/exclusive basis, rounding and policy on immutable sale lines. Front desk discount/refund authority has explicit limits. Cash and external-terminal recording need actor, method and reference; they are not provider-capture evidence.

Pending, authorised, captured, failed, unknown, refunded and disputed outcomes must remain distinct. Idempotency binds tenant, actor/action and request fingerprint; reusing a key with different content is a conflict. Out-of-order webhooks cannot move a final refund back to captured. Disputed/late-captured deposits surface in reconciliation. Receipt delivery failure does not reverse a successful payment. Cancellation does not automatically prove deposit forfeiture is lawful.

### Communication

Each communication has client, purpose, channel, template/version, recipient, related visit, authority, attempt and delivery receipt. Appointment updates use approved operational templates; inserting a promotion changes the review. Check consent/suppression both when queued and immediately before dispatch. Retry provider calls only with durable idempotency and a bounded reconciliation policy. Queued, sent, delivered, bounced, suppressed and unknown are different states. “Done for you” counts verified outcomes, not queued intentions.

### Daily brief and reporting

Today shows the actual agenda, unresolved operational exceptions and source-linked opportunities. Empty sections explain an uneventful day without fabricated activity. The original illustrative “£4,000 below target” question belongs to later analysis backed by a target record, comparable period, location/currency, booked versus earned distinction and visible source rows. An estimate includes method, horizon and coverage; it is not guaranteed recovered revenue.

Rebooking uses an explicit originating completed visit and a qualifying uncancelled successor. Retention is separately defined as a completed return in an agreed window. Utilisation denominator is actual bookable staff time after shifts/closures, with treatment and buffer occupancy reported separately. Cash reconciliation compares ledger captures/refunds/fees against provider statements by settlement period, not merely visit date.

## 15. Additional requirement register

Statuses below describe requirements not satisfied by the original 0.2 browser foundation. Read the changelog/evidence for subsequent implementation; production acceptance remains separate.

| ID     | Contract / acceptance example                                                                                                | Priority and target | Current evidence boundary                             |
| ------ | ---------------------------------------------------------------------------------------------------------------------------- | ------------------- | ----------------------------------------------------- |
| ORG-03 | Revocation/session expiry denies next request; last owner cannot be removed; recovery links single-use                       | V1 / 0.3            | Specified; server draft unverified                    |
| CAL-04 | Hours, breaks, closures and archived capability constrain availability; closure lists affected visits                        | V1 / 0.4            | Specified                                             |
| CAL-05 | Move validates booked snapshot and leaves original unchanged on conflict; cancel releases allocation without erasing deposit | V1 / 0.4            | 0.2.2 locally verified; server acceptance outstanding |
| CLI-05 | Explain lifecycle/cadence criteria; sufficient-history threshold; pause excludes outreach                                    | V1.5                | Specified; current return rule remains simplified     |
| BKG-04 | No preference returns eligible available assignment; never exposes private schedule/client records                           | V1 / 0.4            | Specified                                             |
| BKG-05 | Signed/expiring own-booking link; tampered/foreign/revoked access denied; generic error                                      | V1 / 0.4            | Specified                                             |
| PAY-04 | Versioned tax/cancellation/deposit/receipt policies; change cannot rewrite a booked promise                                  | V1 / 0.5            | Specified                                             |
| BIZ-03 | Reconcile earned, collected, liabilities, tax, tips, refunds and fees with source coverage                                   | V1 / 0.5–0.6        | Specified; current report is simplified               |
| MIG-01 | Dry run → mapped/duplicate/rejected review → cutover → balanced reconciliation → rollback drill                              | V1 / 0.6            | Specified; actual exports needed                      |
| GOV-01 | Data/access audit, scoped export, retention and erasure exceptions; sensitive fields omitted from logs                       | V1 / 0.3–0.6        | Specified                                             |
| OFF-01 | Authorised minimum daily snapshot, visible age, no writes, clear on logout, revalidate on reconnect                          | V1 / 0.6            | Specified; localStorage demo is not this feature      |
| MSG-02 | Two-way thread, waitlist offers and channel suppression; actual delivery state                                               | V1.5                | Specified; V1 only qualified appointment updates      |
| REL-02 | Non-clinical forms and policy version; packages/memberships/gift-card opening/redemption/refund liabilities                  | V1.5                | Specified                                             |
| CAL-06 | Recurrence exceptions, multi-practitioner segments and calendar integration authority                                        | V2                  | Specified; source ideas preserved                     |

Screen/journey traceability lives in [UX_ARCHITECTURE](UX_ARCHITECTURE.md), particularly UX-01–38 and J-01–08. Each implementation change names requirement, failure case, automated evidence and browser evidence before promotion.

## 16. Offline, data and operational acceptance

OFF-01 is explicitly **read-only**. Cache only the authenticated role's approved daily fields: visit time, service, staff/room and minimum client/contact context needed for the day. Ordinary notes are opt-in and field-scoped; no clinical data, full money/export history or marketing lists. Show last successful sync and expiry, clear on logout/workspace change, avoid shared-device persistence by default, and document that offline revocation cannot be instantaneous. A bounded expiry, device policy and threat review are required before enabling persistence. Reconnect revalidates identity/role and replaces the snapshot before writes resume.

Production import needs a manifest, immutable source mapping, dry-run counts/errors, reviewed duplicates, consent defaults, currency/time validation and explicit financial opening balances. Do not silently import unsupported liabilities or clinical records. Backups need measured restore evidence and an assigned incident responder; a successful file export alone is insufficient. No claimed recovery-time or uptime guarantee precedes infrastructure evidence.

## 17. Validation and launch scorecard

These are proposed acceptance targets for a supervised pilot, not measured performance or contractual promises:

| Outcome                | Measurement / proposed criterion                                                                                                       | Evidence owner                     |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| First bookable service | Unassisted setup under 20 minutes with supplied business data; log help requests                                                       | Product                            |
| Front-desk context     | Known client and next visit found within 15 seconds in representative data                                                             | UX                                 |
| Booking                | At least 8/10 recruited participants finish phone booking without facilitator intervention; investigate every wrong-time/price outcome | UX                                 |
| Scheduling correctness | Race last staff/room capacity, buffer boundary, closure and DST cases; zero invalid confirmed allocations                              | Engineering                        |
| Checkout               | Deposit/tax/tip/refund scenarios reconcile exactly; no duplicate charge under retries/replays                                          | Engineering + finance              |
| Migration              | Counts and monetary totals reconcile or have explicitly signed exceptions; rollback rehearsed                                          | Implementation                     |
| Permissions            | Cross-tenant, revoked, front-desk/export and assigned-practitioner tests deny both read and write leaks                                | Engineering                        |
| Continuity             | Outage state is unmistakable, offline writes blocked, restore succeeds with recorded duration                                          | Operations                         |
| Relationship value     | Measure 30/90-day cohort returns, rebooking and support burden against a recorded baseline                                             | Product; no invented uplift target |

Ten participants provide formative evidence, not statistical market validation. Pricing uses the preserved £/$ hypotheses in Research with real cost/usage scenarios. Final visual choice, pilot, provider and legal policies remain explicit decisions. These unknowns do not block bounded design or fictional-data engineering; they do block claims that the whole commercial product is production-ready.
