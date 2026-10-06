// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLocalServer } from './index'

let directory: string
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'saleane-static-privacy-test-'))
})
afterEach(() => {
  rmSync(directory, { recursive: true, force: true })
})
const origin = 'http://127.0.0.1:5173'

describe('standalone host never publishes local authority files', () => {
  it('rejects a prospective database inside a prospective custom static root before writing it', () => {
    const staticRoot = join(directory, 'custom-build')
    const databasePath = join(staticRoot, 'private', 'authority.dat')
    expect(() => createLocalServer({ origin, staticRoot, databasePath })).toThrow(
      'outside STATIC_ROOT',
    )
    expect(existsSync(staticRoot)).toBe(false)
    expect(existsSync(databasePath)).toBe(false)
  })
  it('rejects an outside database parent symlink pointing into the static root', () => {
    const staticRoot = join(directory, 'site')
    mkdirSync(staticRoot)
    const alias = join(directory, 'database-alias')
    symlinkSync(staticRoot, alias, 'dir')
    const databasePath = join(alias, 'nested', 'authority.sqlite')
    expect(() => createLocalServer({ origin, staticRoot, databasePath })).toThrow(
      'outside STATIC_ROOT',
    )
    expect(existsSync(join(staticRoot, 'nested'))).toBe(false)
  })
  it('rejects a database reached through a canonical static-root symlink', () => {
    const canonical = join(directory, 'actual-site')
    mkdirSync(canonical)
    const staticRoot = join(directory, 'site-alias')
    symlinkSync(canonical, staticRoot, 'dir')
    expect(() =>
      createLocalServer({ origin, staticRoot, databasePath: join(canonical, 'state.sqlite') }),
    ).toThrow('outside STATIC_ROOT')
    expect(existsSync(join(canonical, 'state.sqlite'))).toBe(false)
  })
  it('rejects a dangling database-file symlink whose future target is in the static root', () => {
    const staticRoot = join(directory, 'site')
    mkdirSync(staticRoot)
    const target = join(staticRoot, 'not-created.sqlite')
    const databasePath = join(directory, 'database-alias.sqlite')
    symlinkSync(target, databasePath)
    expect(() => createLocalServer({ origin, staticRoot, databasePath })).toThrow(
      'outside STATIC_ROOT',
    )
    expect(existsSync(target)).toBe(false)
  })
  it('rejects a filesystem-wide static root', () => {
    expect(() =>
      createLocalServer({
        origin,
        staticRoot: '/',
        databasePath: join(directory, 'private.sqlite'),
      }),
    ).toThrow('outside STATIC_ROOT')
    expect(existsSync(join(directory, 'private.sqlite'))).toBe(false)
  })
  it.each(['-wal', '-shm'])(
    'rejects a separately symlinked %s companion inside the static root',
    (suffix) => {
      const staticRoot = join(directory, 'site')
      mkdirSync(staticRoot)
      const exposed = join(staticRoot, `private${suffix}`)
      writeFileSync(exposed, 'private existing companion')
      const databasePath = join(directory, 'authority.sqlite')
      symlinkSync(exposed, databasePath + suffix)
      expect(() => createLocalServer({ origin, staticRoot, databasePath })).toThrow(
        'outside STATIC_ROOT',
      )
      expect(existsSync(databasePath)).toBe(false)
    },
  )
  it('accepts a private sibling database even if neither its parent nor the build exists', () => {
    const databasePath = join(directory, 'private', 'authority.sqlite')
    const { server, api } = createLocalServer({
      origin,
      staticRoot: join(directory, 'build'),
      databasePath,
    })
    try {
      expect(server.listening).toBe(false)
      expect(existsSync(databasePath)).toBe(true)
      expect(api.database.all('SELECT * FROM organisations')).toEqual([])
    } finally {
      api.close()
    }
  })
})
