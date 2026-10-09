// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LocalDatabase, migrations } from './database'
import { createApiHandler } from './app'
import type { ApiHandler } from './app'
import { backupDatabase, restoreDatabase, validateDatabase } from './backup'
import { metaSignature } from './messaging/meta'

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
  it('turns off what reaches outside the studio, so a restore cannot bring it back by itself', async () => {
    const password = 'Fictional backup password!'
    const registration = await api.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        name: 'Recovery Owner',
        email: 'recovery@example.invalid',
        password,
        workspace: { name: 'Recovery Studio', locationName: 'London', region: 'UK' },
      },
    })
    expect(registration.statusCode, registration.body).toBe(201)
    const { orgId, csrf } = registration.json<{ csrf: string; orgId: string }>()
    const headers = { cookie: String(registration.headers['set-cookie']).split(';')[0] }
    const write = (path: string, payload: unknown) =>
      api.inject({
        method: 'POST',
        url: `/api/workspaces/${orgId}${path}`,
        headers: { ...headers, 'x-csrf-token': csrf },
        payload,
      })
    // An access key, a connection with an event waiting for it, an Instagram account and a
    // message waiting in the outbox.
    const made = await write('/api-keys', { name: 'Accounts', scopes: ['services:read'] })
    expect(made.statusCode, made.body).toBe(201)
    const key = made.json<{ key: string }>().key
    const reads = (handler: ApiHandler) =>
      handler.inject({ url: '/api/v1/studio', headers: { authorization: `Bearer ${key}` } })
    expect((await reads(api)).statusCode).toBe(200)
    const hook = await write('/connections', {
      name: 'Bookkeeping',
      url: 'https://hooks.example.com/saleane',
      events: ['client.created'],
      shareContact: false,
    })
    expect(hook.statusCode, hook.body).toBe(201)
    const client = await api.inject({
      method: 'POST',
      url: `/api/workspaces/${orgId}/commands`,
      headers: { ...headers, 'x-csrf-token': csrf, 'idempotency-key': 'restore-client-added' },
      payload: {
        revision: 0,
        command: {
          type: 'client',
          contact: {
            name: 'Rosa Field',
            email: 'rosa@example.invalid',
            phone: '+44 7700 900456',
            marketingConsent: false,
          },
        },
      },
    })
    expect(client.statusCode, client.body).toBe(200)
    expect(
      api.database.all("SELECT * FROM connection_deliveries WHERE status='pending'"),
    ).toHaveLength(1)
    expect(
      (await write('/social', { channel: 'instagram', accountId: '17841400000000001' })).statusCode,
    ).toBe(200)
    // Confirmed, as the owner signing in with Meta would.
    api.database.run(
      "UPDATE social_accounts SET account_id='17841400000000001' WHERE organisation_id=?",
      orgId,
    )
    api.database.run(
      `INSERT INTO outbox(id,organisation_id,dedupe_key,appointment_id,client_id,kind,channel,slot,recipient,subject,body,status,next_attempt_at,created_at,updated_at)
       VALUES('outbox-waiting',?,'waiting','','client-x','missed_call','sms','call:1','+447700900456','','Sorry we missed you','pending',0,0,0)`,
      orgId,
    )
    // NEXT-04: an unused recovery code, which may be used after the backup is taken.
    api.database.run(
      "INSERT INTO recovery_codes(account_id,code_hash,created_at) SELECT id,'code-hash',0 FROM accounts",
    )
    const backup = join(directory, 'before.sqlite'),
      restored = join(directory, 'after.sqlite')
    backupDatabase(api.database.path, backup)
    expect(restoreDatabase(backup, restored)).toMatchObject({
      sessionsRevoked: true,
      // The confirmation link sent when the account was made.
      accountLinksRetired: 1,
      recoveryCodesRetired: 1,
      accessKeysRevoked: 1,
      connectionsTurnedOff: 1,
      socialAccountsToConfirm: 1,
      messagesHeld: 1,
    })

    const meta = {
      mode: 'test' as const,
      appSecret: 'a-long-meta-app-secret-2026',
      verifyToken: 'a-long-verify-token-2026',
    }
    const recovered = createApiHandler({
      origin: 'http://127.0.0.1:5173',
      databasePath: restored,
      social: meta,
    })
    try {
      // The access key no longer reads anything.
      expect((await reads(recovered)).statusCode).toBe(401)
      expect(recovered.database.all('SELECT * FROM api_keys WHERE revoked_at IS NULL')).toEqual([])
      expect(recovered.database.all('SELECT * FROM account_links WHERE used_at IS NULL')).toEqual(
        [],
      )
      expect(recovered.database.all('SELECT * FROM recovery_codes WHERE used_at IS NULL')).toEqual(
        [],
      )
      // The connection is off until the owner turns it on, and what waited for it is not sent.
      expect(recovered.database.all('SELECT * FROM connections WHERE active=1')).toEqual([])
      expect(
        recovered.database.all("SELECT * FROM connection_deliveries WHERE status='pending'"),
      ).toEqual([])
      // Messages to the Instagram account wait until the owner confirms it again.
      const body = JSON.stringify({
        object: 'instagram',
        entry: [
          {
            id: '17841400000000001',
            messaging: [
              {
                sender: { id: '9000001' },
                recipient: { id: '17841400000000001' },
                message: { mid: 'm-after-restore', text: 'Hello' },
              },
            ],
          },
        ],
      })
      const message = await recovered.inject({
        method: 'POST',
        url: '/api/hooks/meta',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': metaSignature(meta.appSecret, body),
        },
        rawPayload: body,
      })
      expect(message.statusCode).toBe(200)
      const state = recovered.database.get<{ state: string }>('SELECT state FROM organisations')!
      expect(state.state).not.toContain('m-after-restore')
      // The waiting message is held for the team to check and send again, not sent by itself.
      await recovered.outbox.tick()
      const held = recovered.database.get<{ status: string; detail: string }>(
        "SELECT status,detail FROM outbox WHERE id='outbox-waiting'",
      )!
      expect(held.status).toBe('unknown')
      expect(held.detail).toMatch(/restored from a backup/)
      // Signing in again, the owner sees the connection off and can turn it back on.
      const login = await recovered.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: 'recovery@example.invalid', password },
      })
      expect(login.statusCode, login.body).toBe(200)
      const session = {
        cookie: String(login.headers['set-cookie']).split(';')[0],
        'x-csrf-token': login.json<{ csrf: string }>().csrf,
      }
      const listed = await recovered.inject({
        url: `/api/workspaces/${orgId}/connections`,
        headers: session,
      })
      expect(listed.json<{ connections: { active: boolean }[] }>().connections).toMatchObject([
        { active: false },
      ])
    } finally {
      recovered.close()
    }
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
