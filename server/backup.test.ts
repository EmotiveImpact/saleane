// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LocalDatabase, migrations } from './database'
import { createApiHandler } from './app'
import type { ApiHandler } from './app'
import { backupDatabase, restoreDatabase, validateDatabase } from './backup'

let directory: string
let api: ApiHandler
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'saleane-backup-test-'))
  api = createApiHandler({
    origin: 'http://127.0.0.1:5173',
    databasePath: join(directory, 'source.sqlite'),
  })
})
afterEach(() => {
  api.close()
  rmSync(directory, { recursive: true, force: true })
})

describe('consistent local backups and fresh-path recovery', () => {
  it('backs up the live WAL-backed database, restores to a new path and revokes stale tokens', async () => {
    const registration = await api.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        name: 'Recovery Owner',
        email: 'recovery@example.invalid',
        password: 'Fictional backup password!',
        workspace: { name: 'Recovery Studio', locationName: 'London', region: 'UK', sample: true },
      },
    })
    expect(registration.statusCode, registration.body).toBe(201)
    const session = registration.json<{ csrf: string; orgId: string }>()
    const cookie = String(registration.headers['set-cookie']).split(';')[0]
    const headers = { cookie, 'x-csrf-token': session.csrf }
    const change = await api.inject({
      method: 'POST',
      url: `/api/workspaces/${session.orgId}/commands`,
      headers: { ...headers, 'idempotency-key': 'durable-recovery-note' },
      payload: {
        revision: 0,
        command: { type: 'note', clientId: 'client-1', text: 'Stored before backup' },
      },
    })
    expect(change.statusCode, change.body).toBe(200)
    const invitation = await api.inject({
      method: 'POST',
      url: `/api/workspaces/${session.orgId}/invitations`,
      headers,
      payload: { email: 'pending@example.invalid', role: 'reception' },
    })
    expect(invitation.statusCode).toBe(201)
    const backup = join(directory, 'consistent.sqlite'),
      restored = join(directory, 'restored.sqlite')
    expect(backupDatabase(api.database.path, backup)).toMatchObject({
      workspaces: 1,
      sessionsRevoked: false,
    })
    expect(validateDatabase(backup)).toEqual({
      migrations: migrations.map((migration) => migration.version),
      workspaces: 1,
    })
    expect(restoreDatabase(backup, restored)).toMatchObject({
      workspaces: 1,
      sessionsRevoked: true,
    })
    const recovered = new LocalDatabase(restored)
    try {
      expect(recovered.all('SELECT * FROM sessions')).toEqual([])
      expect(recovered.all('SELECT * FROM invitations')).toEqual([])
      expect(recovered.all('SELECT * FROM booking_holds')).toEqual([])
      expect(recovered.all('SELECT * FROM command_receipts')).toHaveLength(1)
      expect(
        recovered.all("SELECT * FROM audit_events WHERE action='workspace.restored'"),
      ).toHaveLength(1)
      const state = recovered.get<{ state: string }>('SELECT state FROM organisations')!.state
      expect(state).toContain('Stored before backup')
      expect(recovered.all('SELECT * FROM memberships')).toHaveLength(1)
    } finally {
      recovered.close()
    }
    expect((await api.inject({ url: '/api/session', headers })).statusCode).toBe(200)
  })
  it('refuses every existing destination, including an empty file and the source database', () => {
    const destination = join(directory, 'existing.sqlite')
    writeFileSync(destination, '')
    expect(() => backupDatabase(api.database.path, destination)).toThrow('fresh path')
    expect(() => restoreDatabase(api.database.path, destination)).toThrow('fresh path')
    expect(() => backupDatabase(api.database.path, api.database.path)).toThrow('fresh path')
    expect(readFileSync(destination)).toHaveLength(0)
    const fresh = join(directory, 'companion.sqlite')
    writeFileSync(`${fresh}-wal`, 'existing recovery bytes')
    expect(() => restoreDatabase(api.database.path, fresh)).toThrow('fresh path')
    expect(existsSync(fresh)).toBe(false)
  })
  it('rejects unsupported migration versions and corrupt sources without publishing a destination', () => {
    const unsupported = join(directory, 'future.sqlite')
    backupDatabase(api.database.path, unsupported)
    const future = new LocalDatabase(unsupported)
    future.run('INSERT INTO schema_migrations(version,applied_at) VALUES(99,?)', Date.now())
    future.close()
    expect(() => restoreDatabase(unsupported, join(directory, 'refused.sqlite'))).toThrow(
      'migration version',
    )
    expect(existsSync(join(directory, 'refused.sqlite'))).toBe(false)
    const corrupt = join(directory, 'corrupt.sqlite')
    writeFileSync(corrupt, 'unreadable database')
    expect(() => restoreDatabase(corrupt, join(directory, 'also-refused.sqlite'))).toThrow()
    expect(existsSync(join(directory, 'also-refused.sqlite'))).toBe(false)
  })
})
