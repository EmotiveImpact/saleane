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
- Fields may be added within an `apiVersion`; none are removed or renamed without a new one.

Headers:

| Header              | Value                                                      |
| ------------------- | ---------------------------------------------------------- |
| `Saleane-Event`     | The event type.                                            |
| `Saleane-Delivery`  | The event `id`. The same on every retry: use it to dedupe. |
| `Saleane-Signature` | `t=<unix seconds>,v1=<hex HMAC-SHA256>`                    |

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

# Reading from SALEANE

Other software can also read from a studio, with an access key the owner makes in Settings › Connected software › Access keys. A key belongs to one studio, reads only what the owner ticked, cannot change anything, and stops working the moment it is revoked. The key (`sal_…`) is shown once; SALEANE keeps only a hash of it. Sample studios cannot make keys.

Send it on every request:

```
GET /api/v1/appointments?from=2026-10-01&to=2026-10-31
Authorization: Bearer sal_1a2b3c4d_…
```

| Endpoint                           | Needs               | Returns                                                                                                                            |
| ---------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/studio`               | any key             | The studio's id, name, time zone and currency, the key's scopes, and its `locationId` and `endsOn` (null when not set).            |
| `GET /api/v1/appointments?from&to` | `appointments:read` | Visits on those dates (up to 31 days), in time order, as in the event payload plus `clientId`, `serviceId` and `professionalId`.   |
| `GET /api/v1/clients`              | `clients:read`      | Clients oldest first: id, name, email, phone, whether they agreed to email news, and when they were added.                         |
| `GET /api/v1/services`             | `services:read`     | Treatments in use with duration and price in minor units (paged), and the team with the treatments each offers.                    |
| `GET /api/v1/takings?from&to`      | `takings:read`      | One line per day (up to 31 days) of treatments, products, tax, tips, plans, rent, fees and money given back. No receipts or names. |

Visits, clients and treatments take `limit` (1 to 200, default 100) and `offset`, and say the `total`; the team comes whole with the treatments. Each key may make 120 requests a minute in all, from wherever they come. Anything but `GET` is refused with 405, a missing, wrong or revoked key, a key past its last day or one for a closed location with 401, a scope the key lacks with 403, and too many requests with 429.

## Partner keys

A key can be kept to one location, for a partner that works with one branch such as that branch's own till. It reads only that location's visits, plus the treatments and team; clients and takings belong to the whole studio and cannot be given to a one-location key. A key can also stop after a chosen day (up to a year ahead), counted in the studio's own time; it works through the whole of that day. Both are set when the key is made and shown in the list.
