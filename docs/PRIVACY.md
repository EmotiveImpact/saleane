# SALEANE privacy and data lifecycle

LOCAL-03 (PRD GOV-01). Prepared 6 October 2026. **Every rule below is a proposal that needs the owner's decision with a qualified privacy adviser.** Nothing in SALEANE deletes or anonymises records automatically, and no retention period is enforced yet.

## Who can do what (defaults to confirm)

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

| Record                                      | Proposed retention                                                 | Legal basis to check                                                      | Status                                     |
| ------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------- | ------------------------------------------ |
| Client contact details (email, phone)       | While the client is active, then a set period after the last visit | Contract; legitimate interests; UK GDPR / US state privacy law            | Proposed, needs owner and adviser decision |
| "Good to remember" and relationship notes   | As contact details                                                 | Legitimate interests; must stay non-clinical                              | Proposed, needs owner and adviser decision |
| Email marketing consent and withdrawals     | As long as the person may be contacted, plus evidence period       | PECR / UK GDPR consent; CAN-SPAM and state law in the US                  | Proposed, needs owner and adviser decision |
| Unsent messages (draft, queued, suppressed) | Short; remove when no longer needed                                | Legitimate interests                                                      | Proposed, needs owner and adviser decision |
| Booked visit terms                          | As long as linked receipts and deposits                            | Contract; accounting                                                      | Proposed, needs owner and adviser decision |
| Receipts, payments, deposits and refunds    | Statutory accounting period (UK commonly six years; US varies)     | Legal obligation (tax and accounting); confirm by jurisdiction and entity | Proposed, needs owner and adviser decision |
| Client connections (referral, household)    | As contact details; remove the link on erasure                     | Legitimate interests                                                      | Proposed, needs owner and adviser decision |
| Staff accounts and memberships              | While employed, then a set period                                  | Contract; employment law                                                  | Proposed, needs owner and adviser decision |
| Sessions                                    | 12 hours (already enforced by expiry)                              | Security                                                                  | Proposed, needs owner and adviser decision |
| Invitations                                 | 48 hours (already enforced by expiry)                              | Security                                                                  | Proposed, needs owner and adviser decision |
| Public booking holds                        | Five minutes (already enforced by expiry); rows are not yet purged | Security; legitimate interests                                            | Proposed, needs owner and adviser decision |
| Request receipts (idempotency)              | Bounded period after the request                                   | Integrity of money and bookings                                           | Proposed, needs owner and adviser decision |
| Audit log                                   | Fixed period; holds ids and actions, not personal content          | Accountability; legitimate interests                                      | Proposed, needs owner and adviser decision |
| Backups                                     | Rolling period; erasure must be reapplied after a restore          | Security; integrity                                                       | Proposed, needs owner and adviser decision |

## Erasure

The erasure review shows what a decided policy could remove (contact details, preferences, notes, unsent messages, connection links) and what must stay with its reason (receipts, payments, refunds, booked visit terms, consent history, audit history). Recording a request adds an audit row and shows it on the client. Withdrawing email marketing uses the existing consent command, which suppresses queued marketing messages; drafts stay unsent drafts.

Before any destructive step is built, decide: retention periods per record; whether the name on kept receipts stays or becomes a reference; how a request is verified; how upcoming visits are handled; how erasure is reapplied after a backup restore; and how to answer within the legal deadline.
