# SALEANE project context and decision record

6 October 2026. This is the continuity document for product, design and engineering. Read it with [Research v0.2](RESEARCH.md), the [PRD](PRD.md), [UX Architecture](UX_ARCHITECTURE.md), [Vision](VISION.md) and [Roadmap](ROADMAP.md). Document versions and software versions are separate: the application is locally verified at 0.2.2; Research v0.2 and PRD v0.1 describe the product rather than certify a production release.

## Source and limits

The source is the ChatGPT conversation **Evaluate Saleane Name**, ID `6ac48a00-b6c0-83eb-bedb-46934c7b4b9d`, plus the user's direct instructions in this Codex chat. The conversation reader exposed only five later turns. On 6 October, the authenticated browser exposed the earlier messages: the visible conversation was read from the initial naming discussion through research, UK/USA positioning, the proposed sequence, foundation work, the request to strengthen it, and the repository handoff. The readable `02-prd.md` attachment was also inspected. This supersedes the earlier tool-only context limitation.

The earlier assistant described a research pack, UX map, three visual directions and HTML prototype. References included `Saleane_Foundation_v0.1.zip`, `02-prd.md` and `saleane-visual-directions.png`. Two ZIP download attempts and the PRD download did not return a file; the PRD preview did work. [The PRD transcription](archive/ORIGINAL_PRD_TRANSCRIPTION.md) preserves its readable content and provenance. The archive, workbook and original visual-image bytes have not been imported. The original visual board was subsequently opened and inspected directly in the authenticated browser. The user rejected the first text-led studies and instructed us to follow that image, including photography. Current studies and app visuals follow the inspected board; new generated imagery is not represented as original recovered bytes.

The user's pasted sequence in this chat supplies direct, current authority for the work below. If the original files become available, archive them intact, compare decisions and resolve discrepancies; never silently replace the repository with an older ZIP.

## Recovered conversation, in order

| Stage               | Context carried forward                                                                                                                                 | Status                                                                                                                               |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Naming              | Company and software use Saleane; etymology claims about lunar/French/Arabic/Old English roots were questioned, not established                         | No invented origin story; pronunciation and trademark/domain clearance remain open                                                   |
| Category research   | Client and Business OS; reduce administration for businesses with little back-office capacity                                                           | Strategic thesis, not validated product-market fit                                                                                   |
| First audience      | Premium independent beauty, spa and wellness; 1–10 practitioners, 1–2 locations; facials, massage, brows/lashes, nails, body and non-medical aesthetics | Initial ICP; a 2–5-person single-site pilot is a narrower proposed test cohort                                                       |
| UK and USA          | Currency, time zones, sales tax/VAT, gratuity, contractor/renter models, communications and migration change the product                                | Explicit target markets; no assumption that one US policy covers every state                                                         |
| Product bible       | Doctrine, jobs, operating model, data, flows, permissions, acceptance and gates belong together                                                         | Governs the PRD and UX architecture                                                                                                  |
| Experience          | Today, Calendar, Clients, Inbox, Business; client timeline is the signature; compact right-side appointment preview                                     | Fixed information hierarchy; Inbox ships when actual delivery authority exists                                                       |
| Commercial idea     | UK Solo £29, Studio £59, Business £99, multi-site £199+; US $29/$69/$119-ish                                                                            | Untested monthly hypotheses, not approved offers; recovered workbook text proposes 1/up-to-5/up-to-10 practitioners and one location |
| Visual concepts     | A Quiet Luxury, B Modern Editorial, C After Dark                                                                                                        | A was the earlier assistant's favourite, never a recorded user selection; C guest/marketing rather than primary operating UI         |
| Foundation handover | Visible workbook output reports 46 requirements, 36 screens, 31 sources, 12 risks; zero verified production requirements                                | Historical output only; underlying workbook bytes unavailable, not independently verified                                            |
| Stronger brief      | Weighted, permanent, established; custom components; Vite/React/TypeScript; end-state first                                                             | Later instruction refines the early luxury references                                                                                |
| Durable delivery    | Local editable files and private GitHub, truthful changelog, tested branch, no auto merge                                                               | Current delivery policy                                                                                                              |

## Product context that must survive scope reduction

The relationship spans discovery, enquiry, consultation, booking, forms, deposit, visit, retail, feedback, aftercare, rebooking, membership, referral, practitioner changes, pauses, lapses and recovery. V1 implements the daily loop; later stages keep their place in the roadmap. A client graph is a proposed source of product advantage, not a proven moat.

Today asks what needs attention, exposes useful opportunities and shows work actually completed. “Done for you” requires delivery/action receipts. Original example revenue, client counts, forecasts and recovery values are illustrative, never performance claims. The quiet global command field should grow from search to source-linked analysis to approval-led actions.

