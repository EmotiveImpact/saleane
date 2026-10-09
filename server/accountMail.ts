import { randomUUID } from 'node:crypto'
import { digest, token } from './auth'
import type { Context } from './context'

/**
 * Account emails: the link to choose a new password and the link to confirm an email address.
 * Each link works once and expires. The email goes through the studio email provider; in test
 * mode nothing is sent, so the link is written to this computer's server log for the person
 * running SALEANE, and the record says it was not sent.
 */
export type LinkKind = 'reset' | 'confirm'
export const LINK_MINUTES: Record<LinkKind, number> = { reset: 60, confirm: 7 * 24 * 60 }
/** No inbox gets more than this many links of one kind in an hour, whoever asks. */
export const LINKS_PER_HOUR = 5
const PATH: Record<LinkKind, string> = { reset: '/reset-password', confirm: '/confirm-email' }
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]'])

/**
 * With email in test mode, the link is written in the server log, but only when SALEANE runs for
 * this computer alone. Anywhere else a log can be read by others, so the link is never written.
 */
export const linkInLog = (ctx: Context) =>
  !ctx.messaging.email.live && LOOPBACK.has(ctx.origin.hostname)

/**
 * Makes a new link. Earlier links of the same kind keep working until they expire or one of them
 * is used, because emails can arrive out of order and the newest-looking one may be the older.
 * The token travels in the address fragment, which browsers never send to a server or in a
 * Referer, so it stays out of request logs.
 */
export function newLink(ctx: Context, accountId: string, email: string, kind: LinkKind) {
  const raw = token(),
    time = ctx.now()
  ctx.db.run(
    'INSERT INTO account_links(token_hash,account_id,kind,email,created_at,expires_at) VALUES(?,?,?,?,?,?)',
    digest(raw),
    accountId,
    kind,
    email,
    time,
    time + LINK_MINUTES[kind] * 60000,
  )
  return `${ctx.allowedOrigin}${PATH[kind]}#${raw}`
}

/** The account a link belongs to, if it is still open and was made for the account's current email. */
export function openLink(ctx: Context, raw: string, kind: LinkKind) {
  return ctx.db.get<{ account_id: string; email: string }>(
    `SELECT l.account_id, l.email FROM account_links l JOIN accounts a ON a.id=l.account_id
     WHERE l.token_hash=? AND l.kind=? AND l.used_at IS NULL AND l.expires_at>? AND a.email=l.email`,
    digest(raw),
    kind,
    ctx.now(),
  )
}

/**
 * Uses up a link, and every other open link of the same kind for the account, and returns its
 * account, or nothing when it is no longer open. Call it inside the transaction that acts on the
 * link, so two requests with the same link cannot both act.
 */
export function claimLink(ctx: Context, raw: string, kind: LinkKind) {
  const link = openLink(ctx, raw, kind)
  if (!link) return undefined
  const claimed = ctx.db.run(
    'UPDATE account_links SET used_at=? WHERE token_hash=? AND used_at IS NULL',
    ctx.now(),
    digest(raw),
  ).changes
  if (claimed !== 1) return undefined
  ctx.db.run(
    'UPDATE account_links SET used_at=? WHERE account_id=? AND kind=? AND used_at IS NULL',
    ctx.now(),
    link.account_id,
    kind,
  )
  return link
}

/** True when the account has already been sent as many links of this kind as an hour allows. */
export function tooManyLinks(ctx: Context, accountId: string, kind: LinkKind) {
  const sent = ctx.db.get<{ total: number }>(
    'SELECT count(*) AS total FROM account_links WHERE account_id=? AND kind=? AND created_at>?',
    accountId,
    kind,
    ctx.now() - 60 * 60000,
  )!.total
  return sent >= LINKS_PER_HOUR
}

/**
 * Makes a fresh link and sends it without holding up the answer. A slow email service never
 * delays signing up, and how long the answer takes never shows whether an address has an account.
 */
export function mailLink(
  ctx: Context,
  account: { id: string; name: string; email: string },
  kind: LinkKind,
) {
  const failed = (error: unknown) =>
    console.error('[SALEANE] An account email could not be made or recorded.', error)
  try {
    const link = newLink(ctx, account.id, account.email, kind)
    void sendAccountMail(ctx, account, kind, link).catch(failed)
  } catch (error) {
    // The answer stays the same: the account is made and the page never learns more.
    failed(error)
  }
}

const WORDING: Record<LinkKind, { subject: string; body: (name: string, link: string) => string }> =
  {
    reset: {
      subject: 'Choose a new SALEANE password',
      body: (name, link) =>
        `Hello ${name},\n\nSomeone asked to choose a new password for your SALEANE account. If it was you, open this link within the next hour:\n\n${link}\n\nIf it was not you, ignore this email. Your password stays as it is.\n\nSALEANE`,
    },
    confirm: {
      subject: 'Confirm your email for SALEANE',
      body: (name, link) =>
        `Hello ${name},\n\nPlease confirm this is your email address by opening this link within the next seven days:\n\n${link}\n\nSALEANE`,
    },
  }

/** Sends an account email and records what happened. Never claims a test-mode email was sent. */
export async function sendAccountMail(
  ctx: Context,
  account: { id: string; name: string; email: string },
  kind: LinkKind,
  link: string,
) {
  const words = WORDING[kind]
  const id = randomUUID()
  const provider = ctx.messaging.email
  // Recorded before the answer goes back, as not known yet. If the server stops before the
  // provider answers, the record still says honestly that nobody knows whether it went.
  ctx.db.run(
    'INSERT INTO account_mail(id,account_id,kind,recipient,subject,status,provider,detail,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
    id,
    account.id,
    kind,
    account.email,
    words.subject,
    'unknown',
    provider.name,
    'Handed to the email service; no answer yet.',
    ctx.now(),
  )
  let status: 'test' | 'accepted' | 'failed' | 'unknown'
  let ref: string | null = null
  let detail: string | null = null
  try {
    const result = await provider.send({
      id,
      channel: 'email',
      to: account.email,
      subject: words.subject,
      body: words.body(account.name.split(' ')[0], link),
      fromName: 'SALEANE',
    })
    status = result.outcome
    if (result.outcome === 'accepted') ref = result.providerRef
    if (result.outcome === 'failed' || result.outcome === 'unknown') detail = result.detail
  } catch (error) {
    status = 'unknown'
    detail = error instanceof Error ? error.message : 'The email provider did not answer.'
  }
  if (status === 'test' && !process.env.VITEST)
    console.log(
      linkInLog(ctx)
        ? `[SALEANE] Email is not connected, so this ${kind} link was not sent to ${account.email}: ${link}`
        : `[SALEANE] Email is not connected, so a ${kind} link for ${account.email} was not sent. It is not written here, as this server is not for this computer alone.`,
    )
  ctx.db.run(
    'UPDATE account_mail SET status=?, provider_ref=?, detail=? WHERE id=?',
    status,
    ref,
    detail,
    id,
  )
  return status
}
