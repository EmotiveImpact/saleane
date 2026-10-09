import { createHmac, randomBytes, randomUUID } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import type { lookup as dnsLookup } from 'node:dns'
import http from 'node:http'
import https from 'node:https'
import { BlockList, isIP } from 'node:net'
import { z } from 'zod'
import { fail } from './http'
import type { Context, Route } from './context'
import { operations } from '../src/domain/operations'
import {
  connectionEventTypes,
  connectionEvents,
  connectionPayload,
} from '../src/domain/connectionEvents'

/**
 * V5: connections. The owner points SALEANE at another piece of software (a Zapier hook, their
 * own system) and chooses which events it hears about. Each event is delivered at least once,
 * signed with a secret only the owner sees, and every attempt is logged. A connection can be
 * turned off at any time, and the studio can turn them all off at once.
 */

export const API_VERSION = '2026-10-08'
export type SendOutcome =
  | { status: number }
  /** Test mode: recorded as it would be sent, and nothing left. */
  | { test: true }
  /** `not_sent` proves nothing left; `unknown` means it may have arrived. Both are tried again. */
  | { error: 'not_sent' | 'unknown' | 'refused'; detail: string }
export type ConnectionTransport = {
  mode: 'test' | 'live'
  /** Checks an address the owner typed before it is saved. Returns a reason when it is refused. */
  check: (url: string) => string | null
  post: (url: string, headers: Record<string, string>, body: string) => Promise<SendOutcome>
}

type ConnectionRow = {
  id: string
  organisation_id: string
  name: string
  url: string
  events: string
  share_contact: number
  secret: string
  active: number
  removed_at: number | null
  created_by: string
  created_at: number
  updated_at: number
}
type DeliveryRow = {
  id: string
  organisation_id: string
  connection_id: string
  event_id: string
  event_type: string
  payload: string
  status: 'pending' | 'delivered' | 'failed' | 'skipped' | 'unknown' | 'test'
  attempts: number
  next_attempt_at: number
  response_status: number | null
  detail: string | null
  created_at: number
  updated_at: number
}

export const MAX_ATTEMPTS = 5
const RETRY_MS = [60000, 5 * 60000, 30 * 60000, 2 * 60 * 60000]
/** An event still waiting after this long is no longer worth sending. */
const STALE_MS = 3 * 24 * 60 * 60000
const BATCH = 20
/** A claimed send that has not finished by now was cut short. Well beyond the request timeout. */
const LEASE_MS = 5 * 60000
const TIMEOUT_MS = 10000
const CONNECTION_LIMIT = 10

/** Addresses that belong to this computer, its network or nobody: never a partner's. */
const PRIVATE = new BlockList()
for (const [net, bits] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 3],
] as const)
  PRIVATE.addSubnet(net, bits, 'ipv4')
for (const [net, bits] of [
  ['::', 127],
  // NAT64 gateways turn these into IPv4 addresses, private ones included.
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const)
  PRIVATE.addSubnet(net, bits, 'ipv6')
export function privateAddress(address: string) {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)
  if (mapped) return PRIVATE.check(mapped[1], 'ipv4')
  const family = isIP(address)
  if (!family) return true
  return PRIVATE.check(address, family === 4 ? 'ipv4' : 'ipv6')
}

/** Posts once and returns the answer's status. `address` is where to connect, already checked. */
export type Sender = (
  url: URL,
  request: { headers: Record<string, string>; body: string; address?: string },
) => Promise<number>

/** Node's own client: connects only to the address given, keeps the name for TLS, no redirects. */
export const nodeSender: Sender = (url, { headers, body, address }) =>
  new Promise((resolve, reject) => {
    const client = url.protocol === 'https:' ? https : http
    const outgoing = client.request(
      url,
      {
        method: 'POST',
        headers: { ...headers, 'Content-Length': Buffer.byteLength(body) },
        timeout: TIMEOUT_MS,
        ...(address
          ? {
              lookup: ((_host: string, options: { all?: boolean }, done: LookupDone) =>
                options?.all
                  ? done(null, [{ address, family: isIP(address) }])
                  : done(null, address, isIP(address))) as unknown as typeof dnsLookup,
            }
          : {}),
      },
      (response) => {
        response.resume()
        resolve(response.statusCode ?? 0)
      },
    )
    outgoing.on('timeout', () =>
      outgoing.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })),
    )
    outgoing.on('error', reject)
    outgoing.end(body)
  })