Booking belongs to the business. No mandatory consumer account, forced marketplace, competitor promotion or app install. Offer no practitioner preference as well as a named person. Preserve “House of Amara” as an early fictional illustration; “Atelier House” is the current fictional fixture, not a brand decision for a real customer.

Offline continuity means a deliberately limited, authorised, read-only daily snapshot with an obvious age. It does not mean offline money collection or queueing unsafe bookings. Inventory distinguishes retail from professional consumption. Migration, portability and predictable pricing are part of the product, not onboarding chores added at launch.

## Reconciliation decisions

- Early PRD P0 included memberships, forms/photos, inbox, waitlist and AI alongside core booking. The later V1 → V1.5 → V2 → V3 sequence narrows release scope. Those earlier requirements are retained in the feature map, not silently discarded.
- Early client examples included skin response/sensitivity and photos. The later Clinical boundary controls: no health notes, treatment-response records, clinical images or health-derived segments in core. Even ordinary future forms require classification.
- The early assistant's Quiet Luxury preference was not user approval. The user's later rejection of our new studies and request to follow the original image now govern visual work. The revised app follows its warm/light/serif expression, with three closely controlled reference-based studies. Final brand acceptance is still the user's decision.
- The original £/$ pricing ideas remain test stimuli. Current competitor prices are checked separately, with billing/region/offer qualifications.
- The source's completion ticks describe its own claimed foundation. They do not establish current server, provider, legal, deployment or usability evidence.
- Product-document versions are independent of application versions. The product bible fulfils the requested PRD v0.1 stage; this repository's contract continues at revision 0.3 to preserve its existing 0.2 history.

## The governing sequence

1. **SALEANE Research v0.2:** bounded UK/USA differences, customer jobs, competitor teardown, regulations, payments, migrations and pricing.
2. **SALEANE PRD v0.1:** a full product contract with explicit behaviour, state, permission, data and acceptance requirements.
3. **SALEANE UX Architecture:** every V1 screen, journey and exception; future modules have a clear place without pretending they already work.
4. **SALEANE Visual System:** three controlled directions, tested with the same operational content.
5. **SALEANE Prototype:** visibly operate Today → Calendar → Client → Appointment → Checkout → Rebook → Intelligence, plus the connected public booking journey.
6. **Build the real thing:** server authority and provider-backed operations follow those contracts, with evidence and a reviewable branch.

Research and design overlap. Do not wait for every commercial or legal question before drawing screens. Equally, a working prototype must not be mistaken for a finished research/design process. Design discoveries feed back into the PRD; production money and data need their own release gates.

## End-state reasoning

Saleane is the company and the platform. “Saleane OS” may describe its category but is not a second brand. The ambition is an operating system for modern beauty, spa and wellness businesses, beginning with a dependable daily operating loop and growing through relationships, business operations, intelligence, concierge and network capabilities.

The client relationship graph, appointments/resources, money, inventory, communications, staff and intelligence share durable identities and events. V1's client, appointment, resource, sale and event model must survive the journey to V5. A future capability extends those foundations rather than becoming an isolated tool with copied customer records.

The first production slice is organisation/account → services → team/resources → calendar → clients → branded booking → deposits → appointment → checkout → rebook. The user asked for the end goal to govern the beginning, while keeping the first usable product focused.

## Decision ledger

| ID   | Decision / context                                                  | Authority and status                     | Consequence                                                                                                            |
| ---- | ------------------------------------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| D-01 | Canonical spelling **SALEANE**, without accent                      | Explicit handoff/user instruction; fixed | Same spelling in mark, URLs, search, accessibility and product records; no inferred trademark clearance                |
| D-02 | UK and USA are target markets                                       | Explicit instruction; fixed              | Currency, venue zone, tax, consent, staff and migration policies are model inputs, not a last-minute locale switch     |
| D-03 | Weighted, established, resilient visual character                   | User language; fixed brief               | Strong structure and legibility; professional operating density; warmth without spa clichés                            |
| D-04 | Custom Saleane tokens/components over accessible headless behaviour | Explicit instruction; fixed              | Radix can supply behaviour; a default shadcn theme is not the brand                                                    |
| D-05 | Three controlled visual directions precede final visual commitment  | Direct sequence restated here            | First new studies rejected; follow the original generated board, including imagery                                     |
| D-06 | Relationship ownership and connected source records                 | Source conversation + handoff            | The timeline, checkout and intelligence reference the same records; client email is contact data, not primary identity |
| D-07 | Saleane Clinical is a later, deliberate compliance boundary         | Explicit instruction; fixed              | No clinical charts, diagnosis, treatment decision support or health-data inference in the core launch                  |
| D-08 | GitHub is the permanent source of truth                             | Explicit instruction; fixed              | Code, research, contracts, evidence, changelog and roadmap stay in `EmotiveImpact/saleane`; preserve original work     |
| D-09 | Review without automatic merge                                      | Explicit instruction; fixed              | Feature branches and PRs; merging and deployment are distinct later actions                                            |
| D-10 | UXio unavailable                                                    | Capability fact at foundation build      | Do not claim UXio research or integration; use primary product/help documentation and inspectable patterns             |
| D-11 | Local prototype is not provider or production evidence              | Required truthful reporting              | State the environment for every test and keep live release gates visible                                               |
| D-12 | Pilot business, final visual direction, price and providers         | Not yet approved                         | Make concrete recommendations and validation plans; do not present inferred selections as user decisions               |

