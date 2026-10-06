import { DatabaseSync } from 'node:sqlite'
import type { SQLInputValue } from 'node:sqlite'
import { chmodSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

export class LocalDatabase {
  readonly connection: DatabaseSync
  readonly path: string

  constructor(path = resolve('.saleane-data', 'saleane.sqlite')) {
    this.path = path === ':memory:' ? path : resolve(path)
    if (this.path !== ':memory:') mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 })
    this.connection = new DatabaseSync(this.path, {
      timeout: 5000,
      enableForeignKeyConstraints: true,
    })
    this.connection.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;')
    if (this.path !== ':memory:') chmodSync(this.path, 0o600)
    this.migrate()
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
    this.transaction(() => {
      this.connection.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL) STRICT;
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
      `)
      this.run(
        'INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(1,?)',
        Date.now(),
      )
    })
  }
}
