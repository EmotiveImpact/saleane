import type { IncomingMessage, ServerResponse } from 'node:http'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Readable, Writable } from 'node:stream'
import { gunzipSync, gzipSync } from 'node:zlib'
import { createApiHandler } from './app'
import type { ApiHandler } from './app'
import type { ApiOptions } from './context'
import { LocalDatabase } from './database'

/**
 * Hosting on a platform with no lasting disk (Vercel). SALEANE keeps its one SQLite database, with
 * every tested rule unchanged, in the instance's temporary folder; a copy of the whole database is
 * kept elsewhere (Neon) between visits. The copy is replaced only when nobody else replaced it
 * since this instance read it, and an answer that changed something is sent only once the new copy
 * is kept. So a change is either kept and answered, or not kept and answered "try again": two
 * instances can never each keep half of the studio. A retried save is safe because saves carry
 * their own keys (command receipts).
 */
export type SnapshotStore = {
  /** The generation of the copy kept now; 0 before the first copy. */
  generation(): Promise<number>
  /** The copy kept now, compressed, or nothing before the first copy. */
  read(): Promise<{ generation: number; data: Buffer } | undefined>
  /** Keeps `data` as generation `previous + 1`, only when `previous` is still the latest. */
  write(previous: number, data: Buffer): Promise<boolean>
  close?(): Promise<void>
}

export type HostedRequest = {
  method: string
  url: string
  headers: IncomingMessage['headers']
  body: Buffer
  remoteAddress: string
}
export type HostedResponse = {
  statusCode: number
  headers: Record<string, string | string[]>
  body: Buffer
}

export type HostedOptions = {
  store: SnapshotStore
  origin: string
  /** The instance's own folder for the working database. */
  directory: string
  now?: () => number
  /** How often the outbox and other due work run, at most, while requests arrive. */
  dueEveryMs?: number
  /**
   * How many times a request is run again on the newer copy when another instance kept one first.
   * Only safe while no live provider is on: a request that had already reached a provider would
   * reach it twice. Left out, the visitor is asked to try again instead.
   */
  retries?: number
  /** Everything else the API takes; providers are read from the environment when left out. */
  api?: Omit<ApiOptions, 'origin' | 'database' | 'databasePath' | 'outboxIntervalMs' | 'now'>
}

const BUSY = 'SALEANE was busy saving another change, so this one was not saved. Please try again.'

function json(statusCode: number, body: unknown): HostedResponse {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...(statusCode === 503 ? { 'retry-after': '1' } : {}),
    },
    body: Buffer.from(JSON.stringify(body)),
  }
}

/** Runs the API on one request and gathers its whole answer before anything is sent. */
async function capture(api: ApiHandler, input: HostedRequest): Promise<HostedResponse> {
  const request = Readable.from(input.body.length ? [input.body] : []) as unknown as IncomingMessage
  Object.assign(request, {
    method: input.method,
    url: input.url,
    headers: input.headers,
    socket: { remoteAddress: input.remoteAddress },
  })
  const chunks: Buffer[] = []
  const headers: Record<string, string | string[]> = {}
  const response = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.from(chunk))
      callback()
    },
  }) as unknown as ServerResponse
  response.statusCode = 200
  response.setHeader = ((name: string, value: string | string[] | number) => {
    headers[name.toLowerCase()] = typeof value === 'number' ? String(value) : value
    return response
  }) as ServerResponse['setHeader']
  const finished = new Promise<void>((resolve) => response.on('finish', resolve))
  await api(request, response)
  await finished
  return { statusCode: response.statusCode, headers, body: Buffer.concat(chunks) }
}

/** Lets follow-on work started by an answer (an account email recorded as sent) finish first. */
const settle = () => new Promise<void>((resolve) => setImmediate(() => setImmediate(resolve)))

