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
    if (versions.length !== 1 || versions[0].version !== 1)
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
      migrations: [1],
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
          'BEGIN IMMEDIATE; DELETE FROM sessions; DELETE FROM invitations; DELETE FROM booking_holds;',
        )
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
    return { path: output, ...evidence, sessionsRevoked: restore }
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
