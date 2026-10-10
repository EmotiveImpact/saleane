# LEFT-5D · Booking through ChatGPT or Claude

Built 10 October 2026 in a worktree, on top of `left-stage5` at `957c445`. Everything below was checked with server, domain and component tests. It has **not been seen in a browser yet**: the lead runs the browser pass after the Stage 5 parts are put together. ChatGPT and Claude have never called it: it runs in test mode, which only answers on the computer SALEANE runs on, and SALEANE is not online yet.

## What it does

- **A guest asks ChatGPT or Claude to book.** Each studio has its own remote MCP server (Model Context Protocol), at `/api/mcp/{booking page name}`. An AI assistant connected to it can read what the studio's booking page shows and book a visit for the guest it is helping.
- **The protocol.** JSON-RPC 2.0 over the streamable HTTP transport, one message per `POST`, always answered with `application/json`. It speaks `initialize`, `notifications/initialized`, `ping`, `tools/list` and `tools/call`, protocol versions 2025-11-25, 2025-06-18 and 2025-03-26. `initialize` gives an `Mcp-Session-Id` that every later message carries; `DELETE` ends it. Notifications get 202, batches and anything that is not JSON-RPC 2.0 are refused with the right error code, a browser `Origin` from anywhere else gets 403, and `GET` gets 405.
- **Four tools.**
  - `studio_details`: the studio's name, today on its clock, each open location's address, phone, email and opening hours (Monday first), days it is closed in the next month, how cancelling works, and the booking page.
  - `list_treatments`: the treatments guests can book online with their length, full price at each location (tax included) and the professionals who do them. Treatments that need a deposit or a patch test are listed by name only, with the booking page, because no payment is taken through an assistant and the guest is not known yet.
  - `find_free_times`: free start times as HH:MM on the studio's clock, day by day, exactly as the booking page offers them (desk bookings and other guests' holds included), never before today, at most 14 days at once, with closed days marked.
  - `book_time`: books a time for the guest. It needs their name, email and phone, and `guest_confirmed: true`, which the assistant may set only after telling the guest the treatment, day, time, price and cancelling terms and hearing yes. It returns the treatment, day, time, price, place, the cancelling terms and the guest's private link to see, move or cancel the visit.
- **Through the booking page's own code.** `book_time` holds the time and books it with the same functions as the booking page (`holdTime` and `bookHeld`, moved out of the booking routes unchanged). The price, deposit, tax, patch test rule, opening hours and free time are all checked again. The visit arrives in the diary as an online booking with the channel `chatgpt`, `claude` or `assistant`.
- **Never assumed.** Marketing consent is always off: the guest is never signed up for news or offers this way. Nothing about other guests, the team's contact details, money or the studio's own records is ever returned; only what the booking page shows any guest.
- **A retry books once.** The hold's key comes from what was asked, on which connection. The same `book_time` on the same connection within 15 minutes returns the same visit with a fresh private link (the earlier link stops working). Because the connection id is secret to the assistant, nobody else who knows the guest's details can ask again for their link; another connection asking for the same time finds it taken.
- **Honest words.** The answer never says a confirmation was sent: "Emails are in test mode, so no confirmation email is sent. Give the guest the private link.", or "The studio's usual confirmation email is queued for the guest." with live email, or the sample studio's words.
- **Who booked.** The assistant is named from what it says when it connects: ChatGPT, Claude, or "an AI assistant" when it does not say. The visit's booking reads "Booked by the guest through ChatGPT." on the client's relationship timeline, by "Guest, through ChatGPT". Settings, Who changed what shows "Booked through ChatGPT" by "A guest, through ChatGPT" (and the same for Claude or an AI assistant).
- **Off until the owner turns it on.** Settings, Studio details, "Booking through ChatGPT or Claude", under Book with Google: a tick box, "Let guests book through ChatGPT or Claude", and a quiet Save. Once on, the studio's address is shown with Copy, and the number of visits booked through an AI assistant. The panel says plainly: "Test mode: only this computer can reach the address below. SALEANE is not online yet, so ChatGPT and Claude cannot reach it. Once it is online, you add the address to them as a connector." It also says when online booking is off, and for a sample studio that visits booked there are for practice.
- **Closed when the booking page is closed.** Online booking off, or a studio locked for an unpaid bill, answers 404, even on a connection already open.
- **Limits.** Per address, as the AI receptionist's are: 120 messages and 40 tool calls every 10 minutes, plus the booking page's own limits on holding and booking.
- **Help**: a guide for owners, "Let guests book through ChatGPT or Claude".

