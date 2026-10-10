import { randomUUID } from 'node:crypto'
import { digest, token } from '../auth'
import { fail } from '../http'
import type { Context } from '../context'
import { newsAudience, newsEmail, newsMessage, newsSendFrom, newsText } from '../../src/domain/news'
import { operations } from '../../src/domain/operations'

/**
 * Stage 4: the server's side of a message to clients. When the owner's approval is saved, one copy
 * for each client is written to the outbox in the same transaction, each found again by its
 * message; when a message is stopped, every copy still waiting is marked not sent. Each email
 * carries its own link to stop news, kept here only as a hash.
 */

/** The audit action an erasure request is recorded under (routes/privacy.ts). */
export const ERASURE_REQUESTED = 'client.erasure_requested'
/** How long the stop link in an email keeps working. */
export const NEWS_LINK_DAYS = 400
const DAY = 86400000
const INVALID = 'This link has expired or been replaced. Ask the studio to stop your news.'

export const newsSlot = (messageId: string) => `news:${messageId}`
export const newsSlotMessage = (slot: string) => slot.slice('news:'.length)

/** Every client the team recorded an erasure request for. Nothing is sent to them. */
export function erasureRequested(ctx: Context, organisationId: string) {
  return ctx.db
    .all<{ record_id: string }>(
      'SELECT DISTINCT record_id FROM audit_events WHERE organisation_id=? AND action=?',
      organisationId,
      ERASURE_REQUESTED,
    )
    .map((row) => row.record_id)
}

/**
 * Queues an approved message, stops one, and retires stop links sent to an address a client no
 * longer uses. Runs inside the transaction that saves the change, so an approval and its copies
 * are saved together or not at all.
 */
export function watchNews(ctx: Context) {
  const { db, now } = ctx
  ctx.onPersist((org, before, after, change) => {
    if (change.action === 'news-approve') {
      const message = newsMessage(after, change.recordId)
      if (!message || message.status !== 'approved' || newsMessage(before, message.id)?.approvedAt)
        return
      // A sample studio never queues anything; its record says so.
      if (operations(after).mode !== 'local' || message.sample) return
      const audience = newsAudience(after, message, {
        now: message.approvedAt!,
        erased: erasureRequested(ctx, org.id),
      })
      if (audience.email !== message.toEmail || audience.text !== message.toText)
        fail(409, 'The numbers changed while approving. Check them and approve again.')
      const time = now()
      const from = newsSendFrom(after, Date.parse(message.approvedAt!))
      const text = newsText(after, message)
      for (const r of audience.recipients) {
        const client = after.clients.find((c) => c.id === r.clientId)!
        const email = r.channel === 'email' ? newsEmail(after, message, client) : null
        db.run(
          `INSERT OR IGNORE INTO outbox(id,organisation_id,dedupe_key,appointment_id,client_id,kind,channel,slot,recipient,subject,body,status,next_attempt_at,created_at,updated_at)
           VALUES(?,?,?,'',?,'news',?,?,?,?,?,'pending',?,?,?)`,
          randomUUID(),
          org.id,
          `${newsSlot(message.id)}:${client.id}`,
          client.id,
          r.channel,
          newsSlot(message.id),
          r.channel === 'email' ? client.email.trim() : client.phone.replace(/[\s().-]/g, ''),
          email?.subject ?? '',
          email?.body ?? text,
          from,
          time,
          time,
        )
      }
    }
    if (change.action === 'news-stop')
      db.run(
        "UPDATE outbox SET status='skipped',detail=?,updated_at=? WHERE organisation_id=? AND kind='news' AND slot=? AND status='pending'",
        'Stopped before it went out.',
        now(),
        org.id,
        newsSlot(change.recordId),
      )
    // A stop link sent to an old address no longer speaks for the client once the address changes.
    const was = new Map(before.clients.map((c) => [c.id, c.email.trim().toLowerCase()]))
    for (const c of after.clients) {
      const old = was.get(c.id)
      if (old !== undefined && old !== c.email.trim().toLowerCase())
        db.run(
          'UPDATE news_links SET revoked_at=? WHERE organisation_id=? AND client_id=? AND revoked_at IS NULL',
          now(),
          org.id,
          c.id,
        )
    }
  })
}

/** A fresh stop link for one client's copy. Only its hash is kept. */
export function issueNewsLink(
  ctx: Context,
  organisationId: string,
  clientId: string,
  messageId: string,
  outboxId: string,
) {
  const raw = token()
  const time = ctx.now()
  ctx.db.run(
    'INSERT INTO news_links(token_hash,organisation_id,client_id,message_id,outbox_id,created_at,expires_at) VALUES(?,?,?,?,?,?,?)',
    digest(raw),
    organisationId,
    clientId,
    messageId,
    outboxId,
    time,
    time + NEWS_LINK_DAYS * DAY,
  )
  // The token sits in the fragment so it never reaches server logs or a Referer header.
  return `${ctx.allowedOrigin}/news/stop#${raw}`
}

/** Opens a stop link. Every failure reads the same, so a link reveals nothing about a client. */
export function openNewsLink(ctx: Context, raw: string) {
  const link = ctx.db.get<{
    organisation_id: string
    client_id: string
    message_id: string
    expires_at: number
  }>(
    'SELECT organisation_id,client_id,message_id,expires_at FROM news_links WHERE token_hash=? AND revoked_at IS NULL',
    digest(raw),
  )
  if (!link || link.expires_at <= ctx.now()) return fail(404, INVALID)
  const org = ctx.systemOrg(link.organisation_id)
  const client = org?.state.clients.find((c) => c.id === link.client_id)
  if (!org || !client) return fail(404, INVALID)
  return { org, client, messageId: link.message_id, tokenHash: digest(raw) }
}