## Where the repository actually stands

At intake the repository contained only its initial README. The initial commit and exact README bytes were preserved. The repository was public and was made private to meet the user's stated brief.

Software 0.2.0 at `287e02c` implemented the connected browser-local prototype, custom slate/mineral design, 41 tests and tracked Chromium evidence. PR #1 is the review surface. That established useful working behaviour but did not complete the full research or UX/visual comparison requested above.

A server-authority draft was started, then preserved on local branch `wip/saleane-server-authority` at `f73d084` while these contracts were reconciled. It is unverified draft work, not a shipped server or production feature. The review branch retains the verified prototype until a tested server slice is integrated.

## Current continuation — 0.2.2 locally verified

The user authorised further building and inspecting Caleane for useful component handling/styling. The read-only source audit considered its shared controls and calendar at `/Users/augustusedem/Calenne/app/src/components/workspace/WorkspaceUI.jsx`, `CalendarWorkspace.jsx` and `calendar-workspace.css`. The transferable ideas are interaction structure: persistent drawer heading, independently scrolling content, explicit selection and keyboard-accessible choices. Keep SALEANE's original serif, light ivory navigation, sage surfaces, imagery and forest actions; Caleane is a pattern reference, not replacement branding.

The current local slice adds confirmed-appointment rescheduling, cancellation and missed-visit history; retains booked snapshots, appointment identity and recorded deposits; improves calendar navigation/selection/history; and uses native radio choices for moving visits. It does not simulate refunds, fees or messages. Missed attendance remains an explicit operator decision under a fixed demo date, with authoritative time and permissions reserved for production. Final local checks passed: zero lint warnings, 72 tests across three files, TypeScript and the combined app/studies build. Targeted in-app browser journeys verified keyboard-radio rescheduling, cancellation/history, Escape fallback and phone missed-visit history; six routes passed measured 320px/1440px overflow and image checks. The [0.2.2 evidence](evidence/VERIFICATION_0.2.2.md) records limits: inline screenshot inspection, no accurate archived panel captures, no full accessibility certification, and no pushed-commit CI or deployment claim.

Next, qualify shared backend/authentication and transactional organisation authority before communications/payment providers. Move the existing domain commands behind that authority, then prove consent/delivery receipts and provider reconciliation. Extend the same relationship/calendar/money/staff records toward inventory and intelligence; Clinical remains a later segregated compliance boundary. The preserved server draft is useful input, not a shortcut around acceptance.

## Carry-forward rules

- Preserve all prior decisions above unless the user changes them; distinguish our recommendation from their approval.
- Update requirement status with evidence, not with the existence of a schema or a document.
- Keep the operational and guest experiences connected while respecting a real access boundary in production.
- Give the owner one understandable daily operating loop before adding broad future navigation.
- Retain source dates, region, billing terms and confidence with competitor observations. Public documentation is not a completed logged-in usability test.
- Record a design-discovered problem as a PRD change and a testable journey, not just a visual patch.
- Keep speculative claims, invented conversion gains and private internal reasoning out of public marketing copy.

## Repository backup status

On 6 October, at the user’s request to push everything, both `feat/saleane-foundation` (`3eaf169`) and the separate `wip/saleane-server-authority` draft (`f73d084`) were verified on the private GitHub remote. The WIP backup is not a qualified release or a merged implementation. At that backup checkpoint, the Saleane development server on port 5173 was retained and the duplicate preview on 4173 was stopped; this is historical session state, not a current server-health claim. Generated dependency/build caches are reproducible local files and are not source deliverables.

## User-directed local V1 build · 6 October 2026

The user requested a team of agents to advance the application to version 1.0, then explicitly chose **“Build locally first; keep live services unconfigured.”** Three agents covered domain/continuity, server authority/recovery and operational UX; the main agent integrated the application, maintained one server, verified browser journeys and prepared the review branch.

The resulting package is labelled **1.0.0-rc.1** to distinguish a local release candidate from the existing production V1 acceptance contract. The original browser demo, history, research and visual direction remain preserved. Hosted services were not configured, no real communications or payments were sent, and no automatic merge/deployment was authorised. The old server draft remains preserved on its separate branch.
