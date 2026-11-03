import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { fail, header } from '../http'
import type { Context, Org, Route } from '../context'
import type { Outbox } from '../messaging/outbox'
import { businessDate, can, operations } from '../../src/domain/operations'
import { placeOf } from '../../src/domain/locations'
import {
  BROWSER_DRAWER,
  cashTaken,
  drawerConnected,
  drawerSummary,
  noSaleProblem,
  tillPrinter,
} from '../../src/domain/till'
import type { TillStatus } from '../../src/domain/till'
import { parseReceiptKey, receiptEmail, receiptFor } from '../../src/domain/receipt'
import { recordDay } from '../../src/domain/tillCount'
import { drawerJob, fromHex, preview, receiptJob, testPageJob, toHex } from './escpos'
import { networkPrinter, testPrinter } from './printers'
import type { PrinterTransport } from './printers'

/**
 * Stage 2, the till on the server. When a saved change records cash at a location whose drawer
 * opens through SALEANE, the drawer is asked to open straight away, and every opening (with who,
 * when, why and which sale) is kept in `till_events`, as is every receipt sent to a printer. A
 * sample studio only ever uses the test printer, so a real drawer never opens for pretend money.
 */
export type TillRow = {
  id: string
  organisation_id: string
  location_id: string
  kind: 'drawer' | 'print'
  cause: 'cash' | 'refund' | 'no_sale' | 'receipt' | 'test_page'
  receipt: string | null
  receipt_number: string | null
  amount_minor: number | null
  reason: string | null
  printer: 'network' | 'test'
  host: string | null
  port: number | null
  status: TillStatus
  detail: string | null
  bytes: string | null
  actor_id: string | null
  actor_name: string
  created_at: number
  updated_at: number
}
/** A drawer that could not be reached within this long is not opened later by surprise. */
const STALE_MS = 60_000
/** A receipt goes by email at most this many times. */
export const RECEIPT_EMAILS = 3
const keySchema = /^[A-Za-z0-9._:-]{8,100}$/
const receiptInput = z.object({ receipt: z.string().min(3).max(400) }).strict()
const noSaleInput = z
  .object({ reason: z.string().max(300), locationId: z.string().min(1).max(150).optional() })
  .strict()
const testInput = z.object({ locationId: z.string().min(1).max(150).optional() }).strict()

/** What the team sees of one till event. A test print carries its preview instead of paper. */
export function tillView(row: TillRow) {
  return {
    id: row.id,
    kind: row.kind,
    cause: row.cause,
    locationId: row.location_id,
    receipt: row.receipt,
    receiptNumber: row.receipt_number,
    amountMinor: row.amount_minor,
    reason: row.reason,
    printer: row.printer,
    status: row.status,
    detail: row.detail,
    actorName: row.actor_name,
    createdAt: new Date(row.created_at).toISOString(),
    ...(row.bytes ? { preview: preview(fromHex(row.bytes)) } : {}),
  }
}