type LookupDone = (error: Error | null, address: unknown, family?: number) => void

/**
 * The real transport: HTTPS only, no redirects followed, and an address that resolves to a
 * private network refused, so a connection cannot be pointed back inside the studio's server.
 * The address checked is the one connected to, so a name cannot change its answer in between.
 */
export function fetchTransport(
  options: { allowPrivate?: boolean; sender?: Sender } = {},
): ConnectionTransport {
  const sender = options.sender ?? nodeSender
  const allowPrivate = !!options.allowPrivate
  const check = (raw: string) => {
    let url: URL
    try {
      url = new URL(raw)
    } catch {
      return 'Enter the full address, starting https://.'
    }
    if (url.protocol !== 'https:' && !(allowPrivate && url.protocol === 'http:'))
      return 'The address must start https://, so what is sent cannot be read on the way.'
    if (url.username || url.password) return 'Leave any name or password out of the address.'
    const host = url.hostname.replace(/^\[|\]$/g, '')
    if (!allowPrivate && (host === 'localhost' || host.endsWith('.localhost')))
      return 'Choose an address on the internet, not this computer.'
    if (!allowPrivate && isIP(host) && privateAddress(host))
      return 'Choose an address on the internet, not a private network.'
    return null
  }
  return {
    mode: 'live',
    check,
    async post(raw, headers, body) {
      const refused = check(raw)
      if (refused) return { error: 'refused', detail: refused }
      const url = new URL(raw)
      const host = url.hostname.replace(/^\[|\]$/g, '')
      let address: string | undefined
      if (!allowPrivate) {
        try {
          const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true })
          if (!addresses.length || addresses.some((a) => privateAddress(a.address)))
            return { error: 'refused', detail: 'The address leads to a private network.' }
          address = addresses[0].address
        } catch {
          return { error: 'not_sent', detail: 'The address could not be found.' }
        }
      }
      try {
        return { status: await sender(url, { headers, body, address }) }
      } catch (error) {
        const code = (error as { code?: string })?.code
        if (code && ['ENOTFOUND', 'ECONNREFUSED', 'EAI_AGAIN', 'ENETUNREACH'].includes(code))
          return { error: 'not_sent', detail: 'The other software could not be reached.' }
        return { error: 'unknown', detail: 'No answer in time. It may have arrived.' }
      }
    },
  }
}

/**
 * Test mode, the default: addresses are checked exactly as they would be, each delivery is signed
 * and logged, and nothing leaves this computer.
 */
export function testTransport(): ConnectionTransport {
  const { check } = fetchTransport()
  return {
    mode: 'test',
    check,
    async post(url) {
      const refused = check(url)
      return refused ? { error: 'refused', detail: refused } : { test: true }
    },
  }
}

/** Reads SALEANE_CONNECTIONS: unset or `test` sends nothing; `live` posts to the owner's addresses. */
export function connectionTransportFromEnv(
  env: Record<string, string | undefined> = process.env,
): ConnectionTransport {
  const mode = env.SALEANE_CONNECTIONS?.trim() || 'test'
  if (mode === 'test') return testTransport()
  if (mode === 'live')
    return fetchTransport({ allowPrivate: env.SALEANE_CONNECTIONS_ALLOW_PRIVATE === '1' })
  throw new Error(`Unknown connections mode "${mode}". Use test or live.`)
}

/** The signature header: the time sent and an HMAC-SHA256 of `time.body` with the secret. */
export function signature(secret: string, timestamp: number, body: string) {
  return `t=${timestamp},v1=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`
}
const newSecret = () => `whsec_${randomBytes(24).toString('base64url')}`

const connectionInput = z
  .object({
    name: z.string().trim().min(2).max(60),
    url: z.string().trim().min(10).max(500),
    events: z.array(z.enum(connectionEventTypes)).min(1).max(connectionEventTypes.length),
    shareContact: z.boolean(),
  })
  .strict()
const connectionChange = z
  .object({
    name: z.string().trim().min(2).max(60).optional(),
    events: z.array(z.enum(connectionEventTypes)).min(1).optional(),
    shareContact: z.boolean().optional(),
    active: z.boolean().optional(),
  })
  .strict()
