import { randomUUID } from 'node:crypto'
import {
  MANAGE_LINK,
  channelsFor,
  composeMessage,
  planMessages,
  feedbackDue,
  patchTestReminderDue,
  visitSlot,
} from '../../src/domain/reminders'
import type { MessageChannel, MessageKind, OutboxStatus } from '../../src/domain/reminders'
import { operations } from '../../src/domain/operations'
import { visitStart } from '../../src/domain/guest'
import type { Context } from '../context'
import { issueGuestLink } from '../routes/guest'
import type { Providers, Receipt } from './providers'

export type OutboxRow = {
  id: string
  organisation_id: string
  dedupe_key: string
  appointment_id: string
  client_id: string
  kind: MessageKind
  channel: MessageChannel
  slot: string
  recipient: string
  subject: string
  body: string
  status: OutboxStatus
  provider: string | null
  provider_ref: string | null
  detail: string | null
  attempts: number
  next_attempt_at: number
  created_at: number
  updated_at: number
}
/** Transient refusals are tried this many times in all, further apart each time. */
export const MAX_ATTEMPTS = 3
const RETRY_MS = [60000, 5 * 60000]
const BATCH = 50

/**
 * The outbox: plans confirmations and reminders from studio records, then hands each one to the
 * configured provider exactly once. Messages live in their own table rather than the studio
 * record, so sending never collides with someone editing the calendar.
 */
