import { randomUUID } from 'node:crypto'
import {
  chmodSync,
  closeSync,
  existsSync,
  linkSync,
  mkdirSync,
  openSync,
  unlinkSync,
} from 'node:fs'
import { dirname, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { SCHEMA_VERSION } from './database'
import { UNCONFIRMED } from './messaging/meta'
import { parseState } from '../src/domain/model'
import type { BusinessState } from '../src/domain/model'

/** Validates a local candidate DB without applying migrations or modifying its bytes. */
export function validateDatabase(path: string) {
  const database = new DatabaseSync(resolve(path), { readOnly: true })
  try {
    const integrity = database.prepare('PRAGMA integrity_check').all()
    if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok')
      throw new Error('Database integrity check failed.')
    if (database.prepare('PRAGMA foreign_key_check').all().length)
      throw new Error('Database contains broken tenant links.')
    const versions = database
      .prepare('SELECT version FROM schema_migrations ORDER BY version')
      .all()
    // Exactly the contiguous steps this build knows: older files open through the app first.
    if (
      versions.length !== SCHEMA_VERSION ||
      versions.some((row, index) => Number(row.version) !== index + 1)
    )
      throw new Error('This database migration version is not supported.')
    const tables = database
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((row) => String(row.name))
    for (const table of [
      'accounts',
      'organisations',
      'memberships',
      'sessions',
      'invitations',
      'command_receipts',
      'booking_holds',
      'audit_events',
      'guest_links',
    ])
      if (!tables.includes(table))
        throw new Error('This database does not contain the required authority tables.')
    for (const row of database.prepare('SELECT id,state,revision FROM organisations').all()) {
      const raw = JSON.parse(String(row.state)) as BusinessState
      const state = parseState(raw, raw.organisation.region)
      if (row.id !== state.organisation.id || row.revision !== state.revision)
        throw new Error('Database snapshot and revision do not agree.')
    }
    return {
      migrations: versions.map((row) => Number(row.version)),
      workspaces: Number(
        database.prepare('SELECT count(*) AS total FROM organisations').get()!.total,
      ),
    }
  } finally {
    database.close()
  }
}

function snapshot(source: string, destination: string, restore: boolean) {
  const input = resolve(source),
    output = resolve(destination)
  if (
    input === output ||
    existsSync(output) ||
    existsSync(`${output}-wal`) ||
    existsSync(`${output}-shm`)
  )
    throw new Error('Destination must be a fresh path. Existing databases are never overwritten.')
  validateDatabase(input)
  mkdirSync(dirname(output), { recursive: true, mode: 0o700 })
  const partial = `${output}.partial-${randomUUID()}`
  let held = {}
  closeSync(openSync(partial, 'wx', 0o600))
  try {
    const database = new DatabaseSync(input, { readOnly: true, timeout: 5000 })
    try {
      database.exec('PRAGMA synchronous=FULL')
      database.prepare('VACUUM INTO ?').run(partial)
    } finally {
      database.close()
    }
    if (restore) {
      const recovered = new DatabaseSync(partial, {
        timeout: 5000,
        enableForeignKeyConstraints: true,
      })
      try {
        recovered.exec(
          'BEGIN IMMEDIATE; DELETE FROM sessions; DELETE FROM login_challenges; DELETE FROM totp_setup; DELETE FROM invitations; DELETE FROM booking_holds; DELETE FROM guest_links;',
        )
        // Nothing that reaches outside the studio comes back by itself: a key revoked since the
        // backup would read again, a connection removed since would be sent to, and a message
        // sent since would go twice. The owner turns each back on, and the team sends again.
        const time = Date.now()
        held = {
          // An emailed password or confirmation link from before the restore stops working;
          // the person asks for a new one.
          accountLinksRetired: Number(
            recovered.prepare('UPDATE account_links SET used_at=? WHERE used_at IS NULL').run(time)
              .changes,
          ),
          // Recovery codes used since the backup would work again, so none of the restored ones
          // do; signing in warns that none are left until new ones are made.
          recoveryCodesRetired: Number(
            recovered.prepare('UPDATE recovery_codes SET used_at=? WHERE used_at IS NULL').run(time)
              .changes,
          ),
          accessKeysRevoked: Number(
            recovered.prepare('UPDATE api_keys SET revoked_at=? WHERE revoked_at IS NULL').run(time)
              .changes,
          ),
          connectionsTurnedOff: Number(
            recovered
              .prepare('UPDATE connections SET active=0,updated_at=? WHERE active=1')
              .run(time).changes,
          ),
          socialAccountsToConfirm: Number(
            recovered
              .prepare(
                "UPDATE social_accounts SET account_id=?||organisation_id||':'||account_id WHERE substr(account_id,1,?)<>?",
              )
              .run(UNCONFIRMED, UNCONFIRMED.length, UNCONFIRMED).changes,
          ),
          messagesHeld: Number(
            recovered
              .prepare(
                "UPDATE outbox SET status='unknown',detail=?,updated_at=? WHERE status='pending'",
              )
              .run(
                'Held when the studio was restored from a backup. It may have gone already, so check before sending again.',
                time,
              ).changes,
          ),
        }
        // NEXT-02: a studio's bill may have been paid, or a month renewed, since the backup. Nothing
        // is charged by itself until someone has checked each studio's payments with the card
        // service; studios keep working meanwhile, and the owner can still pay by hand.
        Object.assign(held, {
          billsToCheck: Number(
            recovered
              .prepare(
                "UPDATE studio_invoices SET status='unknown',detail=? WHERE status IN ('open','charging')",
              )
              .run('Restored from a backup: check with the card service before charging again.')
              .changes,
          ),
          plansHeld: Number(
            recovered.prepare('UPDATE studio_plans SET held_at=? WHERE held_at IS NULL').run(time)
              .changes,
          ),
        })
        recovered
          .prepare(
            "UPDATE connection_deliveries SET status='skipped',detail=?,updated_at=? WHERE status='pending'",
          )
          .run('Not sent: the studio was restored from a backup.', time)
        for (const row of recovered.prepare('SELECT id,revision FROM organisations').all())
          recovered
            .prepare(
              'INSERT INTO audit_events(id,organisation_id,actor_id,action,record_id,revision,occurred_at) VALUES(?,?,NULL,?,?,?,?)',
            )
            .run(randomUUID(), row.id, 'workspace.restored', row.id, row.revision, Date.now())
        recovered.exec('COMMIT')
      } catch (error) {
        recovered.exec('ROLLBACK')
        throw error
      } finally {
        recovered.close()
      }
    }
    const evidence = validateDatabase(partial)
    chmodSync(partial, 0o600)
    // Atomic hard-link publication fails if a competing process creates the destination.
    linkSync(partial, output)
    return { path: output, ...evidence, sessionsRevoked: restore, ...held }
  } finally {
    if (existsSync(partial)) unlinkSync(partial)
    for (const suffix of ['-wal', '-shm'])
      if (existsSync(partial + suffix)) unlinkSync(partial + suffix)
  }
}

export const backupDatabase = (source: string, destination: string) =>
  snapshot(source, destination, false)
export const restoreDatabase = (source: string, destination: string) =>
  snapshot(source, destination, true)

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [action, source, destination, ...extra] = process.argv.slice(2)
  if (
    !['backup', 'restore', 'verify'].includes(action) ||
    !source ||
    extra.length ||
    (action !== 'verify' && !destination) ||
    (action === 'verify' && destination)
  ) {
    console.error(
      'Usage: backup-tool.mjs backup|restore SOURCE FRESH_DESTINATION, or backup-tool.mjs verify SOURCE',
    )
    process.exitCode = 1
  } else {
    try {
      console.info(
        JSON.stringify(
          action === 'verify'
            ? validateDatabase(source)
            : action === 'backup'
              ? backupDatabase(source, destination)
              : restoreDatabase(source, destination),
        ),
      )
    } catch (error) {
      console.error(error instanceof Error ? error.message : 'The database operation failed.')
      process.exitCode = 1
    }
  }
}