export function createTill(
  ctx: Context,
  outbox: Outbox,
  printers: { network?: PrinterTransport; test?: PrinterTransport } = {},
) {
  const { db, now } = ctx
  const network = printers.network ?? networkPrinter()
  const test = printers.test ?? testPrinter()
  let running: Promise<void> | null = null
  let nudge: ReturnType<typeof setTimeout> | undefined

  const get = (id: string) => db.get<TillRow>('SELECT * FROM till_events WHERE id=?', id)
  const nameOf = (actorId: string | null) =>
    actorId
      ? (db.get<{ name: string }>('SELECT name FROM accounts WHERE id=?', actorId)?.name ??
        'Someone')
      : 'SALEANE'
  const insert = (row: Omit<TillRow, 'id' | 'created_at' | 'updated_at' | 'bytes' | 'detail'>) => {
    const id = randomUUID()
    const time = now()
    db.run(
      `INSERT INTO till_events(id,organisation_id,location_id,kind,cause,receipt,receipt_number,amount_minor,reason,printer,host,port,status,actor_id,actor_name,created_at,updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      id,
      row.organisation_id,
      row.location_id,
      row.kind,
      row.cause,
      row.receipt,
      row.receipt_number,
      row.amount_minor,
      row.reason,
      row.printer,
      row.host,
      row.port,
      row.status,
      row.actor_id,
      row.actor_name,
      time,
      time,
    )
    return get(id)!
  }
  /** Where a location's job goes: a sample studio never reaches a real printer. */
  const target = (org: Pick<Org, 'state'>, locationId: string) => {
    const printer = tillPrinter(org.state, locationId)
    const mode =
      printer.mode === 'browser'
        ? null
        : operations(org.state).mode === 'sandbox'
          ? ('test' as const)
          : printer.mode
    return {
      printer,
      mode,
      host: mode === 'network' ? (printer.host ?? null) : null,
      port: mode === 'network' ? (printer.port ?? null) : null,
    }
  }
  const finish = (row: TillRow, status: TillStatus, detail: string | null, bytes?: Uint8Array) =>
    db.run(
      'UPDATE till_events SET status=?,detail=?,bytes=?,updated_at=? WHERE id=?',
      status,
      detail,
      bytes ? toHex(bytes) : null,
      now(),
      row.id,
    )
  /** Sends one claimed job and records what the printer answered, never more than that. */
  const deliver = async (row: TillRow, bytes: Uint8Array) => {
    const transport = row.printer === 'network' ? network : test
    const outcome = await transport.send({ host: row.host ?? '', port: row.port ?? 0, bytes })
    if (!outcome.ok) finish(row, 'failed', outcome.detail)
    else if (transport.name === 'test') finish(row, 'test', null, bytes)
    else finish(row, 'sent', null)
    return get(row.id)!
  }

  // Cash recorded by any saved change opens the drawer at its location, if one is connected. The
  // opening is written down in the same transaction as the cash, and sent once that is saved.
  ctx.onPersist((org, before, after, change) => {
    let queued = false
    for (const move of cashTaken(before, after)) {
      const where = target({ state: after }, move.locationId)
      if (!where.mode || !drawerConnected(where.printer)) continue
      insert({
        organisation_id: org.id,
        location_id: move.locationId,
        kind: 'drawer',
        cause: move.cause,
        receipt: move.receipt,
        receipt_number: move.number ?? null,
        amount_minor: move.amountMinor,
        reason: null,
        printer: where.mode,
        host: where.host,
        port: where.port,
        status: 'pending',
        actor_id: change.actorId,
        actor_name: nameOf(change.actorId),
      })
      queued = true
    }
    if (queued) soon()
  })

  /** One pass over drawers waiting to open. Overlapping calls share the pass already running. */
  const pass = async () => {
    const due = db.all<TillRow>(
      "SELECT * FROM till_events WHERE status='pending' ORDER BY created_at LIMIT 50",
    )
    for (const row of due) {
      const claimed =
        Number(
          db.run(
            "UPDATE till_events SET status='sending',updated_at=? WHERE id=? AND status='pending'",
            now(),
            row.id,
          ).changes,
        ) === 1
      if (!claimed) continue
      if (now() - row.created_at > STALE_MS) {
        finish(row, 'skipped', 'Too late to open the drawer by the time the printer was free.')
        continue
      }
      await deliver(row, drawerJob())
    }
  }
  const run = () => {
    running ??= pass().finally(() => {
      running = null
    })
    return running
  }
  const soon = () => {
    if (nudge) return
    nudge = setTimeout(() => {
      nudge = undefined
      void run().catch(() => {})
    }, 0)
    nudge.unref?.()
  }

  /** Which receipt, if the person may see it: a general manager only their own location's. */
  const receiptOf = (org: Org, raw: string) => {
    const ref = parseReceiptKey(raw)
    if (!ref) fail(400, 'Choose a receipt.')
    const receipt = receiptFor(org.state, ref!)
    if (!receipt) fail(404, 'This receipt was not found.')
    if (org.role === 'general' && receipt!.locationId !== org.locationId)
      fail(403, 'That receipt is from another location.')
    return receipt!
  }

  const routes = async (_: Context, route: Route): Promise<boolean> => {
    const { request, method, path, url, body, reply } = route
    if (path[1] !== 'workspaces' || path[3] !== 'till' || path.length !== 5) return false
    const actor = ctx.actorFor(request, method !== 'GET')
    const org = ctx.orgFor(path[2], actor)
    // The till is for the people who take payments: owners, managers, reception and a general
    // manager at their own location. Practitioners never take payments, so never open the drawer.
    if (!can(org.role, 'checkout')) fail(403, 'Your role does not use the till.')
    const action = path[4]

    if (action === 'print' && method === 'POST') {
      const receipt = receiptOf(org, receiptInput.parse(body).receipt)
      const where = target(org, receipt.locationId)
      if (!where.mode)
        fail(409, 'Receipts here print through the computer’s print window. Print from this page.')
      const row = insert({
        organisation_id: org.id,
        location_id: receipt.locationId,
        kind: 'print',
        cause: 'receipt',
        receipt: receipt.key,
        receipt_number: receipt.number,
        amount_minor: receipt.totalMinor,
        reason: null,
        printer: where.mode!,
        host: where.host,
        port: where.port,
        status: 'sending',
        actor_id: actor.id,
        actor_name: actor.name,
      })
      reply(200, tillView(await deliver(row, receiptJob(receipt, where.printer.paper))))
      return true
    }

    if (action === 'test' && method === 'POST') {
      if (!can(org.role, 'till-settings')) fail(403, 'Your role cannot change the printer.')
      const input = testInput.parse(body)
      const site = placeOf(org.state, input.locationId)
      if (!site || site.archived) fail(400, 'Choose an open location.')
      const where = target(org, site!.id)
      if (!where.mode)
        fail(409, 'Choose a network printer or the test printer, and save, before a test page.')
      const row = insert({
        organisation_id: org.id,
        location_id: site!.id,
        kind: 'print',
        cause: 'test_page',
        receipt: null,
        receipt_number: null,
        amount_minor: null,
        reason: null,
        printer: where.mode!,
        host: where.host,
        port: where.port,
        status: 'sending',
        actor_id: actor.id,
        actor_name: actor.name,
      })
      const place = (operations(org.state).locations ?? []).length ? site!.name : undefined
      reply(
        200,
        tillView(
          await deliver(row, testPageJob(org.state.organisation.name, place, where.printer.paper)),
        ),
      )
      return true
    }

    if (action === 'drawer' && method === 'POST') {
      const input = noSaleInput.parse(body)
      const problem = noSaleProblem(input.reason)
      if (problem) fail(400, problem)
      if (org.role === 'general' && input.locationId && input.locationId !== org.locationId)
        fail(403, 'That drawer is at another location.')
      const site = placeOf(org.state, org.role === 'general' ? org.locationId! : input.locationId)
      if (!site || site.archived) fail(400, 'Choose an open location.')
      const where = target(org, site!.id)
      if (!where.mode) fail(409, BROWSER_DRAWER)
      if (!drawerConnected(where.printer))
        fail(409, 'The cash drawer is turned off here. Turn it on in Settings, Till and printer.')
      const row = insert({
        organisation_id: org.id,
        location_id: site!.id,
        kind: 'drawer',
        cause: 'no_sale',
        receipt: null,
        receipt_number: null,
        amount_minor: null,
        reason: input.reason.trim(),
        printer: where.mode!,
        host: where.host,
        port: where.port,
        status: 'sending',
        actor_id: actor.id,
        actor_name: actor.name,
      })
      ctx.audit(org, actor.id, 'till.drawer', row.id)
      reply(200, tillView(await deliver(row, drawerJob())))
      return true
    }

    if (action === 'drawer' && method === 'GET') {
      const date = z.iso
        .date()
        .parse(
          url.searchParams.get('date') ?? businessDate(org.state, new Date(now()).toISOString()),
        )
      const sample = operations(org.state).mode === 'sandbox'
      const start = Date.parse(`${date}T00:00:00Z`)
      // Wide enough for any time zone; a sample studio's later days count on its sample day.
      const rows = db
        .all<TillRow>(
          "SELECT * FROM till_events WHERE organisation_id=? AND kind='drawer' AND created_at>=? AND created_at<? ORDER BY created_at",
          org.id,
          start - 36 * 3600000,
          sample ? Number.MAX_SAFE_INTEGER : start + 60 * 3600000,
        )
        .filter(
          (row) =>
            recordDay(org.state, new Date(row.created_at).toISOString()) === date &&
            (org.role !== 'general' || row.location_id === org.locationId),
        )
      reply(200, {
        date,
        openings: rows.map(tillView),
        summary: drawerSummary(
          rows.map((row) => ({
            cause: row.cause as 'cash' | 'refund' | 'no_sale',
            status: row.status,
            actorName: row.actor_name,
            reason: row.reason,
          })),
        ),
      })
      return true
    }

    if (action === 'events' && method === 'GET') {
      const key = url.searchParams.get('receipt')
      const rows = key
        ? db.all<TillRow>(
            'SELECT * FROM till_events WHERE organisation_id=? AND receipt=? ORDER BY created_at DESC LIMIT 20',
            org.id,
            receiptOf(org, key).key,
          )
        : // The latest test prints, for looking at what the test printer would have printed.
          db
            .all<TillRow>(
              "SELECT * FROM till_events WHERE organisation_id=? AND kind='print' AND printer='test' ORDER BY created_at DESC LIMIT 10",
              org.id,
            )
            .filter((row) => org.role !== 'general' || row.location_id === org.locationId)
      reply(200, { events: rows.map(tillView) })
      return true
    }

    if (action === 'email' && method === 'POST') {
      if (operations(org.state).mode !== 'local') fail(409, 'Sample studios never send email.')
      const key = header(request, 'idempotency-key')
      if (!key || !keySchema.test(key))
        fail(400, 'Use an idempotency key between 8 and 100 safe characters.')
      const receipt = receiptOf(org, receiptInput.parse(body).receipt)
      if (!receipt.clientId || !receipt.email)
        fail(409, 'This client has no email address. Add one on their page, then try again.')
      const slot = `receipt:${receipt.key}`
      const dedupe = `${slot}:${key}`
      const queued = db.transaction(() => {
        const again = db.get<{ id: string; status: string }>(
          'SELECT id,status FROM outbox WHERE organisation_id=? AND dedupe_key=?',
          org.id,
          dedupe,
        )
        if (again) return again
        const sent = db.get<{ n: number }>(
          'SELECT COUNT(*) AS n FROM outbox WHERE organisation_id=? AND slot=?',
          org.id,
          slot,
        )!.n
        if (sent >= RECEIPT_EMAILS) fail(429, 'This receipt has been emailed three times already.')
        const { subject, body: text } = receiptEmail(receipt)
        const id = randomUUID()
        const time = now()
        db.run(
          `INSERT INTO outbox(id,organisation_id,dedupe_key,appointment_id,client_id,kind,channel,slot,recipient,subject,body,status,next_attempt_at,created_at,updated_at)
           VALUES(?,?,?,?,?,'receipt','email',?,?,?,?,'pending',?,?,?)`,
          id,
          org.id,
          dedupe,
          receipt.kind === 'visit'
            ? (org.state.sales.find((s) => s.id === receipt.ref.id)?.appointmentId ?? '')
            : '',
          receipt.clientId!,
          slot,
          receipt.email!,
          subject,
          text,
          time,
          time,
          time,
        )
        ctx.audit(org, actor.id, 'receipt.emailed', receipt.ref.id)
        return { id, status: 'pending' }
      })
      reply(200, {
        ...queued,
        recipient: receipt.email,
        testMode: !outbox.providers.email.live,
      })
      return true
    }
    fail(404, 'This endpoint was not found.')
    return true
  }

  return {
    routes,
    run,
    soon,
    network,
    test,
    stop() {
      if (nudge) clearTimeout(nudge)
      nudge = undefined
    },
  }
}
export type Till = ReturnType<typeof createTill>
