# SALEANE local authority

This is a local V1 candidate. The application runs on one address with a Node HTTP API and SQLite on the same computer. The server, rather than a browser tab, owns signed-in workspace changes. Browser demo mode remains separate. No payment provider is connected. Appointment emails and texts run through an outbox that stays in test mode, sending nothing, until a provider is configured (below).

## Run and configuration

Use the installed Node 22.22 runtime and existing project dependencies. `npm run dev` serves the UI and API together at `http://127.0.0.1:5173`. `npm run build` creates the application and standalone server; `npm start` runs that built application. Stop the development host before starting the built host on the same port. `npm run preview` previews static UI only and does not provide this API.

| Setting       | Default                                                         | Purpose                                                                                 |
| ------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `APP_ORIGIN`  | `http://127.0.0.1:5173`                                         | Exact browser origin, including port; writes require it and requests must use its Host. |
| `PORT`        | `5173`                                                          | Standalone listening port, 1024–65535. Development uses fixed port 5173.                |
| `DB_PATH`     | `.saleane-data/saleane.sqlite` in the current project directory | Durable local database; keep it outside static files and Git.                           |
| `STATIC_ROOT` | `dist`                                                          | Built standalone UI directory.                                                          |

Optional bot check: set both `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` (Cloudflare Turnstile) to let a studio switch on a check before public holds. Without both keys the check is unavailable and the studio setting cannot be switched on; if keys are removed after a studio switched it on, holds proceed without the check until keys return. With them, the standalone host's content security policy also allows `https://challenges.cloudflare.com` for the widget script and frame. Cloudflare's test keys (`1x00000000000000000000AA` and `1x0000000000000000000000000000000AA`) always pass and suit local review.

The standalone host binds only `127.0.0.1`. It does not implement TLS, a reverse proxy, public hosting, background jobs or remote access. HTTPS origins require a separately qualified TLS host. `createApiHandler({origin,databasePath,now?,allowRegistration?})` is callable Node request/response middleware; registration can be disabled through its options. `.inject()` exercises the same handler without listening on a network port. `.close()` releases SQLite. Development middleware and standalone hosting must not run duplicate application servers.

### Appointment messages (PILOT-01)

The server plans booking confirmations, new-time notices, reminders and cancellation notices for real (non-sample) studios every 30 seconds and shortly after any change. Each message is recorded once in the `outbox` table, keyed by visit, kind, channel and visit time, so a restart or repeat pass cannot send it twice. Before it leaves, the visit and the client's choices are checked again; a visit that changed is skipped. The row is marked "unclear" before the provider is called, so a crash mid-send never causes a silent second copy. Busy providers are retried up to three times; an unclear outcome waits for staff to choose "Send again". Only a verified provider receipt marks a message delivered. The stored text keeps a placeholder where the private manage link goes; each message gets a fresh link (the newest four message links per visit stay open, and a desk or booking link still closes them all).

