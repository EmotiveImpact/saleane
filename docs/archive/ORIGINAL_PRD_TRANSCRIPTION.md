# Original 02-prd.md — readable-content transcription

Read 6 October 2026 from the attachment preview in **Evaluate Saleane Name**, conversation `6ac48a00-b6c0-83eb-bedb-46934c7b4b9d`. This is a transcription of rendered text, not the original Markdown bytes. Download did not return a file. Preserve as historical source; the current PRD supersedes its release scope, particularly photos/forms/health context and V1 priorities.

## 02 — Product Requirements Document

### Product

Saleane — client and business operating system for beauty, spa and wellness.

### Promise

Run the day, know every client, protect revenue and reduce administration without forcing the owner to become a software operator.

### Personas

- Owner-operator: delivers services while managing bookings, cash, clients and marketing.
- Studio owner/manager: manages 2–10 practitioners, utilisation, staffing, permissions and cash.
- Practitioner: needs today's schedule, client context, forms, notes and easy checkout/rebook.
- Reception/front desk: needs rapid booking changes, waitlist, search, deposits, messages and exception handling.
- Client: needs fast branded booking, clear policies, forms, payment and rebooking without account friction.

### North-star workflow

Book → prepare → serve → pay → rebook → retain.

### P0 requirements

**Business & service configuration:** Organisation, location, timezone, currency, locale, team/roles, services/categories, durations/prices/buffers, practitioner eligibility, room/resource requirements, opening hours, availability and cancellation/deposit policy.

**Calendar & booking:** Day/week calendar; create/move/reschedule/cancel; conflict prevention; branded online booking; service → practitioner preference → time → details → policy/deposit → confirmation; waitlist; appointment statuses; audit important changes.

**Clients:** Identity/contact; communication preferences/consent; history; preferences/tags; forms/waivers; permission-scoped notes; photos with permission state; memberships/packages; spend/visit metrics; relationship timeline.

**Payments & checkout:** Deposits; service/product basket; gratuity where applicable; discounts with permission; tax configuration; payment-method abstraction; refunds; failed-payment recovery; receipt; rebook prompt.

**Inbox:** Transactional reminders; two-way thread model; templates; marketing consent separated from operational messages; waitlist/rebooking outreach.

**Today:** Booked value; appointments; utilisation; exceptions; revenue gaps; overdue/rebooking opportunities; “done for you” automation ledger.

**Business:** Revenue; utilisation; rebooking; retention/lapse; membership state; cancellation/no-show rate; retail/service mix.

**Saleane Intelligence:** Assistive, explainable and approval-led: daily brief; natural-language business questions; schedule-gap detection; rebooking-pattern signals; draft outreach; evidence behind recommendations. No autonomous marketing without configured authority and consent checks.

### Non-functional requirements

Multi-tenant isolation; least-privilege roles; audit trail; encrypted transport/storage; backup/restore; idempotent financial/booking mutations; webhook/notification observability; timezone-safe scheduling; WCAG 2.2 AA target; responsive staff web app; mobile-first booking; export/delete/retention mechanisms.

### Explicit first-V1 non-goals

Full payroll; insurance billing; clinical EMR claims; consumer discovery marketplace; custom website builder; accounting-ledger replacement; autonomous clinical recommendations; arbitrary no-code workflows.

### Success metrics

Time to first bookable service; booking completion; reschedule time; cancellation recovery; rebook rate; weekly active locations; recommendation action rate; support contacts/location; failed-webhook recovery; 30/90-day retention.