## Who can do what

| Who                         | Turn it on or off | See the address | Use the tools                                                                    |
| --------------------------- | ----------------- | --------------- | -------------------------------------------------------------------------------- |
| Owner                       | Yes               | Yes             | Not from SALEANE; the address is for an assistant                                |
| Manager, general manager    | No                | No              | No                                                                               |
| Reception, practitioner     | No                | No              | No                                                                               |
| Regional manager            | No                | No              | No                                                                               |
| An AI assistant (test mode) | No                | No              | Only on this computer, only while the owner has it on and online booking is open |
| A web page elsewhere        | No                | No              | No: a foreign `Origin` gets 403, and the Host check applies                      |

The `ai-booking` command has its schema (`commandSchema.ts`, `aiBookingSchema.ts`), its handling (`operatingCommands.ts`), its permission (owner only, in the owner list of `can`), its words ("Changed booking through ChatGPT or Claude") and its settings detail in `changeRecord.ts`. It is not a general manager's action and touches no client data, so `branch.ts` and `privacy.ts` need no entry. Sample studios may turn it on, to practise.

## Server

- `server/aiBooking.ts`: the MCP endpoint, its sessions (in memory, 12 hours idle), the tools' JSON Schema and zod checks, the booking path, and `GET /api/workspaces/:orgId/ai-booking` for the owner's panel (`{mode,reachable,address,sample}`). `SALEANE_AI_BOOKING` is `test` by default (answers only when `APP_ORIGIN` is 127.0.0.1, localhost or [::1], 503 anywhere else) or `off` (404).
- `server/app.ts`: the endpoint is handled before the Origin and JSON checks for SALEANE's own pages, after the Google partner route, as an assistant is not a SALEANE page.
- `server/routes/public.ts`: the booking page's hold and book are now `holdTime` and `bookHeld`, called by the booking page and by the assistant's `book_time`. The booking page's answers and tests are unchanged.
- `src/domain/aiBooking.ts`: what the tools read and say, built from the studio record with the booking page's own rules. `src/domain/bookingPlaces.ts`: the open locations and closed days, moved out of the booking routes.
- `src/domain/model.ts`: a visit's `channel` can now also be `chatgpt`, `claude` or `assistant`.
- `docs/CONNECTIONS.md` and `server/README.md`: the contract, the tools and the setting.
- No migration.

## Tests

