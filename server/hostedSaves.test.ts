// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { createHostedApp, memoryStore } from './hosted'
import type { HostedApp, SnapshotStore } from './hosted'

/**
 * Saves that overlap timed work: each save counts as kept only what was in the copy it sent, saves
 * go one at a time, and an outside call waits until its own mark is in a kept copy. Fictional data
 * only; nothing here reaches a real service.
 */
const folders: string[] = []
const apps: HostedApp[] = []
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close()
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
})

/** A store whose writes can be held at the door until the test lets each one through. */
function gatedStore() {
  const inner = memoryStore()
  const waiting: (() => void)[] = []
  let gated = false
  const store: SnapshotStore = {
    generation: inner.generation,
    read: inner.read,
    write: async (previous, data) => {
      if (gated) await new Promise<void>((go) => waiting.push(go))
      return inner.write(previous, data)
    },
  }
  return {
    store,
    inner,
    gate: () => (gated = true),
    open: () => (gated = false),
    /** Lets the oldest waiting write through. */
    release: async () => {
      while (!waiting.length) await new Promise((r) => setTimeout(r, 1))
      waiting.shift()!()
      await new Promise((r) => setTimeout(r, 5))
    },
    pending: () => waiting.length,
  }
}

async function started(store: SnapshotStore) {
  const directory = mkdtempSync(join(tmpdir(), 'saleane-saves-'))
  folders.push(directory)
  const app = createHostedApp({
    store,
    origin: 'https://saleane-app.example.invalid',
    directory,
    dueEveryMs: 60 * 60000,
    api: { turnstile: null },
  })
  apps.push(app)
  const health = await app.handle({
    method: 'GET',
    url: '/api/health',
    headers: { host: 'saleane-app.example.invalid' },
    body: Buffer.alloc(0),
    remoteAddress: '203.0.113.9',
  })
  expect(health.statusCode).toBe(200)
  const db = app.api!.database
  db.connection.exec('CREATE TABLE IF NOT EXISTS test_marks (name TEXT NOT NULL)')
  const mark = (name: string) => db.run('INSERT INTO test_marks(name) VALUES(?)', name)
  return { app, mark }
}

/** The marks in the latest kept copy, read from its bytes as a fresh instance would. */
async function keptMarks(store: SnapshotStore) {
  const copy = await store.read()
  const directory = mkdtempSync(join(tmpdir(), 'saleane-restored-'))
  folders.push(directory)
  const file = join(directory, 'copy.sqlite')
  writeFileSync(file, gunzipSync(copy!.data))
  const db = new DatabaseSync(file)
  try {
    const has = db.prepare("SELECT 1 FROM sqlite_master WHERE name='test_marks'").get()
    if (!has) return []
    return (
      db.prepare('SELECT name FROM test_marks ORDER BY rowid').all() as { name: string }[]
    ).map((r) => r.name)
  } finally {
    db.close()
  }
}

describe('saves that overlap timed work', () => {
  it('keeps a change made during a save unkept until a later save carries it', async () => {
    const gated = gatedStore()
    const { app, mark } = await started(gated.store)
    gated.gate()
    // Job A marks its outside call and asks for it to be kept.
    mark('A')
    let aReady: boolean | undefined
    const a = app.beforeOutside().then((ok) => (aReady = ok))
    while (!gated.pending()) await new Promise((r) => setTimeout(r, 1))
    // While A's copy is on its way, job B marks its own call.
    mark('B')
    let bReady: boolean | undefined
    const b = app.beforeOutside().then((ok) => (bReady = ok))
    await gated.release()
    await a
    expect(aReady).toBe(true)
    // A's copy did not hold B's mark, so B may not call out yet.
    expect(bReady).toBeUndefined()
    expect(await keptMarks(gated.store)).toEqual(['A'])
    await gated.release()
    await b
    expect(bReady).toBe(true)
    // The restored copy holds both marks, and the generation matches the latest kept copy.
    expect(await keptMarks(gated.store)).toEqual(['A', 'B'])
    expect(app.generation).toBe(await gated.store.generation())
  })

  it('never counts an older copy as the latest when another instance saved in between', async () => {
    const gated = gatedStore()
    const { app, mark } = await started(gated.store)
    const before = await gated.store.generation()
    gated.gate()
    mark('A')
    let ready: boolean | undefined
    const a = app.beforeOutside().then((ok) => (ready = ok))
    while (!gated.pending()) await new Promise((r) => setTimeout(r, 1))
    // Another instance keeps its copy first.
    expect(await gated.inner.write(before, (await gated.store.read())!.data)).toBe(true)
    await gated.release()
    await a
    // A's save lost the race: its outside call is refused and it must read the copy again.
    expect(ready).toBe(false)
    expect(app.generation).toBe(-1)
    // A later mark cannot slip through on the strength of the lost copy.
    mark('B')
    gated.open()
    expect(await app.beforeOutside()).toBe(false)
  })

  it('makes no outside call while its mark is unsaved, and one once it is', async () => {
    const gated = gatedStore()
    const { app, mark } = await started(gated.store)
    gated.gate()
    let called = 0
    mark('refund intent')
    const call = app.beforeOutside().then((ok) => {
      if (ok) called += 1
      return ok
    })
    await new Promise((r) => setTimeout(r, 10))
    expect(called).toBe(0)
    await gated.release()
    expect(await call).toBe(true)
    expect(called).toBe(1)
    expect(await keptMarks(gated.store)).toEqual(['refund intent'])
  })
})
