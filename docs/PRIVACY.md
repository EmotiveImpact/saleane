# SALEANE privacy and data lifecycle

LOCAL-03 (PRD GOV-01). Prepared 6 October 2026. **The owner decided these rules on 7 October 2026.** Nothing in SALEANE deletes or anonymises records automatically. When a record reaches the end of its retention period it becomes due for deletion and waits until an owner or manager approves it. No deletion step is built yet. Confirming the periods with a qualified privacy adviser before a live pilot is still recommended.

## Who can do what (decided)

| Action                                  | Owner | Manager | Reception | Practitioner |
| --------------------------------------- | ----- | ------- | --------- | ------------ |
| Preview and download a client data copy | Yes   | Yes     | No (403)  | No (403)     |
| Review an erasure and record a request  | Yes   | Yes     | No (403)  | No (403)     |
| Withdraw email marketing (existing)     | Yes   | Yes     | Yes       | No           |
| Preview and download the studio export  | Yes   | No      | No        | No           |
| Read the privacy record (the audit log) | Yes   | Yes     | No        | No           |

The server checks every role; the screens only explain. Each download writes `client.exported` or `studio.exported` to the audit log, and each erasure request writes `client.erasure_requested`, with the actor, record id and time only. No exported content is logged. A preview is not logged.

## What a client data copy holds

Included: profile and contact details, "Good to remember", email marketing consent and its history, every visit with its booked terms, the receipts, payments, deposits and refunds for those visits, timeline entries, unsent messages with their real status, and client connections as a type only.

Excluded: other clients' names and details (relationship entries are reworded, connections show only their type), staff credentials, sessions and invitations, internal record ids (visits are numbered V1, V2… within the file), request receipts, booking holds, the audit log and anything from another studio.

Free text (notes, preferences, message drafts, refund reasons) is included as written. Read it before sending, because staff may have mentioned another person. Staff names appear where they recorded an entry or looked after a visit.

## Retention register

Decided by the owner on 7 October 2026. The periods live in code in `src/domain/dataRetention.ts` and are shown on the Manage page under "How long records are kept".

| Record                                                       | Kept for                                               | Legal basis                                                    |
| ------------------------------------------------------------ | ------------------------------------------------------ | -------------------------------------------------------------- |
| Client contact details (email, phone)                        | 2 years after the last visit                           | Contract; legitimate interests; UK GDPR / US state privacy law |
| "Good to remember" and relationship notes                    | 2 years after the last visit                           | Legitimate interests; must stay non-clinical                   |
| Client connections (referral, household)                     | 2 years after the last visit; link removed on erasure  | Legitimate interests                                           |
| Email marketing consent and withdrawals                      | Until withdrawn, then 2 more years as evidence         | PECR / UK GDPR consent; CAN-SPAM and state law in the US       |
| Unsent messages (draft, queued, suppressed)                  | 90 days                                                | Legitimate interests                                           |
| Receipts, payments, deposits, refunds and booked visit terms | 6 years in the UK, 7 years in the US                   | Legal obligation (tax and accounting)                          |
| Staff accounts and memberships                               | 6 years after the person leaves                        | Contract; employment law                                       |
| Audit log                                                    | 6 years; holds ids and actions, not personal content   | Accountability; legitimate interests                           |
| Backups                                                      | 35 days rolling; erasure reapplied after a restore     | Security; integrity                                            |
| Sessions                                                     | 12 hours (enforced by expiry)                          | Security                                                       |
| Invitations                                                  | 48 hours (enforced by expiry)                          | Security                                                       |
| Public booking holds                                         | Five minutes (enforced by expiry); rows not yet purged | Security; legitimate interests                                 |
| Request receipts (idempotency)                               | Not yet set; bounded period after the request          | Integrity of money and bookings                                |

**At the end of a period, an owner or manager decides.** Reaching the end of a period never deletes anything by itself. An owner or manager either approves the deletion or keeps the record longer by a number of months or years, with years as the default (`DELETION_APPROVERS` and `extendRetention` in `src/domain/dataRetention.ts`). Reception and practitioners cannot do either.

## Erasure

The erasure review shows what a decided policy could remove (contact details, preferences, notes, unsent messages, connection links) and what must stay with its reason (receipts, payments, refunds, booked visit terms, consent history, audit history). Recording a request adds an audit row and shows it on the client. Withdrawing email marketing uses the existing consent command, which suppresses queued marketing messages; drafts stay unsent drafts.

Decided on 7 October 2026: notes are included word for word with a warning, one open erasure request per client, and at the end of a period an owner or manager either approves deletion or extends it by months or years. Before any destructive step is built, decide: whether the name on kept receipts stays or becomes a reference; how a request is verified; how upcoming visits are handled; how erasure is reapplied after a backup restore; and how to answer within the legal deadline.

## The AI supplier (NEXT-12)

Ask SALEANE and the AI receptionist run in test mode until SALEANE is given an Anthropic key (`SALEANE_AI_PROVIDER=claude`). In test mode, and always in a sample studio, nothing they read leaves SALEANE.

With Claude connected, Anthropic acts as a processor for what each request needs. For Ask SALEANE that is the person's question, the last few lines of the panel's conversation, the date, the studio's name and the asker's role, and whatever the skills return for that question (for example the day's visits with client names, a client's preferences note as the team wrote it and their visit history, stock or takings). For the receptionist it is the guest's messages in that chat, a known guest's first name, and the studio's treatments, prices, hours and free times. Clinical forms, health answers and patch test results are never given to the AI; the receptionist never asks about health and passes such questions to the team. Skill results are labelled as information, never instructions.

Talking to Ask SALEANE (NEXT-12 part 2) is off until SALEANE is also given an OpenAI key (`SALEANE_VOICE_PROVIDER=openai`), and never offered in a sample studio. While someone talks, OpenAI acts as a processor for their voice, which goes straight from their browser to OpenAI, the voice's standing instructions (the studio's name and its spelling) and SALEANE's answers for the voice to say, which can hold what Claude found in the records for that question, such as client names, times and amounts. Claude still does the thinking, through the same skills and approval step as a typed question; OpenAI is given nothing else from the records. SALEANE asks OpenAI not to keep the conversation (`store: false`), keeps no recording, and keeps the words heard and the answers only in the open panel. Before a live pilot, record OpenAI in the same places as Anthropic and confirm its retention settings for live sessions.

SALEANE keeps no copy of the AI's conversation beyond what it already keeps: Ask SALEANE's answers stay in the open panel, and the receptionist's text and social answers are kept in the outbox like any other message. Before a live pilot, record Anthropic in the studio's privacy notice and processor list, sign its data processing terms, and confirm its retention settings for API requests.