- `server/aiBooking.test.ts` (14):
  - **the protocol**: `initialize` with the version asked for (or the newest), the session header and the instructions; the initialized notification and an answer get 202; `ping`; `tools/list` with the four tools, their schemas and read-only hints; `DELETE` ends the connection;
  - **every protocol refusal**: a parse error, a batch, a message that is not JSON-RPC 2.0, a request with no method, an unknown method, an unknown tool, missing and extra arguments, no session, an unknown session, an unsupported protocol version, a body that is not JSON, a foreign `Origin`, and `GET`;
  - **off and on**: off until the owner turns it on (with Who changed what), closed with online booking off even for an open connection, off again, and a server started with it off; `SALEANE_AI_BOOKING` read and checked;
  - **test mode** answers 503 on a public address, and the owner's panel says it is not reachable;
  - **the owner's view** of the address, signed out 401, writes 405, and the permission for each role;
  - **a locked studio** answers nothing and books nothing;
  - **the tool limit**: 40 calls, then 429, then open again after the window;
  - **studio details and treatments**: hours Monday first, the cancelling rule, ids in the text, deposit and patch test treatments by name only, and nothing about a desk client or the owner in any answer;
  - **free times** match the booking page's own, a time held on the booking page is left out, at most 14 days and never before today, and every refusal (deposit, patch test, unknown treatment, professional, location, dates);
  - **booking**: nothing without the guest's yes; then the visit (online, channel `chatgpt`, booked price), the client with marketing consent off, the timeline event and its words, one audit entry with no staff actor, Who changed what, the private link opening the guest's visit, and the time gone from free times; honest test mode words;
  - **a retry books once**: the same visit with a fresh link, one visit, one booked event, one audit entry, the old link stopped; another connection finds the time taken; after the window it is refused;
  - **every booking refusal**: a time not free, a badly written start, a day gone or too far ahead, a bad phone, email or name, deposit and patch test treatments, a professional who does not do it, and a desk booking taking the time first; nothing booked;
  - **Claude, and an assistant that does not say**: channels, actors, timeline words, audit actions and Who changed what;
  - **a sample studio** practises, and says so.
- `src/domain/aiBooking.test.ts` (6): which assistant from its names; on only with the owner's choice and online booking; times on the studio's clock; prices at each location and deposit treatments kept to the booking page; free times only where the treatment can happen, closed days marked, 14 days at most; confirmation words never claiming a send.
- `src/components/AiBooking.test.tsx` (4): turning it on with a secondary Save and the "not online yet" words; the address with Copy and the count of visits; online booking off, test mode not reachable and a sample studio; nothing for anyone but the owner.
- `src/domain/changeRecord.test.ts`: the words for `ai-booking` and `ai-booking.chatgpt`, `.claude` and `.assistant`, and who each says it was.
- `src/domain/help.test.ts`: "book through chatgpt", "claude booking" and "openai connector" find the new guide; a manager does not.
- The booking page's own tests (`server/publicBooking.test.ts` and the rest of the server suite) pass unchanged on `holdTime` and `bookHeld`.

## Checks

