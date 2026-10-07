// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LocalDatabase, SCHEMA_VERSION, migrations } from './database'
import type { Migration } from './database'

let directory: string | undefined
afterEach(() => {
  if (directory) rmSync(directory, { recursive: true, force: true })
  directory = undefined
})
function file() {
  directory = mkdtempSync(join(tmpdir(), 'saleane-migrations-'))
  return join(directory, 'saleane.sqlite')
}
const versions = (db: LocalDatabase) =>
  db
    .all<{ version: number }>('SELECT version FROM schema_migrations ORDER BY version')
    .map((row) => row.version)
const next = migrations.length + 1
const known = migrations.map((migration) => migration.version)
const addNotes: Migration = {
  version: next,
  up: (connection) =>
    connection.exec('CREATE TABLE fixture_notes (id TEXT PRIMARY KEY, text TEXT NOT NULL) STRICT;'),
}

describe('numbered schema migrations', () => {
  it('records every known step on a fresh database', () => {
    const db = new LocalDatabase(':memory:')
    expect(versions(db)).toEqual(migrations.map((migration) => migration.version))
    expect(SCHEMA_VERSION).toBe(migrations.length)
    db.close()
  })
  it('applies only pending steps when an existing file opens, keeping its records', () => {
    const path = file()
    const first = new LocalDatabase(path)
    first.run(
      'INSERT INTO accounts(id,email,name,password_hash,created_at) VALUES(?,?,?,?,?)',
      'account-1',
      'owner@example.invalid',
      'Fictional Owner',
      'hash',
      1,
    )
    first.close()
    const upgraded = new LocalDatabase(path, [...migrations, addNotes])
    expect(versions(upgraded)).toEqual([...known, next])
    upgraded.run("INSERT INTO fixture_notes(id,text) VALUES('n1','kept')")
    expect(upgraded.all('SELECT id FROM accounts')).toEqual([{ id: 'account-1' }])
    upgraded.close()
    const reopened = new LocalDatabase(path, [...migrations, addNotes])
    expect(versions(reopened)).toEqual([...known, next])
    expect(reopened.all('SELECT text FROM fixture_notes')).toEqual([{ text: 'kept' }])
    reopened.close()
  })
  it('widens the outbox for aftercare, due back, birthdays, we miss you and missed calls', () => {
    const path = file()
    const before = new LocalDatabase(
      path,
      migrations.filter((migration) => migration.version <= 10),
    )
    before.run(
      'INSERT INTO organisations(id,slug,state,revision,created_at) VALUES(?,?,?,?,?)',
      'org-1',
      'linden',
      JSON.stringify({ organisation: { id: 'org-1' }, revision: 0 }),
      0,
      1,
    )
    const row = (id: string, kind: string) =>
      [
        id,
        'org-1',
        `key-${id}`,
        'visit-1',
        'client-1',
        kind,
        'email',
        'slot',
        'a@example.invalid',
        'S',
        'B',
        'test',
        1,
        1,
        1,
      ] as const
    const insert =
      'INSERT INTO outbox(id,organisation_id,dedupe_key,appointment_id,client_id,kind,channel,slot,recipient,subject,body,status,next_attempt_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
    before.run(insert, ...row('m1', 'patch_test'))
    expect(() => before.run(insert, ...row('m2', 'due_back'))).toThrow()
    before.close()
    const after = new LocalDatabase(path)
    after.run(insert, ...row('m2', 'due_back'))
    after.run(insert, ...row('m3', 'aftercare'))
    after.run(insert, ...row('m4', 'birthday'))
    after.run(insert, ...row('m5', 'miss_you'))
    after.run(insert, ...row('m6', 'missed_call'))
    expect(after.all('SELECT id,kind FROM outbox ORDER BY id')).toEqual([
      { id: 'm1', kind: 'patch_test' },
      { id: 'm2', kind: 'due_back' },
      { id: 'm3', kind: 'aftercare' },
      { id: 'm4', kind: 'birthday' },
      { id: 'm5', kind: 'miss_you' },
      { id: 'm6', kind: 'missed_call' },
    ])
    after.close()
  })
  it('rolls a failed step back and leaves the last good version', () => {
    const path = file()
    new LocalDatabase(path).close()
    const broken: Migration = {
      version: next,
      up: (connection) => {
        connection.exec('CREATE TABLE half_done (id TEXT) STRICT;')
        throw new Error('Simulated migration failure.')
      },
    }
    expect(() => new LocalDatabase(path, [...migrations, broken])).toThrow('Simulated')
    const db = new LocalDatabase(path)
    expect(versions(db)).toEqual(known)
    expect(db.all("SELECT name FROM sqlite_master WHERE name='half_done'")).toEqual([])
    db.close()
  })
  it('refuses a database written by a newer or different schema', () => {
    const path = file()
    new LocalDatabase(path, [...migrations, addNotes]).close()
    expect(() => new LocalDatabase(path)).toThrow('different SALEANE version')
  })
})