export function createOutbox(ctx: Context, providers: Providers) {
  const { db, now } = ctx
  let running: Promise<void> | null = null

  /** Records anything newly due. Safe to repeat: each message has one key per visit time. */
  const plan = () => {
    const orgs = db.all<{ id: string }>(
      "SELECT id FROM organisations WHERE json_extract(state,'$.operations.mode')='local'",
    )
    for (const { id } of orgs) {
      const org = ctx.systemOrg(id)
      if (!org) continue
      const recorded = db
        .all<
          Pick<OutboxRow, 'appointment_id' | 'kind' | 'channel' | 'slot' | 'status' | 'created_at'>
        >(
          'SELECT appointment_id,kind,channel,slot,status,created_at FROM outbox WHERE organisation_id=?',
          id,
        )
        .map((row) => ({
          appointmentId: row.appointment_id,
          kind: row.kind,
          channel: row.channel,
          slot: row.slot,
          status: row.status,
          createdAt: new Date(row.created_at).toISOString(),
        }))
      const time = now()
      for (const message of planMessages(org.state, new Date(time).toISOString(), recorded))
        db.run(
          `INSERT OR IGNORE INTO outbox(id,organisation_id,dedupe_key,appointment_id,client_id,kind,channel,slot,recipient,subject,body,status,next_attempt_at,created_at,updated_at)
           VALUES(?,?,?,?,?,?,?,?,?,?,?,'pending',?,?,?)`,
          randomUUID(),
          id,
          message.dedupeKey,
          message.appointmentId,
          message.clientId,
          message.kind,
          message.channel,
          message.slot,
          message.recipient,
          message.subject,
          message.body,
          time,
          time,
          time,
        )
    }
  }

  const finish = (row: OutboxRow, status: OutboxStatus, fields: Partial<OutboxRow> = {}) =>
    db.run(
      'UPDATE outbox SET status=?,provider=?,provider_ref=?,detail=?,next_attempt_at=?,updated_at=? WHERE id=?',
      status,
      fields.provider ?? row.provider,
      fields.provider_ref ?? row.provider_ref,
      fields.detail ?? null,
      fields.next_attempt_at ?? row.next_attempt_at,
      now(),
      row.id,
    )

  /**
   * Re-checks one message against the current records and prepares its text. Runs in a
   * transaction and marks the row "unknown" before anything leaves, so a crash mid-send leaves an
   * honest "check before resending" rather than a silent second copy.
   */
  const claim = (row: OutboxRow) =>
    db.transaction(() => {
      const fresh = db.get<OutboxRow>(
        "SELECT * FROM outbox WHERE id=? AND status='pending'",
        row.id,
      )
      if (!fresh) return null
      const org = ctx.systemOrg(fresh.organisation_id)
      const visit = org?.state.appointments.find((a) => a.id === fresh.appointment_id)
      const client = org?.state.clients.find((c) => c.id === fresh.client_id)
      const skip = (detail: string) => {
        finish(fresh, 'skipped', { detail })
        return null
      }
      if (!org || !visit || !client) return skip('The visit is no longer in the studio record.')
      if (operations(org.state).mode !== 'local') return skip('Sample studios never send.')
      const wanted =
        fresh.kind === 'cancelled'
          ? 'cancelled'
          : fresh.kind === 'feedback'
            ? 'completed'
            : 'confirmed'
      if (visit.status !== wanted || visitSlot(visit) !== fresh.slot)
        return skip('The visit changed before this went out.')
      if (
        fresh.kind === 'feedback' &&
        !feedbackDue(org.state, visit, visitStart(org.state, visit.id), now())
      )
        return skip('Answered, turned off or too late before it went out.')
      if (
        fresh.kind === 'patch_test' &&
        !patchTestReminderDue(org.state, visit, visitStart(org.state, visit.id), now())
      )
        return skip('A patch test was recorded, or it was too late, before it went out.')
      if (fresh.kind !== 'cancelled' && !channelsFor(org.state, client).includes(fresh.channel))
        return skip('Turned off for this client or studio before it went out.')
      // The studio's rules may have changed since this was queued: say what they are now.
      const current =
        fresh.kind === 'patch_test'
          ? composeMessage(org.state, visit, 'patch_test', fresh.channel)
          : null
      let body = current?.body ?? fresh.body
      if (body.includes(MANAGE_LINK)) {
        try {
          body = body.replaceAll(MANAGE_LINK, issueGuestLink(ctx, org, visit.id, 'message').url)
        } catch {
          return skip('The visit is too close or too far past for a manage link.')
        }
      }
      const provider = providers[fresh.channel]
      db.run(
        "UPDATE outbox SET status='unknown',provider=?,attempts=attempts+1,detail=?,subject=?,body=?,updated_at=? WHERE id=?",
        provider.name,
        'Sending was interrupted. Check before sending again.',
        current?.subject ?? fresh.subject,
        current?.body ?? fresh.body,
        now(),
        fresh.id,
      )
      return {
        row: { ...fresh, provider: provider.name, attempts: fresh.attempts + 1 },
        message: {
          id: fresh.id,
          channel: fresh.channel,
          to: fresh.recipient,
          subject: current?.subject ?? fresh.subject,
          body,
          fromName: org.state.organisation.name,
        },
      }
    })

  const deliver = async () => {
    const due = db.all<OutboxRow>(
      "SELECT * FROM outbox WHERE status='pending' AND next_attempt_at<=? ORDER BY next_attempt_at,created_at LIMIT ?",
      now(),
      BATCH,
    )
    for (const candidate of due) {
      const claimed = claim(candidate)
      if (!claimed) continue
      const { row, message } = claimed
      const result = await providers[row.channel].send(message)
      if (result.outcome === 'test') finish(row, 'test', { detail: null })
      else if (result.outcome === 'accepted')
        finish(row, 'accepted', { provider_ref: result.providerRef, detail: null })
      else if (result.outcome === 'unknown') finish(row, 'unknown', { detail: result.detail })
      else if (result.retry && row.attempts < MAX_ATTEMPTS)
        finish(row, 'pending', {
          detail: result.detail,
          next_attempt_at: now() + RETRY_MS[Math.min(row.attempts - 1, RETRY_MS.length - 1)],
        })
      else finish(row, 'failed', { detail: result.detail })
    }
  }

  /** One pass: plan, then send. Overlapping calls share the pass already running. */
  const tick = () => {
    running ??= (async () => {
      try {
        plan()
        await deliver()
      } finally {
        running = null
      }
    })()
    return running
  }

  /** A verified provider receipt. Only a receipt can turn a message into "delivered". */
  const record = (receipt: Receipt) => {
    const row = db.get<OutboxRow>(
      'SELECT * FROM outbox WHERE provider=? AND provider_ref=?',
      receipt.provider,
      receipt.providerRef,
    )
    if (!row || row.status === 'delivered') return false
    finish(row, receipt.delivered ? 'delivered' : 'failed', {
      detail: receipt.delivered ? null : (receipt.detail ?? 'The provider could not deliver it.'),
    })
    return true
  }

  /** Staff ask for a failed or unclear message to go again; it is re-checked before it goes. */
  const retry = (organisationId: string, id: string) =>
    Number(
      db.run(
        "UPDATE outbox SET status='pending',detail=NULL,next_attempt_at=?,updated_at=? WHERE id=? AND organisation_id=? AND status IN ('failed','unknown')",
        now(),
        now(),
        id,
        organisationId,
      ).changes,
    ) === 1

  let timer: ReturnType<typeof setInterval> | undefined
  let nudge: ReturnType<typeof setTimeout> | undefined
  return {
    providers,
    plan,
    deliver,
    tick,
    record,
    retry,
    start(intervalMs = 30000) {
      timer ??= setInterval(() => void tick().catch(() => {}), intervalMs)
      timer.unref?.()
    },
    /** Runs a pass shortly, gathering a burst of changes into one. */
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
export type Outbox = ReturnType<typeof createOutbox>
