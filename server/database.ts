import { DatabaseSync } from 'node:sqlite'
import type { SQLInputValue } from 'node:sqlite'
import { chmodSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

/**
 * One forward schema step. Versions rise from 1 in order (contiguous once work built alongside has
 * merged); never edit a released step.
 */
export type Migration = { version: number; up: (connection: DatabaseSync) => void }

export const migrations: Migration[] = [
  {
    version: 1,
    // Accounts, memberships, sessions, invitations, organisation snapshots, receipts, holds, audit.
    up: (connection) =>
      connection.exec(`
        CREATE TABLE IF NOT EXISTS accounts (
          id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL,
          password_hash TEXT NOT NULL, created_at INTEGER NOT NULL
        ) STRICT;
        CREATE TABLE IF NOT EXISTS organisations (
          id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, state TEXT NOT NULL CHECK(json_valid(state)),
          revision INTEGER NOT NULL CHECK(revision>=0), created_at INTEGER NOT NULL,
          CHECK(json_extract(state,'$.organisation.id')=id), CHECK(json_extract(state,'$.revision')=revision)
        ) STRICT;
        CREATE TABLE IF NOT EXISTS memberships (
          organisation_id TEXT NOT NULL REFERENCES organisations(id), account_id TEXT NOT NULL REFERENCES accounts(id),
          role TEXT NOT NULL CHECK(role IN ('owner','manager','reception','practitioner')), staff_id TEXT,
          PRIMARY KEY(organisation_id,account_id)
        ) STRICT;
        CREATE TABLE IF NOT EXISTS sessions (
          token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id), csrf TEXT NOT NULL,
          created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
        ) STRICT;
        CREATE INDEX IF NOT EXISTS sessions_account ON sessions(account_id,expires_at);
        CREATE TABLE IF NOT EXISTS invitations (
          token_hash TEXT PRIMARY KEY, organisation_id TEXT NOT NULL REFERENCES organisations(id), email TEXT NOT NULL,
          role TEXT NOT NULL CHECK(role IN ('manager','reception','practitioner')), staff_id TEXT,
          created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, used_at INTEGER
        ) STRICT;
        CREATE TABLE IF NOT EXISTS command_receipts (
          organisation_id TEXT NOT NULL REFERENCES organisations(id), account_id TEXT NOT NULL REFERENCES accounts(id),
          key TEXT NOT NULL, fingerprint TEXT NOT NULL, record_id TEXT NOT NULL, revision INTEGER NOT NULL,
          created_at INTEGER NOT NULL, PRIMARY KEY(organisation_id,account_id,key)
        ) STRICT;
        CREATE TABLE IF NOT EXISTS booking_holds (
          token_hash TEXT PRIMARY KEY, id TEXT NOT NULL UNIQUE, organisation_id TEXT NOT NULL REFERENCES organisations(id),
          input TEXT NOT NULL CHECK(json_valid(input)), expires_at INTEGER NOT NULL,
          appointment_id TEXT, fingerprint TEXT
        ) STRICT;
        CREATE INDEX IF NOT EXISTS booking_holds_scope ON booking_holds(organisation_id,expires_at);
        CREATE TABLE IF NOT EXISTS audit_events (
          id TEXT PRIMARY KEY, organisation_id TEXT NOT NULL REFERENCES organisations(id), actor_id TEXT,
          action TEXT NOT NULL, record_id TEXT NOT NULL, revision INTEGER NOT NULL, occurred_at INTEGER NOT NULL
        ) STRICT;
        CREATE INDEX IF NOT EXISTS audit_scope ON audit_events(organisation_id,occurred_at);
      `),
  },
  {
    version: 2,
    // Public hold protection: which visitor made a hold, so one visitor cannot stack them.
    up: (connection) =>
      connection.exec(`
        ALTER TABLE booking_holds ADD COLUMN visitor TEXT;
        CREATE INDEX IF NOT EXISTS booking_holds_visitor ON booking_holds(organisation_id,visitor,expires_at);
      `),
  },
  {
    version: 3,
    // Guest manage links (LOCAL-02): one hashed, expiring, revocable capability per visit.
    up: (connection) =>
      connection.exec(`
        CREATE TABLE guest_links (
          token_hash TEXT PRIMARY KEY, organisation_id TEXT NOT NULL REFERENCES organisations(id),
          appointment_id TEXT NOT NULL, origin TEXT NOT NULL CHECK(origin IN ('booking','desk')),
          created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, revoked_at INTEGER
        ) STRICT;
        CREATE INDEX guest_links_visit ON guest_links(organisation_id,appointment_id);
      `),
  },
  {
    version: 4,
    // PILOT-01: the message outbox, and manage links that a sent message carries.
    up: (connection) =>
      connection.exec(`
        CREATE TABLE outbox (
          id TEXT PRIMARY KEY, organisation_id TEXT NOT NULL REFERENCES organisations(id),
          dedupe_key TEXT NOT NULL, appointment_id TEXT NOT NULL, client_id TEXT NOT NULL,
          kind TEXT NOT NULL CHECK(kind IN ('confirmation','changed','reminder','cancelled')),
          channel TEXT NOT NULL CHECK(channel IN ('email','sms')), slot TEXT NOT NULL,
          recipient TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('pending','test','accepted','delivered','failed','unknown','skipped')),
          provider TEXT, provider_ref TEXT, detail TEXT, attempts INTEGER NOT NULL DEFAULT 0,
          next_attempt_at INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
          UNIQUE(organisation_id,dedupe_key)
        ) STRICT;
        CREATE INDEX outbox_due ON outbox(status,next_attempt_at);
        CREATE INDEX outbox_visit ON outbox(organisation_id,appointment_id);
        CREATE INDEX outbox_recent ON outbox(organisation_id,created_at);
        CREATE UNIQUE INDEX outbox_provider_ref ON outbox(provider,provider_ref) WHERE provider_ref IS NOT NULL;
        CREATE TABLE guest_links_next (
          token_hash TEXT PRIMARY KEY, organisation_id TEXT NOT NULL REFERENCES organisations(id),
          appointment_id TEXT NOT NULL, origin TEXT NOT NULL CHECK(origin IN ('booking','desk','message')),
          created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, revoked_at INTEGER
        ) STRICT;
        INSERT INTO guest_links_next SELECT token_hash,organisation_id,appointment_id,origin,created_at,expires_at,revoked_at FROM guest_links;
        DROP TABLE guest_links;
        ALTER TABLE guest_links_next RENAME TO guest_links;
        CREATE INDEX guest_links_visit ON guest_links(organisation_id,appointment_id);
      `),
  },
  {
    version: 5,
    // PILOT-02: each card payment, saved card and card refund the provider handles.
    up: (connection) =>
      connection.exec(`
        CREATE TABLE payment_attempts (
          id TEXT PRIMARY KEY, organisation_id TEXT NOT NULL REFERENCES organisations(id),
          appointment_id TEXT NOT NULL, client_id TEXT NOT NULL,
          purpose TEXT NOT NULL CHECK(purpose IN ('deposit','balance','fee','save_card','refund')),
          route TEXT NOT NULL CHECK(route IN ('hosted','saved_card','reader','refund')),
          amount_minor INTEGER NOT NULL CHECK(amount_minor>=0), currency TEXT NOT NULL,
          tip_minor INTEGER NOT NULL DEFAULT 0, discount_minor INTEGER NOT NULL DEFAULT 0,
          save_card INTEGER NOT NULL DEFAULT 0, refund_of TEXT, reason TEXT,
          provider TEXT NOT NULL, provider_ref TEXT,
          status TEXT NOT NULL CHECK(status IN ('started','processing','succeeded','failed','unknown','review')),
          detail TEXT, ledger_id TEXT, request_key TEXT, actor_id TEXT,
          created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
        ) STRICT;
        CREATE INDEX payment_attempts_visit ON payment_attempts(organisation_id,appointment_id);
        CREATE UNIQUE INDEX payment_attempts_key ON payment_attempts(organisation_id,actor_id,request_key) WHERE request_key IS NOT NULL;
        CREATE TABLE saved_cards (
          id TEXT PRIMARY KEY, organisation_id TEXT NOT NULL REFERENCES organisations(id),
          client_id TEXT NOT NULL, provider TEXT NOT NULL, customer_ref TEXT NOT NULL, method_ref TEXT NOT NULL,
          brand TEXT NOT NULL, last4 TEXT NOT NULL, exp_month INTEGER NOT NULL, exp_year INTEGER NOT NULL,
          agreed TEXT NOT NULL, created_at INTEGER NOT NULL, removed_at INTEGER,
          UNIQUE(organisation_id,provider,method_ref)
        ) STRICT;
        CREATE INDEX saved_cards_client ON saved_cards(organisation_id,client_id);
      `),
  },
  {
    version: 6,
    // V1.5: the outbox also carries the private "how was your visit?" request.
    up: (connection) =>
      connection.exec(`
        CREATE TABLE outbox_next (
          id TEXT PRIMARY KEY, organisation_id TEXT NOT NULL REFERENCES organisations(id),
          dedupe_key TEXT NOT NULL, appointment_id TEXT NOT NULL, client_id TEXT NOT NULL,
          kind TEXT NOT NULL CHECK(kind IN ('confirmation','changed','reminder','cancelled','feedback')),
          channel TEXT NOT NULL CHECK(channel IN ('email','sms')), slot TEXT NOT NULL,
          recipient TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('pending','test','accepted','delivered','failed','unknown','skipped')),
          provider TEXT, provider_ref TEXT, detail TEXT, attempts INTEGER NOT NULL DEFAULT 0,
          next_attempt_at INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
          UNIQUE(organisation_id,dedupe_key)
        ) STRICT;
        INSERT INTO outbox_next SELECT id,organisation_id,dedupe_key,appointment_id,client_id,kind,channel,slot,recipient,subject,body,status,provider,provider_ref,detail,attempts,next_attempt_at,created_at,updated_at FROM outbox;
        DROP TABLE outbox;
        ALTER TABLE outbox_next RENAME TO outbox;
        CREATE INDEX outbox_due ON outbox(status,next_attempt_at);
        CREATE INDEX outbox_visit ON outbox(organisation_id,appointment_id);
        CREATE INDEX outbox_recent ON outbox(organisation_id,created_at);
        CREATE UNIQUE INDEX outbox_provider_ref ON outbox(provider,provider_ref) WHERE provider_ref IS NOT NULL;
      `),
  },
  {
    version: 7,
    // Ask Saleane: each studio's assistant use this month, so the allowance holds across restarts.
    up: (connection) =>
      connection.exec(`
        CREATE TABLE assistant_usage (
          organisation_id TEXT PRIMARY KEY REFERENCES organisations(id),
          usage TEXT NOT NULL, updated_at INTEGER NOT NULL
        ) STRICT;
      `),
  },
  {
    version: 8,
    // V1.5: a gift card paying part of a visit whose rest is charged to a card.
    up: (connection) =>
      connection.exec(`
        ALTER TABLE payment_attempts ADD COLUMN gift_card_id TEXT;
        ALTER TABLE payment_attempts ADD COLUMN gift_card_minor INTEGER NOT NULL DEFAULT 0 CHECK(gift_card_minor>=0);
      `),
  },
  {
    version: 9,
    // V2: a card checkout remembers the products added, so the receipt matches what was charged.
    up: (connection) => connection.exec('ALTER TABLE payment_attempts ADD COLUMN products TEXT;'),
  },
  {
    version: 10,
    // V1.5: the outbox also asks a guest to come in for a patch test before a booked treatment.
    up: (connection) =>
      connection.exec(
        outboxWithKinds([
          'confirmation',
          'changed',
          'reminder',
          'cancelled',
          'feedback',
          'patch_test',
        ]),
      ),
  },
  {
    version: 11,
    // V1.5: aftercare advice after a visit, and a "due back" note to guests who agreed to hear.
    up: (connection) =>
      connection.exec(
        outboxWithKinds([
          'confirmation',
          'changed',
          'reminder',
          'cancelled',
          'feedback',
          'patch_test',
          'aftercare',
          'due_back',
        ]),
      ),
  },
  {
    version: 12,
    // V1.5: a birthday email and a "we miss you" email, about the guest rather than one visit.
    up: (connection) =>
      connection.exec(
        outboxWithKinds([
          'confirmation',
          'changed',
          'reminder',
          'cancelled',
          'feedback',
          'patch_test',
          'aftercare',
          'due_back',
          'birthday',
          'miss_you',
        ]),
      ),
  },
  {
    version: 13,
    // V1.5: one text with the booking link to a caller the studio missed.
    up: (connection) =>
      connection.exec(
        outboxWithKinds([
          'confirmation',
          'changed',
          'reminder',
          'cancelled',
          'feedback',
          'patch_test',
          'aftercare',
          'due_back',
          'birthday',
          'miss_you',
          'missed_call',
        ]),
      ),
  },
  {
    version: 14,
    // V1.5: a message the studio wrote and approved in the inbox, sent once by the outbox.
    up: (connection) =>
      connection.exec(
        outboxWithKinds([
          'confirmation',
          'changed',
          'reminder',
          'cancelled',
          'feedback',
          'patch_test',
          'aftercare',
          'due_back',
          'birthday',
          'miss_you',
          'missed_call',
          'message',
        ]),
      ),
  },
  {
    version: 15,
    // V5: other software the owner connects, and every delivery made to it.
    up: (connection) =>
      connection.exec(`
        CREATE TABLE connections (
          id TEXT PRIMARY KEY, organisation_id TEXT NOT NULL REFERENCES organisations(id),
          name TEXT NOT NULL, url TEXT NOT NULL, events TEXT NOT NULL CHECK(json_valid(events)),
          share_contact INTEGER NOT NULL CHECK(share_contact IN (0,1)),
          secret TEXT NOT NULL, active INTEGER NOT NULL CHECK(active IN (0,1)),
          removed_at INTEGER, created_by TEXT NOT NULL, created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        ) STRICT;
        CREATE INDEX connections_org ON connections(organisation_id);
        CREATE TABLE connection_deliveries (
          id TEXT PRIMARY KEY, organisation_id TEXT NOT NULL REFERENCES organisations(id),
          connection_id TEXT NOT NULL REFERENCES connections(id), event_id TEXT NOT NULL,
          event_type TEXT NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload)),
          status TEXT NOT NULL CHECK(status IN ('pending','delivered','failed','skipped','unknown','test')),
          attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at INTEGER NOT NULL,
          response_status INTEGER, detail TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
          UNIQUE(connection_id,event_id)
        ) STRICT;
        CREATE INDEX connection_deliveries_due ON connection_deliveries(status,next_attempt_at);
        CREATE INDEX connection_deliveries_recent ON connection_deliveries(organisation_id,created_at);
      `),
  },
  {
    version: 16,
    // V5: read-only access keys for other software, stored only as a hash.
    up: (connection) =>
      connection.exec(`
        CREATE TABLE api_keys (
          id TEXT PRIMARY KEY, organisation_id TEXT NOT NULL REFERENCES organisations(id),
          name TEXT NOT NULL, prefix TEXT NOT NULL UNIQUE, key_hash TEXT NOT NULL,
          scopes TEXT NOT NULL CHECK(json_valid(scopes)), created_by TEXT NOT NULL,
          created_at INTEGER NOT NULL, last_used_at INTEGER, revoked_at INTEGER
        ) STRICT;
        CREATE INDEX api_keys_org ON api_keys(organisation_id);
      `),
  },
  {
    version: 17,
    // V4: the AI receptionist's answer to a guest's text, sent once by the outbox.
    up: (connection) =>
      connection.exec(
        outboxWithKinds([
          'confirmation',
          'changed',
          'reminder',
          'cancelled',
          'feedback',
          'patch_test',
          'aftercare',
          'due_back',
          'birthday',
          'miss_you',
          'missed_call',
          'message',
          'receptionist',
        ]),
      ),
  },
  {
    version: 18,
    // V4: bookings made inside Google, so Google can look them up, cancel them or repeat a request.
    up: (connection) =>
      connection.exec(`
        CREATE TABLE google_bookings (
          booking_id TEXT PRIMARY KEY, organisation_id TEXT NOT NULL REFERENCES organisations(id),
          user_id TEXT NOT NULL, idempotency_token TEXT NOT NULL,
          slot TEXT NOT NULL CHECK(json_valid(slot)),
          user_information TEXT NOT NULL CHECK(json_valid(user_information)),
          created_at INTEGER NOT NULL,
          UNIQUE(organisation_id,idempotency_token)
        ) STRICT;
        CREATE INDEX google_bookings_user ON google_bookings(user_id);
      `),
  },
  {
    version: 19,
    // V4: the team's answers on Instagram, Facebook and WhatsApp go through the outbox, and each
    // studio's accounts on those apps, so a message that comes in reaches the right studio.
    up: (connection) =>
      connection.exec(
        outboxWithKinds(
          [
            'confirmation',
            'changed',
            'reminder',
            'cancelled',
            'feedback',
            'patch_test',
            'aftercare',
            'due_back',
            'birthday',
            'miss_you',
            'missed_call',
            'message',
            'receptionist',
            'social',
          ],
          ['email', 'sms', 'instagram', 'facebook', 'whatsapp'],
        ) +
          `
        CREATE TABLE social_accounts (
          channel TEXT NOT NULL CHECK(channel IN ('instagram','facebook','whatsapp')),
          account_id TEXT NOT NULL, organisation_id TEXT NOT NULL REFERENCES organisations(id),
          connected_at INTEGER NOT NULL,
          PRIMARY KEY(channel,account_id), UNIQUE(organisation_id,channel)
        ) STRICT;
      `,
      ),
  },
  {
    version: 20,
    // V5: a regional manager looks after one region's locations. SQLite cannot widen the role
    // check in place, so both tables are rebuilt with the same columns, keys and rows, plus the
    // region (area_id) a regional manager's access covers.
    up: (connection) =>
      connection.exec(`
        CREATE TABLE memberships_next (
          organisation_id TEXT NOT NULL REFERENCES organisations(id), account_id TEXT NOT NULL REFERENCES accounts(id),
          role TEXT NOT NULL CHECK(role IN ('owner','manager','reception','practitioner','regional')), staff_id TEXT,
          area_id TEXT, CHECK((role='regional')=(area_id IS NOT NULL)),
          PRIMARY KEY(organisation_id,account_id)
        ) STRICT;
        INSERT INTO memberships_next(organisation_id,account_id,role,staff_id) SELECT organisation_id,account_id,role,staff_id FROM memberships;
        DROP TABLE memberships;
        ALTER TABLE memberships_next RENAME TO memberships;
        CREATE TABLE invitations_next (
          token_hash TEXT PRIMARY KEY, organisation_id TEXT NOT NULL REFERENCES organisations(id), email TEXT NOT NULL,
          role TEXT NOT NULL CHECK(role IN ('manager','reception','practitioner','regional')), staff_id TEXT,
          created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, used_at INTEGER,
          area_id TEXT, CHECK((role='regional')=(area_id IS NOT NULL))
        ) STRICT;
        INSERT INTO invitations_next(token_hash,organisation_id,email,role,staff_id,created_at,expires_at,used_at) SELECT token_hash,organisation_id,email,role,staff_id,created_at,expires_at,used_at FROM invitations;
        DROP TABLE invitations;
        ALTER TABLE invitations_next RENAME TO invitations;
      `),
  },
  {
    version: 21,
    // V5: a general manager runs one location. Both tables are rebuilt again with the same
    // columns, keys and rows, plus the location (location_id) a general manager's access covers.
    up: (connection) =>
      connection.exec(`
        CREATE TABLE memberships_next (
          organisation_id TEXT NOT NULL REFERENCES organisations(id), account_id TEXT NOT NULL REFERENCES accounts(id),
          role TEXT NOT NULL CHECK(role IN ('owner','manager','reception','practitioner','regional','general')), staff_id TEXT,
          area_id TEXT, location_id TEXT,
          CHECK((role='regional')=(area_id IS NOT NULL)), CHECK((role='general')=(location_id IS NOT NULL)),
          PRIMARY KEY(organisation_id,account_id)
        ) STRICT;
        INSERT INTO memberships_next(organisation_id,account_id,role,staff_id,area_id) SELECT organisation_id,account_id,role,staff_id,area_id FROM memberships;
        DROP TABLE memberships;
        ALTER TABLE memberships_next RENAME TO memberships;
        CREATE TABLE invitations_next (
          token_hash TEXT PRIMARY KEY, organisation_id TEXT NOT NULL REFERENCES organisations(id), email TEXT NOT NULL,
          role TEXT NOT NULL CHECK(role IN ('manager','reception','practitioner','regional','general')), staff_id TEXT,
          created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, used_at INTEGER,
          area_id TEXT, location_id TEXT,
          CHECK((role='regional')=(area_id IS NOT NULL)), CHECK((role='general')=(location_id IS NOT NULL))
        ) STRICT;
        INSERT INTO invitations_next(token_hash,organisation_id,email,role,staff_id,created_at,expires_at,used_at,area_id) SELECT token_hash,organisation_id,email,role,staff_id,created_at,expires_at,used_at,area_id FROM invitations;
        DROP TABLE invitations;
        ALTER TABLE invitations_next RENAME TO invitations;
      `),
  },
  {
    version: 22,
    // V5: a partner's access key can cover one location and stop on a chosen day.
    up: (connection) =>
      connection.exec(`
        ALTER TABLE api_keys ADD COLUMN location_id TEXT;
        ALTER TABLE api_keys ADD COLUMN ends_on TEXT;
      `),
  },
  {
    version: 23,
    // NEXT-03, forgotten passwords and email confirmation: single-use links (stored as hashes),
    // and a record of each account email and what really happened to it.
    up: (connection) =>
      connection.exec(`
        ALTER TABLE accounts ADD COLUMN email_confirmed_at INTEGER;
        CREATE TABLE account_links (
          token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id),
          kind TEXT NOT NULL CHECK(kind IN ('reset','confirm')), email TEXT NOT NULL,
          created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, used_at INTEGER
        ) STRICT;
        CREATE INDEX account_links_account ON account_links(account_id,kind);
        CREATE TABLE account_mail (
          id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id),
          kind TEXT NOT NULL CHECK(kind IN ('reset','confirm')), recipient TEXT NOT NULL,
          subject TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('test','accepted','failed','unknown')),
          provider TEXT, provider_ref TEXT, detail TEXT, created_at INTEGER NOT NULL
        ) STRICT;
        CREATE INDEX account_mail_recent ON account_mail(account_id,created_at);
      `),
  },
  {
    version: 24,
    // NEXT-04, two-step sign-in: the authenticator key once it is confirmed (and the last code
    // step used, so a code never works twice), a key being set up, recovery codes stored as
    // hashes, the short step between password and code, and sign-in notices by email.
    up: (connection) =>
      connection.exec(`
        ALTER TABLE accounts ADD COLUMN totp_secret TEXT;
        ALTER TABLE accounts ADD COLUMN totp_enabled_at INTEGER;
        ALTER TABLE accounts ADD COLUMN totp_last_step INTEGER;
        CREATE TABLE totp_setup (
          account_id TEXT PRIMARY KEY REFERENCES accounts(id), secret TEXT NOT NULL,
          created_at INTEGER NOT NULL
        ) STRICT;
        CREATE TABLE recovery_codes (
          account_id TEXT NOT NULL REFERENCES accounts(id), code_hash TEXT NOT NULL,
          created_at INTEGER NOT NULL, used_at INTEGER, PRIMARY KEY(account_id,code_hash)
        ) STRICT;
        CREATE TABLE login_challenges (
          token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id),
          created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
          attempts INTEGER NOT NULL DEFAULT 0, used_at INTEGER
        ) STRICT;
        CREATE TABLE account_mail_next (
          id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id),
          kind TEXT NOT NULL CHECK(kind IN ('reset','confirm','security')), recipient TEXT NOT NULL,
          subject TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('test','accepted','failed','unknown')),
          provider TEXT, provider_ref TEXT, detail TEXT, created_at INTEGER NOT NULL
        ) STRICT;
        INSERT INTO account_mail_next SELECT id,account_id,kind,recipient,subject,status,provider,provider_ref,detail,created_at FROM account_mail;
        DROP TABLE account_mail;
        ALTER TABLE account_mail_next RENAME TO account_mail;
        CREATE INDEX account_mail_recent ON account_mail(account_id,created_at);
      `),
  },
  {
    version: 25,
    // NEXT-05, who changed what: which details of a record a change touched, with the before and
    // after values that are safe to keep, and finding one person's changes quickly.
    up: (connection) =>
      connection.exec(`
        ALTER TABLE audit_events ADD COLUMN detail TEXT CHECK(detail IS NULL OR json_valid(detail));
        CREATE INDEX audit_actor ON audit_events(organisation_id,actor_id,occurred_at);
      `),
  },
  {
    version: 26,
    // NEXT-02, studios paying for SALEANE: each real studio's plan (trial, paid month, overdue or
    // read only, with its saved card as the payment service's references, and held from charging
    // by itself after a restore), its bills, each card being saved, and billing emails to the
    // owner. One live month's bill per studio and start, so two runs cannot bill a month twice.
    up: (connection) =>
      connection.exec(`
        CREATE TABLE studio_plans (
          organisation_id TEXT PRIMARY KEY REFERENCES organisations(id),
          status TEXT NOT NULL CHECK(status IN ('trial','active','overdue','stopped')),
          stop_reason TEXT CHECK(stop_reason IN ('trial_ended','unpaid','cancelled')),
          trial_ends_at INTEGER NOT NULL, trial_warned_at INTEGER,
          anchor_day INTEGER CHECK(anchor_day BETWEEN 1 AND 31),
          period_start INTEGER, period_end INTEGER,
          plus INTEGER NOT NULL DEFAULT 0 CHECK(plus IN (0,1)),
          plus_next INTEGER NOT NULL DEFAULT 0 CHECK(plus_next IN (0,1)),
          cancel_at_period_end INTEGER NOT NULL DEFAULT 0 CHECK(cancel_at_period_end IN (0,1)),
          overdue_since INTEGER, next_attempt_at INTEGER,
          card_customer_ref TEXT, card_method_ref TEXT, card_brand TEXT, card_last4 TEXT,
          card_exp_month INTEGER, card_exp_year INTEGER,
          held_at INTEGER,
          created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
          CHECK((status='stopped')=(stop_reason IS NOT NULL)),
          CHECK((status='overdue')=(overdue_since IS NOT NULL))
        ) STRICT;
        CREATE TABLE studio_invoices (
          id TEXT PRIMARY KEY, organisation_id TEXT NOT NULL REFERENCES organisations(id),
          number TEXT NOT NULL UNIQUE, kind TEXT NOT NULL CHECK(kind IN ('month','plus')),
          period_start INTEGER NOT NULL, period_end INTEGER NOT NULL CHECK(period_end>period_start),
          plus INTEGER NOT NULL CHECK(plus IN (0,1)),
          currency TEXT NOT NULL CHECK(currency IN ('GBP','USD')),
          lines TEXT NOT NULL CHECK(json_valid(lines)),
          subtotal_minor INTEGER NOT NULL CHECK(subtotal_minor>=0),
          tax_minor INTEGER NOT NULL CHECK(tax_minor>=0), tax_label TEXT,
          total_minor INTEGER NOT NULL CHECK(total_minor=subtotal_minor+tax_minor),
          status TEXT NOT NULL CHECK(status IN ('open','charging','paid','void','unknown')),
          test INTEGER NOT NULL CHECK(test IN (0,1)),
          attempt_key TEXT, attempts INTEGER NOT NULL DEFAULT 0, charged_at INTEGER,
          provider_ref TEXT, detail TEXT,
          created_at INTEGER NOT NULL, paid_at INTEGER, closed_at INTEGER
        ) STRICT;
        CREATE INDEX studio_invoices_recent ON studio_invoices(organisation_id,created_at);
        CREATE UNIQUE INDEX studio_invoices_month ON studio_invoices(organisation_id,period_start) WHERE kind='month' AND status<>'void';
        CREATE UNIQUE INDEX studio_invoices_attempt ON studio_invoices(attempt_key) WHERE attempt_key IS NOT NULL;
        CREATE TABLE billing_setups (
          id TEXT PRIMARY KEY, organisation_id TEXT NOT NULL REFERENCES organisations(id),
          account_id TEXT NOT NULL REFERENCES accounts(id),
          status TEXT NOT NULL CHECK(status IN ('started','saved','left','failed')),
          then_pay INTEGER NOT NULL CHECK(then_pay IN (0,1)),
          provider_ref TEXT, detail TEXT, created_at INTEGER NOT NULL, finished_at INTEGER
        ) STRICT;
        CREATE TABLE account_mail_next (
          id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id),
          kind TEXT NOT NULL CHECK(kind IN ('reset','confirm','security','billing')), recipient TEXT NOT NULL,
          subject TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('test','accepted','failed','unknown')),
          provider TEXT, provider_ref TEXT, detail TEXT, created_at INTEGER NOT NULL
        ) STRICT;
        INSERT INTO account_mail_next SELECT id,account_id,kind,recipient,subject,status,provider,provider_ref,detail,created_at FROM account_mail;
        DROP TABLE account_mail;
        ALTER TABLE account_mail_next RENAME TO account_mail;
        CREATE INDEX account_mail_recent ON account_mail(account_id,created_at);
      `),
  },
  {
    version: 27,
    // NEXT-02, the owner's decision of 9 October 2026: a read-only studio locks 30 days after the
    // last day paid for (the missed payment, or the end of its trial or plan), until it is paid.
    up: (connection) =>
      connection.exec(`
        ALTER TABLE studio_plans ADD COLUMN lock_at INTEGER;
        ALTER TABLE studio_plans ADD COLUMN locked_at INTEGER;
        -- A studio already read only locks 30 days after the end of its last paid month, or of its
        -- trial when it never paid; the billing loop locks those whose day has already passed.
        UPDATE studio_plans SET lock_at=COALESCE(period_end,trial_ends_at)+${30 * 86_400_000}
          WHERE status='stopped';
      `),
  },
  {
    version: 28,
    // NEXT-06, help inside the app: each request to the SALEANE team, with what happened to the
    // email that carries it. It is kept whether or not it could be sent, and never deleted here.
    up: (connection) =>
      connection.exec(`
        CREATE TABLE support_requests (
          id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id),
          organisation_id TEXT REFERENCES organisations(id), role TEXT,
          topic TEXT NOT NULL CHECK(topic IN ('using','billing','problem','idea','other')),
          message TEXT NOT NULL, page TEXT,
          status TEXT NOT NULL CHECK(status IN ('kept','test','accepted','failed','unknown')),
          provider TEXT, provider_ref TEXT, detail TEXT, created_at INTEGER NOT NULL
        ) STRICT;
        CREATE INDEX support_requests_recent ON support_requests(account_id,created_at);
      `),
  },
  {
    version: 29,
    // NEXT-10, team diaries in Google or Apple: a private link to a read-only calendar of one
    // person's visits, one location's or the whole studio's. Stored only as a hash, with who made
    // it, since it works only while they still may see what it shows. Stopped, never deleted.
    up: (connection) =>
      connection.exec(`
        CREATE TABLE diary_links (
          id TEXT PRIMARY KEY, organisation_id TEXT NOT NULL REFERENCES organisations(id),
          account_id TEXT NOT NULL REFERENCES accounts(id),
          kind TEXT NOT NULL CHECK(kind IN ('person','location','studio')),
          staff_id TEXT, location_id TEXT,
          detail TEXT NOT NULL CHECK(detail IN ('names','treatment')),
          prefix TEXT NOT NULL UNIQUE, token_hash TEXT NOT NULL,
          created_at INTEGER NOT NULL, last_read_at INTEGER, stopped_at INTEGER, stopped_by TEXT,
          CHECK((kind='person')=(staff_id IS NOT NULL)),
          CHECK((kind='location')=(location_id IS NOT NULL))
        ) STRICT;
        CREATE INDEX diary_links_org ON diary_links(organisation_id);
      `),
  },
  {
    version: 30,
    // Stage 1, memberships paid from a saved card: each try at the card for a month and each
    // refund to it, with one live or successful try per membership and month so a month can never
    // be charged twice; a hold that stops card payments after a restore until the team checks the
    // provider; and the outbox's reminder before each payment and note after the last decline.
    up: (connection) =>
      connection.exec(
        `
        CREATE TABLE membership_charges (
          id TEXT PRIMARY KEY, organisation_id TEXT NOT NULL REFERENCES organisations(id),
          holding_id TEXT NOT NULL, client_id TEXT NOT NULL,
          kind TEXT NOT NULL CHECK(kind IN ('charge','refund')),
          period_start TEXT NOT NULL CHECK(period_start GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
          amount_minor INTEGER NOT NULL CHECK(amount_minor>0),
          currency TEXT NOT NULL CHECK(currency IN ('GBP','USD')),
          card_id TEXT NOT NULL, card_brand TEXT NOT NULL, card_last4 TEXT NOT NULL,
          try_number INTEGER NOT NULL CHECK(try_number>=1),
          status TEXT NOT NULL CHECK(status IN ('started','processing','succeeded','failed','unknown','review')),
          provider TEXT NOT NULL, provider_ref TEXT, detail TEXT, next_try_at INTEGER,
          refund_of TEXT, reason TEXT, ledger_id TEXT, request_key TEXT, actor_id TEXT,
          created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
          CHECK((kind='refund')=(refund_of IS NOT NULL)),
          CHECK(next_try_at IS NULL OR (kind='charge' AND status='failed')),
          UNIQUE(organisation_id,holding_id,kind,period_start,try_number)
        ) STRICT;
        CREATE UNIQUE INDEX membership_charges_once ON membership_charges(organisation_id,holding_id,kind,period_start)
          WHERE status IN ('started','processing','succeeded','unknown','review');
        CREATE INDEX membership_charges_retry ON membership_charges(status,next_try_at);
        CREATE INDEX membership_charges_recent ON membership_charges(organisation_id,created_at);
        CREATE INDEX membership_charges_holding ON membership_charges(organisation_id,holding_id);
        CREATE UNIQUE INDEX membership_charges_key ON membership_charges(organisation_id,actor_id,request_key)
          WHERE request_key IS NOT NULL;
        CREATE TABLE membership_card_holds (
          organisation_id TEXT PRIMARY KEY REFERENCES organisations(id), held_at INTEGER NOT NULL
        ) STRICT;
      ` +
          outboxWithKinds(
            [
              'confirmation',
              'changed',
              'reminder',
              'cancelled',
              'feedback',
              'patch_test',
              'aftercare',
              'due_back',
              'birthday',
              'miss_you',
              'missed_call',
              'message',
              'receptionist',
              'social',
              'plan_reminder',
              'plan_declined',
            ],
            ['email', 'sms', 'instagram', 'facebook', 'whatsapp'],
          ),
      ),
  },
  {
    version: 31,
    // Stage 2, product photos. Each studio's pictures, checked by their first bytes (JPEG, PNG or
    // WebP only) and bounded in size, served only to that studio's team. A product keeps the id; a
    // new photo gets a new id.
    up: (connection) =>
      connection.exec(`
        CREATE TABLE images (
          id TEXT PRIMARY KEY, organisation_id TEXT NOT NULL REFERENCES organisations(id),
          kind TEXT NOT NULL CHECK(kind IN ('product')),
          content_type TEXT NOT NULL CHECK(content_type IN ('image/jpeg','image/png','image/webp')),
          bytes BLOB NOT NULL CHECK(length(bytes) BETWEEN 1 AND 409600),
          width INTEGER NOT NULL CHECK(width BETWEEN 1 AND 2000),
          height INTEGER NOT NULL CHECK(height BETWEEN 1 AND 2000),
          created_at INTEGER NOT NULL, created_by TEXT NOT NULL REFERENCES accounts(id)
        ) STRICT;
        CREATE INDEX images_scope ON images(organisation_id,created_at);
      `),
  },
  {
    version: 32,
    // Stage 2, the till: a receipt the desk chose to email goes through the outbox like any other
    // message; and every time SALEANE asked a receipt printer to print or open its cash drawer,
    // with who, when, why, which sale and what the printer answered. A test printer's job is kept
    // as bytes so it can be shown; nothing else about a client is stored here.
    up: (connection) =>
      connection.exec(
        outboxWithKinds(
          [
            'confirmation',
            'changed',
            'reminder',
            'cancelled',
            'feedback',
            'patch_test',
            'aftercare',
            'due_back',
            'birthday',
            'miss_you',
            'missed_call',
            'message',
            'receptionist',
            'social',
            'plan_reminder',
            'plan_declined',
            'receipt',
          ],
          ['email', 'sms', 'instagram', 'facebook', 'whatsapp'],
        ) +
          `
        CREATE TABLE till_events (
          id TEXT PRIMARY KEY, organisation_id TEXT NOT NULL REFERENCES organisations(id),
          location_id TEXT NOT NULL,
          kind TEXT NOT NULL CHECK(kind IN ('drawer','print')),
          cause TEXT NOT NULL CHECK(cause IN ('cash','refund','no_sale','receipt','test_page')),
          receipt TEXT, receipt_number TEXT, amount_minor INTEGER, reason TEXT,
          printer TEXT NOT NULL CHECK(printer IN ('network','test')), host TEXT, port INTEGER,
          status TEXT NOT NULL CHECK(status IN ('pending','sending','sent','test','failed','skipped')),
          detail TEXT, bytes TEXT, actor_id TEXT, actor_name TEXT NOT NULL,
          created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
        ) STRICT;
        CREATE INDEX till_events_day ON till_events(organisation_id,kind,created_at);
        CREATE INDEX till_events_receipt ON till_events(organisation_id,receipt);
        CREATE INDEX till_events_due ON till_events(status,created_at);
      `,
      ),
  },
]
/**
 * SQLite cannot widen a CHECK constraint in place, so a new kind of guest message rebuilds the
 * outbox with the same columns, keys and indexes, keeping every row.
 */
function outboxWithKinds(kinds: string[], channels = ['email', 'sms']) {
  return `
    CREATE TABLE outbox_next (
      id TEXT PRIMARY KEY, organisation_id TEXT NOT NULL REFERENCES organisations(id),
      dedupe_key TEXT NOT NULL, appointment_id TEXT NOT NULL, client_id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN (${kinds.map((kind) => `'${kind}'`).join(',')})),
      channel TEXT NOT NULL CHECK(channel IN (${channels.map((c) => `'${c}'`).join(',')})), slot TEXT NOT NULL,
      recipient TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending','test','accepted','delivered','failed','unknown','skipped')),
      provider TEXT, provider_ref TEXT, detail TEXT, attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      UNIQUE(organisation_id,dedupe_key)
    ) STRICT;
    INSERT INTO outbox_next SELECT id,organisation_id,dedupe_key,appointment_id,client_id,kind,channel,slot,recipient,subject,body,status,provider,provider_ref,detail,attempts,next_attempt_at,created_at,updated_at FROM outbox;
    DROP TABLE outbox;
    ALTER TABLE outbox_next RENAME TO outbox;
    CREATE INDEX outbox_due ON outbox(status,next_attempt_at);
    CREATE INDEX outbox_visit ON outbox(organisation_id,appointment_id);
    CREATE INDEX outbox_recent ON outbox(organisation_id,created_at);
    CREATE UNIQUE INDEX outbox_provider_ref ON outbox(provider,provider_ref) WHERE provider_ref IS NOT NULL;
  `
}

export const SCHEMA_VERSION = migrations[migrations.length - 1].version

export class LocalDatabase {
  readonly connection: DatabaseSync
  readonly path: string

  constructor(
    path = resolve('.saleane-data', 'saleane.sqlite'),
    private readonly steps: Migration[] = migrations,
  ) {
    this.path = path === ':memory:' ? path : resolve(path)
    if (this.path !== ':memory:') mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 })
    this.connection = new DatabaseSync(this.path, {
      timeout: 5000,
      enableForeignKeyConstraints: true,
    })
    this.connection.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;')
    try {
      if (this.path !== ':memory:') chmodSync(this.path, 0o600)
      this.migrate()
    } catch (error) {
      this.connection.close()
      throw error
    }
  }

  get<T>(sql: string, ...values: SQLInputValue[]): T | undefined {
    return this.connection.prepare(sql).get(...values) as T | undefined
  }
  all<T>(sql: string, ...values: SQLInputValue[]): T[] {
    return this.connection.prepare(sql).all(...values) as T[]
  }
  run(sql: string, ...values: SQLInputValue[]) {
    return this.connection.prepare(sql).run(...values)
  }
  transaction<T>(callback: () => T): T {
    this.connection.exec('BEGIN IMMEDIATE')
    try {
      const result = callback()
      if (result && typeof (result as { then?: unknown }).then === 'function')
        throw new Error('Database transactions must be synchronous.')
      this.connection.exec('COMMIT')
      return result
    } catch (error) {
      this.connection.exec('ROLLBACK')
      throw error
    }
  }
  close() {
    if (this.connection.isOpen) this.connection.close()
  }

  private migrate() {
    this.connection.exec(
      'CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL) STRICT;',
    )
    const applied = this.connection
      .prepare('SELECT version FROM schema_migrations ORDER BY version')
      .all()
      .map((row) => Number(row.version))
    const known = this.steps.map((migration) => migration.version)
    if (applied.some((version, index) => version !== known[index]))
      throw new Error(
        'This database was created by a different SALEANE version. Restore a supported backup.',
      )
    // Each pending migration commits with its version record, so a failure leaves the last good version.
    for (const migration of this.steps.slice(applied.length))
      this.transaction(() => {
        migration.up(this.connection)
        this.run(
          'INSERT INTO schema_migrations(version,applied_at) VALUES(?,?)',
          migration.version,
          Date.now(),
        )
      })
  }
}
