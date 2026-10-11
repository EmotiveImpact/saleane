# Stage 1, part C · STOP and START replies change the client's text setting

Recorded 9 October 2026 in a worktree from main at 016f3ca. Built with automated tests; the lead then ran the journey in a browser after merging (see "Seen in a browser"). All names and numbers are fictional and nothing was sent.

## What it does

- A text to the studio's line whose whole body is an opt-out word (STOP, STOPALL, UNSUBSCRIBE, CANCEL, END, QUIT, OPTOUT, REVOKE), ignoring case, spaces around it and punctuation after it, turns texts off for every client of that studio whose number matches the sender (read the same way as the Inbox's matching, so a family sharing a number all stop). Each client's timeline gets "Texts turned off · Replied STOP by text…" as a permission change, the client keeps `textsStoppedAt`, and the number goes on the studio's `textStops` list whether or not it belongs to a client. A keyword inside a longer message never counts.
- START or UNSTOP (and YES, but only for a number that replied STOP, since YES is an everyday answer) turns texts back on only where a STOP turned them off. Texts turned off at the desk stay off; the client gets `textsAskedAt`, their timeline says "Asked for texts again", and the reply is labelled "Asked for texts again" and left unread for the team.
- HELP and INFO are labelled "Asked for help", left unread, and get no automatic or AI answer.
- STOP, START and a START that changed nothing are kept in the Inbox labelled "Turned texts off", "Turned texts back on" or "Asked for texts", marked read by the text line, and never make the conversation look unanswered. The AI receptionist answers none of them, and leaves a stopped number (or one whose client asked for no texts) to the team.
- One rule, in one place: `applyTextKeyword` (`src/domain/textStop.ts`) runs inside `reply-received`, which only the server's text line can send, in the same transaction that keeps the reply. A provider retry is recognised by its message id before anything runs, so it creates nothing new.
- Nothing is texted to a stopped number: `channelsFor` (visit messages, and birthday and "we miss you" should they ever text), the plan for Inbox messages, approving an Inbox text, missed-call text-back, the AI receptionist, and finally the outbox's `send`, which skips any text to a stopped number however it was planned ("This number replied STOP, so SALEANE does not text it until they text START."). That last check also covers kinds added later.
- Email and email news are never changed by a text, and no consent record is written.
- The client page says "Texts are off. Ellie replied STOP on 6 October." Ticking Visit texts first shows "Only if Ellie asked you to…" with "Ellie asked, turn texts on" and "Keep texts off"; the server refuses the change without `askedAfterStop: true`. After it, the page says the number itself still replied STOP and SALEANE will not text it until START, and the timeline's "Visit messages updated" says so.
- Test mode: Inbox › "Deliver a test text" (owner or manager, while texts are in test mode or in a sample studio) posts to `POST /api/workspaces/:id/test-text`, which takes the same path as the Twilio hook (`recordReply` then `answerText`). It is recorded as that person's test (`inbox.test-text` in Who changed what, and "Text line (test mode)" on the reply and timeline), and the Inbox says "Test text from … (test mode)". Every outcome ends "Test mode: no phone network was involved and nothing was sent." Refused (409) once texts are live in a studio of its own.

## Automated checks

`src/domain/textStop.test.ts` (13 tests): the keyword reading, including "please don't cancel my visit", "Stop texting me please" and "Cancel Thursday" as ordinary messages and "Cancel" alone as STOP; a shared number stopping both clients with their own timeline entries, email and email news untouched and no consent record; the reply labelled and read; a provider retry changing nothing; a number with no client recorded and refused a missed-call text until START; email-only visit planning after STOP; START turning back on only STOP-off clients and leaving a desk-off client asked; YES only for a stopped number; HELP left for the team; the desk needing `askedAfterStop`, with the number still blocked afterwards; approving an Inbox text refused while off and while the number is still stopped; the Inbox not counting it as waiting; the client export's permission history; nothing in a practitioner's view; and a duplicate stop record refused.

