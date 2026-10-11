# LUMANE hardened: evidence

Recorded 11 October 2026 on top of `main` after the merge of #106 to #116 (with the polish pass), in Chromium (Playwright) against the built app (`npm run build && npm start`, 127.0.0.1:5173) with a fresh local database and a sample studio, the AI in test mode and no Anthropic or OpenAI key set. All names are fictional. Nothing was deployed.

These are the four fixes Edem approved from the "unbreakable" study, with two smaller ones that came out of it:

1. A change Ask prepared is kept in the database, so a restart loses nothing the team was about to approve, and the record says honestly whether it was approved and then saved.
2. The conversation is kept on the server. A follow-up reads earlier lines from there, never from the browser.
3. What a good answer must, and must never, do is written as eval cases that run against the real Claude.
4. Every reply is checked before it is shown or spoken. A sentence saying something was done when nothing has been approved is taken out, and a plain note says what is waiting.
5. Each turn leaves a record without its words: the pathways used, the calls to the AI, why it ended, how long it took and what it cost.
6. When a person leaves part way, no further paid call starts and nothing the turn prepared is kept.

## What was exercised in the browser

The owner signed in on the sign-in page as a person would, and the studio's AI receptionist was switched on.

- **A follow-up from the kept conversation:** "Who's my 2pm?" then "and after her?" answered "16:00: Isabel Wilson, Skin Renewal Facial with Sophia". The browser sent only the conversation's id with the second question.
- **A change waiting through a restart:** "Remind me to call Amelia tomorrow" prepared the reminder with Approve and Not now ([before the restart](LUMANE-HARDENING-before-restart.jpg)). SALEANE was then stopped and started again while the suggestion was still on screen. Tapping Approve afterwards saved it: the panel shows "Done. Saved to your records." ([after the restart](LUMANE-HARDENING-after-restart.jpg)) and the studio holds exactly one reminder to call Amelia.
- **What the database kept:** the suggestion's row reads `applied`, and the change history reads, in order, "proposed", "approved" and "applied". The team's conversation kept 6 lines.
- **A guest on the booking page (390px):** "When are you open?", "How much is a facial?" and "Where are you?" were answered from the studio's hours and menu ([the chat](LUMANE-HARDENING-guest-chat-390.png)). The follow-up sent only `{"text":"Where are you?","chat":"…"}`, with no earlier lines. The guest's conversation kept 6 lines on the server.
- **Turn records:** six were kept (three from the panel, three from the guest chat), each with its pathways, number of calls to the AI and why it ended. None holds any words from either conversation.
- **Console:** no errors, apart from the expected "nobody is signed in yet" check (401 on `/api/session`) when the sign-in page first opens.

## Automated checks

`npm run check` passed: lint, strict TypeScript, the application, server and backup builds, 2,015 application tests and 650 server tests. `npm run format:check` passed.

- `lumane/safety.test.ts`:
  - **The last check:** a reply saying "I've moved her" or "Done!" with nothing approved loses that sentence and gains the app's note; every other sentence is kept exactly. Honest sentences are left alone, among them "Nothing is booked until you confirm on that page" and "No one has been told yet", and so is one saying what approving will do ("Once you approve, it's done"). A claim made before the approval is mentioned ("I've booked you in, so tap Approve") is still taken out. The app adds claims of its own (SALEANE adds taking a payment or a refund).
  - **The turn report:** it counts the calls to the AI and the pathways used, and says why the turn ended, including running out of steps or being refused before reaching the AI.
  - **A person leaving:** no call starts once they have gone, and nothing is counted. If they leave part way, paid calls stop, what it cost so far still counts, and nothing it prepared is kept.
  - **The judge:** an eval passes a turn that does what was expected and names each miss in a plain sentence.
- `server/assistant.test.ts`:
  - A follow-up reads from the conversation kept on the server. A browser that sends earlier lines is turned away (400). Another person starts afresh, 6 lines are kept, and an hour later the conversation is forgotten.
  - A change approved but not saved can be approved again or turned down. Once saved, approving it again says it is already saved and saves nothing twice.
  - A suggestion prepared before a restart (a database kept on disk, opened again) is still waiting afterwards, saves once, and replaying the same save adds nothing.
  - Each turn is recorded without its words.
- `server/receptionist.test.ts`: a guest's earlier lines come only from the chat kept on the server (8 lines kept). The record is not tied to the guest's internet address, and a second tap on "send this message" sends it once.
- `server/phone.test.ts`, `server/receptionistText.test.ts`: a call and a text each leave a word-free turn record.
- `server/backup.test.ts`: restoring a backup clears suggestions and conversations, and keeps the word-free turn records.
- `src/assistant/receptionist.test.ts`: the receptionist never tells a guest something was sent, booked, paid or refunded when it was only prepared. On a call or by text it says only that nothing is booked yet.
- `src/components/askSaleaneLive.test.tsx`, `askSaleaneTalk.test.tsx`, `ReceptionistChat.test.tsx`: the panel sends only the conversation's id, the same one for typed and spoken questions. A change that failed to save, or whose approval got no answer because the connection dropped, can be approved again; one already saved shows as done, and one the server no longer has is let go. The guest chat sends its chat id with a follow-up, never its earlier lines.
- `evals/cases.test.ts`: every eval case has a plain name and reason and names only real pathways. Each case's safety checks pass against the test-mode brain on every change.

## Not yet done

- **The eval cases have not been run against the real Claude.** There are 11 for the team and 9 for guests. `npm run evals` runs them once an Anthropic key is set, and prints what the run cost; without a key they are skipped.
- **A guest's conversation does not survive a restart, by design.** A guest is known only by a code made from their address with a secret that changes each time SALEANE starts, so nothing links them across restarts. After a restart the guest's next message starts afresh. Their prepared booking offers expire as before.
- **Not started:** strict tool shapes and a second route to Claude. Both need a supplier account.