| Setting                                                  | Default | Purpose                                                                                                           |
| -------------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------- |
| `SALEANE_EMAIL_PROVIDER`                                 | `test`  | `test` writes emails down and sends nothing; `postmark` sends through Postmark.                                   |
| `POSTMARK_SERVER_TOKEN`, `SALEANE_EMAIL_FROM`            | unset   | Required for `postmark`; the from address must be a verified Postmark sender.                                     |
| `POSTMARK_WEBHOOK_SECRET`                                | unset   | Basic-auth password set on the Postmark delivery and bounce webhook pointing at `/api/hooks/postmark`.            |
| `SALEANE_SMS_PROVIDER`                                   | `test`  | `test` writes texts down and sends nothing; `twilio` sends through Twilio.                                        |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` | unset   | Required for `twilio`. `TWILIO_FROM` is a sending number or a Messaging Service SID (`MG…`). Receipts are signed. |

Naming a live provider without all of its keys stops the server at start rather than falling back. The Postmark and Twilio adapters follow each provider's published API and are covered by tests with simulated responses; they have not yet run against a real account. Receipts need a public HTTPS address, so they only arrive once the app is hosted.

## Authority and request contract

Passwords use salted scrypt; session cookies carry random tokens whose hashes are stored in SQLite. Cookies are HttpOnly, SameSite Strict and expire after 12 hours; HTTPS uses Secure. A password change revokes all previous sessions. Authenticated writes require `X-CSRF-Token` from registration, login or `GET /api/session`. All writes require the exact Origin and JSON. Host validation, cross-site rejection, request limits, bounded JSON bodies and generic server errors apply. No authentication secret appears in workspace or audit responses.

Schema changes are numbered, forward-only migrations in `database.ts`; each step commits with its version record, and a database written by an unknown version is refused. Migration 1 contains accounts, memberships, session hashes, invitations, organisation snapshots, command receipts, guest holds and audit events. A write checks membership and command permission, then executes synchronously inside `BEGIN IMMEDIATE`, saves the validated snapshot with its revision, records its receipt and audit, and commits. Competing stale revisions return 409. The command schema and transition rules are shared with the operating domain; the server supplies the authenticated actor and clock. Catalogue price, duration and buffer are appointment snapshots. Active guest holds participate in both desk booking and rescheduling, including exact room allocation.

For `POST /api/workspaces/:orgId/commands`, send `{revision,command}` and a unique `Idempotency-Key` of 8–100 safe characters. Retrying the same intent/key returns the original record ID and current authorised state. Reusing a key for another intent returns 409. Current membership and permission are checked before receipt replay, so a saved key does not preserve revoked access. The key is scoped to the account and organisation. Responses include `{ok,state,recordId}`; replay adds `replayed:true`. Validation, availability and role errors never partially publish a snapshot.

Owner access governs team changes, organisation identity and tax policy. Managers can manage operating configuration, catalogue and refunds. Reception access includes the workspace, clients, calendar and checkout ledger needed by the front desk. Practitioner provisioning and reads are deliberately disabled until an assigned-client projection is implemented and tested. There is no owner transfer UI or multiple-owner provisioning in this candidate.

## API

All paths below start with `/api`. Dates use `YYYY-MM-DD`; amounts are integer minor units. Success and error responses are JSON. Signed-in routes require the session cookie; writes also require CSRF. No endpoint sends an invitation or message.

| Method and path                              | Contract                                                                                                                                                                                  |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /health`                                | SQLite/local status and provider configuration flags.                                                                                                                                     |
| `GET /session`                               | Account, CSRF, authorised workspace summaries; 401 when signed out.                                                                                                                       |
| `POST /auth/register`                        | `{name,email,password,workspace}` or `{name,email,password,invitation}`; returns `{orgId,csrf}` and cookie.                                                                               |
| `POST /auth/login`                           | `{email,password}`; rotates a session and returns CSRF/cookie.                                                                                                                            |
| `POST /auth/logout`                          | `{}`; revokes this session.                                                                                                                                                               |
| `POST /auth/password`                        | `{current,password}`; revokes previous sessions and returns new CSRF/cookie.                                                                                                              |
| `POST /workspaces`                           | `{workspace}`; creates another organisation for this owner.                                                                                                                               |
| `GET /workspaces/:orgId`                     | Validated state, role, slug, market-local business date and configuration flags. Foreign organisations return 404.                                                                        |
| `POST /workspaces/:orgId/commands`           | Revision/idempotency contract above.                                                                                                                                                      |
| `GET /workspaces/:orgId/team`                | Owner-only members and pending invitation summaries; no invitation tokens.                                                                                                                |
| `POST /workspaces/:orgId/invitations`        | Owner-only `{email,role}`; manager/reception roles enabled. Returns a manually shareable, 48-hour invitation URL with `delivery:'not_sent'`.                                              |
| `POST /invitations/accept`                   | Signed-in `{invitation}`; accepts only for the matching account email.                                                                                                                    |
| `POST /workspaces/:orgId/membership`         | Owner-only `{accountId,role}`; manager/reception/remove; cannot remove or downgrade the owner.                                                                                            |
| `GET /workspaces/:orgId/audit`               | Owner/manager latest 200 scoped events; no command payloads, credentials or raw invitation tokens.                                                                                        |
| `POST /workspaces/:orgId/messages/send`      | 503: delivery is unconfigured; queued drafts remain local.                                                                                                                                |
| `GET /workspaces/:orgId/outbox`              | Owner, manager or reception. Query `clientId?`, `limit?` (1–200). Latest appointment messages with status and provider mode; the private link is never returned.                          |
| `POST /workspaces/:orgId/outbox/:id/retry`   | Owner or manager. Sends a failed or unclear message again, after the same checks.                                                                                                         |
| `POST /hooks/postmark`, `POST /hooks/twilio` | Provider delivery receipts. Verified by Postmark basic auth or Twilio signature; no session or Origin.                                                                                    |
| `GET /public/:slug`                          | Enabled public booking catalogue, professionals, business date and explicit deposit/provider policy. No client, relationship, appointment or ledger state.                                |
| `GET /public/:slug/availability`             | Query `serviceId,staffId,date`; `staffId=any` permits no preference; returns available start-minute values.                                                                               |
| `POST /public/:slug/holds`                   | `{serviceId,staffId,date,startMinutes,replaces?,botCheck?}`; returns a five-minute random hold token and expiry. Token hash only is stored. See hold protection below.                    |
| `POST /public/:slug/holds/release`           | `{hold}`; returns `{released}`; frees only this organisation's unconsumed reservation.                                                                                                    |
| `POST /public/:slug/book`                    | `{hold,contact:{name,email,phone,marketingConsent},policy:true}`; atomically consumes the hold, creates the appointment and returns its ID. Same-token/contact retry replays the receipt. |