`server/textStop.test.ts` (9 tests): through the Twilio hook, STOP kept once on a retry, both family members off, marketing consent unchanged, no AI answer to STOP or to a later question, a visit then confirmed by email only and nothing texted to the number (even the answer written before the STOP is skipped); an answer queued to an unknown number before it said STOP skipped at the last moment with the STOP wording; no missed-call text while stopped and one after START; HELP unanswered and START turning texts back on, with the AI receptionist answering again afterwards; the desk refused (422) without `askedAfterStop`, and the outbox still texting nothing until START; the test text kept once per ref, recorded as the owner's test, answered by the AI receptionist only when ordinary (status "test", nothing sent); a local number and empty words refused (400); reception and a practitioner refused (403), and the practitioner's own view holding no `textStops`; refused (409) when texts are live; and a sample studio recording a STOP the same way while nothing enters the outbox.

`src/components/textStop.test.tsx` (2 tests, whole app in the browser demo): the client page wording, the warning with "Keep texts off" and "Ellie asked, turn texts on", the record only changing after the confirmation, and the timeline entry; the Inbox label and note, and Text disabled as "Text (texts are off)" in the reply box.

Full checks on the branch: `npm run lint`, `npx tsc -b`, `npm run format:check`, and all frontend (969) and server (323, 2 skipped) tests pass. On one earlier full run three whole-app component tests (two of them existing ones, `dateFields` and `inboxReply`) timed out waiting for a page to load while other work was running on the machine; they passed alone and on the next full run.

## For the lead to try in a browser

1. With texts in test mode (no `SALEANE_SMS_PROVIDER`), open a studio of your own and add a client with a mobile number, such as Rosa Field, +44 7700 900456.
2. Inbox › "Deliver a test text" › From "Rosa Field · +44 7700 900456" › STOP › "Deliver test text". Then "Deliver the same text again" should say it was already kept.
3. Open Rosa's conversation: "Test text from +44 7700 900456 (test mode)", "STOP", the "Turned texts off" tag and its note, no "New reply", and "Text (texts are off)" disabled under Reply by.
4. Rosa's page › Communication preference: "Texts are off. Rosa replied STOP on 9 October." and the timeline entry. Tick Visit texts, read the warning, try both buttons.
5. Deliver START, then HELP, then an ordinary question with the AI receptionist answering texts, and check each label, the client page and Settings › Who changed what.
6. Repeat at 390 px wide. A sample studio should record the same way and still send nothing.

## Seen in a browser

On 9 October 2026 on the merged branch, in a UK sample studio at 1440px: Inbox, "Deliver a test text", from Elias Hamilton's number, STOP. The window said "Kept in the Inbox as \"Turned texts off\". SALEANE will not text this number until it texts START, and nothing was queued to answer it. Test mode: no phone network was involved and nothing was sent." His page then read "Texts are off. Elias replied STOP on 9 October." with Visit texts unticked. The client page was also checked at 390px.

## Limits

- Not run against a real Twilio account. The keyword list is Twilio's default list; custom keywords set in a Twilio Advanced Opt-Out Messaging Service are not read. SALEANE ignores punctuation after a keyword; if Twilio does not treat "Start!" as START, SALEANE would try a text and Twilio would refuse it (shown as "This number has replied STOP, so texts to it are blocked."), so nothing reaches the person either way.
- A STOP the network received before SALEANE was connected is not known until Twilio refuses a text with that error; the refusal is shown, but it does not yet put the number on the list.
- Only texts. WhatsApp, Instagram, Facebook and email replies are not read for keywords. A number the team matched to a client by hand stops only that number, not the different number on the client's record.
- The stop list keeps one entry per number (up to 50,000); each STOP and START is also kept as the reply itself and on the clients' timelines. Nothing is deleted.
- A test text in test mode can record a STOP or START for a real client of a studio of its own; it is labelled and attributed as a test, and it is refused once texts are live.
- Safari and Firefox were not checked; no screenshots were taken for this note.
