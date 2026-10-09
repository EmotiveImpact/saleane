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
const next = SCHEMA_VERSION + 1
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
    // Steps rise in order and the newest names the schema version.
    expect(known.every((version, index) => index === 0 || version > known[index - 1])).toBe(true)
    expect(SCHEMA_VERSION).toBe(known[known.length - 1])
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
  it('keeps every membership and invitation when regional managers are added (V5)', () => {
    const path = file()
    const before = new LocalDatabase(
      path,
      migrations.filter((migration) => migration.version <= 19),
    )
    before.run(
      'INSERT INTO organisations(id,slug,state,revision,created_at) VALUES(?,?,?,?,?)',
      'org-1',
      'linden',
      JSON.stringify({ organisation: { id: 'org-1' }, revision: 0 }),
      0,
      1,
    )
    for (const [id, role, staff] of [
      ['a1', 'owner', null],
      ['a2', 'practitioner', 'staff-maya'],
    ] as const) {
      before.run(
        'INSERT INTO accounts(id,email,name,password_hash,created_at) VALUES(?,?,?,?,?)',
        id,
        `${id}@example.invalid`,
        'Fictional',
        'hash',
        1,
      )
      before.run(
        'INSERT INTO memberships(organisation_id,account_id,role,staff_id) VALUES(?,?,?,?)',
        'org-1',
        id,
        role,
        staff,
      )
    }
    before.run(
      "INSERT INTO invitations(token_hash,organisation_id,email,role,staff_id,created_at,expires_at) VALUES('t1','org-1','m@example.invalid','manager',NULL,1,2)",
    )
    expect(() =>
      before.run(
        "INSERT INTO memberships(organisation_id,account_id,role) VALUES('org-1','a3','regional')",
      ),
    ).toThrow()
    before.close()
    const after = new LocalDatabase(path)
    expect(
      after.all('SELECT account_id,role,staff_id,area_id FROM memberships ORDER BY account_id'),
    ).toEqual([
      { account_id: 'a1', role: 'owner', staff_id: null, area_id: null },
      { account_id: 'a2', role: 'practitioner', staff_id: 'staff-maya', area_id: null },
    ])
    expect(after.all('SELECT token_hash,role,area_id FROM invitations')).toEqual([
      { token_hash: 't1', role: 'manager', area_id: null },
    ])
    after.run(
      'INSERT INTO accounts(id,email,name,password_hash,created_at) VALUES(?,?,?,?,?)',
      'a3',
      'a3@example.invalid',
      'Fictional',
      'hash',
      1,
    )
    // A regional manager always names a region, and only a regional manager does.
    expect(() =>
      after.run(
        "INSERT INTO memberships(organisation_id,account_id,role) VALUES('org-1','a3','regional')",
      ),
    ).toThrow()
    expect(() =>
      after.run(
        "INSERT INTO memberships(organisation_id,account_id,role,area_id) VALUES('org-1','a3','manager','r1')",
      ),
    ).toThrow()
    after.run(
      "INSERT INTO memberships(organisation_id,account_id,role,area_id) VALUES('org-1','a3','regional','r1')",
    )
    after.close()
  })
  it('keeps every membership and invitation when general managers are added (V5)', () => {
    const path = file()
    const before = new LocalDatabase(
      path,
      migrations.filter((migration) => migration.version <= 20),
    )
    before.run(
      'INSERT INTO organisations(id,slug,state,revision,created_at) VALUES(?,?,?,?,?)',
      'org-1',
      'linden',
      JSON.stringify({ organisation: { id: 'org-1' }, revision: 0 }),
      0,
      1,
    )
    for (const id of ['a1', 'a2', 'a3'])
      before.run(
        'INSERT INTO accounts(id,email,name,password_hash,created_at) VALUES(?,?,?,?,?)',
        id,
        `${id}@example.invalid`,
        'Fictional',
        'hash',
        1,
      )
    before.run(
      "INSERT INTO memberships(organisation_id,account_id,role,staff_id,area_id) VALUES('org-1','a1','owner',NULL,NULL),('org-1','a2','regional',NULL,'r1')",
    )
    before.run(
      "INSERT INTO invitations(token_hash,organisation_id,email,role,staff_id,created_at,expires_at,area_id) VALUES('t1','org-1','r@example.invalid','regional',NULL,1,2,'r1')",
    )
    expect(() =>
      before.run(
        "INSERT INTO memberships(organisation_id,account_id,role) VALUES('org-1','a3','general')",
      ),
    ).toThrow()
    before.close()
    const after = new LocalDatabase(path)
    expect(
      after.all('SELECT account_id,role,area_id,location_id FROM memberships ORDER BY account_id'),
    ).toEqual([
      { account_id: 'a1', role: 'owner', area_id: null, location_id: null },
      { account_id: 'a2', role: 'regional', area_id: 'r1', location_id: null },
    ])
    expect(after.all('SELECT token_hash,role,area_id,location_id FROM invitations')).toEqual([
      { token_hash: 't1', role: 'regional', area_id: 'r1', location_id: null },
    ])
    // A general manager always names a location, and only a general manager does.
    expect(() =>
      after.run(
        "INSERT INTO memberships(organisation_id,account_id,role) VALUES('org-1','a3','general')",
      ),
    ).toThrow()
    expect(() =>
      after.run(
        "INSERT INTO memberships(organisation_id,account_id,role,location_id) VALUES('org-1','a3','manager','l1')",
      ),
    ).toThrow()
    after.run(
      "INSERT INTO memberships(organisation_id,account_id,role,location_id) VALUES('org-1','a3','general','l1')",
    )
    after.close()
  })
  it('gives studios already read only a lock day when the lock arrives (NEXT-02)', () => {
    const path = file()
    const before = new LocalDatabase(
      path,
      migrations.filter((migration) => migration.version <= 26),
    )
    const day = 86_400_000
    for (const id of ['paid', 'trial', 'open'])
      before.run(
        'INSERT INTO organisations(id,slug,state,revision,created_at) VALUES(?,?,?,?,?)',
        id,
        id,
        JSON.stringify({ organisation: { id }, revision: 0 }),
        0,
        1,
      )
    const plan = (id: string, status: string, reason: string | null, periodEnd: number | null) =>
      before.run(
        'INSERT INTO studio_plans(organisation_id,status,stop_reason,trial_ends_at,period_end,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',
        id,
        status,
        reason,
        10 * day,
        periodEnd,
        0,
        0,
      )
    plan('paid', 'stopped', 'unpaid', 40 * day)
    plan('trial', 'stopped', 'trial_ended', null)
    plan('open', 'trial', null, null)
    before.close()
    const after = new LocalDatabase(path)
    expect(
      after.all(
        'SELECT organisation_id AS id,lock_at,locked_at FROM studio_plans ORDER BY organisation_id',
      ),
    ).toEqual([
      { id: 'open', lock_at: null, locked_at: null },
      { id: 'paid', lock_at: 70 * day, locked_at: null },
      { id: 'trial', lock_at: 40 * day, locked_at: null },
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
