# Connecting other software

V5 lets a studio owner tell other software when something happens in the diary: a Zapier "Catch Hook", Make, an accountant's tool or the studio's own system. This page is for whoever sets up the other end.

## What the owner does

Settings › Connected software (owners only, in a studio of its own):

- **Connect software:** a name, the HTTPS address to send to, the events it should hear about, and whether guest names, email and phone go with them (off unless chosen).
- The **signing secret** (`whsec_…`) is shown once, when the connection is made or a new secret is asked for. The old secret stops working at once.
- **Turn off** one connection, or **Turn all off**. Anything still waiting is not sent. **Remove** stops it for good; its log is kept.
- **Send a test** sends a `connection.test` event.
- **What was sent** lists the last 50 deliveries with what became of each.

Sample studios never send anything outside SALEANE.

## Events

| Event                   | When                                                                  |
| ----------------------- | --------------------------------------------------------------------- |
| `appointment.booked`    | A visit is booked, from the desk, the booking page or the phone line. |
| `appointment.moved`     | A booked visit changes date, time or professional.                    |
| `appointment.cancelled` | A visit is cancelled, by the studio or the guest.                     |
| `appointment.completed` | A visit is checked out.                                               |
| `appointment.no_show`   | A visit is marked as missed.                                          |
| `client.created`        | A new client is added.                                                |
| `connection.test`       | The owner pressed "Send a test".                                      |

Events are worked out by comparing the studio record before and after each saved change, in the same database transaction, so every route into the diary is covered and an event exists only if its change was saved.

## The request

`POST` to the address, with a JSON body:

```json
{
  "id": "evt_6c1f…",
  "type": "appointment.booked",
  "apiVersion": "2026-10-08",
  "occurredAt": "2026-10-08T09:15:02.118Z",
  "studio": { "id": "…", "name": "Linden Studio", "timeZone": "Europe/London" },
  "client": { "id": "…" },
  "appointment": {
    "id": "…",
    "status": "confirmed",
    "date": "2026-10-09",
    "start": "10:00",
    "durationMinutes": 60,
    "service": "Restorative facial",
    "professional": "Maya Lind",
    "source": "online"
  }
}
```

