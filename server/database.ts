import { DatabaseSync } from 'node:sqlite'
import type { SQLInputValue } from 'node:sqlite'
import { chmodSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

/** One forward schema step. Versions are contiguous from 1; never edit a released step. */
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
]
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