export function createHostedApp(options: HostedOptions) {
  const now = options.now ?? Date.now
  const dueEveryMs = options.dueEveryMs ?? 30000
  const file = join(options.directory, 'saleane.sqlite')
  let api: ApiHandler | undefined
  /** The generation the working database was read from; -1 when it must be read again. */
  let generation = -1
  /** SQLite's count of changed rows when the working database last matched the kept copy. */
  let kept = 0
  let lastDue = Number.NEGATIVE_INFINITY
  let queue: Promise<unknown> = Promise.resolve()

  // One request at a time: the database is synchronous, so this costs little and makes each
  // request's changes exactly the ones the next kept copy adds.
  const exclusive = <T>(work: () => Promise<T>): Promise<T> => {
    const run = queue.then(work, work)
    queue = run.catch(() => {})
    return run
  }
  const changes = () =>
    Number(api!.database.get<{ n: number }>('SELECT total_changes() AS n')?.n ?? 0)

  const open = (data?: Buffer) => {
    api?.close()
    api = undefined
    mkdirSync(options.directory, { recursive: true, mode: 0o700 })
    for (const suffix of ['', '-wal', '-shm']) rmSync(file + suffix, { force: true })
    if (data) writeFileSync(file, gunzipSync(data), { mode: 0o600 })
    // Opening applies any schema steps this version brings, as it does on a computer.
    const database = new LocalDatabase(file)
    try {
      api = createApiHandler({ ...options.api, origin: options.origin, database, now })
    } catch (error) {
      database.close()
      throw error
    }
  }

  const keep = async () => {
    api!.database.connection.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    const data = gzipSync(readFileSync(file))
    let stored = false
    try {
      stored = await options.store.write(generation, data)
    } catch (error) {
      console.error('[SALEANE] The database copy could not be kept.', error)
    }
    if (stored) {
      generation += 1
      kept = changes()
    } else generation = -1
    return stored
  }

  /** Brings the working database up to the kept copy, starting one when there is none. */
  const sync = async () => {
    const latest = await options.store.generation()
    if (api && latest === generation) return
    const copy = latest > 0 ? await options.store.read() : undefined
    open(copy?.data)
    generation = copy?.generation ?? 0
    kept = 0
    // A first copy, or a copy this version has just moved to its newer schema.
    if (!copy || changes() > 0) {
      if (!(await keep())) throw new Error('Another instance kept a copy first.')
    }
  }

  const due = async () => {
    const time = now()
    if (time - lastDue < dueEveryMs) return
    lastDue = time
    const work = api!
    // Each runs as it does on a timer on a computer; a failure waits for the next turn.
    await Promise.allSettled([
      work.outbox.tick(),
      work.connections.tick(),
      work.billing.run(),
      work.memberships.tick(),
    ])
    try {
      work.signOffs.run()
    } catch {
      // Tried again next turn.
    }
  }

  const retries = options.retries ?? 0
  const handle = (input: HostedRequest) =>
    exclusive(async () => {
      for (let attempt = 0; ; attempt += 1) {
        try {
          await sync()
        } catch (error) {
          console.error('[SALEANE] The kept database could not be read.', error)
          generation = -1
          return json(503, { error: 'SALEANE is starting up. Try again in a moment.' })
        }
        await due()
        const answer = await capture(api!, input)
        await settle()
        if (changes() === kept || (await keep())) return answer
        // Not kept: the working database is read again before anything else runs.
        if (attempt >= retries) return json(503, { error: BUSY })
      }
    })

  return {
    handle,
    /** For checks: the generation the working database matches. */
    get generation() {
      return generation
    },
    get api() {
      return api
    },
    close: async () => {
      await queue
      api?.close()
      api = undefined
      await options.store.close?.()
    },
  }
}
export type HostedApp = ReturnType<typeof createHostedApp>

/** Neon (Postgres): one row holds the latest copy; an hourly copy is kept for two days. */
export async function neonStore(connectionString: string): Promise<SnapshotStore> {
  const { default: pg } = await import('pg')
  const pool = new pg.Pool({
    connectionString,
    max: 3,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 15000,
  })
  pool.on('error', (error) => console.error('[SALEANE] A database connection closed.', error))
  let ready: Promise<void> | undefined
  const prepare = () =>
    (ready ??= pool
      .query(
        `CREATE TABLE IF NOT EXISTS saleane_snapshot (
           id smallint PRIMARY KEY CHECK (id = 1),
           generation bigint NOT NULL CHECK (generation > 0),
           data bytea NOT NULL,
           saved_at timestamptz NOT NULL DEFAULT now()
         );
         CREATE TABLE IF NOT EXISTS saleane_snapshot_history (
           generation bigint PRIMARY KEY,
           data bytea NOT NULL,
           saved_at timestamptz NOT NULL DEFAULT now()
         );`,
      )
      .then(
        () => {},
        (error) => {
          ready = undefined
          throw error
        },
      ))
  return {
    async generation() {
      await prepare()
      const { rows } = await pool.query<{ generation: string }>(
        'SELECT generation FROM saleane_snapshot WHERE id = 1',
      )
      return rows[0] ? Number(rows[0].generation) : 0
    },
    async read() {
      await prepare()
      const { rows } = await pool.query<{ generation: string; data: Buffer }>(
        'SELECT generation, data FROM saleane_snapshot WHERE id = 1',
      )
      return rows[0] ? { generation: Number(rows[0].generation), data: rows[0].data } : undefined
    },
    async write(previous, data) {
      await prepare()
      const result =
        previous === 0
          ? await pool.query(
              'INSERT INTO saleane_snapshot (id, generation, data) VALUES (1, 1, $1) ON CONFLICT (id) DO NOTHING',
              [data],
            )
          : await pool.query(
              'UPDATE saleane_snapshot SET generation = generation + 1, data = $2, saved_at = now() WHERE id = 1 AND generation = $1',
              [previous, data],
            )
      if (result.rowCount !== 1) return false
      // Insurance against a bad change: an hourly copy, kept for two days.
      await pool
        .query(
          `WITH added AS (
             INSERT INTO saleane_snapshot_history (generation, data)
             SELECT $1, $2 WHERE NOT EXISTS (
               SELECT 1 FROM saleane_snapshot_history WHERE saved_at > now() - interval '1 hour'
             )
             ON CONFLICT (generation) DO NOTHING RETURNING 1
           )
           DELETE FROM saleane_snapshot_history WHERE saved_at < now() - interval '2 days'`,
          [previous + 1, data],
        )
        .catch((error) => console.error('[SALEANE] The hourly copy was not kept.', error))
      return true
    },
    close: () => pool.end(),
  }
}

/** A store kept in memory, for checks and for trying hosting on one computer. */
export function memoryStore(): SnapshotStore & { writes: number } {
  let latest: { generation: number; data: Buffer } | undefined
  const store = {
    writes: 0,
    generation: async () => latest?.generation ?? 0,
    read: async () => latest,
    write: async (previous: number, data: Buffer) => {
      if ((latest?.generation ?? 0) !== previous) return false
      latest = { generation: previous + 1, data }
      store.writes += 1
      return true
    },
  }
  return store
}
