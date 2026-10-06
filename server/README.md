# SALEANE local authority

This is a local V1 candidate. The application runs on one address with a Node HTTP API and SQLite on the same computer. The server, rather than a browser tab, owns signed-in workspace changes. Browser demo mode remains separate. No payment, email or SMS provider is connected.

## Run and configuration

Use the installed Node 22.22 runtime and existing project dependencies. `npm run dev` serves the UI and API together at `http://127.0.0.1:5173`. `npm run build` creates the application and standalone server; `npm start` runs that built application. Stop the development host before starting the built host on the same port. `npm run preview` previews static UI only and does not provide this API.

| Setting       | Default                                                         | Purpose                                                                                 |
| ------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `APP_ORIGIN`  | `http://127.0.0.1:5173`                                         | Exact browser origin, including port; writes require it and requests must use its Host. |
| `PORT`        | `5173`                                                          | Standalone listening port, 1024–65535. Development uses fixed port 5173.                |
| `DB_PATH`     | `.saleane-data/saleane.sqlite` in the current project directory | Durable local database; keep it outside static files and Git.                           |
| `STATIC_ROOT` | `dist`                                                          | Built standalone UI directory.                                                          |

The standalone host binds only `127.0.0.1`. It does not implement TLS, a reverse proxy, public hosting, background jobs or remote access. HTTPS origins require a separately qualified TLS host. `createApiHandler({origin,databasePath,now?,allowRegistration?})` is callable Node request/response middleware; registration can be disabled through its options. `.inject()` exercises the same handler without listening on a network port. `.close()` releases SQLite. Development middleware and standalone hosting must not run duplicate application servers.

## Authority and request contract

Passwords use salted scrypt; session cookies carry random tokens whose hashes are stored in SQLite. Cookies are HttpOnly, SameSite Strict and expire after 12 hours; HTTPS uses Secure. A password change revokes all previous sessions. Authenticated writes require `X-CSRF-Token` from registration, login or `GET /api/session`. All writes require the exact Origin and JSON. Host validation, cross-site rejection, request limits, bounded JSON bodies and generic server errors apply. No authentication secret appears in workspace or audit responses.

Schema changes are numbered, forward-only migrations in `database.ts`; each step commits with its version record, and a database written by an unknown version is refused. Migration 1 contains accounts, memberships, session hashes, invitations, organisation snapshots, command receipts, guest holds and audit events. A write checks membership and command permission, then executes synchronously inside `BEGIN IMMEDIATE`, saves the validated snapshot with its revision, records its receipt and audit, and commits. Competing stale revisions return 409. The command schema and transition rules are shared with the operating domain; the server supplies the authenticated actor and clock. Catalogue price, duration and buffer are appointment snapshots. Active guest holds participate in both desk booking and rescheduling, including exact room allocation.

For `POST /api/workspaces/:orgId/commands`, send `{revision,command}` and a unique `Idempotency-Key` of 8–100 safe characters. Retrying the same intent/key returns the original record ID and current authorised state. Reusing a key for another intent returns 409. Current membership and permission are checked before receipt replay, so a saved key does not preserve revoked access. The key is scoped to the account and organisation. Responses include `{ok,state,recordId}`; replay adds `replayed:true`. Validation, availability and role errors never partially publish a snapshot.

Owner access governs team changes, organisation identity and tax policy. Managers can manage operating configuration, catalogue and refunds. Reception access includes the workspace, clients, calendar and checkout ledger needed by the front desk. Practitioner provisioning and reads are deliberately disabled until an assigned-client projection is implemented and tested. There is no owner transfer UI or multiple-owner provisioning in this candidate.

## API

All paths below start with `/api`. Dates use `YYYY-MM-DD`; amounts are integer minor units. Success and error responses are JSON. Signed-in routes require the session cookie; writes also require CSRF. No endpoint sends an invitation or message.

| Method and path                         | Contract                                                                                                                                                                                  |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /health`                           | SQLite/local status and provider configuration flags.                                                                                                                                     |
| `GET /session`                          | Account, CSRF, authorised workspace summaries; 401 when signed out.                                                                                                                       |
| `POST /auth/register`                   | `{name,email,password,workspace}` or `{name,email,password,invitation}`; returns `{orgId,csrf}` and cookie.                                                                               |
| `POST /auth/login`                      | `{email,password}`; rotates a session and returns CSRF/cookie.                                                                                                                            |
| `POST /auth/logout`                     | `{}`; revokes this session.                                                                                                                                                               |
| `POST /auth/password`                   | `{current,password}`; revokes previous sessions and returns new CSRF/cookie.                                                                                                              |
| `POST /workspaces`                      | `{workspace}`; creates another organisation for this owner.                                                                                                                               |
| `GET /workspaces/:orgId`                | Validated state, role, slug, market-local business date and configuration flags. Foreign organisations return 404.                                                                        |
| `POST /workspaces/:orgId/commands`      | Revision/idempotency contract above.                                                                                                                                                      |
| `GET /workspaces/:orgId/team`           | Owner-only members and pending invitation summaries; no invitation tokens.                                                                                                                |
| `POST /workspaces/:orgId/invitations`   | Owner-only `{email,role}`; manager/reception roles enabled. Returns a manually shareable, 48-hour invitation URL with `delivery:'not_sent'`.                                              |
| `POST /invitations/accept`              | Signed-in `{invitation}`; accepts only for the matching account email.                                                                                                                    |
| `POST /workspaces/:orgId/membership`    | Owner-only `{accountId,role}`; manager/reception/remove; cannot remove or downgrade the owner.                                                                                            |
| `GET /workspaces/:orgId/audit`          | Owner/manager latest 200 scoped events; no command payloads, credentials or raw invitation tokens.                                                                                        |
| `POST /workspaces/:orgId/messages/send` | 503: delivery is unconfigured; queued drafts remain local.                                                                                                                                |
| `GET /public/:slug`                     | Enabled public booking catalogue, professionals, business date and explicit deposit/provider policy. No client, relationship, appointment or ledger state.                                |
| `GET /public/:slug/availability`        | Query `serviceId,staffId,date`; `staffId=any` permits no preference; returns available start-minute values.                                                                               |
| `POST /public/:slug/holds`              | `{serviceId,staffId,date,startMinutes}`; returns a five-minute random hold token and expiry. Token hash only is stored.                                                                   |
| `POST /public/:slug/holds/release`      | `{hold}`; returns `{released}`; frees only this organisation's unconsumed reservation.                                                                                                    |
| `POST /public/:slug/book`               | `{hold,contact:{name,email,phone,marketingConsent},policy:true}`; atomically consumes the hold, creates the appointment and returns its ID. Same-token/contact retry replays the receipt. |

Workspace input is `{name,region:'UK'|'US',locationName,address?,timeZone?,sample?}`. UK uses Europe/London; US accepts supported American time zones and defaults to America/New_York. `sample:false` is the default: a new business starts with no fictional clients, services, appointments, money or inventory. `sample:true` creates an isolated sandbox fixture owned by the new account. It cannot become a live workspace by changing browser state.

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