- `date` and `start` are the studio's own local date and time, in the named `timeZone`.
- `client` carries `name`, `email` and `phone` only when the owner chose to share them for this connection.
- `client.created` has no `appointment`. `connection.test` has no `client` or `appointment`.
- `changedBy` is there only when other software made the change through an access key (see [Sending things into SALEANE](#sending-things-into-saleane)): `{ "type": "access_key", "accessKey": { "id": "…", "prefix": "1a2b3c4d", "name": "Booking tool" } }`. Software that sends things in and also hears events can leave its own changes alone by checking for its own key.
- Fields may be added within an `apiVersion`; none are removed or renamed without a new one.

Headers:

| Header               | Value                                                      |
| -------------------- | ---------------------------------------------------------- |
| `Saleane-Event`      | The event type.                                            |
| `Saleane-Delivery`   | The event `id`. The same on every retry: use it to dedupe. |
| `Saleane-Signature`  | `t=<unix seconds>,v1=<hex HMAC-SHA256>`                    |
| `Saleane-Access-Key` | Only when an access key made the change: the key's prefix. |

## Checking the signature

`v1` is the HMAC-SHA256, keyed with the signing secret, of the timestamp, a full stop and the raw request body. Check it before trusting anything in the body, compare in constant time, and refuse a timestamp more than five minutes old.

```js
import { createHmac, timingSafeEqual } from 'node:crypto'

export function genuine(secret, header, rawBody, now = Date.now()) {
  const parts = Object.fromEntries(header.split(',').map((part) => part.split('=')))
  const timestamp = Number(parts.t)
  if (!timestamp || Math.abs(now / 1000 - timestamp) > 300) return false
  const expected = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')
  const given = Buffer.from(parts.v1 ?? '', 'hex')
  return given.length === 32 && timingSafeEqual(given, Buffer.from(expected, 'hex'))
}
```

## Delivery

- Any 2xx answer counts as delivered. Answer quickly and do the work afterwards.
- `408`, `429`, any `5xx`, no answer within 10 seconds, or no connection at all: tried again after 1 minute, 5 minutes, 30 minutes and 2 hours (five tries in all), then marked not delivered.
- Any other `4xx` is a refusal and is not tried again.
- Redirects are not followed. Addresses must be HTTPS, may not hold a name or password, and may not lead to this computer or a private network. The address checked is the one connected to.
- If the server stops mid-send, the delivery is tried again after five minutes.
- An event still waiting after three days is not sent.
- Delivery is at least once: after a timeout the other end may have it already, so dedupe on `Saleane-Delivery`.

## Test mode

`SALEANE_CONNECTIONS` is unset (`test`) by default. Addresses are checked and every event is signed and logged exactly as it would be sent, marked "Test mode, not sent". Nothing leaves the computer. `SALEANE_CONNECTIONS=live` posts for real; it has not yet been run against a real Zapier hook.

# Booking through ChatGPT or Claude

A guest who asks ChatGPT, Claude or another AI assistant to book a treatment can have it booked at the studio, with the same checks as the studio's own booking page. Each studio has its own remote MCP server (Model Context Protocol) for this:

```
POST /api/mcp/{booking page name}
Content-Type: application/json
Accept: application/json, text/event-stream
```

The owner turns it on in Settings › Studio details › Booking through ChatGPT or Claude, and copies the address from there. It is off until they do, and it stays closed while online booking is off or the studio is locked for an unpaid bill.

## The protocol

JSON-RPC 2.0 over the streamable HTTP transport, one message per `POST`, always answered with `application/json` (never a stream). Protocol versions 2025-11-25, 2025-06-18 and 2025-03-26; an unknown version in `initialize` is answered with the newest.

- `initialize` returns `Mcp-Session-Id`. Send it, with `MCP-Protocol-Version`, on every later message. Without it the answer is 400; after the connection ends or the server restarts it is 404, and the assistant connects again. `DELETE` with the header ends the connection.
- `notifications/initialized` and any other notification or answer get 202 with no body.
- `ping`, `tools/list` and `tools/call` are answered. Anything else is `-32601`. A batch, a parse error or a message that is not JSON-RPC 2.0 is 400 with `-32600` or `-32700`. An unknown tool or wrong arguments is `-32602`, naming the problem. A refusal from SALEANE itself (not turned on, too many requests, a connection that has ended) is `-32000` with the HTTP status.
- A request carrying a browser `Origin` from anywhere but SALEANE is refused with 403.

The assistant is named from `clientInfo` in `initialize` (or the `User-Agent`): ChatGPT, Claude, or "an AI assistant" when it does not say. That name is what the visit's history, the client's timeline and Who changed what show.

## The tools

| Tool              | Takes                                                                                                                                           | Gives                                                                                                                                                                                            |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `studio_details`  | nothing                                                                                                                                         | The studio's name, today on its clock, each open location's address, phone, email and opening hours (Monday first), days it is closed in the next month, how cancelling works, the booking page. |
| `list_treatments` | nothing                                                                                                                                         | Treatments to book here with length, full price at each location, and the professionals who do them. Treatments that need a deposit or a patch test by name only, with the booking page.         |
| `find_free_times` | `treatment_id`, and optionally `professional_id`, `location_id`, `from_date`, `to_date`                                                         | Free start times (HH:MM on the studio's clock) day by day, as the booking page offers them, never before today and at most 14 days at once.                                                      |
| `book_time`       | `treatment_id`, `date`, `start`, `guest_name`, `guest_email`, `guest_phone`, `guest_confirmed`, and optionally `professional_id`, `location_id` | The booked treatment, day, time, length, price, place and cancelling terms, the guest's private link to see, move or cancel it, and honest words about any confirmation email.                   |

Each answer has a short text for the assistant to read (`content`) and the same as data (`structuredContent`). A refusal the guest can act on, such as a time that is no longer free or a treatment that needs a deposit, comes back as a tool result with `isError: true` and plain words.

`book_time` books nothing unless `guest_confirmed` is true: the assistant first tells the guest the treatment, day, time, price and cancelling terms. It holds and books through the booking page's own code, so the price, deposit, tax, patch test rule, opening hours and free time are all checked again, and the visit arrives in the diary as an online booking. The guest is never signed up for news or offers. The same `book_time` on the same connection within 15 minutes returns the same visit with a fresh private link (the earlier link stops working), so a reply that never arrived never books twice. Nothing about other guests, the team's details, money or the studio's own records is ever returned.

## Test mode

`SALEANE_AI_BOOKING` is `test` by default: the address answers only when SALEANE runs on this computer (`APP_ORIGIN` on 127.0.0.1, localhost or [::1]) and gives 503 anywhere else, so no assistant on the internet can book into a real studio's diary before SALEANE is online and this has been checked against ChatGPT and Claude. `SALEANE_AI_BOOKING=off` answers 404. Calls are limited per address: 120 messages and 40 tool calls every 10 minutes, plus the booking page's own limits on holding and booking.

# Reading from SALEANE

Other software can also read from a studio, with an access key the owner makes in Settings › Connected software › Access keys. A key belongs to one studio, does only what the owner ticked, and stops working the moment it is revoked. A key reads only, unless the owner also ticked one of the scopes for [sending things in](#sending-things-into-saleane). The key (`sal_…`) is shown once; SALEANE keeps only a hash of it. Sample studios cannot make keys.

Send it on every request:

```
GET /api/v1/appointments?from=2026-10-01&to=2026-10-31
Authorization: Bearer sal_1a2b3c4d_…
```

| Endpoint                           | Needs               | Returns                                                                                                                                                                                                         |
| ---------------------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/studio`               | any key             | The studio's id, name, time zone and currency, the key itself (`id`, `prefix`, `name`), its scopes, its `locationId` and `endsOn` (null when not set), and the studio's email news wording (`version`, `text`). |
| `GET /api/v1/appointments?from&to` | `appointments:read` | Visits on those dates (up to 31 days), in time order, as in the event payload plus `clientId`, `serviceId` and `professionalId`.                                                                                |
| `GET /api/v1/clients`              | `clients:read`      | Clients oldest first: id, name, email, phone, whether they agreed to email news, and when they were added.                                                                                                      |
| `GET /api/v1/services`             | `services:read`     | Treatments in use with duration and price in minor units (paged), and the team with the treatments each offers.                                                                                                 |
| `GET /api/v1/takings?from&to`      | `takings:read`      | One line per day (up to 31 days) of treatments, products, tax, tips, plans, rent, fees and money given back. No receipts or names.                                                                              |

Visits, clients and treatments take `limit` (1 to 200, default 100) and `offset`, and say the `total`; the team comes whole with the treatments. Each key may make 120 requests a minute in all, reads and writes together, from wherever they come. `PUT`, `DELETE` and anything else but `GET`, `POST` and `PATCH` is refused with 405, a missing, wrong or revoked key, a key past its last day or one for a closed location with 401, a scope the key lacks with 403, and too many requests with 429. Refusals carry `{ "error": "…", "code": "…" }`.

## Partner keys

A key can be kept to one location, for a partner that works with one branch such as that branch's own till. It reads only that location's visits, plus the treatments offered there at that location's prices and the team; clients and takings belong to the whole studio and cannot be given to a one-location key. Stage 5: it may also book, move and cancel that location's own visits (`appointments:write`) and send in that location's till sales (`sales:write`), never anywhere else; a visit at another location is answered as not found. A key can also stop after a chosen day (at most one year: the latest is the day before the same date next year), counted in the studio's own time; it works through the whole of that day. Both are set when the key is made and shown in the list.

# Sending things into SALEANE

Stage 5 lets other software send things in with the same kind of access key: a booking tool adding visits, a client list kept in step, or a chain's own tills sending in their sales. Each needs a scope the owner ticks under **It may also change things** when making the key. A key made before Stage 5 keeps exactly the reading scopes it had.

| Scope                | What it allows                                                                                      |
| -------------------- | --------------------------------------------------------------------------------------------------- |
| `appointments:write` | Book, move and cancel visits, through the desk's checks.                                            |
| `clients:write`      | Add clients and change their details or what they said about email news. Not on a one-location key. |
| `sales:write`        | Send in sales and refunds from another till, at a location.                                         |

Everything a key sends in is recorded in **Who changed what** under the key's name ("Booking tool, through its access key"), and the owner can pick the key under Who to see only its changes. That stays true after the key is revoked.

## Every write

```
POST /api/v1/appointments
Authorization: Bearer sal_1a2b3c4d_…
Content-Type: application/json
Idempotency-Key: 6f1d4c2e-7b0a-4d8e-9a51-3c2f8e1b7d90
```

- `Content-Type: application/json` is required (415 otherwise).
- `Idempotency-Key` is required on every write (400, `idempotency_key_missing`, otherwise): up to 255 printable characters, quoted or not. Use a new random value for each change, and the same value when sending that change again.
- The first successful answer is kept for 30 days, for that key, with a hash of the method, the address and the body, in the same database transaction as the change. Sending the same key with the same request again changes nothing and gets that answer again, with `Idempotent-Replayed: true`. Sending the same key with a different request is refused with 422, `idempotency_key_reused`.
- A refused request keeps nothing, so it can be put right and sent again with the same key.
- Writes are refused with 402 while the studio is read only (`read_only`) or locked (`locked`) for an unpaid SALEANE bill; reads still work while it is only read only. A sample studio never takes anything in.

Refusals:

```json
{ "error": "That time is not free. Choose another time or professional.", "code": "time_taken" }
```

| Status | `code`                                                                 | When                                                                                         |
| ------ | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 400    | `invalid_request`                                                      | The body is not valid. `fields` lists `{ "field", "problem" }` for each field that is wrong. |
| 400    | `idempotency_key_missing`                                              | No usable `Idempotency-Key`.                                                                 |
| 401    | `unauthorised`                                                         | No key, a wrong or revoked key, a key past its last day, or one for a closed location.       |
| 402    | `read_only`, `locked`                                                  | The studio's SALEANE bill is unpaid.                                                         |
| 403    | `forbidden_scope`                                                      | The key does not have the scope this needs.                                                  |
| 403    | `wrong_location`                                                       | A one-location key asked for another location.                                               |
| 404    | `not_found`                                                            | No such visit or client (or, for a one-location key, not at its location).                   |
| 405    | `method_not_allowed`                                                   | A method that address does not take.                                                         |
| 409    | `time_taken`, `already_cancelled`, `not_upcoming`, `erasure_requested` | The visit's time is not free, or it cannot be changed now, or the client asked to be erased. |
| 409    | `duplicate_client`, `duplicate_receipt`                                | Already in SALEANE: the body also has `clientId` or `saleId`.                                |
| 415    | `unsupported_media_type`                                               | Not JSON.                                                                                    |
| 422    | `unprocessable`, `patch_test_needed`, `idempotency_key_reused`         | The desk would refuse it too, with the reason in `error`.                                    |
| 429    | `rate_limited`                                                         | Over 120 requests a minute for the key.                                                      |

## Visits

`POST /api/v1/appointments` books a visit. `professionalId` may be `"any"` (the default) for whoever is free; `locationId` may be left out (a one-location key always books at its own location). Send either `clientId` or `client`:

```json
{
  "serviceId": "svc_…",
  "professionalId": "any",
  "date": "2026-10-09",
  "start": "10:00",
  "client": {
    "name": "Ava Stone",
    "email": "ava@example.invalid",
    "phone": "+44 7700 900124",
    "emailNews": {
      "agreed": true,
      "at": "2026-10-08T18:02:00+01:00",
      "how": "Ticked the box on our booking form",
      "wordingVersion": 1
    }
  }
}
```

It answers `201` with the visit as `GET /api/v1/appointments` reads it, plus `locationId` and `priceMinor` (the booked price), and `source: "software"`.

It goes through the desk's own booking: the studio's and the professional's hours, who does the treatment, a free room or chair, guests holding a time online, and the treatment's usual price at that location kept as the booked price. A key always books at the usual price: a lower price for a quiet time is booked only from the guest's own invitation link, and a body that names an offer or a price is refused. Guests get the studio's usual booking messages, exactly as for a desk booking; nothing else is sent. The visit's history says it was booked by that software.

Patch tests: if the treatment needs one and the studio has turned on its rule for bookings made without the desk, the client needs a clear test that covers the visit's time; a new client never has one. A client whose last test was a reaction is never booked for that treatment through a key, whatever the rule. Both are refused with `patch_test_needed`.

`PATCH /api/v1/appointments/{id}` moves a visit still to come: any of `date`, `start`, `professionalId` and `locationId`. The same checks apply, and the guest's own visit links follow it, as when the desk moves it.

`POST /api/v1/appointments/{id}/cancel` cancels a visit still to come, under the desk's rules: its deposit history is kept for the studio to review, and SALEANE suggests the time it frees to the team for the waitlist, as for a desk cancellation. The body may give a `reason` (2 to 300 characters); otherwise the reason is "Cancelled through" and the key's name.

## Clients

`POST /api/v1/clients` adds a client: `name`, `email`, `phone` (with its country code) and optional `emailNews`. `PATCH /api/v1/clients/{id}` changes any of them. Both answer with `{ id, name, email, phone, emailNews, createdAt }`.

- A client is the same client when the name and the email match, ignoring capitals, as when the studio brings clients in from another system. Adding them again, or booking with their details, is refused with 409 `duplicate_client` and their `clientId`, so the software can use it.
- Email news is never assumed. It is recorded only when `emailNews` says `agreed`, `at` (when the client said so; not later than now) and `how` (in the software's words). Agreeing also needs `wordingVersion`, the version of the studio's wording the client saw (from `GET /api/v1/studio`); a version that is no longer current is refused. The client's permission history says it came from that software, with when and how.
- A client the studio has recorded an erasure request for gets nothing more (409, `erasure_requested`).

## Sales from another till

`POST /api/v1/till-sales` records a sale, or a refund, from a chain's own till at one of the studio's locations:

```json
{
  "kind": "sale",
  "locationId": "loc_…",
  "receipt": "T-1001",
  "occurredAt": "2026-10-08T14:32:00+01:00",
  "staffId": "staff_…",
  "lines": [
    {
      "kind": "treatment",
      "serviceId": "svc_…",
      "quantity": 1,
      "totalMinor": 9600,
      "taxMinor": 1600,
      "taxRateBps": 2000
    },
    {
      "kind": "product",
      "sku": "RO-1",
      "quantity": 2,
      "totalMinor": 4800,
      "taxMinor": 800,
      "taxRateBps": 2000
    },
    {
      "kind": "product",
      "name": "Gift wrap",
      "quantity": 1,
      "totalMinor": 120,
      "taxMinor": 20,
      "taxRateBps": 2000
    }
  ],
  "payments": [{ "method": "card", "amountMinor": 14520 }]
}
```

- Each line is a treatment or a product. A treatment links by `serviceId`; a product by `productId`, `barcode` or an `sku` only one product has. Anything SALEANE does not know is kept by the `name` sent.
- Amounts are in minor units with tax included. `taxMinor` is the tax inside `totalMinor` at `taxRateBps` (2000 is 20%), to within a penny for the till's own rounding. The payments must add up to the lines. `method` is `cash`, `card` or `other`. Up to 50 lines and 5 payments.
- `occurredAt` is when it happened on the till, with its offset; up to five minutes ahead of SALEANE's clock and up to 92 days back. It counts on the studio's own day it happened.
- `receipt` is the till's own receipt number. A receipt number is recorded once per location and kind: sending it again is refused with 409 `duplicate_receipt` and the `saleId` already recorded.
- `staffId` is optional: the team member who made the sale.

It answers `201` with the sale as kept, including how many of each known product came off the shelf, `shelfShort` for any the shelf did not have, and `tookPayment: false`.

What it means in SALEANE:

- It is money that till took. It counts in takings and Money for that location and day, marked "Sold on" and the key's name, with its receipt number. It is never recorded as a payment SALEANE took, never opens SALEANE's cash drawer and is not part of SALEANE's till count. In Money in and out it shows as "Sale on another till", paid by "Card on another till" and so on; in the sales list it says which till sent it; in the tax summary its lines are "…, from another till".
- Known products come off the shelf at that location. The sale has already happened, so it is never refused for stock: if SALEANE's count is lower, what is there comes off and `shelfShort` says what to count.
- Commission: when a `staffId` is named, they earn on each line under the Stage 3 pay rules, at their rate for that treatment or product if they have one, otherwise their usual rate or steps. A line SALEANE does not know earns the usual rate, or steps, for its kind. Someone renting a chair or room that day keeps their own takings, as at SALEANE's till, and earns no commission on them.
- Refunds and voids: send `kind: "refund"` with `refundOf` (the sale's receipt number at the same location), a `reason` and the lines and payments given back. A void is a refund of the whole receipt. It never gives back more than the sale took, puts products back on the shelf no more than the sale took off, shows in Money under Refund records, and comes off the commission of whoever made the sale unless the studio's pay rules say the studio absorbs money given back. There is no separate void.
- Tips, gift cards and plans are not sent in: they are sold in SALEANE.

## Its own changes coming back

A change a key makes is a normal saved change, so connected software is still told about it (a visit booked through a key is an `appointment.booked` event). Its events carry `changedBy` with the key and the `Saleane-Access-Key` header with the key's prefix, so software that both sends things in and hears events can ignore its own echo: compare the prefix or `changedBy.accessKey.id` with its own key from `GET /api/v1/studio`.

## Limits

- Everything here runs on this computer. No card payment, message or other outside service is involved in a write; the guests' messages it leads to go through the studio's outbox as usual, in test mode until a provider is connected.
- Sales from other tills are kept inside the studio record, up to 100,000 a studio. A chain sending many thousands a day would want them in a table of their own first.
- The answers kept for idempotency are kept for 30 days.