const empty = z.object({}).strict()

function view(row: ConnectionRow) {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    events: JSON.parse(row.events) as string[],
    shareContact: !!row.share_contact,
    active: !!row.active,
    createdBy: row.created_by,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  }
}
function deliveryView(row: DeliveryRow) {
  return {
    id: row.id,
    connectionId: row.connection_id,
    eventId: row.event_id,
    type: row.event_type,
    status: row.status,
    attempts: row.attempts,
    responseStatus: row.response_status,
    detail: row.detail,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  }
}

export function createConnections(ctx: Context, transport: ConnectionTransport) {
  const { db, now } = ctx
  let running: Promise<void> | null = null

  const live = (orgId: string) =>
    db.all<ConnectionRow>(
      'SELECT * FROM connections WHERE organisation_id=? AND active=1 AND removed_at IS NULL',
      orgId,
    )
  const enqueue = (row: ConnectionRow, eventId: string, type: string, payload: unknown) => {
    const time = now()
    db.run(
      `INSERT OR IGNORE INTO connection_deliveries(id,organisation_id,connection_id,event_id,event_type,payload,status,next_attempt_at,created_at,updated_at)
       VALUES(?,?,?,?,?,?,'pending',?,?,?)`,
      randomUUID(),
      row.organisation_id,
      row.id,
      eventId,
      type,
      JSON.stringify(payload),
      time,
      time,
      time,
    )
  }

  // Every saved change is compared with the one before, inside the same transaction, so an event
  // is recorded exactly when its change is.
  ctx.onPersist((org, before, after) => {
    const events = connectionEvents(before, after)
    if (!events.length) return
    const targets = live(org.id)
    if (!targets.length) return
    const occurredAt = new Date(now()).toISOString()
    for (const event of events) {
      const eventId = `evt_${randomUUID()}`
      for (const target of targets) {
        if (!(JSON.parse(target.events) as string[]).includes(event.type)) continue
        enqueue(
          target,
          eventId,
          event.type,
          connectionPayload(after, event, {
            id: eventId,
            occurredAt,
            shareContact: !!target.share_contact,
          }),
        )
      }
    }
  })

  const finish = (row: DeliveryRow, status: DeliveryRow['status'], fields: Partial<DeliveryRow>) =>
    db.run(
      'UPDATE connection_deliveries SET status=?,response_status=?,detail=?,next_attempt_at=?,updated_at=? WHERE id=?',
      status,
      fields.response_status ?? null,
      fields.detail ?? null,
      fields.next_attempt_at ?? row.next_attempt_at,
      now(),
      row.id,
    )

  /** Anything still waiting for these connections is not sent: turning off means now. */
  const discard = (connectionIds: string[]) => {
    for (const id of connectionIds)
      db.run(
        "UPDATE connection_deliveries SET status='skipped',detail=?,updated_at=? WHERE connection_id=? AND status='pending'",
        'Turned off before it went out.',
        now(),
        id,
      )
  }

  const deliver = async () => {
    // A send cut short (the server stopped mid-request) is tried again once the lease is over;
    // the receiver dedupes on Saleane-Delivery, so a repeat is safe.
    db.run(
      "UPDATE connection_deliveries SET status=CASE WHEN attempts<? THEN 'pending' ELSE 'failed' END,next_attempt_at=?,updated_at=? WHERE status='unknown' AND updated_at<=?",
      MAX_ATTEMPTS,
      now(),
      now(),
      now() - LEASE_MS,
    )
    const due = db.all<DeliveryRow>(
      "SELECT * FROM connection_deliveries WHERE status='pending' AND next_attempt_at<=? ORDER BY next_attempt_at,created_at LIMIT ?",
      now(),
      BATCH,
    )
    for (const candidate of due) {
      // Claimed first and marked "unknown", so a crash mid-send is logged honestly.
      const claimed = db.transaction(() => {
        const row = db.get<DeliveryRow>(
          "SELECT * FROM connection_deliveries WHERE id=? AND status='pending'",
          candidate.id,
        )
        if (!row) return null
        const connection = db.get<ConnectionRow>(
          'SELECT * FROM connections WHERE id=?',
          row.connection_id,
        )
        if (!connection || !connection.active || connection.removed_at) {
          finish(row, 'skipped', { detail: 'Turned off before it went out.' })
          return null
        }
        if (now() - row.created_at > STALE_MS) {
          finish(row, 'failed', { detail: 'Waited too long to be worth sending.' })
          return null
        }
        db.run(
          "UPDATE connection_deliveries SET status='unknown',attempts=attempts+1,detail=?,updated_at=? WHERE id=?",
          'Sending was interrupted. It may have arrived.',
          now(),
          row.id,
        )
        return { row: { ...row, attempts: row.attempts + 1 }, connection }
      })
      if (!claimed) continue
      const { row, connection } = claimed
      const timestamp = Math.floor(now() / 1000)
      const result = await transport.post(
        connection.url,
        {
          'Content-Type': 'application/json',
          'User-Agent': `SALEANE-Connections/${API_VERSION}`,
          'Saleane-Event': row.event_type,
          'Saleane-Delivery': row.event_id,
          'Saleane-Signature': signature(connection.secret, timestamp, row.payload),
        },
        row.payload,
      )
      const again = (detail: string, response_status?: number) =>
        row.attempts < MAX_ATTEMPTS
          ? finish(row, 'pending', {
              detail,
              response_status,
              next_attempt_at: now() + RETRY_MS[Math.min(row.attempts - 1, RETRY_MS.length - 1)],
            })
          : finish(row, 'failed', { detail, response_status })
      if ('test' in result)
        finish(row, 'test', { detail: 'Test mode: signed and recorded. Nothing was sent.' })
      else if ('status' in result) {
        if (result.status >= 200 && result.status < 300)
          finish(row, 'delivered', { response_status: result.status })
        else if (result.status === 408 || result.status === 429 || result.status >= 500)
          again(`The other software answered ${result.status}. Trying again.`, result.status)
        else
          finish(row, 'failed', {
            response_status: result.status,
            detail: `The other software refused it (${result.status}).`,
          })
      } else if (result.error === 'refused') finish(row, 'failed', { detail: result.detail })
      else again(result.detail)
    }
  }

  const tick = () => {
    running ??= (async () => {
      try {
        await deliver()
      } finally {
        running = null
      }
    })()
    return running
  }

  const owned = (orgId: string, id: string) => {
    const row = db.get<ConnectionRow>(
      'SELECT * FROM connections WHERE id=? AND organisation_id=? AND removed_at IS NULL',
      id,
      orgId,
    )
    if (!row) fail(404, 'This connection was not found.')
    return row!
  }

  async function routes(c: Context, route: Route): Promise<boolean> {
    const { request, method, path, body, reply } = route
    if (path[1] !== 'workspaces' || path[3] !== 'connections') return false
    const actor = c.actorFor(request, method !== 'GET')
    const org = c.orgFor(path[2], actor)
    // Connections send studio records outside SALEANE, so only the owner decides.
    if (org.role !== 'owner') fail(403, 'Only the owner can connect other software.')
    const sample = operations(org.state).mode === 'sandbox'
    if (sample && method !== 'GET')
      fail(
        409,
        'A sample studio never sends anything outside SALEANE. Connect other software from a studio of your own.',
      )
    const time = now()
    const list = () => ({
      connections: db
        .all<ConnectionRow>(
          'SELECT * FROM connections WHERE organisation_id=? AND removed_at IS NULL ORDER BY created_at',
          org.id,
        )
        .map(view),
      deliveries: db
        .all<DeliveryRow>(
          'SELECT * FROM connection_deliveries WHERE organisation_id=? ORDER BY created_at DESC, rowid DESC LIMIT 50',
          org.id,
        )
        .map(deliveryView),
      apiVersion: API_VERSION,
      mode: transport.mode,
      sample,
    })
    if (path.length === 4 && method === 'GET') {
      reply(200, list())
      return true
    }
    if (path.length === 4 && method === 'POST') {
      const input = connectionInput.parse(body)
      const refused = transport.check(input.url)
      if (refused) fail(400, refused)
      const secret = newSecret()
      const id = randomUUID()
      db.transaction(() => {
        const count = db.get<{ n: number }>(
          'SELECT COUNT(*) AS n FROM connections WHERE organisation_id=? AND removed_at IS NULL',
          org.id,
        )!.n
        if (count >= CONNECTION_LIMIT)
          fail(409, `Keep up to ${CONNECTION_LIMIT} connections. Remove one you no longer use.`)
        db.run(
          'INSERT INTO connections(id,organisation_id,name,url,events,share_contact,secret,active,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,1,?,?,?)',
          id,
          org.id,
          input.name,
          input.url,
          JSON.stringify([...new Set(input.events)]),
          input.shareContact ? 1 : 0,
          secret,
          actor.name,
          time,
          time,
        )
        c.audit(org, actor.id, 'connection.created', id)
      })
      // The secret is shown once, here, and never again.
      reply(201, { ...list(), secret, created: id })
      return true
    }
    if (path.length === 5 && path[4] === 'pause-all' && method === 'POST') {
      empty.parse(body ?? {})
      db.transaction(() => {
        const on = db.all<{ id: string }>(
          'SELECT id FROM connections WHERE organisation_id=? AND active=1',
          org.id,
        )
        db.run(
          'UPDATE connections SET active=0,updated_at=? WHERE organisation_id=? AND active=1',
          time,
          org.id,
        )
        discard(on.map((x) => x.id))
      })
      c.audit(org, actor.id, 'connection.paused-all', org.id)
      reply(200, list())
      return true
    }
    if (path.length >= 5 && method === 'POST') {
      const row = owned(org.id, path[4])
      if (path.length === 5) {
        const change = connectionChange.parse(body)
        db.transaction(() => {
          db.run(
            'UPDATE connections SET name=?,events=?,share_contact=?,active=?,updated_at=? WHERE id=?',
            change.name ?? row.name,
            change.events ? JSON.stringify([...new Set(change.events)]) : row.events,
            change.shareContact === undefined ? row.share_contact : change.shareContact ? 1 : 0,
            change.active === undefined ? row.active : change.active ? 1 : 0,
            time,
            row.id,
          )
          if (change.active === false) discard([row.id])
        })
        c.audit(org, actor.id, 'connection.changed', row.id)
        reply(200, list())
        return true
      }
      if (path.length === 6 && path[5] === 'test') {
        empty.parse(body ?? {})
        if (!row.active) fail(409, 'Turn the connection on before sending a test.')
        const eventId = `evt_${randomUUID()}`
        enqueue(row, eventId, 'connection.test', {
          id: eventId,
          type: 'connection.test',
          apiVersion: API_VERSION,
          occurredAt: new Date(time).toISOString(),
          studio: {
            id: org.id,
            name: org.state.organisation.name,
            timeZone: org.state.organisation.timeZone,
          },
        })
        void tick().catch(() => {})
        reply(202, list())
        return true
      }
      if (path.length === 6 && path[5] === 'secret') {
        empty.parse(body ?? {})
        const secret = newSecret()
        db.run('UPDATE connections SET secret=?,updated_at=? WHERE id=?', secret, time, row.id)
        c.audit(org, actor.id, 'connection.secret-renewed', row.id)
        reply(200, { ...list(), secret })
        return true
      }
      if (path.length === 6 && path[5] === 'remove') {
        empty.parse(body ?? {})
        // Removed from view and never sent to again; its delivery log is kept.
        db.transaction(() => {
          db.run(
            'UPDATE connections SET active=0,removed_at=?,updated_at=? WHERE id=?',
            time,
            time,
            row.id,
          )
          discard([row.id])
        })
        c.audit(org, actor.id, 'connection.removed', row.id)
        reply(200, list())
        return true
      }
    }
    fail(404, 'This endpoint was not found.')
  }

  let timer: ReturnType<typeof setInterval> | undefined
  let nudge: ReturnType<typeof setTimeout> | undefined
  return {
    transport,
    deliver,
    tick,
    routes,
    start(intervalMs = 30000) {
      timer ??= setInterval(() => void tick().catch(() => {}), intervalMs)
      timer.unref?.()
    },
    soon(delayMs = 1500) {
      if (nudge) return
      nudge = setTimeout(() => {
        nudge = undefined
        void tick().catch(() => {})
      }, delayMs)
      nudge.unref?.()
    },
    stop() {
      if (timer) clearInterval(timer)
      if (nudge) clearTimeout(nudge)
      timer = nudge = undefined
    },
  }
}
export type Connections = ReturnType<typeof createConnections>
