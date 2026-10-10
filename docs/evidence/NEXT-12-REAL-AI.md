# NEXT-12 · Claude behind Ask SALEANE and the receptionist (part 1)

Recorded 10 October 2026 on a local build (Chromium, 127.0.0.1:5173). A studio of its own, not a sample: Linden Studio in Marylebone, with Maya Lind doing a Restorative facial (60 minutes, £95) and two visits that day, Rosa Field at 11:00 and Amara Osei at 14:30. The server was started with Claude switched on and a pretend Anthropic in place of the real one: a stand-in for `fetch`, kept outside the repository, that answers as Anthropic's Messages API documents, waits 900 ms, and answers anything containing "busy" with Anthropic's 529 overloaded error. Everything else (the brain, the engine, the routes, the outbox, the screens) is the code in this change.

## What it does

`SALEANE_AI_PROVIDER=claude` with `ANTHROPIC_API_KEY` set puts Claude behind Ask SALEANE and the AI receptionist (booking page chat, texts and social messages). Unset, both stay in test mode, and a sample studio always does. `lumane/claude.ts` calls the Messages API with the standing instructions and the skills (both cached), the facts for this request (the date and time at the studio, its name and currency, who is asking) and the conversation. Claude's own reply goes back unchanged within a turn, so its reasoning carries through each skill it uses. Each call's cost is worked out from the tokens Anthropic reports and recorded in `assistant_usage`.

A turn starts no further call once it has spent its share (6 for a question, 4 for a guest message) or run out of time (30 and 20 seconds). When Anthropic is busy SALEANE tries once more, then gives up; it never falls back to another model. A question Claude cannot answer is not counted against the month, but its cost is. A text or social message is answered after the webhook has been thanked, through the outbox, and a repeat of the same message while it is being answered is not answered twice. Fill-ins such as `{{manage_link}}` and `[[booking-link]]` that the AI writes are removed before anything is shown or sent; only SALEANE fills in links.

## Tests

- `lumane/claude.test.ts` (10 tests): the request (address, headers, model, `max_tokens` 2048, low effort, instructions cached apart from the facts, each skill's schema with `$schema` removed and the last one cached); skill requests returned with Claude's reply kept to send back; a skill request cut off by the length limit never used; a declined answer said plainly; one retry when busy, then a `busy` error costing nothing; a refused key not retried and named; a dropped connection counted at its worst; costs from tokens with caching, rounded up (1,000 in, 100 out and 4,000 read from the cache is 0.34); results grouped into one turn; a field called `pattern` left alone; a whole turn with a skill (0.68 for two calls); and a turn ending as unavailable with its cost kept but not counted against the month.
- `lumane/engine.test.ts` (17 tests, 3 new): a turn stops calling once it has spent its share, stops at its time limit and passes the facts on, and ends as unavailable when the brain fails.
- `server/realAi.test.ts` (7 tests): test mode unless Claude is named with its key and a price SALEANE knows, and the server stopping without one; Ask SALEANE answering through Claude with the date in the facts and 0.68 recorded; a busy Anthropic leaving "Sorry, I could not answer just now. Nothing was changed. Please try again shortly." with nothing counted; a sample studio never calling Claude; a text thanked first, answered once, without fill-ins, as "Linden Studio AI receptionist: We are open 9 to 6. Book here: …/book/…"; a text Claude cannot answer left unanswered for the team, counting only its cost; the booking page chat with fill-ins removed, then "Sorry, I cannot answer just now. You can still choose a time on this page, or call the studio." The health check reports the AI as a service.
- `src/components/askSaleaneLive.test.tsx` (3 tests): the panel says Claude answers, waits 80 seconds for an answer and shows a failed one plainly; it stays described as test mode until the server says otherwise; the receptionist settings tell the owner that guests' words go to Anthropic.
- `server/app.test.ts` expects `ai: false` among the services in test mode, and `src/domain/help.test.ts` keeps every guide whole and in plain British English, the two updated ones included.

## Browser journey

1. Before, and still in test mode: Ask SALEANE says "Test mode: answers come from your studio records. No AI service is connected, and nothing is sent." and Settings, AI receptionist says "It works in test mode: no AI supplier is used and it costs nothing."
2. With Claude on, Ask SALEANE says "Answers come from your studio records, read by Claude, an AI from Anthropic. Changes wait for your approval, and nothing is sent." Asking "Who is in today?" answered "You have 2 visits today. The first few:" with "11:00 Rosa Field, Restorative facial with Maya Lind" and "14:30 Amara Osei, Restorative facial with Maya Lind" on lines of their own, and "1 of 300 questions used this month."
3. Asking "Are you busy?" (answered busy twice by the pretend Anthropic) said "Sorry, I could not answer just now. Nothing was changed. Please try again shortly." and the count stayed at 1 of 300.
4. Settings, AI receptionist said "It uses Claude, an AI from Anthropic: what guests write is sent there to be answered, and each chat counts towards your monthly guest chats."
5. On the booking page, a guest asking "When are you open?" was answered "Hello, I am Linden Studio's AI receptionist. We are open:" with each day's hours on its own line and "You can choose a time on this page." The `{{manage_link}}` the pretend Claude added at the end was not shown.
6. Asking "Are you busy today?" said "Sorry, I cannot answer just now. You can still choose a time on this page, or call the studio." and the chat stayed open. Each of the two guests' chats counted once (2 of 200).

axe (WCAG 2.2 AA tags) found nothing on Ask SALEANE with an answer and with a failed answer, Settings, AI receptionist, and the booking page chat with an answer and with a failed answer, each at 1440 px and 390 px. A long conversation made the booking page chat scroll with nothing in it to focus, which axe flagged; the conversation can now be focused and scrolled from the keyboard. There was no sideways scroll at either width and there were no console errors.

## What it costs

At Claude Sonnet 5.5's prices ($2 a million tokens in, $10 out, $0.10 read from the cache, $2.50 written to it), counted in the studio's own currency, which counts a pound studio slightly high.

- The cached part of a question is about 3,100 tokens (994 characters of instructions and 29 skills), and of a guest message about 1,200 (909 characters and 7 skills): about 0.03 and 0.01 cents to read, about 0.8 and 0.3 cents when written the first time in five minutes.
- A typical question takes two or three calls: the question and facts (about 400 tokens), what the skills return (a busy day is 1,500 to 3,000 tokens) and short answers (100 to 300 tokens each). That is about 1 to 2 cents, nearer 3 with the cache cold.
- The most one question can cost is its share (6 cents) plus the call already under way, about 10 cents. A guest message stops at 4 cents plus its last call. The day's ceiling (150 cents for each location) stops new questions before they start.
- So the 300 questions and 200 guest chats in each location's price come to about $5 to $8 a month in typical use. These figures are worked out from token counts, not measured on a real account.

## Not covered

Not run against a real Anthropic account: no key was used, and the adapter follows Anthropic's published API with simulated answers. The talking half (OpenAI's voice, NEXT-12 part 2) is not built yet. Messages, card payments and everything else stay in test mode. Safari and Firefox were not checked.