Workspace input is `{name,region:'UK'|'US',locationName,address?,timeZone?,sample?}`. UK uses Europe/London; US accepts supported American time zones and defaults to America/New_York. `sample:false` is the default: a new business starts with no fictional clients, services, appointments, money or inventory. `sample:true` creates an isolated sandbox fixture owned by the new account. It cannot become a live workspace by changing browser state.

Hold protection: a hold lapses after five minutes. One visitor (network address, stored only as a per-process salted hash) keeps at most two unbooked holds per studio; a newer hold replaces the oldest, and a refused hold leaves the earlier ones in place. `replaces` releases the guest's previous hold first. Each address may create six holds a minute and thirty an hour (429 beyond that). A studio carries at most the larger of 8 or three per active professional unbooked holds at once (429 "Many guests are choosing times right now"); booked or expired holds stop counting. When the studio switched the bot check on and keys are configured, a hold needs a passing Turnstile token in `botCheck`; a missing, failed or unverifiable token returns 403 before anything is written. Behind a reverse proxy every guest shares the proxy's address, so these per-address limits need a trusted forwarded-address setting before hosting.

Public holds pin service duration, buffer, price, deposit requirement, resource type, professional and resource. A service edit, archive, closure, conflict or expiry invalidates an unconsumed confirmation. Releasing a hold does not cancel an appointment or erase its receipt. Completed confirmation retries preserve the receipt after hold expiry. Disabling public booking hides public routes. Local business booking collects no online money: pay at the studio. Its booked deposit requirement remains recorded, but no deposit receipt or settlement is invented. Only sandbox bookings simulate deposits. Locally recorded cash/external-card receipts are staff declarations; an external card reference is required and no provider verification is claimed.

## Backup and recovery

After the server/tool build, the CLI supports these actions (replace the example paths with your database and fresh destination):

```sh
npm run db:backup -- backup .saleane-data/saleane.sqlite work/backup-2026-10-06.sqlite
npm run db:backup -- verify work/backup-2026-10-06.sqlite
npm run db:backup -- restore work/backup-2026-10-06.sqlite work/recovered-2026-10-06.sqlite
```

`db:backup` runs `node server-dist/backup.js`. The backup entry is built after the host entry with `vite build --ssr server/backup.ts --outDir server-dist --emptyOutDir false`.

Backup uses SQLite `VACUUM INTO` for a consistent snapshot, including committed WAL data while the source is open. Source validation and copy validation check integrity, foreign keys, supported migration version, required tables and every organisation snapshot/revision. The copy is private and published atomically. Existing destinations, even empty files or paths with SQLite companions, are refused. The tool never changes the source or overwrites a running database.

Restore requires a fresh destination and clears sessions, invitations and guest holds so stale credentials and reservations cannot be resurrected. Accounts, memberships, workspace state, command receipts and prior audit are preserved; each workspace gets a `workspace.restored` audit entry. Stop the application, verify the recovered path, then explicitly set `DB_PATH` to it and start one host. No automatic replacement or configuration change occurs. Backups contain client and account data and need appropriate private storage; off-device encrypted backup, retention and disaster recovery remain release gates.

## Verification and remaining gates

`vitest run --config server/vitest.config.ts` runs Node-only API/database tests using `.inject()` and disposable database files. It covers request/auth boundaries, tenant access, revision races, idempotency and role revocation, file reopen, public DTO privacy, held-resource allocation, hold release/expiry/replay, changed catalogue contracts, zero automatic local deposits, and live-WAL backup/fresh-path restore. No provider/network side effects occur. Parent release evidence records the separately exercised browser and full-app build/lint checks; this API test suite does not prove them.

This candidate has one location per workspace and transactional JSON snapshots, not a qualified multi-site hosted database. It has no password reset/email verification/MFA, clinical records, provider reconciliation, online payment, real communications delivery, deployment monitoring, external backup, automated retention, migration rollback or production load qualification. The local rate limiter is process-local. SQLite is experimental in the tested Node runtime. Remote hosting, practitioner projection, real service connections, tax/legal acceptance, data migration and operational recovery are explicit later gates. Saleane Clinical remains a separate compliance boundary.

Primary references: [Node 22 SQLite API](https://nodejs.org/download/release/v22.22.0/docs/api/sqlite.html), [SQLite VACUUM INTO](https://www.sqlite.org/lang_vacuum.html).