Run from the worktree root on 10 October 2026, after a merge of `left-stage5` at `d402850` (PR #92 and Stage 5A):

- `npx tsc -b`: pass.
- `npx eslint . --ignore-pattern '.claude/**' --max-warnings 0`: pass.
- `git ls-files -z | xargs -0 npx prettier --check --ignore-unknown`: pass.
- Front-end suite: 181 files, 1,595 tests passed (this branch adds 2 files and 10 tests).
- Server suite: 65 files passed and 1 skipped, 514 tests passed and 2 skipped (this branch adds 1 file and 20 tests, 14 here and 6 for LEFT-5C).
- `npm run build`: pass.

## Decisions

- **A session is required after `initialize`.** The protocol lets a server require it, and it is what keys a repeated booking, so only the assistant that made a booking can ask again for its link. A message without it gets 400, one with an ended session 404, as the protocol says.
- **No bot check.** The booking page asks a browser to pass Turnstile before holding a time; an assistant cannot. This connection is off unless the owner turns it on, answers only on this computer in test mode, needs the guest's yes, and has its own limits as well as the booking page's.
- **Treatments with a deposit or a patch test stay on the booking page**, as on Google: no payment can be taken through an assistant, and the patch test rule needs a known guest.
- **Times as HH:MM on the studio's clock**, with the studio's time zone named, rather than instants, so an assistant reads them to the guest as the studio's diary has them.
- **Sample studios may try it**, unlike Google, because test mode only answers on this computer and the booking page already takes practice bookings for a sample.
- **No new migration.** The setting lives in the studio record's operations, the holds in the existing `booking_holds` table and the sessions in memory.
- **Rate limits per address**, as the brief and the AI receptionist do. See Limits.

## Quality bar

- [x] **Each screen or section has one main job and one primary button.** The new panel has no primary button: Save and Copy are secondary, so the page keeps its own.
- [x] **Rarely used options are tucked away.** One tick box; the address shows only once it is on.
- [x] **No card inside a card; lists use rows and hairlines.** One panel in the Settings column, with the address in the same row style as Share your booking page.
- [x] **At most one photograph per view.** None added.
- [x] **Warm, plain words**, British English, no exclamation marks or dashes, and nothing says a message was sent: "SALEANE is not online yet, so ChatGPT and Claude cannot reach it."
- [x] **Design tokens and library components** (`Button`, `ErrorMessage`, the existing `ops-panel` and `share-link` styles); no new raw colours or left-edge stripes. Lint, types, tests and format pass.
- [ ] **At 390 px**: not seen in a browser yet. The panel reuses layouts that already stack at 390 px (the Book with Google panel and the share link row).
- [ ] **Before and after pictures** at 1440 and 390 px: not taken; the lead's browser pass.

## Limits and notes

- **ChatGPT and Claude have never connected.** It follows the MCP specification (streamable HTTP, protocol 2025-11-25 and the two before) and is tested with requests built from it, but going live needs SALEANE online over HTTPS, a live mode for `SALEANE_AI_BOOKING`, and a check with each assistant's connector settings. Neither assistant's app directory listing is applied for.
- **No sign-in for the assistant.** Anyone who can reach the address can use it, as anyone can open a booking page. A live mode may want OAuth, which the MCP specification describes, if ChatGPT or Claude require it for a public connector.
- **Limits key on the caller's address.** Behind ChatGPT's or Claude's own servers many guests share a few addresses, so a live mode should key the limits on the connection as well.
- **Sessions are in memory.** A restart ends every connection; the assistant is told to connect again (404), as the protocol expects.
- **A retry on a new connection** (after a restart) is a new booking: for a named professional it finds the time taken; for "anyone" it could book a second visit with someone else at the same time. The booking page has the same behaviour for a guest who books twice.
- **No streaming or server-sent events**: every answer is one JSON message. Assistants that only use SSE are not supported.
- **Moving or cancelling** is through the guest's private link, not through the assistant.

## Browser steps for the lead

Not seen in a browser yet.

At 1440 px and 390 px, signed in as the owner of a new studio of your own (not a sample) with online booking on, on `http://127.0.0.1:5173`:

1. Settings, Studio details: under Book with Google, "Booking through ChatGPT or Claude" with the test mode line ("SALEANE is not online yet, so ChatGPT and Claude cannot reach it.") and the tick box. No address yet.
2. Tick "Let guests book through ChatGPT or Claude" and choose Save: "Saved." The address appears, `http://127.0.0.1:5173/api/mcp/{your booking page name}`, with Copy, and "No visits booked through an AI assistant yet."
3. From a terminal on the same computer, connect and book as an assistant would (as in `server/aiBooking.test.ts`): `POST` the address with `Content-Type: application/json`, first `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"claude-ai","version":"1"}}}`, then with the `Mcp-Session-Id` it gives: `tools/call` for `list_treatments`, `find_free_times` and `book_time` with `"guest_confirmed": true`.
4. The diary shows the visit as an online booking. The client's page, relationship timeline: "Visit booked … Booked by the guest through Claude." by "Guest, through Claude". Marketing stays off.
5. Settings, Who changed what: "Booked through Claude" by "A guest, through Claude", and "Changed booking through ChatGPT or Claude" by you.
6. Back in Studio details, the panel says "1 visit has been booked through an AI assistant."
7. Switch online booking off in Studio details: the panel says nothing answers until it is on, and the address answers 404.
8. Help: search "chatgpt" and open "Let guests book through ChatGPT or Claude".
9. Sign in as a manager: the panel is not shown.
10. At 390 px: the panel, the address row and Copy wrap without sideways scrolling, with 44 px buttons.

Screens to capture before and after, at 1440 and 390 px: Studio details with the panel off, then on with the address; the diary with the visit; the client's timeline; Who changed what; the help guide.
