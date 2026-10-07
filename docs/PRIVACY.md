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

**Deletion needs approval.** Reaching the end of a period never deletes anything by itself. An owner or manager approves each deletion (`DELETION_APPROVERS` in `src/domain/dataRetention.ts`). Reception and practitioners cannot.

## Erasure

The erasure review shows what a decided policy could remove (contact details, preferences, notes, unsent messages, connection links) and what must stay with its reason (receipts, payments, refunds, booked visit terms, consent history, audit history). Recording a request adds an audit row and shows it on the client. Withdrawing email marketing uses the existing consent command, which suppresses queued marketing messages; drafts stay unsent drafts.

Decided on 7 October 2026: notes are included word for word with a warning, one open erasure request per client, and deletion only with owner or manager approval. Before any destructive step is built, decide: whether the name on kept receipts stays or becomes a reference; how a request is verified; how upcoming visits are handled; how erasure is reapplied after a backup restore; and how to answer within the legal deadline.
