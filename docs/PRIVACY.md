# SALEANE privacy and data lifecycle

LOCAL-03 (PRD GOV-01). Prepared 6 October 2026. **The owner decided these rules on 7 October 2026.** Nothing in SALEANE deletes or anonymises records automatically. When a record reaches the end of its retention period it becomes due for deletion and waits until an owner or manager approves it or keeps it longer (Stage 6, Settings, Data & privacy, "Waiting for your decision"). Confirming the periods with a qualified privacy adviser before a live pilot is still recommended.

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

**At the end of a period, an owner or manager decides.** Reaching the end of a period never deletes anything by itself. An owner or manager either approves the deletion or keeps the record longer by a number of months or years, with years as the default (`DELETION_APPROVERS` and `extendRetention` in `src/domain/dataRetention.ts`). Reception, practitioners, general managers and regional managers cannot do either; the server refuses them.

### The decision step (Stage 6)

`src/domain/retentionDue.ts` works out, on the studio's own day, which records are due:

| Kind              | Due on                                                                                                                                                                                               | Never due while                                                                              |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Client details    | 2 years after the last day the studio had business with them: any visit booked (kept or not, including one ahead), purchase, message from them or the day they joined, across records with one email | they have an active package or membership, or money carried over from a previous system open |
| Private feedback  | 2 years after it was given                                                                                                                                                                           |                                                                                              |
| Unsent messages   | 90 days after it was written, on the studio's day                                                                                                                                                    | it was approved for sending (it may have gone out)                                           |
| Waitlist requests | 90 days after the last day asked for                                                                                                                                                                 |                                                                                              |

A date that does not exist moves to the end of its month (29 February 2024 plus two years is 28 February 2026). Keeping longer counts from the day of the decision and brings the record back on the new date.

Deleting a client keeps the record as **Former client**: name, email (replaced by an address under the reserved `.invalid` domain that can never receive mail), phone, Good to remember, birthday, postcode area, notes, connections (and their name on the other person's connection entry), unsent messages, replies, answers on social apps, missed calls, waitlist requests and private feedback go. Receipts, payments, deposits, refunds, gift cards (the buyer's name becomes Former client), packages, patch tests, forms, consultations, consent history, messages approved for sending and booked visit terms stay, as the erasure review lists. Money records stay at least 6 years (UK) or 7 years (US) after the latest of them; this step never deletes a money record. On the server, a client with a card still saved cannot be deleted until the card is removed, and their visit links are turned off.

Each decision is kept in the studio record and in Who changed what as who, when, which kind and how many (and until when, for keeping), never names, deleted record ids or the typed reason. A decision is all or nothing and refused if any record is no longer due, so nothing is deleted twice. Restoring a backup taken before a deletion brings those records back; they show as due again and wait for a new decision.

## Erasure

The erasure review shows what a decided policy could remove (contact details, preferences, notes, unsent messages, connection links) and what must stay with its reason (receipts, payments, refunds, booked visit terms, consent history, audit history). Recording a request adds an audit row and shows it on the client. Withdrawing email marketing uses the existing consent command, which suppresses queued marketing messages; drafts stay unsent drafts.

Decided on 7 October 2026: notes are included word for word with a warning, one open erasure request per client, and at the end of a period an owner or manager either approves deletion or extends it by months or years. Stage 6 settles the name on kept receipts: it becomes "Former client". Recording an erasure request still deletes nothing by itself; acting on a request before the keeping period ends is not built yet. Still to decide: how a request is verified, how upcoming visits are handled, how erasure is reapplied after a backup restore, and how to answer within the legal deadline.

## The AI supplier (NEXT-12)

Ask SALEANE and the AI receptionist run in test mode until SALEANE is given an Anthropic key (`SALEANE_AI_PROVIDER=claude`). In test mode, and always in a sample studio, nothing they read leaves SALEANE.

With Claude connected, Anthropic acts as a processor for what each request needs. For Ask SALEANE that is the person's question, the last few lines of the panel's conversation, the date, the studio's name and the asker's role, and whatever the skills return for that question (for example the day's visits with client names, a client's preferences note as the team wrote it and their visit history, stock or takings). For the receptionist it is the guest's messages in that chat, a known guest's first name, and the studio's treatments, prices, hours and free times. Clinical forms, health answers and patch test results are never given to the AI; the receptionist never asks about health and passes such questions to the team. Skill results are labelled as information, never instructions.

Talking to Ask SALEANE (NEXT-12 part 2) is off until SALEANE is also given an OpenAI key (`SALEANE_VOICE_PROVIDER=openai`), and never offered in a sample studio. While someone talks, OpenAI acts as a processor for their voice, which goes straight from their browser to OpenAI, the voice's standing instructions (the studio's name and its spelling) and SALEANE's answers for the voice to say, which can hold what Claude found in the records for that question, such as client names, times and amounts. Claude still does the thinking, through the same skills and approval step as a typed question; OpenAI is given nothing else from the records. SALEANE asks OpenAI not to keep the conversation (`store: false`), keeps no recording, and keeps the words heard and the answers in the open panel and, for the last few lines only, with the panel's conversation for an hour (below). Before a live pilot, record OpenAI in the same places as Anthropic and confirm its retention settings for live sessions.

SALEANE keeps a short copy of each conversation with the AI, so the AI only ever reads what was really said, never earlier lines a browser sends: the last six lines of an Ask SALEANE conversation, typed or spoken, and the last eight of a chat on the booking page. Each is deleted an hour after its last message. A change the AI prepares (its summary and the change itself) is kept for the person who asked until they decide, and deleted a day after it runs out, which is 30 minutes after it was prepared. A guest's chat and what it offered are tied only to an anonymous id for their visit, made with a key SALEANE keeps in memory, so they cannot be traced to an internet address and do not carry over a restart. Each answer also leaves a record of what it did, kept for 90 days without any words: where it came in, which skills ran, how many calls were made to the AI, how long it took, what it cost and, for the team, who asked. A restore removes kept conversations and prepared changes. The receptionist's text and social answers are kept in the outbox like any other message. Before a live pilot, record Anthropic in the studio's privacy notice and processor list, sign its data processing terms, and confirm its retention settings for API requests.
